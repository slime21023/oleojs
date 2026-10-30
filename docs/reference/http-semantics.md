# HTTP semantics

- **No path matches:** `404 Not Found`.
- **The path matches but no route accepts the method:** `405 Method Not Allowed`. The `Allow` header lists the union of methods registered on every path-matching terminal node.
- **`HEAD`:** falls back to the `GET` handler when no `HEAD` handler is registered. `Allow` includes `HEAD` whenever `GET` is present.
- **No body on `HEAD` responses.** A `HEAD` response never carries a body, whether it comes from an explicit `HEAD` route or the `GET` fallback. If the handler's response has a body, the router waits for cancellation and returns a new body-less response with the same status, status text, and headers. Cancellation failures reject through the normal error boundary. A body-less response is returned as-is, at no cost.
- **`OPTIONS`:** no automatic handling. An unregistered `OPTIONS` request on an existing path gets a `405`. CORS preflight is the CORS filter's job.
- **Method comparison:** exact and case-sensitive (Fetch already upper-cases standard methods).
- **Fixed default responses.** The router's 404, 405, and 400 responses are empty-body defaults (the 405 carries `Allow`), and there is no option to replace them.
- **Customize them with a filter** that wraps the router and rewrites by status. Copy `Allow` from the default 405 response. Such a filter cannot tell a router-generated 404 from a handler's own 404; this is an accepted trade-off.

```ts
const methodNotAllowedAsJson: HttpFilter = (next) => async (req, ctx) => {
  const res = await next(req, ctx)
  if (res.status !== 405) return res
  return Response.json(
    { title: 'Method Not Allowed' },
    { status: 405, headers: { Allow: res.headers.get('Allow') ?? '' } },
  )
}
```

## Errors

- **The core never catches errors from handlers or filters.** A throw or rejection propagates, and the promise returned by `fetch` rejects. Mapping errors to responses is the job of an error filter (for example, RFC 9457 in `oleo.js/filters`).
- **Native runtimes** then apply their own behavior for unhandled errors (typically a 500).
- **The Node adapter** responds `500 Internal Server Error` with an empty body if headers have not been sent. Otherwise it destroys the socket. In both cases it reports the error with `console.error`. Client disconnects are not errors (see [Client disconnects](/runtimes/node#client-disconnects)).

