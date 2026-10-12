#!/usr/bin/env node
// Headless runner: collect a fingerprint, run benchmarks, write one portable JSON file.
import fs from 'node:fs'
import path from 'node:path'
import { runSuite, GROUPS, PROFILES } from './suite.mjs'
import { collectFingerprint, summarize, redact } from './fingerprint.mjs'
import { compareRuns } from './compare.mjs'
import { writeJsonAtomic } from './util.mjs'

const USAGE = `machine-lab CLI
  run      [--profile quick|full] [--groups cpu,memory,disk,network,workload] [--label NAME] [--provider NAME]
           [--price USD_PER_HOUR] [--out FILE] [--no-egress] [--redact] [--builtin-only]
  info     [--no-egress] [--json]       print the environment fingerprint
  compare  FILE1.json FILE2.json ...    side-by-side table
`
const argv = process.argv.slice(2), cmd = argv.shift()
const flags = {}, files = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { files.push(a); continue }
  const k = a.slice(2); const next = argv[i + 1]
  if (['no-egress', 'redact', 'builtin-only', 'json'].includes(k)) flags[k] = true
  else { flags[k] = next; i++ }
}
const fmt = (v) => (v == null ? '–' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2))

if (cmd === 'info') {
  let fp = await collectFingerprint({ egress: !flags['no-egress'] }); if (flags.redact) fp = redact(fp)
  if (flags.json) console.log(JSON.stringify(fp, null, 2))
  else { let sec = ''; for (const r of summarize(fp)) { if (r.section !== sec) { sec = r.section; console.log(`\n${sec}`) } console.log(`  ${r.label.padEnd(38)} ${r.value}`) } }
} else if (cmd === 'run') {
  if (flags.profile && !PROFILES[flags.profile]) { console.error(`unknown profile "${flags.profile}"\n${USAGE}`); process.exit(2) }
  const ac = new AbortController(); process.on('SIGINT', () => { console.error('\ncancelling…'); ac.abort() })
  const t0 = Date.now()
  let run
  try {
    run = await runSuite({
      profile: flags.profile || 'quick', groups: flags.groups?.split(','), label: flags.label, provider: flags.provider,
      pricePerHour: flags.price ? Number(flags.price) : null, egress: !flags['no-egress'], redactOutput: !!flags.redact, forceBuiltin: !!flags['builtin-only'], signal: ac.signal,
      onProgress: (p) => process.stderr.write(`\r\x1b[K[${p.done}/${p.total}] ${p.label}${p.reps ? `  (${p.rep}/${p.reps})` : ''}`),
    })
  } catch (e) { console.error(`\n${e.name === 'Cancelled' ? 'cancelled' : e.stack}`); process.exit(e.name === 'Cancelled' ? 130 : 1) }
  process.stderr.write('\r\x1b[K')
  const out = flags.out || `machine-lab-${run.label.replace(/[^\w.-]+/g, '_')}-${run.profile}.json`
  writeJsonAtomic(path.resolve(out), run)
  console.log(`${run.fingerprint.virtualization.label} · ${run.fingerprint.cpu.model} · ${run.fingerprint.cpu.vcpus} vCPU`)
  for (const r of run.results) {
    console.log(`\n${r.title}${r.error ? `  ✗ ${r.error}` : ''}`)
    for (const [k, m] of Object.entries(r.metrics ?? {})) console.log(`  ${k.padEnd(26)} ${fmt(m.median).padStart(10)} ${m.unit.padEnd(9)} ±${m.cv.toFixed(1)}%${m.cv > 25 ? '  ⚠ noisy' : ''}`)
  }
  console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${path.resolve(out)}`)
} else if (cmd === 'compare') {
  if (files.length < 2) { console.error('need at least two result files\n' + USAGE); process.exit(2) }
  const c = compareRuns(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))))
  const w = Math.max(...c.machines.map((m) => m.name.length), 10) + 2
  const row = (label, vals) => console.log(label.padEnd(34) + vals.map((v) => String(v).padStart(w)).join(''))
  row('', c.machines.map((m) => m.name)); row('overall score (100 = best)', c.overall.map((x) => x ?? '–'))
  for (const g of c.groups) {
    console.log(`\n== ${g.id}   group score:`.padEnd(34) + g.scores.map((x) => String(x ?? '–').padStart(w)).join(''))
    for (const t of g.tests) for (const m of t.metrics) row(`  ${m.key} (${m.unit})`, m.values.map((v, i) => (v ? fmt(v.v) + (i === m.best ? ' ★' : '') + (v.cv > 25 ? ' ⚠' : '') : '–')))
  }
  c.warnings.forEach((x) => console.log(`\n⚠ ${x}`)); console.log(`\n${c.scoreNote}`)
} else { console.log(USAGE); process.exit(cmd ? 2 : 0) }
