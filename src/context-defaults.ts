import type { ExecutionContext, Params } from './types.ts'

export const EMPTY_PARAMS: Params = Object.freeze({})

// Used where the runtime provides no `waitUntil`. It only keeps rejections from going
// unhandled; it does not extend the request lifetime.
export const STUB_EXECUTION_CTX: ExecutionContext = Object.freeze({
  waitUntil(promise: Promise<unknown>) {
    promise.then(undefined, (error: unknown) => console.error(error))
  },
})
