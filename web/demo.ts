import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { JTrackerFeed } from '../src/jtracker-feed.ts';
import { JTrackerApiError, SOCIAL_TRACKERS, trackedList } from '../src/jtracker-api.ts';
import type { SocialTracker } from '../src/jtracker-api.ts';
import type { JTrackerSocialEvents, SocialHistoryEntry } from '../src/jtracker-social.ts';
import { accountHandle, customAccounts, type Data } from '../src/jtracker-model.ts';

/**
 * A self-contained stand-in for JTracker with the same surface the web server uses.
 * Every account, post and token here is fictional; nothing touches the network.
 */
const HANDLES = ['demo_alpha', 'demo_charts', 'demo_sam', 'demo_mia', 'demo_owl', 'demo_dave', 'demo_luna', 'demo_kai'];
const NAMES: Record<string, string> = {
  demo_alpha: 'Alpha (demo)', demo_charts: 'Chart Room (demo)', demo_sam: 'Sam (demo)', demo_mia: 'Mia (demo)',
  demo_owl: 'Night Owl (demo)', demo_dave: 'Dave (demo)', demo_luna: 'Luna (demo)', demo_kai: 'Kai (demo)',
};
const TOKENS = [
  { symbol: 'DEMO', name: 'Demo Coin' }, { symbol: 'PIXEL', name: 'Pixel Cat' }, { symbol: 'ORBIT', name: 'Orbit' },
  { symbol: 'MOCHI', name: 'Mochi Dog' }, { symbol: 'LOOP', name: 'Loop' }, { symbol: 'TIDE', name: 'Tide' },
];
const LINES = [
  'gm. watching ${T} closely today, volume looks different',
  'new launch just went live, CA below 👇\n${CA}',
  'this chart is going vertical and nobody is talking about it',
  'which one are you holding into the weekend: ${T} or ${T2}?',
  'launching something fun later ☕ stay tuned',
  'if you are reading this you are still early',
  'the ${T} community is shipping every single day',
  'reminder: take profits, touch grass, come back tomorrow',
  'ok ${T} at this market cap is simply not serious',
  'dev just locked liquidity on ${T}. CA: ${CA}',
];
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const pick = <T>(items: readonly T[]): T => items[randomInt(items.length)]!;
const mint = () => Array.from({ length: 40 }, () => BASE58[randomInt(BASE58.length)]).join('') + 'pump';

class DemoSocial extends EventEmitter<JTrackerSocialEvents> {
  readonly socket = { connected: false };
  readonly tracked = Object.fromEntries(SOCIAL_TRACKERS.map(kind => [kind, trackedList(kind, {})])) as Record<SocialTracker, Data>;
  connect(): this { this.socket.connected = true; this.emit('connect'); return this; }
  disconnect(): this {
    if (this.socket.connected) { this.socket.connected = false; this.emit('disconnect', 'io client disconnect'); }
    return this;
  }
  setTracked(kind: SocialTracker, value: unknown): void { this.tracked[kind] = trackedList(kind, value); this.emit('tracked', kind, this.tracked[kind]); }
  async history(): Promise<SocialHistoryEntry[]> { return []; }
}

const LIST_KEY = { fomo: 'fomo_users', pump: 'pump_users', telegram: 'telegram_channels', subdomain: 'domains' } as const;
const REMOVE_KEY = { fomo: 'fomo_user_id', pump: 'wallet', telegram: 'channel', subdomain: 'domain' } as const;

export class DemoTracker extends JTrackerFeed {
  readonly social = new DemoSocial();
  readonly socket = { connected: false };
  /** Any non-empty token signs in; there is no real account behind it. */
  token: string | undefined = 'demo';
  readonly api;
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private aiEnabled = true;
  private readonly mints = TOKENS.map(token => ({ ...token, mint: mint() }));
  // The demo account's own state, published to the feed fields the way JTracker's API does.
  private readonly account = {
    custom: { accounts: HANDLES.slice(0, 5), availableAccounts: ['demo_luna'], customConfigured: true, deployCount: 5, maxAccounts: 25 },
    hidden: ['demo_spam'], autoHide: false,
    lists: {
      telegram: { telegram_channels: [{ channel: 'demo_calls', handle: 'demo_calls', title: 'Demo Calls' }], limit: 30 },
      pump: { pump_users: [{ wallet: mint(), username: 'demo_dev', display_name: 'Demo Dev' }], limit: 50 },
      fomo: { fomo_users: [{ fomo_user_id: 'f1', handle: 'demo_trader', display_name: 'Demo Trader' }], limit: 50 },
      subdomain: { domains: [], can_manage: false },
    } as Record<SocialTracker, Data>,
  };

  constructor() {
    super();
    const account = this.account;
    const publish = () => {
      this.customAccounts = customAccounts(account.custom);
      this.hiddenAccounts = [...account.hidden];
      this.autoHideNewAccounts = account.autoHide;
    };
    const signedIn = () => { if (!this.token) throw new JTrackerApiError('Not logged in', { code: 'no_session' }); };
    const rows = (kind: SocialTracker) => account.lists[kind][LIST_KEY[kind]] as Data[];
    const publishList = (kind: SocialTracker) => { this.social.setTracked(kind, account.lists[kind]); return this.social.tracked[kind]; };
    this.api = {
      checkSession: async () => { signedIn(); return { token: this.token!, username: 'demo_user', rotated: false }; },
      getCustomAccounts: async () => { signedIn(); publish(); return this.customAccounts!; },
      getWatchedAccounts: async () => { signedIn(); publish(); return { success: true, hidden: [...account.hidden], feedPrefs: { noAutoAddMainFeed: account.autoHide } }; },
      getHiddenAccounts: async () => { signedIn(); publish(); return [...account.hidden]; },
      addCustomAccount: async (handle: string) => {
        signedIn();
        const clean = accountHandle(handle);
        if (!clean) throw new JTrackerApiError('Invalid account handle', { code: 'invalid_handle' });
        if (account.custom.accounts.length >= account.custom.maxAccounts) throw new JTrackerApiError('Custom account limit reached', { code: 'limit_reached', status: 200 });
        if (!account.custom.accounts.includes(clean)) account.custom.accounts = [...account.custom.accounts, clean];
        this.handle('custom_accounts_list', account.custom);
        return { ok: true, message: `Added @${clean}` };
      },
      removeAccount: async (handle: string) => {
        signedIn();
        const clean = accountHandle(handle), mine = account.custom.accounts.includes(clean);
        if (mine) account.custom.accounts = account.custom.accounts.filter(item => item !== clean);
        else account.hidden = [...new Set([...account.hidden, clean])];
        publish();
        this.handle('custom_accounts_list', account.custom);
        return { ok: true, action: mine ? 'removed_custom' as const : 'hidden' as const };
      },
      setAccountHidden: async (handle: string, hidden: boolean) => {
        signedIn();
        const clean = accountHandle(handle);
        account.hidden = hidden ? [...new Set([...account.hidden, clean])] : account.hidden.filter(item => item !== clean);
        publish();
        return { diverted: false };
      },
      listTracked: async (kind: SocialTracker) => { signedIn(); return publishList(kind); },
      track: async (kind: SocialTracker, target: string) => {
        signedIn();
        const value = target.trim();
        if (!value) throw new JTrackerApiError('Empty target', { code: 'invalid_target' });
        if (kind === 'subdomain') throw new JTrackerApiError('Only managers can track domains', { code: 'http_error', status: 403 });
        const row = kind === 'telegram' ? { channel: value, handle: value.replace(/^.*\//, '').replace(/^@/, ''), title: value }
          : kind === 'pump' ? { wallet: value, username: value.replace(/^@/, '') } : { fomo_user_id: value, handle: value.replace(/^@/, '') };
        account.lists[kind] = { ...account.lists[kind], [LIST_KEY[kind]]: [...rows(kind), row] };
        return publishList(kind);
      },
      untrack: async (kind: SocialTracker, target: string) => {
        signedIn();
        account.lists[kind] = { ...account.lists[kind], [LIST_KEY[kind]]: rows(kind).filter(row => (typeof row === 'string' ? row : row[REMOVE_KEY[kind]]) !== target) };
        return publishList(kind);
      },
      setAiSuggestions: async (enabled: boolean) => { signedIn(); this.aiEnabled = enabled; },
      setAutoHideNewAccounts: async (enabled: boolean) => {
        signedIn();
        account.autoHide = enabled;
        this.handle('main_feed_auto_add_updated', { success: true, noAutoAdd: enabled });
        return enabled;
      },
    };
  }

  connect(): this { this.start(); return this; }
  /** Stops the fictional feed until connect(). */
  disconnect(): this {
    clearTimeout(this.timer);
    if (this.socket.connected) { this.socket.connected = false; this.emit('disconnect', 'io client disconnect'); }
    return this;
  }
  /**
   * Emits a short history, then new fictional posts every one to four seconds. Signed out it
   * behaves like the real feed without a session: AI suggestions only, with no history or posts.
   */
  start(): void {
    if (this.socket.connected) return;
    this.socket.connected = true;
    this.emit('connect');
    const now = Date.now();
    if (this.token) this.handle('initialTweets', Array.from({ length: 12 }, (_, index) => this.tweet(now - (12 - index) * 47_000)).reverse());
    const tick = () => {
      this.step();
      this.timer = setTimeout(tick, 1000 + randomInt(3000));
    };
    this.timer = setTimeout(tick, 800);
  }
  private tweet(at = Date.now()): Data {
    const handle = pick(HANDLES), token = pick(this.mints), other = pick(this.mints);
    const text = pick(LINES).replaceAll('${T}', `$${token.symbol}`).replaceAll('${T2}', `$${other.symbol}`).replaceAll('${CA}', token.mint);
    const id = `demo-${++this.sequence}`;
    const tweet: Data = {
      id, text, createdAt: at, author: { handle, name: NAMES[handle], avatar: '' },
      isCustomAccount: this.account.custom.accounts.includes(handle),
    };
    if (text.includes(token.mint) || randomInt(3) === 0) {
      tweet.tokenMeta = { [token.mint]: { ...token, chain: 'sol', marketCapUsd: 8_000 + randomInt(2_000_000), liquidityUsd: 5_000 + randomInt(90_000), at } };
    }
    if (randomInt(5) === 0) {
      const quoted = pick(HANDLES);
      tweet.isQuote = true;
      tweet.quotedTweet = { id: `demo-q-${this.sequence}`, text: pick(LINES).replaceAll('${T}', `$${other.symbol}`).replaceAll('${T2}', '$DEMO').replaceAll('${CA}', other.mint), author: { handle: quoted, name: NAMES[quoted] } };
    } else if (randomInt(6) === 0) {
      tweet.isReply = true;
      tweet.replyTo = { author: { handle: pick(HANDLES) } };
    }
    return tweet;
  }
  /** A suggestion for a fictional post that is never delivered, sometimes with launched matches. */
  private suggestionOnly(): void {
    const handle = pick(HANDLES), token = pick(this.mints);
    const id = (((BigInt(Date.now()) - 1288834974657n) << 22n) | BigInt(randomInt(4_000_000))).toString();
    this.handle('ai_suggestion', { tweet_id: id, tweet_url: `https://x.com/${handle}/status/${id}`, prediction: token.name, ticker: `${token.symbol}\u2060`, image_url: '' });
    if (randomInt(2)) {
      const results = this.mints.filter(item => item === token || randomInt(3) === 0).slice(0, 3).map(item => ({ name: item.name, symbol: item.symbol, mint: item.mint }));
      setTimeout(() => this.handle('ai_suggestion_update', { tweet_id: id, results }), 600);
    }
  }
  private step(): void {
    if (!this.token) { if (randomInt(3)) this.suggestionOnly(); return; }
    const roll = randomInt(20);
    if (roll < 13) {
      const tweet = this.tweet();
      this.handle('tweet', tweet);
      if (this.aiEnabled && randomInt(3) === 0) {
        const token = pick(this.mints);
        setTimeout(() => this.handle('ai_suggestion', { tweet_id: tweet.id, prediction: token.name, ticker: token.symbol }), 400);
      }
    } else if (roll < 15) {
      const [a, b] = [pick(HANDLES), pick(HANDLES)];
      this.handle(randomInt(4) ? 'following_update' : 'unfollowing_update', { id: `demo-f-${++this.sequence}`, user: { handle: a, name: NAMES[a] }, following: { handle: b, name: NAMES[b] }, unfollowing: { handle: b, name: NAMES[b] } });
    } else if (roll < 16) {
      const a = pick(HANDLES);
      this.handle('profile_update', { id: `demo-p-${++this.sequence}`, user: { handle: a, profile: { name: NAMES[a], description: 'new bio' } }, before: { profile: { description: 'old bio' } } });
    } else if (roll < 18) {
      const token = pick(this.mints);
      this.social.emit('telegram_event', { kind: 'message', data: { id: ++this.sequence, channel: { title: 'Demo Calls', username: 'demo_calls' }, text: `Fresh call: $${token.symbol}\n${token.mint}`, timestamp: new Date().toISOString() } });
    } else if (roll < 19) {
      const token = pick(this.mints);
      this.social.emit('pump_event', { kind: 'trade', data: { tx: `demo-tx-${++this.sequence}`, side: randomInt(3) ? 'buy' : 'sell', usdAmount: 150 + randomInt(9000), token: { symbol: token.symbol, address: token.mint }, author: { username: 'demo_dev' }, timestamp: Date.now() } });
    } else {
      const recent = this.tweets.find(tweet => !tweet.isDeleted);
      if (recent) this.handle('tweet_deleted', { id: recent.id });
    }
  }
  async close(): Promise<void> {
    clearTimeout(this.timer);
    this.socket.connected = false;
    this.social.socket.connected = false;
  }
}
