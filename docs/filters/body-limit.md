# Body size limit

`bodyLimit({ maxBytes })` rejects request bodies larger than `maxBytes` with `413 Content Too Large`, before your handler runs.

<<< @/examples/filters.ts#body-limit

- It counts the bytes actually received and does not trust the `Content-Length` header.
- It stops reading as soon as the limit is exceeded.
- Accepted bodies are read into memory and passed on in a new request with the same URL, method, headers, and signal.
- Requests without a body pass through unchanged.

Because accepted bodies are buffered, keep routes that stream large uploads outside this filter, for example by putting `bodyLimit` on a group of JSON routes instead of the whole router.
