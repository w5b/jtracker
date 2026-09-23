import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { array, author, customAccounts, hiddenHandles, identifier, isObject, mergeData, normalizeTweet, object, postKey, string, tweetKeys } from './jtracker-model.ts';
import type { Activity, CustomAccounts, Data, Tweet } from './jtracker-model.ts';
export type { Activity, Author, CustomAccounts, Data, Media, Tweet } from './jtracker-model.ts';

export const ACTIVITY_EVENTS = [
  'following_update', 'unfollowing_update', 'profile_update', 'profile_pinned_update',
  'profile_unpinned_update', 'profile_suspended_update', 'profile_deactivated_update',
  'affiliated.update', 'unaffiliated.update', 'profile_affiliation_update',
] as const;
export const FORWARDED_EVENTS = [
  'auth_error', 'custom_accounts_list', 'hidden_accounts_updated', 'admin_alert',
  'admin_alert_clear', 'token_meta', 'ai_suggestion', 'ai_suggestion_update',
  'debug_response', 'buy_success', 'buy_error', 'quoted_tweet', 'reply_tweet',
  'follow_scan', 'external_message', 'coin_community_event', 'charity_event',
  'wallet_tracker_claim', 'vamp_trigger', 'vamp_update_trigger',
  // Registered through the socket prop of the accounts panel (source.js line 150998), not on Sz.
  'main_feed_auto_add_updated',
] as const;
/** Inventory of all distinct application handlers on Sz in source.js, plus the one above. */
export const SITE_EVENTS = [
  ...ACTIVITY_EVENTS, ...FORWARDED_EVENTS, 'pnl_update', 'connected_users',
  'initialTweets', 'tweet', 'tweet_update', 'tweet.subtweet.update', 'tweet_deleted',
] as const;
type ActivityEvent = typeof ACTIVITY_EVENTS[number];
type ForwardedEvent = typeof FORWARDED_EVENTS[number];
export interface TweetContext { sourceEvent: string; historical: boolean; previous?: Tweet }
export type FeedChange =
  | { kind: 'tweet'; action: 'new' | 'update' | 'delete'; item: Tweet; context: TweetContext }
  | { kind: 'activity'; action: 'new' | 'update'; item: Activity };
export type JTrackerEvents = { [K in ActivityEvent]: [activity: Activity] }
  & { [K in ForwardedEvent]: [payload: Data] } & {
    connect: [];
    disconnect: [reason: string, details?: unknown];
    connect_error: [error: Error];
    /** The session token changed through login(), checkSession() rotation, or the token setter. */
    token: [token: string | undefined];
    raw: [event: string, ...args: unknown[]];
    protocol_error: [problem: { event: string; message: string; payload: unknown }];
    initialTweets: [tweets: Tweet[]];
    tweet: [tweet: Tweet, context: TweetContext];
    tweet_update: [tweet: Tweet, context: TweetContext];
    'tweet.subtweet.update': [tweet: Tweet, context: TweetContext];
    tweet_deleted: [deletion: Data & { id: string; tweet: Tweet }];
    activity: [activity: Activity];
    feed: [change: FeedChange];
    pnl_update: [payload: unknown];
    connected_users: [users: unknown[]];
  };
export interface FeedOptions {
  maxTweets?: number;
  maxActivities?: number;
  maxPending?: number;
  maxSeen?: number;
  maxAiResults?: number;
  /** Deduplication and unmatched enrichment retention. Defaults to five minutes. */
  retentionMs?: number;
}
type Pending = { patch: Data; expiresAt: number };
const defaults = { maxTweets: 500, maxActivities: 500, maxPending: 1000, maxSeen: 5000, maxAiResults: 100, retentionMs: 300_000 };
const externalUpdates = new Set(['CARD_UPDATE', 'YOUTUBE_DELETION', 'YOUTUBE_IMAGE_UPDATE', 'TIKTOK_VIDEO_UPDATE', 'INSTAGRAM_VIDEO_UPDATE', 'TRUTHSOCIAL_VIDEO_UPDATE']);

/** Browser-independent state reducer. handle() also supports offline packet replay. */
export class JTrackerFeed extends EventEmitter<JTrackerEvents> {
  private readonly limits: typeof defaults;
  private readonly tweetCache = new Map<string, Tweet>();
  private readonly activityCache = new Map<string, Activity>();
  private readonly pending = new Map<string, Pending>();
  private readonly seen = new Map<string, number>();
  connectedUsers: unknown[] = [];
  hiddenAccounts: string[] = [];
  customAccounts: CustomAccounts | null = null;
  /** The "Auto-hide new main feed accounts" setting, once the server or an API call reports it. */
  autoHideNewAccounts: boolean | null = null;
  adminAlert: Data | null = null;
  latestPnl: unknown = null;

  constructor(options: FeedOptions = {}) {
    super();
    this.limits = { ...defaults, ...options };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  /** Newest arrival first; updates retain their original position. */
  get tweets(): Tweet[] { return [...this.tweetCache.values()].reverse(); }
  get activities(): Activity[] { return [...this.activityCache.values()].reverse(); }
  getTweet(id: string): Tweet | undefined { return this.tweetCache.get(id); }
  getActivity(id: string): Activity | undefined { return this.activityCache.get(id); }
  clearFeed(): void {
    this.tweetCache.clear(); this.activityCache.clear(); this.pending.clear(); this.seen.clear();
  }
  private trim<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) map.delete(map.keys().next().value!);
  }
  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) { if (value.expiresAt > now) break; this.pending.delete(key); }
    for (const [key, expiry] of this.seen) { if (expiry > now) break; this.seen.delete(key); }
  }
  private remember(key: string): void {
    this.seen.delete(key); this.seen.set(key, Date.now() + this.limits.retentionMs);
    this.trim(this.seen, this.limits.maxSeen);
  }
  private invalid(event: string, payload: unknown, message: string): void {
    this.emit('protocol_error', { event, payload, message });
  }
  private queue(key: string, patch: Data): void {
    const merged = mergeData(this.pending.get(key)?.patch ?? {}, patch, this.limits.maxAiResults);
    this.pending.delete(key);
    this.pending.set(key, { patch: merged, expiresAt: Date.now() + this.limits.retentionMs });
    this.trim(this.pending, this.limits.maxPending);
  }
  private enrich(tweet: Data): Data {
    for (const key of [`id:${tweet.id}`, ...tweetKeys(tweet).map(key => `url:${key}`)]) {
      const entry = this.pending.get(key);
      if (entry) { tweet = mergeData(tweet, entry.patch, this.limits.maxAiResults); this.pending.delete(key); }
    }
    return tweet;
  }
  private storeTweet(payload: Data, event: string, historical = false, arrival = event === 'tweet'): Tweet {
    const id = identifier(payload.id)!, previous = this.tweetCache.get(id);
    const seen = this.seen.has(`tweet:${id}`) || previous?.isDeleted === true;
    // Reconnect history must not roll newer cached fields back to an older snapshot.
    const merged = historical && previous
      ? mergeData(payload, previous, this.limits.maxAiResults)
      : mergeData(previous ?? {}, payload, this.limits.maxAiResults);
    const tweet = normalizeTweet(this.enrich({ ...merged, id }));
    this.tweetCache.set(id, tweet);
    if (historical) return tweet; // History is emitted as one snapshot, never as live arrivals.
    this.trim(this.tweetCache, this.limits.maxTweets);
    const context: TweetContext = { sourceEvent: event, historical, previous };
    if (arrival || historical) this.remember(`tweet:${id}`);
    if (arrival && !seen) {
      if (event === 'tweet') this.emit('tweet', tweet, context);
      this.emit('feed', { kind: 'tweet', action: 'new', item: tweet, context });
    } else if (!isDeepStrictEqual(previous, tweet)) {
      if (!historical) this.emit('tweet_update', tweet, context);
      this.emit('feed', { kind: 'tweet', action: previous ? 'update' : 'new', item: tweet, context });
    }
    if (event === 'tweet.subtweet.update') this.emit('tweet.subtweet.update', tweet, context);
    return tweet;
  }
  private patchTarget(payload: Data, patch: Data, event: string): void {
    const id = identifier(payload.tweet_id ?? payload.id), url = postKey(payload.tweet_url);
    if (!id && !url) return this.invalid(event, payload, 'Expected id/tweet_id or a valid tweet_url');
    // An explicit ID takes precedence, matching the site's AI handlers.
    const targets = id ? [this.tweetCache.get(id)].filter((item): item is Tweet => !!item)
      : this.tweets.filter(tweet => tweetKeys(tweet).includes(url!));
    if (!targets.length) this.queue(id ? `id:${id}` : `url:${url}`, patch);
    for (const tweet of targets) this.storeTweet({ ...patch, id: tweet.id }, event);
  }
  private activity(event: ActivityEvent, payload: Data): void {
    if (!isObject(payload.user)) return this.invalid(event, payload, 'Expected a user object');
    const id = identifier(payload.id) ?? `${event}:${randomUUID()}`;
    const previous = this.activityCache.get(id);
    const target = payload.following ?? payload.unfollowing ?? payload.affiliate;
    const activity: Activity = {
      id, event, receivedAt: previous?.receivedAt ?? Date.now(), author: author(payload.user),
      ...(target ? { target: author(target) } : {}), raw: payload,
    };
    if (event === 'profile_update') {
      const before = object(object(payload.before).profile), after = object(object(payload.user).profile);
      const fields = { name: 'name', description: 'bio', location: 'location', avatar: 'avatar', banner: 'banner', url: 'website' };
      activity.changes = Object.entries(fields).filter(([key]) => !isDeepStrictEqual(before[key], after[key])).map(([, label]) => label);
    }
    const scan = this.pending.get(`activity:${id}`);
    if (scan || previous?.followScan) activity.followScan = object(scan?.patch.followScan ?? previous?.followScan);
    this.pending.delete(`activity:${id}`);
    this.activityCache.set(id, activity); this.trim(this.activityCache, this.limits.maxActivities);
    const key = `activity:${event}:${id}`;
    if (!this.seen.has(key) || !isDeepStrictEqual(previous?.raw, payload)) {
      this.emit(event, activity); this.emit('activity', activity);
      this.emit('feed', { kind: 'activity', action: previous ? 'update' : 'new', item: activity });
    }
    this.remember(key);
  }
  private deleteTweet(payload: Data): void {
    const id = identifier(payload.id);
    if (!id) return this.invalid('tweet_deleted', payload, 'Expected a string or safe integer id');
    const previous = this.tweetCache.get(id), snapshot = object(payload.tweet ?? payload.deletedTweet ?? payload);
    const tweet = normalizeTweet(this.enrich({ ...mergeData(previous ?? {}, snapshot, this.limits.maxAiResults),
      id, isDeleted: true, deletedAt: payload.deletedAt ?? Date.now(),
    }));
    this.tweetCache.set(id, tweet); this.trim(this.tweetCache, this.limits.maxTweets);
    this.remember(`tweet:${id}`);
    if (!previous?.isDeleted) {
      this.emit('tweet_deleted', { ...payload, id, tweet });
      this.emit('feed', { kind: 'tweet', action: 'delete', item: tweet, context: { sourceEvent: 'tweet_deleted', historical: false, previous } });
    }
  }
  private external(payload: Data): void {
    const type = string(payload.type);
    if (!externalUpdates.has(type)) {
      if (!identifier(payload.id)) return this.invalid('external_message', payload, 'Expected a post id');
      this.storeTweet(payload, 'external_message', false, true); return;
    }
    const id = identifier(payload.id);
    const target = id ? this.tweetCache.get(id) : this.tweets.find(tweet => {
      const key = postKey(payload.tiktokUrl);
      return !!key && tweetKeys(tweet).includes(key);
    });
    // The site guesses the latest Instagram/TruthSocial post when the ID is absent.
    // Keep the raw packet available but do not silently modify an unrelated post.
    if (!id && !target) return this.invalid('external_message', payload, 'Cannot correlate external update without a post id or matching URL');
    let patch: Data;
    if (type === 'CARD_UPDATE') patch = { card: payload.card };
    else if (type === 'YOUTUBE_DELETION') patch = { youtubeDeleted: true };
    else if (type === 'YOUTUBE_IMAGE_UPDATE') {
      if (!string(payload.imageUrl)) return this.invalid('external_message', payload, 'Expected imageUrl');
      patch = { media: { images: [payload.imageUrl], thumbnails: [payload.imageUrl] } };
    } else {
      if (!string(payload.videoUrl)) return this.invalid('external_message', payload, 'Expected videoUrl');
      const videos = array(target?.media.videos);
      patch = { media: { videos: videos.some(video => (typeof video === 'string' ? video : object(video).url) === payload.videoUrl)
        ? videos : [...videos, { url: payload.videoUrl, ...(payload.poster ? { poster: payload.poster } : {}) }] } };
    }
    this.patchTarget({ id: target?.id ?? id }, patch, 'external_message');
  }
  /** Processes one incoming Socket.IO packet. Never imports or evaluates source.js. */
  handle(event: string, ...args: unknown[]): void {
    this.sweep(); this.emit('raw', event, ...args);
    const payload = args[0];
    if (event === 'initialTweets') {
      if (!Array.isArray(payload)) return this.invalid(event, payload, 'Expected an array of tweets');
      const valid: Data[] = [];
      for (const item of payload) {
        if (isObject(item) && identifier(item.id)) valid.push(item);
        else this.invalid(event, item, 'Expected a tweet with a string or safe integer id');
      }
      // Mark all history as seen, but retain only the configured window.
      for (const item of [...valid].reverse()) this.remember(`tweet:${identifier(item.id)}`);
      const existingOrder = [...this.tweetCache.keys()], existingIds = new Set(existingOrder);
      const tweets = valid.slice(0, this.limits.maxTweets).reverse().map(item => this.storeTweet(item, event, true)).reverse();
      const order = [...tweets].reverse().map(tweet => tweet.id).filter(id => !existingIds.has(id)).concat(existingOrder);
      const entries = order.map(id => [id, this.tweetCache.get(id)!] as const);
      this.tweetCache.clear();
      for (const [id, tweet] of entries) this.tweetCache.set(id, tweet);
      this.trim(this.tweetCache, this.limits.maxTweets);
      this.emit('initialTweets', tweets); return;
    }
    if (event === 'connected_users') {
      if (!Array.isArray(payload)) return this.invalid(event, payload, 'Expected an array');
      this.connectedUsers = [...payload]; this.emit(event, this.connectedUsers); return;
    }
    if (event === 'pnl_update') {
      if (payload != null) { this.latestPnl = payload; this.emit(event, payload); } return;
    }
    if (!(SITE_EVENTS as readonly string[]).includes(event)) return; // Unknown protocol additions remain observable via raw.
    if (!isObject(payload)) return this.invalid(event, payload, 'Expected an object payload');
    if ((ACTIVITY_EVENTS as readonly string[]).includes(event)) return this.activity(event as ActivityEvent, payload);
    if (['tweet', 'tweet_update', 'tweet.subtweet.update'].includes(event)) {
      if (!identifier(payload.id)) return this.invalid(event, payload, 'Expected a string or safe integer id');
      this.storeTweet(payload, event); return;
    }
    if (event === 'tweet_deleted') return this.deleteTweet(payload);
    if (event === 'token_meta') {
      const meta = object(payload.tokenMeta), mint = string(meta.mint).trim();
      if (!mint) this.invalid(event, payload, 'Expected tokenMeta.mint');
      else this.patchTarget(payload, { tokenMeta: { [mint]: { ...meta, mint } } }, event);
    } else if (event === 'ai_suggestion') {
      const { tweet_id, tweet_url, ...suggestion } = payload;
      if (!suggestion.prediction || !suggestion.ticker) this.invalid(event, payload, 'Expected prediction and ticker');
      else this.patchTarget(payload, { aiSuggestion: suggestion }, event);
    } else if (event === 'ai_suggestion_update') {
      if (!Array.isArray(payload.results)) this.invalid(event, payload, 'Expected a results array');
      else if (payload.results.length) this.patchTarget(payload, { aiSuggestionResults: payload.results }, event);
    } else if (event === 'follow_scan') {
      const id = identifier(payload.id);
      if (!id || !isObject(payload.scan)) this.invalid(event, payload, 'Expected id and scan');
      else {
        const activity = this.activityCache.get(id);
        if (!activity) this.queue(`activity:${id}`, { followScan: payload.scan });
        else {
          const next = { ...activity, followScan: payload.scan }; this.activityCache.set(id, next);
          this.emit('feed', { kind: 'activity', action: 'update', item: next });
        }
      }
    } else if (event === 'external_message') this.external(payload);
    else if (event === 'hidden_accounts_updated') this.hiddenAccounts = hiddenHandles(payload.hidden);
    else if (event === 'custom_accounts_list') this.customAccounts = customAccounts(payload);
    else if (event === 'main_feed_auto_add_updated' && payload.success) this.autoHideNewAccounts = payload.noAutoAdd === true;
    else if (event === 'admin_alert' && string(payload.message).trim()) this.adminAlert = payload;
    else if (event === 'admin_alert_clear' && (!payload.id || !this.adminAlert?.id || payload.id === this.adminAlert.id)) this.adminAlert = null;
    this.emit(event as ForwardedEvent, payload);
  }
}
