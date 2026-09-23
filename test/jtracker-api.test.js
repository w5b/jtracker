import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Server } from 'socket.io';
import JTracker, { API_ENDPOINTS, SOCIAL_EVENTS } from '../JTracker.ts';
import { WebSocketServer } from '../src/ws-codec.js';
import { endpoint } from './endpoint.js';

function event(emitter, name, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const listener = (...args) => { clearTimeout(timer); resolve(args); };
    const timer = setTimeout(() => { emitter.off(name, listener); reject(new Error(`Timed out waiting for ${name}`)); }, timeoutMs);
    emitter.once(name, listener);
  });
}

test('account REST API and social socket over the native Chromium transport', { timeout: 20_000 }, async t => {
  const routes = new Map(), calls = [];
  const route = (method, path, reply) => routes.set(`${method} ${path}`, reply);
  // HTTP/1.1 only, so every request reaches this handler instead of the generic HTTP/2 echo.
  const server = await endpoint({
    h2: false, socketIO: ['/socket.io/', '/wallets/socket.io/'],
    handler: async (req, res, body) => {
      const url = new URL(req.url, 'https://localhost'), raw = body.toString();
      const call = { method: req.method, path: url.pathname, url, headers: req.headers, raw, json: raw ? JSON.parse(raw) : undefined };
      calls.push(call);
      const reply = routes.get(`${req.method} ${url.pathname}`);
      if (!reply) return false;
      const { status = 200, headers = {}, body: payload } = await reply(call);
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
      return true;
    },
  });
  const registrations = new EventEmitter(), socialPeers = [], historyRequests = [];
  const main = new Server(server.httpServer, { transports: ['websocket'], wsEngine: WebSocketServer });
  main.on('connection', socket => socket.on('user_connected', token => registrations.emit('registered', { auth: socket.handshake.auth.token, token })));
  const social = new Server(server.httpServer, { path: '/wallets/socket.io/', transports: ['websocket'], wsEngine: WebSocketServer });
  social.use((socket, next) => next(socket.handshake.auth.token === 'bad' ? new Error('Invalid token') : undefined));
  social.on('connection', socket => {
    socialPeers.push(socket);
    socket.emit('tracked_pump', { pump_users: [{ username: 'dev' }], limit: 50 });
    socket.emit('pump_event', { mint: 'Mint111' });
    socket.on('social_history', (payload, ack) => {
      historyRequests.push(payload);
      ack({ events: [
        { channel: 'telegram_event', payload: { text: 'gm' } },
        { channel: 'mystery', payload: { a: 1 } },
        { channel: 'pump_event', payload: null },
      ] });
    });
  });
  const trackers = [];
  t.after(async () => {
    await Promise.allSettled(trackers.map(tracker => tracker.close()));
    await Promise.all([main, social].map(io => new Promise(resolve => io.close(resolve))));
    await server.close();
  });
  const hosts = { core: `${server.https}/core`, main: `${server.https}/main`, social: `${server.https}/wallets` };
  const retry = { reconnectionDelay: 20, reconnectionDelayMax: 40, randomizationFactor: 0 };
  function tracker(options = {}) {
    const tracker = new JTracker('NY', {
      url: server.https, caFile: server.caFile, log: () => {}, apiHosts: hosts, ...options,
      socketOptions: { autoConnect: false, ...retry }, social: { url: server.https, socketOptions: retry },
    });
    trackers.push(tracker); return tracker;
  }

  await t.test('session check adopts a rotated token for REST calls and the next socket connect', async () => {
    route('GET', '/core/api/session-check', ({ headers }) => {
      if (headers['x-session-id'] === 'old') return { body: { username: 'alice', userId: 7 }, headers: { 'X-New-Token': 'new' } };
      if (headers['x-session-id'] === 'new') return { body: { username: 'alice', userId: 7 } };
      return { status: 401, body: { error: 'Invalid session' } };
    });
    const client = tracker({ token: 'old' }), tokens = [];
    client.on('token', token => tokens.push(token));
    assert.deepEqual(await client.api.checkSession(), { token: 'new', username: 'alice', userId: '7', rotated: true });
    assert.equal(client.token, 'new'); assert.deepEqual(tokens, ['new']);
    const request = calls.at(-1);
    assert.equal(request.headers['cache-control'], 'no-cache, no-store, must-revalidate');
    assert.equal(request.headers.pragma, 'no-cache');
    // The site's page makes these requests with fetch(): Origin, Referer, cors mode, no cookies.
    assert.equal(request.headers.origin, 'https://j7tracker.io');
    assert.equal(request.headers.referer, 'https://j7tracker.io/');
    assert.equal(request.headers['sec-fetch-mode'], 'cors'); assert.equal(request.headers.accept, '*/*');
    assert.equal(request.headers.cookie, undefined);
    assert.deepEqual(await client.api.checkSession(), { token: 'new', username: 'alice', userId: '7', rotated: false });

    const registered = event(registrations, 'registered');
    const connected = event(client.socket, 'connect'); client.socket.connect(); await connected;
    assert.deepEqual((await registered)[0], { auth: 'new', token: 'new' });
    client.token = 'expired';
    await assert.rejects(client.api.checkSession(), { name: 'JTrackerApiError', code: 'unauthorized', status: 401, message: 'Invalid session' });
    assert.deepEqual(tokens, ['new', 'expired']);
    await client.close();
  });

  await t.test('login needs a Turnstile token, sends no session header and adopts the session', async () => {
    const client = tracker();
    await assert.rejects(client.api.login({ username: 'alice', password: 'pw', turnstileToken: ' ' }), TypeError);
    const before = calls.length;
    await assert.rejects(client.api.getCustomAccounts(), { code: 'no_session' });
    assert.equal(calls.length, before, 'no request without a session');
    route('POST', '/core/api/login', ({ json }) => json.cf_turnstile_token === 'human-solved'
      ? { body: { sessionId: 'fresh', username: 'Alice', userId: 9 } } : { status: 400, body: { error: 'Security check failed' } });
    assert.deepEqual(await client.api.login({ username: 'alice', password: 'pw', turnstileToken: 'human-solved' }), { token: 'fresh', username: 'Alice', userId: '9' });
    const request = calls.at(-1);
    assert.deepEqual(request.json, { username: 'alice', password: 'pw', ref_code: null, cf_turnstile_token: 'human-solved' });
    assert.equal(request.headers['x-session-id'], undefined); assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(client.token, 'fresh');
    await assert.rejects(client.api.login({ username: 'alice', password: 'pw', turnstileToken: 'stale' }), { code: 'http_error', status: 400, message: 'Security check failed' });
    assert.equal(client.token, 'fresh');
  });

  await t.test('custom and available account endpoints follow the site envelope', async () => {
    const client = tracker({ token: 'sess' });
    route('GET', '/core/api/accounts', ({ headers }) => ({ body: { accounts: ['alice', 5], maxAccounts: 10, deployCount: 3, extra: 'kept' },
      headers: headers['x-session-id'] === 'sess' ? { 'X-New-Token': 'sess2' } : {} }));
    const accounts = await client.api.getCustomAccounts();
    // Any authenticated response can rotate the session, as the site's fetch wrapper does.
    assert.equal(client.token, 'sess2');
    client.token = 'sess';
    assert.deepEqual(accounts, { accounts: ['alice'], availableAccounts: [], customConfigured: false, deployCount: 3, maxAccounts: 10, extra: 'kept' });
    assert.deepEqual(client.customAccounts, accounts);
    assert.equal(calls.at(-1).headers['x-session-id'], 'sess'); assert.equal(calls.at(-1).headers['content-type'], undefined);

    route('POST', '/core/api/accounts', ({ json }) => json.handle === 'full'
      ? { body: { ok: false, code: 'limit_reached', error: 'Track 10 max' } } : { body: { ok: true, message: `Added @${json.handle}` } });
    assert.equal((await client.api.addCustomAccount(' @Bob ')).message, 'Added @bob');
    assert.deepEqual(calls.at(-1).json, { handle: 'bob' }); assert.equal(calls.at(-1).headers['content-type'], 'application/json');
    await assert.rejects(client.api.addCustomAccount('full'), { name: 'JTrackerApiError', code: 'limit_reached', status: 200, message: 'Track 10 max' });
    await assert.rejects(client.api.addCustomAccount(' @ '), { code: 'invalid_handle' });

    route('POST', '/core/api/remove-account', ({ json }) => ({ body: { ok: true, action: json.handle === 'shared' ? 'hidden' : 'removed_custom' } }));
    assert.equal((await client.api.removeAccount('@Shared')).action, 'hidden');

    route('POST', '/core/api/accounts/available', ({ json }) => ({ body: { ok: true, added: json.handles } }));
    route('DELETE', '/core/api/accounts/available', () => ({ status: 429, body: {} }));
    assert.deepEqual((await client.api.addAvailableAccounts(['@A', 'a', 'b c'])).added, ['a', 'bc']);
    await assert.rejects(client.api.removeAvailableAccounts('a'), { code: 'rate_limited', status: 429, message: 'HTTP 429' });
    assert.equal(calls.at(-1).method, 'DELETE'); assert.deepEqual(calls.at(-1).json, { handles: ['a'] });

    route('POST', '/core/api/accounts/available/all', () => ({ body: { ok: true } }));
    await client.api.addAllAvailableAccounts();
    assert.equal(calls.at(-1).raw, ''); assert.equal(calls.at(-1).headers['content-type'], undefined);

    route('POST', '/core/api/accounts/import', ({ json }) => ({ body: { ok: true, imported: json.accounts } }));
    assert.deepEqual((await client.api.importAccounts(['one', '@Two', 'one'])).imported, ['one', 'two']);

    route('GET', '/core/api/watched-accounts', ({ url }) => ({ body: url.searchParams.get('fresh')
      ? { success: true, fresh: '1', hidden: ['@Zed'], feedPrefs: { noAutoAddMainFeed: true } } : { success: true, fresh: null } }));
    assert.equal((await client.api.getWatchedAccounts({ fresh: true })).fresh, '1');
    assert.deepEqual(client.hiddenAccounts, ['zed']); assert.equal(client.autoHideNewAccounts, true);
    assert.equal((await client.api.getWatchedAccounts()).fresh, null);
    assert.deepEqual(client.hiddenAccounts, ['zed'], 'a response without the section keeps state');

    route('GET', '/core/api/accounts/available', () => ({ status: 401, body: {} }));
    await assert.rejects(client.api.getAvailableAccounts(), { code: 'unauthorized', status: 401 });
  });

  await t.test('hidden accounts accept both list shapes and require ok:true', async () => {
    const client = tracker({ token: 'sess' });
    route('GET', '/core/api/hidden-accounts', () => ({ body: { ok: true, hidden: { x: ['@Bob', 'carol', 'bob'] } } }));
    assert.deepEqual(await client.api.getHiddenAccounts(), ['bob', 'carol']);
    assert.deepEqual(client.hiddenAccounts, ['bob', 'carol']);
    route('POST', '/core/api/hidden-accounts', ({ json }) => ({ body: json.handle === 'broken' ? { ok: false } : { ok: true, diverted: json.handle === 'mine' } }));
    assert.deepEqual(await client.api.setAccountHidden('@Mine', true), { diverted: true });
    assert.deepEqual(calls.at(-1).json, { handle: 'mine', hidden: true });
    await assert.rejects(client.api.setAccountHidden('broken', false), { code: 'http_error', message: 'save failed' });
    route('POST', '/core/api/hidden-accounts/batch', ({ json }) => ({ body: { ok: true, count: json.items.length } }));
    assert.equal((await client.api.setAccountsHidden([{ handle: '@X', hidden: true }, { handle: ' ', hidden: false }])).count, 1);
    assert.deepEqual(calls.at(-1).json, { items: [{ handle: 'x', hidden: true }] });
    const before = calls.length;
    assert.deepEqual(await client.api.setAccountsHidden([]), { ok: true, processed: 0 }); assert.equal(calls.length, before);
    client.handle('hidden_accounts_updated', { hidden: ['Dave'] }); assert.deepEqual(client.hiddenAccounts, ['dave']);
  });

  await t.test('feed settings, fee claims and source trackers use their own hosts and credentials', async () => {
    const client = tracker({ token: 'sess' });
    route('POST', '/main/api/feed/no-auto-add', ({ json }) => ({ body: json.noAutoAdd ? { success: true, noAutoAdd: true } : { success: false, error: 'Nope' } }));
    assert.equal(client.autoHideNewAccounts, null);
    assert.equal(await client.api.setAutoHideNewAccounts(true), true);
    assert.equal(client.autoHideNewAccounts, true);
    client.handle('main_feed_auto_add_updated', { success: true, noAutoAdd: false });
    assert.equal(client.autoHideNewAccounts, false);
    assert.equal(calls.at(-1).headers['x-session-id'], 'sess'); assert.deepEqual(calls.at(-1).json, { noAutoAdd: true });
    await assert.rejects(client.api.setAutoHideNewAccounts(false), { message: 'Nope' });
    route('POST', '/main/api/ai-suggestions-toggle', () => ({ body: {} }));
    await client.api.setAiSuggestions(false);
    assert.equal(calls.at(-1).headers.authorization, 'Bearer sess'); assert.equal(calls.at(-1).headers['x-session-id'], undefined);
    assert.deepEqual(calls.at(-1).json, { enabled: false });

    route('GET', '/main/api/wallet-tracker/list', () => ({ body: { max: 10, tracked: [{ github_user: 'Mint111' }, 'junk'] } }));
    assert.deepEqual(await client.api.getFeeClaimTracking(), { max: 10, tracked: [{ github_user: 'Mint111' }] });
    route('POST', '/main/api/wallet-tracker/track', ({ json }) => ({ body: { alreadyTracked: json.github_user === 'Mint111' } }));
    assert.equal((await client.api.trackFeeClaims(' Mint111 ')).alreadyTracked, true);
    await assert.rejects(client.api.trackFeeClaims('Mint222'), { message: 'Failed to track' });
    route('DELETE', '/main/api/wallet-tracker/untrack', () => ({ status: 404, body: { error: 'Not tracking this coin' } }));
    await client.api.untrackFeeClaims('Mint111');
    assert.deepEqual(calls.at(-1).json, { github_user: 'Mint111' });

    const lists = []; client.social.on('tracked', (kind, list) => lists.push([kind, list]));
    route('POST', '/wallets/api/telegram/add', ({ json }) => json.target === 'full'
      ? { status: 400, body: { error: 'Tracked telegram channel limit reached (30)' } } : { body: { telegram_channels: [{ handle: json.target }], limit: 30 } });
    const list = await client.api.track('telegram', ' t.me/alpha ');
    assert.deepEqual(list, { telegram_channels: [{ handle: 't.me/alpha' }], limit: 30 });
    assert.deepEqual(client.social.tracked.telegram, list); assert.deepEqual(lists, [['telegram', list]]);
    assert.equal(calls.at(-1).headers.authorization, 'Bearer sess');
    await assert.rejects(client.api.track('telegram', 'full'), { code: 'http_error', status: 400, message: /limit reached/ });
    route('GET', '/wallets/api/subdomain/list', () => ({ body: { domains: ['a.example'] } }));
    assert.deepEqual(await client.api.listTracked('subdomain'), { domains: ['a.example'], can_manage: false });
    await assert.rejects(client.api.track('myspace', 'x'), TypeError);
    await assert.rejects(client.api.untrack('pump', '  '), { code: 'invalid_target' });
  });

  await t.test('social socket authenticates, updates lists, forwards live events and fetches history', async () => {
    const client = tracker({ token: 'sess' });
    const tracked = event(client.social, 'tracked'), live = event(client.social, 'pump_event');
    const connected = event(client.social, 'connect'); client.social.connect(); await connected;
    assert.equal(socialPeers.at(-1).handshake.auth.token, 'sess');
    const [kind, list] = await tracked;
    assert.equal(kind, 'pump'); assert.deepEqual(list, { pump_users: [{ username: 'dev' }], limit: 50 });
    assert.deepEqual(client.social.tracked.pump, list);
    assert.deepEqual((await live)[0], { mint: 'Mint111' });
    assert.deepEqual(await client.social.history(25), [
      { event: 'telegram_event', channel: 'telegram_event', payload: { text: 'gm' } },
      { event: 'fomo_event', channel: 'mystery', payload: { a: 1 } },
    ]);
    assert.deepEqual(historyRequests.at(-1), { limit: 25 });
    await client.close();
    assert.equal(client.social.socket.connected, false);

    const denied = tracker({ token: 'bad' });
    const authError = event(denied.social, 'auth_error'); denied.social.connect();
    assert.deepEqual((await authError)[0], { error: 'Invalid token' });
    assert.equal(denied.social.socket.active, false);
    await denied.close();
  });
});

test('every REST endpoint, host and social event exists in the supplied bundle', async () => {
  // Read as text only. The site bundle is never evaluated or imported.
  const source = await readFile(new URL('../source.js', import.meta.url), 'utf8');
  for (const { path } of API_ENDPOINTS) assert.ok(source.includes(`"${path}"`) || source.includes(`}${path}\``), path);
  assert.ok(source.includes('Xe = "https://core.j7tracker.io"'));
  assert.ok(source.includes('Ue = "https://nj.j7tracker.io/wallets"'));
  assert.ok(source.includes('Re = `https://nyc.${window.location.hostname}`') && source.includes('ze = Re'));
  for (const name of [...SOCIAL_EVENTS, 'tracked_fomo', 'tracked_pump', 'tracked_telegram', 'tracked_subdomain']) {
    assert.ok(source.includes(`xh.on("${name}"`), name);
  }
  assert.ok(source.includes('"social_history"'));
});
