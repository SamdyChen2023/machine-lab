import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
export const exists = (p) => fs.existsSync(p)

/** Never rejects. Callers check `ok`; an aborted run has `aborted: true`. */
export const run = (cmd, args = [], opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 180000, maxBuffer: 64e6, ...opts }, (err, stdout, stderr) =>
    resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr), aborted: err?.name === 'AbortError' || err?.code === 'ABORT_ERR' }))
})

const whichCache = new Map()
export async function has(cmd) {
  if (!whichCache.has(cmd)) whichCache.set(cmd, (await run('sh', ['-c', `command -v ${cmd}`])).ok)
  return whichCache.get(cmd)
}

export class Cancelled extends Error { constructor() { super('cancelled'); this.name = 'Cancelled' } }
export const check = (signal) => { if (signal?.aborted) throw new Cancelled() }

export function stats(samples) {
  const s = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const n = s.length
  const mean = s.reduce((a, b) => a + b, 0) / n
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return { median, mean, min: s[0], max: s[n - 1], cv: mean ? (std / Math.abs(mean)) * 100 : 0, n }
}
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

/** Write via temp file + rename so a crash never leaves half a JSON file. */
export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

/** Aggregate CPU time counters from /proc/stat (first line). */
export function cpuCounters() {
  const f = read('/proc/stat').split('\n')[0]?.trim().split(/\s+/).slice(1).map(Number) ?? []
  return { steal: f[7] || 0, total: f.reduce((a, b) => a + b, 0) }
}

/** Memory we may safely use for a test: 40% of what the OS and the cgroup say is available. */
export function memBudgetBytes() {
  const m = {}
  for (const l of read('/proc/meminfo').split('\n')) { const [k, v] = l.split(':'); if (v) m[k] = parseInt(v) * 1024 }
  let avail = m.MemAvailable || m.MemFree || 512 * 2 ** 20
  const max = Number(read('/sys/fs/cgroup/memory.max')), cur = Number(read('/sys/fs/cgroup/memory.current'))
  if (Number.isFinite(max) && max > 0 && Number.isFinite(cur)) avail = Math.min(avail, max - cur)
  return Math.max(32 * 2 ** 20, Math.floor(avail * 0.4))
}
