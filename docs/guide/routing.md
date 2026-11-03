# Routing

## Routes

Create a route with a method helper, a path pattern, and a handler. Pass the routes to `router()`:

<<< @/examples/routing.ts#routes

- Method helpers: `get`, `post`, `put`, `patch`, `del` (for `DELETE`), `head`, and `options`. Use `route(method, pattern, handler)` for any other method.
- `:name` matches one path segment and is available as `ctx.params.name`, already percent-decoded.
- A final `*` matches the rest of the path, available as `ctx.params['*']`.
- Static segments win over parameters, and parameters win over `*`. The order you list routes in does not matter.
- Matching is case-sensitive, and a trailing slash matters: `/users` and `/users/` are different routes.

## What the router answers by itself

| Situation | Response |
| --- | --- |
| No route matches the path | `404 Not Found` |
| The path matches, but not the method | `405 Method Not Allowed`, with an `Allow` header |
| A parameter has malformed percent-encoding | `400 Bad Request` |
| `HEAD` request without a `HEAD` route | The `GET` route answers, without a body |

These responses have empty bodies. Wrap the router with [`problemDetails()`](/filters/problem-details) to turn them into JSON error documents.

Mistakes in route definitions, such as an invalid pattern or the same route twice, throw when `router()` is called, not when a request arrives. The [routing rules](/reference/routing) list them all.

## Groups

`group(prefix, ...routes)` puts routes under a shared path prefix. Groups can be nested, and parameters from every prefix are typed in the handler:

<<< @/examples/routing.ts#groups

Inside a group, `''` addresses the prefix itself. A group can also run filters for its routes only; see [Middleware](/guide/middleware#group-filters).

## Routes in other modules

Routes written inline in `router()` get their types from the router. Routes declared in their own module can get them from `routesFor<Env>()`, which returns the same helpers bound to your environment type:

<<< @/examples/routing-modules.ts#modules
