# JTracker account API and source socket

`tracker.api` is the site's account REST API: session, custom accounts, hidden
accounts, feed settings, and the Fomo, pump.fun, Telegram and subdomain trackers.
`tracker.social` is the second Socket.IO connection that delivers events for those
trackers. Both use the same native Chromium client and session token as the feed.
Everything here was mapped from the supplied `source.js`, read as text only. A test
checks every endpoint path, host and social event name against the bundle.

```ts
import JTracker from '../JTracker.ts';

const tracker = new JTracker('NY', { token: process.env.JTRACKER_TOKEN, socketOptions: { autoConnect: false } });
const session = await tracker.api.checkSession();          // { username, userId, token, rotated }
const accounts = await tracker.api.getCustomAccounts();     // { accounts, availableAccounts, maxAccounts, ... }
await tracker.api.addCustomAccount('@someone');
await tracker.api.track('telegram', 't.me/somechannel');
tracker.social.on('telegram_event', payload => console.log(payload));
tracker.social.connect();
tracker.socket.connect();
```

`bun examples/accounts.ts list` runs the same calls from the terminal.

## Sessions and the token

The token is the site's `sessionId`, the same value as `JTRACKER_TOKEN`. The feed
socket, the REST API and the source socket all read `tracker.token` when they need
it, so a replaced token applies to the next request and the next socket connect.

- **Token rotation.** The site wraps `fetch` so any response with an `X-New-Token`
  header replaces the session (source line 249262). The API does the same for every
  authenticated call and emits `tracker.on('token', ...)`. Persist the new value;
  the old one may stop working.
- **Session check.** `checkSession()` returns the username and whether the token
  rotated. A 401 rejects with code `unauthorized`. The token is kept so you decide.
- **Login.** `login({ username, password, turnstileToken })` posts to `/api/login`.
  The site requires a Cloudflare Turnstile token from its human verification check.
  This client never generates or solves one, so password login only works with a
  token completed in a browser. Copying the browser's session ID is the practical way
  to authenticate.

## Endpoints

Hosts come from source lines 14856–14875. The `main` host is built from the page's
own hostname, which is `nyc.j7tracker.io` on the production site.

| Method | Host | Path | Credential | Client method |
| --- | --- | --- | --- | --- |
| POST | core | `/api/login` | none | `login()` |
| GET | core | `/api/session-check` | `x-session-id` | `checkSession()` |
| GET, POST | core | `/api/accounts` | `x-session-id` | `getCustomAccounts()`, `addCustomAccount()` |
| POST | core | `/api/remove-account` | `x-session-id` | `removeAccount()` |
| GET, POST, DELETE | core | `/api/accounts/available` | `x-session-id` | `getAvailableAccounts()`, `addAvailableAccounts()`, `removeAvailableAccounts()` |
| POST, DELETE | core | `/api/accounts/available/all` | `x-session-id` | `addAllAvailableAccounts()`, `removeAllAvailableAccounts()` |
| POST | core | `/api/accounts/import` | `x-session-id` | `importAccounts()` |
| GET | core | `/api/watched-accounts` | `x-session-id` | `getWatchedAccounts()` |
| GET, POST | core | `/api/hidden-accounts` | `x-session-id` | `getHiddenAccounts()`, `setAccountHidden()` |
| POST | core | `/api/hidden-accounts/batch` | `x-session-id` | `setAccountsHidden()` |
| POST | main | `/api/feed/no-auto-add` | `x-session-id` | `setAutoHideNewAccounts()` |
| POST | main | `/api/ai-suggestions-toggle` | Bearer | `setAiSuggestions()` |
| GET, POST, DELETE | main | `/api/wallet-tracker/{list,track,untrack}` | `x-session-id` | `getFeeClaimTracking()`, `trackFeeClaims()`, `untrackFeeClaims()` |
| GET, POST | social | `/api/{fomo,pump,telegram,subdomain}/{list,add,remove}` | Bearer | `listTracked()`, `track()`, `untrack()` |

Hosts: core is `https://core.j7tracker.io`, main is `https://nyc.j7tracker.io`,
social is `https://nj.j7tracker.io/wallets`. Override them with the `apiHosts`
option for controlled tests.

Every request is a cross-origin `fetch()` from `https://j7tracker.io/`: it carries
that Origin and Referer, `Sec-Fetch-Mode: cors`, and no cookies. JSON bodies are
sent only when the site sends one.

## Behavior worth knowing

- **Handles** are normalized like the site: every `@` and space removed, lowercased.
- **Adding a custom account uses quota.** Failures carry the server's code, such as
  `no_deploys` or `limit_reached`.
- **`removeAccount()` can hide instead of remove.** The server reports
  `removed_custom`, `removed_available` or `hidden`. The last one means the handle
  belongs to the shared feed, so it went on your hidden list.
- **Hidden accounts** arrive as a handle array or as `{ x: [...] }`; both are
  accepted. `setAccountHidden()` returns `diverted: true` when the server handled the
  request differently and did not add the handle. Per-type hiding (replies, reposts)
  and per-platform hiding are browser-only settings on the site and are not sent.
  JTracker still delivers posts from hidden accounts; filtering is up to you. The
  browser UI filters them.
- **Auto-hide new accounts** is the site's "Auto-hide new main feed accounts"
  switch. Its state comes from `getWatchedAccounts()`, from the
  `main_feed_auto_add_updated` socket event, and from `setAutoHideNewAccounts()`,
  and is kept in `tracker.autoHideNewAccounts`.
- **AI suggestions** have no read endpoint. The site's default is on.
- **Fee-claim tracking** sends a coin mint address in a field the site names
  `github_user`.
- **Source trackers** take the text as typed: a Fomo handle, a pump.fun user, wallet
  or profile link, a Telegram channel or link, or a domain. Removal uses the list
  item's `fomo_user_id`, `wallet`, `channel` or `domain`. Domain changes need
  `can_manage` and apply to every user of the site.

State read through the API also updates `tracker.customAccounts`,
`tracker.hiddenAccounts`, `tracker.autoHideNewAccounts` and `tracker.social.tracked`.

## Errors

Methods reject with `JTrackerApiError`, carrying `code`, `status` and the parsed
`data`. Codes follow the site: the server's own `code` when present, else
`unauthorized` for 401, `rate_limited` for 429, and `http_error` otherwise. Local
failures use `no_session`, `invalid_handle`, `invalid_target`, `timeout`,
`network` and `invalid_response`. Nothing is sent when the input is invalid or
there is no session.

## Source socket

`tracker.social` connects to `https://nj.j7tracker.io` with path
`/wallets/socket.io/` and `auth.token`, as the site does (source line 256753). It
stays disconnected until `tracker.social.connect()`.

| Event | Payload |
| --- | --- |
| `fomo_event`, `pump_event`, `telegram_event`, `subdomain_event`, `pump_news_event` | Original `{ kind, data, received_at }` payloads. |
| `tracked` | `(tracker, list)` when a tracker list changes, from the socket or an API call. Lists are also in `tracker.social.tracked`. |
| `auth_error` | `{ error: 'Invalid token' }`; the socket stops, like the site. |
| `raw`, `connect`, `disconnect`, `connect_error` | As on the feed socket. |

`await tracker.social.history(limit)` asks for recent source events with the site's
`social_history` acknowledgement. Entries are returned, not re-emitted as live
events. Unknown channels are filed under `fomo_event`, as the site does.

## Source locations

| Behavior | `source.js` location |
| --- | --- |
| API hosts | 14856–14875 |
| Source tracker requests and list state | 29660–29870 |
| Login form and Turnstile site key | 30637–31290 |
| Custom-account requests and envelope | 43035–43265 |
| Hidden-account requests | 98032–98540 |
| Session check and fetch-wide token rotation | 249160–249270 |
| Auto-hide switch and its socket event | 150940–151000, 161520–161545 |
| Source socket and event handlers | 256753–256830 |
| Source events rendered as feed cards | 256840–257335 |

No production account was used to validate these calls. Tests run them against a
local HTTPS server and two local Socket.IO servers over the native transport.
