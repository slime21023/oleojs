const NativeResponse = globalThis.Response

// Statuses whose responses the Fetch standard forbids a body for.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])
// RFC 9110 reason-phrase characters, as the Response constructor checks them.
const REASON_PHRASE = /^[\t\x20-\x7e\x80-\xff]*$/
const BEYOND_BYTE = /[Ā-￿]/
const TEXT_TYPE = 'text/plain;charset=UTF-8'
const JSON_TYPE = 'application/json'

/** What `toNodeListener` writes for an unread `FastResponse`. */
export interface FastResponseParts {
  readonly status: number
  readonly statusText: string
  /** `undefined` when the response has no headers beyond its default Content-Type. */
  readonly headers: Headers | undefined
  readonly contentType: string | undefined
  readonly body: string | Uint8Array | null
}

let partsOf: (value: unknown) => FastResponseParts | undefined

// Web IDL `unsigned short` conversion, which the Response constructor applies to `status`.
function toUnsignedShort(value: unknown): number {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? ((number % 65536) + 65536) % 65536 : 0
}

/** Implementation of `FastResponse`; see its declaration below. */
class FastResponseImpl {
  readonly #body: BodyInit | null
  readonly #status: number
  readonly #statusText: string
  #contentType: string | undefined
  // Whether the headers' Content-Type is the constructor's default rather than the caller's.
  #contentTypeDefaulted = false
  #headers: Headers | undefined
  #native: Response | undefined

  /**
   * @throws {RangeError} If the status is outside 200–599.
   * @throws {TypeError} If the status text or headers are invalid, or a null-body status has a body.
   */
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    const status = init?.status === undefined ? 200 : toUnsignedShort(init.status)
    const statusText = init?.statusText === undefined ? '' : String(init.statusText)
    // Checks run in the Response constructor's order, so the same input throws the same error.
    if (BEYOND_BYTE.test(statusText)) throw new TypeError('Response status text must be a ByteString')
    if (status < 200 || status > 599) {
      throw new RangeError(`Response status must be between 200 and 599, got ${status}`)
    }
    if (!REASON_PHRASE.test(statusText)) throw new TypeError('Invalid response status text')
    // Building Headers validates them now, as the Response constructor would.
    if (init?.headers !== undefined) this.#headers = new Headers(init.headers)
    this.#body = body ?? null
    if (this.#body !== null && NULL_BODY_STATUSES.has(status)) {
      throw new TypeError(`Response with status ${status} cannot have a body`)
    }
    this.#status = status
    this.#statusText = statusText
    if (typeof this.#body === 'string') this.#setDefaultContentType(TEXT_TYPE)
  }

  // Add a Content-Type the headers lack, as the Response constructor does. Without Headers yet,
  // it is kept aside so a response nobody inspects needs no Headers object.
  #setDefaultContentType(type: string): void {
    if (this.#headers === undefined) this.#contentType = type
    else if (!this.#headers.has('content-type')) {
      this.#headers.set('content-type', type)
      this.#contentTypeDefaulted = true
    }
  }

  /**
   * Serialize `data` as JSON, as `Response.json()` does.
   * @throws {TypeError} If `data` cannot be serialized.
   */
  static json(data: unknown, init?: ResponseInit): Response {
    const text = JSON.stringify(data)
    if (text === undefined) throw new TypeError('Value is not JSON serializable')
    const response = new FastResponseImpl(text, init)
    // Replace the constructor's text default; a caller's Content-Type stays.
    if (response.#contentType !== undefined) response.#contentType = JSON_TYPE
    else if (response.#contentTypeDefaulted) response.#headers!.set('content-type', JSON_TYPE)
    return response as unknown as Response
  }

  get status(): number {
    return this.#status
  }

  get statusText(): string {
    return this.#statusText
  }

  get ok(): boolean {
    return this.#status >= 200 && this.#status < 300
  }

  get headers(): Headers {
    if (this.#native !== undefined) return this.#native.headers
    if (this.#headers === undefined) {
      this.#headers = new Headers()
      if (this.#contentType !== undefined) this.#headers.set('content-type', this.#contentType)
    }
    return this.#headers
  }

  #materialize(): Response {
    this.#native ??= new NativeResponse(this.#body, {
      status: this.#status,
      statusText: this.#statusText,
      headers: this.headers,
    })
    return this.#native
  }

  static {
    partsOf = (value) => {
      if (typeof value !== 'object' || value === null || !(#body in value) || value.#native !== undefined) return undefined
      const body = value.#body
      if (body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) return undefined
      return {
        status: value.#status,
        statusText: value.#statusText,
        headers: value.#headers,
        // A Content-Type the headers getter would add is written without building Headers.
        contentType: value.#headers === undefined ? value.#contentType : undefined,
        body,
      }
    }

    // Delegate every other Response member, including ones added by future Node versions.
    for (const key of Reflect.ownKeys(NativeResponse.prototype)) {
      if (key === 'constructor' || Object.hasOwn(FastResponseImpl.prototype, key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(NativeResponse.prototype, key)!
      if (descriptor.get !== undefined) {
        Object.defineProperty(FastResponseImpl.prototype, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get(this: FastResponseImpl) {
            return Reflect.get(this.#materialize(), key)
          },
        })
      } else if (typeof descriptor.value === 'function') {
        Object.defineProperty(FastResponseImpl.prototype, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: true,
          value(this: FastResponseImpl, ...args: unknown[]) {
            const native = this.#materialize()
            return Reflect.apply(descriptor.value as (...args: unknown[]) => unknown, native, args)
          },
        })
      }
    }
    Object.setPrototypeOf(FastResponseImpl.prototype, NativeResponse.prototype)
  }
}

/**
 * A Response for Node.js applications that `toNodeListener` writes without a body stream:
 * one `end()` call with Content-Length. Supported bodies are strings, `Uint8Array`s, and `null`;
 * `FastResponse.json()` is also supported. Status, status text, and headers are validated
 * as the Response constructor validates them.
 *
 * It inherits from `Response.prototype`, so `instanceof Response` holds. `status`, `statusText`,
 * `ok`, and `headers` are plain reads; any other member, such as `body` or `text()`, builds the
 * native Response once and delegates to it, after which the adapter writes it as a native
 * response. It lacks native internal slots, so native methods called with it as `this` throw a
 * TypeError. Only `oleojs/node` recognizes it; portable code should use `Response`.
 */
export const FastResponse = FastResponseImpl as unknown as FastResponseConstructor

/** Constructor type of `FastResponse`: instances are typed as `Response`. */
export interface FastResponseConstructor {
  new (body?: BodyInit | null, init?: ResponseInit): Response
  readonly prototype: Response
  /**
   * Serialize `data` as JSON, as `Response.json()` does.
   * @throws {TypeError} If `data` cannot be serialized.
   */
  json(data: unknown, init?: ResponseInit): Response
}

/** The parts to write for an unread FastResponse with a supported body, or `undefined` otherwise. */
export function fastResponseParts(response: Response): FastResponseParts | undefined {
  return partsOf(response)
}
