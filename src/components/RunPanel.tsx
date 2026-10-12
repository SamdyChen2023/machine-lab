import * as Checkbox from '@radix-ui/react-checkbox'
import * as Progress from '@radix-ui/react-progress'
import * as Switch from '@radix-ui/react-switch'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useEffect, useRef, useState } from 'react'
import { api, GROUP_TITLES, type Job, type Run } from '../lib/api'
import { RunView } from './RunView'
import { Card, cx } from './ui'

const ALL = ['cpu', 'memory', 'disk', 'network', 'workload']
const input = 'w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-400'
const Toggle = ({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-start justify-between gap-3 text-sm"><span><span className="text-slate-300">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
    <Switch.Root checked={checked} onCheckedChange={onChange} className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-ink-600 data-[state=checked]:bg-indigo-500"><Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" /></Switch.Root></label>
)

export function RunPanel({ job, onFinished }: { job: Job | null; onFinished: () => void }) {
  const [profile, setProfile] = useState('quick')
  const [groups, setGroups] = useState<string[]>(ALL)
  const [label, setLabel] = useState(''); const [provider, setProvider] = useState(''); const [price, setPrice] = useState('')
  const [egress, setEgress] = useState(true); const [redact, setRedact] = useState(false); const [builtin, setBuiltin] = useState(false)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.plan>>>()
  const [err, setErr] = useState<string>(); const [last, setLast] = useState<Run>()
  const running = job?.status === 'running'
  const wasRunning = useRef(false)

  useEffect(() => { api.plan(profile).then(setPlan).catch(() => {}) }, [profile])
  useEffect(() => {
    if (running) { wasRunning.current = true; return }
    if (!wasRunning.current) return
    wasRunning.current = false
    api.currentJob().then(async (j) => {
      if (j?.status === 'done' && j.runId) { setLast(await api.run(j.runId)); onFinished() }
      else if (j?.status === 'error') setErr(j.error ?? 'benchmark failed')
    })
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setErr(undefined); setLast(undefined)
    try { await api.startJob({ profile, groups, label, provider, pricePerHour: price === '' ? null : Number(price), egress, redact, builtinOnly: builtin }) } catch (e) { setErr((e as Error).message) }
  }
  const tests = plan?.tests.filter((t) => groups.includes(t.group)) ?? []
  const pg = job?.progress, pct = pg && pg.total ? ((pg.done + (pg.reps ? (pg.rep - 1) / pg.reps : 0)) / pg.total) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Configure" className="lg:col-span-3">
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs text-slate-400">Profile</div>
              <ToggleGroup.Root type="single" value={profile} onValueChange={(v) => v && setProfile(v)} className="inline-flex rounded-xl bg-ink-800 p-1">
                {[['quick', 'Quick', '≈ 1–2 min'], ['full', 'Full', 'longer: sustained load, scaling curve, npm ci']].map(([v, t, h]) => (
                  <ToggleGroup.Item key={v} value={v} className="rounded-lg px-4 py-1.5 text-left text-sm text-slate-400 data-[state=on]:bg-indigo-500 data-[state=on]:text-white" aria-label={`${t} profile`}>
                    {t}<span className="ml-2 text-[11px] opacity-70">{h}</span>
                  </ToggleGroup.Item>
                ))}
              </ToggleGroup.Root>
            </div>
            <div>
              <div className="mb-2 text-xs text-slate-400">Groups</div>
              <div className="flex flex-wrap gap-2">
                {ALL.map((g) => (
                  <label key={g} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', groups.includes(g) ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-white/10 text-slate-500')}>
                    <Checkbox.Root checked={groups.includes(g)} onCheckedChange={(c) => setGroups((p) => (c ? [...p, g] : p.filter((x) => x !== g)))} className="grid h-4 w-4 place-items-center rounded border border-white/30 data-[state=checked]:border-indigo-400 data-[state=checked]:bg-indigo-500">
                      <Checkbox.Indicator className="text-[10px] leading-none text-white">✓</Checkbox.Indicator></Checkbox.Root>
                    {GROUP_TITLES[g]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-slate-400">Label<input className={cx(input, 'mt-1')} placeholder="hostname" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
              <label className="block text-xs text-slate-400">Provider<input className={cx(input, 'mt-1')} placeholder="e.g. vendor / plan" value={provider} onChange={(e) => setProvider(e.target.value)} /></label>
              <label className="block text-xs text-slate-400">Price (USD / hour)<input type="number" min="0" step="0.001" className={cx(input, 'mt-1')} placeholder="optional" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Toggle label="Egress lookup" hint="ipinfo.io: IP, region, ASN" checked={egress} onChange={setEgress} />
              <Toggle label="Redact output" hint="hide hostname and IPs" checked={redact} onChange={setRedact} />
              <Toggle label="Built-in tests only" hint="ignore fio / sysbench" checked={builtin} onChange={setBuiltin} />
            </div>
          </div>
        </Card>

        <Card title="Plan" className="lg:col-span-2">
          <div className="mb-3 flex gap-2 text-xs">
            {plan && (['fio', 'sysbench'] as const).map((t) => <span key={t} className={cx('rounded-full border px-2.5 py-0.5', plan.tools[t] && !builtin ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10 text-slate-500')}>{t} {plan.tools[t] && !builtin ? '✓ will be used' : plan.tools[t] ? 'ignored' : '✗ not installed'}</span>)}
          </div>
          <ul className="max-h-56 space-y-1 overflow-auto text-xs text-slate-400">
            {tests.map((t) => <li key={t.id} className="truncate"><span className="font-mono text-slate-600">{t.group}</span> {t.title}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">Without fio / sysbench the built-in JS tests run instead. Their metric names differ, so results are only compared between like-for-like tools.</p>
        </Card>
      </div>

      {running && pg ? (
        <Card title="Running…" right={<button onClick={() => api.cancelJob()} className="rounded-lg bg-rose-500/15 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/25">Cancel</button>}>
          <div className="mb-2 flex justify-between text-sm"><span className="text-slate-200">{pg.label}</span><span className="font-mono text-slate-500">{pg.done}/{pg.total}{pg.reps ? ` · run ${pg.rep}/${pg.reps}` : ''}</span></div>
          <Progress.Root value={pct} className="relative h-2.5 overflow-hidden rounded-full bg-ink-700"><Progress.Indicator className="pulse-bar h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500" style={{ width: `${pct}%` }} /></Progress.Root>
          <p className="mt-3 text-xs text-slate-500">Open the Dashboard tab to watch CPU, I/O and steal live while the suite runs. Avoid other activity on the machine until it finishes.</p>
        </Card>
      ) : (
        <button onClick={start} disabled={!groups.length || !plan} className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          Run {profile} suite · {tests.length} tests
        </button>
      )}
      {err && <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
      {job?.status === 'cancelled' && !running && !last && <p className="text-center text-sm text-amber-300">Last run was cancelled.</p>}
      {last && (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Results · {last.label}</h2><span className="text-xs text-slate-500">{(last.durationMs / 1000).toFixed(0)} s · saved as {last.id}</span></div>
          <RunView run={last} />
        </div>
      )}
    </div>
  )
}
