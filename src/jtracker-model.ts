/** Shapes inferred from the supplied site bundle. Unknown fields are retained. */
export type Data = Record<string, unknown>;
export interface Author extends Data {
  handle: string;
  name: string;
  avatar: string | null;
}
export interface Media extends Data {
  images: unknown[];
  videos: unknown[];
  thumbnails: unknown[];
}
export interface Tweet extends Data {
  id: string;
  text: string;
  /** Site-style display text; the original URLs remain in text. */
  displayText: string;
  author: Author;
  media: Media;
  isDeleted?: boolean;
  aiSuggestion?: Data;
  aiSuggestionResults?: unknown[];
  tokenMeta?: Data;
  quotedTweet?: Data;
  replyTo?: Data;
  retweetedQuote?: Data;
  repliedQuote?: Data;
  retweetedReplyTo?: Data;
}
export interface Activity {
  id: string;
  event: string;
  receivedAt: number;
  author: Author;
  target?: Author;
  changes?: string[];
  followScan?: Data;
  raw: Data;
}
export const isObject = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
export const object = (value: unknown): Data => isObject(value) ? value : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string => typeof value === 'string' ? value : '';
export function identifier(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  // Twitter snowflakes must arrive as strings; unsafe numbers have already lost precision.
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
}
export function author(value: unknown): Author {
  const user = object(value), profile = object(user.profile);
  return {
    ...user,
    handle: string(user.handle) || 'unknown',
    name: string(user.name) || string(profile.name) || string(user.handle) || 'Unknown User',
    avatar: string(user.avatar) || string(profile.avatar) || null,
  };
}
const trailingLinks = /(?:\s*(?:…\s*)?https?:\/\/(?:t\.co\/[^\s]+|(?:[\w-]+\.)?(?:x|twitter)\.com\/i\/web\/status\/\d+))+\s*$/i;
export function normalizeTweet(value: Data): Tweet {
  const media = object(value.media), text = string(value.text) || string(object(value.body).text);
  return {
    ...value,
    id: identifier(value.id)!, text, displayText: text.replace(trailingLinks, '').trimEnd(),
    author: author(value.author),
    media: { ...media, images: array(media.images), videos: array(media.videos), thumbnails: array(media.thumbnails) },
    ...(['QUOTE', 'RETWEET', 'REPLY'].includes(string(value.type)) ? {
      isQuote: value.type === 'QUOTE', isRetweet: value.type === 'RETWEET', isReply: value.type === 'REPLY',
    } : {}),
  };
}

function richerText(previous: unknown, incoming: unknown): unknown {
  if (typeof previous !== 'string' || typeof incoming !== 'string') return incoming ?? previous;
  const score = (text: string) => text.replace(/https?:\/\/\S+/gi, '').length;
  if (score(incoming) < score(previous) || (score(incoming) === score(previous) && incoming.length < previous.length)) return previous;
  const mentions = previous.match(/^((@\w+\s*)+)/)?.[0].trim().split(/\s+/).filter(mention => !incoming.includes(mention)) ?? [];
  return [...mentions, incoming].join(' ');
}
function mergeMedia(previous: unknown, incoming: unknown): Media {
  const before = object(previous), after = object(incoming);
  const longer = (key: string) => array(after[key]).length >= array(before[key]).length ? array(after[key]) : array(before[key]);
  const oldVideos = array(before.videos), newVideos = array(after.videos);
  return {
    ...before, ...after, images: longer('images'), thumbnails: longer('thumbnails'),
    videos: Array.from({ length: Math.max(oldVideos.length, newVideos.length) }, (_, index) => {
      const oldVideo = oldVideos[index], newVideo = newVideos[index];
      if (newVideo == null) return oldVideo;
      if (oldVideo == null) return newVideo;
      const oldObject = typeof oldVideo === 'string' ? { url: oldVideo } : object(oldVideo);
      const newObject = typeof newVideo === 'string' ? { url: newVideo } : object(newVideo);
      const result = { ...oldObject, ...newObject };
      for (const key of ['url', 'thumbnail', 'preview_image_url', 'poster']) if (!result[key] && oldObject[key]) result[key] = oldObject[key];
      return result;
    }),
  };
}
export function uniqueResults(previous: unknown, incoming: unknown, limit: number): unknown[] {
  const values = new Map<string, unknown>();
  for (const value of [...array(previous), ...array(incoming)]) values.set(JSON.stringify(value), value);
  return [...values.values()].slice(-limit);
}
/** Provider packets enrich a record. Missing/null fields and poorer text/media do not erase it. */
export function mergeData(previous: Data, incoming: Data, resultLimit = 100, depth = 0): Data {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || value == null) continue;
    const old = previous[key];
    if (key === 'text') merged[key] = richerText(old, value);
    else if (key === 'media' || key === 'originalMedia') merged[key] = mergeMedia(old, value);
    else if (key === 'aiSuggestionResults') merged[key] = uniqueResults(old, value, resultLimit);
    else if (['isDeleted', 'isCustomAccount', 'isQuote', 'isReply', 'isRetweet'].includes(key)) merged[key] = old === true || value;
    else if (isObject(old) && isObject(value) && depth < 8) {
      const next = mergeData(old, value, resultLimit, depth + 1);
      if (key === 'author' || key === 'originalAuthor') {
        for (const field of ['id', 'handle', 'name', 'avatar', 'badge']) {
          if ((!next[field] || next[field] === 'unknown' || next[field] === 'Unknown User') && old[field]) next[field] = old[field];
        }
        if (old.verified === true) next.verified = true;
      }
      merged[key] = next;
    }
    else merged[key] = value;
  }
  return merged;
}

/** Canonical keys for AI packets referring to an external post by URL. */
export function postKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
    let path = url.pathname.replace(/\/+$/, '');
    if (['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) {
      const id = path.match(/\/(?:status|statuses)\/(\d+)/)?.[1];
      if (id) return `x:${id}`;
    }
    if (host === 'youtube.com' || host === 'youtu.be') {
      const id = host === 'youtu.be' ? path.slice(1) : url.searchParams.get('v') || path.match(/^\/(?:shorts|live|embed|v)\/([^/]+)/)?.[1];
      if (id) return `youtube:${id}`; // Video IDs are case sensitive.
    }
    if (host === 'tiktok.com') {
      const id = path.match(/\/(?:video|photo)\/(\d+)/)?.[1];
      if (id) return `tiktok:${id}`;
    }
    if (host === 'binance.com') path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\/square\//i, '/square/');
    return `${host}${path}`;
  } catch { return; }
}
export function tweetKeys(tweet: Data): string[] {
  return [...new Set(['url', 'tweet_url', 'instagramUrl', 'truthSocialUrl', 'binanceSquareUrl', 'tiktokUrl', 'youtubeUrl']
    .map(key => postKey(tweet[key])).filter((key): key is string => !!key))];
}

/** The site's account-handle normalization: drops every @ and space, then lowercases. */
export function accountHandle(value: unknown): string {
  return String(value ?? '').replace(/[@\s]+/g, '').toLowerCase();
}
/** Hidden-account lists arrive as a handle array or as `{ x: [...] }`; the site accepts both. */
export function hiddenHandles(value: unknown): string[] {
  const list = Array.isArray(value) ? value : array(object(value).x);
  return [...new Set(list.map(accountHandle).filter(Boolean))];
}
export interface CustomAccounts extends Data {
  accounts: string[];
  availableAccounts: string[];
  customConfigured: boolean;
  deployCount: number;
  maxAccounts: number;
}
/** Shape shared by GET /api/accounts and the custom_accounts_list socket event, with the site's defaults. */
export function customAccounts(value: unknown): CustomAccounts {
  const data = object(value), count = (key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] as number : 0;
  return {
    ...data,
    accounts: array(data.accounts).filter((item): item is string => typeof item === 'string'),
    availableAccounts: array(data.availableAccounts).filter((item): item is string => typeof item === 'string'),
    customConfigured: data.customConfigured === true, deployCount: count('deployCount'), maxAccounts: count('maxAccounts'),
  };
}
