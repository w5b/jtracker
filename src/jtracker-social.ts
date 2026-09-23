import { EventEmitter } from 'node:events';
import type { Socket } from 'socket.io-client';
import type { ChromiumClient } from './index.js';
import { closeSocketIO, connectSocketIO, describeSocketError, type ChromiumSocketIOOptions } from './socketio.js';
import { array, isObject, object, string } from './jtracker-model.ts';
import type { Data } from './jtracker-model.ts';
import { SOCIAL_TRACKERS, trackedList, type SocialTracker } from './jtracker-api.ts';

/** Social tracker socket, as opened in source.js near line 256753 (`He` with path `qe`). */
export const SOCIAL_URL = 'https://nj.j7tracker.io';
export const SOCIAL_PATH = '/wallets/socket.io/';
/** Live source events on the social socket. */
export const SOCIAL_EVENTS = ['fomo_event', 'pump_event', 'telegram_event', 'subdomain_event', 'pump_news_event'] as const;
export type SocialEvent = typeof SOCIAL_EVENTS[number];
const TRACKED_EVENTS: Record<string, SocialTracker> = {
  tracked_fomo: 'fomo', tracked_pump: 'pump', tracked_telegram: 'telegram', tracked_subdomain: 'subdomain',
};

export interface SocialHistoryEntry {
  /** Event name the site files this entry under. Unknown channels count as fomo_event, as on the site. */
  event: SocialEvent;
  channel: string;
  payload: Data;
}
export type JTrackerSocialEvents = { [K in SocialEvent]: [payload: Data] } & {
  /** A tracker list changed, from the socket or from a JTrackerAPI response. */
  tracked: [tracker: SocialTracker, list: Data];
  connect: [];
  disconnect: [reason: string, details?: unknown];
  connect_error: [error: Error];
  auth_error: [problem: { error: string }];
  raw: [event: string, ...args: unknown[]];
};
export interface JTrackerSocialOptions {
  url?: string;
  path?: string;
  socketOptions?: ChromiumSocketIOOptions;
  log?: (...args: unknown[]) => void;
}

/**
 * Events for the sources you track through JTrackerAPI.track(): Fomo users, pump.fun users,
 * Telegram channels and subdomains. Nothing connects until connect() is called.
 */
export class JTrackerSocial extends EventEmitter<JTrackerSocialEvents> {
  readonly socket: Socket;
  /** Latest list per tracker. Empty until the server or an API call reports one. */
  readonly tracked = Object.fromEntries(SOCIAL_TRACKERS.map(kind => [kind, trackedList(kind, {})])) as Record<SocialTracker, Data>;
  private readonly receive = (event: string, ...args: unknown[]) => this.handle(event, ...args);

  constructor(client: ChromiumClient, token: () => string | undefined, options: JTrackerSocialOptions = {}) {
    super();
    const log = options.log ?? console.log;
    this.socket = connectSocketIO(client, options.url ?? SOCIAL_URL, {
      path: options.path ?? SOCIAL_PATH,
      reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 30_000, timeout: 8000,
      ...options.socketOptions,
      // Read the token at every connect so a rotated session is used after reconnects.
      auth: done => done({ token: token() }),
      autoConnect: false,
    });
    this.socket.on('connect', () => { log(`[social] connected (id: ${this.socket.id})`); this.emit('connect'); });
    this.socket.on('disconnect', (reason, details) => { log(`[social] disconnected: ${reason}`); this.emit('disconnect', reason, details); });
    this.socket.on('connect_error', error => {
      log(`[social] connect_error: ${describeSocketError(error)}`);
      // The site drops this socket on an invalid token instead of retrying.
      if (error.message === 'Invalid token') { this.socket.disconnect(); this.emit('auth_error', { error: error.message }); }
      this.emit('connect_error', error);
    });
    this.socket.onAny(this.receive);
  }
  connect(): this { this.socket.connect(); return this; }
  /** Closes the socket and stops reconnecting until connect(). */
  disconnect(): this { this.socket.disconnect(); return this; }
  /** Processes one incoming packet. Also usable for offline replay. */
  handle(event: string, ...args: unknown[]): void {
    this.emit('raw', event, ...args);
    const tracker = TRACKED_EVENTS[event];
    if (tracker) return this.setTracked(tracker, args[0]);
    if ((SOCIAL_EVENTS as readonly string[]).includes(event) && isObject(args[0])) this.emit(event as SocialEvent, args[0]);
  }
  setTracked(tracker: SocialTracker, value: unknown): void {
    const list = trackedList(tracker, value);
    this.tracked[tracker] = list;
    this.emit('tracked', tracker, list);
  }
  /** Recent source events. They are returned only, never re-emitted as live events. */
  async history(limit = 500, timeoutMs = 10_000): Promise<SocialHistoryEntry[]> {
    const reply = await this.socket.timeout(timeoutMs).emitWithAck('social_history', { limit });
    return array(object(reply).events).flatMap(entry => {
      const item = object(entry), channel = string(item.channel);
      if (!isObject(item.payload)) return [];
      const event = (SOCIAL_EVENTS as readonly string[]).includes(channel) ? channel as SocialEvent : 'fomo_event';
      return [{ event, channel, payload: item.payload }];
    });
  }
  async close(): Promise<void> {
    this.socket.offAny(this.receive);
    await closeSocketIO(this.socket);
  }
}
