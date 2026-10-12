import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sample, staticInfo } from './metrics.mjs'
import { cpuBench, memBench, diskBench, netBench } from './bench.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = path.join(root, 'data', 'results.json')
const PORT = process.env.PORT || 8090
const app = express()
app.use(express.json())

const load = () => { try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { return [] } }
const save = (r) => { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(r.slice(-200), null, 2)) }
let busy = null // one benchmark at a time, otherwise results are meaningless

app.get('/api/system', (_req, res) => res.json(staticInfo()))

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const tick = async () => res.write(`data: ${JSON.stringify({ ...(await sample()), busy })}\n\n`)
  tick()
  const iv = setInterval(tick, 1000)
  req.on('close', () => clearInterval(iv))
})

app.get('/api/results', (_req, res) => res.json(load().reverse()))
app.delete('/api/results', (_req, res) => { save([]); res.json({ ok: true }) })

const runners = {
  cpu: async (b) => {
    const threads = +b.threads || 2, seconds = +b.seconds || 5
    const multi = await cpuBench({ threads, seconds })
    if (!b.scaling || threads < 2) return multi
    // single-thread baseline -> how well does the box actually scale across vCPUs?
    const single = await cpuBench({ threads: 1, seconds })
    const speedup = multi.score / single.score
    return { ...multi, scaling: { singleScore: single.score, speedup: +speedup.toFixed(2), efficiency: +((speedup / multi.threads) * 100).toFixed(0) } }
  },
  memory: (b) => memBench({ mb: +b.mb || 256 }),
  disk: (b) => diskBench({ mb: +b.mb || 512 }),
  network: (b) => netBench({
    targets: ['https://example.com', 'https://github.com', 'https://www.cloudflare.com', 'https://registry.npmjs.org'],
    download: b.download !== false,
  }),
}

app.post('/api/bench/:kind', async (req, res) => {
  const run = runners[req.params.kind]
  if (!run) return res.status(404).json({ error: 'unknown benchmark' })
  if (busy) return res.status(409).json({ error: `benchmark "${busy}" already running` })
  busy = req.params.kind
  const started = Date.now()
  try {
    const result = await run(req.body || {})
    const rec = { id: `${started}`, kind: req.params.kind, at: started, durationMs: Date.now() - started, params: req.body || {}, result }
    save([...load(), rec])
    res.json(rec)
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  } finally { busy = null }
})

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

if (process.platform !== 'linux') console.warn('warning: live metrics and some benchmarks need Linux (/proc, GNU dd); other platforms will show zeros')
app.listen(PORT, '0.0.0.0', () => console.log(`machine-lab api on :${PORT}`))
