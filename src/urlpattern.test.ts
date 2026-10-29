// Differential tests for the URLPattern subset guarantee (AGENTS.md, Pattern syntax):
// every accepted pattern matches exactly the paths `new URLPattern({ pathname })` matches,
// with the same parameter values once URLPattern's are decoded and its `'0'` is named `'*'`.
import { describe, expect, it } from 'vitest'
import { pathEnd, pathStart } from './path.ts'
import { MALFORMED, Trie } from './trie.ts'

const PATTERNS = [
  '/',
  '/users',
  '/users/',
  '/Users',
  '/users/:id',
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
  const result = new URLPattern({ pathname: pattern }).exec(url)
  if (result === null) return { matched: false }
  const params: Record<string, string> = {}
  for (const [name, value] of Object.entries(result.pathname.groups)) {
    if (value === undefined) continue
    try {
      params[name === '0' ? '*' : name] = decodeURIComponent(value)
    } catch {
      return { matched: true, malformed: true }
    }
  }
  return { matched: true, params }
}

const cases = PATTERNS.flatMap((pattern) => PATHS.map((path) => [pattern, path] as const))

describe.skipIf(typeof URLPattern === 'undefined')('URLPattern subset', () => {
  it.each(PATTERNS)('accepts %j as a valid URLPattern', (pattern) => {
    expect(() => new URLPattern({ pathname: pattern })).not.toThrow()
  })

  it.each(cases)('%j matches %j as URLPattern does', (pattern, path) => {
    const url = new Request(`http://example.test${path}`).url
    expect(viaOleo(pattern, url)).toEqual(viaUrlPattern(pattern, url))
  })
})
