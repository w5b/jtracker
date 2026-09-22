import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { ChromiumClient } from '../src/index.js';
import { endpoint } from '../test/endpoint.js';
import { compareTLS, compareHTTP2 } from './compare.js';

const fixture = await readFile(new URL('../test/fixtures/chrome_136.0.7103.93.yaml', import.meta.url));
const reference = YAML.parse(fixture.toString());
const server = await endpoint();
const client = new ChromiumClient({ origin: server.https, caFile: server.caFile });
try {
  const first = await client.request(`${server.https}/navigation`);
  const second = await client.request(`${server.https}/navigation`);
  const connection = server.connections.find(c => c.id === first.json().connection);
  const tls = compareTLS(connection.hello, reference.signature.tls_client_hello);
  const http2 = compareHTTP2(connection, reference.signature.http2);
  const http1 = await client.request(`${server.https}/echo`, { httpVersion: '1.1' });
  const wss = await client.openWebSocket(`${server.wss}/echo`);
  await wss.send('compress me '.repeat(1000)); assert.equal((await wss.receive()).data, 'compress me '.repeat(1000));
  await wss.send(Buffer.from([0, 255])); assert.deepEqual((await wss.receive()).data, Buffer.from([0, 255]));
  await wss.close(1000, 'finished');
  const websocketConnection = server.connections.at(-1);
  const wsHeaders = server.upgrades.at(-1).rawHeaders.filter((_, i) => i % 2 === 0);
  const wsHeaderExpected = ['Host', 'Connection', 'Pragma', 'Cache-Control', 'Upgrade', 'Origin', 'Sec-WebSocket-Version', 'User-Agent', 'Accept-Encoding', 'Accept-Language', 'Sec-WebSocket-Key', 'Sec-WebSocket-Extensions'];
  const wsHeaderOrderMatch = JSON.stringify(wsHeaders) === JSON.stringify(wsHeaderExpected);
  const stableTLS = hello => ({ ...hello, extensions: hello.extensions.map(e => ({ ...e })).sort((a, b) => String(a.type).localeCompare(String(b.type)) || a.length - b.length) });
  const report = {
    generatedAt: new Date().toISOString(), node: process.version,
    runtime: process.versions.bun ? { name: 'bun', version: process.versions.bun } : { name: 'node', version: process.versions.node },
    platform: `${process.platform}-${process.arch}`,
    browserExecuted: false, backend: client.backend,
    reference: {
      browser: reference.browser,
      url: 'https://github.com/lexiforest/curl-impersonate/blob/6e8f87760a4dd96771e96fc9d55440dcd8845243/tests/signatures/chrome_136.0.7103.93.yaml',
      sha256: createHash('sha256').update(fixture).digest('hex'),
      evidence: 'Upstream derived signature, manually adapted from Chrome 131 according to its own comment. Not an independent raw Chromium 136 packet capture.',
    },
    tls, http2,
    websocket: {
      handshakeHeaderOrder: { pass: wsHeaderOrderMatch, observed: wsHeaders, expected: wsHeaderExpected },
      reference: 'https://chromium.googlesource.com/chromium/src/+/136.0.7103.93/net/websockets/websocket_stream_test.cc',
      evidence: 'Handshake order and extension offer compared to Chromium source tests; frame behavior is local interoperability testing, not a browser wire comparison.',
      clientHello: stableTLS(websocketConnection.hello),
      alpn: websocketConnection.alpn, frames: server.wsFrames.at(-1),
      extensions: server.upgrades.at(-1).headers['sec-websocket-extensions'],
    },
    interoperability: { repeatedRequestSameConnection: first.json().connection === second.json().connection, httpsHTTP1: http1.httpVersion, wssTextBinaryClose: true },
    unvalidated: [
      'No independent raw Chromium baseline was supplied; no browser was run or automated.',
      'HTTP/2 HEADERS priority flags/weight, HPACK byte choices, ACK scheduling, flow control under load, TLS resumption and connection coalescing.',
      'WebSocket-specific TLS reference, masking randomness distribution, compression byte output/predictor and fragmentation boundaries.',
      'HTTP/3, QUIC, ECH with real DNS HTTPS records, proxy behavior, OS TCP fingerprint and packet timing.',
    ],
    observedConnections: server.connections,
  };
  const checks = [...tls.checks, ...http2, { field: 'WebSocket handshake header order', pass: wsHeaderOrderMatch }];
  report.summary = { compared: checks.length, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length, browserEquivalent: 'NOT ESTABLISHED' };
  const output = new URL('./results/', import.meta.url); await mkdir(output, { recursive: true });
  await writeFile(new URL('latest.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
  for (const check of checks.filter(c => !c.pass)) console.log(`DIFFERENCE: ${check.field}\n  expected: ${JSON.stringify(check.expected)}\n  observed: ${JSON.stringify(check.actual)}`);
  console.log('Full wire observations and evidence limits: validation/results/latest.json');
  if (report.summary.failed) process.exitCode = 1;
} finally { await client.close(); await server.close(); }
