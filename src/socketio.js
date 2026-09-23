import { io } from 'socket.io-client';
import { Transport } from 'engine.io-client';
import { encodePacket } from 'engine.io-parser';

/** Keep the official Engine.IO/Socket.IO protocol stack; replace only its I/O. */
export function createChromiumTransport(client, websocketOptions = {}) {
  return class ChromiumWebSocketTransport extends Transport {
    get name() { return 'websocket'; }

    doOpen() {
      this.openAbort = new AbortController();
      this.sendChain = Promise.resolve();
      void this.readLoop().catch(error => this.fail(error));
    }

    async readLoop() {
      const query = { ...this.query };
      if (!this.supportsBinary) query.b64 = '1';
      if (this.opts.timestampRequests) query[this.opts.timestampParam || 't'] = Date.now().toString(36);
      const uri = this.createUri(this.opts.secure ? 'wss' : 'ws', query);
      const protocols = this.opts.protocols ?? websocketOptions.protocols;
      const connection = await client.openWebSocket(uri, {
        ...websocketOptions,
        headers: this.opts.extraHeaders ?? websocketOptions.headers,
        protocols: typeof protocols === 'string' ? [protocols] : protocols,
        signal: AbortSignal.any([this.openAbort.signal, ...(websocketOptions.signal ? [websocketOptions.signal] : [])]),
      });
      if (this.readyState !== 'opening') { connection.terminate(); return; }
      this.connection = connection;
      this.onOpen();
      // receive() queues any Engine.IO handshake arriving before this loop starts.
      for await (const message of connection) {
        if (this.readyState !== 'open') break;
        this.onData(message.data);
      }
      if (this.readyState !== 'closed') {
        this.onClose({ description: 'Chromium WebSocket closed', context: await connection.closed });
      }
    }

    write(packets) {
      this.writable = false;
      // Engine.IO appends to its writeBuffer while a transport is busy. Snapshot
      // the flushed batch before awaiting anything or new attachments get sent twice.
      const batch = packets.slice();
      // Serialize the Engine.IO text packet and its binary attachments. Signal
      // drain only after actual writes complete, including asynchronous deflate.
      this.sendChain = this.sendChain.then(async () => {
        for (const packet of batch) {
          if (this.readyState !== 'open') return;
          let data = await new Promise(resolve => encodePacket(packet, this.supportsBinary, resolve));
          if (data instanceof ArrayBuffer) data = new Uint8Array(data);
          else if (ArrayBuffer.isView(data) && !(data instanceof Uint8Array)) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          await this.connection.send(data);
        }
        if (this.readyState === 'open') {
          this.writable = true;
          this.emitReserved('drain');
        }
      }).catch(error => this.fail(error));
    }

    fail(error) {
      if (this.readyState === 'closed') return;
      this.onError('Chromium WebSocket error', error);
      this.close();
    }

    doClose() {
      this.openAbort?.abort(new Error('Engine.IO transport closed'));
      if (this.connection) {
        const connection = this.connection;
        this.connection = null;
        void connection.close().catch(() => connection.terminate());
      }
    }
  };
}

/** Return an ordinary Socket.IO Socket, with a private native-only Manager. */
export function connectSocketIO(client, url, options = {}, websocketOptions = {}) {
  return io(url, {
    ...options,
    // An existing cached Manager or fallback transport could use Node TLS.
    forceNew: true,
    transports: [createChromiumTransport(client, websocketOptions)],
    upgrade: false,
    tryAllTransports: false,
  });
}

/** A connect_error message with its transport cause, such as a DNS or TLS failure. */
export function describeSocketError(error) {
  const cause = error?.description, text = cause instanceof Error ? cause.message
    : typeof cause === 'string' ? cause : typeof cause?.message === 'string' ? cause.message : '';
  return text && text !== error.message ? `${error.message}: ${text}` : String(error?.message ?? error);
}

/** Disconnect, then give Engine.IO time to flush the namespace DISCONNECT before the caller frees TLS. */
export async function closeSocketIO(socket, timeoutMs = 2000) {
  const engine = socket.io.engine;
  const drained = engine && engine.readyState !== 'closed' ? new Promise(resolve => {
    const finish = () => { clearTimeout(timer); engine.off('close', finish); resolve(); };
    const timer = setTimeout(finish, timeoutMs);
    engine.once('close', finish);
  }) : Promise.resolve();
  socket.disconnect();
  await drained;
}
