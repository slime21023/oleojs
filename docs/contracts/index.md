# Contracts

`oleojs/contract` lets a route declare what it accepts. oleojs validates the request before the handler runs, and can generate an [OpenAPI document](/contracts/openapi) from the same declarations.

Schemas can come from any library that implements [Standard Schema](https://standardschema.dev/), such as Zod, Valibot, or ArkType. The examples use small hand-written schemas from [`project-schemas.ts`](https://github.com/slime21023/oleojs/blob/main/docs/examples/project-schemas.ts).

## Declaring a contract

<<< @/examples/contracts.ts#contract

`contract(definition, handler)` returns an ordinary route, so it works inside `router()` and `group()` like any other. The handler receives a third argument, `input`, with the validated values:

| Declaration | Validated value |
| --- | --- |
| `request.params` | `input.params`: path parameters |
| `request.query` | `input.query`: query string parameters |
| `request.headers` | `input.headers`: request headers |
| `request.json` | `input.json`: the parsed JSON body |

Values have the schema's output type. Above, `limitSchema` turns the query string `'5'` into the number `5`, and defaults to `20`. Parameters are required unless marked `required: false`.

Each contract also needs a unique `operationId` and at least one entry in `responses`. Responses are documentation only; they are not checked.

## Invalid requests

| Problem | Response |
| --- | --- |
| A parameter or JSON body fails its schema | `422` |
| A JSON body is missing or malformed | `400` |
| A JSON body is sent without `Content-Type: application/json` | `415` |

The handler does not run in these cases. Responses use the problem details format, and a `422` lists every failure:

```json
{
  "status": 422,
  "errors": [
    { "source": "query", "path": ["limit"], "message": "Limit must be between 1 and 100" }
  ],
  "type": "about:blank",
  "title": "Unprocessable Content"
}
```

## Tips

- The contract reads the JSON body for you. Use `input.json` and do not read the request body again.
- `ctx.params` keeps the raw strings; `input.params` has the validated values.
- Contracts do not limit body size. Add [`bodyLimit`](/filters/body-limit) around them.
- For contracts declared in their own module, `contractFor<Env>()` returns `contract` bound to your environment type, like [`routesFor`](/guide/routing#routes-in-other-modules).
- Authentication is not enforced by a contract. Use [`bearerAuth`](/filters/bearer-auth) or another filter.

## A complete example

An API with listing, creating, and an authenticated route, using `contractFor`, `bearerAuth`, `bodyLimit`, and `problemDetails`:

<<< @/examples/contract.ts
