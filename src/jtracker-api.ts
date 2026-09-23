import type { ChromiumClient, ChromiumResponse } from './index.js';
import { accountHandle, array, customAccounts, hiddenHandles, isObject, object, string } from './jtracker-model.ts';
import type { CustomAccounts, Data } from './jtracker-model.ts';

/** REST hosts, as assigned in source.js (`Xe`, `ze` and `Ue`, near line 14855). */
export const API_HOSTS = {
  /** Login, session check, custom accounts and hidden accounts. */
  core: 'https://core.j7tracker.io',
  /** Feed preferences and the fee-claim tracker. The site builds this from its own hostname. */
  main: 'https://nyc.j7tracker.io',
  /** Fomo, pump.fun, Telegram and subdomain trackers. */
  social: 'https://nj.j7tracker.io/wallets',
} as const;
export type ApiHost = keyof typeof API_HOSTS;
export type ApiHosts = Record<ApiHost, string>;

/** Source trackers managed on the social host; their events arrive on JTrackerSocial. */
export const SOCIAL_TRACKERS = ['fomo', 'pump', 'telegram', 'subdomain'] as const;
export type SocialTracker = typeof SOCIAL_TRACKERS[number];
const LIST_KEYS = { fomo: 'fomo_users', pump: 'pump_users', telegram: 'telegram_channels', subdomain: 'domains' } as const;

export interface ApiEndpoint { host: ApiHost; method: 'GET' | 'POST' | 'DELETE'; path: string }
/** Every endpoint this client calls. A test checks each path against the supplied bundle. */
export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  { host: 'core', method: 'POST', path: '/api/login' },
  { host: 'core', method: 'GET', path: '/api/session-check' },
  { host: 'core', method: 'GET', path: '/api/accounts' },
  { host: 'core', method: 'POST', path: '/api/accounts' },
  { host: 'core', method: 'POST', path: '/api/remove-account' },
  { host: 'core', method: 'GET', path: '/api/accounts/available' },
  { host: 'core', method: 'POST', path: '/api/accounts/available' },
  { host: 'core', method: 'DELETE', path: '/api/accounts/available' },
  { host: 'core', method: 'POST', path: '/api/accounts/available/all' },
  { host: 'core', method: 'DELETE', path: '/api/accounts/available/all' },
  { host: 'core', method: 'POST', path: '/api/accounts/import' },
  { host: 'core', method: 'GET', path: '/api/watched-accounts' },
  { host: 'core', method: 'GET', path: '/api/hidden-accounts' },
  { host: 'core', method: 'POST', path: '/api/hidden-accounts' },
  { host: 'core', method: 'POST', path: '/api/hidden-accounts/batch' },
  { host: 'main', method: 'POST', path: '/api/feed/no-auto-add' },
  { host: 'main', method: 'POST', path: '/api/ai-suggestions-toggle' },
  { host: 'main', method: 'GET', path: '/api/wallet-tracker/list' },
  { host: 'main', method: 'POST', path: '/api/wallet-tracker/track' },
  { host: 'main', method: 'DELETE', path: '/api/wallet-tracker/untrack' },
  ...SOCIAL_TRACKERS.flatMap((kind): ApiEndpoint[] => [
    { host: 'social', method: 'GET', path: `/api/${kind}/list` },
    { host: 'social', method: 'POST', path: `/api/${kind}/add` },
    { host: 'social', method: 'POST', path: `/api/${kind}/remove` },
  ]),
];

export class JTrackerApiError extends Error {
  /** Server `code` when present, else unauthorized, rate_limited, http_error, timeout, network,
   * no_session, invalid_handle, invalid_target or invalid_response. */
  readonly code: string;
  readonly status?: number;
  /** Parsed response body, when there was one. */
  readonly data?: unknown;
  constructor(message: string, details: { code: string; status?: number; data?: unknown; cause?: unknown }) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'JTrackerApiError';
    this.code = details.code;
    if (details.status !== undefined) this.status = details.status;
    if (details.data !== undefined) this.data = details.data;
  }
}

export interface Session { token: string; username: string; userId?: string }
export interface LoginOptions {
  username: string;
  password: string;
  /** Token produced by the site's Cloudflare Turnstile check. It is never generated here. */
  turnstileToken: string;
  /** Referral code from a j7tracker.io/@code link. The site sends null otherwise. */
  refCode?: string | null;
}
export type RemoveAction = 'removed_custom' | 'removed_available' | 'hidden';
export type ApiUpdate =
  | { kind: 'custom_accounts'; value: CustomAccounts }
  | { kind: 'hidden_accounts'; value: string[] }
  | { kind: 'auto_hide'; value: boolean }
  | { kind: 'tracked'; tracker: SocialTracker; value: Data };

export interface JTrackerApiOptions {
  /** Site session ID: the same credential as JTRACKER_TOKEN. */
  token?: string;
  /** Page origin the site's requests come from. Defaults to https://j7tracker.io. */
  origin?: string;
  /** Host overrides, useful for controlled tests. */
  hosts?: Partial<ApiHosts>;
  /** Called when login(), a rotated session check, or the token setter changes the token. */
  onToken?: (token: string | undefined) => void;
  /** Called with account and tracker state read from REST responses. */
  onUpdate?: (update: ApiUpdate) => void;
}
type Auth = 'session' | 'bearer' | 'none';
interface CallOptions { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; auth?: Auth; timeoutMs?: number; headers?: Record<string, string> }

/** Normalizes a tracker list response the way the site stores it. Unknown fields are kept. */
export function trackedList(tracker: SocialTracker, value: unknown): Data {
  const body = object(value);
  if (tracker === 'subdomain') return { ...body, domains: array(body.domains), can_manage: body.can_manage === true };
  return { ...body, [LIST_KEYS[tracker]]: array(body[LIST_KEYS[tracker]]) };
}
function checkTracker(tracker: string): SocialTracker {
  if (!(SOCIAL_TRACKERS as readonly string[]).includes(tracker)) throw new TypeError(`Unknown tracker: ${tracker}`);
  return tracker as SocialTracker;
}
function requireHandle(value: unknown): string {
  const handle = accountHandle(value);
  if (!handle) throw new JTrackerApiError('Invalid account handle', { code: 'invalid_handle' });
  return handle;
}
function requireHandles(value: unknown): string[] {
  const handles = [...new Set((Array.isArray(value) ? value : [value]).map(accountHandle).filter(Boolean))];
  if (!handles.length) throw new JTrackerApiError('No handles', { code: 'invalid_handle' });
  return handles;
}
function requireTarget(value: unknown): string {
  const target = string(value).trim();
  if (!target) throw new JTrackerApiError('Empty target', { code: 'invalid_target' });
  return target;
}
/** Matches the site's error envelope: server code first, then 401/429, else http_error. */
function failure(response: ChromiumResponse, data: unknown, fallback?: string): JTrackerApiError {
  const body = object(data), status = response.status;
  const code = string(body.code) || (status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : 'http_error');
  return new JTrackerApiError(string(body.error) || fallback || `HTTP ${status}`, { code, status, data });
}
function userId(body: Data): { userId?: string } {
  return body.userId != null && body.userId !== '' ? { userId: String(body.userId) } : {};
}

/**
 * The site's account REST API, sent through the same native Chromium client as the socket.
 * Requests carry the page's Origin/Referer and the session header each endpoint uses.
 */
export class JTrackerAPI {
  readonly hosts: ApiHosts;
  readonly origin: string;
  private readonly client: ChromiumClient;
  private readonly onToken?: (token: string | undefined) => void;
  private readonly onUpdate?: (update: ApiUpdate) => void;
  private tokenValue?: string;

  constructor(client: ChromiumClient, options: JTrackerApiOptions = {}) {
    this.client = client;
    this.origin = new URL(options.origin ?? 'https://j7tracker.io').origin;
    this.hosts = { ...API_HOSTS, ...options.hosts };
    this.tokenValue = options.token || undefined;
    this.onToken = options.onToken;
    this.onUpdate = options.onUpdate;
  }
  get token(): string | undefined { return this.tokenValue; }
  set token(value: string | undefined) {
    const next = value || undefined;
    if (next === this.tokenValue) return;
    this.tokenValue = next;
    this.onToken?.(next);
  }

  private async call(host: ApiHost, path: string, options: CallOptions = {}): Promise<{ response: ChromiumResponse; data: unknown }> {
    const { method = 'GET', body, auth = 'session', timeoutMs = 15_000, headers = {} } = options;
    const token = this.tokenValue;
    if (auth !== 'none' && !token) throw new JTrackerApiError('Not logged in', { code: 'no_session' });
    const credential: Record<string, string> = auth === 'session' ? { 'x-session-id': token! } : auth === 'bearer' ? { Authorization: `Bearer ${token}` } : {};
    let response: ChromiumResponse;
    try {
      response = await this.client.request(this.hosts[host] + path, {
        method, timeoutMs, ...(body !== undefined ? { json: body } : {}),
        headers: { ...credential, ...headers, Referer: `${this.origin}/` },
        // A fetch() from the site's page: Origin, cors mode, and no cookies to another origin.
        context: { kind: 'fetch', initiator: `${this.origin}/` },
      });
    } catch (error) {
      const timeout = isObject(error) && (error.name === 'TimeoutError' || error.name === 'AbortError');
      const message = error instanceof Error ? error.message : String(error);
      throw new JTrackerApiError(timeout ? 'Request timed out' : `Network error: ${message}`, { code: timeout ? 'timeout' : 'network', cause: error });
    }
    // The site wraps fetch so any response can rotate the session (source.js line 249262).
    // Adopt it unless the token was replaced while this request was in flight.
    const rotated = response.header('x-new-token');
    if (auth !== 'none' && rotated && this.tokenValue === token) this.token = rotated;
    let data: unknown;
    try { data = response.json(); } catch { data = undefined; }
    return { response, data };
  }
  /** Custom-account envelope (source.js `Ub`): success unless HTTP fails or the body says ok:false. */
  private async core(path: string, options: CallOptions = {}): Promise<Data> {
    const { response, data } = await this.call('core', path, options);
    const body = object(data);
    if (response.ok && body.ok !== false) return body;
    throw failure(response, data);
  }
  /** Hidden-account calls (source.js `V_` callers) require ok:true. */
  private async hidden(path: string, options: CallOptions, fallback: string): Promise<Data> {
    const { response, data } = await this.call('core', path, { timeoutMs: 12_000, ...options });
    const body = object(data);
    if (response.ok && body.ok === true) return body;
    throw failure(response, data, fallback);
  }
  /** Tracker calls (source.js `Mh`) use a Bearer token and fail on any HTTP error. */
  private async social(path: string, options: CallOptions = {}): Promise<Data> {
    const { response, data } = await this.call('social', path, { auth: 'bearer', ...options });
    if (response.ok) return object(data);
    throw failure(response, data);
  }

  // Session ------------------------------------------------------------------

  /**
   * Password login. The site requires a Cloudflare Turnstile token from its human check, so
   * this only works with a token solved in a browser. Copying the browser session ID is simpler.
   */
  async login(options: LoginOptions): Promise<Session> {
    if (!string(options.turnstileToken).trim()) {
      throw new TypeError('login() needs the Turnstile token from the site\'s security check; use a browser session ID as the token instead');
    }
    const { response, data } = await this.call('core', '/api/login', {
      method: 'POST', auth: 'none', timeoutMs: 10_000,
      body: { username: options.username, password: options.password, ref_code: options.refCode ?? null, cf_turnstile_token: options.turnstileToken },
    });
    if (!response.ok) throw failure(response, data);
    const body = object(data), token = string(body.sessionId);
    if (!token) throw new JTrackerApiError('Login response had no session ID', { code: 'invalid_response', status: response.status, data });
    this.token = token;
    return { token, username: string(body.username) || options.username, ...userId(body) };
  }
  /**
   * Validates the session. Like every authenticated call, a response X-New-Token header rotates
   * the token, which is adopted and reported through onToken. A 401 rejects with code unauthorized.
   */
  async checkSession(): Promise<Session & { rotated: boolean }> {
    const sent = this.tokenValue;
    const { response, data } = await this.call('core', '/api/session-check', {
      timeoutMs: 10_000, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
    });
    if (!response.ok) throw failure(response, data);
    const body = object(data), token = response.header('x-new-token') || sent!;
    return { token, username: string(body.username), ...userId(body), rotated: token !== sent };
  }

  // Custom accounts (X handles your feed follows) ------------------------------

  /** Your custom accounts, available accounts and quota. Also updates JTracker.customAccounts. */
  async getCustomAccounts(): Promise<CustomAccounts> {
    const value = customAccounts(await this.core('/api/accounts'));
    this.onUpdate?.({ kind: 'custom_accounts', value });
    return value;
  }
  /** Adds an X account to your custom accounts. Uses quota; failures include no_deploys and limit_reached. */
  async addCustomAccount(handle: string): Promise<Data> {
    return this.core('/api/accounts', { method: 'POST', body: { handle: requireHandle(handle) } });
  }
  /**
   * Removes a handle. The server decides the outcome in `action`: removed_custom,
   * removed_available, or hidden when the handle belongs to the shared feed.
   */
  async removeAccount(handle: string): Promise<Data & { action?: RemoveAction }> {
    return this.core('/api/remove-account', { method: 'POST', body: { handle: requireHandle(handle) }, timeoutMs: 12_000 });
  }
  async getAvailableAccounts(): Promise<Data & { accounts: string[] }> {
    const body = await this.core('/api/accounts/available');
    return { ...body, accounts: array(body.accounts).filter((item): item is string => typeof item === 'string') };
  }
  async addAvailableAccounts(handles: string | string[]): Promise<Data> {
    return this.core('/api/accounts/available', { method: 'POST', body: { handles: requireHandles(handles) }, timeoutMs: 30_000 });
  }
  async removeAvailableAccounts(handles: string | string[]): Promise<Data> {
    return this.core('/api/accounts/available', { method: 'DELETE', body: { handles: requireHandles(handles) }, timeoutMs: 30_000 });
  }
  async addAllAvailableAccounts(): Promise<Data> {
    return this.core('/api/accounts/available/all', { method: 'POST', timeoutMs: 30_000 });
  }
  async removeAllAvailableAccounts(): Promise<Data> {
    return this.core('/api/accounts/available/all', { method: 'DELETE', timeoutMs: 30_000 });
  }
  /** Bulk import of handles, as the site's import dialog sends them. */
  async importAccounts(handles: string[]): Promise<Data> {
    return this.core('/api/accounts/import', { method: 'POST', body: { accounts: requireHandles(handles) }, timeoutMs: 60_000 });
  }
  /**
   * Every account the feed watches, grouped as x, truth, ig and custom, plus your hidden list and
   * feed preferences. Like the site, the hidden list and auto-hide setting update tracker state.
   */
  async getWatchedAccounts(options: { fresh?: boolean } = {}): Promise<Data> {
    const body = await this.core(`/api/watched-accounts${options.fresh ? '?fresh=1' : ''}`, { timeoutMs: 20_000 });
    if (Array.isArray(body.hidden)) this.onUpdate?.({ kind: 'hidden_accounts', value: hiddenHandles(body.hidden) });
    const prefs = object(body.feedPrefs);
    if (isObject(body.feedPrefs)) this.onUpdate?.({ kind: 'auto_hide', value: prefs.noAutoAddMainFeed === true });
    return body;
  }

  // Hidden accounts (your mute list for the shared feed) -------------------------

  /** Fully hidden X handles, lowercased. Also updates JTracker.hiddenAccounts. */
  async getHiddenAccounts(): Promise<string[]> {
    const value = hiddenHandles((await this.hidden('/api/hidden-accounts', {}, 'Could not load hidden accounts')).hidden);
    this.onUpdate?.({ kind: 'hidden_accounts', value });
    return value;
  }
  /** `diverted: true` means the server handled a hide differently and did not add it to the list. */
  async setAccountHidden(handle: string, hidden: boolean): Promise<{ diverted: boolean }> {
    const body = await this.hidden('/api/hidden-accounts', { method: 'POST', body: { handle: requireHandle(handle), hidden: hidden === true } }, 'save failed');
    return { diverted: body.diverted === true };
  }
  async setAccountsHidden(items: { handle: string; hidden: boolean }[]): Promise<Data> {
    const clean = items.map(item => ({ handle: accountHandle(item.handle), hidden: item.hidden === true })).filter(item => item.handle);
    if (!clean.length) return { ok: true, processed: 0 };
    return this.hidden('/api/hidden-accounts/batch', { method: 'POST', body: { items: clean }, timeoutMs: 30_000 }, 'batch failed');
  }

  // Feed preferences ------------------------------------------------------------

  /** The site's "Auto-hide new main feed accounts" switch. Resolves to the saved value. */
  async setAutoHideNewAccounts(enabled: boolean): Promise<boolean> {
    const { response, data } = await this.call('main', '/api/feed/no-auto-add', { method: 'POST', body: { noAutoAdd: enabled === true } });
    const body = object(data);
    if (!response.ok || !body.success) throw failure(response, data, 'Failed to save preference');
    this.onUpdate?.({ kind: 'auto_hide', value: body.noAutoAdd === true });
    return body.noAutoAdd === true;
  }
  /** Turns the server's AI token suggestions on or off for this account. */
  async setAiSuggestions(enabled: boolean): Promise<void> {
    const { response, data } = await this.call('main', '/api/ai-suggestions-toggle', { method: 'POST', auth: 'bearer', body: { enabled: enabled !== false } });
    if (!response.ok) throw failure(response, data);
  }

  // Fee-claim tracker (the site's field is named github_user but holds a coin mint) --

  async getFeeClaimTracking(): Promise<Data & { tracked: Data[] }> {
    const { response, data } = await this.call('main', '/api/wallet-tracker/list');
    if (!response.ok) throw failure(response, data);
    const body = object(data);
    return { ...body, tracked: array(body.tracked).filter(isObject) };
  }
  async trackFeeClaims(mint: string): Promise<Data> {
    const { response, data } = await this.call('main', '/api/wallet-tracker/track', { method: 'POST', body: { github_user: requireTarget(mint) } });
    const body = object(data);
    if (body.success || body.alreadyTracked) return body;
    throw failure(response, data, 'Failed to track');
  }
  async untrackFeeClaims(mint: string): Promise<Data> {
    const { response, data } = await this.call('main', '/api/wallet-tracker/untrack', { method: 'DELETE', body: { github_user: requireTarget(mint) } });
    const body = object(data);
    // Like the site, treat 404 or "not tracking" as already removed.
    if (body.success || response.status === 404 || /not tracking/i.test(string(body.error))) return body;
    throw failure(response, data);
  }

  // Source trackers: Fomo users, pump.fun users, Telegram channels, subdomains ----

  /** Current list and limit. Subdomain changes need can_manage and apply to every user. */
  async listTracked(tracker: SocialTracker): Promise<Data> {
    const kind = checkTracker(tracker);
    return this.tracked(kind, await this.social(`/api/${kind}/list`));
  }
  /** Adds a source. Targets are sent as typed: a handle, channel, wallet, pump.fun URL or domain. */
  async track(tracker: SocialTracker, target: string): Promise<Data> {
    const kind = checkTracker(tracker);
    return this.tracked(kind, await this.social(`/api/${kind}/add`, { method: 'POST', body: { target: requireTarget(target) } }));
  }
  async untrack(tracker: SocialTracker, target: string): Promise<Data> {
    const kind = checkTracker(tracker);
    return this.tracked(kind, await this.social(`/api/${kind}/remove`, { method: 'POST', body: { target: requireTarget(target) } }));
  }
  private tracked(tracker: SocialTracker, body: Data): Data {
    const value = trackedList(tracker, body);
    this.onUpdate?.({ kind: 'tracked', tracker, value });
    return value;
  }
}
