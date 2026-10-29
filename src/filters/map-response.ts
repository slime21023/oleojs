import type { Context, HttpFilter } from '../types.ts'

/** Transform a returned response, with the request and context received by this filter. */
export type ResponseTransform<E = unknown> =
  (response: Response, req: Request, ctx: Context<E>) => Response | Promise<Response>

/**
 * Transform the response after the next handler resolves, without reading its body.
 * Return a new Response to change it; any body reading belongs to the callback.
 * The callback receives this filter's context, including only values already available at its position.
 * Downstream errors skip transformation; transformation errors propagate.
 * @throws {TypeError} If transform is not a function, when the filter is created.
 */
export function mapResponse<E = unknown>(transform: ResponseTransform<E>): HttpFilter<E> {
  if (typeof transform !== 'function') throw new TypeError('mapResponse() expects transform to be a function')
  return (next) => async (req, ctx) => transform(await next(req, ctx), req, ctx)
}
