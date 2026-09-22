# Chromium-profile networking for Node.js and Bun

HTTP/HTTPS and ws/wss through **BoringSSL + curl-impersonate**, targeting Chromium
**136.0.7103.93 / Chrome macOS**. No browser process, Puppeteer, Playwright or
headless browser is used. Both HTTPS and WSS use the same native TLS library.

This approximates a browser networking profile. It does **not** establish identical
Chromium behavior. See [design, evidence and remaining differences](docs/design.md).

## Setup and run

Use Node 24 (22.15+ supported), macOS or Linux x64/arm64, with `tar` and `openssl`:

```sh
npm ci
npm run setup      # downloads and verifies a pinned native library into .native/
npm test           # local endpoints; no external service or browser
npm run validate   # wire/reference comparisons; writes validation/results/latest.json
npm run example    # working local HTTPS + WSS echo demonstration
```

Setup needs Internet access; tests and the example work offline afterward. Runtime
refuses to substitute system libcurl/Node TLS if setup is missing. Tested here on
macOS arm64 / Node 24.10.0 and Bun 1.4.2; other listed platforms have pinned assets
but were not exercised here. Both `package-lock.json` and `bun.lock` include the
current dependencies.

### Run with Bun

Use **Bun 1.4.2 or newer** (1.4.2 tested). The previously installed Bun 1.2.2 fails
in Koffi's native pointer I/O; earlier Bun releases are not supported here.

```sh
bun upgrade                         # if your installed Bun is older than 1.4.2
bun install --frozen-lockfile
bun scripts/setup-native.js         # once, or after moving to another platform
bun JTracker.ts FRA                 # also NY or NJ
# Equivalent: bun run jtracker:bun FRA
```

Run the local examples and checks without Node:

```sh
bun examples/local.js
bun test test --timeout 15000
bun validation/run.js
bun --bun run check
```

`bun run jtracker` still executes the existing **Node** script; use the direct
file command or `jtracker:bun` above. Bun transpiles `JTracker.ts` itself, so no
TypeScript build or Node type-stripping flag is needed. HTTPS and WSS still use
the pinned native BoringSSL library. `src/ws-codec.js` loads the installed `ws`
package explicitly because Bun substitutes a built-in implementation for bare
`ws` imports, which does not preserve our custom native stream hooks.

The Bun 1.4.2 run passed the controlled HTTP/WebSocket/Socket.IO suite and all
38 reference checks. These checks have the same evidence limits described below;
they do not establish complete Chromium equivalence.

## API

```js
import { ChromiumClient } from './src/index.js';

const client = new ChromiumClient({ origin: 'https://app.example.com' });
try {
  // Default context: top-level navigation matching the reference headers.
  const response = await client.request('https://api.example.com/data');
  console.log(response.status, response.httpVersion, response.text());

  const posted = await client.request('https://api.example.com/data', {
    method: 'POST',
    json: { hello: 'world' },
    context: { kind: 'fetch', initiator: 'https://app.example.com/' },
    credentials: 'include',
    timeoutMs: 10_000,
  });
  console.log(posted.json());

  const socket = await client.openWebSocket('wss://api.example.com/echo');
  await socket.send('hello');
  console.log(await socket.receive()); // { type: 'text', data: 'hello' }
  await socket.send(Buffer.from([0, 1, 255]));
  console.log(await socket.receive()); // { type: 'binary', data: Buffer }
  await socket.close(1000, 'done');
} finally {
  await client.close(); // cancels pending requests and closes remaining sockets
}
```

`http://` and `ws://` are supported too. Responses have `body: Buffer`, ordered
`headers` pairs, `header(name)`, `headerValues(name)`, `text()` and `json()`.
The body is decompressed; wire compression/length headers remain unchanged.
Requests support ordered header pairs, body bytes, JSON, redirects, AbortSignal,
bounded responses, and a shared cookie jar. WebSockets support subprotocols,
`for await (const message of socket)`, `socket.closed`, and `terminate()`.
`receive()` returns null after normal close and rejects on errors.

WebSocket `origin` identifies the initiating page; provide it at client creation
or per connection. HTTP fetch context controls headers/cookies only: this API does
not implement browser CORS/preflights or page security policies. Seed cookies with
`client.cookies.set('name=value; Secure; Path=/', url)`.

Use `caFile: '/path/to/ca-bundle.pem'` for private endpoints. Certificate/hostname
verification are always on. Defaults use a Mozilla CA bundle exported at setup.
Complete options: [TypeScript API](src/index.d.ts). Standalone examples:
[request](examples/request.js), [WebSocket](examples/websocket.js),
[local HTTPS/WSS](examples/local.js).

## Validation scope

The controlled run passed **38 reference checks** across TLS, HTTP/2 and WebSocket
handshake ordering. It compares a versioned upstream **derived** Chrome signature
and Chromium source tests; no independent raw Chromium capture was available.
The report preserves that distinction and marks overall equivalence as
**NOT ESTABLISHED**. Tests also cover certificates, compression, cookies, redirects,
reuse/concurrency, messages/fragments, masking, close, limits and abort.

Known gaps include HTTP/3, WebSockets over HTTP/2, Chrome's complete cookie/cache
and certificate policy, HPACK/priority scheduling, precise compression/framing
bytes, DNS behavior, TLS session partitioning, OS TCP behavior and timing.
See [detailed comparison boundaries](docs/design.md#validation-and-claim-limits).

## JTracker and Socket.IO

`JTracker.ts` uses the native Chromium transport for its Socket.IO connections:

```sh
export JTRACKER_TOKEN='your-site-account-token'
npm run jtracker -- FRA   # also NY or NJ; connects to the selected JTracker service
# Bun: bun JTracker.ts FRA
```

The client connects to the root Socket.IO namespace using HTTP path `/socket.io/`.
Every connection and reconnection uses BoringSSL and the Chromium 136 headers.
Ctrl+C closes the Socket.IO session and native resources. Importing the class does
not connect until you construct an instance:

```ts
import JTracker from './JTracker.ts';

const tracker = new JTracker('FRA', { token: process.env.JTRACKER_TOKEN });
tracker.on('tweet', tweet => console.log(tweet.id, tweet.author.handle, tweet.text));
tracker.on('tweet_update', (tweet, context) => console.log(context.sourceEvent, tweet));
tracker.on('tweet_deleted', ({ id }) => console.log('deleted', id));
tracker.on('pnl_update', payload => console.log(payload));
// tracker.socket.emit('your-event', payload, acknowledgementCallback);
// When finished:
// await tracker.close();
```

The application adapter covers all 37 Socket.IO event names in the supplied
`source.js`. It handles authenticated registration, deduplicated live tweets,
history, partial/subtweet updates, deletions, early AI/token enrichment, profile
and follow activities, and correlated external post updates. Other feature
payloads are exposed through named events. `tracker.tweets` / `getTweet(id)` give
you the merged cache; `raw` exposes exact incoming events. No new packages are
required, and the large source bundle is never imported or executed.

See [event API, source mapping and behavior limits](docs/jtracker-events.md) and
the [tweet-processing example](examples/tweets.ts): `bun examples/tweets.ts FRA`.

`bun JTracker.ts NY` logs every incoming Socket.IO application event, including
non-tweet and unknown events. It prints whether `JTRACKER_TOKEN` was supplied and
reports if a connection receives no application events for its first 15 seconds.
A connected socket alone does not establish that an account feed was subscribed.
For selected processed events, use `examples/tweets.ts`. When importing the class,
raw logging is opt-in with `{ logEvents: true }` or `tracker.on('raw', handler)`.

For another Socket.IO endpoint, use the same adapter directly:

```js
import { ChromiumClient } from './src/index.js';
import { connectSocketIO } from './src/socketio.js';

const client = new ChromiumClient({ origin: 'https://app.example.com' });
const socket = connectSocketIO(client, 'https://api.example.com/feed', {
  path: '/socket.io/',
  auth: { token: 'your-token' },
});
socket.on('connect', () => console.log('connected to namespace /feed'));
// When finished: socket.disconnect(); await client.close();
```

The official Socket.IO and Engine.IO packages handle namespaces, events,
acknowledgements, binary attachments, heartbeats and reconnection. The small
`src/socketio.js` adapter supplies the WebSocket transport, serializes outgoing
batches and waits for writes before reporting drain. It disables transport fallback
and creates a separate Manager so a cached Node-TLS connection cannot be reused.
It supports Socket.IO v4 / Engine.IO v4; it does not implement polling or legacy
Engine.IO v3. Use the ChromiumClient options for CA/origin configuration. Node
socket/TLS options and per-packet compression hints do not control this transport.

Controlled integration tests exercise the actual JTracker class against a local
Socket.IO server, including WSS ClientHello/headers, root/custom namespaces, auth,
binary acknowledgements, heartbeat, reconnection, shared cookies and shutdown.
The production JTracker hosts were not contacted during these tests.

## External dependencies

| Package/library | Use |
| --- | --- |
| `koffi` 3.0.2 | Node-to-native FFI |
| curl-impersonate v2.2.2 | Downloaded native library with BoringSSL, patched nghttp2, and compression libraries; profile `chrome136` |
| `ws` 8.21.3 | WebSocket handshake, extensions and frame codec over our native stream |
| `tough-cookie` 6.0.0 | Cookie storage and domain/path/expiry rules |
| `tldts` 7.0.25 | Public-suffix/domain handling for schemeful SameSite |
| `socket.io-client` 4.8.3 | Socket.IO events, namespaces, acknowledgements and reconnection; pre-existing dependency |
| `engine.io-client` 6.6.6 | Transport base class and Engine.IO connection/heartbeat handling |
| `engine.io-parser` 5.2.3 | Engine.IO packet encoding/decoding |
| `socket.io` 4.8.3 | Development-only controlled test server; excluded from production installs |
| `hpack.js` 2.1.6, `yaml` 2.9.1 | Validation-only HTTP/2 decoding and reference parsing |
| `typescript`, `@types/bun` | Development-only TypeScript tooling/types; Bun is not required to run the app |

Engine.IO packages were already transitive dependencies of Socket.IO; they are now
declared directly because the adapter imports them. `package-lock.json` records all
transitive versions. `npm run check` runs the TypeScript check.
