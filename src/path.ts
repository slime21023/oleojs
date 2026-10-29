const CHAR_HASH = 35
const CHAR_SLASH = 47
const CHAR_QUESTION = 63

// Index of the path's leading `/` in an absolute URL. When the path is empty,
// the index where it would start (`pathEnd` then returns the same index).
export function pathStart(url: string): number {
  const authority = url.indexOf('://')
  if (authority === -1) return url.length
  for (let i = authority + 3; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === CHAR_SLASH || code === CHAR_QUESTION || code === CHAR_HASH) return i
  }
  return url.length
}

// Index just past the path: the first `?` or `#` at or after `start`, or the end of the URL.
export function pathEnd(url: string, start: number): number {
  for (let i = start; i < url.length; i++) {
    const code = url.charCodeAt(i)
    if (code === CHAR_QUESTION || code === CHAR_HASH) return i
  }
  return url.length
}
