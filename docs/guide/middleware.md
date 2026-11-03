# Middleware

## Filters

A filter wraps a handler. It can act before the handler, after it, or instead of it:

<<< @/examples/middleware.ts#filter

## Applying filters

<<< @/examples/middleware.ts#apply

- `withFilters(handler, a, b)` applies `a` outside `b`: a request passes `a`, then `b`, then the handler.
- `compose(a, b)` creates the same stack as a reusable filter.

### Group filters

`group(prefix, { filters: [...] }, ...routes)` runs filters only for routes in the group. They run after routing, so they can read `ctx.params`. A request that matches no route gets the router's plain `404` or `405` without running group filters.

## Passing values with context keys

A filter passes values to later handlers through the context. A context key gives each value a name and a type:

<<< @/examples/middleware.ts#context-key

- `key.with(ctx, value)` returns a new context with the value. The original context is unchanged.
- `key.get(ctx)` returns the value, and throws if no filter set it.
- `key.find(ctx)` returns the value, or `undefined` if it is missing.

## The application environment

Use `router<Env>()` to give every handler a typed `ctx.env`, such as a database client. Pass the value as the second argument of `fetch`:

<<< @/examples/middleware.ts#env

When the application needs an environment, leaving it out is a type error. [Runtimes](/runtimes/) shows how each platform supplies it.

## Errors

oleojs does not catch errors from handlers or filters. Add [`problemDetails()`](/filters/problem-details) to turn them into error responses.

## Rules of thumb

- Do not modify a request or response. Create a new one instead, for example `new Response(response.body, { status, headers })`.
- To pass a changed request downstream, build it from the original's parts: `new Request(request.url, { method: request.method, headers, signal: request.signal })`. `new Request(request, init)` also works, except on the Node.js adapter by default; see [Node.js](/runtimes/#node-js).
