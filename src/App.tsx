import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Dashboard } from './components/Dashboard'
import { Benchmarks } from './components/Benchmarks'
import { History } from './components/History'
import { cx } from './components/ui'
import { useMetrics, useResults, useSystem } from './lib/api'

const tab = 'rounded-lg px-4 py-2 text-sm font-medium text-slate-400 outline-none transition hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400 data-[state=active]:bg-white/10 data-[state=active]:text-white'

export default function App() {
  const { samples, latest, connected } = useMetrics()
  const info = useSystem()
  const { results, reload, clear } = useResults()
  return (
    <Tooltip.Provider>
      <div className="mx-auto max-w-6xl px-5 pb-16">
        <header className="flex flex-wrap items-center gap-4 py-8">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-xl shadow-lg shadow-indigo-500/30">⚡</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Machine Lab</h1>
            <p className="text-sm text-slate-500">{info ? `${info.hostname} · ${info.cores} vCPU · ${(info.memTotal / 2 ** 30).toFixed(1)} GiB` : 'loading…'}</p>
          </div>
          <span className={cx('ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs', connected ? 'border-emerald-400/30 text-emerald-300' : 'border-rose-400/30 text-rose-300')}>
            <i className={cx('h-2 w-2 rounded-full', connected ? 'bg-emerald-400' : 'bg-rose-400')} />{connected ? 'live · 1 Hz' : 'disconnected'}
          </span>
        </header>

        <Tabs.Root defaultValue="dashboard">
          <Tabs.List className="mb-6 inline-flex gap-1 rounded-xl border border-white/8 bg-ink-900/80 p-1">
            <Tabs.Trigger className={tab} value="dashboard">Dashboard</Tabs.Trigger>
            <Tabs.Trigger className={tab} value="bench">Benchmarks</Tabs.Trigger>
            <Tabs.Trigger className={tab} value="history">History</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="dashboard" className="pop outline-none"><Dashboard samples={samples} info={info} /></Tabs.Content>
          <Tabs.Content value="bench" forceMount className="pop outline-none data-[state=inactive]:hidden"><Benchmarks cores={info?.cores ?? 2} busy={latest?.busy ?? null} results={results} onDone={reload} />
            {latest?.busy && <p className="mt-4 text-center text-xs text-amber-300">A "{latest.busy}" benchmark is running — switch to Dashboard to watch it live.</p>}
          </Tabs.Content>
          <Tabs.Content value="history" className="pop outline-none"><History results={results} onClear={clear} /></Tabs.Content>
        </Tabs.Root>
      </div>
    </Tooltip.Provider>
  )
}
