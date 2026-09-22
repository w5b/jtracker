import koffi from 'koffi';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// libcurl's public ABI: long is 64 bits on LP64, 32 on Windows. Never use int*
// for a CURLINFO_LONG result. Koffi handles the platform's actual C layout.
export const O = Object.freeze({
  URL: 10002, PROXY: 10004, WRITEFUNCTION: 20011, POSTFIELDS: 10015,
  HTTPHEADER: 10023, HEADERFUNCTION: 20079, CUSTOMREQUEST: 10036, NOBODY: 44,
  FOLLOWLOCATION: 52, SSL_VERIFYPEER: 64, CAINFO: 10065, SSL_VERIFYHOST: 81,
  HTTP_VERSION: 84, NOSIGNAL: 99, ACCEPT_ENCODING: 10102, POSTFIELDSIZE: 60,
  CONNECT_ONLY: 141, TIMEOUT_MS: 155, CONNECTTIMEOUT_MS: 156, PIPEWAIT: 237,
  PROTOCOLS_STR: 10318, TCP_NODELAY: 121,
});
let singleton;
export function native() {
  if (singleton) return singleton;
  if (process.versions.bun) {
    const [major, minor, patch] = process.versions.bun.split('.').map(Number);
    if (major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch < 2)))) {
      throw new Error('This native transport requires Bun >=1.4.2 (tested) or Node >=22.15. Upgrade Bun before running it; Bun 1.2.2 fails in Koffi pointer I/O.');
    }
  }
  const dir = fileURLToPath(new URL('../.native/', import.meta.url));
  let installation;
  try { installation = JSON.parse(readFileSync(join(dir, 'install.json'))); }
  catch { throw new Error('Native backend not installed. Run npm run setup. No system-TLS fallback is allowed.'); }
  const path = join(dir, installation.library);
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash !== installation.librarySha256) throw new Error('Installed native library checksum mismatch; run npm run setup.');
  const lib = koffi.load(path);
  const f = declaration => lib.func(declaration);
  const api = {
    init: f('void *curl_easy_init(void)'), cleanup: f('void curl_easy_cleanup(void *)'),
    setopt: f('int curl_easy_setopt(void *, int, ...)'),
    getinfo: f('int curl_easy_getinfo(void *, int, ...)'),
    impersonate: f('int curl_easy_impersonate(void *, const char *, int)'),
    strerror: f('const char *curl_easy_strerror(int)'),
    append: f('void *curl_slist_append(void *, const char *)'),
    freeList: f('void curl_slist_free_all(void *)'),
    send: f('int curl_easy_send(void *, const void *, size_t, _Out_ size_t *)'),
    recv: f('int curl_easy_recv(void *, void *, size_t, _Out_ size_t *)'),
    multiInit: f('void *curl_multi_init(void)'),
    multiCleanup: f('int curl_multi_cleanup(void *)'),
    add: f('int curl_multi_add_handle(void *, void *)'),
    remove: f('int curl_multi_remove_handle(void *, void *)'),
    perform: f('int curl_multi_perform(void *, _Out_ int *)'),
    info: f('void *curl_multi_info_read(void *, _Out_ int *)'),
    version: f('const char *curl_version(void)')(),
    caFile: join(dir, 'ca-bundle.pem'), installation,
  };
  if (!api.version.includes('BoringSSL')) throw new Error(`Expected BoringSSL, got ${api.version}`);
  const globalInit = f('int curl_global_init(long)');
  if (globalInit(3)) throw new Error('curl_global_init failed');
  singleton = api;
  return api;
}

const Writer = koffi.proto('size_t ChromiumWriter(void *, size_t, size_t, void *)');
const MsgData = koffi.union('ChromiumCurlMsgData', { whatever: 'void *', result: 'int' });
const Msg = koffi.struct('ChromiumCurlMsg', { msg: 'int', easy_handle: 'void *', data: MsgData });
const address = p => koffi.address(p).toString();

export class Easy {
  constructor(url, { caFile, timeoutMs = 30_000, http1 = false } = {}) {
    this.api = native(); this.handle = this.api.init(); this.callbacks = []; this.lists = []; this.buffers = [];
    if (!this.handle) throw new Error('curl_easy_init failed');
    try {
      this.check(this.api.impersonate(this.handle, 'chrome136', 0));
      this.set(O.URL, url);
      this.set(O.PROTOCOLS_STR, 'http,https');
      this.set(O.PROXY, ''); // Explicit direct connections, independent of shell proxy variables.
      this.set(O.NOSIGNAL, 1);
      this.set(O.SSL_VERIFYPEER, 1); this.set(O.SSL_VERIFYHOST, 2);
      this.set(O.CAINFO, caFile || this.api.caFile);
      this.set(O.TIMEOUT_MS, timeoutMs); this.set(O.CONNECTTIMEOUT_MS, timeoutMs);
      this.set(O.HTTP_VERSION, http1 ? 2 : 4); // h1 only / h2 over TLS with h1 fallback
      this.set(O.TCP_NODELAY, 1);
      this.set(O.PIPEWAIT, 1);
    } catch (error) { this.dispose(); throw error; }
  }
  check(code) { if (code) throw new Error(`libcurl ${code}: ${this.api.strerror(code)}`); }
  set(option, value) {
    this.check(this.api.setopt(this.handle, option, typeof value === 'string' ? 'str' : 'long', value));
  }
  pointer(option, value) { this.check(this.api.setopt(this.handle, option, 'void *', value)); }
  headers(headers) {
    let list = null;
    for (const [name, value] of headers) {
      const next = this.api.append(list, value === null ? `${name}:` : value === '' ? `${name};` : `${name}: ${value}`);
      if (!next) { if (list) this.api.freeList(list); throw new Error('curl_slist_append failed'); }
      list = next;
    }
    this.lists.push(list); this.pointer(O.HTTPHEADER, list);
  }
  body(buffer) {
    this.buffers.push(buffer);
    this.set(O.POSTFIELDSIZE, buffer.length);
    this.pointer(O.POSTFIELDS, buffer);
  }
  writer(option, fn) {
    const callback = koffi.register((ptr, size, count) => {
      const length = Number(size) * Number(count);
      try {
        const chunk = Buffer.from(Buffer.from(koffi.view(ptr, length)));
        return fn(chunk) === false ? 0 : length;
      } catch (error) { this.callbackError = error; return 0; }
    }, koffi.pointer(Writer));
    this.callbacks.push(callback); this.pointer(option, callback);
  }
  infoLong(code) {
    const output = koffi.alloc('long', 1);
    try { this.check(this.api.getinfo(this.handle, code, 'void *', output)); return Number(koffi.decode(output, 'long')); }
    finally { koffi.free(output); }
  }
  dispose() {
    if (!this.handle) return;
    this.api.cleanup(this.handle); this.handle = null;
    this.callbacks.forEach(cb => koffi.unregister(cb));
    this.lists.forEach(list => { if (list) this.api.freeList(list); });
    this.callbacks = []; this.lists = []; this.buffers = [];
  }
}

// Nonblocking curl_multi_perform, driven on the JS thread. No native call blocks
// waiting for network I/O; no cross-thread JS callbacks or browser subprocesses.
export class Transport {
  constructor() { this.api = native(); this.handle = this.api.multiInit(); this.active = new Map(); this.retained = new Set(); }
  perform(easy, { signal, retain = false } = {}) {
    if (!this.handle) return Promise.reject(new Error('Client is closed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const key = address(easy.handle);
      const abort = () => this.finish(key, signal.reason ?? new Error('Aborted'));
      const code = this.api.add(this.handle, easy.handle);
      if (code) { reject(new Error(`curl_multi_add_handle: ${code}`)); return; }
      this.active.set(key, { easy, resolve, reject, signal, abort, retain });
      signal?.addEventListener('abort', abort, { once: true });
      this.timer ??= setInterval(() => this.tick(), 2);
      this.tick();
    });
  }
  tick() {
    try {
      const code = this.api.perform(this.handle, [0]);
      if (code && code !== -1) throw new Error(`curl_multi_perform: ${code}`);
      let ptr;
      while ((ptr = this.api.info(this.handle, [0]))) {
        const msg = koffi.decode(ptr, Msg);
        if (msg.msg === 1) {
          const entry = this.active.get(address(msg.easy_handle));
          const error = entry?.easy.callbackError || (msg.data.result ? new Error(`libcurl ${msg.data.result}: ${this.api.strerror(msg.data.result)}`) : null);
          this.finish(address(msg.easy_handle), error);
        }
      }
    } catch (error) { for (const key of this.active.keys()) this.finish(key, error); }
  }
  finish(key, error) {
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    entry.signal?.removeEventListener('abort', entry.abort);
    // CONNECT_ONLY easy handles must remain attached while easy_send/recv runs.
    if (entry.retain && !error) this.retained.add(entry.easy);
    else this.api.remove(this.handle, entry.easy.handle);
    if (error) entry.reject(error); else entry.resolve();
    if (!this.active.size) { clearInterval(this.timer); this.timer = null; }
  }
  release(easy) {
    if (this.retained.delete(easy)) this.api.remove(this.handle, easy.handle);
    easy.dispose();
  }
  close() {
    if (!this.handle) return;
    for (const key of this.active.keys()) this.finish(key, new Error('Client closed'));
    for (const easy of this.retained) this.release(easy);
    this.api.multiCleanup(this.handle); this.handle = null;
  }
}
