import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import autocannon from 'autocannon'
import { type Scenario, scenarios } from './scenarios.ts'

interface Framework {
  readonly name: string
  readonly entry: string
  readonly args?: readonly string[]
}

interface Measurement {
  readonly requestsPerSecond: number
  readonly p50: number
  readonly p99: number
  readonly failures: number
}

const frameworks: readonly Framework[] = [
  { name: 'node:http', entry: 'apps/node-http.ts' },
  { name: 'oleojs (lazyRequest: false)', entry: 'apps/oleojs.ts', args: ['--native-request'] },
  { name: 'oleojs', entry: 'apps/oleojs.ts' },
  { name: 'oleojs + FastResponse', entry: 'apps/oleojs.ts', args: ['--fast-response'] },
  { name: 'express', entry: 'apps/express.ts' },
]

const { values: options } = parseArgs({
  options: {
    duration: { type: 'string', default: '10' },
    warmup: { type: 'string', default: '3' },
    connections: { type: 'string', default: '100' },
    scenario: { type: 'string', multiple: true },
  },
})

const duration = Number(options.duration)
const warmup = Number(options.warmup)
const connections = Number(options.connections)
const selected = options.scenario === undefined ? scenarios : scenarios.filter((scenario) => options.scenario?.includes(scenario.name))

async function start(framework: Framework): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, [framework.entry, ...(framework.args ?? [])], {
    cwd: import.meta.dirname,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: child.stdout! })
  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`${framework.name} exited with code ${code} before listening`)
  })
  const announced = once(lines, 'line').then(([line]) => (JSON.parse(line as string) as { port: number }).port)
  const port = await Promise.race([announced, exited])
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

console.log(`Node.js ${process.version}, ${connections} connections, ${warmup}s warmup + ${duration}s per run\n`)

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
