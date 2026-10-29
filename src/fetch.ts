import { EMPTY_PARAMS, STUB_EXECUTION_CTX } from './context-defaults.ts'
import type { FetchHandler, HttpHandler } from './types.ts'

/**
 * Expose a handler through a Fetch entry point, creating a fresh context for each request.
 * The returned `fetch` function works when called detached and converts thrown errors to rejections.
 *
 * The environment is passed through unchanged; callers must supply it when their handler needs it.
 * Without a host execution context, `waitUntil` reports rejections through `console.error`
 * but cannot extend the request lifetime.
 */
export function toFetch<E>(handler: HttpHandler<E>): FetchHandler<E> {
  return {
    fetch: async (request, env, executionCtx) =>
      handler(request, {
        params: EMPTY_PARAMS,
        env: env as E,
        executionCtx: executionCtx ?? STUB_EXECUTION_CTX,
      }),
  }
}
