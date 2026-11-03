# Filters

`oleojs/filters` provides ready-made filters for common needs:

| Filter | What it does |
| --- | --- |
| [`cors`](/filters/cors) | Answers CORS preflights and adds CORS headers |
| [`bearerAuth`](/filters/bearer-auth) | Checks `Authorization: Bearer` tokens |
| [`problemDetails`](/filters/problem-details) | Turns errors into JSON problem documents |
| [`requestLogger`](/filters/request-logger) | Logs each request's method, path, status, and duration |
| [`bodyLimit`](/filters/body-limit) | Rejects request bodies over a size limit |
| [`mapRequest`, `mapResponse`, `responseHeaders`](/filters/transforms) | Change requests, responses, or response headers |

Each one is a function that takes options and returns a filter. Invalid options throw immediately.

## A typical setup

<<< @/examples/filters.ts#stack

This order works well:

1. `requestLogger` outermost, so it logs the final status.
2. `cors` next, so error responses get CORS headers too.
3. `problemDetails` inside them, so it formats every error.
4. `bodyLimit` inside `problemDetails`, so its `413` is formatted.

Put `cors` around the whole router, not on a group: a preflight request usually matches no route, so group filters never see it. Authentication can go on a group.
