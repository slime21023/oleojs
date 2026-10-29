import type { Context, HttpFilter } from '../types.ts'

/** Transform a request without changing its context; synchronous and asynchronous results are accepted. */
export type RequestTransform<E = unknown> = (req: Request, ctx: Context<E>) => Request | Promise<Request>

/**
 * Transform each incoming request before invoking the next handler with the same context.
 * Return a new Request to change it; the filter does not modify or consume the original.
 * Transformation and downstream errors propagate.
 * @throws {TypeError} If transform is not a function, when the filter is created.
 */
export function mapRequest<E = unknown>(transform: RequestTransform<E>): HttpFilter<E> {
  if (typeof transform !== 'function') throw new TypeError('mapRequest() expects transform to be a function')
  return (next) => async (req, ctx) => next(await transform(req, ctx), ctx)
}
