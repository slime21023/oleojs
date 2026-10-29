# oleo.js

oleo.js is a zero-dependency TypeScript HTTP router and middleware library. An application is a function `(Request, Context) => Response | Promise<Response>`, and middleware is a function that wraps one. The portable core uses only ECMA-262 and the WinterTC Minimum Common Web API (ECMA-429), so it runs unmodified on Cloudflare Workers, Deno, and Bun, and on Node.js through an adapter.

Design influences: [http4k](https://www.http4k.org/) (server as a function, composable filters) and [itty-router](https://itty.dev/itty-router) (minimal API surface, native `Request`/`Response`).

## Status

The Phase 1 specification is complete, and the project skeleton described in [Development environment](#development-environment) is in place. The type inference design is verified by `test/types/inference.test-d.ts`. Implemented so far:

- The core types (`src/types.ts`).
- Path extraction (`src/path.ts`).
- The trie (`src/routing/trie.ts`).
- Route definitions and helpers (`src/routing/route.ts`), `router` and HTTP semantics (`src/routing/router.ts`).
- `toFetch` (`src/fetch.ts`), `compose` (`src/compose.ts`), and `contextKey` (`src/context-key.ts`).
- The differential `URLPattern` tests (`test/portable/routing/urlpattern.test.ts`).
- The Node adapter `oleo.js/node` (`src/node/listener.ts`).
- Route groups: `group` (`src/routing/route.ts`), flattened by `src/routing/router.ts`.

**Phases 1 and 2 are complete.** Phase 3 is designed (see [Standard filters](#standard-filters-phase-3)) and is the next step. Items listed under [Open decisions](#open-decisions) are not settled — ask before implementing them.

## Hard rules

1. **Zero runtime dependencies.** Dev dependencies are allowed.
2. **Portable packages use only ECMA-262 and ECMA-429 APIs.** See [Standards conformance](#standards-conformance).
3. **Never wrap, proxy, subclass, or mutate `Request` or `Response`.** Build responses with `new Response()` or `Response.json()`.
4. **`Context` holds data only.** Never add helper methods (`ctx.json()`, `ctx.text()`, …) to it.
5. **Routing hot path:** no `new URL()`, `split()`, regex, or substring allocation for static comparison. See [Performance budget](#performance-budget).
6. **Route definition errors throw when `router()` is called**, never at request time.
7. **Do not present oleo.js conventions as standards.** The `{ fetch }` entry shape and `ExecutionContext` are not WinterTC APIs.

## Packages

| Export | Tier | Contents | Phase |
| --- | --- | --- | --- |
| `oleo.js` | Portable | Router, route helpers, core types, `compose`, context keys, `toFetch` | 1 |
| `oleo.js` | Portable | `group` | 2 |
| `oleo.js/node` | Adapter | `node:http` / `node:http2` bridge | 1 |
| `oleo.js/filters` | Portable | Standard filters (CORS, Bearer auth, RFC 9457 errors, request logging) | 3 |
| `oleo.js/contract` | Portable | Declarative contracts, OpenAPI 3.1 generation | 4 |

Portable packages never import adapters. Adapters may import portable packages.

## Development environment

### Toolchain

| Concern | Tool | Notes |
| --- | --- | --- |
| Package manager, script runner | Bun 1.4 | Pin the version in `packageManager`. Commit `bun.lock`; never commit other lockfiles |
| Tests | Vitest 5 | Never use `bun test`; test files import from `vitest` |
| Tests on `workerd` | `@cloudflare/vitest-plugin` | The successor to the deprecated `@cloudflare/vitest-pool-workers`; never use the old package |
| Type tests | Vitest typecheck | `expectTypeOf` in `*.test-d.ts` files |
| Property-based tests | fast-check | Dev dependency; generated cases run through Vitest on all four runtimes |
| Lint | oxlint | Configured in `.oxlintrc.json` |
| Type checking, build | TypeScript 7 (`tsc`) | Emits `.js` and `.d.ts` to `dist/`. No bundler |

Dev dependencies are pinned to exact versions.

Bun is the development tool, not a runtime target with special status. No source, test, or tooling file uses Bun-only APIs (`Bun.*`, `bun:*`).

### Repository layout

```text
src/
  index.ts                  # `oleo.js` entry: public exports only
  types.ts                  # core types (see Core API)
  path.ts                   # path bounds within request.url
  fetch.ts                  # toFetch: creates the per-request context
  compose.ts                # compose
  context-key.ts            # contextKey
  context-defaults.ts       # shared EMPTY_PARAMS and executionCtx stub
  http-method.ts            # method validation and Fetch-forbidden methods
  <module>.ts               # core modules (kebab-case)
  routing/
    route.ts                # immutable Route/RouteGroup values, helpers, group, internal kind checks
    router.ts               # group flattening, filter composition, dispatch, default responses
    trie.ts                 # segment trie: definition checks, matching, Allow lists
  node/
    index.ts                # `oleo.js/node` entry
    listener.ts             # toNodeListener: ingress, egress, errors, disconnects
test/
  portable/
    <module>.test.ts        # portable runtime tests, including generated properties
    arbitraries.ts          # shared input generators and deterministic run settings
    runtime-baseline.test.ts # checks the runtime assumptions the core relies on
    routing/
      router.test.ts        # route helpers, dispatch, HTTP semantics
      router.property.test.ts # routing and grouped-filter properties through the public API
      group.test.ts         # route group flattening, filters, definition errors
      trie.test.ts          # matching, parameter decoding, definition errors
      urlpattern.test.ts    # corpus and generated URLPattern differential tests
  node/
    listener.test.ts        # real HTTP/1.1 and HTTP/2 servers
  types/
    inference.test-d.ts     # public type inference contract
vitest.config.ts            # projects: portable, node, types
vitest.workers.config.ts    # portable tests inside workerd
.oxlintrc.json
tsconfig.json / tsconfig.node.json / tsconfig.build.json
dist/                       # build output, not committed
```

- `src/index.ts` and `src/node/index.ts` are the public export boundaries. Internal modules import their dependencies directly; no internal barrel is needed under `routing/`.
- `routing/route.ts` only creates immutable values and owns their internal tags. Validation and filter application stay in `router()`; do not move them into route helpers or `group()`.
- Shared context defaults and HTTP method rules live outside `routing/`, so `fetch.ts` and the Node adapter do not depend on routing implementation modules.
- Keep the inference machinery in `types.ts` and beside route definitions. `BASE`, `FILTER_ENV`, and `NoInfer` are guarded by `test/types/inference.test-d.ts`.

### TypeScript configuration

| File | Covers | `types` |
| --- | --- | --- |
| `tsconfig.json` | `src/` except `src/node/`, `test/portable/`, `test/types/` | `[]`: no runtime types in scope |
| `tsconfig.node.json` | `src/node/`, `test/node/` and tooling config files | `["node"]` |
| `tsconfig.build.json` | Only `src/`, for emit to `dist/` | `["node"]` for the adapter; portable isolation is checked separately |

Required compiler options:

- `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`.
- `module` and `moduleResolution`: `NodeNext`.
- `lib`: `ES2023`, `DOM`, `DOM.Iterable`. TypeScript has no ECMA-429 lib, so the lint rules in [Enforcement](#enforcement) ban the browser-only globals that `DOM` brings in.

Coding rules that follow from these options:

- **Relative imports use the `.ts` extension** (`import { x } from './trie.ts'`). `tsc` rewrites it to `.js` on emit. Source then runs directly on Bun, Deno, and Node.
- **Use only erasable TypeScript syntax:** no `enum`, `namespace`, or parameter properties.

### Package manifest

- `"type": "module"`, `"sideEffects": false`, `"files": ["dist"]`.
- `exports` maps `.` → `dist/index.js` and `./node` → `dist/node/index.js`, each with a `types` condition.
- `engines.node` covers the currently maintained Node.js LTS lines.
- **Declaration files keep `.ts` specifiers.** `rewriteRelativeImportExtensions` rewrites them in emitted `.js` only, so the emitted `.d.ts` files still import `./router.ts` and similar.
  - **Verified:** a consumer project on TypeScript 7 with `NodeNext` resolves them to the `.d.ts` files and keeps full inference. The built JavaScript also runs on Node, Bun, and Deno.
  - **Untested:** consumers on older TypeScript versions. Check before publishing.

### Commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dev dependencies |
| `bun run lint` | Run oxlint |
| `bun run typecheck` | Run `tsc --noEmit` for every tsconfig |
| `bun run test` | Run runtime tests on Node, plus type tests (the default local check) |
| `bun run test:types` | Run type tests only |
| `bun run test:node`, `test:bun`, `test:workerd`, `test:deno` | Run the portable tests on one runtime |
| `bun run test:all` | Run the full runtime matrix |
| `bun run build` | Emit `dist/` |

Before considering a change done, run `lint`, `typecheck`, and `test`. The full matrix (`test:all`) runs in CI.

### Property-based tests

- All tests live under `test/`: portable runtime tests, Node adapter tests, and type tests remain separate Vitest projects. A missing test selection must fail; do not enable `passWithNoTests`.
- Keep example-based regressions and the full type inference contract. fast-check adds generated inputs and shrinks failing cases; it does not replace integration or type tests.
- `test/portable/arbitraries.ts` defines shared generators and `PROPERTY_OPTIONS` (seed `20261029`, 300 runs per property). Keep portable tests free of runtime globals, including when configuring randomness.
- Properties cover parameter names and percent-decoding, route priority and registration order, `Allow` unions, group flattening, malformed paths, path extraction, context-key isolation, filter order, and URLPattern equivalence. Generate matching and nonmatching paths so a property cannot pass by only checking 404s.
- Run routing properties with `bun run test --project portable router.property.test.ts`. All properties also run through the regular test commands and the four-runtime matrix.
- To reproduce a failure, pass its printed `seed` and `path` to the failing `fc.assert` options. Keep the dependency version fixed, save the reduced input as a regression or an explicit `examples` entry, and remove the temporary replay `path` afterwards. To explore more inputs, temporarily change the shared seed and increase `numRuns`.
- Reference results must be independent of the implementation. In particular, use `Object.fromEntries` for expected parameter maps so `__proto__` becomes an own property. workerd's URLPattern currently drops captures with that name; the differential oracle renames captures and maps them back, while also checking matching with the original pattern. Public API regressions still test the original names on every runtime.

## Core API

### Types

```ts
type Params = Readonly<Record<string, string>>

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

interface Context<E = unknown, P extends Params = Params> {
  readonly params: P
  readonly env: E
  readonly executionCtx: ExecutionContext
}

type HttpHandler<E = unknown, P extends Params = Params> =
  (req: Request, ctx: Context<E, P>) => Response | Promise<Response>

type HttpFilter<E = unknown> =
  (<TEnv extends E, P extends Params>(next: HttpHandler<TEnv, P>) => HttpHandler<TEnv, P>)
  & { readonly [FILTER_ENV]?: (env: E) => void } // type-level only, never set

interface FetchHandler<E = unknown> {
  fetch(request: Request, env?: E, executionCtx?: ExecutionContext): Promise<Response>
}

type ParamsOf<TPattern extends string> = /* '/users/:id/*' → { readonly id: string; readonly '*': string } */
```

`HttpFilter<E>` means "requires at least env `E`".

- **Generic over `TEnv`:** an env-agnostic filter (`HttpFilter`) wraps handlers of any env, and `HttpFilter<Env>` wraps any handler whose env satisfies `Env`. Without this, a filter like `logger()` could not wrap an `HttpHandler<Env>`.
- **Generic over `P`:** a filter can wrap a single route handler without losing parameter inference.
- **The phantom `FILTER_ENV` member** carries `E` contravariantly. TypeScript ignores type-parameter constraints when relating generic signatures, so without it an `HttpFilter<Env>` would be assignable to `HttpFilter<OtherEnv>`, and `compose(logger, needsDb)` would accept a handler of the wrong env. Arrow functions remain assignable because the member is optional. Never remove it; the inference contract covers both holes.

`ParamsOf` is exported for typing handlers declared apart from their route. A non-literal `string` pattern yields `Params`.

### Building an application

An application is plain function composition. There is no application class and no mutable registration step.

```ts
import { router, get, post, del, compose, toFetch } from 'oleo.js'

const routes = router(
  get('/users/:id', (req, ctx) => Response.json({ id: ctx.params.id })),
  post('/users', createUser),
  del('/users/:id', requireAdmin(deleteUser)), // route-level filter: wrap the handler
)

const app = compose(logger(), bearerAuth())(routes)

export default toFetch(app)
```

| Function | Returns | Notes |
| --- | --- | --- |
| `get`, `post`, `put`, `patch`, `del`, `head`, `options` `(pattern, handler)` | `Route` | `del` because `delete` is a reserved word |
| `route(method, pattern, handler)` | `Route` | Any other method (`PROPFIND`, …) |
| `router(...items)` | `HttpHandler` | Takes routes and groups. Builds the trie once. Throws on [route definition errors](#route-definition-errors) |
| `group(prefix, options?, ...items)` | `RouteGroup` | See [Route groups](#route-groups-phase-2) |
| `compose(...filters)` | `HttpFilter` | `compose(a, b)(h)` is `a(b(h))`: the first filter is outermost. `compose()` is the identity |
| `toFetch(handler)` | `FetchHandler` | The only entry point. Creates the `Context` |

- **Routes are values.** A `Route` is immutable, and `router()` reads it once. A router is itself an `HttpHandler`, so routers and filters nest freely.
- **Type inference.** Route patterns are parsed with template literal types: `'/users/:id/*'` yields `ctx.params: { id: string; '*': string }`. `router<E>(...)` fixes `E` for its routes, and route helpers infer `E` and `P` contextually.
- **Inference contract:** `test/types/inference.test-d.ts` is the contract for this inference, including route-level filters, mixed envs, and the rejection cases. It runs against the real implementations. Never weaken, delete, or `@ts-expect-error` away an existing case to make it pass; ask instead.
- **Clients are handlers too.** Any `(req) => Promise<Response>` is assignable to `HttpHandler`. Do not pass `globalThis.fetch` itself as a handler: its second parameter is `RequestInit`, not `Context`. Wrap it as `(req) => fetch(req)`.

### Entry point

`toFetch(handler).fetch(request, env?, executionCtx?)` follows the Workers signature, and the returned object is directly usable as `export default`.

- **`fetch` must not depend on `this`.** Runtimes may call it detached (for example `Deno.serve(app.fetch)`), so it is a closure, not a method that reads `this`.

- **`env`:** whatever the runtime passes second becomes `ctx.env` (Workers `Env`, Bun `Server`, Deno `ServeHandlerInfo`).
- **`executionCtx`:** when the runtime passes none, the stub is used.
- **Testing:** `toFetch(app).fetch(new Request('http://test/users/1'))` works with no network and no adapter. `env` is `undefined` and `executionCtx` is the stub.

### Context

- **One per request.** `fetch` creates exactly one `Context` per request and never mutates it afterwards.
- **`params`** is a shared, frozen empty object outside a matched route. Captured parameters use a null-prototype object so names such as `__proto__` are ordinary own properties. On a match with parameters, the router calls the handler with a derived context `{ ...ctx, params }`; it never mutates the context it received. Filters outside the router therefore never see route parameters.
- **Passing data downstream:** use [context keys](#context-keys). A filter may also pass a new request (`next(new Request(req, init), ctx)`).
- **Data only.** A context holds plain fields plus the symbol-keyed entries written by context keys.
- **`ExecutionContext`** is an oleo.js interface modeled on Cloudflare's. The core only passes it through or substitutes a stub. It never reads a platform global to obtain one.
- **The `executionCtx` stub** (`STUB_EXECUTION_CTX` in `src/context-defaults.ts`) is used on runtimes without `waitUntil` and by the Node adapter.
  - It reports a rejection with `console.error`, so the promise never becomes an unhandled rejection and the failure is not silently lost.
  - It does not extend the request lifetime.

### Context keys

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

## Route groups (Phase 2)

*Status: values are defined in `src/routing/route.ts` and flattened in `src/routing/router.ts`. Runtime tests are in `test/portable/routing/group.test.ts`, and type tests in the "route groups" block of `test/types/inference.test-d.ts`.*

A group joins a prefix onto its routes when `router()` is called and flattens them into the same trie as every other route. At run time a grouped route is indistinguishable from writing its full pattern directly. There is no run-time mounting and no hidden path state in `Context`.

### API

```ts
interface GroupOptions<E = unknown> {
  readonly filters?: readonly HttpFilter<E>[]
}

function group<E, TPrefix extends string, TBase extends Params = {}>(
  prefix: TPrefix,
  ...items: Array<Route<E, JoinParams<TBase, ParamsOf<TPrefix>>> | RouteGroup<E, JoinParams<TBase, ParamsOf<TPrefix>>>>
): RouteGroup<E, TBase>
function group<E, TPrefix extends string, TBase extends Params = {}>(
  prefix: TPrefix,
  options: GroupOptions<E>,
  ...items: Array<Route<E, JoinParams<TBase, ParamsOf<TPrefix>>> | RouteGroup<E, JoinParams<TBase, ParamsOf<TPrefix>>>>
): RouteGroup<E, TBase>
```

```ts
const app = router(
  get('/health', health),
  group('/admin/:tenant', { filters: [requireAdmin, audit] },
    get('/users', listUsers),              // GET /admin/:tenant/users
    group('/users/:id',
      get('', showUser),                   // GET /admin/:tenant/users/:id
      del('', deleteUser),                 // DELETE /admin/:tenant/users/:id
      get('/posts/:postId', showPost),     // ctx.params: { tenant, id, postId }
    ),
  ),
)
```

### Flattening

- **Patterns are concatenated, nothing more.** A route's full pattern is `prefix + pattern`, outermost group first.
- **Validity is judged on the full pattern.** Every [route definition error](#route-definition-errors) applies to it, which yields the prefix rules for free:
  - a prefix must start with `/`;
  - a prefix ending in `/` produces an empty segment;
  - a prefix containing `*` puts `*` before the last segment;
  - a prefix parameter repeated in a route is a duplicate parameter.
- **`''` addresses the prefix itself.** Inside a group, `get('', h)` matches the prefix exactly, and `get('/', h)` matches it with a trailing slash. At top level `''` is invalid because it does not start with `/`.
- **One trie for everything.** Duplicate detection, priority, and `405` `Allow` lists cover grouped and ungrouped routes together. For example, `get('/admin/:tenant/users')` beside the group above is a duplicate route.
- **`group()` never throws.** It only builds a frozen value. All errors surface when `router()` is called (Hard rule 6).
- **Runtime discrimination:** route helpers and `group()` tag their values internally. A second argument to `group()` that is not such a value is the options object.

### Group filters

- **Composition:** `options.filters` compose like `compose(...filters)`, so the first filter is outermost. During construction, `router()` accumulates filters in an array from outer to inner groups and applies `compose(...filters)` at each route. Filter arrays are never constructed on the request path. An outer group's filters wrap an inner group's.
- **Request order:** filters around the router → router → outer group filters → inner group filters → route-level filters → handler.
- **Group filters see route parameters**, because they run after routing, on the derived context.
- **Filters are applied once per route, not once per group.** The `(next) => …` closure runs once for each route in the group. Keep state that must be shared across the group (rate-limit counters, caches) outside that closure.
- **Unmatched paths skip group filters.** A path under a group's prefix that matches no route gets the router's plain 404 or 405, without running the group's filters. For example, `/admin/x/nope` returns 404, not 401. This is an accepted trade-off of flattening.

### Types

```ts
type JoinParams<A extends Params, B extends Params> = { readonly [K in (keyof A | keyof B) & string]: string }

interface Route<E = unknown, TBase extends Params = {}> { /* … */ readonly [BASE]?: (base: TBase) => void }
interface RouteGroup<E = unknown, TBase extends Params = {}> { /* … */ readonly [BASE]?: (base: TBase) => void }

function get<E = unknown, TPattern extends string = string, TBase extends Params = {}>(
  pattern: TPattern,
  handler: HttpHandler<E, JoinParams<NoInfer<TBase>, ParamsOf<TPattern>>>,
): Route<E, TBase>                                       // likewise post, put, …, route

function router<E = unknown>(...items: Array<Route<E> | RouteGroup<E>>): HttpHandler<E>
```

- **`TBase`** is the set of prefix parameters a route or group expects from the groups that enclose it. A phantom, contravariant `BASE` member carries it. A route expecting nothing fits anywhere, and `router()` accepts only items expecting nothing.
- **Three required type details. Do not undo them.** Each was verified by reverting it and watching the contract fail:
  - **`JoinParams` must not be a conditional type.** A conditional collapses a still-unresolved `TBase` to `Params` during inference.
  - **The route helpers must wrap `TBase` in `NoInfer`.** Without it, a separately declared handler (`const show: HttpHandler<E, ParamsOf<'/users/:id'>>`) makes `TBase` be inferred backwards and degrade to `Params`. That breaks even ungrouped `get('/users/:id', show)`. The `NoInfer` in `group()`'s own signature is defensive: no known case needs it.
  - **The `FILTER_ENV` phantom on `HttpFilter` is required** for `options.filters` to be env-checked.
- **Inline routes:**
  - prefix parameters flow into the routes;
  - nested groups accumulate them;
  - the options form keeps inference;
  - `E` flows from `router<E>()`;
  - an `options.filters` entry requiring a different env is a compile error.
- **Routes defined in another module:** export a function or constant whose type is annotated as `RouteGroup` or `RouteGroup<Env>`. The annotation supplies the context that inference needs:

  ```ts
  // users.ts
  export const userRoutes = (): RouteGroup<Env> =>
    group('/users/:userId', get('/posts/:postId', (req, ctx) => Response.json(ctx.params)))
  // app.ts
  router<Env>(userRoutes())
  ```

  - **Without the annotation,** prefix parameters are missing from `ctx.params`, so using one is a compile error. It is never an untyped value.
  - **Env mismatch:** an annotated `RouteGroup<Env>` put into a `router` of a different env is a compile error.
- **Contract:** the "route groups" block of `test/types/inference.test-d.ts` covers:
  - each inline behavior above;
  - separately declared handlers;
  - the annotated and the unannotated module patterns;
  - every rejection.

## Standard filters (Phase 3)

*Status: designed; not implemented yet.*

### Common rules

- **Location:** `src/filters/`, published as `oleo.js/filters`. The `exports` map gains `./filters` → `dist/filters/index.js`. These are portable packages: ECMA-262 and ECMA-429 only, with the same lint and type isolation as the core.
- **Factories:** every filter is a factory (`cors(options)`, `bearerAuth(options)`, `problemDetails(options?)`, `requestLogger(options?)`) that returns an `HttpFilter`.
- **Fail fast:** a factory validates its options and throws a `TypeError` immediately, never at request time.
- **Tree-shaking:** named exports from one entry, and the package declares `sideEffects: false`. Unused filters drop out of bundles.
- **Never mutate a `Response`** (Hard rule 3). To add headers, build `new Response(res.body, { status, statusText, headers })` with a copied `Headers`. Responses from `fetch()` have immutable headers, so in-place mutation would also throw.
- **Recommended order** around a router:

  ```ts
  compose(requestLogger(), cors({ origin }), problemDetails())(router(/* … bearerAuth per group or route … */))
  ```

  - **`requestLogger` outermost** sees the final status.
  - **`cors` outside `problemDetails`** also adds its headers to problem responses.
  - **`problemDetails` inside both** converts errors before they are logged.

### `cors(options)`

```ts
interface CorsOptions {
  origin: '*' | string | readonly string[] | ((origin: string, req: Request) => boolean) // required
  methods?: readonly string[]       // default ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
  allowHeaders?: readonly string[]  // default: reflect Access-Control-Request-Headers
  exposeHeaders?: readonly string[] // default: none
  credentials?: boolean             // default false
  maxAge?: number                   // seconds; default: header omitted
}
```

- **`origin` is required.** There is no default; allowing every origin must be written as `origin: '*'`.
- **Option validation:**
  - Each listed origin must be a serialized origin: `new URL(o).origin === o`, so `https://app.example.com/` with a trailing slash throws.
  - `credentials: true` with `origin: '*'` throws, because browsers reject that combination.
  - `maxAge` must be a non-negative integer.
- **Requests without an `Origin` header** are not CORS requests and pass through untouched.
- **A disallowed origin** passes through with no CORS processing at all; the browser then blocks it.
- **Preflight** is an `OPTIONS` request with both `Origin` and `Access-Control-Request-Method`. An allowed preflight is answered with `204` and never reaches `next`. The response carries:
  - `Access-Control-Allow-Origin`;
  - `Access-Control-Allow-Methods`;
  - `Access-Control-Allow-Headers`, which is the configured list or the reflected request headers, omitted when empty;
  - `Access-Control-Allow-Credentials: true` when `credentials` is set;
  - `Access-Control-Max-Age` when `maxAge` is set;
  - `Vary`.
- **Other allowed requests** call `next`, then add the following to the response:
  - `Access-Control-Allow-Origin`;
  - `Access-Control-Allow-Credentials` when `credentials` is set;
  - `Access-Control-Expose-Headers` when configured;
  - `Vary: Origin`.
- **`Access-Control-Allow-Origin` value:** `*` when the configured origin is `'*'`; otherwise the request's own `Origin`, echoed. Echoing requires `Vary: Origin`, plus `Access-Control-Request-Headers` when headers are reflected. `Vary` values are appended to any existing `Vary`, never replacing it.
- **Must wrap the whole router, never a group.** An `OPTIONS` preflight to a path without an `OPTIONS` route is an unmatched request, so group filters never see it (see [Group filters](#group-filters)).

### `bearerAuth(options)`

```ts
interface BearerAuthOptions<E = unknown, T = unknown> {
  verify: (token: string, req: Request, ctx: Context<E>) => T | undefined | Promise<T | undefined>
  key?: ContextKey<T>  // where to store the verified principal; omit to only verify
  realm?: string
}

function bearerAuth<E = unknown, T = unknown>(options: BearerAuthOptions<E, T>): HttpFilter<E>
```

```ts
const userKey = contextKey<User>('user')
group('/api', { filters: [bearerAuth({ verify: (token, req, ctx: Context<Env>) => findUser(ctx.env, token), key: userKey })] },
  get('/me', (req, ctx) => Response.json(userKey.get(ctx))),
)
```

- **Responses** follow RFC 6750, with empty bodies so that `problemDetails` can render them:

  | Situation | Status | `WWW-Authenticate` |
  | --- | --- | --- |
  | No `Authorization` header, or a scheme other than `Bearer` (matched case-insensitively) | 401 | `Bearer realm="…"` (`realm` only if configured) |
  | `Bearer` with an empty token or one outside the RFC 6750 `b64token` syntax | 400 | `Bearer realm="…", error="invalid_request"` |
  | `verify` returns `undefined` | 401 | `Bearer realm="…", error="invalid_token"` |

- **On success** it calls `next(req, key ? key.with(ctx, principal) : ctx)`. `verify` returns `undefined` to reject; any other value, including `null` or `false`, is the principal.
- **`verify` may throw.** The error propagates to the error filter; it is never turned into a 401.
- **The token is never logged or exposed.** Timing-safe comparison is the job of `verify`.
- **`realm` validation:** it must be a valid quoted-string body, so `"`, `\`, and control characters throw.
- **Env typing:** `E` cannot be inferred from `verify`'s parameters. Annotate `ctx: Context<Env>` in `verify`, or rely on contextual typing (for example, inside `router<Env>(group(…, { filters: [bearerAuth(…)] }))`). The type tests must cover both.
- **Placement:** per group or route is fine. Unmatched paths under the group then get 404, not 401 (see [Group filters](#group-filters)).

### `problemDetails(options?)`

```ts
interface Problem {
  readonly status: number            // 400–599
  readonly type?: string             // default 'about:blank'
  readonly title?: string            // default: the status's standard reason phrase
  readonly detail?: string
  readonly instance?: string
  readonly [extension: string]: unknown
}

interface ProblemDetailsOptions {
  fromError?: (error: unknown, req: Request) => Problem | undefined // undefined → default 500
  emptyResponses?: boolean                                        // default true
  onError?: (error: unknown, req: Request) => void                // default: console.error(error)
}
```

- **Thrown errors:** `next` is awaited inside `try`/`catch`. A thrown value becomes `fromError?.(error, req)`, or the default `{ status: 500 }` when that returns `undefined`.
  - **Rendered as** `application/problem+json`.
  - **No leaks:** the default problem never includes `error.message` or a stack.
  - **Reporting:** `onError` runs for every error that ends up as a 5xx.
  - **Invalid mappings:** if `fromError` throws or returns a status outside 400–599, the result is the default 500 and `onError` receives the original error.
- **Empty error responses** (`emptyResponses: true`): a response with status ≥ 400 and a `null` body becomes a problem document with the same status, keeping every original header (`Allow`, `WWW-Authenticate`, CORS headers, …) and adding `Content-Type`.
  - This covers the router's default 404/405/400 and `bearerAuth`'s 401/400.
  - A response with any body, even an empty string, is left alone. Handlers that return their own error bodies are never rewritten.
- **`HEAD` requests never get a body.** For a `HEAD` request the status and headers are converted, and the body stays `null`. The router strips bodies from `HEAD` responses, so without this rule every `HEAD` 404 would gain a body.
- **Reason phrases:** ECMA-429 has no table of reason phrases, so `src/filters/` ships its own for 400–511. For an unknown status, `title` is omitted.
- **Out of scope:** an error raised while a body is already streaming cannot be converted, because the headers are already sent.
- **No error class.** The package exports no throwable `HttpProblem`, since that would be a response builder in disguise (see [Non-goals](#non-goals)). Map your own error types with `fromError`.

### `requestLogger(options?)`

```ts
interface LogEntry {
  readonly method: string
  readonly path: string        // raw path without the query string, which often carries tokens
  readonly status?: number     // absent when the handler threw
  readonly durationMs: number  // rounded to 0.1 ms
  readonly error?: true
  readonly [field: string]: unknown
}

interface RequestLoggerOptions {
  log?: (entry: LogEntry) => void                                                // default: console.log(JSON.stringify(entry))
  fields?: (req: Request, res: Response | undefined) => Record<string, unknown> // extra fields; res is undefined on error
}
```

- **One entry per request,** logged when `next` settles. Timing uses `performance.now()`.
  - **What is timed:** only the time until the handler returns its `Response`; body streaming is not included.
  - **On `workerd`,** time advances only across I/O (a Spectre mitigation), so durations of CPU-only handlers read as `0`.
- **Path:** extracted with `pathStart`/`pathEnd`, so it is the raw, still-encoded path, and the query string is never logged.
- **On a throw** it logs `{ error: true }` without `status`, then rethrows. It never swallows errors.
- **Isolation:** an error thrown by `log` or `fields` is reported with `console.error` and never affects the response. `fields` cannot override the core fields; the core fields win.

### Contract

When implementing, add type tests for each factory's option types and env inference, especially `bearerAuth`'s `E` and `T`. Add runtime tests for every row and rule above. Every filter's tests run on all four runtimes.

## Request lifecycle

1. **Entry.** The runtime, or `oleo.js/node`, calls `fetch`. `fetch` creates the `Context` and calls the composed handler.
2. **Filters (inbound).** The request passes through the composed filters. Filters may derive the context through context keys, or short-circuit (for example, on a CORS preflight).
3. **Routing.** The router extracts the path, walks the trie, and derives the context with `params`.
4. **Handler.** The matched handler runs. Otherwise the router returns its default 404, 405, or 400 response (see [HTTP semantics](#http-semantics)).
5. **Filters (outbound).** The `Response` returns through the same filters for header enrichment and error normalization.

## Routing

### Path extraction

- **Bounds:** the path starts at the first `/` after `://` in `request.url`, and ends at the first `?` or `#`, or at the end of the string.
- **No normalization.** `request.url` is always absolute and already WHATWG-normalized (dot segments resolved, non-ASCII percent-encoded), so oleo performs no normalization of its own.

### Pattern syntax

Patterns are a strict subset of `URLPattern` pathname syntax (`URLPattern` is part of ECMA-429). Every accepted pattern must match exactly the same paths as `new URLPattern({ pathname })`. `test/portable/routing/urlpattern.test.ts` verifies this guarantee on every runtime.

| Token | Matches |
| --- | --- |
| Static text | The same raw (percent-encoded) text. At definition time each static segment is canonicalized the way `URLPattern` does it, through a URL's `pathname` setter. `/café` and `/caf%C3%A9` are therefore the same pattern, and both match the request path `/caf%C3%A9`. Do not use `encodeURI`: it re-encodes an existing `%`. |
| `:name` | Exactly one non-empty segment. Must span the whole segment, with no regex group and no `?`/`+`/`*` modifier. |
| `*` | The rest of the path: possibly empty, may contain `/`. Allowed only as the last segment. `/files/*` matches `/files/` and `/files/a/b`, but not `/files`. |

The two intentional differences from `URLPattern`:

- The wildcard value is exposed as `params['*']`. `URLPattern` names it `'0'`.
- Parameter values are percent-decoded. `URLPattern` returns them encoded.

### Matching

- **Case and slashes:** matching is case-sensitive, and trailing slashes are significant (`/users` ≠ `/users/`).
- **Empty segments:** `//` produces an empty segment, which matches no static segment and no `:name`.
- **Trailing slashes:** a pattern ending in `/` (including `/` itself) ends in an empty static segment. That segment matches only the same trailing slash in the request.
- **Priority:** at each node, try the static child, then the param child, then the wildcard. Registration order never affects matching.
- **Method-aware matching:** a terminal node accepts the request only if it has a handler for the method, or a `GET` handler when the method is `HEAD`. Otherwise matching backtracks and continues.
- **Trie shape:** each trie node sits at a fixed segment depth, so a lookup visits each node at most once. Lookup is typically O(k) in path length and never worse than the trie size.
- **Static children** are dispatched by first character code and compared in place against `request.url`.
- **Decoding:** a `:name` or `*` value is decoded with `decodeURIComponent` only if it contains `%`.
  - **When:** decoding happens only after the final route has been selected, never during backtracking. It also happens after segmentation, so `%2F` becomes `/` inside a value without splitting the path.
  - **Malformed encoding** in the selected route's values yields `400 Bad Request`.

### Route definition errors

`router()` throws a `TypeError` naming the pattern when given any of the following:

- A method that is not a valid HTTP token (`'g e t'`, `''`).
- A method that can never match:
  - Fetch upper-cases `DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST`, and `PUT`, so any other casing of these (`'get'`) never matches. Other methods are case-sensitive and accepted in any casing.
  - `CONNECT`, `TRACE`, and `TRACK` are forbidden by Fetch.
- A pattern that does not start with `/`.
- Two different `:name`s at the same position (`/u/:id` vs `/u/:userId/posts`).
- The same method and pattern registered twice, including equivalent encodings (`/café` and `/caf%C3%A9`).
- A `:name` that is not a valid `URLPattern` name: a JavaScript identifier (`/:`, `/:id?`).
- The same `:name` twice in one pattern (`/:id/x/:id`). `URLPattern` rejects duplicate group names too.
- A `:` or `*` that does not form a whole segment (`/a:b`, `/files/a*`). In `URLPattern` these would be parameters or wildcards inside a segment.
- `*` in any segment but the last.
- An empty segment anywhere but the end (`/a//b`).
- A dot segment (`.`, `..`, `%2e`). Request paths are already normalized, so it can never match.
- Any other `URLPattern` syntax character: `(`, `)`, `{`, `}`, `?`, `+`, `\`.

### Implementation

- **`src/path.ts`:** `pathStart(url)` and `pathEnd(url, start)` return the path bounds as indices, allocation-free.
- **`src/routing/trie.ts`:** `Trie<T>` has three methods. A router owns one trie and only ever calls it synchronously.
  - **`insert(method, pattern, value)`:** registers a route and performs every definition check.
  - **`match(method, url, start, end)`:** returns the selected value, `MALFORMED` (respond 400), or `undefined`. On success, the parameters are in `trie.params`. Read them before the next `match`. This keeps a successful match within the allocation budget.
  - **`allow(url, start, end)`:** the sorted `Allow` list for a 405. It is empty when no route matches the path, which means 404. It runs only on the miss path, so it may allocate.

## HTTP semantics

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

### Errors

- **The core never catches errors from handlers or filters.** A throw or rejection propagates, and the promise returned by `fetch` rejects. Mapping errors to responses is the job of an error filter (for example, RFC 9457 in `oleo.js/filters`).
- **Native runtimes** then apply their own behavior for unhandled errors (typically a 500).
- **The Node adapter** responds `500 Internal Server Error` with an empty body if headers have not been sent. Otherwise it destroys the socket. In both cases it reports the error with `console.error`. Client disconnects are not errors (see [Client disconnects](#client-disconnects)).

## Performance budget

**Allowed allocations per matched request:**

- The `Context`, created by `fetch`.
- The router's derived context and the `params` object, both only for routes with parameters.
- Parameter value strings.
- Decoded strings, only when a value contains `%`.

**Forbidden on the request path:**

- `new URL()`, `split()`, and regex.
- Substrings for static comparison.
- Per-request closures or arrays created by filter composition.

A context key's `with` allocates one derived context per call. That cost belongs to the filter that calls it, not to the core.

## Node.js adapter (`oleo.js/node`)

### API

```ts
interface NodeListenerOptions<E = unknown> {
  env?: E
  trustProxy?: boolean // default false
}

type NodeRequest = IncomingMessage | Http2ServerRequest
type NodeResponse = ServerResponse | Http2ServerResponse
type NodeListener = (req: NodeRequest, res: NodeResponse) => void

function toNodeListener<E>(app: FetchHandler<E>, options?: NodeListenerOptions<E>): NodeListener
```

The implementation is in `src/node/listener.ts`; `src/node/index.ts` re-exports `toNodeListener` and these types.

```ts
createServer(toNodeListener(toFetch(app), { env })).listen(3000)
```

- **Any `{ fetch }` object.** The listener accepts any object with a `fetch` method, not only the output of `toFetch`. It calls `app.fetch(request, options.env, stub)`.
- **The user owns the server.** Creating it, listening, TLS, and shutdown are the user's concern. The listener works with `node:http`, `node:https`, and the `node:http2` compatibility API.

### Ingress: `IncomingMessage` / `Http2ServerRequest` → `Request`

- **URL:**
  - **Scheme:** `https` when the socket is TLS, or `:scheme` on HTTP/2.
  - **Host:** from `Host` or `:authority`.
  - **Proxy headers:** when `trustProxy` is `true`, the first value of `X-Forwarded-Proto` (only `http` or `https`) and of `X-Forwarded-Host` override the scheme and host. Otherwise they are ignored.
- **Host validation (security):** the host is joined into the URL string, and Node's parser does not validate it. A host that is missing, or that contains `/`, `\`, `?`, `#`, `@`, or whitespace, gets `400`. Otherwise `Host: evil.test/admin` would reroute `/x` to `/admin/x`. The same check applies to `X-Forwarded-Host`.
- **Request target:**
  - Origin-form (`/path?query`) is joined with the scheme and host.
  - Absolute-form (`http://host/path`) is used as-is: RFC 9112 says it overrides `Host`.
  - Any other form (such as `OPTIONS *`) fails `Request` construction and gets `400`.
- **Headers:** built from `rawHeaders` using `append`, so duplicates are preserved. HTTP/2 pseudo-headers are stripped.
- **Body:** `null` for `GET` and `HEAD`. Otherwise `Readable.toWeb(req)` with `duplex: 'half'`.
- **Abort:** an `AbortController` aborts when the connection closes before the response finishes. Its `signal` is passed to the `Request`.
- **Construction failures:** the adapter responds directly, without calling `app.fetch`.
  - **`501 Not Implemented`:** a method Fetch forbids (`CONNECT`, `TRACE`, `TRACK`). This is checked before construction, with the list shared through `src/http-method.ts`.
  - **`400 Bad Request`:** an invalid host, or any other `new Request()` failure (an unsupported request target, an invalid header value).
- **Context:** `env` comes from `options.env`, and `executionCtx` is the stub.

### Egress: `Response` → `ServerResponse` / `Http2ServerResponse`

- **Head:** `writeHead(status, statusText, headers)`. Multiple `Set-Cookie` values are written via `headers.getSetCookie()`. On HTTP/2, `Connection`, `Keep-Alive`, `Transfer-Encoding`, and `Upgrade` are dropped.
- **Body:** `stream.pipeline(Readable.fromWeb(res.body), serverRes)`, which honors backpressure. An error destroys the socket. A client abort tears down the pipeline and cancels the web stream. A `null` body ends immediately, and `HEAD` writes no body.
- **Cancellation failures:** `HEAD` cleanup finishes before headers are sent, so failure is reported and returns 500. Cleanup of a late response is also awaited and reported on failure; the adapter never writes to an already destroyed response.
- **No buffering** in either direction.

### Client disconnects

- **Signalling:** the `Request`'s `signal` aborts whenever the response closes before it ends.
- **Late responses:** if the app's response arrives after the client is gone, its body is cancelled and nothing is written.
- **Not errors:** a disconnect surfaces in the pipeline as `ERR_STREAM_PREMATURE_CLOSE`. It is not reported, and only other pipeline errors count as server errors.
- **Do not classify by `signal.aborted`.** A failing response body also destroys the response, which aborts the signal.

### Other runtimes

Bun and Deno implement `node:http`, and the built adapter has been observed working on both. This is not a supported target; those runtimes should use their native `{ fetch }` entry.

## Standards conformance

WinterTC (Ecma TC55) standards specify runtimes, not libraries. oleo.js conforms in this precise sense: its portable packages depend only on APIs that a conformant runtime must provide.

### Baseline

- **ECMA-262 + ECMA-429, 1st edition (2025 snapshot).** ECMA-429 is revised annually. Moving to a newer edition is an explicit, documented decision.
- **Proposals are not used.** TC55 proposals (Sockets API, CLI API, Iterable Streams, Web Crypto Streams) are not used until they become Ecma standards.

### Portable code must not

- Import runtime modules: `node:*`, `bun:*`, `cloudflare:*`.
- Reference non-standard globals, even for feature detection: `process`, `Buffer`, `global`, `require`, `__dirname`, `__filename`, `setImmediate`, `Deno`, `Bun`, `window`, `document`. Use `globalThis` instead of `global`.
- Depend on behavior that ECMA-429 leaves unspecified or that varies by runtime:
  - Forbidden-header filtering. Never read or set `Host`, `Connection`, or other hop-by-hop headers.
  - `Request` `duplex` streaming.
  - The `Origin` header.

### Runtime support

Runtimes are identified by their ECMA TR/114 runtime keys.

| Key | Portable packages | Network serving |
| --- | --- | --- |
| `workerd` | Native | Native `{ fetch }` |
| `deno` | Native | Native `{ fetch }` |
| `bun` | Native | Native `{ fetch }` |
| `node` | Native | Requires `oleo.js/node` |

Node.js is not fully ECMA-429 conformant (its global object is not an `EventTarget`), but it provides every API the portable packages use. Supported versions are the currently maintained Node.js LTS lines.

### Enforcement

1. **Types:** portable packages, including their tests, compile under `tsconfig.json` with `types: []`. Neither `@types/node` nor `@types/bun` is in scope.
2. **Lint:** two oxlint rules are enabled at the top level of `.oxlintrc.json`, and an `overrides` entry turns them off for `src/node/**`, `test/node/**`, and `*.config.ts`:
   - `no-restricted-imports` bans runtime module specifiers.
   - `no-restricted-globals` bans the globals listed above.
3. **Runtime matrix:** the portable `*.test.ts` files run on all four runtimes. Each test executes inside the named runtime itself, not inside a Node worker (verified through `navigator.userAgent`):

   | Runtime | Script | How it runs |
   | --- | --- | --- |
   | `node` | `test:node` | `vitest run` |
   | `bun` | `test:bun` | `bun --bun vitest run` |
   | `workerd` | `test:workerd` | Vitest with `@cloudflare/vitest-plugin` (`vitest.workers.config.ts`) |
   | `deno` | `test:deno` | `deno run -A node_modules/vitest/vitest.mjs run` |

   A failure on any runtime blocks release.
4. **Differential routing tests** (`test/portable/routing/urlpattern.test.ts`) verify the subset guarantee.
   - **Method:** corpus and generated patterns get a single-route trie, compared against `new URLPattern({ pathname })` on corpus or generated paths. The comparison checks matching and decoded parameter values. Reference capture names are aliased to avoid workerd's `__proto__` capture bug, as described under Property-based tests.
   - **Coverage:** all four runtimes ship `URLPattern`, so this runs four independent URLPattern implementations. The suite skips itself only on a runtime without `URLPattern`.
   - **Extending:** when changing pattern syntax or canonicalization, add patterns and paths to the corpus. A divergence means oleo is wrong, not the test.

## Naming conventions

- **Types, interfaces, classes:** PascalCase, with no `I` prefix (`HttpHandler`, `Context`).
- **Functions, methods, variables, properties:** camelCase.
- **Module-level primitive constants:** UPPER_SNAKE_CASE (`CHAR_SLASH`).
- **Acronyms are cased as words:** `HttpHandler`, `parseUrl`, not `HTTPHandler` or `parseURL`. This rule covers oleo's own identifiers only; platform names such as `URL`, `URLPattern`, and `TextEncoder` keep their standard spelling.
- **Type parameters:**
  - `E` for env and `P` for params.
  - Otherwise a `T`-prefixed descriptive name (`TPattern`).
- **Abbreviations:** `req`, `res`, `ctx`, `env`, and `next` are the standard parameter names. Spell everything else out. The one exception is `del`, because `delete` is a reserved word.
- **Conversion functions are named `toX`** (`toFetch`, `toNodeListener`).
- **`compose` follows the functional-programming convention:** it applies right to left, so the first argument is outermost.
- **Files:** kebab-case `.ts`. Runtime tests are named `*.test.ts`, and type tests `*.test-d.ts`.

## Non-goals

These are not part of the core. Compose them as filters or separate packages instead:

- **Schema validation.** Bring Zod, Valibot, TypeBox, or Typia through a filter.
- **Request/response wrappers or response builders.**
- **Implicit URL normalization** (trailing slashes, case folding, duplicate slashes). Normalize in a filter if needed.
- **File-system routing and view engines.**

## Open decisions

None for Phases 1 to 3. APIs for Phase 4 (`oleo.js/contract`) are undecided. Ask before implementing them.

## Roadmap

1. **Core**, implemented in this order:
   1. Path extraction and the trie. *(done)*
   2. `router`, the route helpers, and the HTTP semantics (404, 405, `HEAD`, 400). *(done)*
   3. `toFetch`, `compose`, and `contextKey`. *(done)*
   4. Differential `URLPattern` tests. *(done)*
   5. `oleo.js/node`. *(done)*
2. **Route groups:** `group(prefix, options?, ...items)`, flattened into the router's trie, with scoped filters and merged prefix parameters. See [Route groups](#route-groups-phase-2). *(done)*
3. **`oleo.js/filters`:** tree-shakeable standard filters `cors`, `bearerAuth`, `problemDetails`, and `requestLogger`. See [Standard filters](#standard-filters-phase-3).
4. **`oleo.js/contract`:** an http4k-contract–style declarative layer that generates OpenAPI 3.1.
