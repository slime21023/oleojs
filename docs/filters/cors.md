# CORS

`cors(options)` answers CORS preflight requests and adds CORS headers to responses for allowed origins.

<<< @/examples/filters.ts#cors

| Option | Default | Description |
| --- | --- | --- |
| `origin` | required | `'*'`, an origin such as `'https://app.example.com'`, a list of origins, or a function `(origin, request) => boolean` |
| `methods` | `GET`, `HEAD`, `PUT`, `PATCH`, `POST`, `DELETE` | Methods allowed in preflights |
| `allowHeaders` | the headers the browser asks for | Request headers allowed in preflights |
| `exposeHeaders` | none | Response headers the browser may read |
| `credentials` | `false` | Allow cookies and credentials. Cannot be combined with `origin: '*'` |
| `maxAge` | not sent | Seconds a browser may cache a preflight |

- Requests without an `Origin` header, and requests from origins that are not allowed, pass through unchanged.
- An allowed preflight (`OPTIONS` with `Access-Control-Request-Method`) is answered with `204` and does not reach your routes.
- Other allowed requests reach your routes, and the response gets `Access-Control-Allow-Origin` and `Vary: Origin`.
- Wrap the whole router with `cors`, not a group.
