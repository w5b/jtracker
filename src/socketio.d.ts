import type { ManagerOptions, SocketOptions, Socket } from 'socket.io-client';
import type { Transport } from 'engine.io-client';
import type { ChromiumClient, WebSocketOptions } from './index.js';

export type ChromiumSocketIOOptions = Omit<Partial<ManagerOptions & SocketOptions>,
  'transports' | 'upgrade' | 'tryAllTransports' | 'forceNew' | 'agent' | 'ca' |
  'cert' | 'key' | 'ciphers' | 'rejectUnauthorized' | 'autoUnref'>;
export declare function createChromiumTransport(
  client: ChromiumClient, websocketOptions?: WebSocketOptions,
): new (options: any) => Transport;
/** The caller owns client; disconnect the Socket.IO Socket before closing it. */
export declare function connectSocketIO(
  client: ChromiumClient, url: string, options?: ChromiumSocketIOOptions,
  websocketOptions?: WebSocketOptions,
): Socket;
/** A connect_error message with its transport cause, such as a DNS or TLS failure. */
export declare function describeSocketError(error: Error): string;
/** Disconnects, then waits up to timeoutMs (default 2000) for Engine.IO to close before resolving. */
export declare function closeSocketIO(socket: Socket, timeoutMs?: number): Promise<void>;
