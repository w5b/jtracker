import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import JTracker from '../JTracker.ts';
import { ChromiumClient, PROFILE } from '../src/index.js';
import { connectSocketIO } from '../src/socketio.js';
import { WebSocketServer } from '../src/ws-codec.js';
import { endpoint } from './endpoint.js';

function event(emitter, name, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const listener = (...args) => { clearTimeout(timer); resolve(args); };
    const timer = setTimeout(() => { emitter.off(name, listener); reject(new Error(`Timed out waiting for ${name}`)); }, timeoutMs);
    emitter.once(name, listener);
  });
}
async function connect(socket) {
  const connected = event(socket, 'connect'); socket.connect(); await connected;
}

test('Socket.IO and JTracker over the native Chromium WebSocket transport', { timeout: 15_000 }, async t => {
  const server = await endpoint({ socketIO: true });
  const io = new Server(server.httpServer, {
    transports: ['websocket'], perMessageDeflate: true, pingInterval: 40, pingTimeout: 1000,
    wsEngine: WebSocketServer,
  });
  const requests = [], peers = [], clients = [], trackers = [];
  io.engine.on('initial_headers', (_headers, request) => requests.push(request));
  for (const namespace of [io.of('/'), io.of('/feed')]) {
    namespace.use((socket, next) => {
      const token = socket.handshake.auth.token;
      next(token === 'denied' ? new Error('denied') : token === 'invalid-feed' ? new Error('Invalid token') : undefined);
    });
    namespace.on('connection', socket => {
      peers.push(socket);
      socket.on('reflect', (value, ack) => ack(value));
      socket.on('reply', async ack => ack(await socket.timeout(1500).emitWithAck('server-question', 'answer me')));
      socket.on('user_connected', token => {
        socket.emit('registered', { token, auth: socket.handshake.auth });
        if (!token.startsWith('feed-')) return;
        socket.emit('initialTweets', [{ id: 'history', text: 'Earlier tweet', author: { handle: 'alice' } }]);
        socket.emit('ai_suggestion', { tweet_id: 'live', prediction: 'example', ticker: 'TEST' });
        socket.emit('tweet', { id: 'live', text: 'Live tweet', author: { handle: 'bob' } });
        socket.emit('tweet_update', { id: 'live', media: { images: ['image'] } });
        socket.emit('tweet.subtweet.update', { id: 'live', quotedTweet: { id: 'quote', text: 'Quoted text' } });
        socket.emit('pnl_update', { example: 42 });
        socket.emit('following_update', { id: 'follow', user: { handle: 'alice' }, following: { handle: 'bob' } });
      });
      socket.emit('welcome', { namespace: socket.nsp.name });
    });
  }
  t.after(async () => {
    await Promise.allSettled(trackers.map(tracker => tracker.close()));
    await Promise.allSettled(clients.map(client => client.close()));
    await new Promise(resolve => io.close(resolve));
    await server.close();
  });
  function tracker(options = {}) {
    const tracker = new JTracker('FRA', {
      url: server.https, origin: server.https, caFile: server.caFile, log: () => {},
      ...options,
      socketOptions: { autoConnect: false, reconnectionDelay: 20, reconnectionDelayMax: 40, randomizationFactor: 0, ...options.socketOptions },
    });
    trackers.push(tracker); return tracker;
  }

  await t.test('JTracker connects to / with EIO=4, Chromium TLS/headers and ordinary Socket.IO events', async () => {
    const client = tracker({ socketOptions: { auth: { token: 'test' }, query: { region: 'FRA' } } });
    const welcome = event(client.socket, 'welcome');
    await connect(client.socket);
    assert.deepEqual((await welcome)[0], { namespace: '/' });
    assert.equal(peers.at(-1).handshake.auth.token, 'test');
    assert.equal(client.socket.io.engine.transport.constructor.name, 'ChromiumWebSocketTransport');
    const request = requests.at(-1);
    assert.match(request.url, /^\/socket\.io\/\?/);
    const query = new URL(request.url, server.https).searchParams;
    assert.equal(query.get('EIO'), '4'); assert.equal(query.get('transport'), 'websocket');
    assert.equal(query.get('region'), 'FRA');
    assert.equal(request.headers.origin, server.https);
    assert.equal(request.headers['user-agent'], PROFILE.userAgent);
    assert.equal(request.headers['sec-websocket-extensions'], 'permessage-deflate; client_max_window_bits');
    const hello = server.connections.at(-1).hello;
    assert.equal(hello.ciphersuites[0], 'GREASE');
    assert.ok(hello.extensions.find(e => e.type === 'supported_groups').supported_groups.includes(4588));
    assert.deepEqual(hello.extensions.find(e => e.type === 'application_layer_protocol_negotiation').alpn_list, ['http/1.1']);
    assert.equal(await client.socket.timeout(1500).emitWithAck('reflect', 'hello'), 'hello');
    client.socket.on('server-question', (message, ack) => ack(message.toUpperCase()));
    assert.equal(await client.socket.timeout(1500).emitWithAck('reply'), 'ANSWER ME');
    await client.close();
  });

  await t.test('binary attachments and concurrent acknowledgements preserve order', async () => {
    const client = tracker(); await connect(client.socket);
    const values = Array.from({ length: 8 }, (_, sequence) => ({ sequence, nested: [randomBytes(70_000), Buffer.from([0, 255])] }));
    const echoed = await Promise.all(values.map(value => client.socket.timeout(2000).emitWithAck('reflect', value)));
    assert.deepEqual(echoed, values);
    await client.close();
  });

  await t.test('site authentication, typed tweet features and reconnect registration use the native transport', async () => {
    let generation = 0;
    const client = tracker({ socketOptions: { auth: done => done({ token: `feed-${++generation}`, extra: 'kept' }) } });
    const arrivals = [], history = [], following = [], pnl = [];
    client.on('tweet', item => arrivals.push(item)); client.on('initialTweets', items => history.push(items));
    client.on('following_update', item => following.push(item)); client.on('pnl_update', item => pnl.push(item));
    let registered = event(client.socket, 'registered');
    await connect(client.socket);
    assert.deepEqual((await registered)[0], { token: 'feed-1', auth: { token: 'feed-1', extra: 'kept' } });
    await client.socket.timeout(1500).emitWithAck('reflect', 'barrier');
    assert.equal(arrivals.length, 1); assert.equal(arrivals[0].aiSuggestion.ticker, 'TEST');
    assert.equal(history[0][0].id, 'history'); assert.equal(following[0].target.handle, 'bob');
    assert.deepEqual(pnl[0], { example: 42 });
    assert.equal(client.getTweet('live').quotedTweet.text, 'Quoted text');
    assert.deepEqual(client.getTweet('live').media.images, ['image']);
    registered = event(client.socket, 'registered');
    peers.at(-1).conn.transport.socket.terminate();
    assert.equal((await registered)[0].token, 'feed-2');
    await client.socket.timeout(1500).emitWithAck('reflect', 'barrier');
    assert.equal(generation, 2); assert.equal(arrivals.length, 1); assert.equal(history.length, 2);
    assert.equal(client.socket.io.engine.transport.constructor.name, 'ChromiumWebSocketTransport');
    const deleted = event(client, 'tweet_deleted'); peers.at(-1).emit('tweet_deleted', { id: 'live' });
    assert.equal((await deleted)[0].tweet.isDeleted, true);
    await client.close();
  });

  await t.test('explicit token registration, server disconnect retry and fatal auth handling', async () => {
    const client = tracker({ token: 'site-token', socketOptions: { auth: { token: 'overridden', extra: 'kept' } } });
    let registered = event(client.socket, 'registered'); await connect(client.socket);
    assert.deepEqual((await registered)[0], { token: 'site-token', auth: { token: 'site-token', extra: 'kept' } });
    registered = event(client.socket, 'registered', 6000);
    peers.at(-1).disconnect(true);
    assert.equal((await registered)[0].token, 'site-token');
    await client.close();
    const denied = tracker({ token: 'invalid-feed' });
    const authError = event(denied, 'auth_error'); denied.socket.connect();
    assert.equal((await authError)[0].error, 'Invalid token');
    assert.equal(denied.socket.active, false); await denied.close();
    const revoked = tracker({ token: 'site-token' }); await connect(revoked.socket);
    const disconnected = event(revoked, 'disconnect');
    peers.at(-1).emit('auth_error', { error: 'Account disabled' });
    await disconnected; assert.equal(revoked.socket.active, false); await revoked.close();
  });

  await t.test('Engine.IO heartbeats and automatic reconnection retain the native transport', async () => {
    const client = tracker(); await connect(client.socket);
    const peer = peers.at(-1);
    await new Promise((resolve, reject) => {
      let pongs = 0;
      const timer = setTimeout(() => reject(new Error('Missing Engine.IO pongs')), 1500);
      peer.conn.on('packet', function onPacket(packet) {
        if (packet.type === 'pong' && ++pongs === 2) { clearTimeout(timer); peer.conn.off('packet', onPacket); resolve(); }
      });
    });
    const oldId = client.socket.id;
    const reconnected = event(client.socket, 'connect');
    peer.conn.transport.socket.terminate();
    await reconnected;
    assert.notEqual(client.socket.id, oldId);
    assert.equal(client.socket.io.engine.transport.constructor.name, 'ChromiumWebSocketTransport');
    assert.equal(requests.at(-1).headers['user-agent'], PROFILE.userAgent);
    assert.equal(await client.socket.timeout(1500).emitWithAck('reflect', 'after reconnect'), 'after reconnect');
    await client.close();
    assert.equal(client.socket.io._reconnecting, false);
    await client.close();
  });

  await t.test('plain ws, namespaces, shared cookies and Engine.IO base64 mode', async () => {
    const client = new ChromiumClient({ origin: server.http }); clients.push(client);
    client.cookies.set('session=local; Path=/; SameSite=Lax', server.http);
    const socket = connectSocketIO(client, `${server.http}/feed`, { autoConnect: false, forceBase64: true });
    try {
      const welcome = event(socket, 'welcome'); await connect(socket);
      assert.deepEqual((await welcome)[0], { namespace: '/feed' });
      assert.match(requests.at(-1).headers.cookie, /session=local/);
      const binary = randomBytes(500); assert.deepEqual(await socket.timeout(1500).emitWithAck('reflect', binary), binary);
    } finally { socket.disconnect(); await client.close(); }
  });

  await t.test('namespace auth rejection and TLS rejection surface as connect_error', async () => {
    const denied = tracker({ socketOptions: { auth: { token: 'denied' } } });
    const rejected = event(denied.socket, 'connect_error'); denied.socket.connect();
    assert.equal((await rejected)[0].message, 'denied'); await denied.close();
    const untrusted = tracker({ caFile: undefined, socketOptions: { reconnection: false } });
    const failed = event(untrusted.socket, 'connect_error'); untrusted.socket.connect();
    const error = (await failed)[0];
    assert.match(String(error.description), /certificate|issuer/i); await untrusted.close();
  });

  await t.test('manager handshake timeout and close during connect release native sockets', async () => {
    const client = new ChromiumClient({ origin: server.https, caFile: server.caFile }); clients.push(client);
    // The generic WS echo endpoint never sends an Engine.IO opening packet.
    const socket = connectSocketIO(client, server.https, { path: '/stall/', autoConnect: false, timeout: 50, reconnection: false });
    const failed = event(socket, 'connect_error'); socket.connect();
    assert.match((await failed)[0].message, /timeout/);
    socket.disconnect(); await client.close();
    const opening = tracker(); opening.socket.connect(); await opening.close();
    assert.equal(opening.socket.connected, false);
  });
});
