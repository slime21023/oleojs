import { pathEnd, pathStart } from '../path.ts'
import type { HttpFilter } from '../types.ts'

/** One request outcome; duration stops when the handler settles, before body streaming. */
export interface LogEntry {
  readonly method: string
  /** Raw encoded path, with the query string excluded. */
  readonly path: string
  /** Absent when the handler throws. */
  readonly status?: number
  /** Milliseconds rounded to one decimal place; workerd may report zero without I/O. */
  readonly durationMs: number
  /** Present only when the handler throws. */
  readonly error?: true
  readonly [field: string]: unknown
}

/** Logging callbacks; failures are isolated from request handling. */
export interface RequestLoggerOptions {
  /** Defaults to printing one JSON entry with console.log. */
  log?: (entry: LogEntry) => void
  /** Synchronous extra fields. The response is undefined on failure; core fields always win. */
  fields?: (req: Request, res: Response | undefined) => Record<string, unknown>
}

/**
 * Log one outcome per request and preserve the handler's response or thrown value.
 * Place this filter outermost to record the final status after other filters have run.
 * Callback failures are reported through console.error; log promise rejections are observed
 * without delaying the response or extending the request lifetime.
 *
 * @throws {TypeError} If options are invalid, when the filter is created.
 */
export function requestLogger<E = unknown>(options: RequestLoggerOptions = {}): HttpFilter<E> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('requestLogger() expects an options object')
  }
  const { log = (entry: LogEntry) => console.log(JSON.stringify(entry)), fields } = options
  if (typeof log !== 'function') throw new TypeError('requestLogger() expects log to be a function')
  if (fields !== undefined && typeof fields !== 'function') {
    throw new TypeError('requestLogger() expects fields to be a function')
  }

  return (next) => async (req, ctx) => {
    const start = performance.now()
    let response: Response | undefined
    try {
      response = await next(req, ctx)
      return response
    } finally {
      const durationMs = Math.round((performance.now() - start) * 10) / 10
      let extra: Record<string, unknown> = {}
      try {
        extra = { ...fields?.(req, response) }
      } catch (error) {
        console.error(error)
      }
      // Remove reserved fields even when the corresponding core field will be absent.
      for (const field of ['method', 'path', 'status', 'durationMs', 'error']) delete extra[field]
      if (typeof extra.toJSON === 'function') delete extra.toJSON
      const path = pathStart(req.url)
      const entry: LogEntry = {
        ...extra,
        method: req.method,
        path: req.url.slice(path, pathEnd(req.url, path)),
        durationMs,
        ...(response === undefined ? { error: true as const } : { status: response.status }),
      }
      try {
        void Promise.resolve(log(entry)).catch((error: unknown) => console.error(error))
      } catch (error) {
        console.error(error)
      }
    }
  }
}
