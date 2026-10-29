import type { Params } from './types.ts'

const CHAR_SLASH = 47
const EMPTY_SEGMENT = -1
const SYNTAX_CHARS = /[(){}?+\\]/
const PARAM_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

export const EMPTY_PARAMS: Params = Object.freeze({})

// Returned by `match` when the selected route's parameters are not valid percent-encoding.
export const MALFORMED: unique symbol = Symbol('malformed')

// One node per segment position. Every node has the same shape so property access stays monomorphic.
interface Node<T> {
  readonly segment: string // static nodes: the canonical segment text
  readonly name: string // param nodes: the parameter name; wildcard nodes: '*'
  readonly statics: Map<number, Node<T>[]> // keyed by the segment's first char code
  param: Node<T> | undefined
  wildcard: Node<T> | undefined
  readonly handlers: Map<string, T>
  hasParams: boolean
}

function createNode<T>(segment: string, name: string): Node<T> {
  return {
    segment,
    name,
    statics: new Map(),
    param: undefined,
    wildcard: undefined,
    handlers: new Map(),
    hasParams: false,
  }
}

function handlerFor<T>(node: Node<T>, method: string): T | undefined {
  return node.handlers.get(method) ?? (method === 'HEAD' ? node.handlers.get('GET') : undefined)
}

function staticKey(segment: string): number {
  return segment === '' ? EMPTY_SEGMENT : segment.charCodeAt(0)
}

function invalid(pattern: string, reason: string): TypeError {
  return new TypeError(`Invalid route pattern "${pattern}": ${reason}`)
}

function canonicalSegment(segment: string, last: boolean, pattern: string): string {
  if (segment === '') {
    if (last) return ''
    throw invalid(pattern, 'empty segment')
  }
  if (segment.includes(':') || segment.includes('*')) {
    throw invalid(pattern, `"${segment}": ":" and "*" must form a whole segment`)
  }
  if (SYNTAX_CHARS.test(segment)) {
    throw invalid(pattern, `"${segment}": unsupported URLPattern syntax`)
  }
  // Canonicalize the way URLPattern does: through a URL's pathname setter.
  const url = new URL('http://canonical.invalid/')
  url.pathname = `/${segment}`
  const canonical = url.pathname.slice(1)
  if (canonical === '' || canonical.includes('/')) {
    throw invalid(pattern, `"${segment}" is a dot segment and can never match`)
  }
  return canonical
}

export class Trie<T> {
  readonly #root = createNode<T>('', '')
  #malformed = false

  // Parameters of the last successful `match`. Read them before matching again.
  params: Params = EMPTY_PARAMS

  insert(method: string, pattern: string, value: T): void {
    if (pattern.charCodeAt(0) !== CHAR_SLASH) throw invalid(pattern, 'must start with "/"')
    const segments = pattern.slice(1).split('/')
    let node = this.#root
    let hasParams = false
    const names = new Set<string>()
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      const last = i === segments.length - 1
      if (segment === '*') {
        if (!last) throw invalid(pattern, '"*" must be the last segment')
        node.wildcard ??= createNode('', '*')
        node = node.wildcard
        hasParams = true
      } else if (segment.startsWith(':')) {
        const name = segment.slice(1)
        if (!PARAM_NAME.test(name)) throw invalid(pattern, `"${segment}" is not a valid parameter`)
        if (names.has(name)) throw invalid(pattern, `duplicate parameter ":${name}"`)
        names.add(name)
        if (node.param !== undefined && node.param.name !== name) {
          throw invalid(pattern, `":${name}" conflicts with ":${node.param.name}" at the same position`)
        }
        node.param ??= createNode('', name)
        node = node.param
        hasParams = true
      } else {
        node = this.#staticChild(node, canonicalSegment(segment, last, pattern))
      }
    }
    if (node.handlers.has(method)) throw invalid(pattern, `duplicate route for ${method}`)
    node.handlers.set(method, value)
    node.hasParams = hasParams
  }

  // Matches the path `url[start, end)` against routes accepting `method`.
  // Returns the handler and sets `params`, or `undefined` when no route accepts the request.
  match(method: string, url: string, start: number, end: number): T | typeof MALFORMED | undefined {
    this.params = EMPTY_PARAMS
    this.#malformed = false
    if (start >= end || url.charCodeAt(start) !== CHAR_SLASH) return undefined
    const node = this.#descend(this.#root, method, url, start + 1, end)
    if (node === undefined) return undefined
    if (this.#malformed) {
      this.params = EMPTY_PARAMS
      return MALFORMED
    }
    return handlerFor(node, method)
  }

  // Methods registered on every terminal node matching the path, sorted, with `HEAD`
  // added when `GET` is present. Empty when no route matches the path at all.
  allow(url: string, start: number, end: number): string[] {
    const methods = new Set<string>()
    if (start < end && url.charCodeAt(start) === CHAR_SLASH) {
      this.#collect(this.#root, url, start + 1, end, methods)
    }
    if (methods.has('GET')) methods.add('HEAD')
    return [...methods].sort()
  }

  #staticChild(node: Node<T>, segment: string): Node<T> {
    const key = staticKey(segment)
    let bucket = node.statics.get(key)
    if (bucket === undefined) {
      bucket = []
      node.statics.set(key, bucket)
    }
    let child = bucket.find((candidate) => candidate.segment === segment)
    if (child === undefined) {
      child = createNode(segment, '')
      bucket.push(child)
    }
    return child
  }

  // Tries the children of `node` against the segment starting at `segStart`:
  // static, then param, then wildcard, backtracking on failure.
  #descend(node: Node<T>, method: string, url: string, segStart: number, end: number): Node<T> | undefined {
    let segEnd = segStart
    while (segEnd < end && url.charCodeAt(segEnd) !== CHAR_SLASH) segEnd++
    const last = segEnd === end

    const bucket = node.statics.get(segStart === segEnd ? EMPTY_SEGMENT : url.charCodeAt(segStart))
    if (bucket !== undefined) {
      for (let i = 0; i < bucket.length; i++) {
        const child = bucket[i]!
        if (child.segment.length === segEnd - segStart && url.startsWith(child.segment, segStart)) {
          const found = this.#next(child, method, url, segEnd, last, end)
          if (found !== undefined) return found
          break // segments within a bucket are distinct
        }
      }
    }

    const param = node.param
    if (param !== undefined && segEnd > segStart) {
      const found = this.#next(param, method, url, segEnd, last, end)
      if (found !== undefined) {
        this.#capture(param.name, url, segStart, segEnd)
        return found
      }
    }

    const wildcard = node.wildcard
    if (wildcard !== undefined && handlerFor(wildcard, method) !== undefined) {
      this.#select(wildcard)
      this.#capture('*', url, segStart, end)
      return wildcard
    }
    return undefined
  }

  #next(child: Node<T>, method: string, url: string, segEnd: number, last: boolean, end: number): Node<T> | undefined {
    if (!last) return this.#descend(child, method, url, segEnd + 1, end)
    if (handlerFor(child, method) === undefined) return undefined
    this.#select(child)
    return child
  }

  #select(terminal: Node<T>): void {
    this.params = terminal.hasParams ? {} : EMPTY_PARAMS
  }

  // Runs while unwinding from the selected terminal, so only the selected route is decoded.
  #capture(name: string, url: string, start: number, end: number): void {
    const params = this.params as Record<string, string>
    const raw = url.slice(start, end)
    if (!raw.includes('%')) {
      params[name] = raw
      return
    }
    try {
      params[name] = decodeURIComponent(raw)
    } catch (error) {
      if (!(error instanceof URIError)) throw error
      this.#malformed = true
    }
  }

  #collect(node: Node<T>, url: string, segStart: number, end: number, methods: Set<string>): void {
    let segEnd = segStart
    while (segEnd < end && url.charCodeAt(segEnd) !== CHAR_SLASH) segEnd++
    const last = segEnd === end
    const visit = (child: Node<T>) => {
      if (last) for (const method of child.handlers.keys()) methods.add(method)
      else this.#collect(child, url, segEnd + 1, end, methods)
    }

    const bucket = node.statics.get(segStart === segEnd ? EMPTY_SEGMENT : url.charCodeAt(segStart))
    const child = bucket?.find(
      (candidate) => candidate.segment.length === segEnd - segStart && url.startsWith(candidate.segment, segStart),
    )
    if (child !== undefined) visit(child)
    if (node.param !== undefined && segEnd > segStart) visit(node.param)
    if (node.wildcard !== undefined) for (const method of node.wildcard.handlers.keys()) methods.add(method)
  }
}
