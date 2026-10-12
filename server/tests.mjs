// Benchmark definitions. Each test returns { m: { key: { v, unit, better } }, series?, notes? } for ONE repetition;
// suite.mjs repeats it and aggregates. Metric keys are namespaced by tool (js_, sb_, fio_, dd_ …) so results from
// different tools never get compared against each other.
import { Worker } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'
import net from 'node:net'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, has, check, percentile, cpuCounters, memBudgetBytes, exists } from './util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')
const M = (v, unit, better = 'higher') => ({ v, unit, better })

// ---------- parsers (exported for unit tests) ----------
export const parseSysbenchCpu = (t) => Number(t.match(/events per second:\s+([\d.]+)/)?.[1])
export const parseSysbenchMem = (t) => Number(t.match(/\(([\d.]+) MiB\/sec\)/)?.[1])
export function parseFio(text) {
  const j = JSON.parse(text.slice(text.indexOf('{')))
  const job = j.jobs[0], side = job.write.io_bytes > 0 && job.read.io_bytes === 0 ? job.write : job.read.io_bytes > 0 ? job.read : job.write
  const clat = side.clat_ns?.percentile ?? side.lat_ns?.percentile ?? {}
  return { mibs: (side.bw_bytes ?? side.bw * 1024) / 2 ** 20, iops: side.iops, p99us: clat['99.000000'] != null ? clat['99.000000'] / 1000 : null, p50us: clat['50.000000'] != null ? clat['50.000000'] / 1000 : null }
}

// ---------- CPU (built-in, worker threads) ----------
export async function jsCpu(threads, seconds, signal) {
  check(signal)
  const t0 = performance.now()
  const workers = []
  const res = await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const w = new Worker(path.join(here, 'cpu-worker.mjs'), { workerData: { seconds } })
    workers.push(w)
    w.once('message', resolve); w.once('error', reject)
  }))).finally(() => workers.forEach((w) => w.terminate()))
  check(signal)
  const el = (performance.now() - t0) / 1000, third = el / 3
  const sum = (k) => res.reduce((a, r) => a + r[k], 0)
  const hashMBs = sum('bytes') / 1e6 / third, sieve = sum('sieveRuns') / third, fib = sum('fib') / third
  const score = Math.round(Math.cbrt((hashMBs / 100) * (sieve / 100) * (fib / 100)) * 100)
  return { score, hashMBs, sieve, fib }
}

// ---------- memory (built-in) ----------
function jsMem(mb) {
  const n = (mb * 2 ** 20) / 8
  const a = new Float64Array(n).fill(1), b = new Float64Array(n).fill(1) // pre-fault pages
  let t = performance.now(); for (let i = 0; i < n; i++) a[i] = i; const w = (performance.now() - t) / 1000
  t = performance.now(); let s = 0; for (let i = 0; i < n; i++) s += a[i]; const r = (performance.now() - t) / 1000
  t = performance.now(); b.set(a); const c = (performance.now() - t) / 1000
  const gb = mb / 1024
  return { write: gb / w, read: gb / r, copy: gb / c, s }
}

// ---------- disk helpers ----------
const ddRate = (s) => { const m = s.match(/,\s*([\d.]+)\s*s,\s*([\d.]+)\s*(kB|MB|GB)\/s/); return m ? Number(m[2]) * (m[3] === 'GB' ? 1000 : m[3] === 'kB' ? 0.001 : 1) / 1.048576 : null } // MB/s -> MiB/s
const scratch = (dir, name) => path.join(dir, `lab-${name}-${process.pid}-${Date.now()}`)

async function fioOnce(ctx, file, name, args) {
  const base = ['--name=' + name, '--filename=' + file, '--output-format=json', '--group_reporting', `--size=${ctx.p.diskMB}M`, ...args]
  let r = await run('fio', [...base, '--direct=1'], { signal: ctx.signal }); check(ctx.signal)
  let direct = true
  if (!r.ok) { direct = false; r = await run('fio', [...base, '--direct=0'], { signal: ctx.signal }); check(ctx.signal) }
  if (!r.ok) return null
  return { ...parseFio(r.stdout), direct }
}

// ---------- test list ----------
export function buildTests(ctx) {
  const { p, tools } = ctx
  const cores = os.availableParallelism()
  const T = []
  const add = (t) => T.push({ repeats: p.repeats, warmup: p.warmup, ...t })

  // ===== cpu =====
  add({ id: 'cpu.js', group: 'cpu', title: 'CPU · built-in JS (SHA-256 + sieve + fib)', tool: 'node-worker', async run() {
    const one = await jsCpu(1, p.cpuSeconds, ctx.signal)
    const all = cores > 1 ? await jsCpu(cores, p.cpuSeconds, ctx.signal) : one
    const speedup = all.score / one.score
    return { m: { js_single_score: M(one.score, 'pts'), js_multi_score: M(all.score, 'pts'), js_speedup: M(speedup, '×'), js_efficiency: M((speedup / cores) * 100, '%'), js_sha256_mibs: M(one.hashMBs / 1.048576, 'MiB/s') },
      notes: 'Relative score for comparing machines only; depends on the Node version.' }
  } })
  if (tools.sysbench) add({ id: 'cpu.sysbench', group: 'cpu', title: 'CPU · sysbench (prime numbers)', tool: 'sysbench', async run() {
    const sb = async (t) => parseSysbenchCpu((await run('sysbench', ['cpu', '--cpu-max-prime=20000', `--threads=${t}`, `--time=${p.cpuSeconds}`, 'run'], { signal: ctx.signal })).stdout)
    const s1 = await sb(1); check(ctx.signal); const sn = cores > 1 ? await sb(cores) : s1
    return { m: { sb_single_eps: M(s1, 'events/s'), sb_multi_eps: M(sn, 'events/s'), sb_speedup: M(sn / s1, '×'), sb_efficiency: M((sn / s1 / cores) * 100, '%') } }
  } })
  if (p.sweep && cores > 1) add({ id: 'cpu.sweep', group: 'cpu', title: 'CPU · thread scaling curve', tool: 'node-worker', repeats: 1, warmup: 0, async run() {
    const counts = [...new Set([1, 2, 4, 8, 16, 32, cores, cores * 2].filter((n) => n <= Math.max(cores * 2, 1) && n <= 64))].sort((a, b) => a - b)
    const pts = []
    for (const n of counts) pts.push([n, (await jsCpu(n, Math.max(3, p.cpuSeconds), ctx.signal)).score])
    const one = pts[0][1], atCores = pts.find(([n]) => n === cores)?.[1] ?? pts.at(-1)[1]
    return { m: { js_peak_score: M(Math.max(...pts.map((x) => x[1])), 'pts'), js_score_at_vcpus: M(atCores, 'pts'), js_scaling_at_vcpus: M((atCores / one / cores) * 100, '%') },
      series: [{ name: 'score by thread count', xLabel: 'threads', yLabel: 'score', points: pts }] }
  } })
  if (p.sustainedSeconds) add({ id: 'cpu.sustained', group: 'cpu', title: `CPU · sustained all-core load (${p.sustainedSeconds}s)`, tool: 'node-worker', repeats: 1, warmup: 0, async run() {
    const slices = Math.max(2, Math.round(p.sustainedSeconds / 5)), pts = [], c0 = cpuCounters()
    for (let i = 0; i < slices; i++) pts.push([i * 5 + 5, (await jsCpu(cores, 5, ctx.signal)).score])
    const c1 = cpuCounters(), ys = pts.map((x) => x[1]), head = ys.slice(0, 2).reduce((a, b) => a + b) / 2, tail = ys.slice(-2).reduce((a, b) => a + b) / 2
    return { m: { js_sustained_first: M(head, 'pts'), js_sustained_last: M(tail, 'pts'), js_throttle_drop: M(Math.max(0, (1 - tail / head) * 100), '%', 'lower'), cpu_steal: M(c1.total > c0.total ? ((c1.steal - c0.steal) / (c1.total - c0.total)) * 100 : 0, '%', 'lower') },
      series: [{ name: 'score over time', xLabel: 'seconds', yLabel: 'score', points: pts }], notes: 'A large drop between the first and last slices indicates throttling or burst-credit exhaustion.' }
  } })

  // ===== memory =====
  const memMB = () => Math.max(16, Math.min(p.memMB, Math.floor(memBudgetBytes() / 2 ** 20 / 2)))
  if (tools.sysbench) add({ id: 'mem.sysbench', group: 'memory', title: 'Memory · sysbench (1 MiB blocks)', tool: 'sysbench', async run() {
    const mb = Math.min(p.memMB * 4, 4096)
    const sb = async (oper, t) => parseSysbenchMem((await run('sysbench', ['memory', '--memory-block-size=1M', `--memory-total-size=${mb}M`, `--memory-oper=${oper}`, `--threads=${t}`, 'run'], { signal: ctx.signal })).stdout)
    return { m: { sb_write_mibs: M(await sb('write', 1), 'MiB/s'), sb_read_mibs: M(await sb('read', 1), 'MiB/s'), sb_read_mt_mibs: M(await sb('read', cores), 'MiB/s') } }
  } })
  add({ id: 'mem.js', group: 'memory', title: 'Memory · built-in JS array bandwidth', tool: 'node', async run() {
    const mb = memMB(), r = jsMem(mb)
    return { m: { js_write_gibs: M(r.write, 'GiB/s'), js_read_gibs: M(r.read, 'GiB/s'), js_copy_gibs: M(r.copy, 'GiB/s') }, notes: `${mb} MiB working set. Bounded by JS loop speed, not the DRAM limit — use sysbench for hardware bandwidth.` }
  } })

  // ===== disk (one set per directory) =====
  for (const dir of p.dirs) {
    if (tools.fio) add({ id: `disk.fio@${dir}`, group: 'disk', title: `Disk · fio @ ${dir}`, tool: 'fio', repeats: Math.min(p.repeats, 3), warmup: 0, async run() {
      const f = scratch(dir, 'fio'), m = {}, notes = []
      try {
        const rt = ['--runtime=' + p.fioRuntime, '--time_based']
        const w = await fioOnce(ctx, f, 'seqw', ['--rw=write', '--bs=1M', '--end_fsync=1'])
        if (!w) throw new Error('fio failed to run in ' + dir)
        m.fio_seqw_mibs = M(w.mibs, 'MiB/s'); if (!w.direct) notes.push('O_DIRECT unsupported here; buffered I/O used')
        const r = await fioOnce(ctx, f, 'seqr', ['--rw=read', '--bs=1M']); if (r) m.fio_seqr_mibs = M(r.mibs, 'MiB/s')
        // let the writeback from the sequential write drain so it doesn't pollute the read latencies
        await run('sync', [], { signal: ctx.signal }); await new Promise((res) => setTimeout(res, 2000)); check(ctx.signal)
        const r1 = await fioOnce(ctx, f, 'rr1', ['--rw=randread', '--bs=4k', '--iodepth=1', ...rt])
        if (r1) { m.fio_randr_qd1_iops = M(r1.iops, 'IOPS'); if (r1.p99us != null) m.fio_randr_qd1_p99_us = M(r1.p99us, 'µs', 'lower') }
        const w1 = await fioOnce(ctx, f, 'rw1', ['--rw=randwrite', '--bs=4k', '--iodepth=1', '--fdatasync=1', ...rt])
        if (w1) { m.fio_randw_sync_iops = M(w1.iops, 'IOPS'); if (w1.p99us != null) m.fio_randw_sync_p99_us = M(w1.p99us, 'µs', 'lower') }
        await run('sync', [], { signal: ctx.signal }); await new Promise((res) => setTimeout(res, 2000)); check(ctx.signal)
        // io_uring first (libaio is unreliable on overlay/virtio setups), then libaio
        let r32 = null, engine = null
        for (const e of ['io_uring', 'libaio']) { r32 = await fioOnce(ctx, f, 'rr32', ['--rw=randread', '--bs=4k', '--iodepth=32', `--ioengine=${e}`, ...rt]); if (r32) { engine = e; break } }
        if (r32) { m.fio_randr_qd32_iops = M(r32.iops, 'IOPS'); if (r32.p99us != null) m.fio_randr_qd32_p99_us = M(r32.p99us, 'µs', 'lower'); if (engine !== 'io_uring') notes.push('io_uring unavailable, libaio used for QD32') } else notes.push('no async I/O engine available for the QD32 test')
      } finally { fs.rmSync(f, { force: true }) }
      return { m, notes: notes.join('; ') || undefined }
    } })
    add({ id: `disk.dd@${dir}`, group: 'disk', title: `Disk · dd + 4K sync-write latency @ ${dir}`, tool: 'dd+node', repeats: Math.min(p.repeats, 3), warmup: 0, async run() {
      const f = scratch(dir, 'dd'), notes = []
      try {
        let w = await run('dd', ['if=/dev/zero', `of=${f}`, 'bs=1M', `count=${p.diskMB}`, 'oflag=direct'], { signal: ctx.signal }); check(ctx.signal)
        let r
        if (w.ok) r = await run('dd', [`if=${f}`, 'of=/dev/null', 'bs=1M', 'iflag=direct'], { signal: ctx.signal })
        if (!w.ok || !r.ok) {
          notes.push('O_DIRECT unsupported here; buffered I/O + fdatasync used')
          w = await run('dd', ['if=/dev/zero', `of=${f}`, 'bs=1M', `count=${p.diskMB}`, 'conv=fdatasync'], { signal: ctx.signal })
          r = await run('dd', [`if=${f}`, 'of=/dev/null', 'bs=1M'], { signal: ctx.signal })
        }
        check(ctx.signal)
        const fh = await fsp.open(f, 'r+'), blk = Buffer.alloc(4096, 1), lat = [], span = Math.max(1, (p.diskMB * 256) | 0)
        for (let i = 0; i < p.latOps; i++) {
          const t = process.hrtime.bigint()
          await fh.write(blk, 0, 4096, Math.floor(Math.random() * span) * 4096); await fh.datasync()
          lat.push(Number(process.hrtime.bigint() - t) / 1000)
          if (i % 200 === 0) check(ctx.signal)
        }
        await fh.close(); lat.sort((a, b) => a - b)
        const total = lat.reduce((a, b) => a + b, 0) / 1e6
        return { m: { dd_seqw_mibs: M(ddRate(w.stderr + w.stdout), 'MiB/s'), dd_seqr_mibs: M(ddRate(r.stderr + r.stdout), 'MiB/s'), sync4k_iops: M(lat.length / total, 'IOPS'), sync4k_p50_us: M(percentile(lat, 50), 'µs', 'lower'), sync4k_p99_us: M(percentile(lat, 99), 'µs', 'lower') }, notes: notes.join('; ') || undefined }
      } finally { fs.rmSync(f, { force: true }) }
    } })
    add({ id: `disk.smallfiles@${dir}`, group: 'disk', title: `Disk · small files (4 KiB × ${p.smallFiles}) @ ${dir}`, tool: 'node', repeats: Math.min(p.repeats, 3), warmup: 0, async run() {
      const d = scratch(dir, 'sf'), N = p.smallFiles, data = Buffer.alloc(4096, 9)
      await fsp.mkdir(d, { recursive: true })
      const pool = async (fn) => { let i = 0; await Promise.all(Array.from({ length: 8 }, async () => { while (i < N) { const k = i++; await fn(k) } })) }
      try {
        const time = async (fn) => { const t = performance.now(); await pool(fn); check(ctx.signal); return N / ((performance.now() - t) / 1000) }
        const create = await time((k) => fsp.writeFile(path.join(d, `f${k}`), data))
        const stat = await time((k) => fsp.stat(path.join(d, `f${k}`)))
        const rd = await time((k) => fsp.readFile(path.join(d, `f${k}`)))
        const del = await time((k) => fsp.unlink(path.join(d, `f${k}`)))
        return { m: { files_create_per_s: M(create, 'files/s'), files_stat_per_s: M(stat, 'files/s'), files_read_per_s: M(rd, 'files/s'), files_delete_per_s: M(del, 'files/s') } }
      } finally { await fsp.rm(d, { recursive: true, force: true }) }
    } })
  }

  // ===== process / workload =====
  add({ id: 'proc.spawn', group: 'workload', title: 'Process · spawn rate (/bin/true)', tool: 'node', async run() {
    const end = performance.now() + p.spawnSeconds * 1000; let n = 0
    const bin = exists('/usr/bin/true') ? '/usr/bin/true' : '/bin/true'
    while (performance.now() < end) { await new Promise((res) => spawn(bin).once('close', res)); n++; if (n % 50 === 0) check(ctx.signal) }
    return { m: { spawn_per_s: M(n / p.spawnSeconds, 'proc/s') } }
  } })
  add({ id: 'wl.zlib', group: 'workload', title: `Workload · gzip level 6 on ${p.zlibMB} MiB of text`, tool: 'node-zlib', async run() {
    // deterministic pseudo-text so every machine compresses identical bytes
    let x = 123456789; const words = ['alpha', 'beta', 'gamma', 'delta', 'sandbox', 'kernel', 'memory', 'thread', 'socket', 'buffer', 'cache', 'disk']
    const parts = []; let len = 0
    while (len < p.zlibMB * 2 ** 20) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; const w = words[x % words.length] + ((x >>> 8) % 97) + ' '; parts.push(w); len += w.length }
    const buf = Buffer.from(parts.join('')), gz = promisify(zlib.gzip), gunz = promisify(zlib.gunzip)
    let t = performance.now(); const z = await gz(buf, { level: 6 }); const tc = (performance.now() - t) / 1000
    t = performance.now(); await gunz(z); const td = (performance.now() - t) / 1000
    const mib = buf.length / 2 ** 20
    return { m: { gzip_mibs: M(mib / tc, 'MiB/s'), gunzip_mibs: M(mib / td, 'MiB/s'), gzip_ratio: M(buf.length / z.length, '×') } }
  } })
  if (p.npm && tools.npm && exists(path.join(PROJECT_ROOT, 'package-lock.json'))) add({ id: 'wl.npmci', group: 'workload', title: 'Workload · npm ci of this project (cold then warm cache)', tool: 'npm', repeats: 1, warmup: 0, async run() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-npm-'))
    try {
      for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(PROJECT_ROOT, f), path.join(d, f))
      const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(d, 'cache')]
      let t = performance.now(); const a = await run('npm', args, { cwd: d, signal: ctx.signal }); const cold = (performance.now() - t) / 1000; check(ctx.signal)
      if (!a.ok) throw new Error('npm ci failed: ' + a.stderr.slice(-300))
      fs.rmSync(path.join(d, 'node_modules'), { recursive: true, force: true })
      t = performance.now(); await run('npm', [...args, '--prefer-offline'], { cwd: d, signal: ctx.signal }); const warm = (performance.now() - t) / 1000
      return { m: { npm_ci_cold_s: M(cold, 's', 'lower'), npm_ci_warm_s: M(warm, 's', 'lower') }, notes: 'Cold run includes network download; warm run isolates CPU and filesystem cost.' }
    } finally { fs.rmSync(d, { recursive: true, force: true }) }
  } })

  // ===== network =====
  const targets = ['https://github.com', 'https://registry.npmjs.org', 'https://example.com', 'https://www.cloudflare.com']
  add({ id: 'net.latency', group: 'network', title: 'Network · HTTPS latency, DNS and TCP connect', tool: 'node', async run() {
    const m = {}
    for (const u of targets) {
      const ts = []
      for (let i = 0; i < 5; i++) {
        const t = performance.now()
        try { const r = await fetch(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) }); await r.arrayBuffer(); ts.push(performance.now() - t) } catch { /* skip */ }
      }
      ts.sort((a, b) => a - b); if (ts.length) m[`https_${new URL(u).hostname}_ms`] = M(ts[Math.floor(ts.length / 2)], 'ms', 'lower')
    }
    const d = []
    for (const h of ['github.com', 'registry.npmjs.org', 'example.com', 'www.cloudflare.com', 'pypi.org']) { const t = performance.now(); try { await dns.resolve4(h); d.push(performance.now() - t) } catch { /* skip */ } }
    d.sort((a, b) => a - b); if (d.length) m.dns_median_ms = M(d[Math.floor(d.length / 2)], 'ms', 'lower')
    const tc = []
    for (let i = 0; i < 5; i++) { const t = performance.now(); try { await new Promise((res, rej) => { const s = net.connect(443, '1.1.1.1', () => { s.destroy(); res() }); s.setTimeout(4000, () => { s.destroy(); rej() }); s.once('error', rej) }); tc.push(performance.now() - t) } catch { /* skip */ } }
    tc.sort((a, b) => a - b); if (tc.length) m.tcp_connect_ms = M(tc[Math.floor(tc.length / 2)], 'ms', 'lower')
    if (!Object.keys(m).length) throw new Error('no network connectivity')
    return { m }
  } })
  if (p.download) add({ id: 'net.throughput', group: 'network', title: 'Network · download 50 MB / upload 10 MB (Cloudflare)', tool: 'node', repeats: Math.min(p.repeats, 3), warmup: 0, async run() {
    const m = {}
    let t = performance.now(), bytes = 0
    const r = await fetch('https://speed.cloudflare.com/__down?bytes=50000000', { signal: AbortSignal.timeout(30000) })
    for await (const c of r.body) { bytes += c.length; if (ctx.signal?.aborted) check(ctx.signal) }
    m.download_mbps = M((bytes * 8) / 1e6 / ((performance.now() - t) / 1000), 'Mbit/s')
    try {
      const body = Buffer.alloc(10_000_000, 1); t = performance.now()
      const u = await fetch('https://speed.cloudflare.com/__up', { method: 'POST', body, signal: AbortSignal.timeout(30000) }); await u.arrayBuffer()
      m.upload_mbps = M((body.length * 8) / 1e6 / ((performance.now() - t) / 1000), 'Mbit/s')
    } catch { /* upload blocked */ }
    return { m }
  } })
  return T
}
