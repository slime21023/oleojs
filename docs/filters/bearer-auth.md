# Bearer authentication

`bearerAuth(options)` reads an `Authorization: Bearer <token>` header and checks the token with your function.

<<< @/examples/filters.ts#bearer-auth

| Option | Description |
| --- | --- |
| `verify(token, request, ctx)` | Required. Return the user (or any value) for a valid token, or `undefined` to reject it. May be async |
| `key` | Optional [context key](/guide/middleware#passing-values-with-context-keys) that stores the value `verify` returned |
| `realm` | Optional realm for the `WWW-Authenticate` header |

| Request | Response |
| --- | --- |
| No `Authorization` header, or another scheme | `401` |
| A malformed Bearer token | `400` |
| `verify` returns `undefined` | `401` |

Responses carry a `WWW-Authenticate` header and an empty body, which [`problemDetails`](/filters/problem-details) can format. Errors thrown by `verify` are not turned into `401`; they propagate like any other error.
