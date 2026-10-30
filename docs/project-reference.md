# oleo.js technical reference

Project goals and architectural direction are defined in [AGENTS.md](../AGENTS.md). This document contains development procedures, current behavior, and planned feature specifications. Repository paths in prose and examples are relative to the repository root.

oleo.js is a zero-dependency TypeScript HTTP router and middleware library. An application is a function `(Request, Context) => Response | Promise<Response>`, and middleware is a function that wraps one. The portable core uses only ECMA-262 and the WinterTC Minimum Common Web API (ECMA-429), so it runs unmodified on Cloudflare Workers, Deno, and Bun, and on Node.js through an adapter.

Design influences: [http4k](https://www.http4k.org/) (server as a function, composable filters) and [itty-router](https://itty.dev/itty-router) (minimal API surface, native `Request`/`Response`).

## Scope and status

| Export | Tier | Contents | Status |
| --- | --- | --- | --- |
| `oleo.js` | Portable | Router, route helpers, groups, environment-bound helpers (`routesFor`), core types, `compose`, `withFilters`, context keys, `toFetch` | Phases 1–2 implemented |
| `oleo.js/node` | Adapter | `node:http` / `node:http2` bridge | Implemented |
| `oleo.js/filters` | Portable | CORS, Bearer authentication, RFC 9457 errors, request logging, body size limits, and message transformations | Phase 3 implemented, with `bodyLimit` and transformation helpers |
| `oleo.js/contract` | Portable | Declarative contracts, environment-bound contracts (`contractFor`), Standard Schema input validation, OpenAPI 3.1.1 generation | Phase 4 implemented |

Phases 1–4 are implemented, including the four original [standard filters](#standard-filters-phase-3), [`bodyLimit`](#bodylimitoptions), and the optional [Contract module](#contracts).

Read the [hard rules](#hard-rules) and [development workflow](#development-environment) before changing code. Use the [repository layout](#repository-layout) to locate implementations and tests. The sections below describe the current public contracts.

Contract reference: [Core API](#core-api) · [Routing](#routing) · [Route groups](#route-groups-phase-2) · [HTTP semantics](#http-semantics) · [Node adapter](#nodejs-adapter-oleojsnode) · [Standard filters](#standard-filters-phase-3).

## Hard rules

1. **Zero runtime dependencies.** Dev dependencies are allowed.
2. **Portable packages use only ECMA-262 and ECMA-429 APIs.** See [Standards conformance](#standards-conformance).
3. **Never wrap, proxy, subclass, or mutate `Request` or `Response`.** Build responses with `new Response()` or `Response.json()`.
4. **`Context` holds data only.** Never add helper methods (`ctx.json()`, `ctx.text()`, …) to it.
5. **Routing hot path:** no `new URL()`, `split()`, regex, or substring allocation for static comparison. See [Performance budget](#performance-budget).
6. **Route definition errors throw when `router()` is called**, never at request time.
7. **Do not present oleo.js conventions as standards.** The `{ fetch }` entry shape and `ExecutionContext` are not WinterTC APIs.

## Development environment

### Commands and completion checks

| Command | Purpose |
| --- | --- |
| `bun install` | Install dev dependencies |
| `bun run lint` | Run oxlint |
| `bun run typecheck` | Check portable/test and Node/tooling tsconfigs without emitting |
| `bun run test` | Run Node runtime tests and the type inference contract |
| `bun run test:types` | Run type tests only |
| `bun run test:node` | Run portable and Node adapter tests on Node |
| `bun run test:bun`, `test:workerd`, `test:deno` | Run portable tests on the named runtime |
| `bun run test:all` | Run the full runtime matrix; type tests run separately via `test` or `test:types` |
| `bun run build` | Emit JavaScript and declarations to `dist/` |

- Before considering a change done, run `lint`, `typecheck`, and `test`.
- Run `test:all` for portable behavior changes and before release. A failure on any runtime blocks release. No CI workflow is currently checked into this repository; the matrix is an explicit verification step.
- For module moves or public export changes, run `build` and verify a consumer using the built package and its declarations. Remove obsolete generated files after moves: `tsc` does not clean old outputs from `dist/`.
- Keep tests under `test/`, with separate portable, Node, and type projects. Missing test selections must fail; do not enable `passWithNoTests`.

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
  compose.ts                # compose, withFilters, and combined environment inference
  context-key.ts            # contextKey
  context-defaults.ts       # shared EMPTY_PARAMS and executionCtx stub
  http-method.ts            # method validation and Fetch-forbidden methods
  http-problem.ts           # shared problem type and rendering, with bodyless HEAD handling
  <module>.ts               # core modules (kebab-case)
  routing/
    route.ts                # immutable Route/RouteGroup values, helpers, group, routesFor, internal kind checks
    router.ts               # filter composition, dispatch, default responses
    walk.ts                 # group expansion shared by routing and documentation
    pattern.ts              # definition-time path validation and segment encoding
    trie.ts                 # segment trie: definition checks, matching, Allow lists
  filters/
    index.ts                # `oleo.js/filters` entry
    cors.ts                 # origin policy, preflight handling, and copied response headers
    bearer-auth.ts          # Bearer credentials, verification, and typed principals
    problem-details.ts      # problem documents, error mapping, and isolated reporting
    request-logger.ts       # request outcomes, timing, and isolated logging callbacks
    body-limit.ts           # byte-counted request body limits and buffered forwarding
    map-request.ts          # synchronous/asynchronous request transformations
    map-response.ts         # synchronous/asynchronous response transformations
    response-headers.ts     # header snapshots and response reconstruction
  node/
    index.ts                # `oleo.js/node` entry
    listener.ts             # toNodeListener: ingress, egress, errors, disconnects, body discarding
  contract/
    index.ts                # `oleo.js/contract` public entry
    types.ts / standard-schema.ts # public contracts and structural schema interfaces
    contract.ts             # Route creation, metadata, full-path checks, and contractFor
    definition.ts           # declaration validation and snapshots
    validate.ts             # input extraction, schema validation, and problem responses
    openapi.ts              # document generation, security metadata, default errors
    json-schema.ts          # JSON copying and reference relocation
test/
  portable/
    <module>.test.ts        # portable runtime tests, including generated properties
    arbitraries.ts          # shared input generators and deterministic run settings
    runtime-baseline.test.ts # checks the runtime assumptions the core relies on
    contract/              # input, document, endpoint integration, and property tests
    routing/
      router.test.ts        # route helpers, dispatch, HTTP semantics
      router.property.test.ts # routing and grouped-filter properties through the public API
      group.test.ts         # route group flattening, filters, definition errors
      trie.test.ts          # matching, parameter decoding, definition errors
      urlpattern.test.ts    # corpus and generated URLPattern differential tests
    filters/
      cors.test.ts          # origin policies, preflights, Vary, and response preservation
      bearer-auth.test.ts   # challenges, verification, principals, and group placement
      problem-details.test.ts # error mapping, response conversion, and reporting
      problem-details.property.test.ts # generated status/header/body and serialization properties
      request-logger.test.ts # outcome fields, timing, privacy, and callback isolation
      body-limit.test.ts    # limits, chunked streams, cancellation, problem and contract integration
      standard-filters.test.ts # composition of the four original filters around routed authentication
      standard-filters.property.test.ts # generated CORS, Bearer, logging, and body-limit properties
      transforms.test.ts    # callback ordering, context visibility, errors, and streams
      response-headers.test.ts # header preservation, cookies, streaming, and generated cases
  node/
    listener.test.ts        # real HTTP/1.1 and HTTP/2 servers
  types/
    inference.test-d.ts     # public type inference contract
    filters.test-d.ts       # filter options and preservation of environment/parameter inference
    composition.test-d.ts   # combined environments and the one-call withFilters entry
    transform-filters.test-d.ts # transform callback inference and public option types
    contract.test-d.ts      # validated input, environment, group and filter inference
vitest.config.ts            # projects: portable, node, types
vitest.workers.config.ts    # portable tests inside workerd
.oxlintrc.json
tsconfig.json / tsconfig.node.json / tsconfig.build.json
dist/                       # build output, not committed
```

### Module boundaries

- Portable packages never import adapters. Adapters may import portable packages.
- `src/index.ts`, `src/filters/index.ts`, `src/contract/index.ts`, and `src/node/index.ts` are the public export boundaries. Internal modules import their dependencies directly; no internal barrel is needed under `routing/`.
- `routing/route.ts` creates immutable values, owns their internal tags, and stores optional construction checks. Router and OpenAPI construction invoke these checks with the full path; route helpers and `group()` do not validate partial paths.
- The Contract module imports the core; the core never imports Contract. Group walking and pattern rules are shared without invoking filters during document generation. Problem rendering is shared independently of the filter module.
- Shared context defaults and HTTP method rules live outside `routing/`, so `fetch.ts` and the Node adapter do not depend on routing implementation modules.
- Keep inference machinery in `types.ts` and beside route definitions. See the [type inference contract](#type-inference-contract) before changing signatures.

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
- `exports` maps `.` → `dist/index.js`, `./filters` → `dist/filters/index.js`, and `./node` → `dist/node/index.js`, each with a `types` condition.
- `engines.node` covers the currently maintained Node.js LTS lines.
- **Declaration files keep `.ts` specifiers.** `rewriteRelativeImportExtensions` rewrites them in emitted `.js` only, so the emitted `.d.ts` files still import `./routing/router.ts` and similar.
  - **Verified:** a consumer project on TypeScript 7 with `NodeNext` resolves them to the `.d.ts` files and keeps full inference. The built JavaScript also runs on Node, Bun, and Deno.
  - **Untested:** consumers on older TypeScript versions. Check before publishing.

### Type inference contract

[`test/types/inference.test-d.ts`](../test/types/inference.test-d.ts) is the contract for route parameters, env compatibility, filters, groups, and their rejection cases. It tests the real implementations. **Never weaken, delete, or add `@ts-expect-error` to an existing case just to make it pass; ask instead.**

[`test/types/filters.test-d.ts`](../test/types/filters.test-d.ts) covers each factory's options, contextual environments, route-parameter preservation, and principal types. The env-agnostic factories use `<E = unknown>` to carry the surrounding environment type into group options; returning a fixed `HttpFilter<unknown>` would widen the group's environment to `unknown`. Bearer verification accepts an annotated context or infers its environment from the surrounding router/group.

[`test/types/composition.test-d.ts`](../test/types/composition.test-d.ts) covers automatic intersection of independent environment requirements, neutral filters, arrays, nested stacks, explicit generics, route parameters, and invalid supplied environments. [`test/types/transform-filters.test-d.ts`](../test/types/transform-filters.test-d.ts) covers transformation callbacks and their inference through `withFilters` and route groups.

Keep these mechanisms intact:

| Mechanism | Why it is required |
| --- | --- |
| Generic `TEnv` and `P` on `HttpFilter` | An env-agnostic filter can wrap env-specific handlers without losing route parameters |
| Optional contravariant `FILTER_ENV` phantom | Generic signature constraints alone do not reject incompatible filter envs; also protects `compose` and group filters |
| Optional contravariant `BASE` phantom | Tracks prefix parameters required by a route/group; a route requiring none fits anywhere, while `router()` only accepts items requiring none |
| Plain mapped `JoinParams` | A conditional type collapses an unresolved `TBase` to `Params` during inference |
| `NoInfer<TBase>` in route helpers | Prevents a separately declared handler from inferring `TBase` backwards and losing inference; retain the defensive `NoInfer` in `group()` too |
| `NoInfer<T>` in the Bearer verifier return type | Lets the context key determine the principal type, preventing an unknown verifier result from widening it and bypassing validation |
| Non-distributive `FilterEnvironment` inference | Infers the intersection from all contravariant filter requirements together; extracting a union first would lose requirements alongside `unknown` |
| Contextual composition overloads | Preserve environment inference for inline filter factories; the heterogeneous overload handles filters with independent requirements |
| Single `group()` signature with `GroupArgs` | One signature whose optional first element accepts options or an item reports a mismatched item as the missing parameter; overloads only reported the last overload's options parameter |
| `[BASE]?: never` on `GroupOptions` | A `RouteGroup` also has `filters`; without the marker a group needing parameters would type-check as options while `group()` treats it as an item |
| Non-distributive `FetchArgs` / `NodeListenerArgs` | `env` may be omitted only when `undefined` is a valid environment, so `unknown` and `Env \| undefined` keep it optional while `Env` requires it |
| Defaulted `TB` in `routesFor` and `contractFor` helpers | Inline routes still infer enclosing parameters from context; separately declared ones fall back to the bound `TBase` |
| Fixed base in the bound `group` | An inferred base has no source outside a group, which also loses the prefix parameters of inline routes; fixing it to `TBase` keeps standalone groups typed |

Phantom members are type-level only and are never set at runtime. The optional filter phantom keeps ordinary arrow functions assignable as filters. See [route groups](#route-groups-phase-2) for usage patterns.

### Property-based tests

- Keep example-based regressions and the full type inference contract. fast-check adds generated inputs and shrinks failing cases; it does not replace integration or type tests.
- `test/portable/arbitraries.ts` defines shared generators and `PROPERTY_OPTIONS` (seed `20261029`, 300 runs per property). Keep portable tests free of runtime globals, including when configuring randomness.
- Properties cover parameter names and percent-decoding, route priority and registration order, `Allow` unions, group flattening and filter equivalence, malformed paths, path extraction, context-key isolation, filter order, and URLPattern equivalence. Generate matching and nonmatching paths so a property cannot pass by only checking 404s.
- Problem-details properties cover status/header preservation, unchanged existing bodies, generic errors, and JSON extension round trips. Compare extensions after JSON normalization, which converts values such as `-0` to `0`.
- Standard-filter properties cover CORS origin decisions and `Vary` merging, valid and malformed Bearer credentials, principal preservation, and logging of generated paths, statuses, and thrown values. Integration cases exercise preflights, authentication, problem responses, and final-status logging together.
- Composition properties exercise both `compose` and `withFilters`. Response-header properties verify generated body bytes and unaffected headers while configured names are replaced.
- Run routing properties with `bun run test --project portable router.property.test.ts`. All properties also run through the regular test commands and the four-runtime matrix.
- To reproduce a failure, pass its printed `seed` and `path` to the failing `fc.assert` options. Keep the dependency version fixed, save the reduced input as a regression or an explicit `examples` entry, and remove the temporary replay `path` afterwards. To explore more inputs, temporarily change the shared seed and increase `numRuns`.
- Reference results must be independent of the implementation. Use `Object.fromEntries` for expected parameter maps so `__proto__` becomes an own property. The URLPattern reference workaround is described under [Enforcement](#enforcement).

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
  - Runtime-specific handling of the `Origin` header. The Phase 3 CORS contract must be tested on every runtime, including requests without this header.

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
3. **Runtime matrix:** portable `*.test.ts` files must execute inside the named runtime. Use the configured scripts; Node adapter tests stay in the Node project:

   | Runtime | Script | How it runs |
   | --- | --- | --- |
   | `node` | `test:node` | `vitest run --project portable --project node` |
   | `bun` | `test:bun` | `bun --bun vitest run --project portable` |
   | `workerd` | `test:workerd` | Vitest with `@cloudflare/vitest-plugin` (`vitest.workers.config.ts`) |
   | `deno` | `test:deno` | `deno run -A node_modules/vitest/vitest.mjs run --project portable` |
4. **Differential routing tests** (`test/portable/routing/urlpattern.test.ts`) verify the subset guarantee.
   - **Method:** corpus and generated patterns get a single-route trie, compared against `new URLPattern({ pathname })`. Check both matching and decoded parameter values on each runtime. The suite skips only when `URLPattern` is absent.
   - **Reference workaround:** workerd's URLPattern drops captures named `__proto__`. The oracle aliases capture names, maps them back into own properties, and also checks matching with the original pattern. Public API regressions still use the original names on every runtime.
   - **Extending:** add patterns and paths when changing syntax or canonicalization. Investigate every divergence; fix oleo defects or document a demonstrated reference-runtime defect. Do not weaken comparisons just to make tests pass.

## Core API

### Types

Exact declarations live in [`src/types.ts`](../src/types.ts); public exports live in [`src/index.ts`](../src/index.ts).

| Type | Contract |
| --- | --- |
| `Params` | `Readonly<Record<string, string>>` |
| `Context<E, P>` | Readonly `params`, `env`, and `executionCtx` fields; defaults are `E = unknown`, `P = Params` |
| `ExecutionContext` | oleo.js interface with `waitUntil(promise: Promise<unknown>): void` |
| `HttpHandler<E, P>` | `(req: Request, ctx: Context<E, P>) => Response \| Promise<Response>` |
| `HttpFilter<E>` | Wraps a handler; requires at least env `E`, preserving the handler's env and parameter types |
| `FetchHandler<E>` | A detachable `fetch(request, env?, executionCtx?)` returning `Promise<Response>` |
| `ParamsOf<TPattern>` | Exported for separately declared handlers; `'/users/:id/*'` yields readonly `id` and `'*'` strings; a non-literal `string` yields `Params` |

The [type inference contract](#type-inference-contract) explains the required generic and phantom-member design.

### Building an application

An application is plain function composition. There is no application class and no mutable registration step.

```ts
import { router, get, post, del, toFetch, withFilters } from 'oleo.js'

const routes = router(
  get('/users/:id', (req, ctx) => Response.json({ id: ctx.params.id })),
  post('/users', createUser),
  del('/users/:id', requireAdmin(deleteUser)), // route-level filter: wrap the handler
)

// Application-provided filters; standard alternatives are exported from oleo.js/filters.
const app = withFilters(routes, logger(), requireAuth())

export default toFetch(app)
```

| Function | Returns | Notes |
| --- | --- | --- |
| `get`, `post`, `put`, `patch`, `del`, `head`, `options` `(pattern, handler)` | `Route` | `del` because `delete` is a reserved word |
| `route(method, pattern, handler)` | `Route` | Any other method (`PROPFIND`, …) |
| `router(...items)` | `HttpHandler` | Takes routes and groups. Builds the trie once. Throws on [route definition errors](#route-definition-errors) |
| `group(prefix, options?, ...items)` | `RouteGroup` | See [Route groups](#route-groups-phase-2) |
| `routesFor<E, TBase>()` | `RouteHelpers` | The helpers above bound to environment `E`, for routes declared outside their router. Same functions at runtime; see [Environment-bound helpers](#environment-bound-helpers) |
| `compose(...filters)` | `HttpFilter` | `compose(a, b)(h)` is `a(b(h))`: the first filter is outermost. `compose()` is the identity |
| `withFilters(handler, ...filters)` | `HttpHandler` | Applies the same outermost-first order in one call, retaining route parameters and combining environment requirements |
| `toFetch(handler)` | `FetchHandler` | The only entry point. Creates the `Context` |

- **Routes are values.** A `Route` is immutable, and `router()` reads it once. A router is itself an `HttpHandler`, so routers and filters nest freely.
- **Type inference.** Route patterns are parsed with template literal types: `'/users/:id/*'` yields `ctx.params: { id: string; '*': string }`. `router<E>(...)` fixes `E` for its routes, and route helpers infer `E` and `P` contextually.
- **Clients are handlers too.** Any `(req) => Promise<Response>` is assignable to `HttpHandler`. Do not pass `globalThis.fetch` itself as a handler: its second parameter is `RequestInit`, not `Context`. Wrap it as `(req) => fetch(req)`.

### Environment-bound helpers

A route declared on its own, such as in another module, has no surrounding `router<E>()` to infer `E` from. `routesFor<E, TBase = {}>()` returns `RouteHelpers<E, TBase>`: `route`, the method helpers, and `group`, with `E` fixed.

- **Method helpers** default their enclosing parameters to `TBase` and still infer them inline, so `routesFor<Env, ParamsOf<'/users/:userId'>>().get('/settings', …)` sees `userId` and fits only under groups that supply it.
- **`group`** fixes its enclosing parameters to `TBase`. A group declared on its own therefore types its inline routes with its prefix parameters, which an unannotated core `group()` cannot. For a group nested inline inside a parameterized group, use the core `group()`, which infers the enclosing parameters.
- **No runtime cost.** The result is one frozen object holding the module's own helper functions, shared by every call. `contractFor<E, TBase>()` in `oleo.js/contract` binds `contract` the same way.

### Composing filters

- Use `withFilters(handler, ...filters)` to apply filters directly, and `compose(...filters)` to create a reusable stack. Both keep the first filter outermost and apply each wrapping closure once, when the stack is attached to a handler.
- Independent environment requirements are intersected automatically. For `db: HttpFilter<DbEnv>` and `cache: HttpFilter<CacheEnv>`, `compose(db, cache)` produces `HttpFilter<DbEnv & CacheEnv>`. Env-agnostic filters do not erase those requirements. Existing explicit calls such as `compose<Env>(...)` remain supported.
- `withFilters` combines the handler's environment with the filters' requirements. A handler using only the database may be wrapped by a cache-dependent filter; the resulting handler requires both. Supplied Fetch environments are checked against that combined type. Contradictory requirements remain contradictory instead of being widened away.
- A typed handler passed first to `withFilters` supplies contextual environment typing to inline filter factories. Inline route handlers keep their inferred parameter names. Separate transformation factories can instead use an annotated `Context<Env>` callback.
- Empty compositions and `withFilters(handler)` return the handler unchanged. The result is an ordinary callable handler or filter, with no chain methods or additional lifecycle state.

### Entry point

`toFetch(handler).fetch(request, ...args: FetchArgs<E>)` follows the Workers signature `(request, env, executionCtx?)`, and the returned object is directly usable as `export default`.

- **`fetch` must not depend on `this`.** Runtimes may call it detached (for example `Deno.serve(app.fetch)`), so it is a closure, not a method that reads `this`.

- **`env`:** whatever the runtime passes second becomes `ctx.env` (Workers `Env`, Bun `Server`, Deno `ServeHandlerInfo`).
- **Required when needed:** `FetchArgs<E>` makes `env` optional only when `undefined` is assignable to `E` (including `unknown`). For `toFetch(router<Env>(…))`, `app.fetch(request)` is a type error. On Bun and Deno, which pass their own second argument, wrap an application that needs an environment: `Deno.serve((request) => app.fetch(request, env))`.
- **`executionCtx`:** when the runtime passes none, the stub is used.
- **Testing:** `toFetch(app).fetch(new Request('http://test/users/1'))` works with no network and no adapter. `env` is `undefined` and `executionCtx` is the stub.

### Context

- **Initial context.** `toFetch` creates one initial `Context` per request and never mutates it. Routing and context keys may create derived contexts as described below.
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
- Two different `:name`s at the same position of the same path, under any methods (`GET /u/:id` vs `POST /u/:userId`). Parameter names belong to routes, so diverging paths may name a shared position differently (`/u/:id` and `/u/:userId/posts`).
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
- **`src/http-method.ts`:** `checkMethod` validates methods when `router()` is called; the Node adapter shares its forbidden-method list.
- **`src/routing/trie.ts`:** `Trie<T>` has three methods. A router owns one trie and only ever calls it synchronously.
  - **`insert(method, pattern, value)`:** registers a route and validates its full pattern, conflicts, and duplicates. Method validation belongs to `checkMethod`. Parameter nodes are positional and unnamed; each terminal node records its path's parameter names in order, shared by every method there.
  - **`match(method, url, start, end)`:** returns the selected value, `MALFORMED` (respond 400), or `undefined`. On success, the parameters are in `trie.params`. Read them before the next `match`. This keeps a successful match within the allocation budget. Captures happen while unwinding from the selected terminal, so they take that terminal's names from the last one back, without allocating.
  - **`allow(url, start, end)`:** the sorted `Allow` list for a 405. It is empty when no route matches the path, which means 404. It runs only on the miss path, so it may allocate.

## Route groups (Phase 2)

*Status: values are defined in `src/routing/route.ts` and flattened through `src/routing/walk.ts`. Runtime tests are in `test/portable/routing/group.test.ts`, and type tests in the "route groups" block of `test/types/inference.test-d.ts`.*

A group joins a prefix onto its routes when `router()` is called and flattens them into the same trie as every other route. At run time a grouped route is indistinguishable from writing its full pattern directly. There is no run-time mounting and no hidden path state in `Context`.

### API

`group(prefix, ...items)` and `group(prefix, options, ...items)` return a `RouteGroup`. Items are routes or nested groups. `GroupOptions<E>` has one optional field, `filters: readonly HttpFilter<E>[]`. Both call shapes share one signature, `group(prefix, ...rest: GroupArgs<E, TPrefix, TBase>)`, so an item whose required parameters the prefixes do not supply is reported as that missing parameter. The exact signature and inference constraints live in [`src/routing/route.ts`](../src/routing/route.ts).

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
- **Validity is judged on the full pattern.** Every [route definition error](#route-definition-errors) applies after concatenation. For example, top-level `'api' + '/x'` lacks a leading `/`, `'/api/' + '/x'` has an empty segment, `'/files/*' + '/x'` has a non-final wildcard, and `'/users/:id' + '/:id'` repeats a parameter.
- **`''` addresses the prefix itself.** Inside a group, `get('', h)` matches the prefix exactly, and `get('/', h)` matches it with a trailing slash. At top level `''` is invalid because it does not start with `/`.
- **One trie for everything.** Duplicate detection, priority, and `405` `Allow` lists cover grouped and ungrouped routes together. For example, `get('/admin/:tenant/users')` beside the group above is a duplicate route.
- **`group()` never throws.** It only builds a frozen value. All errors surface when `router()` is called (Hard rule 6).
- **Runtime discrimination:** route helpers and `group()` tag their values internally. A second argument to `group()` that is not such a value is the options object; an explicit `undefined` means no options. The types agree: a `RouteGroup` in that position is checked as an item, not as options, even though it also has `filters`.

### Group filters

- **Composition:** `options.filters` compose like `compose(...filters)`, so the first filter is outermost. During construction, `router()` accumulates filters in an array from outer to inner groups and applies `compose(...filters)` at each route. Filter arrays are never constructed on the request path. An outer group's filters wrap an inner group's.
- **Request order:** filters around the router → router → outer group filters → inner group filters → route-level filters → handler.
- **Group filters see route parameters**, because they run after routing, on the derived context.
- **Filters are applied once per route, not once per group.** The `(next) => …` closure runs once for each route in the group. Keep state that must be shared across the group (rate-limit counters, caches) outside that closure.
- **Unmatched paths skip group filters.** A path under a group's prefix that matches no route gets the router's plain 404 or 405, without running the group's filters. For example, `/admin/x/nope` returns 404, not 401. This is an accepted trade-off of flattening.

### Types

Preserve `TBase`, `BASE`, `NoInfer`, `JoinParams`, and `FILTER_ENV` as specified in the [type inference contract](#type-inference-contract).

- **Inline routes:** prefix parameters accumulate through nested groups, including the options form. `E` flows from `router<E>()`; a filter requiring an incompatible env is a compile error.
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
- **Tests:** the "route groups" block of `test/types/inference.test-d.ts` covers inline groups, separately declared handlers, annotated and unannotated module patterns, and rejection cases.

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
type NodeListenerOptions<E = unknown> =
  { readonly trustProxy?: boolean } // default false
  & (undefined extends E ? { readonly env?: E } : { readonly env: E })
type NodeListenerArgs<E> = undefined extends E ? [options?: NodeListenerOptions<E>] : [options: NodeListenerOptions<E>]

type NodeRequest = IncomingMessage | Http2ServerRequest
type NodeResponse = ServerResponse | Http2ServerResponse
type NodeListener = (req: NodeRequest, res: NodeResponse) => void

function toNodeListener<E>(app: FetchHandler<E>, ...args: NodeListenerArgs<E>): NodeListener
```

The implementation is in `src/node/listener.ts`; `src/node/index.ts` re-exports `toNodeListener` and these types.

```ts
createServer(toNodeListener(toFetch(app), { env })).listen(3000)
```

- **Any `{ fetch }` object.** The listener accepts any object with a `fetch` method, not only the output of `toFetch`. It calls `app.fetch(request, options.env, stub)`.
- **`env` is required when the app needs one**, matching [`FetchArgs`](#entry-point): `toNodeListener(app)` is a type error for a `FetchHandler<Env>`.
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
- **Body:** `null` for `GET` and `HEAD`. Otherwise a Web stream that reads `Readable.toWeb(req)`, with `duplex: 'half'`.
  - **Cancellation discards, never destroys.** Canceling `Readable.toWeb` directly destroys the request mid-message. A response sent after the cancel (such as a `bodyLimit` 413) is then lost, or the keep-alive connection stalls. Canceling the adapter's stream instead reads and drops the remainder, as Node does for unread bodies.
  - **After the response,** an incomplete body is discarded the same way, because the Web stream consumes the request and Node no longer discards it itself. This keeps HTTP/1.1 connections reusable. A handler still reading after its response has finished gets a stream error instead of a silently truncated body.
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

- **Schema validation rules.** Bring an application-owned validator through a filter or the optional `oleo.js/contract` integration; the core provides no schema language or validation engine.
- **Request/response wrappers or response builders.**
- **Implicit URL normalization** (trailing slashes, case folding, duplicate slashes). Normalize in a filter if needed.
- **File-system routing and view engines.**

## Standard filters (Phase 3)

*Status: all four filters, plus `bodyLimit`, are implemented and exported from `oleo.js/filters`, with runtime, property-based, composition, and type tests.*

### Common rules

- **Location:** `src/filters/`, exported as `oleo.js/filters`. The `exports` map includes `./filters` → `dist/filters/index.js`. These are portable packages: ECMA-262 and ECMA-429 only, with the same lint and type isolation as the core.
- **Factories:** every filter is a factory (`cors(options)`, `bearerAuth(options)`, `problemDetails(options?)`, `requestLogger(options?)`, `bodyLimit(options)`) that returns an `HttpFilter`.
- **Fail fast:** a factory validates its options and throws a `TypeError` immediately, never at request time.
- **Tree-shaking:** named exports from one entry, and the package declares `sideEffects: false`. Unused filters drop out of bundles.
- **Never mutate a `Response`** (Hard rule 3). To add headers, build `new Response(res.body, { status, statusText, headers })` with a copied `Headers`. Responses from `fetch()` have immutable headers, so in-place mutation would also throw.
- **Recommended order** around a router:

  ```ts
  withFilters(router(/* … bearerAuth per group or route … */), requestLogger(), cors({ origin }), problemDetails(), bodyLimit({ maxBytes }))
  ```

  - **`requestLogger` outermost** sees the final status.
  - **`cors` outside `problemDetails`** also adds its headers to problem responses.
  - **`problemDetails` inside both** converts errors before they are logged.
  - **`bodyLimit` inside `problemDetails`** has its empty 413 rendered. CORS preflights have no body, so placing it after `cors` costs nothing. To keep streaming uploads, install it on groups instead.

### `cors(options)`

Implemented in [`src/filters/cors.ts`](../src/filters/cors.ts), using the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

```ts
interface CorsOptions {
  origin: '*' | string | readonly string[] | ((origin: string, req: Request) => boolean) // required
  methods?: readonly string[]       // default ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
  allowHeaders?: readonly string[]  // default: reflect Access-Control-Request-Headers
  exposeHeaders?: readonly string[] // default: none
  credentials?: boolean             // default false
  maxAge?: number                   // seconds; default: header omitted
}

function cors<E = unknown>(options: CorsOptions): HttpFilter<E>
```

- **`origin` is required.** There is no default; allowing every origin must be written as `origin: '*'`.
- **Option validation:**
  - Each listed origin must be a serialized origin: `new URL(o).origin === o`, so `https://app.example.com/` with a trailing slash throws.
  - `credentials: true` with `origin: '*'` throws, because browsers reject that combination.
  - `maxAge` must be a non-negative safe integer.
  - Method and header lists must contain HTTP tokens; `credentials` must be a boolean. Arrays are copied into the configured policy, so later caller mutations do not change it.
- **Requests without an `Origin` header** are not CORS requests and pass through untouched.
- **A disallowed origin** passes through with no CORS processing at all; the browser then blocks it.
- **Origin predicates** are synchronous and must explicitly return `true` to allow the origin. Predicate and downstream errors propagate.
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
- **`Access-Control-Allow-Origin` value:** `*` when the configured origin is `'*'`; otherwise the request's own `Origin`, echoed. Allowed requests receive `Vary: Origin`, plus `Access-Control-Request-Headers` on preflights when headers are reflected. New `Vary` values are appended case-insensitively without duplicates, and an existing `Vary: *` is preserved.
- **Response preservation:** normal responses keep their status, status text, and streaming body. Headers are copied; the configured policy replaces Allow-Origin, clears Allow-Credentials when credentials are disabled, and clears Expose-Headers when none are configured. Status-zero responses, including `Response.error()`, pass through because the native constructor cannot recreate them.
- **Must wrap the whole router, never a group.** An `OPTIONS` preflight to a path without an `OPTIONS` route is an unmatched request, so group filters never see it (see [Group filters](#group-filters)).

### `bearerAuth(options)`

Implemented in [`src/filters/bearer-auth.ts`](../src/filters/bearer-auth.ts), following [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html).

```ts
interface BearerAuthOptions<E = unknown, T = unknown> {
  verify: (token: string, req: Request, ctx: Context<E>) => NoInfer<T> | undefined | Promise<NoInfer<T> | undefined>
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
- **Option validation:** `verify` is required and must be a function. A supplied key must expose the `ContextKey` interface. `realm` must be a quoted-string body representable in a native header, so `"`, `\`, control characters, and characters above U+00FF throw.
- **Env typing:** supply env information with `ctx: Context<Env>` in `verify`, or through contextual typing (for example, inside `router<Env>(group(…, { filters: [bearerAuth(…)] }))`). Type tests cover both.
- **Principal typing:** when a key is supplied, its type constrains the verifier's result. `NoInfer<T>` prevents an unknown result from widening the key's type; narrow unknown authentication data before returning it. Verification without a key does not expose a principal downstream.
- **Placement:** per group or route is fine. Unmatched paths under the group then get 404, not 401 (see [Group filters](#group-filters)).

### `problemDetails(options?)`

*Status: implemented in [`src/filters/problem-details.ts`](../src/filters/problem-details.ts), following [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).*

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

function problemDetails<E = unknown>(options?: ProblemDetailsOptions): HttpFilter<E>
```

- **Option validation:** options must be an object; `fromError` and `onError`, when supplied, must be functions, and `emptyResponses` must be a boolean. Invalid types throw `TypeError` when the factory is called.
- **Thrown errors:** `next` is awaited inside `try`/`catch`. A thrown value becomes `fromError?.(error, req)`, or the default `{ status: 500 }` when that returns `undefined`.
  - **Rendered as** `application/problem+json`.
  - **No leaks:** the default problem never includes `error.message` or a stack.
  - **Reporting:** `onError` runs for thrown errors that end up as a 5xx, with the original error and request. An empty 5xx response has no thrown error and does not trigger reporting.
  - **Reporting failures:** exceptions and returned promise rejections from `onError` are reported through `console.error` without changing the chosen response. Reporting promises do not delay the response or extend the request lifetime.
  - **Invalid mappings:** if `fromError` throws, returns a non-integer status or one outside 400–599, or produces an invalid/non-serializable problem, the result is the default 500 and `onError` receives the original error. Known text fields must be strings when supplied; a root `toJSON` method is rejected because it could override the document's status.
- **Empty error responses** (`emptyResponses: true`): a response with status ≥ 400 and a `null` body becomes a problem document with the same status and status text. Headers are copied, preserving `Allow`, `WWW-Authenticate`, CORS headers, and other fields. `Content-Type` is set to `application/problem+json`; stale `Content-Length` and `Content-Encoding` are removed because the representation has changed.
  - This covers the router's default 404/405/400 and `bearerAuth`'s 401/400.
  - A response with any body, even an empty string, is left alone. Handlers that return their own error bodies are never rewritten.
- **Generated `HEAD` responses never get a body.** For a `HEAD` request the status and headers are converted, and the body stays `null`. The router strips bodies from `HEAD` responses, so without this rule every `HEAD` 404 would gain a body.
- **Reason phrases:** ECMA-429 has no table of reason phrases, so `src/filters/` ships its own for registered error statuses through 511, based on the [IANA registry](https://www.iana.org/assignments/http-status-codes/). For an unused or unassigned status, `title` is omitted unless explicitly supplied.
- **Out of scope:** an error raised while a body is already streaming cannot be converted, because the headers are already sent.
- **No error class.** The package exports no throwable `HttpProblem`, since that would be a response builder in disguise (see [Non-goals](#non-goals)). Map your own error types with `fromError`.

### `requestLogger(options?)`

Implemented in [`src/filters/request-logger.ts`](../src/filters/request-logger.ts).

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

function requestLogger<E = unknown>(options?: RequestLoggerOptions): HttpFilter<E>
```

- **Option validation:** options must be an object; supplied `log` and `fields` callbacks must be functions. `fields` returns its record synchronously.
- **One entry per request,** logged when `next` settles. Timing uses `performance.now()`.
  - **What is timed:** only the time until the handler returns its `Response`; body streaming is not included.
  - **On `workerd`,** time advances only across I/O (a Spectre mitigation), so durations of CPU-only handlers read as `0`.
- **Path:** extracted with `pathStart`/`pathEnd`, so it is the raw, still-encoded path, and the query string is never logged.
- **On a throw** it logs `{ error: true }` without `status`, then rethrows. It never swallows errors.
- **Isolation:** an error thrown by `log` or `fields` is reported with `console.error` and never affects the response or original thrown value. If `fields` fails, the core entry is still logged. Returned logging promise rejections are also reported, without delaying the response or extending the request lifetime.
- **Core fields win:** additional fields are copied without mutating the caller's record. They cannot override method, path, status, duration, or error, including the absence of status/error on the corresponding outcome. A functional root `toJSON` is removed so it cannot replace the serialized core entry.

### `bodyLimit(options)`

```ts
interface BodyLimitOptions { readonly maxBytes: number } // a non-negative safe integer
```

- **No body:** the same `Request` passes through, with no allocation.
- **Counting:** the body stream is read chunk by chunk, summing `byteLength`. `Content-Length` is never consulted: it is a forbidden request header, and enforcement must not depend on what a client declares. Every chunk must be a `Uint8Array`; anything else cancels the stream and throws a `TypeError`.
- **Over the limit:** reading stops at the first chunk past `maxBytes`. The source is canceled, with the cancellation awaited so failures propagate, and the filter returns an empty `413` without invoking the handler. `problemDetails` renders it as "Content Too Large".
- **Within the limit:** the chunks are copied into one `Uint8Array` and passed on as `new Request(req, { body })`, which keeps the method, URL, headers, and signal. A byte body needs no `duplex`. Streaming request bodies vary by runtime, so the portable packages do not create them ([Portable code must not](#portable-code-must-not)).
- **Trade-off:** wrapped handlers receive a buffered body of at most `maxBytes`. Keep streaming-upload routes outside the filter, for example by installing it on JSON route groups.
- **Errors:** stream read and cancellation failures propagate.

### Contract

Runtime and property-based tests live in `test/portable/filters/` and run on Node, Bun, workerd, and Deno. Composition tests verify preflight bypass, authenticated routes, empty error conversion, CORS on errors, bodyless HEAD responses, and final-status logging. Body-limit tests replace a byte-bodied request's `body` with a pull stream to observe chunking and cancellation without runtime-specific streaming requests; `test/node/listener.test.ts` checks that the 413 reaches a real HTTP/1.1 client and that the connection is reused. `test/types/filters.test-d.ts` covers factory options, environment/parameter preservation, and Bearer principal compatibility, including rejection of unknown or incompatible verifier results.

## Transformation filters

These helpers are exported from `oleo.js/filters`. They follow the same portable API and native-message preservation rules as standard filters.

### `mapRequest(transform)` and `mapResponse(transform)`

```ts
type RequestTransform<E = unknown> = (req: Request, ctx: Context<E>) => Request | Promise<Request>
type ResponseTransform<E = unknown> =
  (response: Response, req: Request, ctx: Context<E>) => Response | Promise<Response>

function mapRequest<E = unknown>(transform: RequestTransform<E>): HttpFilter<E>
function mapResponse<E = unknown>(transform: ResponseTransform<E>): HttpFilter<E>
```

- A transform must be a function; invalid options throw `TypeError` when the factory is called.
- `mapRequest` awaits the callback and passes its returned Request to the next handler with the same context. A callback failure skips the next handler.
- `mapResponse` awaits the next handler before invoking the callback. A downstream failure skips the callback. Its returned Response becomes the filter's result.
- Both synchronous throws and promise rejections propagate to outer filters. These helpers do not render errors or isolate callbacks as logging filters do.
- Callbacks receive the request and context visible at their filter's position. A response transform outside the router does not see route parameters or context keys added downstream. A group transform runs after routing and sees the matched parameters.
- Context is preserved, including symbol-keyed values. Callback parameter types use `Context<E>`; route-specific parameter inference on the wrapped handler remains intact.
- Helpers do not inspect or buffer bodies. Any reading or replacement belongs to the callback, which must respect native stream ownership and return new messages when making changes.

### `responseHeaders(headers)`

```ts
function responseHeaders<E = unknown>(headers: HeadersInit): HttpFilter<E>
```

- Accepts a native Headers instance, a record, or header pairs. Configuration is validated and copied through `new Headers(headers)` when the factory is called; missing or invalid inputs throw `TypeError`.
- Configured names replace existing values case-insensitively. Other headers are preserved. Repeated Set-Cookie values remain separate, including when replacing an existing set of cookies.
- Each response receives a separate Headers copy and a new Response retaining status, status text, and body. The original headers and configured input are not modified; later caller mutations do not affect the filter.
- Bodies remain streaming and are not read or buffered. Null bodies remain null, including HEAD, 204, and 304 responses.
- Status-zero responses pass through unchanged because native Response constructors cannot recreate network-error or opaque responses.
- This helper changes headers only; it does not recompute representation metadata. Callers choose header values appropriate to their body.

Example, with the first filter outermost:

```ts
const app = withFilters(routes,
  mapRequest(addRequestHeaders),
  responseHeaders({ 'Cache-Control': 'no-store' }),
  mapResponse(transformResponse),
)
```

Tests are in `test/portable/filters/transforms.test.ts`, `test/portable/filters/response-headers.test.ts`, and `test/types/transform-filters.test-d.ts`. They cover asynchronous callbacks, failure propagation, context visibility, immutable header handling, multiple cookies, streaming bodies, and generated header/body preservation.

## Contracts

`oleo.js/contract` exports `contract`, `toOpenApi`, their configuration/input/document types, and structural Standard Schema types. It adds no runtime dependency and does not change core handlers or filters. The [complete example](examples/contract.ts) implements a list endpoint, a create endpoint, and an authenticated read endpoint; [its schemas](examples/project-schemas.ts) are application-owned examples of the protocol, not a new oleo schema language.

### Definitions and inference

`contract(definition, handler)` returns a normal `Route<E, TBase>`. Its handler receives `(request, ctx, input)` and returns a native Response or a promise. `ContractInput<RequestDefinition>` infers schema outputs, including transformations and defaults. Env flows from `router<Env>()`, a `Route<Env>` / `RouteGroup<Env>` annotation, or `contractFor<Env, TBase>()`, which returns `contract` typed with `E` fixed and the enclosing parameters defaulting to `TBase` (see [Environment-bound helpers](#environment-bound-helpers)). Full raw path parameters accumulate through groups as before.

| Field | Contract |
| --- | --- |
| `method`, `path` | Same method and relative pattern rules as core routes; full paths are checked after groups are expanded. |
| `operationId` | Required nonempty string, unique within each generated document. |
| `summary` | Optional string for the operation's documentation. |
| `request.params`, `.query`, `.headers` | Maps of names to `{ schema, required?, description? }`; all values originate as decoded strings. |
| `request.json` | Standard Schema validator for a required JSON body. |
| `responses` | Nonempty map of exact status codes 100–599 or `default` to `{ description, content? }`. Each content media type maps to `{ schema }`. These describe documentation only. |
| `security` | OpenAPI security requirement array. It does not enforce authentication. |

The handler's `input` includes only declared sources and fields. `ctx.params` is unchanged: a raw ID can be a string while `input.params.id` is a number. Schema outputs preserve null, undefined, transformations, and defaults; `required: false` does not add undefined to a schema's output type. Optional declaration sources and fields remain optional in the inferred input.

Use `const request = { ... } satisfies ContractRequest` to check a reusable declaration while retaining its concrete schema types. An annotation such as `const request: ContractRequest = ...` widens its schemas: JSON and scalar field outputs become unknown, and sources may be absent. Narrow these values before using them; checking only for undefined does not exclude null.

Configuration containers are copied when the Contract is defined, including nested response and security declarations. Schema instances are opaque and remain application-owned; do not change their validation/export behavior after registration. Schema interface and handler/configuration shape errors throw at definition time. Method, full path, and declared path parameter names are checked during router or document construction, including for JavaScript callers and nonliteral paths.

### Input processing

- Parameters default to `required: true`; path parameters cannot be optional. Optional query/header fields pass `undefined` to the schema when absent. The resulting field remains an own property even when its validated value is undefined.
- Query decoding follows URLSearchParams semantics, including `+` as a space. Repeated occurrences of a declared scalar parameter fail with 422. Undeclared query/header fields are ignored; array query serialization is not supported.
- Header lookup is case-insensitive, while output property names retain the declaration's spelling. Case-insensitive duplicate header declarations are rejected. Native Headers semantics apply to combined values.
- Path values come from the router's decoded parameters; declared names must occur in the full path. Undeclared path parameters remain accessible through `ctx.params`.
- JSON parsing precedes schema validation. A null body returns 400. With a body present, an absent or unsupported media type returns 415; `application/json` is case-insensitive and accepts media type parameters. Empty or malformed JSON returns 400. JSON `null` is parsed successfully and passed to the schema.
- The body is read once. `input.json` holds the validated result; handlers must not read the consumed Request body again. Routes without a JSON declaration leave bodies untouched.
- The contract reads the whole body without a size limit of its own. Install [`bodyLimit`](#bodylimitoptions) around contract routes to bound it; an oversized body then returns 413 before parsing.
- Schemas validate sequentially in params, query, headers, json order; fields follow declaration order. Synchronous and asynchronous results are accepted. Every reported issue is collected, but a validator may itself choose to report only one issue.
- Missing required parameters, duplicate scalar queries, and schema failures produce 422. The handler is skipped on all expected input failures. Read failures, validator throws/rejections, malformed schema results, and malformed issues propagate to outer filters instead of becoming client errors.

Validation errors are RFC 9457 problem documents with `Content-Type: application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "errors": [
    { "source": "query", "path": ["limit"], "message": "Limit must be between 1 and 100" },
    { "source": "json", "path": ["name"], "message": "Name is required" }
  ]
}
```

`source` is `params`, `query`, `headers`, or `json`. Paths prepend the declared parameter name to the validator's path; JSON issues use the schema path directly. Standard Schema path-segment objects are unwrapped and symbol keys are converted to strings. Messages come from the application-owned validator and must be suitable for clients; oleo does not add raw inputs, stacks, or vendor metadata. A valid failure result has at least one issue; a valid success result has a `value`, which may be undefined, null, false, zero, or an empty string.

Contract-generated 400/415/422 responses do not require `problemDetails()`. Wrap the whole router with that filter to format routing/authentication errors and unexpected exceptions as well. HEAD responses remain bodyless. Request matching/decoding happens first, then group filters, then Contract input validation and the handler; malformed path encoding remains the router's 400 behavior.

### OpenAPI generation

`toOpenApi(options, ...routes)` synchronously generates OpenAPI **3.1.1** from Route/RouteGroup definitions. It validates the entire route tree, including ordinary routes, but only documents Contract routes. No filter is applied and no handler, validation callback, network request, or remote reference resolver runs during generation. Application schema exporters do run.

Options include required `info: { title, version, description? }`, optional `securitySchemes`, and optional `toJsonSchema(schema, direction)`. The provided callback takes precedence over native export. Otherwise the schema must provide `~standard.jsonSchema.input/output`; oleo requests `target: 'draft-2020-12'`. Input declarations use the `input` direction; responses use `output`. Exporters must accurately describe wire inputs, rather than only the transformed TypeScript output. Unsupported conversion throws instead of silently emitting an unconstrained schema.

- Group prefixes, segment encoding and trailing slashes follow routing. Named parameters become `{name}`; undeclared path schemas default to required strings. Methods share a path item, and only explicitly declared methods are emitted.
- A JSON declaration adds default 400, 415 and 422 responses; declared scalar validations add 422; any named path adds 400 for decoding failures. Defaults describe Problem Details, including the 422 issue list. Use `problemDetails()` around the router for that representation of routing errors. Explicit same-status responses replace defaults entirely; `default` does not suppress exact generated statuses.
- Authentication and business errors are explicit response declarations. Security schemes support HTTP authentication, API keys, OAuth2, OpenID Connect, and mutual TLS metadata. References must name declared schemes, and requirement values must be string arrays. OAuth2 and OpenID Connect arrays list scopes; other scheme types may list required role names, as defined by [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html#security-requirement-object). Empty arrays are valid for all supported scheme types. Metadata does not enforce roles or establish the runtime presence of a ContextKey or an authentication filter.
- Wildcard Contract paths and methods outside OpenAPI's exact uppercase method set cannot be represented and throw. Ordinary wildcard/custom-method routes can still be mixed in and are omitted. `Authorization`, `Accept`, and `Content-Type` header parameter declarations cannot be exported because OpenAPI ignores them; express those requirements using security/content metadata instead.
- Schemas are inlined without automatic component deduplication. Local JSON pointers and anchors in anonymous schema resources are relocated to their embedded positions; both `$ref: ""` and `$ref: "#"` reference that resource's embedded root. Data keywords such as examples and const are copied without rewriting their contents. Explicit `$id` resource scopes and external references are preserved; external references are never fetched. Dynamic references in anonymous resources require an explicit `$id` and otherwise throw.
- Exported schema data must be JSON-serializable objects or booleans. Cyclic JavaScript objects, serialization hooks, and malformed known subschema containers are rejected. This is not a general JSON Schema validator; keyword semantics remain the exporter's responsibility.
- Duplicate operation IDs, conflicting routes, invalid full-path parameter declarations, unknown security references, and unsupported schema conversion fail during generation. The resulting document shares no mutable JSON containers with declarations or earlier documents.

Responses remain native and are never read or validated against `responses`. Form/multipart parsing, array query parameters, client generation, document serving and UI hosting are outside this module. Applications can serve the generated object through a normal route if desired.

Runtime and generated tests are in `test/portable/contract/`; inference tests are in `test/types/contract.test-d.ts`. They cover the three example endpoints, error aggregation and precedence, schema/stream failures, HEAD, configuration snapshots, schema reference scopes, prototype-sensitive names, full-path documentation, and composed environments. The executable examples are also checked against a packed package before delivery.
