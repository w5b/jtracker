import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "socket.io-client";
import { ChromiumClient } from "./src/index.js";
import { closeSocketIO, connectSocketIO, describeSocketError, type ChromiumSocketIOOptions } from "./src/socketio.js";
import { JTrackerFeed, type FeedOptions } from "./src/jtracker-feed.ts";
import { JTrackerAPI, type ApiHosts } from "./src/jtracker-api.ts";
import { JTrackerSocial, type JTrackerSocialOptions } from "./src/jtracker-social.ts";
export type { Activity, Author, CustomAccounts, Data, FeedChange, JTrackerEvents, Tweet, TweetContext } from "./src/jtracker-feed.ts";
export { API_ENDPOINTS, API_HOSTS, JTrackerAPI, JTrackerApiError, SOCIAL_TRACKERS } from "./src/jtracker-api.ts";
export type { ApiHosts, ApiUpdate, LoginOptions, RemoveAction, Session, SocialTracker } from "./src/jtracker-api.ts";
export { JTrackerSocial, SOCIAL_EVENTS } from "./src/jtracker-social.ts";
export type { JTrackerSocialEvents, SocialEvent, SocialHistoryEntry } from "./src/jtracker-social.ts";

/** Feed regions as the site lists them (source.js line 29605): na-east and na-central. */
export type Region = "NY" | "DFW";

const JTRACKER_URL: Record<Region, string> = {
  NY: "https://nyc.j7tracker.io",
  DFW: "https://dfw.j7tracker.io",
};
/** Earlier region names. fra.j7tracker.io has no DNS record and nj is not a feed host on the site. */
const RETIRED_REGIONS = new Set(["FRA", "NJ"]);

const ORIGIN = "https://j7tracker.io";

export interface JTrackerOptions {
  /** Site sessionId: socket auth.token, user_connected, and the REST API credential. */
  token?: string;
  feed?: FeedOptions;
  /** Optional endpoint/namespace override, useful for controlled tests. */
  url?: string;
  origin?: string;
  caFile?: string;
  socketOptions?: ChromiumSocketIOOptions;
  log?: (...args: unknown[]) => void;
  /** Raw payload logging is opt-in; use typed events for normal processing. */
  logEvents?: boolean;
  /** REST host overrides, useful for controlled tests. */
  apiHosts?: Partial<ApiHosts>;
  /** Social tracker socket settings. It stays disconnected until tracker.social.connect(). */
  social?: Omit<JTrackerSocialOptions, "log">;
}

export default class JTracker extends JTrackerFeed {
  readonly url: string;
  readonly socket: Socket;
  /** Account REST API: session, custom/hidden accounts, feed settings and source trackers. */
  readonly api: JTrackerAPI;
  /** Fomo, pump.fun, Telegram and subdomain events. Call tracker.social.connect() to start. */
  readonly social: JTrackerSocial;
  private client: ChromiumClient;
  private closePromise?: Promise<void>;
  private stopping = false;
  private authBlocked = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 3000;
  private paused = false;
  private receivePacket = (event: string, ...args: unknown[]) => this.handle(event, ...args);

  constructor(region: Region, options: JTrackerOptions = {}) {
    super(options.feed);
    if (!Object.hasOwn(JTRACKER_URL, region)) {
      throw new TypeError(RETIRED_REGIONS.has(region)
        ? `Region ${region} is not a feed region on the current site; use NY or DFW`
        : `Unknown region: ${region}; use NY or DFW`);
    }
    this.url = options.url ?? JTRACKER_URL[region];
    const log = options.log ?? console.log;
    let authenticatedToken: string | undefined;
    const suppliedAuth = options.socketOptions?.auth;
    const authenticate = (done: (auth: Record<string, unknown>) => void) => {
      const finish = (auth: object = {}) => {
        // Read at every connect: login() or a rotated session check replaces the token.
        const token = this.api.token;
        const resolved: Record<string, unknown> = { ...auth, ...(token !== undefined ? { token } : {}) };
        authenticatedToken = typeof resolved.token === "string" ? resolved.token : undefined;
        done(resolved);
      };
      if (typeof suppliedAuth === "function") suppliedAuth(finish);
      else finish(suppliedAuth);
    };
    this.client = new ChromiumClient({ origin: options.origin ?? ORIGIN, caFile: options.caFile });
    this.api = new JTrackerAPI(this.client, {
      token: options.token, origin: options.origin ?? ORIGIN, hosts: options.apiHosts,
      onToken: token => this.emit("token", token),
      onUpdate: update => {
        if (update.kind === "custom_accounts") this.customAccounts = update.value;
        else if (update.kind === "hidden_accounts") this.hiddenAccounts = update.value;
        else if (update.kind === "auto_hide") this.autoHideNewAccounts = update.value;
        else this.social.setTracked(update.tracker, update.value);
      },
    });
    this.social = new JTrackerSocial(this.client, () => this.api.token, { ...options.social, log });
    this.socket = connectSocketIO(this.client, this.url, {
      // The HTTP endpoint path is distinct from the Socket.IO namespace (/).
      path: "/socket.io/",
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
      ...options.socketOptions,
      auth: authenticate,
      autoConnect: false,
    });

    this.socket.on("connect", () => {
      clearTimeout(this.retryTimer); this.retryTimer = undefined;
      this.retryDelay = 3000; this.authBlocked = false;
      const token = typeof this.socket.auth === "function" ? authenticatedToken : (this.socket.auth as Record<string, unknown>).token;
      if (typeof token === "string" && token) this.socket.emit("user_connected", token);
      log(`[socket] connected to ${this.url} (id: ${this.socket.id})`);
      this.emit("connect");
    });

    const retry = () => {
      if (this.stopping || this.paused || this.authBlocked || this.retryTimer || options.socketOptions?.reconnection === false) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (!this.stopping && !this.paused && !this.authBlocked && !this.socket.connected) this.socket.connect();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    };
    this.socket.on("disconnect", (reason, details) => {
      log(`[socket] disconnected: ${reason}`);
      this.connectedUsers = [];
      this.emit("disconnect", reason, details);
      if (reason === "io server disconnect") retry();
    });

    this.socket.on("connect_error", (err) => {
      log(`[socket] connect_error: ${describeSocketError(err)}`);
      if (["Invalid token", "Account disabled"].includes(err.message)) {
        this.authBlocked = true; this.socket.disconnect();
        this.emit("auth_error", { error: err.message });
      } else if (!this.socket.active) retry();
      this.emit("connect_error", err);
    });

    this.socket.on("auth_error", (payload) => {
      if (payload?.error === "Too many connections") return;
      this.authBlocked = true; clearTimeout(this.retryTimer); this.retryTimer = undefined;
      this.socket.disconnect();
    });
    this.socket.onAny(this.receivePacket);
    if (options.logEvents) this.on("raw", (event, ...args) => log(`[socket] event "${event}"`, ...args));
    if (options.socketOptions?.autoConnect !== false) this.socket.connect();
  }

  /** Opens the feed socket, resuming retries after disconnect(). Same as tracker.socket.connect() otherwise. */
  connect(): this {
    this.paused = false;
    this.socket.connect();
    return this;
  }
  /** Closes the feed socket and cancels pending retries until connect(). The tracker stays usable. */
  disconnect(): this {
    this.paused = true;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.socket.disconnect();
    return this;
  }

  /** Current session token. Setting it applies to REST calls now and to the next socket connect. */
  get token(): string | undefined { return this.api.token; }
  set token(value: string | undefined) { this.api.token = value; }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.socket.offAny(this.receivePacket);
    this.closePromise = (async () => {
      // Both sockets flush their namespace DISCONNECT before the native client frees TLS.
      await Promise.all([closeSocketIO(this.socket), this.social.close()]);
      await this.client.close();
    })();
    return this.closePromise;
  }
}

// Importing the class does not open a connection. Run with npm run jtracker -- NY (or DFW).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const region = (process.argv[2] ?? "NY").toUpperCase() as Region;
  const token = process.env.JTRACKER_TOKEN;
  const tracker = new JTracker(region, {
    token, logEvents: true, socketOptions: { autoConnect: false },
  });
  // Print every application packet, including events not understood by the reducer.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdle = () => { clearTimeout(idleTimer); idleTimer = undefined; };
  tracker.on("connect", () => {
    clearIdle();
    console.log(token ? "[socket] account session supplied via JTRACKER_TOKEN" : "[socket] no JTRACKER_TOKEN set; connected without an account session");
    idleTimer = setTimeout(() => {
      console.log("[socket] still connected, but no application events received in 15 seconds (all event logging is enabled)");
      if (!token) console.log("[socket] for account-specific feeds, set JTRACKER_TOKEN to your site's sessionId");
    }, 15_000);
    idleTimer.unref();
  });
  tracker.on("raw", clearIdle);
  tracker.on("disconnect", clearIdle);
  tracker.on("protocol_error", ({ event, message }) => console.error(`[protocol_error] ${event}: ${message}`));
  const stop = () => { clearIdle(); void tracker.close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  tracker.socket.connect();
}
