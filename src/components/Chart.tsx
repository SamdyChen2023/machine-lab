import { useId } from 'react'

interface Props {
  series: { data: number[]; color: string; label: string }[]
  max?: number          // fixed y max; otherwise auto
  height?: number
  format?: (v: number) => string
  points?: number
}

/** Dependency-free SVG area/line chart. */
export function Chart({ series, max, height = 120, format = (v) => v.toFixed(0), points = 90 }: Props) {
  const id = useId()
  const W = 600
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.data)) * 1.15
  const x = (i: number, n: number) => W - (n - 1 - i) * (W / (points - 1))
  const y = (v: number) => height - (Math.min(v, top) / top) * (height - 6) - 2
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${id}-${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".35" /><stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={height * g} y2={height * g} className="stroke-white/5" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        {series.map((s, si) => {
          if (s.data.length < 2) return null
          const pts = s.data.map((v, i) => `${x(i, s.data.length).toFixed(1)},${y(v).toFixed(1)}`)
          return (
            <g key={si}>
              <polygon points={`${pts[0].split(',')[0]},${height} ${pts.join(' ')} ${W},${height}`} fill={`url(#${id}-${si})`} />
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label} <b className="font-mono text-slate-200">{format(s.data.at(-1) ?? 0)}</b>
          </span>
        ))}
        <span className="ml-auto font-mono text-slate-500">max {format(top)}</span>
      </div>
    </div>
  )
}
