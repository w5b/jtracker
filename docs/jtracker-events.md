# JTracker site events

The application layer is based on the supplied `source.js`, read as text only.
Its 37 distinct `Sz.on` application events, plus `main_feed_auto_add_updated`, which
the accounts panel registers on the same socket through a prop, are listed in
`SITE_EVENTS` in `src/jtracker-feed.ts`. An inventory test checks these names
against the bundle.
The bundle is neither imported nor executed, and is excluded from TypeScript's
project scan. No additional packages are needed for this layer.

```sh
export JTRACKER_TOKEN='your-site-account-token'
bun examples/tweets.ts NY
# Or: bun JTracker.ts NY
# Node: node --experimental-strip-types examples/tweets.ts NY
```

The socket token is the site's `sessionId`: the bundle initializes it from
`vu("sessionId")` at source line 247366 and refreshes the same value after login.
The REST account API sends this same session ID in its `x-session-id` header;
these are two uses of the same credential. Set `JTRACKER_TOKEN` to that session ID.
`tracker.api` wraps that REST API, and `tracker.social` opens the separate source
socket; see [the account API and source socket](jtracker-api.md). A REST response
can rotate the token, which then applies to the next socket connect as well.
JTracker supplies it as `auth.token`, then sends
`user_connected` with that same token after each namespace connection, as the site
does at source lines 253488–253550. `socketOptions.auth` also accepts an object or
callback; a callback is invoked again on reconnect for token refresh. An explicit
`token` option overrides the callback/object's token and preserves other auth
fields. Tokens are not included in default logs.

Network reconnects use the existing Socket.IO policy. Namespace refusals and
server disconnects retry with a 3–30 second backoff unless `reconnection: false`.
`Invalid token`, `Account disabled`, and fatal `auth_error` stop automatic retry.
`close()` cancels pending retries and shuts down the native transport.
`disconnect()` closes the feed socket and cancels retries until `connect()`.

Without a token the feed socket still connects, but the site's page never does that.
In a 40-second sample on 2026-09-23, a tokenless connection to NY received only
`ai_suggestion` and `ai_suggestion_update` packets, with no tweets or activities. Those
suggestions stay pending in the feed cache until their tweet arrives; the browser UI
shows them as cards on their own.

The site lists two feed regions: `NY` (na-east, `nyc.j7tracker.io`) and `DFW`
(na-central, `dfw.j7tracker.io`), at source line 29605. Earlier region names are
rejected with a clear error: `fra.j7tracker.io` has no DNS record, and `nj` only
hosts the source socket. The site's automatic failover between regions is not
implemented. Connection errors include their transport cause, such as a DNS failure.

## Using the events

```ts
import JTracker from '../JTracker.ts';

const tracker = new JTracker('NY', { token: process.env.JTRACKER_TOKEN });
tracker.on('tweet', tweet => console.log(tweet.id, tweet.author.handle, tweet.text));
tracker.on('tweet_update', (tweet, context) => console.log(context.sourceEvent, tweet));
tracker.on('tweet_deleted', ({ id, tweet }) => console.log(id, tweet.text));
tracker.on('pnl_update', payload => console.log(payload));
tracker.on('following_update', activity => console.log(activity.author, activity.target));
// await tracker.close();
```

| Event | Payload / behavior |
| --- | --- |
| `initialTweets` | Array of normalized historical tweets. Does not fire `tweet` or live `feed` events. |
| `tweet` | Normalized new tweet, plus context. Duplicate IDs are suppressed during dedup retention. |
| `tweet_update` | Current merged tweet and `{ sourceEvent, historical, previous }`; also emitted when cached tweets gain AI, token or external metadata. |
| `tweet.subtweet.update` | Current merged parent tweet. Also emits `tweet_update`. |
| `tweet_deleted` | `{ ...payload, id, tweet }`; cached content is retained with `isDeleted: true`. |
| `token_meta` | Original `{ id, tokenMeta }`; metadata is also stored under `tweet.tokenMeta[mint]`. |
| `ai_suggestion`, `ai_suggestion_update` | Original payload; suggestions/results also enrich the matching tweet by `tweet_id`, otherwise `tweet_url`. |
| `following_update`, `unfollowing_update` | Activity with normalized `author`, `target`, and full `raw` payload. |
| `profile_update` | Activity with changed profile field names in `changes`, and full before/after payload in `raw`. |
| `profile_pinned_update`, `profile_unpinned_update` | Activity; pin lists remain in `raw.pinned` / `raw.unpinned`. |
| `profile_suspended_update`, `profile_deactivated_update` | Activity; user details remain in `raw`. |
| `affiliated.update`, `unaffiliated.update`, `profile_affiliation_update` | Activity with full relationship data in `raw`. |
| `follow_scan` | Original `{ id, scan }`; also updates `getActivity(id).followScan`, including scans arriving before the activity. |
| `external_message` | Original payload; new posts and correlated card/image/video/deletion updates also update the tweet cache. |
| `pnl_update` | Original payload, also available as `latestPnl`. No PnL schema or calculations are invented. |
| `connected_users`, `custom_accounts_list`, `hidden_accounts_updated` | Original payloads; update `connectedUsers`, `customAccounts` (with the site's defaults), and `hiddenAccounts` (lowercased handles from either list shape). |
| `main_feed_auto_add_updated` | Original `{ success, noAutoAdd }`; a successful update sets `autoHideNewAccounts`. |
| `token` | The new session token after login, a rotation, or `tracker.token = ...`. Not a socket event. |
| `admin_alert`, `admin_alert_clear` | Original payloads; update `adminAlert`. A clear for a different ID preserves the current alert. |
| `auth_error`, `debug_response`, `buy_success`, `buy_error` | Original payloads. |
| `quoted_tweet`, `reply_tweet` | Original payloads; these handlers are empty in the supplied site, so no extra behavior is inferred. |
| `coin_community_event`, `charity_event`, `wallet_tracker_claim`, `vamp_trigger`, `vamp_update_trigger` | Original payloads for your handlers; no automatic transaction, deployment, purchase or follow-up fetch. |
| `activity` | All normalized follow/profile/affiliation activities. |
| `feed` | `{ kind, action, item, context? }`; unified tweet and activity cache changes. An update for an unseen ID can create an item here without firing `tweet`. |
| `raw` | `(event, ...args)` for every incoming application packet, including unknown events and duplicates. Use this for exact payloads or future extensions. |
| `protocol_error` | `{ event, message, payload }` when a packet cannot be normalized or correlated. The raw event remains observable. |
| `connect`, `disconnect`, `connect_error` | Forwarded connection lifecycle events. |

`tracker.socket` remains available for the official Socket.IO API, acknowledgements
and unmodified event payloads. `tracker.on(...)` has TypeScript event types.
Unknown fields on tweets and forwarded records are retained as `unknown`, because
this bundle is evidence of usage, not a complete server schema.

## State and differences from the UI

`tracker.tweets` and `tracker.activities` return the cached records, newest arrival
first. Updates keep their position; reconnect history preserves existing live
state. `getTweet(id)` and `getActivity(id)` provide direct lookup. Treat returned
records as read-only. `clearFeed()` clears these caches, dedup and pending entries.

Defaults are 500 tweets, 500 activities, 5,000 dedup IDs, 1,000 unmatched enrichment
entries and 100 AI results per tweet. Dedup and pending entries expire after five
minutes and are swept on incoming packets. All limits are configurable in `feed`.
This is an in-memory window, not persistent or exactly-once delivery across
restarts, eviction, or expiry. Activities without server IDs receive a local UUID
and cannot be reliably deduplicated.

Tweet updates preserve richer text, mentions, nested objects and media instead of
erasing them when a provider sends partial data. Null/omitted fields do not clear
existing values. The `p_v1` provider's full UI-specific ranking heuristics are not
reproduced; shorter real edits or explicit removals should be handled from raw
packets if needed. `text` preserves original URLs; `displayText` removes the
site's trailing t.co/status links. Raw deletion snapshots retain their `body`,
`subtweet`, and other fields without recreating all of the site's deleted-card UI.

AI results are bounded and deduplicated by full value. URL matching preserves
case-sensitive YouTube IDs, unlike the site's blanket URL lowercasing. External
video packets without an ID or matching URL are reported via `protocol_error`;
the site's guess at the latest Instagram/TruthSocial post is deliberately omitted.

Hidden account settings are exposed but do not filter packets automatically; the
browser UI in `web/` applies them. Account and watched-account REST calls live in
`tracker.api`. UI sounds, highlights, pin timers, React state, regional failover,
and transaction/deployment workflows are outside this adapter.
The related Socket.IO events remain accessible. No production account was used
to validate these handlers; tests use synthetic payloads inferred from the bundle
and a controlled Socket.IO server over the native TLS transport.

## Source locations

| Behavior | `source.js` location |
| --- | --- |
| Authentication, registration, retry and account state | 253488–253625 |
| Tweet, metadata, AI, and alert handlers | 253756–253867 |
| Follow/profile/delete/affiliation handlers | 253868–255975 |
| External, community, charity, wallet and VAMP handlers | 255976–256535 |
| New-tweet deduplication and enrichment | 257436–257596 |
| Partial update merging, token metadata and follow scans | 257598–258205 |

Run `bun test test --timeout 15000` or `npm test`, plus `npm run check`.
