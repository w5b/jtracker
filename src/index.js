import { BrowserCookies } from './cookies.js';
import { Easy, native, O, Transport } from './native.js';
import { openSocket } from './websocket.js';
import { headerPairs, httpURL, PROFILE, relationship } from './profile.js';
import { requestHeaders } from './profile.js';
export { PROFILE } from './profile.js';

export class ChromiumClient {
  constructor({ origin, caFile, timeoutMs = 30_000, language = PROFILE.language, maxResponseBytes = 32 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
    headerPairs({ 'Accept-Language': language });
    this.origin = origin ? httpURL(origin).origin : undefined;
    this.caFile = caFile; this.timeoutMs = timeoutMs; this.language = language;
    this.maxResponseBytes = maxResponseBytes;
    this.cookies = new BrowserCookies(); this.transport = new Transport();
    this.abort = new AbortController(); this.sockets = new Set(); this.pending = new Set();
  }
  get backend() { const api = native(); return { profile: PROFILE, version: api.version, installation: api.installation }; }
  request(input, options = {}) {
    const promise = this._request(input, options);
    this.pending.add(promise);
    promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    return promise;
  }
  async _request(input, options) {
    let url = httpURL(input); url.hash = '';
    let method = (options.method || 'GET').toUpperCase();
    if (!/^[A-Z]+$/.test(method) || ['CONNECT', 'TRACE', 'TRACK'].includes(method)) throw new TypeError('Unsupported HTTP method');
    let headers = headerPairs(options.headers);
    let body = options.body;
    if (body !== undefined && options.json !== undefined) throw new TypeError('Use body or json, not both');
    let bodyType;
    if (options.json !== undefined) { body = JSON.stringify(options.json); bodyType = 'application/json'; }
    else if (typeof body === 'string') bodyType = 'text/plain;charset=UTF-8';
    if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) throw new TypeError('body must be a string, Buffer, or Uint8Array');
    if (body !== undefined && ['GET', 'HEAD'].includes(method)) throw new TypeError('GET/HEAD cannot carry a body');
    if (body !== undefined) body = Buffer.from(body);
    const context = { kind: 'navigation', ...options.context };
    if (context.initiator) context.initiator = httpURL(context.initiator).href;
    const credentials = options.credentials ?? (context.kind === 'fetch' ? 'same-origin' : 'include');
    if (!['include', 'same-origin', 'omit'].includes(credentials)) throw new TypeError('Invalid credentials mode');
    const redirect = options.redirect || 'follow';
    if (!['follow', 'manual', 'error'].includes(redirect)) throw new TypeError('Invalid redirect mode');
    if (options.httpVersion !== undefined && !['auto', '1.1'].includes(options.httpVersion)) throw new TypeError('httpVersion must be auto or 1.1');
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const signal = AbortSignal.any([this.abort.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
    let crossSiteRedirect = false;
    const history = [];
    for (let count = 0; ; count++) {
      signal.throwIfAborted();
      const useCookies = credentials === 'include' || credentials === 'same-origin' && relationship(url, context.initiator) === 'same-origin';
      const cookie = useCookies ? this.cookies.get(url, { initiator: context.initiator, navigation: context.kind === 'navigation', method, crossSiteRedirect }) : '';
      const outgoing = requestHeaders(url, { context, method, headers, cookie, language: this.language, bodyType });
      const easy = new Easy(url.href, { caFile: this.caFile, timeoutMs, http1: options.httpVersion === '1.1' });
      const chunks = []; let bytes = 0; let responseHeaders = []; let headerBytes = 0;
      try {
        easy.set(O.ACCEPT_ENCODING, outgoing.find(([name]) => name === 'accept-encoding')[1]);
        easy.headers([...outgoing, ['Expect', null], ...(!outgoing.some(([name]) => name === 'content-type') ? [['Content-Type', null]] : [])]);
        if (body !== undefined) easy.body(body);
        else if (['POST', 'PUT', 'PATCH'].includes(method)) easy.body(Buffer.alloc(0));
        easy.set(O.CUSTOMREQUEST, method);
        if (method === 'HEAD') easy.set(O.NOBODY, 1);
        easy.writer(O.WRITEFUNCTION, chunk => {
          bytes += chunk.length;
          if (bytes > (options.maxResponseBytes ?? this.maxResponseBytes)) throw new Error('Response exceeds maxResponseBytes after decompression');
          chunks.push(chunk);
        });
        easy.writer(O.HEADERFUNCTION, chunk => {
          headerBytes += chunk.length;
          if (headerBytes > 256 * 1024) throw new Error('Response headers exceed 256 KiB');
          const line = chunk.toString('latin1').trimEnd();
          if (/^HTTP\//.test(line)) responseHeaders = [];
          else {
            const colon = line.indexOf(':');
            if (colon > 0) responseHeaders.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
          }
        });
        await this.transport.perform(easy, { signal });
        const status = easy.infoLong(0x200002);
        const httpVersion = { 1: '1.0', 2: '1.1', 3: '2' }[easy.infoLong(0x20002e)] || 'unknown';
        if (useCookies) for (const [name, value] of responseHeaders) if (name === 'set-cookie') this.cookies.set(value, url);
        const response = new ChromiumResponse({ status, headers: responseHeaders, body: Buffer.concat(chunks), url: url.href, httpVersion, history: [...history] });
        const location = response.header('location');
        if (![301, 302, 303, 307, 308].includes(status) || !location || redirect === 'manual') return response;
        if (redirect === 'error') throw new Error('Redirect received with redirect:error');
        if (count >= (options.maxRedirects ?? 20)) throw new Error('Maximum redirects exceeded');
        const next = httpURL(new URL(location, url)); next.hash = '';
        history.push({ url: url.href, status });
        crossSiteRedirect ||= relationship(next, url) === 'cross-site';
        if (next.origin !== url.origin) headers = headers.filter(([name]) => !['authorization', 'proxy-authorization', 'origin', 'referer'].includes(name.toLowerCase()));
        if ((status === 303 && method !== 'HEAD') || ([301, 302].includes(status) && method === 'POST')) {
          method = 'GET'; body = undefined; bodyType = undefined;
          headers = headers.filter(([name]) => !['content-type', 'content-encoding', 'content-language', 'content-location'].includes(name.toLowerCase()));
        }
        url = next;
      } finally { easy.dispose(); }
    }
  }
  openWebSocket(url, options) {
    if (this.abort.signal.aborted) return Promise.reject(new Error('Client closed'));
    const promise = openSocket(this, url, options);
    this.pending.add(promise);
    promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    return promise;
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      this.abort.abort(new Error('Client closed'));
      await Promise.allSettled([...this.sockets].map(socket => socket.close()));
      await Promise.allSettled([...this.pending]);
      this.transport.close();
    })();
    return this.closePromise;
  }
  async [Symbol.asyncDispose]() { await this.close(); }
}

export class ChromiumResponse {
  constructor(values) { Object.assign(this, values); }
  get ok() { return this.status >= 200 && this.status < 300; }
  header(name) { return this.headers.find(([key]) => key === name.toLowerCase())?.[1] ?? null; }
  headerValues(name) { return this.headers.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value); }
  text() { return this.body.toString('utf8'); }
  json() { return JSON.parse(this.text()); }
}
