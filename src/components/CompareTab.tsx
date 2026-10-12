import * as Switch from '@radix-ui/react-switch'
import { useEffect, useRef, useState } from 'react'
import { api, fmtNum, GROUP_TITLES, type CompareResult, type Run, type RunSummary } from '../lib/api'
import { Bar, Card, cx } from './ui'

export function CompareTab({ runs, selected, setSelected }: { runs: RunSummary[]; selected: string[]; setSelected: (f: (p: string[]) => string[]) => void }) {
  const [extra, setExtra] = useState<Run[]>([])
  const [data, setData] = useState<CompareResult>()
  const [err, setErr] = useState<string>()
  const [onlyDiff, setOnlyDiff] = useState(true)
  const file = useRef<HTMLInputElement>(null)
  const count = selected.length + extra.length

  useEffect(() => {
    if (count < 2) { setData(undefined); setErr(undefined); return }
    api.compare(selected, extra).then((d) => { setData(d); setErr(undefined) }).catch((e) => setErr(e.message))
  }, [selected, extra]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: FileList | null) => {
    const ok: Run[] = []
    for (const f of Array.from(files ?? [])) { try { const j = JSON.parse(await f.text()); if (j.schema === 1) ok.push(j); else setErr(`${f.name}: not a Machine Lab result`) } catch { setErr(`${f.name}: invalid JSON`) } }
    setExtra((p) => [...p, ...ok])
  }

  return (
    <div className="space-y-5">
      <Card title="Choose runs to compare" right={
        <div className="flex gap-2"><input ref={file} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          <button onClick={() => file.current?.click()} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">Add files (not saved)…</button></div>}>
        <div className="flex flex-wrap gap-2">
          {runs.map((r) => (
            <button key={r.id} onClick={() => setSelected((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))}
              className={cx('rounded-xl border px-3 py-2 text-left text-sm', selected.includes(r.id) ? 'border-indigo-400/50 bg-indigo-500/15' : 'border-white/10 hover:bg-white/5')}>
              <div className="font-medium">{r.label}</div><div className="text-[11px] text-slate-500">{r.profile} · {new Date(r.startedAt).toLocaleDateString()}</div>
            </button>
          ))}
          {extra.map((r, i) => (
            <button key={`x${i}`} onClick={() => setExtra((p) => p.filter((_, j) => j !== i))} className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-sm" title="click to remove">
              <div className="font-medium">{r.label}</div><div className="text-[11px] text-amber-300/80">file · click to remove</div>
            </button>
          ))}
          {runs.length === 0 && extra.length === 0 && <p className="text-sm text-slate-500">No runs available — run a suite or import result files first.</p>}
        </div>
      </Card>
      {count < 2 && <p className="py-10 text-center text-sm text-slate-500">Select at least two runs.</p>}
      {err && <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      {data && <Result d={data} onlyDiff={onlyDiff} setOnlyDiff={setOnlyDiff} />}
    </div>
  )
}

function Result({ d, onlyDiff, setOnlyDiff }: { d: CompareResult; onlyDiff: boolean; setOnlyDiff: (v: boolean) => void }) {
  const cols = `minmax(11rem,1.4fr) repeat(${d.machines.length}, minmax(8.5rem,1fr))`
  const allPrice = d.machines.every((m) => m.pricePerHour)
  return (
    <>
      {d.warnings.map((w) => <p key={w} className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">⚠ {w}</p>)}
      <Card title="Overall">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${d.machines.length}, minmax(0,1fr))` }}>
          {d.machines.map((m, i) => (
            <div key={i} className="rounded-xl bg-white/[.03] p-4">
              <div className="truncate font-semibold" title={m.name}>{m.name}</div>
              <div className="truncate text-xs text-slate-500">{m.provider ?? '—'}{m.pricePerHour ? ` · $${m.pricePerHour}/h` : ''}</div>
              <div className="mt-2 font-mono text-4xl font-bold text-slate-50">{d.overall[i] ?? '–'}</div>
              {allPrice && d.overall[i] != null && <div className="text-xs text-slate-500">{(d.overall[i]! / m.pricePerHour!).toFixed(0)} pts per $/h</div>}
              <div className="mt-3 space-y-2">
                {d.groups.map((g) => (
                  <div key={g.id}><div className="mb-0.5 flex justify-between text-[11px]"><span className="text-slate-500">{GROUP_TITLES[g.id] ?? g.id}</span><span className="font-mono">{g.scores[i] ?? '–'}</span></div><Bar value={g.scores[i] ?? 0} tone={(g.scores[i] ?? 100) < 60 ? 'amber' : 'indigo'} /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">{d.scoreNote}</p>
      </Card>

      <Card title="Environment" right={<label className="flex items-center gap-2 text-xs text-slate-400">Only differences<Switch.Root checked={onlyDiff} onCheckedChange={setOnlyDiff} className="relative h-5 w-9 rounded-full bg-ink-600 data-[state=checked]:bg-indigo-500"><Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" /></Switch.Root></label>}>
        <div className="overflow-x-auto"><div className="min-w-fit text-sm">
          <div className="grid gap-x-3 border-b border-white/10 pb-2 text-xs font-medium text-slate-400" style={{ gridTemplateColumns: cols }}><span />{d.machines.map((m, i) => <span key={i} className="truncate">{m.name}</span>)}</div>
          {onlyDiff && !d.fingerprint.some((r) => r.differs) && <p className="py-6 text-center text-sm text-slate-500">No differences in the collected environment — switch off “Only differences” to see everything.</p>}
          {d.fingerprint.filter((r) => !onlyDiff || r.differs).map((r) => (
            <div key={r.section + r.label} className="grid gap-x-3 border-b border-white/5 py-1.5" style={{ gridTemplateColumns: cols }}>
              <span className="text-slate-500"><span className="text-[10px] uppercase tracking-wide text-slate-600">{r.section}</span><br />{r.label}</span>
              {r.values.map((v, i) => <span key={i} className={cx('break-words font-mono text-[12px]', r.differs ? 'text-slate-100' : 'text-slate-400')}>{v}</span>)}
            </div>
          ))}
        </div></div>
      </Card>

      {d.groups.map((g) => (
        <Card key={g.id} title={GROUP_TITLES[g.id] ?? g.id}>
          <div className="overflow-x-auto"><div className="min-w-fit text-sm">
            {g.tests.map((t) => (
              <div key={t.id} className="mb-5 last:mb-0">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-300">{t.title}<span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">{t.tool}</span></div>
                {t.metrics.map((m) => (
                  <div key={m.key} className="grid items-center gap-x-3 border-b border-white/5 py-1" style={{ gridTemplateColumns: cols }}>
                    <span className="font-mono text-xs text-slate-400">{m.key} <span className="text-slate-600">{m.unit}</span></span>
                    {m.values.map((v, i) => v == null ? <span key={i} className="text-slate-600">–</span> : (
                      <span key={i} className="relative block overflow-hidden rounded px-2 py-1 font-mono text-[13px]" title={`min ${fmtNum(v.min)} · max ${fmtNum(v.max)} · n=${v.n}`}>
                        {m.ratios[i] != null && m.best != null && <i className={cx('absolute inset-y-0 left-0 -z-0', i === m.best ? 'bg-emerald-400/15' : 'bg-indigo-400/10')} style={{ width: `${Math.max(2, (m.ratios[i] ?? 0) * 100)}%` }} />}
                        <span className="relative">
                          <b className={i === m.best ? 'text-emerald-300' : 'text-slate-100'}>{fmtNum(v.v)}</b>
                          {m.best != null && i !== m.best && m.ratios[i] != null && <span className="ml-1.5 text-[11px] text-slate-500">×{m.ratios[i]!.toFixed(2)}</span>}
                          {m.noisy[i] && <span className="ml-1 text-amber-300" title={`CV ${v.cv.toFixed(0)}% — noisy`}>⚠</span>}
                        </span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div></div>
        </Card>
      ))}
    </>
  )
}
