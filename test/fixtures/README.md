`chrome_136.0.7103.93.yaml` is copied verbatim from
[curl-impersonate commit 6e8f87760a4dd96771e96fc9d55440dcd8845243](https://github.com/lexiforest/curl-impersonate/blob/6e8f87760a4dd96771e96fc9d55440dcd8845243/tests/signatures/chrome_136.0.7103.93.yaml).
Its upstream license is included in `LICENSE.curl-impersonate`.

This is a **derived reference signature**, not a raw packet capture. Its own
comment says it was manually adapted from Chrome 131 by replacing Kyber with
ML-KEM because of a packet parser bug. It labels the browser as Chrome
136.0.7103.93/macOS. It does not establish that every field was independently
measured on that version. ECH length zero is a placeholder, not a wire assertion.

The WebSocket header order is independently taken from the assertions in
[Chromium 136.0.7103.93's HandshakeInfo test](https://chromium.googlesource.com/chromium/src/+/136.0.7103.93/net/websockets/websocket_stream_test.cc).
That source test supplies placeholder User-Agent/language values, so we compare
its ordering and extension offer, not those placeholder values. Additional
cookies and subprotocol headers depend on context.

No browser executable, browser automation dependency, or browser execution is
used to produce or test this project.
