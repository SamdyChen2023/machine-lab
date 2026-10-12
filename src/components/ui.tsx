import * as Progress from '@radix-ui/react-progress'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const cx = (...a: (string | false | undefined | null)[]) => a.filter(Boolean).join(' ')

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-white/8 bg-ink-900/80 p-5 shadow-xl shadow-black/20 backdrop-blur', className)}>
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-slate-300">{title}</h3>{right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Bar({ value, tone = 'indigo', busy }: { value: number; tone?: 'indigo' | 'cyan' | 'amber' | 'rose'; busy?: boolean }) {
  const tones = { indigo: 'from-indigo-500 to-violet-400', cyan: 'from-cyan-500 to-sky-400', amber: 'from-amber-500 to-orange-400', rose: 'from-rose-500 to-pink-400' }
  const v = Math.max(0, Math.min(100, value))
  return (
    <Progress.Root value={v} className="relative h-2 overflow-hidden rounded-full bg-ink-700">
      <Progress.Indicator className={cx('h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out', tones[tone], busy && 'pulse-bar')} style={{ width: `${v}%` }} />
    </Progress.Root>
  )
}

export function Tip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="pop z-50 max-w-xs rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs text-slate-200 shadow-xl">
          {text}<Tooltip.Arrow className="fill-ink-800" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/80 p-4">
      <div className="text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className={cx('mt-1 font-mono text-2xl font-semibold', tone === 'bad' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-300' : 'text-slate-100')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
