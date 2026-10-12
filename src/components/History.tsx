import * as Dialog from '@radix-ui/react-dialog'
import { Card, cx } from './ui'
import { Result } from './Benchmarks'
import type { BenchRecord } from '../lib/api'

const summary = (r: BenchRecord) => {
  const d = r.result
  switch (r.kind) {
    case 'cpu': return `score ${d.score} · ${d.threads}T${d.scaling ? ` · ${d.scaling.efficiency}% scaling` : ''}`
    case 'memory': return `W ${d.writeGBs} · R ${d.readGBs} · C ${d.copyGBs} GB/s`
    case 'disk': return `W ${d.writeMBs} · R ${d.readMBs} MB/s · ${d.randWriteIops} IOPS`
    case 'network': return `${d.downloadMbps ?? '–'} Mbit/s · ${d.latency.filter((l: any) => l.ok).length}/${d.latency.length} reachable`
  }
}
const kindTone = { cpu: 'bg-indigo-500/15 text-indigo-300', memory: 'bg-cyan-500/15 text-cyan-300', disk: 'bg-pink-500/15 text-pink-300', network: 'bg-emerald-500/15 text-emerald-300' }

export function History({ results, onClear }: { results: BenchRecord[]; onClear: () => void }) {
  const cpu = results.filter((r) => r.kind === 'cpu').slice(0, 8).reverse()
  const maxScore = Math.max(1, ...cpu.map((r) => r.result.score))
  return (
    <div className="space-y-5">
      {cpu.length > 0 && (
        <Card title="CPU score over time">
          <div className="flex h-32 items-end gap-2">
            {cpu.map((r) => (
              <div key={r.id} className="flex flex-1 flex-col items-center gap-1" title={new Date(r.at).toLocaleString()}>
                <span className="font-mono text-[10px] text-slate-400">{r.result.score}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-cyan-400" style={{ height: `${(r.result.score / maxScore) * 80}%` }} />
                <span className="text-[10px] text-slate-500">{r.result.threads}T</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title={`Results (${results.length})`} right={results.length > 0 && <button onClick={onClear} className="rounded-lg px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10">Clear all</button>}>
        {results.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No benchmarks yet — run one from the Benchmarks tab.</p> : (
          <ul className="divide-y divide-white/5">
            {results.map((r) => (
              <li key={r.id}>
                <Dialog.Root>
                  <Dialog.Trigger className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-white/[.03]">
                    <span className={cx('w-16 rounded-md px-2 py-0.5 text-center text-xs font-medium', kindTone[r.kind])}>{r.kind}</span>
                    <span className="flex-1 font-mono text-slate-300">{summary(r)}</span>
                    <span className="text-xs text-slate-500">{new Date(r.at).toLocaleTimeString()}</span>
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="pop fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
                    <Dialog.Content className="pop fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
                      <Dialog.Title className="text-lg font-semibold capitalize">{r.kind} benchmark</Dialog.Title>
                      <Dialog.Description className="mb-4 text-xs text-slate-500">{new Date(r.at).toLocaleString()} · {(r.durationMs / 1000).toFixed(1)} s · params {JSON.stringify(r.params)}</Dialog.Description>
                      <Result r={r} />
                      <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] text-slate-400">{JSON.stringify(r.result, null, 2)}</pre>
                      <Dialog.Close className="mt-4 w-full rounded-xl bg-white/5 py-2 text-sm hover:bg-white/10">Close</Dialog.Close>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
