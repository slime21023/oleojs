# Transformations

Three small filters change requests and responses:

| Filter | Use it to |
| --- | --- |
| `mapRequest((request, ctx) => request)` | Pass a different request to the next handler |
| `mapResponse((response, request, ctx) => response)` | Replace the response that comes back |
| `responseHeaders(headers)` | Set headers on every response |

<<< @/examples/filters.ts#transforms

- Callbacks may be async. Errors they throw propagate to outer filters.
- `responseHeaders` replaces headers with the same name and keeps all others, including repeated `Set-Cookie` headers. The response body is not read.
- A callback sees the context at its own position: a filter outside the router does not see `ctx.params`.
- Build a changed request from the original's parts, as above. `new Request(request, init)` does not work on the Node.js adapter by default; see [Node.js](/runtimes/#node-js).
