// Verifies the runtime assumptions the core relies on (see docs/project-reference.md, Routing > Path extraction).
import { describe, expect, it } from 'vitest'

describe('runtime baseline', () => {
  it('provides the ECMA-429 APIs the core uses', () => {
    for (const api of [Request, Response, Headers, ReadableStream, AbortController]) {
      expect(typeof api).toBe('function')
    }
  })

  it('serializes request.url as an absolute, WHATWG-normalized URL', () => {
    const { url } = new Request('http://example.test/a/../b/café?q=1')
    expect(url).toBe('http://example.test/b/caf%C3%A9?q=1')
  })

  it('upper-cases standard methods', () => {
    expect(new Request('http://example.test/', { method: 'post' }).method).toBe('POST')
  })
})
