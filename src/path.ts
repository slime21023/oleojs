const CHAR_HASH = 35
const CHAR_SLASH = 47
const CHAR_QUESTION = 63

/**
 * Locate the path in a serialized URL with an authority, without parsing or copying the URL.
 * With no path, return the query/fragment boundary or string length; `pathEnd` returns the same index.
 */
export function pathStart(url: string): number {
  const authority = url.indexOf('://')
  if (authority === -1) return url.length
  for (let i = authority + 3; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === CHAR_SLASH || code === CHAR_QUESTION || code === CHAR_HASH) return i
  }
  return url.length
}

/** Return the exclusive path end: the first `?` or `#` from `start`, or the string length. */
export function pathEnd(url: string, start: number): number {
  for (let i = start; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === CHAR_QUESTION || code === CHAR_HASH) return i
  }
  return url.length
}
