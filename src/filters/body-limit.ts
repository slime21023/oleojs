import type { HttpFilter } from '../types.ts'

/** The largest request body the wrapped handlers accept. */
export interface BodyLimitOptions {
  /** Maximum body size in bytes; a non-negative safe integer. */
  readonly maxBytes: number
}

/**
 * Reject request bodies larger than `maxBytes` with an empty 413, before the wrapped handler runs.
 * Accepted bodies are read into memory and passed on in a new Request with the same method,
 * URL, headers, and signal; requests without a body pass through unchanged.
 *
 * The limit counts the bytes actually received, so it does not rely on Content-Length, and the
 * buffered body avoids streaming-request support that varies between runtimes. Reading stops,
 * and the source stream is canceled, as soon as the limit is exceeded. Wrapped handlers
 * therefore cannot stream uploads; leave streaming routes outside this filter.
 * Stream and cancellation failures propagate.
 *
 * @throws {TypeError} If options are invalid, when the filter is created.
 */
export function bodyLimit<E = unknown>(options: BodyLimitOptions): HttpFilter<E> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('bodyLimit() expects an options object with maxBytes')
  }
  const { maxBytes } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('bodyLimit() maxBytes must be a non-negative safe integer')
  }

  return (next) => async (req, ctx) => {
    if (req.body === null) return next(req, ctx)
    const body = await readWithin(req.body, maxBytes)
    if (body === undefined) return new Response(null, { status: 413 })
    // The method is copied from req, and Fetch never gives a GET or HEAD request a body.
    // oxlint-disable-next-line unicorn/no-invalid-fetch-options
    return next(new Request(req, { body }), ctx)
  }
}

// Copy the stream's bytes into one buffer, or return undefined after canceling a stream that exceeds the limit.
async function readWithin(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // Fetch request bodies are byte streams; anything else is a host defect, not a client error.
    if (!(value instanceof Uint8Array)) {
      await reader.cancel()
      throw new TypeError('bodyLimit() expects request body chunks to be Uint8Array')
    }
    length += value.byteLength
    if (length > maxBytes) {
      // Await cancellation so cleanup failures reach the caller instead of becoming unhandled rejections.
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
