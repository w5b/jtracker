import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "socket.io-client";
import { ChromiumClient } from "./src/index.js";
import { connectSocketIO, type ChromiumSocketIOOptions } from "./src/socketio.js";
import { JTrackerFeed, type FeedOptions } from "./src/jtracker-feed.ts";
export type { Activity, Author, Data, FeedChange, JTrackerEvents, Tweet, TweetContext } from "./src/jtracker-feed.ts";

export type Region = "FRA" | "NY" | "NJ";

const JTRACKER_URL: Record<Region, string> = {
  NY: "https://nyc.j7tracker.io",
  NJ: "https://nj.j7tracker.io",
  FRA: "https://fra.j7tracker.io",
};

const ORIGIN = "https://j7tracker.io";

export interface JTrackerOptions {
  /** Site account token, sent as namespace auth and user_connected on each connect. */
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
}

export default class JTracker extends JTrackerFeed {
  readonly url: string;
  readonly socket: Socket;
  private client: ChromiumClient;
  private closePromise?: Promise<void>;
  private stopping = false;
  private authBlocked = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 3000;
  private receivePacket = (event: string, ...args: unknown[]) => this.handle(event, ...args);

  constructor(region: Region, options: JTrackerOptions = {}) {
    super(options.feed);
    if (!Object.hasOwn(JTRACKER_URL, region)) throw new TypeError(`Unknown region: ${region}`);
    this.url = options.url ?? JTRACKER_URL[region];
    const log = options.log ?? console.log;
    let authenticatedToken: string | undefined;
    const suppliedAuth = options.socketOptions?.auth;
    const authenticate = (done: (auth: Record<string, unknown>) => void) => {
      const finish = (auth: object = {}) => {
        const resolved: Record<string, unknown> = { ...auth, ...(options.token !== undefined ? { token: options.token } : {}) };
        authenticatedToken = typeof resolved.token === "string" ? resolved.token : undefined;
        done(resolved);
      };
      if (typeof suppliedAuth === "function") suppliedAuth(finish);
      else finish(suppliedAuth);
    };
    this.client = new ChromiumClient({ origin: options.origin ?? ORIGIN, caFile: options.caFile });
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
      if (this.stopping || this.authBlocked || this.retryTimer || options.socketOptions?.reconnection === false) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (!this.stopping && !this.authBlocked && !this.socket.connected) this.socket.connect();
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
      log(`[socket] connect_error: ${err.message}`);
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

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    this.socket.offAny(this.receivePacket);
    this.closePromise = (async () => {
      const engine = this.socket.io.engine;
      // Give Engine.IO time to flush the namespace DISCONNECT before freeing TLS.
      const drained = engine && engine.readyState !== "closed" ? new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); engine.off("close", finish); resolve(); };
        const timer = setTimeout(finish, 2000);
        engine.once("close", finish);
      }) : Promise.resolve();
      this.socket.disconnect();
      await drained;
      await this.client.close();
    })();
    return this.closePromise;
  }
}

// Importing the class does not open a connection. Run with npm run jtracker -- FRA.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const region = (process.argv[2] ?? "FRA").toUpperCase() as Region;
  const tracker = new JTracker(region, { token: process.env.JTRACKER_TOKEN });
  tracker.on("tweet", tweet => console.log(`[tweet] @${tweet.author.handle}: ${tweet.displayText}`, { id: tweet.id, type: tweet.type }));
  tracker.on("tweet_update", (tweet, context) => console.log(`[${context.sourceEvent}] ${tweet.id}`, tweet));
  tracker.on("tweet_deleted", ({ id }) => console.log(`[tweet_deleted] ${id}`));
  tracker.on("initialTweets", tweets => console.log(`[initialTweets] ${tweets.length} historical tweets`));
  tracker.on("activity", activity => console.log(`[${activity.event}] @${activity.author.handle}`, activity));
  tracker.on("auth_error", payload => console.error("[auth_error]", payload.error));
  tracker.on("protocol_error", ({ event, message }) => console.error(`[protocol_error] ${event}: ${message}`));
  const stop = () => { void tracker.close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
