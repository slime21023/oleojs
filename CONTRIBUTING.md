# Contributing to oleo.js

This guide records how oleo.js is built and verified. [AGENTS.md](AGENTS.md) states the project goals and architectural principles; the [documentation site](https://slime21023.github.io/oleo.js/) describes the public API and its behavior.

## Scope and status

| Export | Tier | Contents | Status |
| --- | --- | --- | --- |
| `oleo.js` | Portable | Router, route helpers, groups, environment-bound helpers (`routesFor`), core types, `compose`, `withFilters`, context keys, `toFetch` | Phases 1–2 implemented |
| `oleo.js/node` | Adapter | `node:http` / `node:http2` bridge | Implemented |
| `oleo.js/filters` | Portable | CORS, Bearer authentication, RFC 9457 errors, request logging, body size limits, and message transformations | Phase 3 implemented, with `bodyLimit` and transformation helpers |
| `oleo.js/contract` | Portable | Declarative contracts, environment-bound contracts (`contractFor`), Standard Schema input validation, OpenAPI 3.1.1 generation | Phase 4 implemented |

Phases 1–4 are implemented, including the four original [standard filters](https://slime21023.github.io/oleo.js/filters/), [`bodyLimit`](https://slime21023.github.io/oleo.js/filters/body-limit), and the optional [Contract module](https://slime21023.github.io/oleo.js/contracts/).

Read the [hard rules](#hard-rules) and [development workflow](#development-environment) before changing code. Use the [repository layout](#repository-layout) to locate implementations and tests.

The public behavior contracts live on the documentation site, whose source is `docs/`: [Core API](https://slime21023.github.io/oleo.js/reference/api) · [Routing](https://slime21023.github.io/oleo.js/reference/routing) · [Route groups](https://slime21023.github.io/oleo.js/guide/groups) · [HTTP semantics](https://slime21023.github.io/oleo.js/reference/http-semantics) · [Node adapter](https://slime21023.github.io/oleo.js/runtimes/node) · [Standard filters](https://slime21023.github.io/oleo.js/filters/). A change to public behavior updates the matching page in the same commit.

## Hard rules

1. **Zero runtime dependencies.** Dev dependencies are allowed.
2. **Portable packages use only ECMA-262 and ECMA-429 APIs.** See [Standards conformance](#standards-conformance).
3. **Never wrap, proxy, subclass, or mutate `Request` or `Response`.** Build responses with `new Response()` or `Response.json()`.
4. **`Context` holds data only.** Never add helper methods (`ctx.json()`, `ctx.text()`, …) to it.
5. **Routing hot path:** no `new URL()`, `split()`, regex, or substring allocation for static comparison. See [Performance budget](#performance-budget).
6. **Route definition errors throw when `router()` is called**, never at request time.
7. **Do not present oleo.js conventions as standards.** The `{ fetch }` entry shape and `ExecutionContext` are not WinterTC APIs.
8. **Keep the public surface small.** An entry point exports a value or type only if applications or extension authors write it themselves; see [Package manifest](#package-manifest).
9. **Extensions use only the public routing API.** `src/filters/` and `src/contract/` never import `src/routing/*` or `src/http-method.ts`; see [Extension API](https://slime21023.github.io/oleo.js/extending/).

## Development environment

### Commands and completion checks

| Command | Purpose |
| --- | --- |
| `bun install` | Install dev dependencies |
| `bun run lint` | Run oxlint |
| `bun run typecheck` | Check portable/test, Node/tooling, and documentation-example tsconfigs without emitting |
| `bun run test` | Run Node runtime tests and the type inference contract |
| `bun run test:types` | Run type tests only |
| `bun run test:node` | Run portable and Node adapter tests on Node |
| `bun run test:bun`, `test:workerd`, `test:deno` | Run portable tests on the named runtime |
| `bun run test:all` | Run the full runtime matrix; type tests run separately via `test` or `test:types` |
| `bun run build` | Emit JavaScript and declarations to `dist/` |
| `bun run docs:dev`, `docs:build`, `docs:preview` | Serve, build, or preview the VitePress documentation site in `docs/` |

- Before considering a change done, run `lint`, `typecheck`, and `test`.
- Run `test:all` for portable behavior changes and before release. A failure on any runtime blocks release. The only workflow in `.github/workflows/` deploys the documentation site to GitHub Pages; the test matrix is an explicit local verification step.
- For documentation changes, run `docs:build`. It fails on dead links. Embedded examples in `docs/examples/` are type-checked by `typecheck`.
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
    route.ts                # immutable Route/RouteGroup values, helpers, group, routesFor, withRouteCheck, internal kind checks
    inspect.ts              # inspectRoutes: the definition checks shared by router() and extensions
    router.ts               # filter composition, dispatch, default responses
    walk.ts                 # group expansion behind inspectRoutes
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
    contract.ts             # Route creation, metadata, full-path checks, and contractFor (public core API only)
    definition.ts           # declaration validation and snapshots
    validate.ts             # input extraction, schema validation, and problem responses
    openapi.ts              # document generation, security metadata, default errors
    json-schema.ts          # JSON copying and reference relocation
test/
  portable/
    <module>.test.ts        # portable runtime tests, including generated properties
    arbitraries.ts          # shared input generators and deterministic run settings
    runtime-baseline.test.ts # checks the runtime assumptions the core relies on
    api-surface.test.ts     # exact value exports of each portable entry point
    contract/              # input, document, endpoint integration, and property tests
    routing/
      router.test.ts        # route helpers, dispatch, HTTP semantics
      router.property.test.ts # routing and grouped-filter properties through the public API
      group.test.ts         # route group flattening, filters, definition errors
      inspect.test.ts       # inspectRoutes entries and errors, withRouteCheck composition
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
docs/                       # VitePress documentation site (the public behavior contracts)
  .vitepress/config.ts      # navigation, sidebar, search, GitHub Pages base path
  guide/ filters/ contracts/ runtimes/ extending/ reference/
  examples/                 # type-checked example code embedded into pages with <<<
.github/workflows/docs.yml  # builds and deploys the site to GitHub Pages
vitest.config.ts            # projects: portable, node, types
vitest.workers.config.ts    # portable tests inside workerd
.oxlintrc.json
tsconfig.json / tsconfig.node.json / tsconfig.build.json / tsconfig.docs.json
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
- `exports` maps `.` → `dist/index.js`, `./filters` → `dist/filters/index.js`, `./contract` → `dist/contract/index.js`, and `./node` → `dist/node/index.js`, each with a `types` condition.
- **Public surface policy.** Export a value or type from an entry point only if applications or extension authors write it themselves. A type that only appears inside another signature stays in its module and is still visible in declarations and editor hovers. For example, `FetchArgs`, `GroupArgs`, `BoundMethodHelper`, and `NodeListenerArgs` stay in their modules, while `RouteHelpers` and `BoundContract` are exported because users annotate them.
  - **Guard:** `test/portable/api-surface.test.ts`, and the `oleo.js/node` case in `test/node/listener.test.ts`, assert each entry's exact value exports. Changing those lists is a deliberate API decision; review type exports alongside it.
- `engines.node` covers the currently maintained Node.js LTS lines.
- **Declaration files keep `.ts` specifiers.** `rewriteRelativeImportExtensions` rewrites them in emitted `.js` only, so the emitted `.d.ts` files still import `./routing/router.ts` and similar.
  - **Verified:** a consumer project on TypeScript 7 with `NodeNext` resolves them to the `.d.ts` files and keeps full inference. The built JavaScript also runs on Node, Bun, and Deno.
  - **Untested:** consumers on older TypeScript versions. Check before publishing.

### Type inference contract

[`test/types/inference.test-d.ts`](test/types/inference.test-d.ts) is the contract for route parameters, env compatibility, filters, groups, and their rejection cases. It tests the real implementations. **Never weaken, delete, or add `@ts-expect-error` to an existing case just to make it pass; ask instead.**

[`test/types/filters.test-d.ts`](test/types/filters.test-d.ts) covers each factory's options, contextual environments, route-parameter preservation, and principal types. The env-agnostic factories use `<E = unknown>` to carry the surrounding environment type into group options; returning a fixed `HttpFilter<unknown>` would widen the group's environment to `unknown`. Bearer verification accepts an annotated context or infers its environment from the surrounding router/group.

[`test/types/composition.test-d.ts`](test/types/composition.test-d.ts) covers automatic intersection of independent environment requirements, neutral filters, arrays, nested stacks, explicit generics, route parameters, and invalid supplied environments. [`test/types/transform-filters.test-d.ts`](test/types/transform-filters.test-d.ts) covers transformation callbacks and their inference through `withFilters` and route groups.

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

Phantom members are type-level only and are never set at runtime. The optional filter phantom keeps ordinary arrow functions assignable as filters. See [route groups](https://slime21023.github.io/oleo.js/guide/groups) for usage patterns.

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

## Routing implementation

- **`src/path.ts`:** `pathStart(url)` and `pathEnd(url, start)` return the path bounds as indices, allocation-free.
- **`src/http-method.ts`:** `checkMethod` validates methods when `router()` is called; the Node adapter shares its forbidden-method list.
- **`src/routing/trie.ts`:** `Trie<T>` has three methods. A router owns one trie and only ever calls it synchronously.
  - **`insert(method, pattern, value)`:** registers a route and validates its full pattern, conflicts, and duplicates. Method validation belongs to `checkMethod`. Parameter nodes are positional and unnamed; each terminal node records its path's parameter names in order, shared by every method there.
  - **`match(method, url, start, end)`:** returns the selected value, `MALFORMED` (respond 400), or `undefined`. On success, the parameters are in `trie.params`. Read them before the next `match`. This keeps a successful match within the allocation budget. Captures happen while unwinding from the selected terminal, so they take that terminal's names from the last one back, without allocating.
  - **`allow(url, start, end)`:** the sorted `Allow` list for a 405. It is empty when no route matches the path, which means 404. It runs only on the miss path, so it may allocate.

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

## Filter tests

Runtime and property-based tests live in `test/portable/filters/` and run on Node, Bun, workerd, and Deno. Composition tests verify preflight bypass, authenticated routes, empty error conversion, CORS on errors, bodyless HEAD responses, and final-status logging. Body-limit tests replace a byte-bodied request's `body` with a pull stream to observe chunking and cancellation without runtime-specific streaming requests; `test/node/listener.test.ts` checks that the 413 reaches a real HTTP/1.1 client and that the connection is reused. `test/types/filters.test-d.ts` covers factory options, environment/parameter preservation, and Bearer principal compatibility, including rejection of unknown or incompatible verifier results.

Transformation filter tests are in `test/portable/filters/transforms.test.ts`, `test/portable/filters/response-headers.test.ts`, and `test/types/transform-filters.test-d.ts`. They cover asynchronous callbacks, failure propagation, context visibility, immutable header handling, multiple cookies, streaming bodies, and generated header/body preservation.

Group type tests: the "route groups" block of `test/types/inference.test-d.ts` covers inline groups, separately declared handlers, annotated and unannotated module patterns, and rejection cases.
