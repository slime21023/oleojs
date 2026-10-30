import type { HttpFilter } from '../types.ts'
import { renderProblem } from '../http-problem.ts'
import type { Problem } from '../http-problem.ts'

export type { Problem } from '../http-problem.ts'

/** Error mapping and reporting for {@link problemDetails}. */
export interface ProblemDetailsOptions {
  /** Map a thrown value synchronously; `undefined` or an invalid mapping produces a generic 500. */
  fromError?: (error: unknown, req: Request) => Problem | undefined
  /** Convert error responses with a null body. Defaults to true. */
  emptyResponses?: boolean
  /** Report thrown errors that become 5xx responses. Defaults to `console.error(error)`. */
  onError?: (error: unknown, req: Request) => void
}

/**
 * Render thrown errors and, by default, empty error responses as RFC 9457 problem documents.
 * Existing response bodies pass through unchanged. Generated HEAD responses have no body.
 * Headers are copied, replacing Content-Type and removing stale Content-Length/Content-Encoding.
 * The environment type is inferred from the surrounding router or group.
 *
 * Failed mappings fall back to a generic 500 without exposing the original error. Reporting
 * failures are logged without changing the response, including rejected reporting promises.
 * Errors raised later while streaming a response body remain the host's responsibility.
 *
 * @throws {TypeError} If options have invalid types, when the filter is created.
 */
export function problemDetails<E = unknown>(options: ProblemDetailsOptions = {}): HttpFilter<E> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('problemDetails() expects an options object')
  }
  const { fromError, emptyResponses = true, onError = (error: unknown) => console.error(error) } = options
  if (fromError !== undefined && typeof fromError !== 'function') {
    throw new TypeError('problemDetails() expects fromError to be a function')
  }
  if (typeof emptyResponses !== 'boolean') {
    throw new TypeError('problemDetails() expects emptyResponses to be a boolean')
  }
  if (typeof onError !== 'function') {
    throw new TypeError('problemDetails() expects onError to be a function')
  }

  return (next) => async (req, ctx) => {
    let response: Response
    try {
      response = await next(req, ctx)
    } catch (error) {
      const result = responseFromError(error, req, fromError)
      if (result.status >= 500) reportError(error, req, onError)
      return result
    }
    if (!emptyResponses || response.status < 400 || response.body !== null) return response
    return renderProblem({ status: response.status }, req.method, response)
  }
}

function responseFromError(error: unknown, req: Request, fromError: ProblemDetailsOptions['fromError']): Response {
  try {
    return renderProblem(fromError?.(error, req) ?? { status: 500 }, req.method)
  } catch {
    // Mapping and serialization failures must not replace the original error being reported.
    return renderProblem({ status: 500 }, req.method)
  }
}

function reportError(error: unknown, req: Request, onError: (error: unknown, req: Request) => void): void {
  try {
    // TypeScript allows async callbacks where a void return is expected.
    void Promise.resolve(onError(error, req)).catch((reportingError: unknown) => console.error(reportingError))
  } catch (reportingError) {
    console.error(reportingError)
  }
}
