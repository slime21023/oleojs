# Deno

```ts
import app from './app.ts'

const env = { db: await openDatabase() }

Deno.serve({ port: 8000 }, (request) => app.fetch(request, env))
```

- For an application without an environment, `Deno.serve(app.fetch)` works directly, because `fetch` does not depend on `this`.
- Deno has no `ExecutionContext`. `waitUntil` uses the oleojs stub: background promises keep running while the process lives, rejections are reported with `console.error`, and the request lifetime is not extended.

