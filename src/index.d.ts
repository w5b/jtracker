export type RequestHeaders = Record<string, string> | [string, string][];
export interface ClientOptions {
  /** Initiating page origin for WebSockets. Required here or per WebSocket call. */
  origin?: string;
  /** PEM CA bundle path. Certificate and hostname checks are always enabled. */
  caFile?: string;
  timeoutMs?: number;
  language?: string;
  maxResponseBytes?: number;
}
export interface RequestOptions {
  method?: string;
  headers?: RequestHeaders;
  body?: string | Buffer | Uint8Array;
  json?: unknown;
  /** Navigation is the default; fetch requires initiator. This is header/cookie
   * context only, not a full Fetch/CORS implementation. */
  context?: { kind?: 'navigation' | 'fetch'; initiator?: string };
  credentials?: 'include' | 'same-origin' | 'omit';
  redirect?: 'follow' | 'manual' | 'error';
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  httpVersion?: 'auto' | '1.1';
  maxResponseBytes?: number;
}
export interface WebSocketOptions {
  origin?: string;
  protocols?: string[];
  headers?: RequestHeaders;
  timeoutMs?: number;
  /** Cancels connection establishment. Use close/terminate once connected. */
  signal?: AbortSignal;
  maxPayload?: number;
  maxQueuedBytes?: number;
  maxQueuedMessages?: number;
}
export type WebSocketMessage = { type: 'text'; data: string } | { type: 'binary'; data: Buffer };
export interface CloseInfo { code: number; reason: string; wasClean: boolean }
export interface BrowserSocket extends AsyncIterable<WebSocketMessage> {
  readonly protocol: string;
  readonly extensions: string;
  readonly closed: Promise<CloseInfo>;
  send(data: string | Buffer | Uint8Array): Promise<void>;
  /** null means closed; errors reject. Buffered messages drain before closure. */
  receive(): Promise<WebSocketMessage | null>;
  close(code?: number, reason?: string): Promise<CloseInfo>;
  terminate(): void;
}
export declare class ChromiumResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly httpVersion: '1.0' | '1.1' | '2' | 'unknown';
  readonly headers: [string, string][];
  /** Decoded bytes. Wire Content-Encoding/Content-Length headers are preserved. */
  readonly body: Buffer;
  readonly history: { url: string; status: number }[];
  header(name: string): string | null;
  headerValues(name: string): string[];
  text(): string;
  json(): any;
}
export declare const PROFILE: Readonly<{ id: 'chrome136'; chromiumVersion: '136.0.7103.93'; platform: 'macOS'; userAgent: string; language: string }>;
export declare class ChromiumClient implements AsyncDisposable {
  constructor(options?: ClientOptions);
  readonly backend: { profile: typeof PROFILE; version: string; installation: Record<string, string> };
  readonly cookies: {
    /** Apply a Set-Cookie line. false means rejected or unsupported. */
    set(setCookie: string, url: string | URL): boolean;
    get(url: string | URL, context?: { initiator?: string | URL; navigation?: boolean; method?: string; crossSiteRedirect?: boolean }): string;
  };
  request(url: string | URL, options?: RequestOptions): Promise<ChromiumResponse>;
  openWebSocket(url: string | URL, options?: WebSocketOptions): Promise<BrowserSocket>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
