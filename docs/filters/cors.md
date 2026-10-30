# `cors(options)`

Implemented in [`src/filters/cors.ts`](https://github.com/slime21023/oleo.js/blob/main/src/filters/cors.ts), using the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

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
- **Must wrap the whole router, never a group.** An `OPTIONS` preflight to a path without an `OPTIONS` route is an unmatched request, so group filters never see it (see [Group filters](/guide/groups#group-filters)).

