# Introduction

oleojs is a small HTTP router and middleware library for TypeScript. It has no runtime dependencies and runs on Cloudflare Workers, Deno, Bun, and Node.js.

An application is built from three kinds of functions:

- A **handler** takes a `Request` and a context, and returns a `Response`.
- A **router** is a handler that picks a handler by method and path.
- A **filter** wraps a handler to add behavior, such as logging or authentication.

Because routers and filters are handlers too, they all combine the same way. Requests and responses are the standard Web `Request` and `Response`, so there is no framework object to learn.

## What oleojs leaves to you

- Validation rules: bring any [Standard Schema](https://standardschema.dev/) library, optionally through [contracts](/contracts/).
- Rendering, templates, and file-system routing.
- Server startup, configuration, and shutdown.
