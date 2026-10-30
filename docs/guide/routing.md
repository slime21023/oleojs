# Routing

Patterns support static segments, named parameters such as `/users/:id`, and a terminal wildcard such as `/files/*`. Parameters are decoded after matching; a wildcard value is available as `ctx.params['*']`.

- Static segments take priority over parameters, which take priority over wildcards. Matching also considers the request method.
- Case and trailing slashes are significant. `/users` and `/users/` are distinct routes.
- An unmatched path returns `404`. A matching path with an unsupported method returns `405` with an `Allow` header.
- `HEAD` can fall back to `GET`, and its response has no body. `OPTIONS` routes are explicit.
- Invalid patterns, conflicting route definitions, and invalid methods are rejected when `router()` is called.
- Parameter names belong to each route. Diverging routes such as `/users/:id` and `/users/:userId/posts` may name the same position differently. Routes for the same path, such as `GET /users/:id` and `POST /users/:userId`, must use the same names.

Groups combine prefixes with their nested routes. A route with an empty pattern, such as `get('', handler)`, addresses the group prefix itself. Group middleware is supplied through `group(prefix, { filters: [...] }, ...routes)` and runs only for matched routes, with their parameters available. Unmatched requests skip group middleware. Placing a route or group in a group whose prefixes do not supply the parameters it needs is a type error that names the missing parameter.

## Pattern syntax and matching

The exact rules, including every definition error, are in the [routing reference](/reference/routing).
