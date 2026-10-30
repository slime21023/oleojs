# `requestLogger(options?)`

Implemented in [`src/filters/request-logger.ts`](https://github.com/slime21023/oleo.js/blob/main/src/filters/request-logger.ts).

```ts
interface LogEntry {
  readonly method: string
  readonly path: string        // raw path without the query string, which often carries tokens
  readonly status?: number     // absent when the handler threw
  readonly durationMs: number  // rounded to 0.1 ms
  readonly error?: true
  readonly [field: string]: unknown
}

interface RequestLoggerOptions {
  log?: (entry: LogEntry) => void                                                // default: console.log(JSON.stringify(entry))
  fields?: (req: Request, res: Response | undefined) => Record<string, unknown> // extra fields; res is undefined on error
}

function requestLogger<E = unknown>(options?: RequestLoggerOptions): HttpFilter<E>
```

- **Option validation:** options must be an object; supplied `log` and `fields` callbacks must be functions. `fields` returns its record synchronously.
- **One entry per request,** logged when `next` settles. Timing uses `performance.now()`.
  - **What is timed:** only the time until the handler returns its `Response`; body streaming is not included.
  - **On `workerd`,** time advances only across I/O (a Spectre mitigation), so durations of CPU-only handlers read as `0`.
- **Path:** extracted with `pathStart`/`pathEnd`, so it is the raw, still-encoded path, and the query string is never logged.
- **On a throw** it logs `{ error: true }` without `status`, then rethrows. It never swallows errors.
- **Isolation:** an error thrown by `log` or `fields` is reported with `console.error` and never affects the response or original thrown value. If `fields` fails, the core entry is still logged. Returned logging promise rejections are also reported, without delaying the response or extending the request lifetime.
- **Core fields win:** additional fields are copied without mutating the caller's record. They cannot override method, path, status, duration, or error, including the absence of status/error on the corresponding outcome. A functional root `toJSON` is removed so it cannot replace the serialized core entry.

