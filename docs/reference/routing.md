# Routing rules

## Request lifecycle

1. **Entry.** The runtime, or `oleojs/node`, calls `fetch`. `fetch` creates the `Context` and calls the composed handler.
2. **Filters (inbound).** The request passes through the composed filters. Filters may derive the context through context keys, or short-circuit (for example, on a CORS preflight).
3. **Routing.** The router extracts the path, walks the trie, and derives the context with `params`.
4. **Handler.** The matched handler runs. Otherwise the router returns its default 404, 405, or 400 response (see [HTTP semantics](/reference/http-semantics)).
5. **Filters (outbound).** The `Response` returns through the same filters for header enrichment and error normalization.

## Routing

### Path extraction

- **Bounds:** the path starts at the first `/` after `://` in `request.url`, and ends at the first `?` or `#`, or at the end of the string.
- **No normalization.** `request.url` is always absolute and already WHATWG-normalized (dot segments resolved, non-ASCII percent-encoded), so oleo performs no normalization of its own.

### Pattern syntax

Patterns are a strict subset of `URLPattern` pathname syntax (`URLPattern` is part of ECMA-429). Every accepted pattern must match exactly the same paths as `new URLPattern({ pathname })`. `test/portable/routing/urlpattern.test.ts` verifies this guarantee on every runtime.

| Token | Matches |
| --- | --- |
| Static text | The same raw (percent-encoded) text. At definition time each static segment is canonicalized the way `URLPattern` does it, through a URL's `pathname` setter. `/café` and `/caf%C3%A9` are therefore the same pattern, and both match the request path `/caf%C3%A9`. Do not use `encodeURI`: it re-encodes an existing `%`. |
| `:name` | Exactly one non-empty segment. Must span the whole segment, with no regex group and no `?`/`+`/`*` modifier. |
| `*` | The rest of the path: possibly empty, may contain `/`. Allowed only as the last segment. `/files/*` matches `/files/` and `/files/a/b`, but not `/files`. |

The two intentional differences from `URLPattern`:

- The wildcard value is exposed as `params['*']`. `URLPattern` names it `'0'`.
- Parameter values are percent-decoded. `URLPattern` returns them encoded.

### Matching

- **Case and slashes:** matching is case-sensitive, and trailing slashes are significant (`/users` ≠ `/users/`).
- **Empty segments:** `//` produces an empty segment, which matches no static segment and no `:name`.
- **Trailing slashes:** a pattern ending in `/` (including `/` itself) ends in an empty static segment. That segment matches only the same trailing slash in the request.
- **Priority:** at each node, try the static child, then the param child, then the wildcard. Registration order never affects matching.
- **Method-aware matching:** a terminal node accepts the request only if it has a handler for the method, or a `GET` handler when the method is `HEAD`. Otherwise matching backtracks and continues.
- **Trie shape:** each trie node sits at a fixed segment depth, so a lookup visits each node at most once. Lookup is typically O(k) in path length and never worse than the trie size.
- **Static children** are dispatched by first character code and compared in place against `request.url`.
- **Decoding:** a `:name` or `*` value is decoded with `decodeURIComponent` only if it contains `%`.
  - **When:** decoding happens only after the final route has been selected, never during backtracking. It also happens after segmentation, so `%2F` becomes `/` inside a value without splitting the path.
  - **Malformed encoding** in the selected route's values yields `400 Bad Request`.

### Route definition errors

`router()` throws a `TypeError` naming the pattern when given any of the following:

- A method that is not a valid HTTP token (`'g e t'`, `''`).
- A method that can never match:
  - Fetch upper-cases `DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST`, and `PUT`, so any other casing of these (`'get'`) never matches. Other methods are case-sensitive and accepted in any casing.
  - `CONNECT`, `TRACE`, and `TRACK` are forbidden by Fetch.
- A pattern that does not start with `/`.
- Two different `:name`s at the same position of the same path, under any methods (`GET /u/:id` vs `POST /u/:userId`). Parameter names belong to routes, so diverging paths may name a shared position differently (`/u/:id` and `/u/:userId/posts`).
- The same method and pattern registered twice, including equivalent encodings (`/café` and `/caf%C3%A9`).
- A `:name` that is not a valid `URLPattern` name: a JavaScript identifier (`/:`, `/:id?`).
- The same `:name` twice in one pattern (`/:id/x/:id`). `URLPattern` rejects duplicate group names too.
- A `:` or `*` that does not form a whole segment (`/a:b`, `/files/a*`). In `URLPattern` these would be parameters or wildcards inside a segment.
- `*` in any segment but the last.
- An empty segment anywhere but the end (`/a//b`).
- A dot segment (`.`, `..`, `%2e`). Request paths are already normalized, so it can never match.
- Any other `URLPattern` syntax character: `(`, `)`, `{`, `}`, `?`, `+`, `\`.

