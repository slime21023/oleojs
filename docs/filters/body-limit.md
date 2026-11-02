# `bodyLimit(options)`

```ts
interface BodyLimitOptions { readonly maxBytes: number } // a non-negative safe integer
```

- **No body:** the same `Request` passes through, with no allocation.
- **Counting:** the body stream is read chunk by chunk, summing `byteLength`. `Content-Length` is never consulted: it is a forbidden request header, and enforcement must not depend on what a client declares. Every chunk must be a `Uint8Array`; anything else cancels the stream and throws a `TypeError`.
- **Over the limit:** reading stops at the first chunk past `maxBytes`. The source is canceled, with the cancellation awaited so failures propagate, and the filter returns an empty `413` without invoking the handler. `problemDetails` renders it as "Content Too Large".
- **Within the limit:** the chunks are copied into one `Uint8Array` and passed on as `new Request(req, { body })`, which keeps the method, URL, headers, and signal. A byte body needs no `duplex`. Streaming request bodies vary by runtime, so the portable packages do not create them ([Portable code must not](https://github.com/slime21023/oleojs/blob/main/CONTRIBUTING.md#portable-code-must-not)).
- **Trade-off:** wrapped handlers receive a buffered body of at most `maxBytes`. Keep streaming-upload routes outside the filter, for example by installing it on JSON route groups.
- **Errors:** stream read and cancellation failures propagate.

