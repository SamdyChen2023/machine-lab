import express from 'express'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sample, staticInfo } from './metrics.mjs'
import { collectFingerprint, redact, summarize } from './fingerprint.mjs'
import { runSuite, PROFILES, GROUPS, listTests } from './suite.mjs'
import { compareRuns } from './compare.mjs'
import { writeJsonAtomic, has } from './util.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runsDir = path.join(root, 'data', 'runs')
const PORT = process.env.PORT || 8090
const TOKEN = process.env.LAB_TOKEN || ''
const app = express()
app.use(express.json({ limit: '25mb' }))

// ---------- optional access token (set LAB_TOKEN). Open /?token=… once; it is then kept in a cookie. ----------
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(n + '='))?.slice(n.length + 1)
if (TOKEN) {
  app.use((req, res, next) => {
    const given = req.query.token || req.get('x-lab-token') || cookie(req, 'lab_token') || ''
    const ok = typeof given === 'string' && eq(given, TOKEN)
    if (ok && req.query.token) res.cookie('lab_token', TOKEN, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86400e3 })
    if (ok || !req.path.startsWith('/api/')) return next()
    res.status(401).json({ error: 'unauthorized: open the page once with ?token=… or send the x-lab-token header' })
  })
}

// ---------- saved runs ----------
const safeId = (id) => /^[\w.-]+$/.test(id)
const runFile = (id) => path.join(runsDir, `${id}.json`)
const loadRun = (id) => JSON.parse(fs.readFileSync(runFile(id), 'utf8'))
const listRuns = () => {
  if (!fs.existsSync(runsDir)) return []
  return fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).map((f) => {
    try { const r = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')); return { id: r.id, label: r.label, provider: r.provider, profile: r.profile, groups: r.groups, startedAt: r.startedAt, durationMs: r.durationMs, tests: r.results.length, errors: r.results.filter((x) => x.error).length, virt: r.fingerprint?.virtualization?.label, cpu: r.fingerprint?.cpu?.model, vcpus: r.fingerprint?.cpu?.vcpus } } catch { return null }
  }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt)
}

// ---------- background job (one at a time, otherwise numbers are meaningless) ----------
let job = null
const publicJob = () => job && { id: job.id, status: job.status, profile: job.profile, groups: job.groups, startedAt: job.startedAt, progress: job.progress, runId: job.runId, error: job.error }

app.post('/api/jobs', (req, res) => {
  if (job?.status === 'running') return res.status(409).json({ error: 'a benchmark is already running' })
  const b = req.body || {}
  const profile = PROFILES[b.profile] ? b.profile : 'quick'
  const groups = Array.isArray(b.groups) ? b.groups.filter((g) => GROUPS.includes(g)) : GROUPS
  const ac = new AbortController()
  job = { id: String(Date.now()), status: 'running', profile, groups, startedAt: Date.now(), progress: { done: 0, total: 0, label: 'starting…', rep: 0, reps: 0 }, ac }
  const j = job
  runSuite({
    profile, groups, label: String(b.label || '').slice(0, 80) || undefined, provider: String(b.provider || '').slice(0, 80) || undefined,
    pricePerHour: Number.isFinite(+b.pricePerHour) && b.pricePerHour !== '' && b.pricePerHour != null ? +b.pricePerHour : null,
    egress: b.egress !== false, redactOutput: !!b.redact, forceBuiltin: !!b.builtinOnly, signal: ac.signal, onProgress: (p) => { j.progress = p },
  }).then((run) => { writeJsonAtomic(runFile(run.id), run); j.runId = run.id; j.status = 'done' })
    .catch((e) => { j.status = e.name === 'Cancelled' ? 'cancelled' : 'error'; j.error = e.name === 'Cancelled' ? null : String(e.message || e) })
  res.status(202).json(publicJob())
})
app.get('/api/jobs/current', (_req, res) => res.json(publicJob()))
app.delete('/api/jobs/current', (_req, res) => { job?.ac.abort(); res.json({ ok: true }) })

// ---------- live metrics ----------
app.get('/api/system', (_req, res) => res.json(staticInfo()))
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const tick = async () => res.write(`data: ${JSON.stringify({ ...(await sample()), busy: job?.status === 'running' ? job.progress.label : null, job: job?.status === 'running' ? publicJob() : null })}\n\n`)
  tick()
  const iv = setInterval(tick, 1000)
  req.on('close', () => clearInterval(iv))
})

// ---------- fingerprint ----------
let fpCache = null
app.get('/api/fingerprint', async (req, res) => {
  const egress = req.query.egress !== '0'
  if (!fpCache || fpCache.egress !== egress || Date.now() - fpCache.at > 60000) fpCache = { at: Date.now(), egress, fp: await collectFingerprint({ egress }) }
  const fp = req.query.redact === '1' ? redact(fpCache.fp) : fpCache.fp
  res.json({ fingerprint: fp, summary: summarize(fp) })
})
app.get('/api/plan', async (req, res) => {
  const profile = PROFILES[req.query.profile] ? req.query.profile : 'quick'
  res.json({ tools: { fio: await has('fio'), sysbench: await has('sysbench') }, tests: listTests({ profile, fio: await has('fio'), sysbench: await has('sysbench') }), params: PROFILES[profile] })
})

// ---------- runs ----------
app.get('/api/runs', (_req, res) => res.json(listRuns()))
app.get('/api/runs/:id', (req, res) => {
  if (!safeId(req.params.id) || !fs.existsSync(runFile(req.params.id))) return res.status(404).json({ error: 'not found' })
  res.json(loadRun(req.params.id))
})
app.get('/api/runs/:id/download', (req, res) => {
  if (!safeId(req.params.id) || !fs.existsSync(runFile(req.params.id))) return res.status(404).json({ error: 'not found' })
  res.download(runFile(req.params.id), `machine-lab-${req.params.id}.json`)
})
app.delete('/api/runs/:id', (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: 'bad id' })
  fs.rmSync(runFile(req.params.id), { force: true }); res.json({ ok: true })
})
app.post('/api/runs/import', (req, res) => {
  const r = req.body
  if (!r || r.schema !== 1 || !Array.isArray(r.results) || !r.fingerprint || !r.id || !safeId(String(r.id))) return res.status(400).json({ error: 'not a Machine Lab result file (schema 1)' })
  writeJsonAtomic(runFile(r.id), r); res.json({ id: r.id })
})
app.post('/api/compare', (req, res) => {
  const runs = []
  for (const id of req.body?.ids ?? []) { if (safeId(String(id)) && fs.existsSync(runFile(id))) runs.push(loadRun(id)) }
  for (const r of req.body?.runs ?? []) if (r?.schema === 1 && Array.isArray(r.results) && r.fingerprint) runs.push(r)
  if (runs.length < 2) return res.status(400).json({ error: 'select or import at least two runs' })
  res.json(compareRuns(runs))
})

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
}
if (process.platform !== 'linux') console.warn('warning: live metrics and several benchmarks need Linux (/proc, GNU dd); other platforms will show zeros')
if (!TOKEN) console.warn('note: LAB_TOKEN is not set — anyone who can reach this port can start benchmarks')
app.listen(PORT, '0.0.0.0', () => console.log(`machine-lab api on :${PORT}`))
