import type { ExecutionContext, Params } from './types.ts'

// Identity also lets the router reuse the incoming context when a match captures no parameters.
export const EMPTY_PARAMS: Params = Object.freeze({})

// Report background failures on hosts without waitUntil; this cannot extend the request lifetime.
export const STUB_EXECUTION_CTX: ExecutionContext = Object.freeze({
  waitUntil(promise: Promise<unknown>) {
    promise.then(undefined, (error: unknown) => console.error(error))
  },
})
