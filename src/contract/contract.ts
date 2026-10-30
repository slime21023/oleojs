import { route, setRouteValidation } from '../routing/route.ts'
import type { Route } from '../routing/route.ts'
import type { JoinParams, Params, ParamsOf } from '../types.ts'
import { snapshotDefinition } from './definition.ts'
import type { ContractDefinition, ContractHandler, ContractInput, ContractRequest } from './types.ts'
import { validateInput } from './validate.ts'

const definitions = new WeakMap<object, ContractDefinition>()

export function getContractDefinition(route: object): ContractDefinition | undefined {
  return definitions.get(route)
}

/**
 * Define a route with validated inputs and documentation. Filters still wrap ordinary handlers.
 * Input failures produce 400/415/422 problems; validator exceptions propagate. Responses are not validated.
 * Configuration containers are snapshotted; schema objects remain owned by the application.
 */
export function contract<
  E = unknown, const P extends string = string, const R extends ContractRequest = {}, TBase extends Params = {},
>(
  definition: ContractDefinition<P, R>,
  handler: ContractHandler<E, JoinParams<NoInfer<TBase>, ParamsOf<P>>, NoInfer<R>>,
): Route<E, TBase> {
  if (typeof handler !== 'function') throw new TypeError('contract() expects a handler')
  const snapshot = snapshotDefinition(definition)
  const result = route<E, P, TBase>(snapshot.method, snapshot.path, async (req, ctx) => {
    const validation = await validateInput(snapshot.request ?? {}, req, ctx)
    if (validation.response !== undefined) return validation.response
    // Each declared source and field has been validated with the corresponding schema above.
    return handler(req, ctx, validation.input as ContractInput<R>)
  })
  definitions.set(result, snapshot)
  setRouteValidation(result, (segments) => {
    const names = new Set(segments.filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1)))
    if (segments.includes('*')) names.add('*')
    for (const name of Object.keys(snapshot.request?.params ?? {})) {
      if (!names.has(name)) throw new TypeError(`Contract parameter "${name}" is absent from the full route pattern`)
    }
  })
  return result
}
