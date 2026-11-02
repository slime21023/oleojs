# Introduction

oleojs is a zero-dependency TypeScript HTTP router and middleware library. An application is a function `(Request, Context) => Response | Promise<Response>`, and middleware is a function that wraps one. The portable core uses only ECMA-262 and the WinterTC Minimum Common Web API (ECMA-429), so it runs unmodified on Cloudflare Workers, Deno, and Bun, and on Node.js through an adapter.

Design influences: [http4k](https://www.http4k.org/) (server as a function, composable filters) and [itty-router](https://itty.dev/itty-router) (minimal API surface, native `Request`/`Response`).

## Design philosophy

- **An application is a function.** A handler takes a `Request` and a `Context`, then returns a `Response` or a promise of one. Routers are handlers too, so routing and middleware share the same composition model.
- **Use native Web primitives.** Requests, responses, headers, and streams keep their native behavior. Context holds request data; responses are created with `new Response()` or `Response.json()`.
- **Make data flow explicit.** Routes and groups are immutable values. Middleware passes data downstream through derived contexts, while typed context keys let independent modules share values without name collisions.
- **Keep platform boundaries clear.** The core uses ECMAScript and the WinterTC Minimum Common Web API. Runtime-specific integration belongs in adapters; applications own server startup, configuration, and shutdown.
- **Keep the API small and predictable.** Route parameters and environments carry their types through composition. Invalid route definitions fail when the router is constructed. Routing is prepared once, balancing efficient request handling with readable, maintainable code.

## Non-goals

These are not part of the core. Compose them as filters or separate packages instead:

- **Schema validation rules.** Bring an application-owned validator through a filter or the optional `oleojs/contract` integration; the core provides no schema language or validation engine.
- **Request/response wrappers or response builders.**
- **Implicit URL normalization** (trailing slashes, case folding, duplicate slashes). Normalize in a filter if needed.
- **File-system routing and view engines.**

