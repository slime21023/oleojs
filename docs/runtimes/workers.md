# Cloudflare Workers

```ts
import app from './app.ts'

export default app
```

- Workers passes your bindings as `env` and its own `ExecutionContext`. `ctx.executionCtx.waitUntil(promise)` extends the request lifetime natively.
- Declare `Env` to match your `wrangler` bindings. The runtime, not your code, supplies it.

