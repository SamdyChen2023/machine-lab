import { Chart } from './Chart'
import { Bar, Card, Stat, Tip } from './ui'
import { fmtBytes, fmtRate, fmtUptime, type Sample, type SystemInfo } from '../lib/api'

export function Dashboard({ samples, info }: { samples: Sample[]; info?: SystemInfo }) {
  const s = samples.at(-1)
  if (!s) return <p className="py-20 text-center text-slate-500">Waiting for the first sample…</p>
  const col = (f: (x: Sample) => number) => samples.map(f)
  const memPct = (s.mem.used / s.mem.total) * 100
  const stealTone = s.steal > 10 ? 'bad' : s.steal > 2 ? 'warn' : undefined

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="CPU" value={`${s.cpu.toFixed(1)}%`} sub={`${info?.cores ?? s.cores.length} vCPU`} tone={s.cpu > 90 ? 'warn' : undefined} />
        <Tip text="Time the hypervisor withheld a vCPU from this VM. High steal = noisy neighbour or CPU quota throttling.">
          <div><Stat label="CPU steal" value={`${s.steal.toFixed(1)}%`} sub="hypervisor stolen" tone={stealTone} /></div>
        </Tip>
        <Stat label="Memory" value={`${memPct.toFixed(0)}%`} sub={`${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`} tone={memPct > 85 ? 'bad' : undefined} />
        <Stat label="Load 1/5/15" value={s.load[0].toFixed(2)} sub={s.load.map((l) => l.toFixed(2)).join(' · ')} />
        <Stat label="Network" value={fmtRate(s.net.rx + s.net.tx)} sub={`↓ ${fmtRate(s.net.rx)}  ↑ ${fmtRate(s.net.tx)}`} />
        <Stat label="Disk I/O" value={fmtRate(s.disk.read + s.disk.write)} sub={`R ${fmtRate(s.disk.read)}  W ${fmtRate(s.disk.write)}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="CPU utilisation" className="lg:col-span-2" right={s.busy && <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs text-amber-300">benchmark: {s.busy}</span>}>
          <Chart max={100} height={150} format={(v) => `${v.toFixed(0)}%`}
            series={[{ data: col((x) => x.cpu), color: '#818cf8', label: 'total' }, { data: col((x) => x.steal), color: '#fb7185', label: 'steal' }]} />
        </Card>
        <Card title="Per-core">
          <div className="space-y-3">
            {s.cores.map((c, i) => (
              <div key={i}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-400">core {i}</span><span className="font-mono">{c.toFixed(0)}%</span></div>
                <Bar value={c} tone={c > 85 ? 'amber' : 'indigo'} />
              </div>
            ))}
            {info && (
              <div className="border-t border-white/5 pt-3">
                <div className="truncate text-xs text-slate-400" title={info.cpuModel}>{info.cpuModel}</div>
                <div className="mt-2 flex flex-wrap gap-1">{info.flags.map((f) => <span key={f} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">{f}</span>)}</div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Card title="Memory">
          <Chart max={s.mem.total / 1048576} height={110} format={(v) => `${v.toFixed(0)} MB`}
            series={[{ data: col((x) => x.mem.used / 1048576), color: '#22d3ee', label: 'used' }]} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            {[['available', s.mem.available], ['cache', s.mem.cached], ['swap', s.mem.swapTotal ? s.mem.swapUsed : 0]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-white/5 py-2"><div className="font-mono text-slate-100">{l === 'swap' && !s.mem.swapTotal ? 'none' : fmtBytes(v as number, 0)}</div><div className="text-slate-500">{l}</div></div>
            ))}
          </div>
        </Card>
        <Card title="Network">
          <Chart height={110} format={fmtRate} series={[{ data: col((x) => x.net.rx), color: '#34d399', label: 'rx' }, { data: col((x) => x.net.tx), color: '#f59e0b', label: 'tx' }]} />
        </Card>
        <Card title="Disk I/O">
          <Chart height={110} format={fmtRate} series={[{ data: col((x) => x.disk.read), color: '#38bdf8', label: 'read' }, { data: col((x) => x.disk.write), color: '#f472b6', label: 'write' }]} />
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Top processes by memory">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="pb-2 font-medium">PID</th><th className="pb-2 font-medium">Name</th><th className="pb-2 text-right font-medium">CPU%</th><th className="pb-2 text-right font-medium">RSS</th></tr></thead>
            <tbody className="font-mono text-slate-300">
              {s.procs.map((p) => <tr key={p.pid} className="border-t border-white/5"><td className="py-1.5 text-slate-500">{p.pid}</td><td className="max-w-[10rem] truncate">{p.name}</td><td className="text-right">{p.cpu.toFixed(1)}</td><td className="text-right">{fmtBytes(p.rss, 0)}</td></tr>)}
            </tbody>
          </table>
        </Card>
        <Card title="System">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            {[['Host', info?.hostname], ['OS', info?.os], ['Kernel', `${info?.kernel} · ${info?.arch}`], ['Node', info?.node], ['Uptime', fmtUptime(s.uptime)], ['API RSS', fmtBytes(s.self.rss, 0)]].map(([k, v]) => (
              <div key={k as string} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-mono text-slate-200">{v}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  )
}
