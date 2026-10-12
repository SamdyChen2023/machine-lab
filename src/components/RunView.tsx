import { Chart } from './Chart'
import { Card, Tip, cx } from './ui'
import { fmtNum, GROUP_TITLES, NOISY_CV, type Run } from '../lib/api'

export function RunView({ run }: { run: Run }) {
  const groups = [...new Set(run.results.map((r) => r.group))]
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <Card key={g} title={GROUP_TITLES[g] ?? g}>
          <div className="space-y-6">
            {run.results.filter((r) => r.group === g).map((t) => (
              <div key={t.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-medium text-slate-200">{t.title}</h4>
                  <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">{t.tool}</span>
                  {t.repeats && <span className="text-[11px] text-slate-500">{t.repeats} runs{t.warmup ? ` + ${t.warmup} warm-up` : ''}, median</span>}
                </div>
                {t.error && <p className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">✗ {t.error}</p>}
                {t.metrics && (
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {Object.entries(t.metrics).map(([k, m]) => {
                      const noisy = m.cv > NOISY_CV
                      return (
                        <Tip key={k} text={`min ${fmtNum(m.min)} · max ${fmtNum(m.max)} · samples: ${m.samples.map(fmtNum).join(', ')}${noisy ? ' — high variance, treat the median with care' : ''}`}>
                          <div className="flex items-baseline justify-between border-b border-white/5 py-1.5 text-sm">
                            <span className="font-mono text-xs text-slate-400">{k}</span>
                            <span className="font-mono">
                              <b className="text-slate-100">{fmtNum(m.median)}</b> <span className="text-xs text-slate-500">{m.unit}</span>
                              <span className={cx('ml-2 text-[11px]', noisy ? 'text-amber-300' : 'text-slate-600')}>{noisy ? '⚠ ' : ''}±{m.cv.toFixed(1)}%</span>
                            </span>
                          </div>
                        </Tip>
                      )
                    })}
                  </div>
                )}
                {t.series?.map((s) => (
                  <div key={s.name} className="mt-3 rounded-xl bg-black/20 p-3">
                    <div className="mb-1 text-[11px] text-slate-500">{s.name}</div>
                    <Chart height={90} points={s.points.length} format={fmtNum} series={[{ data: s.points.map((p) => p[1]), color: '#38bdf8', label: s.yLabel }]} />
                    <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">{s.points.map((p) => <span key={p[0]}>{p[0]}</span>)}</div>
                    <div className="text-center text-[10px] text-slate-600">{s.xLabel}</div>
                  </div>
                ))}
                {t.notes && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">ⓘ {t.notes}</p>}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
