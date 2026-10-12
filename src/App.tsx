import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Dashboard } from './components/Dashboard'
import { SystemTab } from './components/SystemTab'
import { RunPanel } from './components/RunPanel'
import { ResultsTab } from './components/ResultsTab'
import { CompareTab } from './components/CompareTab'
import { cx } from './components/ui'
import { useMetrics, useRuns, useSystem } from './lib/api'
import { useState } from 'react'

const tabCls = 'rounded-lg px-4 py-2 text-sm font-medium text-slate-400 outline-none transition hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400 data-[state=active]:bg-white/10 data-[state=active]:text-white'

export default function App() {
  const { samples, latest, connected } = useMetrics()
  const info = useSystem()
  const { runs, reload } = useRuns()
  const [tab, setTab] = useState('dashboard')
  const [selected, setSelected] = useState<string[]>([])
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

        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="mb-6 inline-flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-900/80 p-1">
            {[['dashboard', 'Dashboard'], ['system', 'System'], ['bench', 'Benchmarks'], ['results', 'Results'], ['compare', 'Compare']].map(([v, t]) => <Tabs.Trigger key={v} className={tabCls} value={v}>{t}</Tabs.Trigger>)}
          </Tabs.List>
          <Tabs.Content value="dashboard" className="pop outline-none"><Dashboard samples={samples} info={info} /></Tabs.Content>
          <Tabs.Content value="system" className="pop outline-none"><SystemTab /></Tabs.Content>
          {/* forceMount keeps a running benchmark's progress and last result alive while you switch tabs */}
          <Tabs.Content value="bench" forceMount className="pop outline-none data-[state=inactive]:hidden"><RunPanel job={latest?.job ?? null} onFinished={reload} /></Tabs.Content>
          <Tabs.Content value="results" className="pop outline-none"><ResultsTab runs={runs} selected={selected} setSelected={setSelected} reload={reload} goCompare={() => setTab('compare')} /></Tabs.Content>
          <Tabs.Content value="compare" className="pop outline-none"><CompareTab runs={runs} selected={selected} setSelected={setSelected} /></Tabs.Content>
        </Tabs.Root>
      </div>
    </Tooltip.Provider>
  )
}
