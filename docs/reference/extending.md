# Extension API

Tools such as documentation generators can read routes through two public functions. `oleojs/contract` is built on them.

```ts
import { get, group, inspectRoutes } from 'oleojs'

const entries = inspectRoutes(
  group('/api', get('/users/:id', () => new Response())),
)
// [{ route, method: 'GET', pattern: '/api/users/:id', segments, filters }]
```

| Function | Description |
| --- | --- |
| `inspectRoutes(...routes)` | Lists the routes `router()` would register, with full patterns and group filters. Runs the same checks and throws the same errors. Never runs handlers |
| `withRouteCheck(route, check)` | Returns a copy of a route whose `check(entry)` runs when a router or `inspectRoutes` is built. Throw from `check` to reject the definition |

To attach your own metadata to a route, store it in a `WeakMap` keyed by the route value, and read it back from `entry.route`.
