import WebSocket from './ws-codec.js';
import { Easy, O } from './native.js';
import { CurlStream } from './curl-stream.js';
import { asHTTP, headerPairs, httpURL, PROFILE, trustworthy } from './profile.js';

export class BrowserSocket {
  constructor(raw, { maxQueuedBytes = 16 * 1024 * 1024, maxQueuedMessages = 1024 } = {}) {
    this.raw = raw; this.queue = []; this.waiters = []; this.queuedBytes = 0; this.failure = null;
    this.closed = new Promise(resolve => {
      raw.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString(), wasClean: code !== 1006 };
        for (const waiter of this.waiters.splice(0)) this.failure ? waiter.reject(this.failure) : waiter.resolve(null);
        resolve(this.closeInfo);
      });
    });
    raw.on('error', error => { this.failure = error; });
    raw.on('message', (data, binary) => {
      const message = { type: binary ? 'binary' : 'text', data: binary ? Buffer.from(data) : data.toString() };
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(message);
      else {
        const bytes = Buffer.byteLength(message.data);
        if (this.queuedBytes + bytes > maxQueuedBytes || this.queue.length >= maxQueuedMessages) {
          this.failure = new Error('WebSocket receive queue limit exceeded');
          raw.terminate(); return;
        }
        this.queuedBytes += bytes; this.queue.push(message);
      }
    });
  }
  get protocol() { return this.raw.protocol; }
  get extensions() { return this.raw.extensions; }
  send(data) {
    if (typeof data !== 'string' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) return Promise.reject(new TypeError('send expects a string, Buffer, or Uint8Array'));
    if (this.raw.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket is not open'));
    return new Promise((resolve, reject) => this.raw.send(data, { binary: typeof data !== 'string', compress: true }, error => error ? reject(error) : resolve()));
  }
  receive() {
    if (this.queue.length) { const message = this.queue.shift(); this.queuedBytes -= Buffer.byteLength(message.data); return Promise.resolve(message); }
    if (this.failure) return Promise.reject(this.failure);
    if (this.closeInfo) return Promise.resolve(null);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  async *[Symbol.asyncIterator]() { let message; while ((message = await this.receive()) !== null) yield message; }
  async close(code = 1000, reason = '') {
    if (code !== 1000 && !(code >= 3000 && code <= 4999)) throw new RangeError('Application close code must be 1000 or 3000–4999');
    if (Buffer.byteLength(reason) > 123) throw new RangeError('Close reason exceeds 123 bytes');
    if (this.closeInfo) return this.closeInfo;
    const timer = setTimeout(() => this.raw.terminate(), 5000);
    try { this.raw.close(code, reason); return await this.closed; }
    finally { clearTimeout(timer); }
  }
  terminate() { this.raw.terminate(); }
}

export async function openSocket(client, input, options = {}) {
  const url = httpURL(input, ['ws:', 'wss:']);
  if (url.hash) throw new TypeError('WebSocket URLs cannot contain fragments');
  const origin = options.origin || client.origin;
  if (!origin) throw new TypeError('WebSocket origin is required (the initiating page origin)');
  const originURL = httpURL(origin);
  const timeoutMs = options.timeoutMs ?? client.timeoutMs;
  const protocols = options.protocols || [];
  if (!Array.isArray(protocols) || new Set(protocols).size !== protocols.length || protocols.some(p => typeof p !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(p))) throw new TypeError('Invalid or duplicate WebSocket subprotocol');
  const extra = headerPairs(options.headers);
  const reserved = /^(host|connection|upgrade|origin|cookie|sec-websocket-.*|content-length|transfer-encoding|accept-encoding)$/i;
  if (extra.some(([name]) => reserved.test(name))) throw new TypeError('WebSocket handshake header is managed by the client');
  const signal = AbortSignal.any([client.abort.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
  const easy = new Easy(asHTTP(url).href, { caFile: client.caFile, timeoutMs, http1: true });
  easy.set(O.CONNECT_ONLY, 1);
  try { await client.transport.perform(easy, { signal, retain: true }); }
  catch (error) { easy.dispose(); throw error; }
  if (signal.aborted) { client.transport.release(easy); throw signal.reason; }
  const stream = new CurlStream(client.transport, easy);
  let raw;
  try {
    raw = new WebSocket(url.href, protocols, {
      createConnection: () => stream,
      followRedirects: false,
      maxPayload: options.maxPayload ?? 16 * 1024 * 1024,
      perMessageDeflate: { clientMaxWindowBits: true, threshold: 0, zlibDeflateOptions: { level: 6 } },
      finishRequest(req) {
        // Keep ws's cryptographic key/extension negotiation but serialize the
        // request in Chromium 136's HTTP/1 WebSocket handshake header order.
        const key = req.getHeader('Sec-WebSocket-Key');
        const extensions = req.getHeader('Sec-WebSocket-Extensions');
        for (const name of req.getHeaderNames()) req.removeHeader(name);
        const ordered = [
          ['Host', url.host], ['Connection', 'Upgrade'], ['Pragma', 'no-cache'],
          ['Cache-Control', 'no-cache'], ['Upgrade', 'websocket'], ['Origin', originURL.origin],
          ['Sec-WebSocket-Version', '13'], ['User-Agent', PROFILE.userAgent],
          ['Accept-Encoding', trustworthy(url) ? 'gzip, deflate, br, zstd' : 'gzip, deflate'],
          ['Accept-Language', client.language],
        ];
        const cookie = client.cookies.get(url, { initiator: originURL });
        if (cookie) ordered.push(['Cookie', cookie]);
        ordered.push(['Sec-WebSocket-Key', key], ['Sec-WebSocket-Extensions', extensions]);
        if (protocols.length) ordered.push(['Sec-WebSocket-Protocol', protocols.join(', ')]);
        for (const [name, value] of extra) {
          const existing = ordered.find(pair => pair[0].toLowerCase() === name.toLowerCase());
          if (existing) existing[1] = value; else ordered.push([name, value]);
        }
        for (const [name, value] of ordered) req.setHeader(name, value);
        req.end();
      },
    });
  } catch (error) { stream.destroy(); throw error; }
  const socket = new BrowserSocket(raw, options);
  client.sockets.add(socket);
  socket.closed.then(() => client.sockets.delete(socket));
  raw.on('upgrade', response => {
    for (const cookie of response.headers['set-cookie'] || []) client.cookies.set(cookie, url);
  });
  await new Promise((resolve, reject) => {
    const abort = () => { raw.terminate(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    raw.once('open', () => { cleanup(); resolve(); });
    raw.once('error', error => { cleanup(); reject(error); });
    raw.once('close', () => { cleanup(); reject(socket.failure || new Error('WebSocket closed before opening')); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  return socket;
}
