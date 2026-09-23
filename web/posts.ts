import { array, isObject, object, string } from '../src/jtracker-model.ts';
import type { Activity, Data, Tweet } from '../src/jtracker-model.ts';
import type { SocialTracker } from '../src/jtracker-api.ts';
import type { SocialEvent } from '../src/jtracker-social.ts';

/** One card shape for the browser, whatever platform or socket a post came from. */
export type Source = 'x' | 'instagram' | 'truth' | 'binance' | 'tiktok' | 'youtube' | 'telegram' | 'pump' | 'pumpnews' | 'fomo' | 'subdomain' | 'web';
export interface PostAuthor { name: string; handle: string; avatar: string; verified: boolean }
export interface PostMedia { images: string[]; videos: { url: string; poster: string }[] }
export interface PostToken { mint: string; chain: string; symbol: string; name: string; image: string; marketCapUsd: number; liquidityUsd: number }
export interface QuotedPost { author: PostAuthor; text: string; url: string; media: PostMedia }
/** A token already launched on the AI's idea for a post, from ai_suggestion_update results. */
export interface TokenMatch { mint: string; symbol: string; name: string; image: string }
export interface Post {
  id: string;
  source: Source;
  /** post, quote, reply, repost, or the source event kind (trade, callout, thesis, discovered...). */
  kind: string;
  createdAt: number;
  /** When this server first saw the post. History uses createdAt. */
  receivedAt: number;
  author: PostAuthor;
  text: string;
  url: string;
  media: PostMedia;
  quoted: QuotedPost | null;
  replyTo: string;
  repostOf: PostAuthor | null;
  card: { url: string; title: string; description: string; image: string } | null;
  /** Token metadata the tracker attached (mint, symbol, market cap). */
  tokens: PostToken[];
  /** Contract addresses found in the text that have no metadata yet. */
  addresses: string[];
  ai: { name: string; ticker: string } | null;
  /** Launched tokens matching the AI suggestion. */
  matches: TokenMatch[];
  deleted: boolean;
  custom: boolean;
}
export interface FeedActivity { id: string; event: string; receivedAt: number; author: PostAuthor; target: PostAuthor | null; text: string }
export interface TrackedItem { id: string; label: string; detail: string; avatar: string }
export interface TrackedView { kind: SocialTracker; items: TrackedItem[]; limit: number | null; canManage: boolean }

const EMPTY_MEDIA: PostMedia = { images: [], videos: [] };
const X_EPOCH = 1288834974657n;

/** Only absolute http(s) URLs reach the browser. */
export function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return '';
  try { return new URL(value.trim()).href; } catch { return ''; }
}
function number(value: unknown): number {
  const result = typeof value === 'string' ? Number(value) : value;
  return typeof result === 'number' && Number.isFinite(result) ? result : 0;
}
function id(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
/** Milliseconds from a number (seconds or ms) or a date string. NaN when absent. */
export function time(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? time(numeric) : Date.parse(value);
  }
  return NaN;
}
/** X snowflake IDs carry millisecond creation time, more precise than created_at. */
function snowflakeTime(value: string): number {
  if (!/^\d{16,20}$/.test(value)) return NaN;
  return Number((BigInt(value) >> 22n) + X_EPOCH);
}

// Suggestion names and tickers carry zero-width joiners (U+2060) and similar marks.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const clean = (value: unknown) => string(value).replace(INVISIBLE, '').trim();
// The site names token images after their mint (source.js line 37910).
const AXIOM_IMAGE = /^https:\/\/axiomtrading(?:-[a-z0-9]+)*\.axiom-cdn\.io\/([1-9A-HJ-NP-Za-km-z]{32,44})\.webp$/;
const PUMP_COIN = /pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/;
const TWEET_URL = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/i;

export function matchOf(value: unknown): TokenMatch | null {
  const item = object(value), image = safeUrl(item.image) || safeUrl(item.image_url);
  const mint = clean(item.mint) || clean(item.address) || (AXIOM_IMAGE.exec(image)?.[1] ?? '') || (PUMP_COIN.exec(string(item.url))?.[1] ?? '');
  const symbol = (clean(item.symbol) || clean(item.ticker)).replace(/^\$/, ''), name = clean(item.name);
  return symbol || name || mint ? { mint, symbol, name, image } : null;
}
/** Unique launched-token matches, by mint when known. */
export function matchesOf(value: unknown): TokenMatch[] {
  const seen = new Set<string>(), matches: TokenMatch[] = [];
  for (const item of array(value)) {
    const match = matchOf(item), key = match && (match.mint || `${match.symbol}|${match.name}`.toLowerCase());
    if (!match || seen.has(key!)) continue;
    seen.add(key!); matches.push(match);
  }
  return matches.slice(0, 8);
}

const EVM = /\b0x[a-fA-F0-9]{40}\b/g;
const SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
/** Solana and EVM contract addresses in text. Links are ignored; Solana matches need mixed case and a digit. */
export function findAddresses(text: string): string[] {
  const stripped = text.replace(/https?:\/\/\S+/gi, ' ');
  const found = [...stripped.matchAll(EVM)].map(match => match[0]);
  for (const [value] of stripped.matchAll(SOLANA)) if (/\d/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value)) found.push(value);
  return [...new Set(found)];
}

function person(value: unknown): PostAuthor {
  const data = object(value), profile = object(data.profile);
  const handle = (string(data.handle) || string(data.username) || string(data.screen_name)).replace(/^@/, '');
  return {
    name: string(data.name) || string(profile.name) || string(data.displayName) || handle || 'Unknown',
    handle: handle === 'unknown' ? '' : handle,
    avatar: safeUrl(data.avatar) || safeUrl(profile.avatar) || safeUrl(data.profile_image_url) || safeUrl(data.profilePictureLink),
    verified: data.verified === true || data.isVerified === true || data.is_blue_verified === true,
  };
}
function mediaOf(value: unknown): PostMedia {
  const data = object(value);
  const link = (item: unknown) => safeUrl(typeof item === 'string' ? item : object(item).url);
  const thumbnails = array(data.thumbnails).map(link).filter(Boolean);
  const videos = array(data.videos).map((item, index) => {
    const video = typeof item === 'string' ? { url: item } : object(item);
    return { url: safeUrl(video.url), poster: safeUrl(video.thumbnail) || safeUrl(video.preview_image_url) || safeUrl(video.poster) || thumbnails[index] || '' };
  }).filter(video => video.url);
  let images = array(data.images).map(link).filter(Boolean);
  if (!images.length && !videos.length) images = thumbnails;
  return { images: [...new Set(images)].slice(0, 4), videos: videos.slice(0, 2) };
}
function hasMedia(media: PostMedia): boolean { return media.images.length > 0 || media.videos.length > 0; }
function xUrl(handle: string, postId: unknown): string {
  const value = id(postId);
  return handle && /^\d+$/.test(value) ? `https://x.com/${encodeURIComponent(handle)}/status/${value}` : '';
}
function quotedOf(value: unknown): QuotedPost | null {
  if (!isObject(value)) return null;
  const author = person(value.author), text = string(value.text) || string(object(value.body).text), media = mediaOf(value.media);
  if (!text && !hasMedia(media)) return null;
  return { author, text, url: safeUrl(value.url) || xUrl(author.handle, value.id), media };
}
function tokensOf(value: unknown): PostToken[] {
  return Object.values(object(value)).filter(isObject).map(meta => {
    const mint = string(meta.mint).trim();
    return {
      mint, chain: string(meta.chain) || (/^0x/i.test(mint) ? 'evm' : 'sol'),
      symbol: string(meta.symbol).trim(), name: string(meta.name).trim(), image: safeUrl(meta.image),
      marketCapUsd: number(meta.marketCapUsd), liquidityUsd: number(meta.liquidityUsd),
    };
  }).filter(token => token.mint);
}
function sourceOf(tweet: Data): Source {
  if (tweet.isInstagram) return 'instagram';
  if (tweet.isTruthSocial) return 'truth';
  if (tweet.isBinanceSquare) return 'binance';
  if (tweet.isTikTok) return 'tiktok';
  if (tweet.isYouTube) return 'youtube';
  if (tweet.isTelegram) return 'telegram';
  if (tweet.isWebhook || tweet.isExternal) return 'web';
  return 'x';
}
const POST_URL_KEYS = ['url', 'tweet_url', 'instagramUrl', 'truthSocialUrl', 'binanceSquareUrl', 'tiktokUrl', 'youtubeUrl', 'sourceUrl'];

export function toPost(tweet: Tweet, receivedAt: number): Post {
  const source = sourceOf(tweet), author = person(tweet.author);
  const text = string(tweet.displayText) || string(tweet.text);
  const quoted = quotedOf(tweet.quotedTweet ?? tweet.retweetedQuote ?? tweet.repliedQuote);
  const own = mediaOf(tweet.media), media = hasMedia(own) ? own : mediaOf(tweet.originalMedia);
  const snowflake = source === 'x' ? snowflakeTime(tweet.id) : NaN;
  const stated = time(tweet.createdAt ?? tweet.created_at ?? tweet.timestamp);
  const createdAt = Number.isFinite(snowflake) ? snowflake : Number.isFinite(stated) ? stated : receivedAt;
  const tokens = tokensOf(tweet.tokenMeta), mints = new Set(tokens.map(token => token.mint));
  const card = object(tweet.card), ai = object(tweet.aiSuggestion), reply = object(tweet.replyTo);
  let url = '';
  for (const key of POST_URL_KEYS) if ((url = safeUrl(tweet[key]))) break;
  return {
    id: tweet.id, source,
    kind: tweet.isRetweet ? 'repost' : tweet.isQuote ? 'quote' : tweet.isReply ? 'reply' : 'post',
    createdAt, receivedAt, author, text,
    url: url || (source === 'x' ? xUrl(author.handle, tweet.id) : ''),
    media, quoted,
    replyTo: person(reply.author).handle || string(reply.handle).replace(/^@/, '') || string(reply.username),
    repostOf: tweet.isRetweet && isObject(tweet.originalAuthor) ? person(tweet.originalAuthor) : null,
    card: isObject(tweet.card) && (safeUrl(card.url) || string(card.title))
      ? { url: safeUrl(card.url), title: string(card.title), description: string(card.description), image: safeUrl(card.image) } : null,
    tokens,
    addresses: findAddresses(`${text} ${quoted?.text ?? ''}`).filter(address => !mints.has(address)),
    ai: clean(ai.prediction) || clean(ai.ticker) ? { name: clean(ai.prediction), ticker: clean(ai.ticker).replace(/^\$/, '').toUpperCase() } : null,
    matches: matchesOf(tweet.aiSuggestionResults),
    deleted: tweet.isDeleted === true, custom: tweet.isCustomAccount === true,
  };
}

/**
 * An AI suggestion whose post has not arrived. Without a session the feed sends only these:
 * the post's link, author handle and image, plus the AI's name and ticker for a coin.
 */
export function suggestionPost(payload: Data, receivedAt: number, matches: TokenMatch[] = []): Post | null {
  const link = safeUrl(payload.tweet_url), parts = TWEET_URL.exec(link);
  const postId = id(payload.tweet_id) || parts?.[2] || '';
  if (!postId) return null;
  const handle = parts?.[1] ?? '', created = snowflakeTime(postId), image = safeUrl(payload.image_url);
  const name = clean(payload.prediction), ticker = clean(payload.ticker).replace(/^\$/, '').toUpperCase();
  return card({
    id: postId, source: 'x', kind: 'suggestion', createdAt: Number.isFinite(created) ? created : receivedAt, receivedAt,
    author: { name: handle ? `@${handle}` : 'Unknown account', handle, avatar: '', verified: false },
    text: '', url: xUrl(handle, postId) || link, media: { images: image ? [image] : [], videos: [] },
    ai: name || ticker ? { name, ticker } : null, matches,
  });
}

function card(post: Partial<Post> & Pick<Post, 'id' | 'source' | 'kind' | 'createdAt' | 'receivedAt' | 'author' | 'text'>): Post {
  return {
    url: '', media: EMPTY_MEDIA, quoted: null, replyTo: '', repostOf: null, card: null, tokens: [], ai: null, matches: [], deleted: false, custom: false,
    addresses: findAddresses(post.text), ...post,
  };
}
function sourceToken(value: unknown): PostToken[] {
  const token = object(value), mint = string(token.address) || string(token.mint);
  if (!mint) return [];
  return [{
    mint, chain: /^0x/i.test(mint) ? 'evm' : 'sol', symbol: string(token.symbol), name: string(token.name),
    image: safeUrl(token.imageUrl) || safeUrl(token.tokenImageUrl) || safeUrl(token.image),
    marketCapUsd: number(token.marketCapUsd ?? token.marketCap), liquidityUsd: number(token.liquidityUsd),
  }];
}
const tokenLabel = (value: unknown) => { const token = object(value); return string(token.symbol) ? `$${string(token.symbol)}` : string(token.address) || 'token'; };
const tradeText = (data: Data) => `${data.side === 'sell' ? 'Sold' : 'Bought'} ${Number.isFinite(data.usdAmount) ? `$${Math.round(data.usdAmount as number).toLocaleString('en-US')} of ` : ''}${tokenLabel(data.token)}`;
const shortWallet = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

/** Converts a social-socket event the way the site's feed does (source.js near line 256860). */
export function socialPost(event: SocialEvent, payload: Data, receivedAt: number): Post | null {
  const kind = string(payload.kind), data = object(payload.data);
  const at = (value: unknown) => {
    const stated = time(value), received = time(payload.received_at);
    return Number.isFinite(stated) ? stated : Number.isFinite(received) ? received : receivedAt;
  };
  if (event === 'pump_event') {
    if (!['callout', 'reply', 'trade'].includes(kind)) return null;
    const key = id(data.id) || id(data.calloutId) || (kind === 'trade' ? id(data.tx) : '');
    if (!key) return null;
    const author = object(data.author), wallet = string(author.wallet);
    return card({
      id: `pump-${key}`, source: 'pump', kind, createdAt: at(data.timestamp), receivedAt,
      author: { name: string(author.displayName) || string(author.username) || (wallet ? shortWallet(wallet) : 'pump.fun caller'), handle: string(author.username) || wallet, avatar: safeUrl(author.avatar), verified: false },
      text: kind === 'trade' ? tradeText(data) : string(data.text) || `${kind === 'reply' ? 'Reply' : 'Callout'} on ${tokenLabel(data.token)}`,
      tokens: sourceToken(data.token),
    });
  }
  if (event === 'telegram_event') {
    if (kind && kind !== 'message') return null; // media-only updates carry no text
    const key = id(data.id);
    if (!key) return null;
    const channel = object(data.channel), name = string(channel.title) || string(channel.username) || 'Telegram';
    return card({
      id: `tg-${key}`, source: 'telegram', kind: 'message', createdAt: at(data.timestamp), receivedAt,
      author: { name, handle: string(channel.username) || id(channel.id), avatar: '', verified: false },
      text: string(data.text) || `${name} posted on Telegram`, url: safeUrl(data.url) || safeUrl(data.link),
    });
  }
  if (event === 'subdomain_event') {
    if (!['discovered', 'removed', 'reappeared'].includes(kind)) return null;
    const key = id(data.id);
    if (!key) return null;
    const host = string(data.host) || string(data.domain) || 'host';
    return card({
      id: `sub-${key}`, source: 'subdomain', kind, createdAt: at(data.timestamp), receivedAt,
      author: { name: host, handle: string(data.domain) || host, avatar: '', verified: false },
      text: string(data.summary) || (kind === 'removed' ? `${host} stopped resolving` : kind === 'reappeared' ? `${host} came back` : `New subdomain: ${host}`),
      url: /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}/` : '',
    });
  }
  if (event === 'pump_news_event') {
    const key = id(data.id) || id(data.articleId);
    if (!key) return null;
    const token = object(data.token);
    return card({
      id: `pumpnews-${key}`, source: 'pumpnews', kind: 'news', createdAt: at(data.publishedAt), receivedAt,
      author: { name: string(data.platform) || 'pump.fun', handle: 'pumpnews', avatar: safeUrl(token.tokenImageUrl) || safeUrl(token.imageUrl), verified: false },
      text: [string(data.headline), string(data.preview), tokenLabel(token)].filter(Boolean).join(' — '),
      url: safeUrl(data.url) || safeUrl(data.link), tokens: sourceToken(token),
    });
  }
  // fomo_event, which is also where the site files unknown channels.
  if (kind === 'new_account') {
    const key = id(data.userId);
    if (!key) return null;
    const name = string(data.displayName) || string(data.userHandle) || 'Fomo user';
    const smart = Number.isFinite(data.smartFollowerCount) ? ` — ${data.smartFollowerCount} smart followers` : '';
    return card({
      id: `fomo-newacct-${key}`, source: 'fomo', kind, createdAt: at(data.detectedAt), receivedAt,
      author: { name, handle: string(data.userHandle) || key, avatar: safeUrl(data.profilePictureLink), verified: false },
      text: `@${(string(data.userHandle) || name).replace(/^@/, '')} joined Fomo${smart}`,
    });
  }
  if (kind !== 'thesis' && kind !== 'trade') return null;
  const key = id(data.id) || id(data.tradeId);
  if (!key) return null;
  return card({
    id: `fomo-${key}`, source: 'fomo', kind, createdAt: at(data.timestamp), receivedAt,
    author: { name: string(data.displayName) || string(data.userHandle) || 'Fomo user', handle: string(data.userHandle) || id(data.userId), avatar: safeUrl(data.userImageUrl), verified: false },
    text: kind === 'thesis' ? string(data.thesis) || `Thesis on ${tokenLabel(data.token)}` : tradeText(data),
    tokens: sourceToken(data.token),
  });
}

const ACTIVITY_TEXT: Record<string, (who: string, target: string) => string> = {
  following_update: (who, target) => `${who} followed ${target}`,
  unfollowing_update: (who, target) => `${who} unfollowed ${target}`,
  profile_pinned_update: who => `${who} pinned a post`,
  profile_unpinned_update: who => `${who} unpinned a post`,
  profile_suspended_update: who => `${who} was suspended`,
  profile_deactivated_update: who => `${who} deactivated their account`,
  'affiliated.update': (who, target) => `${who} is now affiliated with ${target}`,
  'unaffiliated.update': (who, target) => `${who} is no longer affiliated with ${target}`,
  profile_affiliation_update: who => `${who} changed their affiliation`,
};
export function toActivity(activity: Activity): FeedActivity {
  const author = person(activity.author), target = activity.target ? person(activity.target) : null;
  const who = author.handle ? `@${author.handle}` : author.name, whom = target?.handle ? `@${target.handle}` : target?.name ?? 'someone';
  const text = activity.event === 'profile_update'
    ? `${who} changed their ${activity.changes?.length ? activity.changes.join(', ') : 'profile'}`
    : ACTIVITY_TEXT[activity.event]?.(who, whom) ?? `${who}: ${activity.event.replace(/[._]/g, ' ')}`;
  return { id: activity.id, event: activity.event, receivedAt: activity.receivedAt, author, target, text };
}

/** Tracker lists in one shape. `id` is the value the site sends to remove the item. */
export function trackedView(kind: SocialTracker, list: Data): TrackedView {
  const rows = array(list[{ fomo: 'fomo_users', pump: 'pump_users', telegram: 'telegram_channels', subdomain: 'domains' }[kind]]);
  const items = rows.map((row): TrackedItem | null => {
    if (typeof row === 'string') return row ? { id: row, label: row, detail: '', avatar: '' } : null;
    const item = object(row);
    if (kind === 'fomo') return { id: id(item.fomo_user_id), label: string(item.display_name) || string(item.handle), detail: string(item.handle) ? `@${string(item.handle)}` : '', avatar: safeUrl(item.avatar) };
    if (kind === 'pump') {
      const wallet = string(item.wallet);
      return { id: wallet, label: string(item.display_name) || string(item.username) || (wallet ? shortWallet(wallet) : ''), detail: string(item.username) ? `@${string(item.username)}` : wallet ? shortWallet(wallet) : '', avatar: safeUrl(item.avatar) };
    }
    if (kind === 'telegram') return { id: string(item.channel) || string(item.handle), label: string(item.title) || string(item.handle) || string(item.channel), detail: string(item.handle) ? `@${string(item.handle)}` : '', avatar: safeUrl(item.avatar) };
    return { id: string(item.domain), label: string(item.domain), detail: '', avatar: '' };
  }).filter((item): item is TrackedItem => !!item && !!item.id);
  return { kind, items, limit: typeof list.limit === 'number' && Number.isFinite(list.limit) ? list.limit : null, canManage: kind !== 'subdomain' || list.can_manage === true };
}
