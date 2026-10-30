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

export function renderProblem(problem: Problem, method: string, original?: Response): Response {
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
