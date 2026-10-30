# Filters

The standard filters are available from `oleo.js/filters`. They compose with custom filters and preserve handler environment and route-parameter types.

```ts
import { contextKey, get, group, router, toFetch, withFilters } from 'oleo.js'
import { bearerAuth, cors, problemDetails, requestLogger } from 'oleo.js/filters'

interface User { id: string }
interface Env { verifyToken(token: string): Promise<User | undefined> }

const userKey = contextKey<User>('user')
const routes = router<Env>(
  group('/api', {
    filters: [bearerAuth({
      verify: (token, _request, ctx) => ctx.env.verifyToken(token),
      key: userKey,
      realm: 'api',
    })],
  }, get('/me', (_request, ctx) => Response.json(userKey.get(ctx)))),
)

const app = toFetch(withFilters(routes,
  requestLogger(),
  cors({ origin: 'https://app.example.com' }),
  problemDetails(),
))

export default app
```

Supply the application's `verifyToken` through `env`, as described under runtime integration below. The outer logger records the final status, CORS handles preflights before authentication, and problem details converts authentication and routing errors. CORS belongs around the whole router; group authentication runs only for matched routes.

- **CORS:** explicitly choose `'*'`, one serialized origin, an origin list, or a synchronous predicate. Configure methods, allowed/exposed headers, credentials, and preflight cache duration as needed. Credentials require an explicit origin policy rather than `'*'`. Allowed preflights return `204`; normal responses keep their body while receiving copied headers and merged `Vary` values. The policy follows the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).
- **Bearer authentication:** `verify` may be synchronous or asynchronous. Only `undefined` rejects a token; other values are valid principals. An optional context key stores that principal with its type checked against the verifier. Missing or rejected credentials return `401`; malformed Bearer credentials return `400`, with [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) challenges. Verification errors propagate to the error filter.
- **Request logging:** the default writes one JSON entry with the method, raw path, status, and duration in milliseconds. Query strings are excluded, and timing ends when the handler returns a response. Customize `log(entry)` and synchronous `fields(request, response)` callbacks; additional fields cannot override core fields. Thrown errors are logged and rethrown. Logging failures are reported without changing the request outcome.
- **Body size limit:** `bodyLimit({ maxBytes })` counts the bytes actually received, without trusting `Content-Length`. A body over the limit is canceled and answered with an empty `413`, which `problemDetails` renders. Accepted bodies are buffered and passed on in a new `Request`, which keeps the filter portable without streaming request bodies. Install it inside `problemDetails`, around the router or around groups that read whole bodies, and keep streaming-upload routes outside it.

Each factory validates its options when called. Filters keep the package free of runtime dependencies.

## Common rules

- **Location:** `src/filters/`, exported as `oleo.js/filters`. The `exports` map includes `./filters` → `dist/filters/index.js`. These are portable packages: ECMA-262 and ECMA-429 only, with the same lint and type isolation as the core.
- **Factories:** every filter is a factory (`cors(options)`, `bearerAuth(options)`, `problemDetails(options?)`, `requestLogger(options?)`, `bodyLimit(options)`) that returns an `HttpFilter`.
- **Fail fast:** a factory validates its options and throws a `TypeError` immediately, never at request time.
- **Tree-shaking:** named exports from one entry, and the package declares `sideEffects: false`. Unused filters drop out of bundles.
- **Never mutate a `Response`.** To add headers, build `new Response(res.body, { status, statusText, headers })` with a copied `Headers`. Responses from `fetch()` have immutable headers, so in-place mutation would also throw.
- **Recommended order** around a router:

  ```ts
  withFilters(router(/* … bearerAuth per group or route … */), requestLogger(), cors({ origin }), problemDetails(), bodyLimit({ maxBytes }))
  ```

  - **`requestLogger` outermost** sees the final status.
  - **`cors` outside `problemDetails`** also adds its headers to problem responses.
  - **`problemDetails` inside both** converts errors before they are logged.
  - **`bodyLimit` inside `problemDetails`** has its empty 413 rendered. CORS preflights have no body, so placing it after `cors` costs nothing. To keep streaming uploads, install it on groups instead.

