# Middleware and context

A filter wraps a handler. `withFilters(handler, a, b)` applies filters in one call and means `a(b(handler))`: the first filter is outermost. Use `compose(a, b)` when you want to reuse that stack with several handlers.

```ts
import { contextKey, get, router, toFetch, withFilters } from 'oleojs'
import type { HttpFilter } from 'oleojs'

const requestIdKey = contextKey<string>('request-id')

const identifyRequest: HttpFilter = (next) => (request, ctx) =>
  next(request, requestIdKey.with(ctx, crypto.randomUUID()))

const routes = router(
  get('/', (_request, ctx) => Response.json({
    requestId: requestIdKey.get(ctx),
  })),
)

export default toFetch(withFilters(routes, identifyRequest))
```

`with` creates a derived context. `get` requires the value to be present and throws if it is missing; `find` returns `undefined` when absent. Values survive the context derivation performed by routing.

Filters can return early, handle errors, or transform a response. To change response headers, copy the headers and construct a new `Response`. Keep incoming requests and responses unchanged.

Environment requirements combine automatically. If `needsDb` is an `HttpFilter<DbEnv>` and `needsCache` is an `HttpFilter<CacheEnv>`, `compose(needsDb, needsCache)` returns an `HttpFilter<DbEnv & CacheEnv>`. `withFilters(handler, needsDb, needsCache)` also retains any environment requirements and route parameters of the handler. A handler can use only part of that environment; callers supply the combined requirements.

## Composing filters

- Use `withFilters(handler, ...filters)` to apply filters directly, and `compose(...filters)` to create a reusable stack. Both keep the first filter outermost and apply each wrapping closure once, when the stack is attached to a handler.
- Independent environment requirements are intersected automatically. For `db: HttpFilter<DbEnv>` and `cache: HttpFilter<CacheEnv>`, `compose(db, cache)` produces `HttpFilter<DbEnv & CacheEnv>`. Env-agnostic filters do not erase those requirements. Existing explicit calls such as `compose<Env>(...)` remain supported.
- `withFilters` combines the handler's environment with the filters' requirements. A handler using only the database may be wrapped by a cache-dependent filter; the resulting handler requires both. Supplied Fetch environments are checked against that combined type. Contradictory requirements remain contradictory instead of being widened away.
- A typed handler passed first to `withFilters` supplies contextual environment typing to inline filter factories. Inline route handlers keep their inferred parameter names. Separate transformation factories can instead use an annotated `Context<Env>` callback.
- Empty compositions and `withFilters(handler)` return the handler unchanged. The result is an ordinary callable handler or filter, with no chain methods or additional lifecycle state.

## Context

- **Initial context.** `toFetch` creates one initial `Context` per request and never mutates it. Routing and context keys may create derived contexts as described below.
- **`params`** is a shared, frozen empty object outside a matched route. Captured parameters use a null-prototype object so names such as `__proto__` are ordinary own properties. On a match with parameters, the router calls the handler with a derived context `{ ...ctx, params }`; it never mutates the context it received. Filters outside the router therefore never see route parameters.
- **Passing data downstream:** use [context keys](/guide/middleware#context-keys). A filter may also pass a new request built from the incoming one's members, such as `next(new Request(req.url, { method: req.method, headers, signal: req.signal }), ctx)`. Avoid `new Request(req, init)`: it accepts only native requests, and the Node adapter passes a [lightweight request](/runtimes/node#performance) by default.
- **Data only.** A context holds plain fields plus the symbol-keyed entries written by context keys.
- **`ExecutionContext`** is an oleojs interface modeled on Cloudflare's. The core only passes it through or substitutes a stub. It never reads a platform global to obtain one.
- **The `executionCtx` stub** (`STUB_EXECUTION_CTX` in `src/context-defaults.ts`) is used on runtimes without `waitUntil` and by the Node adapter.
  - It reports a rejection with `console.error`, so the promise never becomes an unhandled rejection and the failure is not silently lost.
  - It does not extend the request lifetime.

## Context keys

Filters attach typed values to the context through keys, in the style of http4k lenses.

```ts
interface ContextKey<T> {
  readonly name: string
  get(ctx: Context): T                               // throws TypeError if absent
  find(ctx: Context): T | undefined
  with<C extends Context>(ctx: C, value: T): C       // returns a derived context
}

function contextKey<T>(name: string): ContextKey<T>
```

```ts
export const userKey = contextKey<User>('user')

const bearerAuth = (): HttpFilter => (next) => async (req, ctx) =>
  next(req, userKey.with(ctx, await verify(req)))

get('/me', (req, ctx) => Response.json(userKey.get(ctx)))
```

- **Storage:** each key owns a unique `Symbol(name)`, and `with` returns `{ ...ctx, [symbol]: value }`. Object spread copies symbol-keyed properties, so values survive later derivations, including the router's.
- **`get` vs `find`:** use `get` for values that a filter guarantees, and `find` for optional ones.
- **No compile-time presence check.** A missing filter surfaces as a `TypeError` naming the key at run time. This is an accepted trade-off.
- **Who owns the key:**
  - **A filter that sets a value of a fixed type** exports its key.
  - **A filter that sets a value whose type the user chooses** takes the key as an option instead, so the user creates it with the right `T` (for example, `bearerAuth({ verify, key: userKey })`). A key exported by the package could only be `ContextKey<unknown>`.

