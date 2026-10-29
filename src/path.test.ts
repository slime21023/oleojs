import { describe, expect, it } from 'vitest'
import { pathEnd, pathStart } from './path.ts'

function path(url: string): string {
  const start = pathStart(url)
  return url.slice(start, pathEnd(url, start))
}

describe('path extraction', () => {
  it('extracts the path from request URLs', () => {
    expect(path(new Request('http://example.test/a/b?q=1#f').url)).toBe('/a/b')
    expect(path(new Request('http://example.test').url)).toBe('/')
    expect(path(new Request('https://example.test:8080/a/').url)).toBe('/a/')
  })

  it('skips userinfo and port in the authority', () => {
    expect(path('https://user:pw@example.test:8080/a/')).toBe('/a/')
  })

  it('stops at the first ? or #', () => {
    expect(path('http://example.test/a?b/c')).toBe('/a')
    expect(path('http://example.test/a#b/c')).toBe('/a')
    expect(path('http://example.test/a?b#c')).toBe('/a')
  })

  it('does not mistake a / in the query for the path', () => {
    expect(path('foo://host?a=/b')).toBe('')
    expect(path('foo://host#/b')).toBe('')
  })

  it('returns an empty path for URLs without an authority or path', () => {
    expect(path('foo://host')).toBe('')
    expect(path('mailto:someone@example.test')).toBe('')
  })
})
