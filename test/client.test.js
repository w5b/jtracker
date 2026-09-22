import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ChromiumClient } from '../src/index.js';
import { endpoint } from './endpoint.js';

test('controlled HTTP, HTTPS, ws and wss behavior', { timeout: 30_000 }, async t => {
  const server = await endpoint();
  const client = new ChromiumClient({ caFile: server.caFile, origin: server.https, timeoutMs: 3000 });
  t.after(async () => { await client.close(); await server.close(); });
  await t.test('HTTP defaults, JSON and binary request bodies', async () => {
    const r = await client.request(`${server.http}/echo`);
    assert.equal(r.status, 200); assert.equal(r.httpVersion, '1.1');
    assert.match(r.json().rawHeaders.join('\n'), /Chrome\/136\.0\.0\.0/);
    assert.equal(r.json().rawHeaders.some(name => name.toLowerCase() === 'expect'), false);
    const post = await client.request(`${server.http}/echo`, { method: 'POST', json: { value: '✓' } });
    assert.equal(Buffer.from(post.json().bodyHex, 'hex').toString(), '{"value":"✓"}');
    const binary = Buffer.from([0, 255, 0, 128]);
    const binaryResponse = await client.request(`${server.http}/echo`, { method: 'PUT', body: binary });
    assert.equal(binaryResponse.json().bodyHex, binary.toString('hex'));
    assert.equal(binaryResponse.json().rawHeaders.some(h => h.toLowerCase() === 'content-type'), false);
  });
  await t.test('HTTPS negotiates h2, preserves settings/order, and reuses connections', async () => {
    const a = await client.request(`${server.https}/first`);
    const b = await client.request(`${server.https}/second`);
    assert.equal(a.httpVersion, '2'); assert.equal(b.json().connection, a.json().connection);
    const connection = server.connections.find(c => c.id === a.json().connection);
    assert.deepEqual(connection.http2.find(f => f.type === 4 && !f.flags).settings,
      [{ key: 1, value: 65536 }, { key: 2, value: 0 }, { key: 4, value: 6291456 }, { key: 6, value: 262144 }]);
    assert.equal(connection.http2.find(f => f.type === 8).increment, 15663105);
    assert.deepEqual(a.json().headers.slice(0, 4).map(([key]) => key), [':method', ':authority', ':scheme', ':path']);
    const concurrent = await Promise.all(Array.from({ length: 5 }, (_, i) => client.request(`${server.https}/${i}`)));
    assert.ok(concurrent.every(r => r.json().connection === a.json().connection));
  });
  await t.test('TLS certificate verification fails for HTTP and WebSockets without the test CA', async () => {
    const untrusted = new ChromiumClient({ timeoutMs: 1000, origin: server.https });
    try {
      await assert.rejects(untrusted.request(server.https), /certificate|issuer/i);
      await assert.rejects(untrusted.openWebSocket(server.wss), /certificate|issuer/i);
    } finally { await untrusted.close(); }
  });
  await t.test('cold WSS uses the same TLS algorithms as HTTPS with HTTP/1-only ALPN', async () => {
    const fresh = new ChromiumClient({ caFile: server.caFile, origin: server.https });
    try {
      const websocket = await fresh.openWebSocket(server.wss);
      const wsHello = server.connections.at(-1).hello;
      const httpHello = server.connections.find(c => c.alpn === 'h2').hello;
      assert.deepEqual(wsHello.ciphersuites, httpHello.ciphersuites);
      for (const type of ['supported_groups', 'keyshare', 'signature_algorithms', 'supported_versions', 'compress_certificate']) {
        assert.deepEqual(wsHello.extensions.find(e => e.type === type), httpHello.extensions.find(e => e.type === type));
      }
      assert.deepEqual(wsHello.extensions.find(e => e.type === 'application_layer_protocol_negotiation').alpn_list, ['http/1.1']);
      assert.equal(wsHello.extensions.some(e => e.type === 'application_settings_new'), false);
      await websocket.close();
    } finally { await fresh.close(); }
  });
  await t.test('HTTP/1 TLS fallback and all advertised compression formats', async () => {
    for (const encoding of ['gzip', 'deflate', 'br', 'zstd']) {
      const r = await client.request(`${server.https}/${encoding}`, { httpVersion: '1.1' });
      assert.equal(r.httpVersion, '1.1'); assert.equal(r.text(), 'compressed payload ✓');
    }
  });
  await t.test('cookies, path scoping, redirects and body method rules', async () => {
    await client.request(`${server.http}/set`);
    let r = await client.request(`${server.http}/echo`);
    assert.match(r.json().rawHeaders.join('\n'), /sid=abc/);
    assert.doesNotMatch(r.json().rawHeaders.join('\n'), /narrow=1/);
    r = await client.request(`${server.http}/redirect`, { method: 'POST', body: 'a=1' });
    assert.equal(r.json().method, 'GET'); assert.equal(r.history.length, 1);
    assert.match(r.json().rawHeaders.join('\n'), /redirected=yes/);
    r = await client.request(`${server.http}/redirect307`, { method: 'POST', body: 'a=1' });
    assert.equal(r.json().method, 'POST'); assert.equal(r.json().bodyHex, Buffer.from('a=1').toString('hex'));
    assert.equal((await client.request(`${server.http}/redirect`, { redirect: 'manual' })).status, 302);
    await assert.rejects(client.request(`${server.http}/loop`, { maxRedirects: 2 }), /redirects/);
  });
  await t.test('limits, abort, timeouts and invalid input', async () => {
    await assert.rejects(client.request(`${server.http}/large`, { maxResponseBytes: 100 }), /maxResponseBytes/);
    await assert.rejects(client.request(`${server.http}/slow`, { timeoutMs: 100 }), /timeout|timed out/i);
    const abort = new AbortController();
    const pending = client.request(`${server.http}/slow`, { signal: abort.signal });
    abort.abort(new Error('cancelled')); await assert.rejects(pending, /cancelled/);
    await assert.rejects(client.request('file:///etc/hosts'), /protocol/);
    await assert.rejects(client.request(server.http, { headers: { test: 'a\r\nb' } }), /Invalid character/);
    await assert.rejects(client.request(server.http, { headers: { Cookie: 'manual=1' } }), /managed/);
  });
  for (const scheme of ['ws', 'wss']) await t.test(`${scheme}: handshake, cookies, extensions, text/binary, ping, fragmentation and close`, async () => {
    const ws = await client.openWebSocket(`${server[scheme]}/echo`, { protocols: ['echo'] });
    assert.equal(ws.protocol, 'echo'); assert.equal(ws.extensions, 'permessage-deflate');
    await ws.send('hello '.repeat(1000)); assert.equal((await ws.receive()).data, 'hello '.repeat(1000));
    const binary = Buffer.from([0, 255, 128]); await ws.send(binary);
    assert.deepEqual(await ws.receive(), { type: 'binary', data: binary });
    const info = await ws.close(1000, 'done'); assert.equal(info.code, 1000); assert.equal(info.reason, 'done');
    const request = server.upgrades.at(-1);
    if (scheme === 'wss') assert.match(request.headers.cookie, /sid=abc/);
    else assert.equal(request.headers.cookie, undefined); // schemeful SameSite
    assert.equal(request.headers['sec-websocket-extensions'], 'permessage-deflate; client_max_window_bits');
    assert.deepEqual(request.rawHeaders.filter((_, i) => i % 2 === 0).slice(0, 10),
      ['Host', 'Connection', 'Pragma', 'Cache-Control', 'Upgrade', 'Origin', 'Sec-WebSocket-Version', 'User-Agent', 'Accept-Encoding', 'Accept-Language']);
    const frames = server.wsFrames.at(-1);
    assert.ok(frames.every(f => f.masked)); assert.ok(frames.some(f => f.rsv1)); assert.ok(frames.some(f => f.opcode === 8));
    const fragmented = await client.openWebSocket(`${server[scheme]}/fragmented`);
    assert.equal((await fragmented.receive()).data, 'fragmented'); await fragmented.close();
    assert.ok(server.wsFrames.at(-1).some(f => f.opcode === 10));
  });
  await t.test('early messages, bad upgrade, queue cap and pending receive cleanup', async () => {
    const early = await client.openWebSocket(`${server.wss}/welcome`);
    assert.equal((await early.receive()).data, 'early message');
    const receive = early.receive(); await early.close(); assert.equal(await receive, null);
    await assert.rejects(client.openWebSocket(`${server.wss}/bad-accept`), /Sec-WebSocket-Accept/);
    await assert.rejects(client.openWebSocket(`${server.wss}/bad-extension`), /extension/i);
    const flood = await client.openWebSocket(`${server.ws}/flood`, { maxQueuedMessages: 2 });
    await flood.closed;
    while (flood.queue.length) await flood.receive();
    await assert.rejects(flood.receive(), /queue limit/);
  });
  await t.test('WebSocket extension decline and long frames survive partial TLS writes', async () => {
    for (const path of ['/echo', '/no-deflate']) {
      const ws = await client.openWebSocket(`${server.wss}${path}`);
      if (path === '/no-deflate') assert.equal(ws.extensions, '');
      for (const size of [0, 125, 126, 70_000]) {
        const data = randomBytes(size); await ws.send(data);
        assert.deepEqual((await ws.receive()).data, data);
      }
      await ws.close();
      const frames = server.wsFrames.at(-1);
      assert.ok(frames.some(frame => frame.length >= 65_536));
      assert.equal(new Set(frames.map(frame => frame.mask)).size, frames.length);
      if (path === '/no-deflate') assert.ok(frames.every(frame => !frame.rsv1));
    }
  });
  await t.test('closing client aborts outstanding transfers and closes sockets', async () => {
    const other = new ChromiumClient({ caFile: server.caFile, origin: server.https });
    const ws = await other.openWebSocket(server.wss);
    const receive = ws.receive();
    const pending = other.request(`${server.http}/slow`);
    const rejected = assert.rejects(pending, /closed/i);
    await other.close(); await rejected; assert.equal(await receive, null);
    await assert.rejects(other.request(server.http), /closed/i);
    await assert.rejects(other.openWebSocket(server.ws), /closed/i);
    await other.close();
  });
});
