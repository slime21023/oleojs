import type { HttpFilter } from '../types.ts'
import { mapResponse } from './map-response.ts'

/**
 * Set response headers from a snapshot of native HeadersInit, replacing values with the same name.
 * Other headers, status, status text, and the streaming body are preserved in a new Response.
 * Repeated Set-Cookie values are preserved. Status-zero responses pass through unchanged.
 * @throws {TypeError} If headers are missing or invalid, when the filter is created.
 */
export function responseHeaders<E = unknown>(headers: HeadersInit): HttpFilter<E> {
  if (headers === null || typeof headers !== 'object') {
    throw new TypeError('responseHeaders() expects Headers, a header record, or header pairs')
  }
  const configured = new Headers(headers)
  return mapResponse<E>((response) => {
    // Native constructors cannot recreate network-error or opaque responses.
    if (response.status === 0) return response
    const updated = new Headers(response.headers)
    for (const name of configured.keys()) updated.delete(name)
    // Append after deleting so repeated Set-Cookie fields keep every configured value.
    for (const [name, value] of configured) updated.append(name, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: updated })
  })
}
