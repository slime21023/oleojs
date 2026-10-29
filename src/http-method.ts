const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
// Fetch upper-cases these methods, so any other casing can never match.
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])
// Fetch refuses to construct requests with these methods (in any casing).
export const FORBIDDEN_METHODS: ReadonlySet<string> = new Set(['CONNECT', 'TRACE', 'TRACK'])

/**
 * Reject route methods that native Fetch requests cannot represent.
 * @throws {TypeError} For invalid tokens, forbidden methods, or casing that Fetch normalizes away.
 */
export function checkMethod(method: string, pattern: string): void {
  const description = `Invalid route method "${method}" for "${pattern}"`
  if (!TOKEN.test(method)) {
    throw new TypeError(`${description}: is not a valid HTTP method`)
  }
  const normalized = method.toUpperCase()
  if (FORBIDDEN_METHODS.has(normalized)) {
    throw new TypeError(`${description}: is forbidden by Fetch and can never match`)
  }
  if (NORMALIZED_METHODS.has(normalized) && method !== normalized) {
    throw new TypeError(`${description}: can never match; Fetch normalizes it to "${normalized}"`)
  }
}
