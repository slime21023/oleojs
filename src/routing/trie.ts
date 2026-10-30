import { EMPTY_PARAMS } from '../context-defaults.ts'
import { invalidPattern as invalid, parsePattern } from './pattern.ts'
import type { Params } from '../types.ts'

const CHAR_SLASH = 47
const EMPTY_SEGMENT = -1

/** A selected route contains malformed percent escapes or invalid UTF-8 in its parameters. */
export const MALFORMED: unique symbol = Symbol('malformed')

// A uniform node shape keeps property access consistent across static and dynamic branches.
interface Node<T> {
  readonly segment: string // static nodes: the canonical segment text
  readonly name: string // param nodes: the parameter name; wildcard nodes: '*'
  readonly statics: Map<number, Node<T>[]> // first-code-unit buckets avoid allocating segment keys
  param: Node<T> | undefined
  wildcard: Node<T> | undefined
  readonly handlers: Map<string, T>
  hasParams: boolean // terminal nodes: whether the full pattern captures parameters
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

/** Segment trie with method-aware matching and reusable state for the current match. */
export class Trie<T> {
  readonly #root = createNode<T>('', '')
  #malformed = false

  /** Last match's parameters; read before invoking user code that could match again. */
  params: Params = EMPTY_PARAMS

  /** Insert a route, rejecting invalid patterns and conflicts with earlier definitions. */
  insert(method: string, pattern: string, value: T): readonly string[] {
    const segments = parsePattern(pattern)
    let node = this.#root
    let hasParams = false
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      if (segment === '*') {
        node.wildcard ??= createNode('', '*')
        node = node.wildcard
        hasParams = true
      } else if (segment.startsWith(':')) {
        const name = segment.slice(1)
        if (node.param !== undefined && node.param.name !== name) {
          throw invalid(pattern, `":${name}" conflicts with ":${node.param.name}" at the same position`)
        }
        node.param ??= createNode('', name)
        node = node.param
        hasParams = true
      } else {
        node = this.#staticChild(node, segment)
      }
    }
    if (node.handlers.has(method)) throw invalid(pattern, `duplicate route for ${method}`)
    node.handlers.set(method, value)
    node.hasParams = hasParams
    return segments
  }

  /**
   * Match the raw path `url[start, end)` for `method`, updating {@link Trie.params}.
   * Return the selected value, {@link MALFORMED} for failed parameter decoding,
   * or `undefined` when no route accepts the request. HEAD may use a GET handler.
   */
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

  /**
   * Collect sorted methods across all matching paths without decoding parameters.
   * Include HEAD when GET is present; return an empty list if no path matches.
   */
  allow(url: string, start: number, end: number): string[] {
    const methods = new Set<string>()
    if (start < end && url.charCodeAt(start) === CHAR_SLASH) {
      this.#collectAllowedMethods(this.#root, url, start + 1, end, methods)
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

  // Search static, param, then wildcard; a path match without this method must backtrack.
  #descend(node: Node<T>, method: string, url: string, segStart: number, end: number): Node<T> | undefined {
    let segEnd = segStart
    while (segEnd < end && url.charCodeAt(segEnd) !== CHAR_SLASH) segEnd++
    const last = segEnd === end

    const bucket = node.statics.get(segStart === segEnd ? EMPTY_SEGMENT : url.charCodeAt(segStart))
    if (bucket !== undefined) {
      for (let i = 0; i < bucket.length; i++) {
        const child = bucket[i]!
        if (child.segment.length === segEnd - segStart && url.startsWith(child.segment, segStart)) {
          const found = this.#matchChild(child, method, url, segEnd, last, end)
          if (found !== undefined) return found
          break // segments within a bucket are distinct
        }
      }
    }

    const param = node.param
    if (param !== undefined && segEnd > segStart) {
      const found = this.#matchChild(param, method, url, segEnd, last, end)
      if (found !== undefined) {
        this.#capture(param.name, url, segStart, segEnd)
        return found
      }
    }

    const wildcard = node.wildcard
    if (wildcard !== undefined && handlerFor(wildcard, method) !== undefined) {
      this.#initializeParams(wildcard)
      this.#capture('*', url, segStart, end)
      return wildcard
    }
    return undefined
  }

  #matchChild(child: Node<T>, method: string, url: string, segEnd: number, last: boolean, end: number): Node<T> | undefined {
    if (!last) return this.#descend(child, method, url, segEnd + 1, end)
    if (handlerFor(child, method) === undefined) return undefined
    this.#initializeParams(child)
    return child
  }

  #initializeParams(terminal: Node<T>): void {
    // Parameter names such as __proto__ must be ordinary own properties.
    this.params = terminal.hasParams ? Object.create(null) : EMPTY_PARAMS
  }

  // Decode while unwinding the selected route so failed branches cannot leak captures or errors.
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

  #collectAllowedMethods(node: Node<T>, url: string, segStart: number, end: number, methods: Set<string>): void {
    let segEnd = segStart
    while (segEnd < end && url.charCodeAt(segEnd) !== CHAR_SLASH) segEnd++
    const last = segEnd === end
    const visit = (child: Node<T>) => {
      if (last) for (const method of child.handlers.keys()) methods.add(method)
      else this.#collectAllowedMethods(child, url, segEnd + 1, end, methods)
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
