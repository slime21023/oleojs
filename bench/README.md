# Benchmarks

Compares HTTP throughput of oleojs, Express 5, and a hand-written `node:http` baseline on Node.js. Every application serves the same scenarios (`scenarios.ts`), and the runner checks each response body before measuring.

```sh
cd bench
bun install
node run.ts                                   # all scenarios, 3s warmup + 10s per run
node run.ts --scenario plain-text --duration 5 --connections 50
```

## Scenarios

| Name | Request |
| --- | --- |
| `plain-text` | `GET /` returns a short text body |
| `route-params` | `GET /users/:userId/posts/:postId` returns both parameters as JSON |
| `json-body` | `POST /echo` parses a JSON body and returns it |
| `middleware` | `GET /middleware` passes through 5 no-op middleware |
| `many-routes` | `GET /api/resource49/123` is the last of 50 parameterized routes |

## Method

- Each framework runs in its own child process, started fresh for every scenario, with `NODE_ENV=production`. [autocannon](https://github.com/mcollina/autocannon) generates load from the runner process over HTTP/1.1 keep-alive on `127.0.0.1`.
- oleojs is served through `oleojs/node` (`toNodeListener`), imported from `../src` so no build is needed. Node.js runs the TypeScript sources directly.
- Express keeps its defaults, including `ETag` and `X-Powered-By`.
- The `node:http` baseline dispatches only the benchmarked paths by hand. It shows the cost of Node's HTTP server alone, not a usable router.
- Load generator and servers share one machine, so absolute numbers depend on it. Compare frameworks within one run, not across machines.
