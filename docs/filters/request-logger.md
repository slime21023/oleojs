# Request logging

`requestLogger(options?)` logs one entry per request. By default it writes JSON with `console.log`:

```json
{ "method": "GET", "path": "/users/42", "durationMs": 1.3, "status": 200 }
```

<<< @/examples/filters.ts#request-logger

| Option | Default | Description |
| --- | --- | --- |
| `log(entry)` | `console.log(JSON.stringify(entry))` | Where entries go |
| `fields(request, response)` | none | Extra fields to add to each entry. `response` is `undefined` when the handler threw |

- `path` never includes the query string, which often carries tokens.
- When the handler throws, the entry has `error: true` and no `status`, and the error is rethrown.
- `durationMs` measures the time until the handler returns its response.
- A failure in `log` or `fields` is reported with `console.error` and never affects the response.
