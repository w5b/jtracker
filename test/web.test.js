import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { findAddresses, safeUrl, socialPost, toActivity, toPost, trackedView } from '../web/posts.ts';
import { TrackerServer } from '../web/server.ts';
import { DemoTracker } from '../web/demo.ts';
import { JTrackerApiError } from '../src/jtracker-api.ts';
import { normalizeTweet } from '../src/jtracker-model.ts';

const SOL = 'EnoG2vyGRZn38E9bvW5Pb3tgaKXZZSRBBHWdBgZSpump';
const EVM = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';

test('tweets become cards with safe links, token data, snowflake time and detected addresses', () => {
  // 1790000000000 ms, encoded as an X snowflake.
  const id = ((1790000000000n - 1288834974657n) << 22n).toString();
  const tweet = normalizeTweet({
    id, text: `new CA ${SOL} and ${EVM} https://example.com/${SOL}`, createdAt: '2026-09-20T00:00:00Z',
    author: { handle: 'alice', name: 'Alice', avatar: 'javascript:alert(1)', verified: true },
    media: { images: ['https://pbs.twimg.com/a.jpg', 'data:image/png;base64,AAA'], videos: [{ url: 'https://video.twimg.com/v.mp4', thumbnail: 'https://pbs.twimg.com/t.jpg' }] },
    isQuote: true, type: 'QUOTE', quotedTweet: { id: '99', text: 'quoted', author: { handle: 'bob' } },
    tokenMeta: { [EVM]: { mint: EVM, symbol: 'PEPE', name: 'Pepe', marketCapUsd: '1500000', image: 'ftp://nope' } },
    aiSuggestion: { prediction: 'Moon Cat', ticker: '$mcat' }, isCustomAccount: true,
    card: { url: 'https://example.com/story', title: 'Story', image: 'https://example.com/i.png' },
  });
  const post = toPost(tweet, 1790000001500);
  assert.equal(post.createdAt, 1790000000000); assert.equal(post.receivedAt, 1790000001500);
  assert.equal(post.url, `https://x.com/alice/status/${id}`);
  assert.equal(post.author.avatar, ''); assert.equal(post.author.verified, true);
  assert.deepEqual(post.media.images, ['https://pbs.twimg.com/a.jpg']);
  assert.deepEqual(post.media.videos, [{ url: 'https://video.twimg.com/v.mp4', poster: 'https://pbs.twimg.com/t.jpg' }]);
  assert.equal(post.kind, 'quote'); assert.equal(post.quoted.url, 'https://x.com/bob/status/99');
  assert.deepEqual(post.tokens, [{ mint: EVM, chain: 'evm', symbol: 'PEPE', name: 'Pepe', image: '', marketCapUsd: 1500000, liquidityUsd: 0 }]);
  assert.deepEqual(post.addresses, [SOL], 'known mints and addresses inside links are not repeated');
  assert.deepEqual(post.ai, { name: 'Moon Cat', ticker: 'MCAT' });
  assert.equal(post.custom, true); assert.equal(post.card.title, 'Story');

  const external = toPost(normalizeTweet({ id: 'ig-1', text: 'hi', isInstagram: true, instagramUrl: 'https://instagram.com/p/abc', author: { handle: 'carol' }, created_at: 1790000000 }), 5);
  assert.equal(external.source, 'instagram'); assert.equal(external.url, 'https://instagram.com/p/abc');
  assert.equal(external.createdAt, 1790000000000, 'second timestamps are scaled');
  assert.equal(safeUrl(' https://x.com/a '), 'https://x.com/a'); assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.deepEqual(findAddresses('allLowercaseWordsThatAreQuiteLongButNotAddressesxx 0xABC'), []);
});

test('source events use the site conversions and ignore kinds it ignores', () => {
  const at = 1790000000000;
  assert.deepEqual(socialPost('pump_event', { kind: 'trade', data: { tx: 't1', side: 'sell', usdAmount: 1234.4, token: { symbol: 'CAT', address: SOL }, author: { wallet: 'Wallet111111111111111111111111111111111' }, timestamp: at } }, 1),
    { id: 'pump-t1', source: 'pump', kind: 'trade', createdAt: at, receivedAt: 1, author: { name: 'Wall…1111', handle: 'Wallet111111111111111111111111111111111', avatar: '', verified: false },
      text: 'Sold $1,234 of $CAT', url: '', media: { images: [], videos: [] }, quoted: null, replyTo: '', repostOf: null, card: null,
      tokens: [{ mint: SOL, chain: 'sol', symbol: 'CAT', name: '', image: '', marketCapUsd: 0, liquidityUsd: 0 }], addresses: [], ai: null, matches: [], deleted: false, custom: false });
  const telegram = socialPost('telegram_event', { kind: 'message', received_at: at, data: { id: 7, channel: { title: 'Calls', username: 'calls' }, text: `buy ${SOL}` } }, 1);
  assert.equal(telegram.id, 'tg-7'); assert.equal(telegram.createdAt, at); assert.equal(telegram.author.handle, 'calls'); assert.deepEqual(telegram.addresses, [SOL]);
  assert.equal(socialPost('telegram_event', { kind: 'media', data: { id: 7 } }, 1), null);
  assert.equal(socialPost('subdomain_event', { kind: 'removed', data: { id: 's', host: 'app.example.com' } }, 1).text, 'app.example.com stopped resolving');
  assert.equal(socialPost('pump_news_event', { data: { articleId: 'n', headline: 'Listing', token: { symbol: 'CAT' } } }, 1).text, 'Listing — $CAT');
  assert.equal(socialPost('fomo_event', { kind: 'new_account', data: { userId: 'u', userHandle: 'dana', smartFollowerCount: 12 } }, 1).text, '@dana joined Fomo — 12 smart followers');
  assert.equal(socialPost('fomo_event', { kind: 'thesis', data: { id: 'th', thesis: 'Undervalued', userHandle: 'dana' } }, 1).text, 'Undervalued');
  assert.equal(socialPost('fomo_event', { kind: 'thesis_context', data: { thesisId: 'th' } }, 1), null);
  assert.equal(socialPost('pump_event', { kind: 'callout', data: {} }, 1), null, 'events without an id are dropped');

  assert.deepEqual(trackedView('pump', { pump_users: [{ wallet: 'W1', username: 'dev' }, { username: 'no wallet' }], limit: 50 }),
    { kind: 'pump', items: [{ id: 'W1', label: 'dev', detail: '@dev', avatar: '' }], limit: 50, canManage: true });
  assert.equal(trackedView('subdomain', { domains: ['a.example'] }).canManage, false);
  assert.equal(trackedView('fomo', { fomo_users: [{ fomo_user_id: 'f1', handle: 'dana' }] }).items[0].id, 'f1');
  assert.equal(trackedView('telegram', { telegram_channels: [{ channel: '-100', title: 'Calls' }] }).items[0].id, '-100');
  assert.equal(toActivity({ id: 'a', event: 'following_update', receivedAt: 1, author: { handle: 'a', name: 'A', avatar: null }, target: { handle: 'b', name: 'B', avatar: null }, raw: {} }).text, '@a followed @b');
});

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
/** Reads server-sent events until `until` returns true for one of them. */
function stream(url, until, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(url, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const event = block.match(/^event: (.+)$/m)?.[1], data = block.match(/^data: (.+)$/m)?.[1];
          if (!event) continue;
          events.push({ event, data: JSON.parse(data) });
          if (until(events.at(-1), events)) { clearTimeout(timer); req.destroy(); resolve(events); }
        }
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`stream timeout; saw ${events.map(e => e.event)}`)); }, timeoutMs);
    req.on('error', error => { if (!req.destroyed) reject(error); });
  });
}

test('web server: static page, local-only guards, stream and account actions', { timeout: 15_000 }, async t => {
  const demo = new DemoTracker(), logs = [], sessions = [];
  demo.token = undefined; // start signed out, as with no JTRACKER_TOKEN and no saved session
  // Keep the fictional feed quiet so the test drives every packet itself.
  demo.connect = () => { demo.socket.connected = true; demo.emit('connect'); return demo; };
  const server = new TrackerServer(demo, {
    mode: 'demo', region: 'NY', port: 0, log: (...args) => logs.push(args.join(' ')),
    onSignIn: (token, remember) => sessions.push(['in', token, remember]), onSignOut: () => sessions.push(['out']),
    onTokenRotated: token => sessions.push(['rotated', token]),
  });
  const base = await server.listen();
  server.start();
  t.after(async () => { await server.close(); await demo.close(); });
  const origin = { Origin: base, 'Content-Type': 'application/json' };
  const post = (path, body, headers = origin) => request(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const state = async () => (await request(`${base}/api/state`)).json;
  const until = async check => { for (let i = 0; i < 50 && !check(await state()); i++) await new Promise(resolve => setTimeout(resolve, 20)); return state(); };

  const page = await request(`${base}/`);
  assert.equal(page.status, 200); assert.match(page.text, /<title>JTracker<\/title>/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.equal((await request(`${base}/app.js`)).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await request(`${base}/../package.json`)).status, 404);

  // DNS rebinding and cross-site requests are refused.
  assert.equal((await request(`${base}/api/state`, { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await post('/api/accounts/add', { handle: 'x' }, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post('/api/accounts/add', { handle: 'x' }, { ...origin, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/accounts/add', { handle: 'x' }, { Origin: base, 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(`${base}/api/accounts/add`, { method: 'POST', headers: origin, body: '[1]' })).status, 400);
  assert.equal((await request(`${base}/api/accounts/add`, { method: 'POST', headers: origin, body: JSON.stringify({ handle: 'x'.repeat(20_000) }) })).status, 413);

  // Signed out: the feed streams without a session, account actions are refused, and the page can sign in.
  let snapshot = await state();
  assert.deepEqual([snapshot.status.session, snapshot.status.feed, snapshot.status.social, snapshot.accounts.custom], ['signed-out', 'live', 'off', null]);
  assert.equal(demo.socket.connected, true); assert.equal(demo.social.socket.connected, false);
  assert.deepEqual((await post('/api/accounts/add', { handle: 'x' })).json, { ok: false, error: 'Sign in to j7tracker first' });
  assert.equal((await post('/api/refresh', {})).status, 401);
  assert.equal((await post('/api/session', { token: '  ' })).status, 400);
  assert.equal((await post('/api/session', { token: 'has spaces' })).status, 400);
  const checkSession = demo.api.checkSession;
  demo.api.checkSession = async () => { throw new JTrackerApiError('Invalid token', { code: 'unauthorized', status: 401 }); };
  const refused = await post('/api/session', { token: 'expired-session' });
  assert.equal(refused.status, 401); assert.match(refused.json.error, /rejected this session ID/);
  assert.equal(demo.token, undefined); assert.equal((await state()).status.session, 'signed-out');
  demo.api.checkSession = checkSession;
  const signIn = await post('/api/session', { token: 'good-session', remember: false });
  assert.deepEqual(signIn.json, { ok: true, message: 'Signed in as @demo_user' });
  assert.equal(demo.token, 'good-session'); assert.equal(demo.socket.connected, true);
  // A bad paste while signed in keeps the working session.
  demo.api.checkSession = async () => { if (demo.token === 'typo') throw new JTrackerApiError('Invalid token', { code: 'unauthorized', status: 401 }); return checkSession(); };
  assert.equal((await post('/api/session', { token: 'typo' })).status, 401);
  assert.equal(demo.token, 'good-session'); assert.equal((await state()).status.session, 'signed-in');
  // Rotations of a signed-in session are reported for saving; tokens set by the server are not.
  demo.token = 'good-session-2'; demo.emit('token', 'good-session-2');
  snapshot = await until(value => value.accounts.custom);
  assert.deepEqual([snapshot.status.session, snapshot.status.username], ['signed-in', 'demo_user']);
  assert.deepEqual(snapshot.accounts.custom.accounts.slice(0, 2), ['demo_alpha', 'demo_charts']);
  assert.equal(snapshot.tracked.find(view => view.kind === 'telegram').items[0].id, 'demo_calls');

  const live = stream(`${base}/api/stream`, event => event.event === 'post');
  await new Promise(resolve => setTimeout(resolve, 100));
  demo.handle('tweet', { id: '1901', text: `call ${SOL}`, author: { handle: 'demo_alpha', name: 'Alpha' }, createdAt: Date.now() });
  const events = await live;
  assert.equal(events[0].event, 'snapshot'); assert.equal(events[0].data.status.mode, 'demo');
  assert.equal(events.at(-1).data.action, 'new'); assert.deepEqual(events.at(-1).data.post.addresses, [SOL]);
  assert.equal((await state()).posts.length, 1);

  const added = stream(`${base}/api/stream`, event => event.event === 'accounts');
  await new Promise(resolve => setTimeout(resolve, 100));
  const add = await post('/api/accounts/add', { handle: '@Demo_New' });
  assert.deepEqual(add.json, { ok: true, message: 'Added @demo_new' });
  assert.ok((await added).at(-1).data.custom.accounts.includes('demo_new'));
  assert.equal((await post('/api/accounts/add', { handle: ' ' })).status, 400);
  assert.match((await post('/api/accounts/remove', { handle: 'someone_else' })).json.message, /hidden instead/);
  assert.equal((await post('/api/accounts/hidden', { handle: '@someone_else', hidden: false })).json.message, '@someone_else is visible again');
  assert.deepEqual((await post('/api/tracked', { kind: 'telegram', target: 'demo_more' })).json, { ok: true, message: 'Tracking demo_more' });
  assert.equal((await post('/api/tracked', { kind: 'myspace', target: 'x' })).status, 400);
  assert.equal((await post('/api/tracked', { kind: 'subdomain', target: 'a.example' })).status, 502);
  assert.deepEqual((await post('/api/settings', { autoHide: true, aiSuggestions: false })).json.settings, { aiSuggestions: false, autoHide: true });

  // Upstream errors keep their code; validation errors map to 400.
  const addCustomAccount = demo.api.addCustomAccount;
  demo.api.addCustomAccount = async () => { throw new JTrackerApiError('Track 25 max', { code: 'limit_reached', status: 200 }); };
  assert.deepEqual((await post('/api/accounts/add', { handle: 'full' })).json, { ok: false, error: 'Track 25 max', code: 'limit_reached' });
  assert.equal((await post('/api/accounts/add', { handle: 'full' })).status, 502);
  demo.api.addCustomAccount = addCustomAccount;
  assert.equal((await post('/api/nope', {})).status, 404);

  // Signing out drops the token, account state and source socket, and the feed carries on without a session.
  assert.deepEqual((await post('/api/session/signout', {})).json, { ok: true, message: 'Signed out' });
  snapshot = await state();
  assert.deepEqual([snapshot.status.session, snapshot.status.feed, snapshot.status.social, snapshot.accounts.custom, snapshot.posts.length], ['signed-out', 'live', 'off', null, 1]);
  assert.equal(demo.token, undefined); assert.equal(demo.socket.connected, true); assert.equal(demo.social.socket.connected, false);
  // If j7tracker ever refuses the feed without a session, it stops and says so instead of signing out again.
  demo.emit('auth_error', { error: 'Invalid token' });
  snapshot = await state();
  assert.deepEqual([snapshot.status.session, snapshot.status.feed], ['signed-out', 'offline']);
  assert.match(snapshot.status.error, /without a session/);
  assert.equal(snapshot.tracked.find(view => view.kind === 'telegram').items.length, 0);
  // A socket-level rejection while signed in signs out the same way, and the feed reconnects without the session.
  await post('/api/session', { token: 'another-session' });
  assert.equal((await state()).status.feed, 'live');
  demo.emit('auth_error', { error: 'Invalid token' });
  snapshot = await until(value => value.status.session === 'signed-out');
  assert.deepEqual([snapshot.status.session, snapshot.status.feed], ['signed-out', 'live']);
  assert.deepEqual(sessions, [['in', 'good-session', false], ['rotated', 'good-session-2'], ['out'], ['in', 'another-session', true], ['out']]);
  assert.deepEqual(logs.filter(line => !line.startsWith('[session]')), []);
});

test('web server: signed out, AI suggestions become cards until their post arrives', { timeout: 10_000 }, async t => {
  const demo = new DemoTracker();
  demo.token = undefined;
  demo.connect = () => { demo.socket.connected = true; demo.emit('connect'); return demo; };
  const server = new TrackerServer(demo, { mode: 'demo', region: 'NY', port: 0, log: () => {} });
  const base = await server.listen();
  server.start();
  t.after(async () => { await server.close(); await demo.close(); });
  const posts = async () => (await request(`${base}/api/state`)).json.posts;
  const sid = ((1790000000000n - 1288834974657n) << 22n).toString(), other = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
  const image = `https://axiomtrading-v2.axiom-cdn.io/${SOL}.webp`;

  demo.handle('ai_suggestion_update', { tweet_id: sid, results: [{ name: 'Moon⁠', symbol: 'MOON', image }] });
  assert.equal((await posts()).length, 0, 'matches wait for their suggestion');
  // Shape taken from a real signed-out packet, including the U+2060 marks in names.
  demo.handle('ai_suggestion', { tweet_url: `https://twitter.com/keenn_eth/status/${sid}`, tweet_id: sid, prediction: "I'm Broke⁠", ticker: "I'M BROKE⁠",
    ai_ticker: 'BROKE⁠', image_url: 'https://pbs.twimg.com/media/x.jpg', backup_suggestion: false, pair: null });
  let [card] = await posts();
  assert.deepEqual({ kind: card.kind, handle: card.author.handle, url: card.url, createdAt: card.createdAt, ai: card.ai, images: card.media.images },
    { kind: 'suggestion', handle: 'keenn_eth', url: `https://x.com/keenn_eth/status/${sid}`, createdAt: 1790000000000, ai: { name: "I'm Broke", ticker: "I'M BROKE" }, images: ['https://pbs.twimg.com/media/x.jpg'] });
  assert.deepEqual(card.matches, [{ mint: SOL, symbol: 'MOON', name: 'Moon', image }], 'the mint comes from the token image name');
  demo.handle('ai_suggestion_update', { tweet_id: sid, results: [{ name: 'Moon', symbol: 'MOON', image }, { name: 'Other', symbol: '$OTHER', url: `https://pump.fun/coin/${other}` }] });
  [card] = await posts();
  assert.deepEqual(card.matches.map(match => [match.symbol, match.mint]), [['MOON', SOL], ['OTHER', other]]);

  // When the post itself arrives it replaces the card, keeping the suggestion, matches and arrival time.
  demo.handle('tweet', { id: sid, text: 'broke again', author: { handle: 'keenn_eth', name: 'Keen' } });
  const [post] = await posts();
  assert.deepEqual([post.kind, post.text, post.ai.ticker, post.matches.length, post.receivedAt], ['post', 'broke again', "I'M BROKE", 2, card.receivedAt]);
  // A suggestion for a post that is already here updates the post instead of adding a card.
  demo.handle('ai_suggestion', { tweet_id: sid, prediction: 'Second idea', ticker: 'IDEA' });
  const all = await posts();
  assert.equal(all.length, 1); assert.equal(all[0].ai.ticker, 'IDEA');
});
