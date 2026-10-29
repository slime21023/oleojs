import type { HttpFilter } from '../types.ts'

/** A problem document whose status also becomes the HTTP response status. */
export interface Problem {
  /** An integer from 400 through 599. */
  readonly status: number
  /** A problem type URI reference; defaults to `about:blank`. */
  readonly type?: string
  /** A summary; defaults to the status's registered reason phrase when known. */
  readonly title?: string
  /** A client-facing explanation of this occurrence. */
  readonly detail?: string
  /** A URI reference identifying this occurrence. */
  readonly instance?: string
  /** Additional JSON-serializable fields. */
  readonly [extension: string]: unknown
}

/** Error mapping and reporting for {@link problemDetails}. */
export interface ProblemDetailsOptions {
  /** Map a thrown value synchronously; `undefined` or an invalid mapping produces a generic 500. */
  fromError?: (error: unknown, req: Request) => Problem | undefined
  /** Convert error responses with a null body. Defaults to true. */
  emptyResponses?: boolean
  /** Report thrown errors that become 5xx responses. Defaults to `console.error(error)`. */
  onError?: (error: unknown, req: Request) => void
}

// Registered HTTP status titles; unused and unassigned codes have no default title.
// https://www.iana.org/assignments/http-status-codes/
const TITLES: Readonly<Record<number, string | undefined>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
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

function renderProblem(problem: Problem, method: string, original?: Response): Response {
  if (problem === null || typeof problem !== 'object' || Array.isArray(problem)) {
    throw new TypeError('A problem must be an object')
  }
  const { status } = problem
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new TypeError('A problem status must be an integer from 400 through 599')
  }
  for (const field of ['type', 'title', 'detail', 'instance'] as const) {
    if (problem[field] !== undefined && typeof problem[field] !== 'string') {
      throw new TypeError(`A problem ${field} must be a string`)
    }
  }
  // A root toJSON hook could replace the document and make its status disagree with HTTP.
  if (typeof problem.toJSON === 'function') throw new TypeError('A problem must not define a toJSON method')
  const body = JSON.stringify({
    ...problem,
    status,
    type: problem.type ?? 'about:blank',
    title: problem.title ?? TITLES[status],
    detail: problem.detail,
    instance: problem.instance,
  })
  const headers = new Headers(original?.headers)
  headers.set('Content-Type', 'application/problem+json')
  // The new representation has its own length and is not encoded like the original body.
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  return new Response(method === 'HEAD' ? null : body, { status, statusText: original?.statusText, headers })
}
