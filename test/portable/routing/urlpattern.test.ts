// Differential tests for the URLPattern subset guarantee (docs/project-reference.md, Pattern syntax):
// every accepted pattern matches exactly the paths `new URLPattern({ pathname })` matches,
// with the same parameter values once URLPattern's are decoded and its `'0'` is named `'*'`.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pathEnd, pathStart } from '../../../src/path.ts'
import { MALFORMED, Trie } from '../../../src/routing/trie.ts'
import { PROPERTY_OPTIONS, paramNameArbitrary, paramValueArbitrary, staticSegmentArbitrary } from '../arbitraries.ts'

const PATTERNS = [
  '/',
  '/users',
  '/users/',
  '/Users',
  '/users/:id',
  '/users/:__proto__',
  '/users/:constructor',
  '/users/:toString',
  '/users/:id/',
  '/users/:id/posts/:postId',
  '/:name',
  '/:$id/:_x',
  '/ünï/:ç',
  '/files/*',
  '/a/:x/*',
  '/*',
  '/café',
  '/caf%C3%A9',
  '/a b',
  '/100%',
  '/a%2Fb',
  '/a-b_c.d~e',
  "/a!$&',;=@",
  '/a^b',
  '/a|b',
  '/a`b',
  '/a[b]',
  '/a"b',
  '/a<b>',
  '/a#b',
]

const PATHS = [
  '/',
  '//',
  '/users',
  '/users/',
  '/users//',
  '/USERS',
  '/Users',
  '/users/42',
  '/users/42/',
  '/users/42/posts/7',
  '/users/42/posts/7/',
  '/users/a%20b',
  '/users/a%2Fb',
  '/users/%E0%A4%A',
  '/x/y',
  '/ünï/ç',
  '/%C3%BCn%C3%AF/%C3%A7',
  '/files',
  '/files/',
  '/files/a/b.txt',
  '/a/x',
  '/a/x/',
  '/a/x/y/z',
  '/café',
  '/caf%C3%A9',
  '/CAF%C3%A9',
  '/a b',
  '/a%20b',
  '/100%',
  '/100%25',
  '/a%2Fb',
  '/a/b',
  '/a-b_c.d~e',
  "/a!$&',;=@",
  '/a^b',
  '/a|b',
  '/a`b',
  '/a[b]',
  '/a"b',
  '/a<b>',
  '/a%23b',
]

function viaOleo(pattern: string, url: string) {
  const trie = new Trie<true>()
  trie.insert('GET', pattern, true)
  const start = pathStart(url)
  const handler = trie.match('GET', url, start, pathEnd(url, start))
  if (handler === undefined) return { matched: false }
  if (handler === MALFORMED) return { matched: true, malformed: true }
  return { matched: true, params: { ...trie.params } }
}

function viaUrlPattern(pattern: string, url: string) {
  // workerd drops a capture named __proto__. Rename reference captures without
  // changing the matching language, then restore the original names as own keys.
  const names = new Map<string, string>()
  const referencePattern = pattern.replace(/:([^/]+)/g, (_match, name: string) => {
    const alias = `p${names.size}`
    names.set(alias, name)
    return `:${alias}`
  })
  const result = new URLPattern({ pathname: referencePattern }).exec(url)
  expect(new URLPattern({ pathname: pattern }).test(url)).toBe(result !== null)
  if (result === null) return { matched: false }
  const entries: [string, string][] = []
  for (const [name, value] of Object.entries(result.pathname.groups)) {
    if (value === undefined) continue
    try {
      entries.push([name === '0' ? '*' : names.get(name) ?? name, decodeURIComponent(value)])
    } catch {
      return { matched: true, malformed: true }
    }
  }
  return { matched: true, params: Object.fromEntries(entries) }
}

const cases = PATTERNS.flatMap((pattern) => PATHS.map((path) => [pattern, path] as const))

describe.skipIf(typeof URLPattern === 'undefined')('URLPattern subset', () => {
  it('agrees on generated matching, nonmatching and malformed paths', () => {
    fc.assert(fc.property(
      fc.array(staticSegmentArbitrary, { minLength: 1, maxLength: 4 }),
      paramNameArbitrary, paramValueArbitrary, fc.boolean(),
      fc.array(paramValueArbitrary, { maxLength: 3 }),
      (segments, name, value, wildcard, tail) => {
        const pattern = `/${segments.join('/')}/:${name}${wildcard ? '/*' : ''}`
        const prefix = `/${segments.map(encodeURIComponent).join('/')}`
        const suffix = wildcard ? `/${tail.map(encodeURIComponent).join('/')}` : ''
        const matching = `${prefix}/${encodeURIComponent(value)}${suffix}`
        const paths = [matching, `/missing${matching}`, `${prefix}/%ZZ${suffix}`, `${prefix}//${suffix}`]
        for (const path of paths) {
          const url = new Request(`https://test${path}`).url
          const expected = viaUrlPattern(pattern, url)
          if (path === matching) expect(expected.matched).toBe(true)
          expect(viaOleo(pattern, url)).toEqual(expected)
        }
      },
    ), PROPERTY_OPTIONS)
  })

  it.each(PATTERNS)('accepts %j as a valid URLPattern', (pattern) => {
    expect(() => new URLPattern({ pathname: pattern })).not.toThrow()
  })

  // URLPattern rejects duplicate group names, so oleo must reject them too.
  it('rejects duplicate parameter names, as URLPattern does', () => {
    expect(() => new URLPattern({ pathname: '/:id/x/:id' })).toThrow(TypeError)
    expect(() => new Trie().insert('GET', '/:id/x/:id', true)).toThrow(TypeError)
  })

  it.each(cases)('%j matches %j as URLPattern does', (pattern, path) => {
    const url = new Request(`http://example.test${path}`).url
    expect(viaOleo(pattern, url)).toEqual(viaUrlPattern(pattern, url))
  })
})
