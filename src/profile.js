import { validateHeaderName, validateHeaderValue } from 'node:http';
import { getDomain } from 'tldts';

export const PROFILE = Object.freeze({
  id: 'chrome136', chromiumVersion: '136.0.7103.93', platform: 'macOS',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  language: 'en-US,en;q=0.9',
});
export function httpURL(input, protocols = ['http:', 'https:']) {
  const url = new URL(input);
  if (!protocols.includes(url.protocol)) throw new TypeError(`Unsupported URL protocol: ${url.protocol}`);
  if (url.username || url.password) throw new TypeError('Credentials in URLs are not supported; use an Authorization header');
  return url;
}
export function asHTTP(input) {
  const url = new URL(input);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  return url;
}
export function site(input) {
  const url = asHTTP(input);
  return `${url.protocol}//${getDomain(url.hostname, { allowPrivateDomains: true }) || url.hostname}`;
}
export function relationship(url, initiator) {
  if (!initiator) return 'none';
  if (asHTTP(url).origin === asHTTP(initiator).origin) return 'same-origin';
  return site(url) === site(initiator) ? 'same-site' : 'cross-site';
}
export function trustworthy(input) {
  const url = asHTTP(input);
  return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || /^127\./.test(url.hostname) || url.hostname === '[::1]';
}
export function headerPairs(headers = []) {
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
  const seen = new Set();
  return pairs.map(([name, value]) => {
    name = String(name); value = String(value);
    validateHeaderName(name); validateHeaderValue(name, value);
    if (seen.has(name.toLowerCase())) throw new TypeError(`Duplicate request header: ${name}`);
    seen.add(name.toLowerCase());
    return [name, value];
  });
}
export function requestHeaders(url, { context = {}, method = 'GET', headers, cookie, language, bodyType, credentials } = {}) {
  const kind = context.kind || 'navigation';
  if (!['navigation', 'fetch'].includes(kind)) throw new TypeError('context.kind must be navigation or fetch');
  if (kind === 'fetch' && !context.initiator) throw new TypeError('Fetch context requires an initiator URL');
  const relation = relationship(url, context.initiator);
  const base = [
    ['sec-ch-ua', '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"'],
    ['sec-ch-ua-mobile', '?0'], ['sec-ch-ua-platform', '"macOS"'],
    ...(kind === 'navigation' ? [['upgrade-insecure-requests', '1']] : []),
    ['user-agent', PROFILE.userAgent],
    ['accept', kind === 'navigation' ? 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' : '*/*'],
    ...(bodyType ? [['content-type', bodyType]] : []),
    ...(context.initiator && (kind === 'fetch' && relation !== 'same-origin' || !['GET', 'HEAD'].includes(method)) ? [['origin', new URL(context.initiator).origin]] : []),
    ['sec-fetch-site', relation], ['sec-fetch-mode', kind === 'navigation' ? 'navigate' : 'cors'],
    ...(kind === 'navigation' ? [['sec-fetch-user', '?1']] : []),
    ['sec-fetch-dest', kind === 'navigation' ? 'document' : 'empty'],
    ['accept-encoding', trustworthy(url) ? 'gzip, deflate, br, zstd' : 'gzip, deflate'],
    ['accept-language', language || PROFILE.language],
    ...(cookie && credentials !== 'omit' ? [['cookie', cookie]] : []),
    ['priority', kind === 'navigation' ? 'u=0, i' : 'u=1, i'],
  ];
  if (!trustworthy(url)) {
    for (let i = base.length - 1; i >= 0; i--) if (/^sec-(ch-ua|fetch-)/.test(base[i][0])) base.splice(i, 1);
  }
  const forbidden = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cookie', 'accept-encoding']);
  for (const [name, value] of headerPairs(headers)) {
    const lower = name.toLowerCase();
    if (forbidden.has(lower)) throw new TypeError(`Header ${name} is managed by the client`);
    const existing = base.find(pair => pair[0] === lower);
    if (existing) existing[1] = value; else base.push([lower, value]);
  }
  return headerPairs(base);
}
