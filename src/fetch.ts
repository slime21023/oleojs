import { EMPTY_PARAMS } from './trie.ts'
import type { ExecutionContext, FetchHandler, HttpHandler } from './types.ts'

// Used where the runtime provides no `waitUntil`. It only keeps rejections from going
// unhandled; it does not extend the request lifetime.
export const STUB_EXECUTION_CTX: ExecutionContext = Object.freeze({
  waitUntil(promise: Promise<unknown>) {
    promise.then(undefined, (error: unknown) => console.error(error))
  },
})

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
