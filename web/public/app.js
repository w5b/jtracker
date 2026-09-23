// JTracker UI. Renders the local server's event stream; no build step and no dependencies.
// All post content is untrusted: it is inserted as text nodes, and only http(s) links are followed.

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  'bell-off': 'M3 3l18 18M8.7 3.9A6 6 0 0 1 18 8c0 3 .5 5 1.2 6.4M17 17H3s3-2 3-9c0-.7.1-1.4.3-2M13.7 21a2 2 0 0 1-3.4 0',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  repost: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  reply: 'M9 17l-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4',
  quote: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  zap: 'M13 2 4 14h8l-1 8 9-12h-8z',
  radar: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12l6.4-6.4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  'user-plus': 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M22 11h-6',
  'user-minus': 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 11h-6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  check: 'M20 6 9 17l-5-5',
  chevron: 'M6 9l6 6 6-6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  pin: 'M12 17v5M9 3h6l-1 6 4 3v2H6v-2l4-3z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  key: 'M14.5 13a5.5 5.5 0 1 0-4.9-3L3 16.5V21h4.5v-2.5H10V16h2.5l1.4-1.4a5.5 5.5 0 0 0 .6-1.6zM16.5 7.5h.01',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  // Simplified platform marks, not official logos.
  x: 'M5 4.5l14 15M19 4.5l-14 15',
  instagram: 'M7 2.5h10A4.5 4.5 0 0 1 21.5 7v10a4.5 4.5 0 0 1-4.5 4.5H7A4.5 4.5 0 0 1 2.5 17V7A4.5 4.5 0 0 1 7 2.5zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  tiktok: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.4 4.4 5 4.6',
  youtube: 'M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15l5-3-5-3z',
  truth: 'M5 5h14M12 5v14',
  binance: 'M12 3l3 3-3 3-3-3zM6 9l3 3-3 3-3-3zM18 9l3 3-3 3-3-3zM12 15l3 3-3 3-3-3z',
  telegram: 'M21.5 4.5 2.5 11.8l6.3 2.1 2.1 6.6 3.4-4.2 5.2 3.8zM8.8 13.9l9.7-7.4',
  pill: 'M7.5 6.5h9a5.5 5.5 0 0 1 0 11h-9a5.5 5.5 0 0 1 0-11zM12 6.5v11',
  flame: 'M12 22c4 0 7-2.7 7-6.8 0-4-3-6.2-4-9.2-1 2-2.1 3-3.5 3.4C12 6 11.5 3.7 9.5 2 9.8 6 5 8.8 5 15.2 5 19.3 8 22 12 22z',
  news: 'M4 4h13v16H6a2 2 0 0 1-2-2zM17 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3',
};
const FILLED = new Set(['play']);
const SOURCES = {
  x: { label: 'X', icon: 'x', color: '#e7e9ea' },
  instagram: { label: 'Instagram', icon: 'instagram', color: '#ff4f8b' },
  truth: { label: 'Truth Social', icon: 'truth', color: '#8b7dff' },
  binance: { label: 'Binance Square', icon: 'binance', color: '#f0b90b' },
  tiktok: { label: 'TikTok', icon: 'tiktok', color: '#25f4ee' },
  youtube: { label: 'YouTube', icon: 'youtube', color: '#ff4d6a' },
  telegram: { label: 'Telegram', icon: 'telegram', color: '#2aabee' },
  pump: { label: 'pump.fun', icon: 'pill', color: '#5eea8c' },
  pumpnews: { label: 'pump.fun news', icon: 'news', color: '#5eea8c' },
  fomo: { label: 'Fomo', icon: 'flame', color: '#ff8a4c' },
  subdomain: { label: 'Domains', icon: 'globe', color: '#94a3b8' },
  web: { label: 'Web', icon: 'globe', color: '#94a3b8' },
};
const FILTERS = [
  { id: 'all', label: 'All', icon: 'layers', test: () => true },
  { id: 'calls', label: 'Calls', icon: 'zap', test: post => post.tokens.length > 0 || post.addresses.length > 0 || !!post.ai },
  { id: 'custom', label: 'Your accounts', icon: 'users', test: post => isCustom(post) },
  { id: 'sources', label: 'Other sources', icon: 'globe', test: post => post.source !== 'x' },
  { id: 'deleted', label: 'Deleted', icon: 'trash', test: post => post.deleted },
];
const SOURCE_TABS = [
  { kind: 'telegram', label: 'Telegram', icon: 'telegram', placeholder: 'Channel or t.me link' },
  { kind: 'pump', label: 'pump.fun', icon: 'pill', placeholder: 'User, wallet or profile link' },
  { kind: 'fomo', label: 'Fomo', icon: 'flame', placeholder: 'Fomo handle' },
  { kind: 'subdomain', label: 'Domains', icon: 'globe', placeholder: 'Domain, like example.com' },
];
const MAX_CARDS = 250, MAX_POSTS = 700;

// Helpers -------------------------------------------------------------------

const $ = selector => document.querySelector(selector);
const lower = value => String(value ?? '').toLowerCase();
const isHttp = url => typeof url === 'string' && /^https?:\/\//i.test(url);
const storage = {
  get(key, fallback) { try { const value = localStorage.getItem(`jtracker:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`jtracker:${key}`, JSON.stringify(value)); } catch { /* storage can be unavailable */ } },
};
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'vars') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false && child !== '') el.append(child);
  return el;
}
function icon(name) {
  const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  if (FILLED.has(name)) svg.setAttribute('fill', 'currentColor');
  else {
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  }
  path.setAttribute('d', ICONS[name] ?? ICONS.info); svg.append(path);
  return svg;
}
function setIcon(el, name) { const svg = icon(name); const old = el.querySelector('svg'); if (old) old.replaceWith(svg); else el.prepend(svg); }
function verifiedBadge() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'verified'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Verified');
  const badge = document.createElementNS(NS, 'path'), tick = document.createElementNS(NS, 'path');
  badge.setAttribute('d', 'M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1z');
  badge.setAttribute('fill', 'currentColor');
  tick.setAttribute('d', 'M8 12.2l2.6 2.6L16.2 9'); tick.setAttribute('fill', 'none'); tick.setAttribute('stroke', '#fff');
  tick.setAttribute('stroke-width', '2.2'); tick.setAttribute('stroke-linecap', 'round'); tick.setAttribute('stroke-linejoin', 'round');
  svg.append(badge, tick);
  return svg;
}
/** A link that only ever opens http(s) URLs in a new tab, without a referrer. */
function ext(url, props, ...children) {
  if (!isHttp(url)) return h('span', props, ...children);
  return h('a', { ...props, href: url, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer' }, ...children);
}
function image(src, onError = el => el.remove()) {
  const el = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  el.addEventListener('error', () => onError(el), { once: true });
  return el;
}
function ago(ms) {
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const fullTime = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const clock = ms => h('time', { 'data-ts': String(ms), datetime: new Date(ms).toISOString(), title: fullTime(ms) }, ago(ms));
function usd(value) {
  if (!value) return '';
  const trim = (n, digits) => n.toFixed(digits).replace(/\.?0+$/, '');
  if (value >= 1e9) return `$${trim(value / 1e9, 2)}B`;
  if (value >= 1e6) return `$${trim(value / 1e6, 2)}M`;
  if (value >= 1e3) return `$${trim(value / 1e3, 1)}K`;
  return `$${Math.round(value)}`;
}
const shortAddress = address => address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
function hash(text) { let value = 2166136261; for (const char of text) { value ^= char.codePointAt(0); value = Math.imul(value, 16777619); } return value >>> 0; }
function gradient(seed) {
  const n = hash(seed || '?'), a = n % 360, b = (a + 30 + ((n >>> 9) % 60)) % 360;
  return `linear-gradient(135deg, hsl(${a} 74% 60%), hsl(${b} 70% 42%))`;
}
function initials(text) {
  // Letters and digits only, so "Alpha (demo)" gives "AD" and emoji-only names fall back to "?".
  const words = String(text || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '?';
  return ([...words[0]][0] + (words.length > 1 ? [...words[1]][0] : [...words[0]][1] ?? '')).toUpperCase();
}
function avatar(person, { size = '', source = null, square = false, label = null } = {}) {
  const seed = person.handle || person.name || '';
  const el = h('div', { class: `avatar${size ? ` ${size}` : ''}${square ? ' square' : ''}`, vars: { '--avatar': gradient(seed) }, 'aria-hidden': 'true' }, label ?? initials(person.name || person.handle));
  const url = person.avatar || state.avatars.get(lower(person.handle));
  if (isHttp(url)) el.append(image(url));
  if (source && source !== 'x') {
    const meta = SOURCES[source] ?? SOURCES.web;
    el.append(h('span', { class: 'src-badge', vars: { '--src': meta.color }, title: meta.label }, icon(meta.icon)));
  }
  return el;
}
function profileUrl(source, handle) {
  if (!handle || !/^[\w.-]{1,64}$/.test(handle)) return '';
  const safe = encodeURIComponent(handle);
  return {
    x: `https://x.com/${safe}`, instagram: `https://www.instagram.com/${safe}/`, tiktok: `https://www.tiktok.com/@${safe}`,
    truth: `https://truthsocial.com/@${safe}`, telegram: `https://t.me/${safe}`, pump: `https://pump.fun/profile/${safe}`, youtube: `https://www.youtube.com/@${safe}`,
  }[source] ?? '';
}

// State ---------------------------------------------------------------------

const state = {
  posts: new Map(), activities: [], status: null, serverUp: false, ready: false,
  settings: { aiSuggestions: null, autoHide: null }, accounts: { custom: null, hidden: [] }, tracked: {},
  filter: FILTERS.some(f => f.id === storage.get('filter')) ? storage.get('filter') : 'all',
  query: '', token: null, paused: false, queue: [], arrivals: [],
  sound: storage.get('sound', false) === true, compact: storage.get('compact', false) === true,
  // Like the site's pauseOnHover setting, on unless turned off: new posts wait while the mouse is on the feed.
  pauseOnHover: storage.get('pauseOnHover', true) !== false, hovering: false,
  sourceTab: SOURCE_TABS.some(t => t.kind === storage.get('sourceTab')) ? storage.get('sourceTab') : 'telegram',
  hiddenOpen: storage.get('hiddenOpen', false) === true,
  avatars: new Map(), lastSeen: new Map(), tokenInfo: new Map(),
};
let CUSTOM = new Set(), HIDDEN = new Set();
const cards = new Map();
const feed = $('#feed'), feedWrap = $('#feed-wrap'), feedInner = $('#feed-inner'), newPill = $('#new-pill'), search = $('#search');
const isCustom = post => post.custom || CUSTOM.has(lower(post.author.handle));
const signedIn = () => state.status?.session === 'signed-in';
const signedOut = () => state.status?.session === 'signed-out';
const isHidden = post => post.source === 'x' && HIDDEN.has(lower(post.author.handle));
/** New posts wait while paused, while the mouse is on the feed, or while scrolled away from the top. */
const holding = () => state.paused || (state.pauseOnHover && state.hovering);

function remember(post) {
  // Token details from any post also label bare contract addresses elsewhere in the feed.
  for (const token of post.tokens) if (token.symbol || token.name) state.tokenInfo.set(token.mint, { ...state.tokenInfo.get(token.mint), ...token });
  for (const match of post.matches ?? []) {
    if (match.mint && (match.symbol || match.name) && !state.tokenInfo.has(match.mint)) state.tokenInfo.set(match.mint, { ...unknownToken(match.mint), ...match });
  }
  const handle = lower(post.author.handle);
  if (!handle) return;
  if (isHttp(post.author.avatar)) state.avatars.set(handle, post.author.avatar);
  if (!post.deleted) state.lastSeen.set(handle, Math.max(state.lastSeen.get(handle) ?? 0, post.createdAt));
}
function trimPosts() {
  if (state.posts.size <= MAX_POSTS) return;
  const oldest = [...state.posts.values()].sort((a, b) => a.receivedAt - b.receivedAt).slice(0, state.posts.size - MAX_POSTS + 50);
  for (const post of oldest) { state.posts.delete(post.id); cards.get(post.id)?.remove(); cards.delete(post.id); }
}

// Rich text and cards -------------------------------------------------------

const RICH = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}])|(?<![\w@])@(\w{1,15})|(?<![\w$])\$([A-Za-z][A-Za-z0-9_]{0,11})(?!\w)|(?<!\w)(0x[a-fA-F0-9]{40})(?!\w)|(?<!\w)([1-9A-HJ-NP-Za-km-z]{32,44})(?!\w)/g;
const prettyUrl = url => { const text = url.replace(/^https?:\/\/(www\.)?/i, ''); return text.length > 44 ? `${text.slice(0, 42)}…` : text; };
function caButton(address) {
  return h('button', { class: 'ca', type: 'button', title: `Copy ${address}`, onclick: event => { event.preventDefault(); event.stopPropagation(); copy(address, 'Contract address copied'); } }, shortAddress(address), icon('copy'));
}
function richText(text, source) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(RICH)) {
    const [whole, url, mention, ticker, evm, solana] = match;
    if (solana && !(/\d/.test(solana) && /[a-z]/.test(solana) && /[A-Z]/.test(solana))) continue;
    if (match.index > last) fragment.append(text.slice(last, match.index));
    last = match.index + whole.length;
    if (url) fragment.append(ext(url, { title: url }, prettyUrl(url)));
    else if (mention) fragment.append(source === 'x' ? ext(`https://x.com/${mention}`, { class: 'mention' }, `@${mention}`) : h('span', { class: 'mention' }, `@${mention}`));
    else if (ticker) fragment.append(h('button', { class: 'ticker', type: 'button', title: `Search $${ticker}`, onclick: () => setQuery(`$${ticker}`) }, `$${ticker}`));
    else fragment.append(caButton(evm || solana));
  }
  if (last < text.length) fragment.append(text.slice(last));
  return fragment;
}
function mediaGrid(media, interactive = true) {
  const items = [...media.videos.map(video => ({ video })), ...media.images.map(src => ({ src }))].slice(0, 4);
  const grid = h('div', { class: `media n${items.length}` });
  const dropTile = img => {
    const tile = img.closest('.tile'); tile?.remove();
    if (!grid.children.length) grid.remove(); else grid.className = `media n${grid.children.length}`;
  };
  for (const item of items) {
    if (item.src) { grid.append(interactive ? ext(item.src, { class: 'tile', title: 'Open image' }, image(item.src, dropTile)) : h('div', { class: 'tile' }, image(item.src, dropTile))); continue; }
    const { url, poster } = item.video;
    const tile = h(interactive ? 'button' : 'div', { class: 'tile', ...(interactive ? { type: 'button', 'aria-label': 'Play video' } : {}) },
      isHttp(poster) ? image(poster) : null, h('div', { class: 'play' }, h('span', null, icon('play'))));
    if (interactive) tile.addEventListener('click', () => {
      const video = h('video', { controls: true, autoplay: true, playsinline: true, preload: 'metadata', ...(isHttp(poster) ? { poster } : {}) });
      video.src = url;
      video.addEventListener('error', () => video.replaceWith(ext(url, { class: 'play' }, h('span', null, icon('external')))), { once: true });
      tile.replaceWith(h('div', { class: 'tile' }, video));
    });
    grid.append(tile);
  }
  return grid;
}
function quoteBlock(quoted) {
  return ext(quoted.url, { class: 'quote' },
    h('div', { class: 'quote-head' }, avatar(quoted.author, { size: 'xs' }), h('span', { class: 'name', text: quoted.author.name }),
      quoted.author.handle && h('span', { class: 'handle', text: `@${quoted.author.handle}` })),
    quoted.text && h('div', { class: 'quote-text', text: quoted.text }),
    quoted.media.images.length || quoted.media.videos.length ? mediaGrid(quoted.media, false) : null);
}
function linkCard(card) {
  let domain = '';
  try { domain = new URL(card.url).hostname.replace(/^www\./, ''); } catch { /* no URL */ }
  return ext(card.url, { class: 'link-card' }, isHttp(card.image) ? image(card.image) : null,
    h('div', { class: 'link-card-body' }, h('div', { class: 'link-card-title', text: card.title || domain }), domain && h('div', { class: 'link-card-domain', text: domain })));
}
function tokenLinks(token) {
  if (/^0x/i.test(token.mint)) return [['Dexscreener', `https://dexscreener.com/search?q=${token.mint}`, 'chart']];
  return [
    ['Dexscreener', `https://dexscreener.com/solana/${token.mint}`, 'chart'],
    ...(token.mint.endsWith('pump') ? [['pump.fun', `https://pump.fun/coin/${token.mint}`, 'pill']] : []),
    ['Solscan', `https://solscan.io/token/${token.mint}`, 'external'],
  ];
}
function tokenRow(token, known = true) {
  const symbol = token.symbol ? `$${token.symbol.replace(/^\$/, '')}` : shortAddress(token.mint);
  return h('div', { class: `token${known ? '' : ' unknown'}` },
    avatar({ name: token.symbol || token.name || token.mint, handle: token.mint, avatar: token.image }, { size: 'sm', square: true, label: (token.symbol || '?').slice(0, 2).toUpperCase() }),
    h('div', { class: 'token-main' },
      h('div', { class: 'token-title' }, h('span', { class: 'token-sym', text: symbol }), h('span', { class: 'token-name', text: token.name || (known ? '' : 'Contract address') })),
      h('div', { class: 'token-ca', text: token.mint, title: token.mint })),
    token.marketCapUsd || token.liquidityUsd ? h('div', { class: 'token-stats' },
      token.marketCapUsd ? h('div', { class: 'mc', text: `MC ${usd(token.marketCapUsd)}` }) : null,
      token.liquidityUsd ? h('div', { class: 'liq', text: `Liq ${usd(token.liquidityUsd)}` }) : null) : null,
    h('div', { class: 'token-actions' },
      h('button', { class: 'icon-btn sm', type: 'button', title: 'Copy contract address', 'aria-label': 'Copy contract address', onclick: () => copy(token.mint, 'Contract address copied') }, icon('copy')),
      tokenLinks(token).map(([label, url, name]) => ext(url, { class: 'icon-btn sm', title: `Open on ${label}`, 'aria-label': `Open on ${label}` }, icon(name)))));
}
const unknownToken = mint => ({ mint, chain: /^0x/i.test(mint) ? 'evm' : 'sol', symbol: '', name: '', image: '', marketCapUsd: 0, liquidityUsd: 0 });
/** Tokens already launched on the AI's idea for a post. */
function matchesBlock(matches) {
  return h('div', { class: 'matches' }, h('div', { class: 'matches-title' }, icon('zap'), 'Already launched'),
    matches.map(match => h('div', { class: 'match' },
      avatar({ name: match.symbol || match.name, handle: match.mint || match.symbol, avatar: match.image }, { size: 'xs', square: true, label: (match.symbol || match.name || '?').slice(0, 2).toUpperCase() }),
      h('span', { class: 'match-sym', text: match.symbol ? `$${match.symbol}` : match.name }),
      match.symbol && match.name ? h('span', { class: 'match-name', text: match.name }) : null,
      match.mint ? h('span', { class: 'match-actions' },
        h('button', { class: 'icon-btn sm ghost', type: 'button', title: `Copy ${match.mint}`, 'aria-label': 'Copy contract address', onclick: () => copy(match.mint, 'Contract address copied') }, icon('copy')),
        tokenLinks({ mint: match.mint }).map(([label, url, name]) => ext(url, { class: 'icon-btn sm ghost', title: `Open on ${label}`, 'aria-label': `Open on ${label}` }, icon(name)))) : null)));
}
const latencyText = ms => ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;

function renderPost(post) {
  const custom = isCustom(post), meta = SOURCES[post.source] ?? SOURCES.web, handle = post.author.handle, suggestion = post.kind === 'suggestion';
  const card = h('article', { class: `post${custom ? ' is-custom' : ''}${post.deleted ? ' is-deleted' : ''}`, 'data-id': post.id });
  const latency = post.receivedAt - post.createdAt;
  const top = h('div', { class: 'meta-top' },
    ext(profileUrl(post.source, handle), { class: 'name', title: post.author.name }, post.author.name || handle || 'Unknown'),
    post.author.verified ? verifiedBadge() : null,
    handle && post.author.name !== `@${handle}` ? h('span', { class: 'handle', text: `@${handle}` }) : null,
    h('span', { class: 'sep', text: '·' }),
    Object.assign(clock(post.createdAt), { className: 'time' }),
    post.source === 'x' && !suggestion && post.receivedAt !== post.createdAt && latency >= 0 && latency < 120_000
      ? h('span', { class: 'latency', title: 'Time from posting to arrival here' }, `+${latencyText(latency)}`) : null);
  const tags = [];
  if (post.source !== 'x') tags.push(h('span', { class: 'tag src', vars: { '--src': meta.color } }, icon(meta.icon), meta.label + (post.kind && !['post', 'message', 'news'].includes(post.kind) ? ` · ${post.kind}` : '')));
  if (suggestion) tags.push(h('span', { class: 'tag ai' }, icon('sparkles'), 'AI call'));
  if (custom) tags.push(h('span', { class: 'tag gold' }, icon('users'), 'Your account'));
  if (post.kind === 'quote') tags.push(h('span', { class: 'tag' }, icon('quote'), 'Quote'));
  if (post.kind === 'reply') tags.push(h('span', { class: 'tag' }, icon('reply'), post.replyTo ? `Reply to @${post.replyTo}` : 'Reply'));
  if (post.kind === 'repost') tags.push(h('span', { class: 'tag' }, icon('repost'), post.repostOf?.handle ? `Reposted @${post.repostOf.handle}` : 'Repost'));
  if (post.deleted) tags.push(h('span', { class: 'tag red' }, icon('trash'), 'Deleted'));
  const body = h('div', { class: 'post-body' },
    post.text ? h('div', { class: 'post-text' }, richText(post.text, post.source))
      : suggestion ? h('div', { class: 'post-note', text: signedOut() ? 'Signed out, j7tracker sends the AI suggestion without the post text.' : 'Only the AI suggestion came through for this post.' }) : null,
    post.media.images.length || post.media.videos.length ? mediaGrid(post.media) : null,
    post.quoted ? quoteBlock(post.quoted) : null,
    post.card && !post.media.images.length ? linkCard(post.card) : null);
  const tokens = [...post.tokens.map(token => tokenRow(token)),
    ...post.addresses.map(address => state.tokenInfo.has(address) ? tokenRow(state.tokenInfo.get(address)) : tokenRow(unknownToken(address), false))];
  if (tokens.length) body.append(h('div', { class: 'tokens' }, tokens));
  if (post.ai) body.append(h('div', { class: 'ai', title: 'AI name and ticker suggestion for this post' }, icon('sparkles'), h('span', { class: 'ai-label', text: 'AI' }), post.ai.name, post.ai.ticker ? h('b', { text: `$${post.ai.ticker}` }) : null));
  if (post.matches?.length) body.append(matchesBlock(post.matches));
  const actions = h('div', { class: 'post-actions' });
  if (isHttp(post.url)) {
    actions.append(ext(post.url, { class: 'icon-btn sm', title: 'Open original', 'aria-label': 'Open original post' }, icon('external')),
      h('button', { class: 'icon-btn sm', type: 'button', title: 'Copy link', 'aria-label': 'Copy link', onclick: () => copy(post.url, 'Link copied') }, icon('link')));
  }
  if (post.source === 'x' && handle && signedIn()) {
    if (!custom) actions.append(h('button', { class: 'icon-btn sm', type: 'button', title: `Add @${handle} to your accounts`, 'aria-label': `Add @${handle} to your accounts`, onclick: event => addAccount(handle, event.currentTarget) }, icon('user-plus')));
    actions.append(h('button', { class: 'icon-btn sm danger', type: 'button', title: `Hide @${handle}`, 'aria-label': `Hide @${handle}`, onclick: event => setHidden(handle, true, event.currentTarget) }, icon('eye-off')));
  }
  card.append(h('div', { class: 'post-head' }, avatar(post.author, { source: post.source }), h('div', { class: 'post-meta' }, top, tags.length ? h('div', { class: 'tags' }, tags) : null)), body, actions);
  return card;
}

// Feed ----------------------------------------------------------------------

function matchesQuery(post, raw) {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  if (query.startsWith('@') && query.length > 1) {
    const handle = query.slice(1);
    return [post.author.handle, post.quoted?.author.handle, post.replyTo, post.repostOf?.handle].some(value => lower(value).includes(handle));
  }
  if (query.startsWith('$') && query.length > 1) {
    const symbol = query.slice(1);
    return lower(post.text).includes(query) || post.tokens.some(token => lower(token.symbol) === symbol) || lower(post.ai?.ticker) === symbol;
  }
  return [post.text, post.author.name, post.author.handle, post.quoted?.text, post.quoted?.author.handle, post.ai?.name, post.ai?.ticker,
    ...post.tokens.flatMap(token => [token.symbol, token.name, token.mint]), ...post.addresses,
    ...(post.matches ?? []).flatMap(match => [match.symbol, match.name, match.mint])].some(value => lower(value).includes(query));
}
function visible(post) {
  if (isHidden(post)) return false;
  if (!(FILTERS.find(filter => filter.id === state.filter) ?? FILTERS[0]).test(post)) return false;
  if (state.token && !post.tokens.some(token => token.mint === state.token) && !post.addresses.includes(state.token)) return false;
  return matchesQuery(post, state.query);
}
const newestFirst = (a, b) => b.receivedAt - a.receivedAt || b.createdAt - a.createdAt;
function emptyState() {
  if (!state.ready) return [h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })];
  const anyPosts = [...state.posts.values()].some(post => !isHidden(post));
  if (!anyPosts) {
    return h('div', { class: 'empty' }, h('div', { class: 'radar-art' }), h('h2', { text: 'Listening for posts' }),
      h('p', { text: state.status?.feed === 'offline' ? 'The feed is offline. The banner above says why.'
        : signedOut() ? 'Signed out, j7tracker sends AI coin suggestions for new posts. Sign in for the posts themselves.'
        : 'New posts from the accounts you track appear here the moment they land.' }));
  }
  return h('div', { class: 'empty' }, h('h2', { text: 'Nothing matches' }), h('p', { text: 'No posts match the current filter or search.' }),
    h('p', null, h('button', { class: 'btn secondary', type: 'button', onclick: clearFilters }, 'Clear filters')));
}
function renderFeed() {
  cards.clear();
  const matching = [...state.posts.values()].filter(visible).sort(newestFirst);
  const els = matching.slice(0, MAX_CARDS).map(post => { const card = renderPost(post); card.classList.add('static'); cards.set(post.id, card); return card; });
  feedInner.replaceChildren(...(els.length ? els : [emptyState()].flat()));
  state.queue = [];
  updateNewPill(); updateCounts();
  const narrowed = state.query || state.token || state.filter !== 'all';
  $('#showing').textContent = narrowed ? `${matching.length} ${matching.length === 1 ? 'post' : 'posts'}` : '';
}
function insertSorted(post, fresh) {
  const card = renderPost(post);
  if (fresh) { card.classList.add('is-fresh'); setTimeout(() => card.classList.remove('is-fresh'), 4500); } else card.classList.add('static');
  for (const el of feedInner.querySelectorAll(':scope > .empty, :scope > .skeleton')) el.remove();
  let before = null;
  for (const child of feedInner.children) {
    const other = state.posts.get(child.dataset.id);
    if (other && newestFirst(post, other) < 0) { before = child; break; }
  }
  feedInner.insertBefore(card, before);
  cards.set(post.id, card);
  while (feedInner.children.length > MAX_CARDS) { const last = feedInner.lastElementChild; cards.delete(last.dataset.id); last.remove(); }
}
function onPost(post, action) {
  const previous = state.posts.get(post.id);
  state.posts.set(post.id, post); remember(post); trimPosts();
  const arrival = action === 'new' && !previous;
  if (arrival) { state.arrivals.push(Date.now()); if (state.sound && visible(post) && (isCustom(post) || post.tokens.length || post.addresses.length)) beep(); }
  const existing = cards.get(post.id);
  if (existing) {
    if (!visible(post)) { existing.remove(); cards.delete(post.id); }
    else {
      const card = renderPost(post);
      card.classList.add('static');
      if (existing.classList.contains('is-fresh')) card.classList.add('is-fresh');
      existing.replaceWith(card); cards.set(post.id, card);
    }
  } else if (visible(post)) {
    if (holding() || feed.scrollTop > 80) { if (!state.queue.includes(post.id)) state.queue.push(post.id); updateNewPill(); }
    else insertSorted(post, arrival);
  }
  scheduleCounts(); scheduleSide();
}
/** "Paused" whenever the feed is held, like the site's indicator; otherwise the count of new posts, if any. */
function updateNewPill() {
  state.queue = state.queue.filter(id => state.posts.has(id) && !cards.has(id));
  const count = state.queue.length, paused = holding(), posts = `${count} new ${count === 1 ? 'post' : 'posts'}`;
  newPill.hidden = !paused && count === 0;
  newPill.classList.toggle('paused', paused);
  // replaceChildren would print a null child as the text "null", so only real nodes go in.
  if (paused) newPill.replaceChildren(...[icon('pause'), h('b', { text: 'Paused' }), count ? h('span', { class: 'pill-count', text: `· ${posts}` }) : null].filter(Boolean));
  else if (count) newPill.replaceChildren(icon('arrow-up'), posts);
  newPill.title = state.paused ? 'Paused. Click or press P to resume.'
    : paused ? 'Paused while your mouse is on the feed. Move it away, or click to show new posts.' : 'Show new posts';
}
function flushQueue() {
  const posts = state.queue.splice(0).map(id => state.posts.get(id)).filter(post => post && visible(post) && !cards.has(post.id)).sort((a, b) => -newestFirst(a, b));
  for (const post of posts) insertSorted(post, true);
  updateNewPill();
  feed.scrollTo({ top: 0, behavior: 'smooth' });
}
function updateCounts() {
  for (const filter of FILTERS) {
    const count = [...state.posts.values()].filter(post => !isHidden(post) && filter.test(post)).length;
    const badge = document.querySelector(`[data-filter="${filter.id}"] .n`);
    if (badge) badge.textContent = count ? String(count) : '';
  }
}
function clearFilters() { state.filter = 'all'; storage.set('filter', 'all'); state.token = null; setQuery(''); renderFilters(); renderTokenChip(); renderFeed(); renderRadar(); }
function setQuery(query) { search.value = query; state.query = query; renderFeed(); }
function setToken(mint) { state.token = state.token === mint ? null : mint; renderTokenChip(); renderFeed(); renderRadar(); }
function renderTokenChip() {
  const holder = $('#token-chip');
  if (!state.token) return holder.replaceChildren();
  const entry = radarData().find(item => item.mint === state.token);
  holder.replaceChildren(h('span', { class: 'chip' }, icon('zap'), h('span', { text: entry?.symbol ? `$${entry.symbol}` : shortAddress(state.token) }),
    h('button', { type: 'button', 'aria-label': 'Clear token filter', onclick: () => setToken(null) }, icon('close'))));
}
function renderFilters() {
  $('#filters').replaceChildren(...FILTERS.map(filter => h('button', {
    class: 'seg', type: 'button', role: 'tab', 'data-filter': filter.id, 'aria-selected': String(state.filter === filter.id),
    onclick: () => { state.filter = filter.id; storage.set('filter', filter.id); renderFilters(); renderFeed(); },
  }, icon(filter.icon), filter.label, h('span', { class: 'n' }))));
  updateCounts();
}

// Sidebars ------------------------------------------------------------------

function confirmButton(label, run) {
  const button = h('button', { class: 'icon-btn sm ghost danger', type: 'button', title: label, 'aria-label': label }, icon('trash'));
  let timer;
  button.addEventListener('click', async () => {
    if (!button.classList.contains('confirm')) {
      button.classList.add('confirm'); button.replaceChildren('Remove?');
      timer = setTimeout(() => { button.classList.remove('confirm'); button.replaceChildren(icon('trash')); }, 3000);
      return;
    }
    clearTimeout(timer);
    await run(button);
  });
  return button;
}
function openSignIn() {
  const dialog = $('#signin');
  closePanels();
  if (!dialog.open) dialog.showModal();
  $('#signin-token').focus();
}
/** "Sign in to ..." with a link that opens the sign-in dialog. */
const signInPrompt = text => h('li', { class: 'empty-row' }, `${text} `, h('button', { class: 'link-btn', type: 'button', onclick: openSignIn }, 'Sign in'));
function renderSession() {
  const status = state.status, demo = status?.mode === 'demo';
  const name = signedOut() ? 'Not signed in' : status?.session === 'checking' ? 'Checking session…'
    : status?.username ? `@${status.username}` : demo ? 'Demo session' : status ? 'Signed in' : 'Connecting…';
  $('#signout').hidden = !signedIn() && status?.session !== 'checking';
  $('#refresh').hidden = !signedIn();
  $('#signin-open').hidden = !signedOut();
  $('#session-name').textContent = name;
  $('#session-avatar').replaceChildren(initials(status?.username || (demo ? 'demo' : '·')));
  $('#session-avatar').style.setProperty('--avatar', gradient(status?.username || 'demo'));
  $('#conn-feed').className = `conn ${status?.feed ?? 'connecting'}`;
  $('#conn-social').className = `conn ${status?.social ?? 'connecting'}`;
  $('#session-region').textContent = demo ? 'Fictional data' : status?.region ?? '';
}
function renderStatus() {
  const status = state.status, pill = $('#status');
  let kind = 'connecting', text = 'Connecting', title = '';
  if (!state.serverUp && state.ready) { kind = 'offline'; text = 'UI server offline'; title = 'Lost the connection to the local server. Retrying…'; }
  else if (status?.session === 'checking') { kind = 'connecting'; text = 'Checking session'; }
  else if (status?.mode === 'demo' && status.feed === 'live') { kind = 'demo'; text = 'Demo feed'; title = 'Fictional data. Start without --demo for your live feed.'; }
  else if (status) {
    kind = status.feed === 'off' ? 'signed-out' : status.feed;
    text = { live: `Live · ${status.region}`, connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline', off: 'Feed off' }[status.feed] ?? status.feed;
    title = [status.error, signedOut() ? 'Not signed in: the feed works, account features need a session.' : ''].filter(Boolean).join(' ');
  }
  pill.className = `status-pill ${kind}`;
  pill.querySelector('.status-text').textContent = text;
  pill.title = title;
  const error = $('#signin-error'), sessionError = signedOut() && status?.error && status.feed !== 'offline' ? status.error : '';
  error.hidden = !sessionError; error.textContent = sessionError;
  if (signedIn() && $('#signin').open) $('#signin').close();
  const banner = $('#banner');
  if (status?.feed === 'offline' && status.mode !== 'demo') {
    banner.hidden = false;
    banner.replaceChildren(icon('alert'), h('div', null, h('b', { text: 'The feed is offline' }), status.error || 'j7tracker closed the connection.'),
      signedOut() ? h('button', { class: 'btn sm', type: 'button', onclick: openSignIn }, 'Sign in') : null);
  } else banner.hidden = true;
  renderSession();
}
function accountRow(handle) {
  const seen = state.lastSeen.get(lower(handle));
  return h('li', { class: 'row' }, avatar({ handle, name: handle }, { size: 'sm' }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: `@${handle}` }),
      h('div', { class: 'row-sub' }, seen ? ['Last post ', clock(seen)] : 'No posts seen yet')),
    h('div', { class: 'row-actions' },
      ext(profileUrl('x', handle), { class: 'icon-btn sm ghost', title: 'Open on X', 'aria-label': `Open @${handle} on X` }, icon('external')),
      confirmButton(`Remove @${handle}`, button => removeAccount(handle, button))));
}
function renderAccounts() {
  const custom = state.accounts.custom, list = custom?.accounts ?? [];
  $('#accounts-count').textContent = custom ? `${list.length}${custom.max ? ` / ${custom.max}` : ''}` : '—';
  $('#accounts-quota').style.setProperty('width', custom?.max ? `${Math.min(100, (list.length / custom.max) * 100)}%` : '0%');
  const filterInput = $('#account-filter');
  filterInput.hidden = list.length < 8;
  const query = lower(filterInput.value).replace(/^@/, '');
  const rows = list.filter(handle => !query || lower(handle).includes(query)).sort((a, b) => (state.lastSeen.get(lower(b)) ?? 0) - (state.lastSeen.get(lower(a)) ?? 0) || a.localeCompare(b)).map(accountRow);
  for (const el of document.querySelectorAll('#account-form input, #account-form button')) el.disabled = !signedIn();
  const waiting = state.ready && signedIn() ? 'Loading your accounts…' : 'Loading…';
  $('#accounts').replaceChildren(...(rows.length ? rows : [signedOut() ? signInPrompt('Your custom accounts need a session.')
    : h('li', { class: 'empty-row', text: !custom ? waiting : query ? 'No matches' : 'No custom accounts yet. Add an X handle above.' })]));
  const hidden = state.accounts.hidden;
  $('#hidden-count').textContent = String(hidden.length);
  $('#hidden-toggle').setAttribute('aria-expanded', String(state.hiddenOpen));
  $('#hidden').hidden = !state.hiddenOpen;
  $('#hidden-note').hidden = state.hiddenOpen && hidden.length > 0;
  $('#hidden').replaceChildren(...(hidden.length ? hidden.map(handle => h('li', { class: 'row' }, avatar({ handle, name: handle }, { size: 'sm' }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: `@${handle}` })),
    h('div', { class: 'row-actions' }, h('button', { class: 'icon-btn sm ghost', type: 'button', title: `Show @${handle} again`, 'aria-label': `Show @${handle} again`, onclick: event => setHidden(handle, false, event.currentTarget) }, icon('eye')))))
    : [h('li', { class: 'empty-row', text: 'Nothing hidden' })]));
}
function renderSources() {
  $('#source-tabs').replaceChildren(...SOURCE_TABS.map(tab => h('button', {
    class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(state.sourceTab === tab.kind), title: tab.label, 'aria-label': tab.label,
    onclick: () => { state.sourceTab = tab.kind; storage.set('sourceTab', tab.kind); renderSources(); },
  }, icon(tab.icon), h('span', { class: 'tab-label', text: tab.label }))));
  const tab = SOURCE_TABS.find(item => item.kind === state.sourceTab), view = state.tracked[tab.kind] ?? { items: [], limit: null, canManage: true };
  $('#sources-count').textContent = view.limit ? `${view.items.length} / ${view.limit}` : view.items.length ? String(view.items.length) : '';
  const input = $('#source-input');
  input.placeholder = !signedIn() ? 'Sign in to track sources' : view.canManage ? tab.placeholder : 'Managers only';
  input.disabled = !signedIn() || !view.canManage;
  $('#source-form button').disabled = input.disabled;
  $('#sources').replaceChildren(...(view.items.length ? view.items.map(item => h('li', { class: 'row' },
    avatar({ name: item.label, handle: item.id, avatar: item.avatar }, { size: 'sm' }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: item.label || item.id }), item.detail && h('div', { class: 'row-sub', text: item.detail })),
    view.canManage ? h('div', { class: 'row-actions' }, confirmButton(`Stop tracking ${item.label || item.id}`, button => track(tab.kind, item.id, true, button))) : null))
    : [signedOut() ? signInPrompt(`Tracking ${tab.label} sources needs a session.`) : h('li', { class: 'empty-row', text: `No ${tab.label} sources tracked yet.` })]));
}
function setSwitch(el, value) { el.setAttribute('aria-checked', value == null ? 'mixed' : String(value === true)); }
function renderSettings() {
  // The site turns AI suggestions on by default; the server does not report the current value.
  setSwitch($('#set-ai'), signedIn() ? state.settings.aiSuggestions ?? true : null);
  setSwitch($('#set-autohide'), state.settings.autoHide);
  $('#set-ai').disabled = $('#set-autohide').disabled = !signedIn();
  setSwitch($('#set-compact'), state.compact);
  setSwitch($('#set-hover'), state.pauseOnHover);
  document.body.classList.toggle('compact', state.compact);
}
function radarData() {
  const tokens = new Map();
  for (const post of state.posts.values()) {
    if (isHidden(post)) continue;
    for (const token of [...post.tokens, ...post.addresses.map(unknownToken)]) {
      let entry = tokens.get(token.mint);
      if (!entry) tokens.set(token.mint, entry = { mint: token.mint, symbol: '', name: '', image: '', mc: 0, mcAt: 0, mentions: 0, authors: new Map(), first: Infinity, last: 0 });
      entry.symbol ||= token.symbol; entry.name ||= token.name; entry.image ||= token.image;
      if (token.marketCapUsd && post.receivedAt >= entry.mcAt) { entry.mc = token.marketCapUsd; entry.mcAt = post.receivedAt; }
      entry.mentions += 1;
      entry.first = Math.min(entry.first, post.receivedAt); entry.last = Math.max(entry.last, post.receivedAt);
      if (post.author.handle) entry.authors.set(lower(post.author.handle), post.author);
    }
  }
  return [...tokens.values()].sort((a, b) => b.last - a.last).slice(0, 30);
}
function renderRadar() {
  const data = radarData();
  $('#radar-count').textContent = data.length ? String(data.length) : '';
  $('#radar').replaceChildren(...(data.length ? data.map(entry => h('li', {
    class: `radar-row${state.token === entry.mint ? ' active' : ''}`, tabindex: '0', role: 'button',
    title: `${entry.symbol ? `$${entry.symbol}` : entry.mint}: filter the feed`, 'aria-pressed': String(state.token === entry.mint),
    onclick: () => setToken(entry.mint), onkeydown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setToken(entry.mint); } },
  },
  avatar({ name: entry.symbol || entry.mint, handle: entry.mint, avatar: entry.image }, { size: 'sm', square: true, label: (entry.symbol || '?').slice(0, 2).toUpperCase() }),
  h('div', { class: 'radar-main' },
    h('div', { class: 'radar-top' }, h('span', { class: 'radar-sym', text: entry.symbol ? `$${entry.symbol}` : shortAddress(entry.mint) }),
      entry.mentions > 1 ? h('span', { class: 'mentions', text: `×${entry.mentions}` }) : null),
    h('div', { class: 'radar-sub' }, h('span', { class: 'faces' }, [...entry.authors.values()].slice(0, 3).map(author => avatar(author, { size: 'xs' }))),
      h('span', { text: entry.name || [...entry.authors.values()].map(author => `@${author.handle}`).slice(0, 2).join(', ') || 'Contract address' }))),
  h('div', null, entry.mc ? h('div', { class: 'radar-mc', text: usd(entry.mc) }) : null, h('div', { class: 'radar-age' }, clock(entry.first)))))
    : [h('li', { class: 'empty-row', text: 'Tokens and contract addresses from the feed collect here.' })]));
}
function activityIcon(event) {
  if (event === 'following_update') return ['follow', 'user-plus'];
  if (event === 'unfollowing_update') return ['unfollow', 'user-minus'];
  if (event === 'profile_update') return ['profile', 'user'];
  if (event.includes('pinned')) return ['', 'pin'];
  return ['', 'activity'];
}
function renderActivity() {
  const items = state.activities.filter(item => !HIDDEN.has(lower(item.author.handle))).slice(0, 60);
  $('#activity-count').textContent = items.length ? String(items.length) : '';
  $('#activity').replaceChildren(...(items.length ? items.map(item => {
    const [tone, name] = activityIcon(item.event);
    const text = item.text.split(/(@\w{1,15})/).map(part => part.startsWith('@') ? h('b', { text: part }) : part);
    return h('li', { class: 'activity-row' }, h('span', { class: `activity-icon ${tone}` }, icon(name)), h('span', { class: 'activity-text' }, text),
      h('span', { class: 'activity-time' }, clock(item.receivedAt)));
  }) : [h('li', { class: 'empty-row', text: 'Follows and profile changes from tracked accounts show up here.' })]));
}

// Actions -------------------------------------------------------------------

function toast(level, message) {
  const holder = $('#toasts');
  const el = h('div', { class: `toast ${level}`, role: level === 'error' ? 'alert' : 'status' }, icon(level === 'error' ? 'alert' : level === 'success' ? 'check' : 'info'), h('div', { text: message }));
  holder.append(el);
  while (holder.children.length > 4) holder.firstElementChild.remove();
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, level === 'error' ? 6500 : 3200);
}
async function copy(text, message = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast('success', message); }
  catch { toast('error', 'The clipboard is not available here'); }
}
async function act(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function run(button, task) {
  if (button) button.disabled = true;
  try { const data = await task(); if (data.message) toast('success', data.message); return data; }
  catch (error) { toast('error', error.message); }
  finally { if (button?.isConnected) button.disabled = false; }
}
const addAccount = (handle, button) => run(button, () => act('/api/accounts/add', { handle }));
const removeAccount = (handle, button) => run(button, () => act('/api/accounts/remove', { handle }));
const setHidden = (handle, hidden, button) => run(button, () => act('/api/accounts/hidden', { handle, hidden }));
const track = (kind, target, remove, button) => run(button, () => act('/api/tracked', { kind, target, remove }));

let audio, lastBeep = 0;
function beep() {
  const now = performance.now();
  if (!audio || now - lastBeep < 700) return;
  lastBeep = now;
  const start = audio.currentTime;
  for (const [index, frequency] of [[0, 880], [1, 1320]]) {
    const oscillator = audio.createOscillator(), gain = audio.createGain(), at = start + index * 0.09;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.08, at + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(at); oscillator.stop(at + 0.15);
  }
}
function renderToggles() {
  const pause = $('#pause'), sound = $('#sound');
  pause.setAttribute('aria-pressed', String(state.paused)); pause.title = state.paused ? 'Resume (P)' : 'Pause (P)';
  setIcon(pause, state.paused ? 'play' : 'pause');
  sound.setAttribute('aria-pressed', String(state.sound)); setIcon(sound, state.sound ? 'bell' : 'bell-off');
  setIcon($('#theme'), currentTheme() === 'dark' ? 'sun' : 'moon');
}
function togglePause() {
  state.paused = !state.paused;
  renderToggles(); updateNewPill();
  if (!holding() && feed.scrollTop < 80) flushQueue();
}
/** Releases held posts once nothing is holding them and the feed is at the top. */
function releaseHeld() {
  if (!holding() && feed.scrollTop < 80 && state.queue.length) flushQueue();
  else updateNewPill();
}
const currentTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function togglePanel(side) {
  const open = !document.body.classList.contains(`show-${side}`);
  document.body.classList.remove('show-left', 'show-right');
  if (open) document.body.classList.add(`show-${side}`);
  $('#scrim').hidden = !open;
  $('#toggle-left').setAttribute('aria-expanded', String(open && side === 'left'));
  $('#toggle-right').setAttribute('aria-expanded', String(open && side === 'right'));
}
function closePanels() { document.body.classList.remove('show-left', 'show-right'); $('#scrim').hidden = true; }

function frame(fn) { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; }
function throttle(fn, ms) { let timer = null; return () => { if (timer) return; timer = setTimeout(() => { timer = null; fn(); }, ms); }; }
const scheduleRender = frame(() => { renderFeed(); renderAccounts(); renderRadar(); renderActivity(); renderTokenChip(); });
const scheduleCounts = throttle(updateCounts, 400);
const scheduleSide = throttle(() => { renderRadar(); renderActivity(); }, 700);

// Stream --------------------------------------------------------------------

function applyAccounts(accounts) {
  const before = [...CUSTOM].join() + '|' + [...HIDDEN].join();
  state.accounts = { custom: accounts.custom, hidden: accounts.hidden ?? [] };
  CUSTOM = new Set((accounts.custom?.accounts ?? []).map(lower));
  HIDDEN = new Set(state.accounts.hidden.map(lower));
  renderAccounts();
  if (before !== [...CUSTOM].join() + '|' + [...HIDDEN].join()) scheduleRender();
}
function connect() {
  const source = new EventSource('/api/stream');
  const on = (name, handler) => source.addEventListener(name, event => {
    try { handler(JSON.parse(event.data)); } catch (error) { console.error(`[stream] ${name}`, error); }
  });
  source.addEventListener('open', () => { state.serverUp = true; renderStatus(); });
  source.addEventListener('error', () => { state.serverUp = false; renderStatus(); });
  on('snapshot', snapshot => {
    state.status = snapshot.status; state.settings = snapshot.settings; state.ready = true;
    state.posts = new Map(snapshot.posts.map(post => [post.id, post]));
    for (const post of snapshot.posts) remember(post);
    state.activities = snapshot.activities;
    state.tracked = Object.fromEntries(snapshot.tracked.map(view => [view.kind, view]));
    applyAccounts(snapshot.accounts);
    renderStatus(); renderSettings(); renderSources(); scheduleRender();
  });
  on('post', ({ action, post }) => onPost(post, action));
  on('posts', posts => { for (const post of posts) { state.posts.set(post.id, post); remember(post); } trimPosts(); scheduleRender(); });
  on('activity', activity => { state.activities = [activity, ...state.activities.filter(item => item.id !== activity.id)].slice(0, 100); scheduleSide(); });
  on('status', status => {
    const changed = status.session !== state.status?.session;
    state.status = status; renderStatus();
    if (changed) { renderAccounts(); renderSources(); renderSettings(); scheduleRender(); }
  });
  on('accounts', applyAccounts);
  on('settings', settings => { state.settings = settings; renderSettings(); });
  on('tracked', view => { state.tracked[view.kind] = view; renderSources(); });
  on('notice', notice => toast(notice.level === 'error' ? 'error' : 'info', notice.message));
}

// Wiring --------------------------------------------------------------------

function init() {
  const theme = storage.get('theme', null);
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  for (const el of document.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon));
  renderFilters(); renderSources(); renderSettings(); renderAccounts(); renderRadar(); renderActivity(); renderToggles(); renderStatus();

  let searchTimer;
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = search.value; renderFeed(); }, 120); });
  $('#account-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#account-input'), handle = input.value.trim();
    if (!handle) return input.focus();
    const result = await addAccount(handle, event.submitter);
    if (result) input.value = '';
  });
  $('#account-filter').addEventListener('input', renderAccounts);
  $('#source-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#source-input'), target = input.value.trim();
    if (!target) return input.focus();
    const result = await track(state.sourceTab, target, false, event.submitter);
    if (result) input.value = '';
  });
  $('#signin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#signin-token'), token = input.value.trim(), error = $('#signin-error');
    const button = event.submitter ?? event.currentTarget.querySelector('button[type="submit"]');
    if (!token) return input.focus();
    button.disabled = true;
    try {
      const data = await act('/api/session', { token, remember: $('#signin-remember').checked });
      input.value = ''; error.hidden = true;
      $('#signin').close();
      toast('success', data.message);
    } catch (failure) {
      error.textContent = failure.message; error.hidden = false; input.select();
    } finally { button.disabled = false; }
  });
  $('#signin-open').addEventListener('click', openSignIn);
  $('#signin-close').addEventListener('click', () => $('#signin').close());
  // A click on the dialog element itself, outside its card, is a click on the backdrop.
  $('#signin').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $('#signout').addEventListener('click', event => run(event.currentTarget, () => act('/api/session/signout', {})));
  $('#hidden-toggle').addEventListener('click', () => { state.hiddenOpen = !state.hiddenOpen; storage.set('hiddenOpen', state.hiddenOpen); renderAccounts(); });
  $('#refresh').addEventListener('click', event => run(event.currentTarget, async () => { await act('/api/refresh', {}); return { message: 'Account data reloaded' }; }));
  $('#set-ai').addEventListener('click', event => {
    const next = !(state.settings.aiSuggestions ?? true);
    run(event.currentTarget, () => act('/api/settings', { aiSuggestions: next }).then(() => ({ message: `AI suggestions ${next ? 'on' : 'off'}` })));
  });
  $('#set-autohide').addEventListener('click', event => {
    const next = state.settings.autoHide !== true;
    run(event.currentTarget, () => act('/api/settings', { autoHide: next }).then(() => ({ message: next ? 'New shared feed accounts will be hidden' : 'New shared feed accounts will show' })));
  });
  $('#set-compact').addEventListener('click', () => { state.compact = !state.compact; storage.set('compact', state.compact); renderSettings(); });
  $('#pause').addEventListener('click', togglePause);
  $('#sound').addEventListener('click', () => {
    state.sound = !state.sound; storage.set('sound', state.sound);
    if (state.sound) { try { audio ??= new AudioContext(); void audio.resume(); beep(); } catch { /* no audio */ } }
    renderToggles();
  });
  $('#theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; storage.set('theme', next); renderToggles();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', renderToggles);
  const narrow = matchMedia('(max-width: 620px)'), placeholder = search.placeholder;
  const fitPlaceholder = () => { search.placeholder = narrow.matches ? 'Search' : placeholder; };
  narrow.addEventListener('change', fitPlaceholder); fitPlaceholder();
  $('#toggle-left').addEventListener('click', () => togglePanel('left'));
  $('#toggle-right').addEventListener('click', () => togglePanel('right'));
  $('#scrim').addEventListener('click', closePanels);
  // A click shows waiting posts at once; if the feed was paused with the button or P, it also resumes.
  newPill.addEventListener('click', () => { if (state.paused) { state.paused = false; renderToggles(); } flushQueue(); });
  feed.addEventListener('scroll', () => { if (feed.scrollTop < 10 && !holding() && state.queue.length) flushQueue(); }, { passive: true });
  // Mouse only: touch has no hover, and a tap would otherwise leave the feed on hold.
  // The wrapper includes the floating pill, so reaching for the pill still counts as hovering the feed.
  feedWrap.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { state.hovering = true; updateNewPill(); } });
  feedWrap.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') { state.hovering = false; releaseHeld(); } });
  $('#set-hover').addEventListener('click', () => { state.pauseOnHover = !state.pauseOnHover; storage.set('pauseOnHover', state.pauseOnHover); renderSettings(); releaseHeld(); });
  document.addEventListener('keydown', event => {
    const active = document.activeElement, typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    if (event.key === '/' && !typing) { event.preventDefault(); search.focus(); search.select(); }
    else if ((event.key === 'p' || event.key === 'P') && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) togglePause();
    else if (event.key === 'Escape') {
      if (typing) active.blur();
      if (state.query || state.token) { state.token = null; renderTokenChip(); setQuery(''); renderRadar(); }
      closePanels();
    }
  });
  setInterval(() => { for (const el of document.querySelectorAll('[data-ts]')) el.textContent = ago(Number(el.dataset.ts)); }, 5000);
  setInterval(() => {
    const since = Date.now() - 60_000;
    state.arrivals = state.arrivals.filter(at => at > since);
    $('#rate').replaceChildren(h('b', { text: String(state.arrivals.length) }), '/min');
  }, 2000);
  connect();
}
init();
