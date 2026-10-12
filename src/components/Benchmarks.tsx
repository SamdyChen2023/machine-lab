import * as Slider from '@radix-ui/react-slider'
import * as Switch from '@radix-ui/react-switch'
import * as Select from '@radix-ui/react-select'
import { useState, type ReactNode } from 'react'
import { Card, cx } from './ui'
import { runBench, type BenchRecord, type Kind } from '../lib/api'

function Range({ label, value, onChange, min, max, step = 1, unit }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit: string }) {
  return (
    <label className="block">
      <div className="mb-2 flex justify-between text-xs"><span className="text-slate-400">{label}</span><span className="font-mono text-slate-100">{value} {unit}</span></div>
      <Slider.Root className="relative flex h-5 touch-none select-none items-center" value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)}>
        <Slider.Track className="relative h-1.5 grow rounded-full bg-ink-700"><Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" /></Slider.Track>
        <Slider.Thumb aria-label={label} className="block h-4 w-4 rounded-full border-2 border-indigo-300 bg-white shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400/40" />
      </Slider.Root>
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-xs text-slate-400">
      {label}
      <Switch.Root checked={checked} onCheckedChange={onChange} className="relative h-5 w-9 rounded-full bg-ink-600 transition data-[state=checked]:bg-indigo-500">
        <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </label>
  )
}

function SizeSelect({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: number[] }) {
  return (
    <div>
      <div className="mb-2 text-xs text-slate-400">Test size</div>
      <Select.Root value={String(value)} onValueChange={(v) => onChange(+v)}>
        <Select.Trigger className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-ink-800 px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <Select.Value /><Select.Icon className="text-slate-500">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={4} className="pop z-50 w-[var(--radix-select-trigger-width)] rounded-lg border border-white/10 bg-ink-800 p-1 shadow-xl">
            <Select.Viewport>
              {options.map((o) => (
                <Select.Item key={o} value={String(o)} className="cursor-pointer rounded-md px-3 py-1.5 font-mono text-sm outline-none data-[highlighted]:bg-indigo-500/20 data-[state=checked]:text-indigo-300">
                  <Select.ItemText>{o >= 1024 ? `${o / 1024} GB` : `${o} MB`}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

const Metric = ({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) => (
  <div className="rounded-xl bg-white/5 px-3 py-2"><div className="font-mono text-lg font-semibold text-slate-50">{v}</div><div className="text-[11px] text-slate-500">{k}{hint && <span className="text-slate-600"> · {hint}</span>}</div></div>
)

export function Result({ r }: { r: BenchRecord }) {
  const d = r.result
  if (r.kind === 'cpu') return (
    <div className="grid grid-cols-2 gap-2">
      <Metric k="score" v={d.score} hint={`${d.threads}T`} />
      <Metric k="sha256" v={`${d.hashMBs} MB/s`} />
      <Metric k="sieve" v={`${d.sieveRunsPerSec}/s`} />
      <Metric k="fib(24)" v={`${d.fibPerSec}/s`} />
      {d.scaling && <>
        <Metric k="speed-up vs 1 thread" v={`${d.scaling.speedup}×`} hint={`ideal ${d.threads}×`} />
        <Metric k="scaling efficiency" v={<span className={d.scaling.efficiency < 70 ? 'text-rose-400' : 'text-emerald-400'}>{d.scaling.efficiency}%</span>} />
      </>}
    </div>
  )
  if (r.kind === 'memory') return <div className="grid grid-cols-3 gap-2"><Metric k="write" v={`${d.writeGBs} GB/s`} /><Metric k="read" v={`${d.readGBs} GB/s`} /><Metric k="copy" v={`${d.copyGBs} GB/s`} /></div>
  if (r.kind === 'disk') return <div className="grid grid-cols-3 gap-2"><Metric k="seq write" v={`${d.writeMBs} MB/s`} /><Metric k="seq read" v={`${d.readMBs} MB/s`} /><Metric k="4K sync write" v={`${d.randWriteIops}`} hint="IOPS" /></div>
  return (
    <div className="space-y-2">
      {d.downloadMbps != null && <Metric k={`download · ${d.downloadedMB} MB`} v={`${d.downloadMbps} Mbit/s`} />}
      <div className="rounded-xl bg-white/5 p-3 text-xs">
        {d.latency.map((l: any) => (
          <div key={l.url} className="flex justify-between py-0.5 font-mono"><span className="text-slate-400">{l.url.replace('https://', '')}</span><span className={l.ok ? 'text-slate-100' : 'text-rose-400'}>{l.ok ? `${l.median.toFixed(0)} ms` : 'fail'}</span></div>
        ))}
      </div>
    </div>
  )
}

function BenchCard({ kind, title, desc, controls, body, onDone, disabled, last }: {
  kind: Kind; title: string; desc: string; controls: ReactNode; body: object; onDone: () => void; disabled: boolean; last?: BenchRecord
}) {
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string>()
  const [fresh, setFresh] = useState<BenchRecord>()
  const go = async () => {
    setRunning(true); setErr(undefined)
    try { setFresh(await runBench(kind, body)); onDone() } catch (e) { setErr((e as Error).message) } finally { setRunning(false) }
  }
  const shown = fresh ?? last
  return (
    <Card title={title}>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">{desc}</p>
      <div className="space-y-4">{controls}</div>
      <button onClick={go} disabled={running || disabled}
        className={cx('mt-5 w-full rounded-xl py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400/40',
          running ? 'pulse-bar bg-indigo-500/40 text-indigo-100' : 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:brightness-110 active:scale-[.99]', disabled && !running && 'cursor-not-allowed opacity-40')}>
        {running ? 'Running…' : 'Run benchmark'}
      </button>
      {err && <p className="mt-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{err}</p>}
      {shown && <div className="mt-4 border-t border-white/5 pt-4"><div className="mb-2 text-[11px] text-slate-500">{fresh ? 'just now' : `last run · ${new Date(shown.at).toLocaleTimeString()}`} · took {(shown.durationMs / 1000).toFixed(1)} s</div><Result r={shown} /></div>}
    </Card>
  )
}

export function Benchmarks({ cores, busy, results, onDone }: { cores: number; busy: string | null; results: BenchRecord[]; onDone: () => void }) {
  const [threads, setThreads] = useState(cores)
  const [seconds, setSeconds] = useState(6)
  const [scaling, setScaling] = useState(true)
  const [memMb, setMemMb] = useState(512)
  const [diskMb, setDiskMb] = useState(512)
  const [download, setDownload] = useState(true)
  const last = (k: Kind) => results.find((r) => r.kind === k)
  const common = { onDone, disabled: !!busy }
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <BenchCard kind="cpu" title="CPU" desc="Worker threads each run SHA-256, a prime sieve and recursive fib in turn. Enabling the baseline also runs 1 thread to compute real parallel scaling efficiency."
        body={{ threads, seconds, scaling }} last={last('cpu')} {...common}
        controls={<><Range label="Threads" value={threads} onChange={setThreads} min={1} max={cores * 2} unit="" /><Range label="Duration / run" value={seconds} onChange={setSeconds} min={3} max={20} unit="s" /><Toggle label="Single-thread baseline (scaling)" checked={scaling} onChange={setScaling} /></>} />
      <BenchCard kind="memory" title="Memory bandwidth" desc="Sequential write, read and copy over a Float64Array. Pages are pre-faulted so this measures bandwidth rather than the page-fault path."
        body={{ mb: memMb }} last={last('memory')} {...common}
        controls={<SizeSelect value={memMb} onChange={setMemMb} options={[128, 256, 512, 1024, 1536]} />} />
      <BenchCard kind="disk" title="Disk" desc="dd with O_DIRECT for sequential throughput (bypasses page cache), plus 4 KiB random writes with periodic fsync."
        body={{ mb: diskMb }} last={last('disk')} {...common}
        controls={<SizeSelect value={diskMb} onChange={setDiskMb} options={[128, 256, 512, 1024, 2048]} />} />
      <BenchCard kind="network" title="Network" desc="HEAD latency (median of 5) to four endpoints and, optionally, a 50 MB download from Cloudflare."
        body={{ download }} last={last('network')} {...common}
        controls={<Toggle label="Include 50 MB download test" checked={download} onChange={setDownload} />} />
    </div>
  )
}
