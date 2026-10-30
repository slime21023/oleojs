# Extension API

Extensions, including oleo.js's own `oleo.js/contract`, see routes only through two public functions. Anything the first-party modules do with routes, a third-party package can do too; the repository enforces this for its own modules (see [CONTRIBUTING.md](https://github.com/slime21023/oleo.js/blob/main/CONTRIBUTING.md#hard-rules), rule 9).

```ts
interface RouteEntry<E = unknown> {
  readonly route: Route<E, any>              // the value passed in
  readonly method: string
  readonly pattern: string                   // full pattern with group prefixes
  readonly segments: readonly string[]       // canonical: encoded static text, ':name', '*'
  readonly filters: readonly HttpFilter<E>[] // group filters, outermost first
}
function inspectRoutes<E>(...items: RouteItem<E, {}>[]): readonly RouteEntry<E>[]
function withRouteCheck<E, TBase extends Params>(route: Route<E, TBase>, check: (entry: RouteEntry<E>) => void): Route<E, TBase>
```

- **`inspectRoutes`** is the single definition-time pass. `router()` itself registers exactly what it returns. It applies method, pattern, conflict, and route checks, and throws the same errors in the same order. Handlers and filters are never invoked, and the result is frozen and in definition order. Use it for documentation, client generation, route listings, or lint-style checks.
- **`withRouteCheck`** returns a new frozen route. Its checks run in both `router()` and `inspectRoutes`, after the route's earlier checks, and receive the full grouped entry. Throwing rejects the definition, so errors stay at definition time and never reach request handling. The original route is unchanged.
- **Metadata:** keep it in your own `WeakMap`, keyed by the route value you return, and read it back from `entry.route`. `oleo.js/contract` works this way: `contract()` stores its definition by route, checks declared path parameters with `withRouteCheck`, and `toOpenApi` reads both through `inspectRoutes`.
- **Types for wrappers:** `RouteItem` and `JoinParams` are public so that wrappers like `contractFor` can carry group parameters.
- **Allowed shared modules:** the stateless helpers `src/http-problem.ts` and `src/path.ts`, plus type-only imports from `src/types.ts`. Third parties can reimplement these trivially; routing knowledge is what must stay public.

