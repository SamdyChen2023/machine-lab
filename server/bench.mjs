// Benchmarks: CPU (worker threads), memory bandwidth, disk (dd, O_DIRECT), network.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __file = fileURLToPath(import.meta.url)

// ---------- worker body ----------
if (!isMainThread && workerData?.kind === 'cpu') {
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
}

export async function cpuBench({ threads, seconds }) {
  threads = Math.min(Math.max(1, threads | 0), os.cpus().length * 2)
  seconds = Math.min(Math.max(1, seconds), 30)
  const t0 = performance.now()
  const results = await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const w = new Worker(__file, { workerData: { kind: 'cpu', seconds } })
    w.once('message', resolve); w.once('error', reject)
  })))
  const elapsed = (performance.now() - t0) / 1000
  const sum = (k) => results.reduce((a, r) => a + r[k], 0)
  // each workload ran for a third of the wall time
  const third = elapsed / 3
  const hashMBs = sum('bytes') / 1e6 / third
  const sieve = sum('sieveRuns') / third
  const fib = sum('fib') / third
  // composite score: geometric mean of three normalised rates
  const score = Math.round(Math.cbrt((hashMBs / 100) * (sieve / 100) * (fib / 100)) * 100)
  return { threads, seconds: +elapsed.toFixed(2), hashMBs: +hashMBs.toFixed(1), sieveRunsPerSec: +sieve.toFixed(1), fibPerSec: +fib.toFixed(1), score, perThreadScore: Math.round(score / threads) }
}

// ---------- memory ----------
export function memBench({ mb }) {
  mb = Math.min(Math.max(16, mb | 0), 1536)
  const n = mb * 1024 * 1024 / 8
  const a = new Float64Array(n).fill(1) // pre-fault pages so we time bandwidth, not the page-fault path
  let t = performance.now()
  for (let i = 0; i < n; i++) a[i] = i
  const writeS = (performance.now() - t) / 1000
  t = performance.now()
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i]
  const readS = (performance.now() - t) / 1000
  const b = new Float64Array(n).fill(1)
  t = performance.now()
  b.set(a)
  const copyS = (performance.now() - t) / 1000
  const gb = mb / 1024
  return { mb, writeGBs: +(gb / writeS).toFixed(2), readGBs: +(gb / readS).toFixed(2), copyGBs: +(gb / copyS).toFixed(2), check: sum > 0 }
}

// ---------- disk ----------
const sh = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, so, se) => e ? rej(e) : res(se + so)))
const ddRate = (s) => { const m = s.match(/,\s*([\d.]+)\s*s,\s*([\d.]+)\s*(MB|GB|kB)\/s/); return m ? +m[2] * (m[3] === 'GB' ? 1000 : m[3] === 'kB' ? 0.001 : 1) : null }

export async function diskBench({ mb }) {
  mb = Math.min(Math.max(64, mb | 0), 2048)
  const f = path.join(os.tmpdir(), `lab-dd-${process.pid}-${Date.now()}`)
  try {
    // O_DIRECT bypasses the page cache; some filesystems (tmpfs, certain overlays) reject it, so fall back to buffered I/O
    let direct = true, w, r
    try {
      w = await sh('dd', ['if=/dev/zero', `of=${f}`, 'bs=1M', `count=${mb}`, 'oflag=direct'])
      r = await sh('dd', [`if=${f}`, 'of=/dev/null', 'bs=1M', 'iflag=direct'])
    } catch {
      direct = false
      w = await sh('dd', ['if=/dev/zero', `of=${f}`, 'bs=1M', `count=${mb}`, 'conv=fdatasync'])
      r = await sh('dd', [`if=${f}`, 'of=/dev/null', 'bs=1M'])
    }
    // random 4K IOPS-ish: sync small writes
    const fd = fs.openSync(f, 'r+'); const blk = Buffer.alloc(4096, 1)
    const ops = 2000, t = performance.now()
    for (let i = 0; i < ops; i++) { fs.writeSync(fd, blk, 0, 4096, Math.floor(Math.random() * (mb * 256)) * 4096); if (i % 20 === 0) fs.fsyncSync(fd) }
    fs.fsyncSync(fd); fs.closeSync(fd)
    const iops = ops / ((performance.now() - t) / 1000)
    return { mb, direct, writeMBs: ddRate(w), readMBs: ddRate(r), randWriteIops: Math.round(iops) }
  } finally { fs.rmSync(f, { force: true }) }
}

// ---------- network ----------
export async function netBench({ targets, download }) {
  const lat = []
  for (const url of targets) {
    const times = []
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      try { const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) }); await r.arrayBuffer(); times.push(performance.now() - t) } catch { /* skip */ }
    }
    times.sort((a, b) => a - b)
    lat.push({ url, ok: times.length > 0, min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) })
  }
  let mbps = null, bytes = 0
  if (download) {
    const t = performance.now()
    try {
      const r = await fetch('https://speed.cloudflare.com/__down?bytes=50000000', { signal: AbortSignal.timeout(20000) })
      for await (const c of r.body) bytes += c.length
      mbps = (bytes * 8) / 1e6 / ((performance.now() - t) / 1000)
    } catch { /* offline */ }
  }
  return { latency: lat, downloadMbps: mbps && +mbps.toFixed(1), downloadedMB: +(bytes / 1e6).toFixed(1) }
}
