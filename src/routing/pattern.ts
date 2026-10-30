const SYNTAX_CHARS = /[(){}?+\\]/
const PARAM_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

export function invalidPattern(pattern: string, reason: string): TypeError {
  return new TypeError(`Invalid route pattern "${pattern}": ${reason}`)
}

/** Validate and encode definition-time segments for routing and documentation alike. */
export function parsePattern(pattern: string): string[] {
  if (pattern.charAt(0) !== '/') throw invalidPattern(pattern, 'must start with "/"')
  const segments = pattern.slice(1).split('/')
  const names = new Set<string>()
  return segments.map((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '*') {
      if (!last) throw invalidPattern(pattern, '"*" must be the last segment')
      return segment
    }
    if (segment.startsWith(':')) {
      const name = segment.slice(1)
      if (!PARAM_NAME.test(name)) throw invalidPattern(pattern, `"${segment}" is not a valid parameter`)
      if (names.has(name)) throw invalidPattern(pattern, `duplicate parameter ":${name}"`)
      names.add(name)
      return segment
    }
    if (segment === '') {
      if (last) return ''
      throw invalidPattern(pattern, 'empty segment')
    }
    if (segment.includes(':') || segment.includes('*')) {
      throw invalidPattern(pattern, `"${segment}": ":" and "*" must form a whole segment`)
    }
    if (SYNTAX_CHARS.test(segment)) throw invalidPattern(pattern, `"${segment}": unsupported URLPattern syntax`)
    const url = new URL('http://canonical.invalid/')
    url.pathname = `/${segment}`
    const canonical = url.pathname.slice(1)
    if (canonical === '' || canonical.includes('/')) {
      throw invalidPattern(pattern, `"${segment}" is a dot segment and can never match`)
    }
    return canonical
  })
}
