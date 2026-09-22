import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import hpack from 'hpack.js';
import { WebSocketServer } from '../src/ws-codec.js';
import { clientHello, frame, observeWebSocketFrames } from '../validation/wire.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
export async function endpoint({ socketIO = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chromium-net-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'),
    '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const caFile = join(dir, 'cert.pem');
  const [key, cert] = await Promise.all([readFile(join(dir, 'key.pem')), readFile(caFile)]);
  const connections = [], requests = [], upgrades = [], wsFrames = [], sockets = new Set(), wsPeers = new Set();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const plain = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const observation = { path: req.url, method: req.method, rawHeaders: req.rawHeaders, bodyHex: Buffer.concat(chunks).toString('hex'), remotePort: req.socket.remotePort };
    requests.push(observation);
    const path = req.url.split('?')[0];
    if (path === '/slow') return;
    if (path === '/large') { res.end(Buffer.alloc(1024 * 1024, 65)); return; }
    if (path === '/redirect' || path === '/redirect307') {
      res.writeHead(path === '/redirect307' ? 307 : 302, { Location: '/echo', 'Set-Cookie': 'redirected=yes; Path=/; HttpOnly; SameSite=Lax' }); res.end(); return;
    }
    if (path === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    if (path === '/set') res.setHeader('Set-Cookie', ['sid=abc; Path=/; HttpOnly; SameSite=Lax', 'narrow=1; Path=/narrow']);
    if (path === '/gzip' || path === '/deflate' || path === '/br' || path === '/zstd') {
      const name = path.slice(1);
      const compress = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[name];
      res.setHeader('Content-Encoding', name); res.end(compress(Buffer.from('compressed payload ✓'))); return;
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(observation));
  });
  plain.on('connection', track);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 0 } });
  const uncompressed = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  wss.on('headers', (headers, req) => {
    if (req.url === '/bad-extension') headers.push('Sec-WebSocket-Extensions: unsupported-extension');
  });
  plain.on('upgrade', (req, socket, head) => {
    if (socketIO && req.url.startsWith('/socket.io/')) return;
    upgrades.push({ path: req.url, headers: req.headers, rawHeaders: req.rawHeaders });
    if (req.url === '/bad-accept') {
      socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n\r\n'); return;
    }
    const frames = []; wsFrames.push(frames);
    const observe = observeWebSocketFrames(frames); if (head.length) observe(head);
    socket.prependListener('data', observe);
    (req.url === '/no-deflate' ? uncompressed : wss).handleUpgrade(req, socket, head, ws => {
      wsPeers.add(ws); ws.on('close', () => wsPeers.delete(ws)); ws.on('error', () => {});
      ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary, compress: true }));
      if (req.url === '/welcome') ws.send('early message');
      if (req.url === '/fragmented') { ws.send('frag', { fin: false }); ws.ping('probe'); ws.send('mented', { fin: true }); }
      if (req.url === '/flood') for (let i = 0; i < 20; i++) ws.send('flood');
    });
  });
  const plainPort = await listen(plain);

  const pending = new Map();
  const secure = tls.createServer({ key, cert, ALPNProtocols: ['h2', 'http/1.1'] }, socket => {
    track(socket);
    const record = pending.get(socket.remotePort);
    if (record) { record.alpn = socket.alpnProtocol; record.tlsVersion = socket.getProtocol(); record.cipher = socket.getCipher(); }
    if (socket.alpnProtocol === 'h2') serveH2(socket, record);
    else plain.emit('connection', socket);
  });
  secure.on('tlsClientError', () => {});
  secure.on('connection', track);
  const securePort = await listen(secure);
  const proxy = net.createServer(incoming => {
    track(incoming);
    const outgoing = net.connect(securePort, '127.0.0.1'); track(outgoing);
    const record = { id: connections.length + 1, hello: null, rawClientHelloHex: '', http2: [] }; connections.push(record);
    let captured = Buffer.alloc(0);
    incoming.pause();
    outgoing.on('connect', () => { pending.set(outgoing.localPort, record); incoming.pipe(outgoing); outgoing.pipe(incoming); incoming.resume(); });
    incoming.on('data', chunk => {
      if (record.hello || captured.length > 128 * 1024) return;
      captured = Buffer.concat([captured, chunk]); record.hello = clientHello(captured);
      if (record.hello) record.rawClientHelloHex = captured.toString('hex');
    });
    incoming.on('close', () => outgoing.destroy()); outgoing.on('close', () => incoming.destroy());
  });
  const port = await listen(proxy);
  return { caFile, dir, connections, requests, upgrades, wsFrames, wsPeers, httpServer: plain,
    http: `http://localhost:${plainPort}`, https: `https://localhost:${port}`,
    ws: `ws://localhost:${plainPort}`, wss: `wss://localhost:${port}`,
    async close() {
      for (const ws of wsPeers) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([plain, secure, proxy].map(server => new Promise(resolve => server.close(resolve))));
      wss.close(); uncompressed.close(); await rm(dir, { recursive: true, force: true });
    },
  };
}

function serveH2(socket, record) {
  const decoder = hpack.decompressor.create({ table: { maxSize: 65536 } });
  let pending = Buffer.alloc(0), preface = false, block = [], current;
  const requests = new Map();
  socket.write(frame(4, 0, 0));
  const reply = streamId => {
    const request = requests.get(streamId);
    if (!request || request.replied) return;
    request.replied = true;
    const body = Buffer.from(JSON.stringify({ headers: request.headers, bodyHex: Buffer.concat(request.chunks).toString('hex'), connection: record.id }));
    socket.write(frame(1, 4, streamId, Buffer.from([0x88]))); // HPACK static :status=200
    socket.write(frame(0, 1, streamId, body));
  };
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!preface) {
      if (pending.length < 24) return;
      if (pending.subarray(0, 24).toString() !== 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n') { socket.destroy(); return; }
      record.preface = true; pending = pending.subarray(24); preface = true;
    }
    while (pending.length >= 9) {
      const length = pending.readUIntBE(0, 3); if (pending.length < 9 + length) return;
      const type = pending[3], flags = pending[4], streamId = pending.readUInt32BE(5) & 0x7fffffff;
      let payload = pending.subarray(9, 9 + length); pending = pending.subarray(9 + length);
      const event = { type, flags, streamId, length }; record.http2.push(event);
      if (type === 4 && !(flags & 1)) {
        event.settings = [];
        for (let i = 0; i < payload.length; i += 6) event.settings.push({ key: payload.readUInt16BE(i), value: payload.readUInt32BE(i + 2) });
        socket.write(frame(4, 1, 0));
      } else if (type === 8) event.increment = payload.readUInt32BE(0) & 0x7fffffff;
      else if (type === 1 || type === 9) {
        if (type === 1) {
          current = { event, endStream: !!(flags & 1) }; block = [];
          if (flags & 8) { const pad = payload[0]; payload = payload.subarray(1, payload.length - pad); }
          if (flags & 32) { event.priority = { exclusive: !!(payload[0] & 128), dependency: payload.readUInt32BE(0) & 0x7fffffff, weight: payload[4] + 1 }; payload = payload.subarray(5); }
        }
        block.push(payload);
        if (flags & 4) {
          const raw = Buffer.concat(block); current.event.hpackHex = raw.toString('hex');
          decoder.write(raw); decoder.execute();
          const headers = []; let field; while ((field = decoder.read())) headers.push([field.name, field.value]);
          current.event.headers = headers; requests.set(streamId, { headers, chunks: [] });
          if (current.endStream) reply(streamId);
        }
      } else if (type === 0) {
        requests.get(streamId)?.chunks.push(payload);
        if (flags & 1) reply(streamId);
      } else if (type === 6 && !(flags & 1)) socket.write(frame(6, 1, 0, payload));
    }
  });
}
