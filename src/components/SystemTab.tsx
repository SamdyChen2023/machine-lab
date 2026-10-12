import * as Switch from '@radix-ui/react-switch'
import { useEffect, useState } from 'react'
import { api, download, type Fingerprint, type SummaryRow } from '../lib/api'
import { Card, cx } from './ui'

const chip = (ok: boolean | null) => ok === null ? 'border-slate-500/30 bg-slate-500/10 text-slate-400' : ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/20 bg-rose-400/5 text-rose-300/80'

export function SystemTab() {
  const [egress, setEgress] = useState(true)
  const [redact, setRedact] = useState(false)
  const [data, setData] = useState<{ fingerprint: Fingerprint; summary: SummaryRow[] }>()
  const [err, setErr] = useState<string>()
  useEffect(() => { setData(undefined); setErr(undefined); api.fingerprint(egress, redact).then(setData).catch((e) => setErr(e.message)) }, [egress, redact])
  if (err) return <p className="py-16 text-center text-rose-300">{err}</p>
  if (!data) return <p className="py-16 text-center text-slate-500">Collecting fingerprint…</p>
  const { fingerprint: fp, summary } = data
  const sections = [...new Set(summary.map((r) => r.section))].filter((s) => s !== 'Capabilities' && s !== 'Isolation')
  return (
    <div className="space-y-5">
      <Card title="Isolation technology" right={<button onClick={() => download(`fingerprint-${fp.host.hostname}.json`, fp)} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">Download JSON</button>}>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="text-2xl font-semibold text-slate-50">{fp.virtualization.label}</div>
            <p className="mt-1 text-xs text-slate-500">Heuristic, based on the signals on the right. Treat it as a strong hint, not proof.</p>
          </div>
          <ul className="space-y-1 text-sm text-slate-300">
            {fp.virtualization.evidence.map((e) => <li key={e} className="flex gap-2"><span className="text-indigo-400">›</span>{e}</li>)}
          </ul>
        </div>
        <div className="mt-5 flex flex-wrap gap-4 border-t border-white/5 pt-4">
          <label className="flex items-center gap-2 text-xs text-slate-400">Look up egress IP / region (ipinfo.io)
            <Switch.Root checked={egress} onCheckedChange={setEgress} className="relative h-5 w-9 rounded-full bg-ink-600 data-[state=checked]:bg-indigo-500"><Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" /></Switch.Root></label>
          <label className="flex items-center gap-2 text-xs text-slate-400">Redact hostname &amp; IPs
            <Switch.Root checked={redact} onCheckedChange={setRedact} className="relative h-5 w-9 rounded-full bg-ink-600 data-[state=checked]:bg-indigo-500"><Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" /></Switch.Root></label>
        </div>
      </Card>

      <Card title="Capabilities">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fp.security.checks.map((c) => (
            <div key={c.id} className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm', chip(c.ok))}>
              <span className="font-mono">{c.ok === null ? '?' : c.ok ? '✓' : '✗'}</span>{c.label}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {sections.map((sec) => (
          <Card key={sec} title={sec}>
            <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              {summary.filter((r) => r.section === sec).map((r) => (
                <div key={r.label} className="contents"><dt className="text-slate-500">{r.label}</dt><dd className="break-words font-mono text-[13px] text-slate-200">{r.value}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  )
}
