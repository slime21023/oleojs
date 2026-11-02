const NativeRequest = globalThis.Request
const utf8 = new TextDecoder()

/** Ways to obtain a request body; the lazy request uses at most one of them, at most once. */
export interface LazyRequestBody {
  /** The body as a Web stream, for the native Request. */
  readonly stream: () => ReadableStream<Uint8Array>
  /** The whole body, read without a Web stream; may share memory with other buffers. */
  readonly read: () => Promise<Uint8Array>
}

/** What a lazy request needs to answer common reads, and to build the native Request on demand. */
export interface LazyRequestInit {
  /** Already normalized, as `new Request(url).url` would report it. */
  readonly url: string
  /** Already normalized, as `new Request(url, { method }).method` would report it. */
  readonly method: string
  /** Name/value pairs in arrival order; pseudo-headers are skipped. */
  readonly rawHeaders: readonly string[]
  readonly signal: AbortSignal
  /** `null` for a request without a body. */
  readonly body: LazyRequestBody | null
}

/**
 * A Request stand-in for `toNodeListener`'s `lazyRequest` mode. `method`, `url`, and `signal`
 * are plain fields, and `headers` is built on first read. `text()`, `json()`, `arrayBuffer()`,
 * and `bytes()` read the body directly. Every other member builds the native Request once and
 * delegates to it. It inherits from `Request.prototype`, so `instanceof Request`
 * holds, but it lacks the native internal slots: `new Request(request, init)`, `fetch(request)`,
 * and native methods called with it as `this` throw a TypeError.
 */
class LazyRequest {
  readonly #init: LazyRequestInit
  #headers: Headers | undefined
  #native: Request | undefined
  // Whether the body was consumed by a direct read rather than through the native Request.
  #bodyRead = false

  constructor(init: LazyRequestInit) {
    this.#init = init
  }

  get method(): string {
    return this.#init.method
  }

  get url(): string {
    return this.#init.url
  }

  get signal(): AbortSignal {
    return this.#init.signal
  }

  get headers(): Headers {
    if (this.#native !== undefined) return this.#native.headers
    return (this.#headers ??= toHeaders(this.#init.rawHeaders))
  }

  get body(): ReadableStream<Uint8Array> | null {
    return this.#init.body === null ? null : this.#materialize().body
  }

  get bodyUsed(): boolean {
    return this.#bodyRead || (this.#native?.bodyUsed ?? false)
  }

  text(): Promise<string> {
    return this.#readBody().then((bytes) => utf8.decode(bytes))
  }

  json(): Promise<unknown> {
    return this.text().then((text) => JSON.parse(text) as unknown)
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    // Copy: the bytes may be a view into a larger, shared buffer.
    return this.#readBody().then((bytes) => new Uint8Array(bytes).buffer)
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.#readBody().then((bytes) => new Uint8Array(bytes))
  }

  // Read the whole body without a Web stream, unless the native Request already owns it.
  #readBody(): Promise<Uint8Array> {
    const source = this.#init.body
    if (source === null || this.#native !== undefined) return this.#materialize().bytes()
    if (this.#bodyRead) return Promise.reject(new TypeError('Body is unusable: Body has already been read'))
    this.#bodyRead = true
    return source.read()
  }

  #materialize(): Request {
    if (this.#native === undefined) {
      const { url, method, signal, body } = this.#init
      // `duplex` is required by Node for streaming request bodies but missing from the DOM types.
      const init: RequestInit & { duplex: 'half' } = {
        method,
        headers: this.headers,
        // After a direct read, a placeholder body is consumed below so the native request is used too.
        body: body === null ? null : this.#bodyRead ? '' : body.stream(),
        signal,
        duplex: 'half',
      }
      this.#native = new NativeRequest(url, init)
      // Reading starts synchronously, which marks the body used before this returns.
      if (this.#bodyRead) this.#native.arrayBuffer().catch(() => {})
    }
    return this.#native
  }

  static {
    // Delegate every other Request member, including ones added by future Node versions.
    for (const key of Reflect.ownKeys(NativeRequest.prototype)) {
      if (key === 'constructor' || Object.hasOwn(LazyRequest.prototype, key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(NativeRequest.prototype, key)!
      if (descriptor.get !== undefined) {
        Object.defineProperty(LazyRequest.prototype, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get(this: LazyRequest) {
            return Reflect.get(this.#materialize(), key)
          },
        })
      } else if (typeof descriptor.value === 'function') {
        Object.defineProperty(LazyRequest.prototype, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: true,
          value(this: LazyRequest, ...args: unknown[]) {
            const native = this.#materialize()
            return Reflect.apply(descriptor.value as (...args: unknown[]) => unknown, native, args)
          },
        })
      }
    }
    Object.setPrototypeOf(LazyRequest.prototype, NativeRequest.prototype)
  }
}

/** Build Web Headers from Node's raw header list, preserving duplicates and skipping pseudo-headers. */
export function toHeaders(raw: readonly string[]): Headers {
  const headers = new Headers()
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!
    // HTTP/2 pseudo-headers belong to request metadata, not Web Headers.
    if (!name.startsWith(':')) headers.append(name, raw[i + 1]!)
  }
  return headers
}

/** Create a lazy request; see `LazyRequest`. */
export function lazyRequest(init: LazyRequestInit): Request {
  return new LazyRequest(init) as unknown as Request
}

// Methods the Fetch standard uppercases; any other method keeps its case.
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])
const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/**
 * Normalize a method as `new Request(url, { method })` does.
 * @throws {TypeError} If the method is not an HTTP token.
 */
export function normalizeMethod(method: string): string {
  if (NORMALIZED_METHODS.has(method)) return method
  if (!METHOD_TOKEN.test(method)) throw new TypeError(`Invalid method: ${method}`)
  const upper = method.toUpperCase()
  return NORMALIZED_METHODS.has(upper) ? upper : method
}

// Inputs the URL parser returns unchanged: lowercase DNS names or dotted-quad IPv4 with an optional
// port, and origin-form targets without dot segments or characters the parser would percent-encode.
const SIMPLE_HOST = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::[1-9][0-9]{0,4})?$/
const NUMERIC_LAST_LABEL = /(?:^|\.)(?:[0-9]+|0x[0-9a-z]*)(?::[0-9]+)?$/
const IPV4_OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
const CANONICAL_IPV4 = new RegExp(`^(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}(?::[0-9]+)?$`)
const SIMPLE_TARGET = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@%/?]*$/
const DEFAULT_PORTS: Readonly<Record<string, string>> = { http: '80', https: '443' }

/**
 * Return the URL `new Request(url).url` would report for an origin-form target, or for an
 * absolute-form target when `host` is `undefined`. Common inputs are joined without parsing.
 * @throws {TypeError} If the URL is invalid or includes credentials, as `new Request` would.
 */
export function normalizeUrl(scheme: string, host: string | undefined, target: string): string {
  if (host !== undefined && isSimple(scheme, host, target)) return `${scheme}://${host}${target}`
  const url = new URL(host === undefined ? target : `${scheme}://${host}${target}`)
  if (url.username !== '' || url.password !== '') throw new TypeError('Request URL must not include credentials')
  return url.href
}

function isSimple(scheme: string, host: string, target: string): boolean {
  // Other schemes follow different parsing rules, such as keeping the host's case.
  if (DEFAULT_PORTS[scheme] === undefined) return false
  if (!SIMPLE_HOST.test(host)) return false
  if (NUMERIC_LAST_LABEL.test(host) && !CANONICAL_IPV4.test(host)) return false
  const colon = host.indexOf(':')
  if (colon !== -1) {
    const port = host.slice(colon + 1)
    if (port === DEFAULT_PORTS[scheme] || Number(port) > 65535) return false
  }
  if (!SIMPLE_TARGET.test(target)) return false
  return !target.includes('/.') && !target.includes('%2e') && !target.includes('%2E')
}
