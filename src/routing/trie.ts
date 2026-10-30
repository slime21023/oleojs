import { EMPTY_PARAMS } from '../context-defaults.ts'
import { invalidPattern as invalid, parsePattern } from './pattern.ts'
import type { Params } from '../types.ts'

const CHAR_SLASH = 47
const EMPTY_SEGMENT = -1
const NO_NAMES: readonly string[] = Object.freeze([])

/** A selected route contains malformed percent escapes or invalid UTF-8 in its parameters. */
export const MALFORMED: unique symbol = Symbol('malformed')

// A uniform node shape keeps property access consistent across static and dynamic branches.
interface Node<T> {
  readonly segment: string // static nodes: the canonical segment text
  readonly statics: Map<number, Node<T>[]> // first-code-unit buckets avoid allocating segment keys
  param: Node<T> | undefined
  wildcard: Node<T> | undefined
  readonly handlers: Map<string, T>
  // Terminal nodes: parameter names in path order ('*' for a wildcard), shared by every method.
  // Names belong to routes rather than positions, so diverging routes may name a position differently.
  paramNames: readonly string[] | undefined
}

function createNode<T>(segment: string): Node<T> {
  return {
    segment,
    statics: new Map(),
    param: undefined,
    wildcard: undefined,
    handlers: new Map(),
    paramNames: undefined,
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
  readonly #root = createNode<T>('')
  #malformed = false
  // The selected route's names and the next capture slot; captures arrive from the last segment back.
  #names: readonly string[] = []
  #nameIndex = 0

  /** Last match's parameters; read before invoking user code that could match again. */
  params: Params = EMPTY_PARAMS

  /** Insert a route, rejecting invalid patterns and conflicts with earlier definitions. */
  insert(method: string, pattern: string, value: T): readonly string[] {
    const segments = parsePattern(pattern)
    let node = this.#root
    const names: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      if (segment === '*') {
        node.wildcard ??= createNode('')
        node = node.wildcard
        names.push('*')
      } else if (segment.startsWith(':')) {
        node.param ??= createNode('')
        node = node.param
        names.push(segment.slice(1))
      } else {
        node = this.#staticChild(node, segment)
      }
    }
    // Routes ending at the same node describe one path, so their parameter names must agree.
    const existing = node.paramNames
    if (existing !== undefined) {
      const conflict = names.findIndex((name, index) => name !== existing[index])
      if (conflict !== -1) {
        throw invalid(pattern, `":${names[conflict]}" conflicts with ":${existing[conflict]}" at the same position`)
      }
    }
    if (node.handlers.has(method)) throw invalid(pattern, `duplicate route for ${method}`)
    node.handlers.set(method, value)
    node.paramNames ??= Object.freeze(names)
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
      child = createNode(segment)
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
        this.#capture(url, segStart, segEnd)
        return found
      }
    }

    const wildcard = node.wildcard
    if (wildcard !== undefined && handlerFor(wildcard, method) !== undefined) {
      this.#initializeParams(wildcard)
      this.#capture(url, segStart, end)
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
    // Only nodes with handlers are selected, and inserting a handler always records the names.
    const names = terminal.paramNames ?? NO_NAMES
    this.#names = names
    this.#nameIndex = names.length
    // Parameter names such as __proto__ must be ordinary own properties.
    this.params = names.length > 0 ? Object.create(null) : EMPTY_PARAMS
  }

  // Decode while unwinding the selected route so failed branches cannot leak captures or errors.
  // Unwinding visits the last segment first, so the selected route's names are consumed in reverse.
  #capture(url: string, start: number, end: number): void {
    const name = this.#names[--this.#nameIndex]!
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
