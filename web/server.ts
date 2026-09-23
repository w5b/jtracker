import http from 'node:http';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventEmitter } from 'node:events';
import JTracker, { JTrackerApiError, SOCIAL_EVENTS, SOCIAL_TRACKERS, type Region } from '../JTracker.ts';
import type { JTrackerFeed } from '../src/jtracker-feed.ts';
import type { JTrackerAPI, SocialTracker } from '../src/jtracker-api.ts';
import type { JTrackerSocialEvents, SocialHistoryEntry } from '../src/jtracker-social.ts';
import { describeSocketError } from '../src/socketio.js';
import { string, type Data } from '../src/jtracker-model.ts';
import { matchesOf, socialPost, suggestionPost, toActivity, toPost, trackedView } from './posts.ts';
import type { FeedActivity, Post, TokenMatch, TrackedView } from './posts.ts';

/** The part of JTracker the web server uses. DemoTracker implements it without a network. */
export type TrackerApi = Pick<JTrackerAPI, 'checkSession' | 'getCustomAccounts' | 'getWatchedAccounts' | 'getHiddenAccounts'
  | 'addCustomAccount' | 'removeAccount' | 'setAccountHidden' | 'listTracked' | 'track' | 'untrack' | 'setAiSuggestions' | 'setAutoHideNewAccounts'>;
export interface TrackerLike extends JTrackerFeed {
  readonly api: TrackerApi;
  /** Session token. Setting it applies to the next request and the next connect. */
  token: string | undefined;
  connect(): unknown;
  disconnect(): unknown;
  readonly social: EventEmitter<JTrackerSocialEvents> & {
    readonly tracked: Record<SocialTracker, Data>;
    connect(): unknown;
    disconnect(): unknown;
    setTracked(kind: SocialTracker, value: unknown): void;
    history(limit?: number): Promise<SocialHistoryEntry[]>;
  };
  close(): Promise<void>;
}
export interface ServerOptions {
  mode: 'live' | 'demo';
  region: string;
  port?: number;
  maxPosts?: number;
  log?: (...args: unknown[]) => void;
  /** After a sign-in from the page is accepted. `remember` is the page's checkbox. */
  onSignIn?: (token: string, remember: boolean) => unknown;
  /** After signing out from the page, or when j7tracker rejects the session. */
  onSignOut?: () => unknown;
  /** When j7tracker rotates the token of a signed-in session. The old one may stop working. */
  onTokenRotated?: (token: string) => unknown;
}
type Connection = 'off' | 'connecting' | 'live' | 'reconnecting' | 'offline';
type SessionState = 'signed-out' | 'checking' | 'signed-in';
interface Status { session: SessionState; feed: Connection; social: Connection; username: string; error: string }
const REJECTED = 'j7tracker rejected this session ID. Sign in again with a fresh one.';
const DISABLED = 'j7tracker says this account is disabled.';
const FEED_REFUSED = 'j7tracker did not send the feed without a session. Sign in to stream it.';
const AUTH_ERRORS = new Set(['Invalid token', 'Account disabled']);
/** The site treats a 401 from its session check as signed out; invalid-token messages count too. */
const rejected = (error: unknown) => error instanceof JTrackerApiError
  && (error.code === 'unauthorized' || error.code === 'no_session' || /invalid (token|session)/i.test(error.message));

const PUBLIC = resolve(fileURLToPath(new URL('.', import.meta.url)), 'public');
const FILES: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
// Images and video come straight from the platforms' CDNs; everything else is this server.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; media-src https:; "
  + "connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
async function readJson(req: http.IncomingMessage, limit = 16 * 1024): Promise<Data> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch { throw new RequestError(400, 'Expected a JSON object'); }
}
const sourceKind = (value: unknown): SocialTracker => {
  if ((SOCIAL_TRACKERS as readonly string[]).includes(value as string)) return value as SocialTracker;
  throw new RequestError(400, 'Unknown source type');
};

/**
 * Serves the browser UI on 127.0.0.1 and relays the tracker to it. The browser never sees the
 * session token: it reads a server-sent event stream and asks this server to run account actions.
 */
export class TrackerServer {
  readonly server: http.Server;
  private readonly tracker: TrackerLike;
  private readonly options: Required<Pick<ServerOptions, 'mode' | 'region' | 'port' | 'maxPosts'>> & ServerOptions;
  private readonly posts = new Map<string, Post>();
  private readonly clients = new Set<http.ServerResponse>();
  private activities: FeedActivity[] = [];
  private status: Status = { session: 'signed-out', feed: 'off', social: 'off', username: '', error: '' };
  private aiSuggestions: boolean | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;
  private port = 0;
  private settingToken = false;
  /** Launched-token matches that arrived before their suggestion, by post ID. */
  private readonly pendingMatches = new Map<string, TokenMatch[]>();

  constructor(source: TrackerLike, options: ServerOptions) {
    this.tracker = source;
    this.options = { port: 5177, maxPosts: 400, ...options };
    this.server = http.createServer((req, res) => void this.route(req, res).catch(error => this.fail(res, error)));
    this.wire();
  }

  private log(...args: unknown[]): void { (this.options.log ?? console.log)(...args); }
  private wire(): void {
    const { tracker } = this;
    tracker.on('feed', change => {
      if (change.kind === 'activity') {
        const activity = toActivity(change.item);
        this.activities = [activity, ...this.activities.filter(item => item.id !== activity.id)].slice(0, 100);
        return this.broadcast('activity', activity);
      }
      this.upsert(toPost(change.item, Date.now()));
    });
    tracker.on('initialTweets', tweets => {
      // Reconnect history refreshes known posts in place and adds older ones below.
      const posts = tweets.map(tweet => toPost(tweet, 0)).map(post => ({ ...post, receivedAt: this.posts.get(post.id)?.receivedAt ?? post.createdAt }));
      for (const post of posts) this.store(post);
      this.broadcast('posts', posts);
    });
    tracker.on('connect', () => this.setStatus({ feed: 'live', error: '' }));
    tracker.on('disconnect', reason => this.setStatus({ feed: reason === 'io client disconnect' ? 'off' : 'reconnecting' }));
    tracker.on('connect_error', error => {
      // Refusals arrive as auth_error first; an intentionally closed feed stays off.
      if (AUTH_ERRORS.has(error.message) || this.status.feed === 'off' || this.status.feed === 'offline') return;
      this.setStatus({ feed: 'reconnecting', error: describeSocketError(error) });
    });
    // A refused session signs out and the feed carries on without one. A refused tokenless feed stops.
    tracker.on('auth_error', payload => {
      if (this.status.session !== 'signed-out') void this.signOut(string(payload.error) === 'Account disabled' ? DISABLED : REJECTED);
      else this.setStatus({ feed: 'offline', error: FEED_REFUSED });
    });
    for (const event of ['custom_accounts_list', 'hidden_accounts_updated'] as const) tracker.on(event, () => this.broadcast('accounts', this.accounts()));
    tracker.on('main_feed_auto_add_updated', () => this.broadcast('settings', this.settings()));
    // Without a session the feed carries AI suggestions but not the posts they belong to. Show
    // each as a card until its post arrives; a post that is already here carries its own suggestion.
    const postId = (payload: Data) => string(payload.tweet_id) || /\/status(?:es)?\/(\d+)/.exec(string(payload.tweet_url))?.[1] || '';
    tracker.on('ai_suggestion', payload => {
      const id = postId(payload);
      if (!id || tracker.getTweet(id)) return;
      const post = suggestionPost(payload, Date.now(), this.pendingMatches.get(id) ?? this.posts.get(id)?.matches ?? []);
      this.pendingMatches.delete(id);
      if (post) this.upsert(post);
    });
    tracker.on('ai_suggestion_update', payload => {
      const id = postId(payload), existing = this.posts.get(id);
      if (!id || tracker.getTweet(id)) return;
      if (existing?.kind === 'suggestion') return this.upsert({ ...existing, matches: matchesOf([...existing.matches, ...(Array.isArray(payload.results) ? payload.results : [])]) });
      this.pendingMatches.set(id, matchesOf([...(this.pendingMatches.get(id) ?? []), ...(Array.isArray(payload.results) ? payload.results : [])]));
      while (this.pendingMatches.size > 500) this.pendingMatches.delete(this.pendingMatches.keys().next().value!);
    });
    // Rotations come from j7tracker responses; tokens this server sets itself are not rotations.
    tracker.on('token', token => { if (token && !this.settingToken && this.status.session === 'signed-in') void this.options.onTokenRotated?.(token); });

    const { social } = tracker;
    social.on('connect', () => {
      this.setStatus({ social: 'live' });
      // Backfill recent source events, as the site does when its social view opens.
      social.history(200).then(entries => {
        const posts = entries.map(entry => socialPost(entry.event, entry.payload, Date.now())).filter((post): post is Post => !!post)
          .map(post => ({ ...post, receivedAt: this.posts.get(post.id)?.receivedAt ?? post.createdAt }));
        for (const post of posts) this.store(post);
        if (posts.length) this.broadcast('posts', posts);
      }, error => this.log(`[ui] source history unavailable: ${error.message}`));
    });
    social.on('disconnect', reason => this.setStatus({ social: reason === 'io client disconnect' ? 'off' : 'reconnecting' }));
    social.on('auth_error', () => this.setStatus({ social: 'offline' }));
    social.on('tracked', kind => this.broadcast('tracked', this.trackedView(kind)));
    for (const event of SOCIAL_EVENTS) {
      social.on(event, payload => { const post = socialPost(event, payload, Date.now()); if (post) this.upsert(post); });
    }
  }

  private store(post: Post): void {
    this.posts.set(post.id, post);
    while (this.posts.size > this.options.maxPosts) this.posts.delete(this.posts.keys().next().value!);
  }
  private upsert(post: Post): void {
    const previous = this.posts.get(post.id);
    if (previous) post.receivedAt = previous.receivedAt;
    this.store(post);
    this.broadcast('post', { action: previous ? 'update' : 'new', post });
  }
  private setStatus(patch: Partial<Status>): void {
    this.status = { ...this.status, ...patch };
    this.broadcast('status', this.statusView());
  }
  private statusView() {
    return { ...this.status, mode: this.options.mode, region: this.options.region };
  }
  private accounts() {
    const custom = this.tracker.customAccounts;
    return {
      custom: custom ? { accounts: custom.accounts, available: custom.availableAccounts, max: custom.maxAccounts, used: custom.deployCount } : null,
      hidden: this.tracker.hiddenAccounts,
    };
  }
  private settings() {
    return { aiSuggestions: this.aiSuggestions, autoHide: this.tracker.autoHideNewAccounts };
  }
  private trackedView(kind: SocialTracker): TrackedView { return trackedView(kind, this.tracker.social.tracked[kind]); }
  snapshot() {
    return {
      status: this.statusView(), settings: this.settings(), accounts: this.accounts(),
      tracked: SOCIAL_TRACKERS.map(kind => this.trackedView(kind)),
      posts: [...this.posts.values()], activities: this.activities,
    };
  }

  private broadcast(event: string, data: unknown): void {
    if (!this.clients.size) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(chunk);
  }
  private notice(level: 'info' | 'error', message: string): void { this.broadcast('notice', { level, message }); }

  // Session -----------------------------------------------------------------

  private setToken(token: string | undefined): void {
    this.settingToken = true;
    try { this.tracker.token = token; } finally { this.settingToken = false; }
  }
  /** Drops the previous account's lists and settings. Posts already shown stay. */
  private clearAccountState(): void {
    const { tracker } = this;
    tracker.customAccounts = null; tracker.hiddenAccounts = []; tracker.autoHideNewAccounts = null;
    for (const kind of SOCIAL_TRACKERS) tracker.social.setTracked(kind, {});
    this.aiSuggestions = null;
    this.broadcast('accounts', this.accounts());
    this.broadcast('settings', this.settings());
  }
  /**
   * Checks the tracker's token unless `username` says it was just checked, then reconnects the
   * feed with the session, connects the source socket and loads account data.
   */
  private async activate(username?: string): Promise<boolean> {
    const { tracker } = this;
    if (!tracker.token) return false;
    if (username === undefined) {
      this.setStatus({ session: 'checking', error: '' });
      try { username = (await tracker.api.checkSession()).username; }
      catch (error) {
        if (rejected(error)) { await this.signOut(REJECTED); return false; }
        // Network trouble says nothing about the session, so connect and report it.
        this.notice('error', `Could not verify your session, connecting anyway: ${(error as Error).message}`);
        username = '';
      }
    }
    this.status.username = username;
    tracker.disconnect(); // the feed may be up without a session; reconnect it with one
    this.setStatus({ session: 'signed-in', feed: 'connecting', social: 'connecting', error: '' });
    tracker.connect();
    tracker.social.connect();
    void this.loadAccountData();
    return true;
  }
  /** Forgets the token and clears account state, then keeps the feed going without a session. */
  private async signOut(reason: string): Promise<void> {
    const { tracker } = this, wasSignedIn = this.status.session !== 'signed-out' || !!tracker.token;
    if (reason) { this.log(`[session] ${reason}`); this.notice('error', reason); }
    tracker.disconnect();
    tracker.social.disconnect();
    this.setToken(undefined);
    this.setStatus({ session: 'signed-out', social: 'off', username: '', error: reason });
    this.clearAccountState();
    this.connectSignedOut();
    if (wasSignedIn) await this.options.onSignOut?.();
  }
  /** The feed streams without a session; accounts, sources and settings need one. */
  private connectSignedOut(): void {
    this.setStatus({ feed: 'connecting' });
    this.tracker.connect();
  }
  /** Loads account state, settings and source lists. Failures are reported, not thrown. */
  private async loadAccountData(): Promise<void> {
    const { api } = this.tracker;
    const results = await Promise.allSettled([api.getCustomAccounts(), api.getWatchedAccounts(), ...SOCIAL_TRACKERS.map(kind => api.listTracked(kind))]);
    if (this.status.session !== 'signed-in') return;
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    for (const { reason } of failed) this.log(`[ui] account data: ${reason instanceof Error ? reason.message : reason}`);
    if (failed.length) this.notice('error', `Some account data did not load: ${(failed[0]!.reason as Error)?.message ?? 'unknown error'}`);
    this.broadcast('accounts', this.accounts());
    this.broadcast('settings', this.settings());
  }
  /** Re-checks the session and reloads account data. */
  async refresh(): Promise<void> {
    if (this.status.session !== 'signed-in') return;
    try { this.status.username = (await this.tracker.api.checkSession()).username; }
    catch (error) { if (rejected(error)) return this.signOut(REJECTED); }
    this.broadcast('status', this.statusView());
    await this.loadAccountData();
  }
  /** Signs in with the tracker's token if it has one, otherwise streams the feed signed out. */
  start(): void {
    if (this.tracker.token) void this.activate();
    else this.connectSignedOut();
  }

  async listen(host = '127.0.0.1'): Promise<string> {
    await new Promise<void>((resolveListen, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, host, () => { this.server.off('error', reject); resolveListen(); });
    });
    this.port = (this.server.address() as { port: number }).port;
    this.heartbeat = setInterval(() => { for (const client of this.clients) client.write(': ping\n\n'); }, 15_000);
    this.heartbeat.unref();
    return `http://127.0.0.1:${this.port}`;
  }
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
    await new Promise<void>(done => this.server.close(() => done()));
  }

  // HTTP ---------------------------------------------------------------------

  /** Host allowlist blocks DNS rebinding; the Origin check blocks other sites posting here. */
  private local(value: string | undefined, scheme = ''): boolean {
    return !!value && [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`].some(host => value === `${scheme}${host}`);
  }
  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  }
  private fail(res: http.ServerResponse, error: unknown): void {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof RequestError) return this.json(res, error.status, { ok: false, error: error.message });
    if (error instanceof JTrackerApiError) {
      const status = error.code === 'no_session' || error.code === 'unauthorized' ? 401 : ['invalid_handle', 'invalid_target'].includes(error.code) ? 400 : 502;
      return this.json(res, status, { ok: false, error: error.message, code: error.code });
    }
    if (error instanceof TypeError) return this.json(res, 400, { ok: false, error: error.message });
    this.log('[ui] request failed:', error);
    this.json(res, 500, { ok: false, error: 'Internal error' });
  }
  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.local(req.headers.host)) return this.json(res, 403, { ok: false, error: 'Unknown host' });
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' || req.method === 'HEAD') {
      const file = FILES[path === '/index.html' ? '/' : path];
      if (file) {
        // Read per request so edits to web/public show up on reload without a restart.
        const content = await readFile(resolve(PUBLIC, file[0]));
        res.writeHead(200, {
          'Content-Type': file[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          ...(file[0] === 'index.html' ? { 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' } : {}),
        });
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
      }
      if (path === '/api/state') return this.json(res, 200, this.snapshot());
      if (path === '/api/stream') return this.stream(req, res);
      return this.json(res, 404, { ok: false, error: 'Not found' });
    }
    if (req.method !== 'POST') return this.json(res, 405, { ok: false, error: 'Method not allowed' });
    if (!this.local(req.headers.origin, 'http://')) return this.json(res, 403, { ok: false, error: 'Cross-origin request refused' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return this.json(res, 415, { ok: false, error: 'Expected application/json' });
    const body = await readJson(req);
    this.json(res, 200, { ok: true, ...await this.action(path, body) });
  }
  private stream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }
  private async action(path: string, body: Data): Promise<Data> {
    const { api } = this.tracker;
    if (path === '/api/session') {
      const token = string(body.token).trim();
      if (!token) throw new RequestError(400, 'Paste your session ID');
      if (token.length > 1024 || /\s/.test(token)) throw new RequestError(400, 'That does not look like a session ID');
      // Verify before switching, so a bad paste keeps the session you already have.
      const previous = this.tracker.token;
      this.setToken(token);
      let username: string;
      try { username = (await api.checkSession()).username; }
      catch (error) {
        this.setToken(previous);
        if (rejected(error)) throw new RequestError(401, REJECTED);
        throw error;
      }
      const verified = this.tracker.token ?? token; // the check may have rotated it
      this.tracker.social.disconnect();
      this.clearAccountState();
      await this.activate(username);
      await this.options.onSignIn?.(verified, body.remember !== false);
      return { message: username ? `Signed in as @${username}` : 'Signed in' };
    }
    if (path === '/api/session/signout') { await this.signOut(''); return { message: 'Signed out' }; }
    if (this.status.session !== 'signed-in') throw new RequestError(401, 'Sign in to j7tracker first');
    const handle = () => { const value = string(body.handle).trim(); if (!value) throw new RequestError(400, 'Enter an account handle'); return value; };
    switch (path) {
      case '/api/accounts/add': {
        const result = await api.addCustomAccount(handle());
        await api.getCustomAccounts().catch(() => {});
        this.broadcast('accounts', this.accounts());
        return { message: string(result.message) || 'Account added' };
      }
      case '/api/accounts/remove': {
        const name = handle(), result = await api.removeAccount(name);
        await Promise.allSettled([api.getCustomAccounts(), api.getHiddenAccounts()]);
        this.broadcast('accounts', this.accounts());
        const clean = name.replace(/^@/, '');
        return { action: result.action ?? null, message: result.action === 'hidden' ? `@${clean} is part of the shared feed, so it was hidden instead`
          : result.action === 'removed_available' ? `Removed @${clean} from available accounts` : `Removed @${clean}` };
      }
      case '/api/accounts/hidden': {
        const name = handle().replace(/^@/, ''), hidden = body.hidden === true;
        const result = await api.setAccountHidden(name, hidden);
        await api.getHiddenAccounts().catch(() => {});
        this.broadcast('accounts', this.accounts());
        return { message: result.diverted ? `The server handled @${name} differently and did not hide it` : hidden ? `Hid @${name}` : `@${name} is visible again` };
      }
      case '/api/tracked': {
        const kind = sourceKind(body.kind), target = string(body.target).trim();
        if (!target) throw new RequestError(400, 'Enter something to track');
        // The list update reaches browsers through the tracker's `tracked` event.
        await (body.remove === true ? api.untrack(kind, target) : api.track(kind, target));
        return { message: body.remove === true ? 'Stopped tracking' : `Tracking ${target}` };
      }
      case '/api/settings': {
        if (typeof body.aiSuggestions === 'boolean') { await api.setAiSuggestions(body.aiSuggestions); this.aiSuggestions = body.aiSuggestions; }
        if (typeof body.autoHide === 'boolean') await api.setAutoHideNewAccounts(body.autoHide);
        this.broadcast('settings', this.settings());
        return { settings: this.settings() };
      }
      case '/api/refresh': await this.refresh(); return {};
      default: throw new RequestError(404, 'Unknown action');
    }
  }
}

/** Where a session signed in from the page is remembered. Only your user can read it. */
export const SESSION_FILE = join(homedir(), '.jtracker', 'session');
async function readSession(): Promise<string | undefined> {
  try { return (await readFile(SESSION_FILE, 'utf8')).trim() || undefined; } catch { return undefined; }
}
async function writeSession(token: string): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true, mode: 0o700 });
  await writeFile(SESSION_FILE, `${token}\n`, { mode: 0o600 });
  await chmod(SESSION_FILE, 0o600);
}
async function forgetSession(): Promise<void> { await rm(SESSION_FILE, { force: true }); }

// Run with: npm run ui -- NY   (or DFW). --demo previews with made-up data and no network.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name: string) => args.includes(name);
  const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const demo = flag('--demo'), port = Number(value('--port') ?? process.env.PORT ?? 5177);
  const region = (args.find(arg => !arg.startsWith('--') && arg !== value('--port')) ?? 'NY').toUpperCase() as Region;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) { console.error('Invalid --port'); process.exit(1); }
  // JTRACKER_TOKEN wins; otherwise use a session remembered from an earlier sign-in; otherwise start signed out.
  const envToken = process.env.JTRACKER_TOKEN?.trim() || undefined;
  const saved = demo || envToken ? undefined : await readSession();
  let remember = !!saved;
  let source: TrackerLike;
  if (demo) source = new (await import('./demo.ts')).DemoTracker();
  else {
    let live: JTracker;
    try { live = new JTracker(region, { token: envToken ?? saved, socketOptions: { autoConnect: false } }); }
    catch (error) { console.error((error as Error).message); process.exit(1); }
    live.on('protocol_error', ({ event, message }) => console.error(`[protocol_error] ${event}: ${message}`));
    source = live;
  }
  const server = new TrackerServer(source, {
    mode: demo ? 'demo' : 'live', region, port,
    ...(demo ? {} : {
      onSignIn: async (token: string, keep: boolean) => { remember = keep; await (keep ? writeSession(token) : forgetSession()); },
      onSignOut: async () => { remember = false; await forgetSession(); },
      // A rotation can retire the old token: keep a remembered session current, or show the new value once.
      onTokenRotated: async (next: string) => {
        if (remember) await writeSession(next).catch(error => console.error(`[session] could not save the new token: ${error.message}`));
        else if (envToken) console.log(`\n[session] j7tracker issued a new session token. Update it before the next start:\n  export JTRACKER_TOKEN='${next}'\n`);
      },
    }),
  });
  let url: string;
  try { url = await server.listen(); }
  catch (error) {
    console.error(`Could not start the UI on port ${port}: ${(error as Error).message}. Try --port 0 for any free port.`);
    await source.close(); process.exit(1);
  }
  const state = demo ? 'Demo mode: fictional data, no network.'
    : source.token ? `Feed region ${region}. Checking your ${envToken ? 'JTRACKER_TOKEN' : 'saved'} session.`
    : `Feed region ${region}, not signed in. Sign in on the page to manage accounts and sources.`;
  console.log(`\n  JTracker UI  ${url}\n  ${state} Press Ctrl+C to stop.\n`);
  server.start();
  const stop = () => { void Promise.allSettled([server.close(), source.close()]).then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
