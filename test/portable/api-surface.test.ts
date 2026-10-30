// The value exports of each portable entry point. Changing this list is a public API decision
// (CONTRIBUTING.md, Package manifest); type exports are reviewed alongside it.
import { describe, expect, it } from 'vitest'

const surfaces = {
  'oleo.js': {
    load: () => import('../../src/index.ts'),
    names: [
      'compose', 'contextKey', 'del', 'get', 'group', 'head', 'inspectRoutes', 'options', 'patch',
      'post', 'put', 'route', 'router', 'routesFor', 'toFetch', 'withFilters', 'withRouteCheck',
    ],
  },
  'oleo.js/filters': {
    load: () => import('../../src/filters/index.ts'),
    names: ['bearerAuth', 'bodyLimit', 'cors', 'mapRequest', 'mapResponse', 'problemDetails', 'requestLogger', 'responseHeaders'],
  },
  'oleo.js/contract': {
    load: () => import('../../src/contract/index.ts'),
    names: ['contract', 'contractFor', 'toOpenApi'],
  },
}

describe('public value exports', () => {
  it.each(Object.entries(surfaces))('%s exports exactly the reviewed names', async (_entry, { load, names }) => {
    expect(Object.keys(await load()).sort()).toEqual([...names].sort())
  })
})
