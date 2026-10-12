// Runs a profile of tests, repeats each, aggregates (median / spread / CV) and assembles a portable result document.
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { run, has, stats, Cancelled, check } from './util.mjs'
import { collectFingerprint, redact } from './fingerprint.mjs'
import { buildTests, PROJECT_ROOT } from './tests.mjs'

export const GROUPS = ['cpu', 'memory', 'disk', 'network', 'workload']
export const PROFILES = {
  quick: { repeats: 3, warmup: 0, cpuSeconds: 3, memMB: 256, diskMB: 256, fioRuntime: 3, latOps: 500, smallFiles: 2000, zlibMB: 16, spawnSeconds: 2, download: false, sweep: false, sustainedSeconds: 0, npm: false, multiDir: false },
  full: { repeats: 5, warmup: 1, cpuSeconds: 5, memMB: 512, diskMB: 1024, fioRuntime: 10, latOps: 2000, smallFiles: 10000, zlibMB: 64, spawnSeconds: 4, download: true, sweep: true, sustainedSeconds: 60, npm: true, multiDir: true },
}

function candidateDirs(multi) {
  const list = [os.tmpdir()]
  if (multi) for (const d of [os.homedir(), '/dev/shm']) { try { fs.accessSync(d, fs.constants.W_OK); list.push(d) } catch { /* not writable */ } }
  const seen = new Set()
  return list.filter((d) => { try { const dev = fs.statSync(d).dev; if (seen.has(dev)) return false; seen.add(dev); return true } catch { return false } })
}

async function labVersion() {
  let version = 'unknown'
  try { version = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version } catch { /* ignore */ }
  const g = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: PROJECT_ROOT, timeout: 3000 })
  return { version, commit: g.ok ? g.stdout.trim() : null }
}

function aggregate(reps) {
  const metrics = {}
  for (const key of Object.keys(reps[0].m)) {
    const samples = reps.map((r) => r.m[key]?.v).filter((v) => Number.isFinite(v))
    const s = stats(samples)
    if (s) metrics[key] = { unit: reps[0].m[key].unit, better: reps[0].m[key].better, median: s.median, mean: s.mean, min: s.min, max: s.max, cv: s.cv, n: s.n, samples }
  }
  return metrics
}

export function listTests(opts = {}) {
  // lightweight preview used by the UI to show what a profile will run
  const p = { ...PROFILES[opts.profile || 'quick'], dirs: candidateDirs(PROFILES[opts.profile || 'quick'].multiDir) }
  return buildTests({ p, tools: { sysbench: !!opts.sysbench, fio: !!opts.fio, npm: true }, signal: null }).map((t) => ({ id: t.id, group: t.group, title: t.title }))
}

/**
 * @param {object} o profile, groups, label, provider, pricePerHour, egress, redactOutput, forceBuiltin, signal, onProgress
 */
export async function runSuite(o = {}) {
  const profile = PROFILES[o.profile] ? o.profile : 'quick'
  const p = { ...PROFILES[profile], dirs: candidateDirs(PROFILES[profile].multiDir) }
  const groups = (o.groups?.length ? o.groups : GROUPS).filter((g) => GROUPS.includes(g))
  const startedAt = Date.now()
  const fingerprint = await collectFingerprint({ egress: o.egress !== false })
  const tools = {
    fio: !o.forceBuiltin && !!fingerprint.tools.fio, sysbench: !o.forceBuiltin && !!fingerprint.tools.sysbench, npm: !!fingerprint.tools.npm,
  }
  const ctx = { p, tools, signal: o.signal }
  const tests = buildTests(ctx).filter((t) => groups.includes(t.group))
  const results = []
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i]
    const emit = (rep, reps) => o.onProgress?.({ done: i, total: tests.length, label: t.title, rep, reps })
    const base = { id: t.id, group: t.group, title: t.title, tool: t.tool }
    try {
      check(o.signal)
      for (let w = 0; w < t.warmup; w++) { emit(0, t.repeats); await t.run() }
      const reps = []
      for (let r = 0; r < t.repeats; r++) { emit(r + 1, t.repeats); reps.push(await t.run()); check(o.signal) }
      results.push({ ...base, repeats: reps.length, warmup: t.warmup, metrics: aggregate(reps), series: reps.at(-1).series, notes: reps.find((r) => r.notes)?.notes })
    } catch (e) {
      if (e instanceof Cancelled) throw e
      results.push({ ...base, error: String(e?.message || e) })
    }
  }
  o.onProgress?.({ done: tests.length, total: tests.length, label: 'finished', rep: 0, reps: 0 })
  const lab = await labVersion()
  const fp = o.redactOutput ? redact(fingerprint) : fingerprint
  return {
    schema: 1, id: `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}`,
    label: o.label || fp.host.hostname, provider: o.provider || null, pricePerHour: o.pricePerHour ?? null,
    profile, groups, startedAt, durationMs: Date.now() - startedAt, lab, forceBuiltin: !!o.forceBuiltin,
    fingerprint: fp, results,
  }
}
