import { describe, expect, it } from 'vitest'
import { pathEnd, pathStart } from './path.ts'
import { EMPTY_PARAMS, MALFORMED, Trie } from './trie.ts'

type Routes = Array<[method: string, pattern: string]>

function build(routes: Routes): Trie<string> {
  const trie = new Trie<string>()
  for (const [method, pattern] of routes) trie.insert(method, pattern, `${method} ${pattern}`)
  return trie
}

function bounds(path: string) {
  const url = new Request(`http://example.test${path}`).url
  const start = pathStart(url)
  return { url, start, end: pathEnd(url, start) }
}

function match(trie: Trie<string>, method: string, path: string) {
  const { url, start, end } = bounds(path)
  const handler = trie.match(method, url, start, end)
  return { handler, params: trie.params }
}

function allow(trie: Trie<string>, path: string) {
  const { url, start, end } = bounds(path)
  return trie.allow(url, start, end)
}

describe('matching', () => {
  it('matches static routes with the shared empty params object', () => {
    const trie = build([['GET', '/users'], ['GET', '/']])
    expect(match(trie, 'GET', '/users')).toEqual({ handler: 'GET /users', params: {} })
    expect(match(trie, 'GET', '/users').params).toBe(EMPTY_PARAMS)
    expect(match(trie, 'GET', '/').handler).toBe('GET /')
  })

  it('captures params and the wildcard remainder', () => {
    const trie = build([['GET', '/users/:id/files/*']])
    expect(match(trie, 'GET', '/users/42/files/a/b.txt')).toEqual({
      handler: 'GET /users/:id/files/*',
      params: { id: '42', '*': 'a/b.txt' },
    })
  })

  it('lets the wildcard match an empty remainder but not a missing one', () => {
    const trie = build([['GET', '/files/*']])
    expect(match(trie, 'GET', '/files/').params).toEqual({ '*': '' })
    expect(match(trie, 'GET', '/files/a/b').params).toEqual({ '*': 'a/b' })
    expect(match(trie, 'GET', '/files').handler).toBeUndefined()
  })

  it('prefers static over param over wildcard regardless of registration order', () => {
    const trie = build([['GET', '/a/*'], ['GET', '/a/:x'], ['GET', '/a/b']])
    expect(match(trie, 'GET', '/a/b').handler).toBe('GET /a/b')
    expect(match(trie, 'GET', '/a/c').handler).toBe('GET /a/:x')
    expect(match(trie, 'GET', '/a/c/d').handler).toBe('GET /a/*')
  })

  it('backtracks from a failed static branch to the param branch', () => {
    const trie = build([['GET', '/a/b/d'], ['GET', '/a/:x/c']])
    expect(match(trie, 'GET', '/a/b/c')).toEqual({ handler: 'GET /a/:x/c', params: { x: 'b' } })
  })

  it('backtracks when a matching path does not accept the method', () => {
    const trie = build([['POST', '/users/me'], ['GET', '/users/:id']])
    expect(match(trie, 'GET', '/users/me')).toEqual({ handler: 'GET /users/:id', params: { id: 'me' } })
    expect(match(trie, 'POST', '/users/me').handler).toBe('POST /users/me')
  })

  it('falls back from HEAD to GET, preferring an explicit HEAD route', () => {
    const trie = build([['GET', '/a'], ['GET', '/b'], ['HEAD', '/b']])
    expect(match(trie, 'HEAD', '/a').handler).toBe('GET /a')
    expect(match(trie, 'HEAD', '/b').handler).toBe('HEAD /b')
  })

  it('treats trailing slashes and case as significant', () => {
    const trie = build([['GET', '/users'], ['GET', '/Admin/']])
    expect(match(trie, 'GET', '/users/').handler).toBeUndefined()
    expect(match(trie, 'GET', '/Users').handler).toBeUndefined()
    expect(match(trie, 'GET', '/Admin/').handler).toBe('GET /Admin/')
    expect(match(trie, 'GET', '/Admin').handler).toBeUndefined()
  })

  it('never matches an empty segment with a param or static segment', () => {
    const trie = build([['GET', '/a/:x/b'], ['GET', '/users/:id']])
    expect(match(trie, 'GET', '/a//b').handler).toBeUndefined()
    expect(match(trie, 'GET', '/users/').handler).toBeUndefined()
  })

  it('ignores the query string and fragment', () => {
    const trie = build([['GET', '/a/:x']])
    expect(match(trie, 'GET', '/a/b?c=/d#e')).toEqual({ handler: 'GET /a/:x', params: { x: 'b' } })
  })
})

describe('percent-encoding', () => {
  it('matches static patterns against the canonical request form', () => {
    expect(match(build([['GET', '/café']]), 'GET', '/café').handler).toBe('GET /café')
    expect(match(build([['GET', '/caf%C3%A9']]), 'GET', '/café').handler).toBe('GET /caf%C3%A9')
    expect(match(build([['GET', '/a b']]), 'GET', '/a%20b').handler).toBe('GET /a b')
  })

  it('decodes param values after segmentation', () => {
    const trie = build([['GET', '/users/:id'], ['GET', '/files/*']])
    expect(match(trie, 'GET', '/users/a%20b').params).toEqual({ id: 'a b' })
    expect(match(trie, 'GET', '/users/a%2Fb').params).toEqual({ id: 'a/b' })
    expect(match(trie, 'GET', '/files/a%2Fb/c%20d').params).toEqual({ '*': 'a/b/c d' })
  })

  it('reports malformed encoding in the selected route', () => {
    const trie = build([['GET', '/users/:id']])
    expect(match(trie, 'GET', '/users/%E0%A4%A')).toEqual({ handler: MALFORMED, params: {} })
  })

  it('does not decode routes that were not selected', () => {
    const trie = build([['GET', '/a/:x/b'], ['POST', '/a/:x/c']])
    expect(match(trie, 'GET', '/a/%ZZ/c').handler).toBeUndefined()
    expect(allow(trie, '/a/%ZZ/c')).toEqual(['POST'])
  })
})

describe('allowed methods', () => {
  it('unions the methods of every path-matching route', () => {
    const trie = build([['GET', '/users/:id'], ['DELETE', '/users/me'], ['POST', '/users/*'], ['PUT', '/other']])
    expect(allow(trie, '/users/me')).toEqual(['DELETE', 'GET', 'HEAD', 'POST'])
  })

  it('is empty when no route matches the path', () => {
    expect(allow(build([['GET', '/users']]), '/nope')).toEqual([])
  })
})

describe('route definition errors', () => {
  it.each([
    ['users', 'must start with "/"'],
    ['/u/:id/a', '":userId" conflicts', '/u/:userId/b'],
    ['/a/*/b', '"*" must be the last segment'],
    ['/a//b', 'empty segment'],
    ['/a:b', '":" and "*" must form a whole segment'],
    ['/files/a*', '":" and "*" must form a whole segment'],
    ['/:id?', 'not a valid parameter'],
    ['/:', 'not a valid parameter'],
    ['/a(b)', 'unsupported URLPattern syntax'],
    ['/a{b}', 'unsupported URLPattern syntax'],
    ['/a+', 'unsupported URLPattern syntax'],
    ['/a\\b', 'unsupported URLPattern syntax'],
    ['/a/../b', 'dot segment'],
    ['/a/%2e', 'dot segment'],
  ])('rejects %s', (pattern, message, earlier?: string) => {
    const trie = new Trie<string>()
    if (earlier !== undefined) {
      trie.insert('GET', earlier, '')
      expect(() => trie.insert('GET', pattern, '')).toThrow(message.replace('":userId"', '":id"'))
      return
    }
    expect(() => trie.insert('GET', pattern, '')).toThrow(TypeError)
    expect(() => trie.insert('GET', pattern, '')).toThrow(message)
  })

  it('rejects a duplicate method and pattern', () => {
    const trie = build([['GET', '/users/:id']])
    expect(() => trie.insert('GET', '/users/:id', '')).toThrow('duplicate route for GET')
    expect(() => trie.insert('POST', '/users/:id', '')).not.toThrow()
  })

  it('treats equivalent encodings as the same pattern', () => {
    const trie = build([['GET', '/café']])
    expect(() => trie.insert('GET', '/caf%C3%A9', '')).toThrow('duplicate route for GET')
  })
})
