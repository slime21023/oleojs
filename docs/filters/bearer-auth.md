# `bearerAuth(options)`

Implemented in [`src/filters/bearer-auth.ts`](https://github.com/slime21023/oleo.js/blob/main/src/filters/bearer-auth.ts), following [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html).

```ts
interface BearerAuthOptions<E = unknown, T = unknown> {
  verify: (token: string, req: Request, ctx: Context<E>) => NoInfer<T> | undefined | Promise<NoInfer<T> | undefined>
  key?: ContextKey<T>  // where to store the verified principal; omit to only verify
  realm?: string
}

function bearerAuth<E = unknown, T = unknown>(options: BearerAuthOptions<E, T>): HttpFilter<E>
```

```ts
const userKey = contextKey<User>('user')
group('/api', { filters: [bearerAuth({ verify: (token, req, ctx: Context<Env>) => findUser(ctx.env, token), key: userKey })] },
  get('/me', (req, ctx) => Response.json(userKey.get(ctx))),
)
```

- **Responses** follow RFC 6750, with empty bodies so that `problemDetails` can render them:

  | Situation | Status | `WWW-Authenticate` |
  | --- | --- | --- |
  | No `Authorization` header, or a scheme other than `Bearer` (matched case-insensitively) | 401 | `Bearer realm="…"` (`realm` only if configured) |
  | `Bearer` with an empty token or one outside the RFC 6750 `b64token` syntax | 400 | `Bearer realm="…", error="invalid_request"` |
  | `verify` returns `undefined` | 401 | `Bearer realm="…", error="invalid_token"` |

- **On success** it calls `next(req, key ? key.with(ctx, principal) : ctx)`. `verify` returns `undefined` to reject; any other value, including `null` or `false`, is the principal.
- **`verify` may throw.** The error propagates to the error filter; it is never turned into a 401.
- **The token is never logged or exposed.** Timing-safe comparison is the job of `verify`.
- **Option validation:** `verify` is required and must be a function. A supplied key must expose the `ContextKey` interface. `realm` must be a quoted-string body representable in a native header, so `"`, `\`, control characters, and characters above U+00FF throw.
- **Env typing:** supply env information with `ctx: Context<Env>` in `verify`, or through contextual typing (for example, inside `router<Env>(group(…, { filters: [bearerAuth(…)] }))`). Type tests cover both.
- **Principal typing:** when a key is supplied, its type constrains the verifier's result. `NoInfer<T>` prevents an unknown result from widening the key's type; narrow unknown authentication data before returning it. Verification without a key does not expose a principal downstream.
- **Placement:** per group or route is fine. Unmatched paths under the group then get 404, not 401 (see [Group filters](/guide/groups#group-filters)).

