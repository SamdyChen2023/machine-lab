// Side-by-side comparison of several result documents. Used by both the API and the CLI.
import { summarize } from './fingerprint.mjs'

const geomean = (xs) => (xs.length ? Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length) : null)
export const NOISY_CV = 25 // % — above this a median is flagged as unreliable

export function compareRuns(runs) {
  // unique, readable column names
  const seen = new Map()
  const machines = runs.map((r) => {
    let name = r.label || r.fingerprint?.host?.hostname || r.id
    const n = (seen.get(name) ?? 0) + 1; seen.set(name, n)
    if (n > 1) name += ` (${n})`
    return { name, provider: r.provider ?? null, pricePerHour: r.pricePerHour ?? null, profile: r.profile, startedAt: r.startedAt, id: r.id, forceBuiltin: !!r.forceBuiltin }
  })

  // fingerprint rows: union of (section,label) in first-seen order
  const fpMaps = runs.map((r) => new Map(summarize(r.fingerprint).map((x) => [`${x.section}\u0000${x.label}`, x.value])))
  const fpKeys = []; for (const m of fpMaps) for (const k of m.keys()) if (!fpKeys.includes(k)) fpKeys.push(k)
  const fingerprint = fpKeys.filter((k) => !/Hostname|Clock/.test(k) || true).map((k) => {
    const [section, label] = k.split('\u0000'), values = fpMaps.map((m) => m.get(k) ?? '—')
    return { section, label, values, differs: new Set(values).size > 1 }
  })

  // metrics: group -> test -> metric
  const groups = new Map()
  runs.forEach((run, ri) => {
    for (const t of run.results ?? []) {
      if (!t.metrics) continue
      if (!groups.has(t.group)) groups.set(t.group, new Map())
      const tests = groups.get(t.group)
      if (!tests.has(t.id)) tests.set(t.id, { id: t.id, title: t.title, tool: t.tool, metrics: new Map() })
      const te = tests.get(t.id)
      for (const [key, m] of Object.entries(t.metrics)) {
        if (!te.metrics.has(key)) te.metrics.set(key, { key, unit: m.unit, better: m.better, values: Array(runs.length).fill(null) })
        te.metrics.get(key).values[ri] = { v: m.median, cv: m.cv, n: m.n, min: m.min, max: m.max }
      }
    }
  })

  const ratioLists = machines.map(() => ({}))
  const out = []
  for (const [gid, tests] of groups) {
    const gTests = []
    for (const te of tests.values()) {
      const ms = []
      for (const me of te.metrics.values()) {
        const present = me.values.map((x) => x?.v).filter((v) => Number.isFinite(v) && v > 0)
        let best = null
        if (present.length) best = me.better === 'lower' ? Math.min(...present) : Math.max(...present)
        const ratios = me.values.map((x) => (x && best && x.v > 0 ? (me.better === 'lower' ? best / x.v : x.v / best) : null))
        if (present.length >= 2) ratios.forEach((r, i) => { if (r != null) (ratioLists[i][gid] ??= []).push(r) })
        ms.push({ ...me, best: best == null || present.length < 2 ? null : me.values.findIndex((x) => x?.v === best), ratios, noisy: me.values.map((x) => !!x && x.cv > NOISY_CV) })
      }
      gTests.push({ id: te.id, title: te.title, tool: te.tool, metrics: ms })
    }
    out.push({ id: gid, tests: gTests, scores: machines.map((_, i) => { const g = geomean(ratioLists[i][gid] ?? []); return g == null ? null : Math.round(g * 100) }) })
  }
  const order = ['cpu', 'memory', 'disk', 'network', 'workload']
  out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  const overall = machines.map((_, i) => { const g = geomean(out.map((o) => o.scores[i]).filter((x) => x != null)); return g == null ? null : Math.round(g) })
  const warnings = []
  if (new Set(runs.map((r) => r.profile)).size > 1) warnings.push('Runs used different profiles (quick vs full) — repeat counts and sizes differ.')
  if (new Set(runs.map((r) => !!r.forceBuiltin)).size > 1) warnings.push('Some runs forced built-in tests; native-tool metrics exist only for the others.')
  return { machines, fingerprint, groups: out, overall, warnings, scoreNote: '100 = best machine on every metric of that group; scores are geometric means of per-metric ratios to the best, over metrics that ≥2 machines share.' }
}
