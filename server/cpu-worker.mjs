// Worker thread body for the built-in CPU benchmark. Three equal phases: SHA-256, prime sieve, recursive fib.
import { parentPort, workerData } from 'node:worker_threads'
import crypto from 'node:crypto'

const slice = (workerData.seconds * 1000) / 3
const phase = (fn) => { const end = performance.now() + slice; let n = 0; while (performance.now() < end) { fn(); n++ } return n }
const buf = Buffer.alloc(64 * 1024, 7)
const fibf = (n) => (n < 2 ? n : fibf(n - 1) + fibf(n - 2))
const hashes = phase(() => crypto.createHash('sha256').update(buf).digest())
const sieveRuns = phase(() => {
  const N = 200000, s = new Uint8Array(N)
  for (let i = 2; i * i < N; i++) if (!s[i]) for (let j = i * i; j < N; j += i) s[j] = 1
})
const fib = phase(() => fibf(24))
parentPort.postMessage({ hashes, sieveRuns, fib, bytes: hashes * buf.length })
