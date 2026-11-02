# Contracts

`contract(definition, handler)` returns an ordinary Route. The handler receives `(request, ctx, input)`, where `input` contains only the declared sources, after validation and transformation. Schemas implement [Standard Schema](https://standardschema.dev/); the application chooses its validation library and rules.

```ts
import { group, router, toFetch } from 'oleojs'
import { contract, toOpenApi } from 'oleojs/contract'
import { limitSchema } from './project-schemas.ts'

const routes = group('/api', contract({
  method: 'GET',
  path: '/projects',
  operationId: 'listProjects',
  request: {
    query: { limit: { schema: limitSchema, required: false } },
  },
  responses: { 200: { description: 'Requested page size' } },
}, (_request, _ctx, { query }) => Response.json({ limit: query.limit })))

const document = toOpenApi({
  info: { title: 'Projects API', version: '1.0.0' },
}, routes)

export default toFetch(router(routes))
```

Here `limitSchema` turns an optional decimal string into a number, defaulting to 20. See the [complete list/create/authenticated-route example](#complete-example) and its [application-owned schemas](#complete-example).

- Field failures produce `422` Problem Details containing an `errors` list. Invalid or missing JSON bodies produce `400`; unsupported or missing JSON media types produce `415`. Unexpected validator failures propagate to outer filters.
- `request.json` consumes the body once. Use `input.json` inside the handler. Raw `ctx.params` stay strings even when `input.params` contains converted values.
- Contracts read the whole JSON body. Install `bodyLimit({ maxBytes })` around them to bound it; an oversized body then produces `413` before validation.
- For contracts declared outside their router, `contractFor<Env>()` binds `contract` to the environment, as `routesFor` does for routes. The [complete example](#complete-example) uses both.
- `toOpenApi` reads definitions without invoking filters, handlers, or validators. It exports input/output JSON Schema through the schema's Standard JSON Schema capability or an application-supplied `toJsonSchema` callback. Missing export support is an error.
- OpenAPI includes applicable `400`/`415`/`422` response descriptions; explicit responses override those defaults. Ordinary routes can be mixed in and are omitted from the document.
- Response schemas describe documentation only: native responses and streaming bodies are not validated or read. Security metadata describes authentication; install `bearerAuth` or another filter to enforce it.

See the [Contract reference](/contracts/validation) for validation rules, document generation limits, and error shapes. Schema rules, rendering, and file-system conventions remain application responsibilities.

## Complete example

A list/create/authenticated-route API with application-owned schemas:

<<< @/examples/contract.ts

<<< @/examples/project-schemas.ts

## Definitions and inference

`contract(definition, handler)` returns a normal `Route<E, TBase>`. Its handler receives `(request, ctx, input)` and returns a native Response or a promise. `ContractInput<RequestDefinition>` infers schema outputs, including transformations and defaults. Env flows from `router<Env>()`, a `Route<Env>` / `RouteGroup<Env>` annotation, or `contractFor<Env, TBase>()`, which returns `contract` typed with `E` fixed and the enclosing parameters defaulting to `TBase` (see [Environment-bound helpers](/guide/groups#environment-bound-helpers)). Full raw path parameters accumulate through groups as before.

| Field | Contract |
| --- | --- |
| `method`, `path` | Same method and relative pattern rules as core routes; full paths are checked after groups are expanded. |
| `operationId` | Required nonempty string, unique within each generated document. |
| `summary` | Optional string for the operation's documentation. |
| `request.params`, `.query`, `.headers` | Maps of names to `{ schema, required?, description? }`; all values originate as decoded strings. |
| `request.json` | Standard Schema validator for a required JSON body. |
| `responses` | Nonempty map of exact status codes 100–599 or `default` to `{ description, content? }`. Each content media type maps to `{ schema }`. These describe documentation only. |
| `security` | OpenAPI security requirement array. It does not enforce authentication. |

The handler's `input` includes only declared sources and fields. `ctx.params` is unchanged: a raw ID can be a string while `input.params.id` is a number. Schema outputs preserve null, undefined, transformations, and defaults; `required: false` does not add undefined to a schema's output type. Optional declaration sources and fields remain optional in the inferred input.

Use `const request = { ... } satisfies ContractRequest` to check a reusable declaration while retaining its concrete schema types. An annotation such as `const request: ContractRequest = ...` widens its schemas: JSON and scalar field outputs become unknown, and sources may be absent. Narrow these values before using them; checking only for undefined does not exclude null.

Configuration containers are copied when the Contract is defined, including nested response and security declarations. Schema instances are opaque and remain application-owned; do not change their validation/export behavior after registration. Schema interface and handler/configuration shape errors throw at definition time. Method, full path, and declared path parameter names are checked during router or document construction, including for JavaScript callers and nonliteral paths.

