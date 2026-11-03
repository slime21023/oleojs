import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import autocannon from 'autocannon'
import { type Scenario, scenarios } from './scenarios.ts'

interface Framework {
  readonly name: string
  readonly entry: string
  readonly args?: readonly string[]
  /** Served by the runtime from a default export with `fetch`, on the port in `PORT`. */
  readonly fetchEntry?: boolean
}

const RUNTIMES = ['node', 'bun', 'deno'] as const
type Runtime = (typeof RUNTIMES)[number]

interface Measurement {
  readonly requestsPerSecond: number
  readonly p50: number
  readonly p99: number
  readonly failures: number
}

const nodeFrameworks: readonly Framework[] = [
  { name: 'node:http', entry: 'apps/node-http.ts' },
  { name: 'oleojs (lazyRequest: false)', entry: 'apps/oleojs.ts', args: ['--native-request'] },
  { name: 'oleojs', entry: 'apps/oleojs.ts' },
  { name: 'oleojs + FastResponse', entry: 'apps/oleojs.ts', args: ['--fast-response'] },
  { name: 'express', entry: 'apps/express.ts' },
]

// On Bun and Deno, oleojs runs through the runtime's fetch entry (Bun's `export default app`,
// `deno serve`); Express and the Node adapter run on the runtime's node:http compatibility layer.
const fetchRuntimeFrameworks: readonly Framework[] = [
  { name: 'fetch (no framework)', entry: 'apps/fetch-baseline.ts', fetchEntry: true },
  { name: 'node:http', entry: 'apps/node-http.ts' },
  { name: 'oleojs (fetch entry)', entry: 'apps/oleojs-fetch.ts', fetchEntry: true },
  { name: 'oleojs (oleojs/node)', entry: 'apps/oleojs.ts' },
  { name: 'express', entry: 'apps/express.ts' },
]

const { values: options } = parseArgs({
  options: {
    duration: { type: 'string', default: '10' },
    warmup: { type: 'string', default: '3' },
    connections: { type: 'string', default: '100' },
    runtime: { type: 'string', default: 'node' },
    scenario: { type: 'string', multiple: true },
  },
})

const duration = Number(options.duration)
const warmup = Number(options.warmup)
const connections = Number(options.connections)
const requested = RUNTIMES.find((name) => name === options.runtime)
if (requested === undefined) throw new Error(`Unknown runtime: ${options.runtime}`)
// A separate constant keeps the narrowed type inside the functions below.
const runtime: Runtime = requested
const frameworks = runtime === 'node' ? nodeFrameworks : fetchRuntimeFrameworks

// The runner and its load generator always run on Node.js; only the servers change runtime.
function command(framework: Framework, port: number | undefined): [string, string[]] {
  const args = [framework.entry, ...(framework.args ?? [])]
  switch (runtime) {
    case 'node':
      return [process.execPath, args]
    case 'bun':
      return ['bun', args]
    case 'deno':
      return framework.fetchEntry === true
        ? ['deno', ['serve', '--quiet', '--allow-env=PORT', '--host', '127.0.0.1', '--port', String(port), ...args]]
        : ['deno', ['run', '--quiet', '--allow-all', ...args]]
  }
}

function runtimeVersion(): string {
  if (runtime === 'node') return `Node.js ${process.version}`
  const output = execFileSync(runtime, ['--version'], { encoding: 'utf8' })
  // Deno prints one line per component; the first is its own version.
  return runtime === 'bun' ? `Bun ${output.trim()}` : output.split(/\r?\n/)[0]!.replace('deno', 'Deno')
}
const selected = options.scenario === undefined ? scenarios : scenarios.filter((scenario) => options.scenario?.includes(scenario.name))

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  server.close()
  await once(server, 'close')
  return port
}

// Fetch-entry servers announce nothing, so wait until the port answers.
async function listening(port: number): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await (await fetch(`http://127.0.0.1:${port}/`)).arrayBuffer()
      return port
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Nothing answered on port ${port}`)
}

async function start(framework: Framework): Promise<{ child: ChildProcess; port: number }> {
  const assigned = framework.fetchEntry === true ? await freePort() : undefined
  const [executable, args] = command(framework, assigned)
  const child = spawn(executable, args, {
    cwd: import.meta.dirname,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(assigned ?? 0) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`${framework.name} exited with code ${code} before listening`)
  })
  const ready = assigned === undefined
    ? once(createInterface({ input: child.stdout! }), 'line').then(([line]) => (JSON.parse(line as string) as { port: number }).port)
    : listening(assigned)
  const port = await Promise.race([ready, exited])
  return { child, port }
}

async function verify(framework: Framework, port: number, scenario: Scenario): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}${scenario.path}`, {
    method: scenario.method,
    headers: scenario.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: scenario.body,
  })
  const body = await response.text()
  if (response.status !== 200 || body !== scenario.expected) {
    throw new Error(`${framework.name} ${scenario.name}: expected 200 ${scenario.expected}, got ${response.status} ${body}`)
  }
}

async function load(port: number, scenario: Scenario, seconds: number): Promise<autocannon.Result> {
  return autocannon({
    url: `http://127.0.0.1:${port}${scenario.path}`,
    method: scenario.method,
    headers: scenario.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: scenario.body,
    connections,
    duration: seconds,
  })
}

async function measure(framework: Framework, scenario: Scenario): Promise<Measurement> {
  const { child, port } = await start(framework)
  try {
    await verify(framework, port, scenario)
    await load(port, scenario, warmup)
    const result = await load(port, scenario, duration)
    return {
      requestsPerSecond: result.requests.average,
      p50: result.latency.p50,
      p99: result.latency.p99,
      failures: result.errors + result.timeouts + result.non2xx,
    }
  } finally {
    child.kill()
    await once(child, 'exit')
  }
}

function formatRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

console.log(`${runtimeVersion()} servers, load from Node.js ${process.version}, ${connections} connections, ${warmup}s warmup + ${duration}s per run\n`)

for (const scenario of selected) {
  // A fresh process per framework and scenario keeps JIT state from one run out of the next.
  const results = new Map<string, Measurement>()
  for (const framework of frameworks) results.set(framework.name, await measure(framework, scenario))

  const express = results.get('express')!
  console.log(`### ${scenario.name}: ${scenario.description}\n`)
  console.log(formatRow(['Framework', 'Requests/s', 'p50 (ms)', 'p99 (ms)', 'vs Express', 'Failures']))
  console.log(formatRow(['---', '---:', '---:', '---:', '---:', '---:']))
  for (const [name, result] of results) {
    console.log(formatRow([
      name,
      Math.round(result.requestsPerSecond).toLocaleString('en-US'),
      String(result.p50),
      String(result.p99),
      `${(result.requestsPerSecond / express.requestsPerSecond).toFixed(2)}x`,
      String(result.failures),
    ]))
  }
  console.log()
}
