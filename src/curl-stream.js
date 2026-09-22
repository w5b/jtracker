import { Duplex } from 'node:stream';

// The socket is owned by libcurl/BoringSSL throughout its lifetime. Node never
// wraps this in a TLSSocket. Polling handles TLS WANT_READ/WRITE (CURLE_AGAIN).
export class CurlStream extends Duplex {
  constructor(transport, easy) {
    super();
    this.transport = transport; this.easy = easy;
    this.reading = false; this.pendingWrite = null;
    this.timer = setInterval(() => this.pump(), 2);
  }
  _read() { this.reading = true; }
  _write(chunk, encoding, callback) { this.pendingWrite = { chunk, offset: 0, callback }; this.pump(); }
  pump() {
    if (this.destroyed || !this.easy?.handle) return;
    try {
      const write = this.pendingWrite;
      if (write) {
        const remaining = write.chunk.subarray(write.offset);
        const count = [0];
        const code = this.easy.api.send(this.easy.handle, remaining, remaining.length, count);
        if (code !== 81) this.easy.check(code);
        write.offset += Number(count[0]);
        if (write.offset === write.chunk.length) { this.pendingWrite = null; write.callback(); }
      }
      // Bound work per tick for fairness and respect Duplex backpressure.
      for (let i = 0; i < 16 && this.reading && !this.destroyed; i++) {
        const buffer = Buffer.allocUnsafe(16_384), count = [0];
        const code = this.easy.api.recv(this.easy.handle, buffer, buffer.length, count);
        if (code === 81) break;
        this.easy.check(code);
        const n = Number(count[0]);
        if (!n) { this.reading = false; this.push(null); break; }
        if (!this.push(buffer.subarray(0, n))) this.reading = false;
      }
    } catch (error) { this.destroy(error); }
  }
  _final(callback) { callback(); this.destroy(); }
  _destroy(error, callback) {
    clearInterval(this.timer);
    if (this.pendingWrite) { const write = this.pendingWrite; this.pendingWrite = null; write.callback(error || new Error('Socket closed')); }
    if (this.easy) this.transport.release(this.easy);
    this.easy = null;
    callback(error);
  }
  setNoDelay() { return this; } // CURLOPT_TCP_NODELAY is already enabled.
  setKeepAlive() { return this; }
  setTimeout() { return this; } // The API owns explicit handshake/close deadlines.
}
