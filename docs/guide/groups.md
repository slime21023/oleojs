# Route groups

- Invalid patterns, conflicting route definitions, and invalid methods are rejected when `router()` is called.
- Parameter names belong to each route. Diverging routes such as `/users/:id` and `/users/:userId/posts` may name the same position differently. Routes for the same path, such as `GET /users/:id` and `POST /users/:userId`, must use the same names.

Groups combine prefixes with their nested routes. A route with an empty pattern, such as `get('', handler)`, addresses the group prefix itself. Group middleware is supplied through `group(prefix, { filters: [...] }, ...routes)` and runs only for matched routes, with their parameters available. Unmatched requests skip group middleware. Placing a route or group in a group whose prefixes do not supply the parameters it needs is a type error that names the missing parameter.

A group joins a prefix onto its routes when `router()` is called and flattens them into the same trie as every other route. At run time a grouped route is indistinguishable from writing its full pattern directly. There is no run-time mounting and no hidden path state in `Context`.

## API

`group(prefix, ...items)` and `group(prefix, options, ...items)` return a `RouteGroup`. Items are routes or nested groups. `GroupOptions<E>` has one optional field, `filters: readonly HttpFilter<E>[]`. Both call shapes share one signature, `group(prefix, ...rest: GroupArgs<E, TPrefix, TBase>)`, so an item whose required parameters the prefixes do not supply is reported as that missing parameter. The exact signature and inference constraints live in [`src/routing/route.ts`](https://github.com/slime21023/oleojs/blob/main/src/routing/route.ts).

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

## Flattening

- **Patterns are concatenated, nothing more.** A route's full pattern is `prefix + pattern`, outermost group first.
- **Validity is judged on the full pattern.** Every [route definition error](/reference/routing#route-definition-errors) applies after concatenation. For example, top-level `'api' + '/x'` lacks a leading `/`, `'/api/' + '/x'` has an empty segment, `'/files/*' + '/x'` has a non-final wildcard, and `'/users/:id' + '/:id'` repeats a parameter.
- **`''` addresses the prefix itself.** Inside a group, `get('', h)` matches the prefix exactly, and `get('/', h)` matches it with a trailing slash. At top level `''` is invalid because it does not start with `/`.
- **One trie for everything.** Duplicate detection, priority, and `405` `Allow` lists cover grouped and ungrouped routes together. For example, `get('/admin/:tenant/users')` beside the group above is a duplicate route.
- **`group()` never throws.** It only builds a frozen value. All errors surface when `router()` is called.
- **Runtime discrimination:** route helpers and `group()` tag their values internally. A second argument to `group()` that is not such a value is the options object; an explicit `undefined` means no options. The types agree: a `RouteGroup` in that position is checked as an item, not as options, even though it also has `filters`.

## Group filters

- **Composition:** `options.filters` compose like `compose(...filters)`, so the first filter is outermost. During construction, `router()` accumulates filters in an array from outer to inner groups and applies `compose(...filters)` at each route. Filter arrays are never constructed on the request path. An outer group's filters wrap an inner group's.
- **Request order:** filters around the router → router → outer group filters → inner group filters → route-level filters → handler.
- **Group filters see route parameters**, because they run after routing, on the derived context.
- **Filters are applied once per route, not once per group.** The `(next) => …` closure runs once for each route in the group. Keep state that must be shared across the group (rate-limit counters, caches) outside that closure.
- **Unmatched paths skip group filters.** A path under a group's prefix that matches no route gets the router's plain 404 or 405, without running the group's filters. For example, `/admin/x/nope` returns 404, not 401. This is an accepted trade-off of flattening.

## Types

Route and group types carry the parameters their enclosing prefixes must supply, so a misplaced route is a compile error that names the missing parameter. Contributors: the mechanisms behind this are listed in the [type inference contract](https://github.com/slime21023/oleojs/blob/main/CONTRIBUTING.md#type-inference-contract).

- **Inline routes:** prefix parameters accumulate through nested groups, including the options form. `E` flows from `router<E>()`; a filter requiring an incompatible env is a compile error.
- **Routes defined in another module:** use [`routesFor<Env>()`](#routes-declared-in-other-modules), or export a function or constant whose type is annotated as `RouteGroup` or `RouteGroup<Env>`. The annotation supplies the context that inference needs:

  ```ts
  // users.ts
  export const userRoutes = (): RouteGroup<Env> =>
    group('/users/:userId', get('/posts/:postId', (req, ctx) => Response.json(ctx.params)))
  // app.ts
  router<Env>(userRoutes())
  ```

  - **Without the annotation,** prefix parameters are missing from `ctx.params`, so using one is a compile error. It is never an untyped value.
  - **Env mismatch:** an annotated `RouteGroup<Env>` put into a `router` of a different env is a compile error.

## Routes declared in other modules

Inside `router<Env>(...)`, route handlers infer `ctx.env` and the parameters of every enclosing group. Routes declared on their own have no such context. `routesFor<Env>()` binds the helpers to an environment instead, so those handlers need no annotations:

```ts
import { routesFor } from 'oleojs'
import type { ParamsOf } from 'oleojs'
import type { Env } from './env.ts'

const { get, group } = routesFor<Env>()

// A group declared on its own types its inline routes with the prefix parameters.
export const users = group('/users/:userId',
  get('/profile', (_request, ctx) => Response.json(ctx.env.profiles.find(ctx.params.userId))),
)

// A route for a parameterized group elsewhere names the parameters that group will supply.
const { get: getForUser } = routesFor<Env, ParamsOf<'/users/:userId'>>()
export const settings = getForUser('/settings', (_request, ctx) => new Response(ctx.params.userId))
```

`routesFor` returns the existing helpers and binds only their types. Its `group` fixes the enclosing parameters to the second type argument. For a group nested inline inside a parameterized group, use the core `group`, which infers them. `contractFor<Env>()` from `oleojs/contract` does the same for contracts.

## Environment-bound helpers

A route declared on its own, such as in another module, has no surrounding `router<E>()` to infer `E` from. `routesFor<E, TBase = {}>()` returns `RouteHelpers<E, TBase>`: `route`, the method helpers, and `group`, with `E` fixed.

- **Method helpers** default their enclosing parameters to `TBase` and still infer them inline, so `routesFor<Env, ParamsOf<'/users/:userId'>>().get('/settings', …)` sees `userId` and fits only under groups that supply it.
- **`group`** fixes its enclosing parameters to `TBase`. A group declared on its own therefore types its inline routes with its prefix parameters, which an unannotated core `group()` cannot. For a group nested inline inside a parameterized group, use the core `group()`, which infers the enclosing parameters.
- **No runtime cost.** The result is one frozen object holding the module's own helper functions, shared by every call. `contractFor<E, TBase>()` in `oleojs/contract` binds `contract` the same way.

