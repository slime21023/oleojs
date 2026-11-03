# Routing rules

## Patterns

| Pattern part | Matches |
| --- | --- |
| Static text, such as `/users` | The same text. `/café` and `/caf%C3%A9` are the same pattern |
| `:name` | One non-empty segment. The value is percent-decoded |
| `*` | The rest of the path, possibly empty. Only as the last segment |

Patterns follow the [`URLPattern`](https://developer.mozilla.org/docs/Web/API/URLPattern) pathname syntax, without its advanced features.

## Matching

- The path is taken from `request.url`, without the query string.
- Matching is case-sensitive, and a trailing slash matters.
- Static segments win over `:name`, which wins over `*`. Definition order does not matter.
- `HEAD` uses the `GET` route when there is no `HEAD` route.
- Responses to `HEAD` never have a body.
- `OPTIONS` is not answered automatically. Add a route, or use [`cors`](/filters/cors) for preflights.

## Default responses

| Situation | Response |
| --- | --- |
| No route matches the path | `404` |
| The path matches, but not the method | `405`, with an `Allow` header |
| A parameter has malformed percent-encoding | `400` |

They have empty bodies. To change them, wrap the router with a filter, such as [`problemDetails`](/filters/problem-details).

## Definition errors

`router()` throws a `TypeError` for:

- A pattern that does not start with `/`.
- An invalid method, or a method that can never match: `get` in lower case, `CONNECT`, `TRACE`, or `TRACK`.
- The same method and pattern twice.
- Different parameter names at the same position of the same path, such as `GET /u/:id` and `POST /u/:userId`.
- The same parameter name twice in one pattern.
- `:name` or `*` that is not a whole segment, such as `/a:b`.
- `*` before the last segment.
- An empty segment, such as `/a//b`, except at the end.
- A dot segment, such as `/a/../b`.
- The characters `(`, `)`, `{`, `}`, `?`, `+`, or `\`.

Group prefixes are joined with their routes before these checks.

## Errors in handlers

oleojs does not catch errors thrown by handlers or filters. Without an error filter such as [`problemDetails`](/filters/problem-details), the runtime handles them, usually with a `500`.
