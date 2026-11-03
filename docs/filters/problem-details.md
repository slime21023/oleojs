# Problem details

`problemDetails(options?)` turns errors into JSON error documents in the [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) format, with `Content-Type: application/problem+json`.

```ts
import { problemDetails } from 'oleojs/filters'

const app = toFetch(withFilters(routes, problemDetails()))
```

With this filter, an unknown path returns:

```json
{ "status": 404, "type": "about:blank", "title": "Not Found" }
```

It handles two cases:

- **Thrown errors** become a `500` problem. The error message and stack are never sent to the client.
- **Empty error responses**, such as the router's `404` and `405` or `bearerAuth`'s `401`, get a problem body with the same status and headers. Responses that already have a body are left alone.

## Options

<<< @/examples/filters.ts#problem-details

| Option | Default | Description |
| --- | --- | --- |
| `fromError(error, request)` | none | Map your own errors to a problem: `{ status, title?, detail?, type?, instance?, ...extra }`, with a status from 400 to 599. Return `undefined` for the default `500` |
| `emptyResponses` | `true` | Set `false` to leave empty error responses unchanged |
| `onError(error, request)` | `console.error` | Called for thrown errors that become a `5xx` response |
