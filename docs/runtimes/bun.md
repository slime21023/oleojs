# Bun

```ts
import app from './app.ts'

const env = { db: await openDatabase() }

Bun.serve({ port: 3000, fetch: (request) => app.fetch(request, env) })
```

- For an application without an environment, `export default app` or `Bun.serve({ fetch: app.fetch })` works directly.
- `waitUntil` uses the same stub as on Deno.

