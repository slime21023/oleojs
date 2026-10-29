import { EMPTY_PARAMS, STUB_EXECUTION_CTX } from './context-defaults.ts'
import type { FetchHandler, HttpHandler } from './types.ts'

export function toFetch<E>(handler: HttpHandler<E>): FetchHandler<E> {
  return {
    // A closure, not a method: runtimes may call it detached (`Deno.serve(app.fetch)`).
    fetch: async (request, env, executionCtx) =>
      handler(request, {
        params: EMPTY_PARAMS,
        env: env as E,
        executionCtx: executionCtx ?? STUB_EXECUTION_CTX,
      }),
  }
}
