# oleojs

oleojs is a small, portable HTTP routing and middleware library for TypeScript. Its goal is to make HTTP services easy to compose, understand, and maintain while preserving native Web semantics.

## Core goals

- Work consistently across Cloudflare Workers, Deno, Bun, and Node.js.
- Keep the library lightweight, with zero runtime dependencies and a small public surface.
- Provide strong type safety and useful inference without burdening application authors.
- Make routing, composition, and failure behavior predictable and explicit.
- Balance efficient request handling with correctness, readability, and maintainability.

## Architectural principles

- Keep routing and middleware composition in a platform-neutral core based on Web standards.
- Isolate runtime-specific integration in adapters; the core remains independent of them.
- Build applications through composition, with clear responsibilities and explicit data flow.
- Preserve native HTTP concepts and leave application lifecycle decisions to the application.
- Add optional capabilities as independent extensions so the core stays focused.

## Scope

The core focuses on HTTP routing and middleware composition. Cross-cutting HTTP concerns and declarative contracts may extend it without becoming mandatory parts of every application.

Application-specific validation, rendering, and file-system conventions remain application responsibilities. Design choices should favor the smallest abstraction that serves these goals.
