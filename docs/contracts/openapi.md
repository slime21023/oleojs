# OpenAPI

`toOpenApi(options, ...routes)` generates an [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) document from your contracts:

<<< @/examples/contracts.ts#openapi

| Option | Description |
| --- | --- |
| `info` | Required: `{ title, version, description? }` |
| `securitySchemes` | Security schemes referenced by contracts' `security` field, for example `{ bearer: { type: 'http', scheme: 'bearer' } }` |
| `toJsonSchema(schema, direction)` | Converts a schema to JSON Schema, for libraries that cannot do it themselves |

- Pass contracts, groups, or a mix with ordinary routes. Ordinary routes are left out of the document.
- Group prefixes are included in the paths, and `:id` becomes `{id}`.
- Default `400`, `415`, and `422` responses are added for contracts that validate input. Declaring the same status replaces the default.
- Generation never runs handlers or filters. It throws if a schema cannot be converted, or if two contracts share an `operationId`.
