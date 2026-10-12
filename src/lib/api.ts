import { useEffect, useRef, useState } from 'react'

export interface SystemInfo {
  hostname: string; os: string; kernel: string; arch: string; cpuModel: string; cores: number
  memTotal: number; node: string; uptime: number; flags: string[]
}
export interface Sample {
  t: number; cpu: number; steal: number; cores: number[]; load: number[]
  mem: { total: number; free: number; available: number; cached: number; buffers: number; used: number; swapTotal: number; swapUsed: number }
  net: { rx: number; tx: number }; disk: { read: number; write: number }
  procs: { pid: number; cpu: number; rss: number; name: string }[]
  uptime: number; self: { rss: number }; busy: string | null; job: Job | null
}
export const HISTORY = 90

/** Subscribes to the SSE metrics stream and keeps a rolling window of samples. */
export function useMetrics() {
  const [samples, setSamples] = useState<Sample[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => setSamples((prev) => [...prev.slice(-(HISTORY - 1)), JSON.parse(e.data)])
    return () => es.close()
  }, [])
  return { samples, latest: samples.at(-1), connected }
}

export function useSystem() {
  const [info, setInfo] = useState<SystemInfo>()
  useEffect(() => { fetch('/api/system').then((r) => r.json()).then(setInfo) }, [])
  return info
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error || r.statusText)
  return j as T
}
const post = <T,>(url: string, body: unknown) => req<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export interface Job { id: string; status: 'running' | 'done' | 'error' | 'cancelled'; profile: string; groups: string[]; startedAt: number; progress: { done: number; total: number; label: string; rep: number; reps: number }; runId?: string; error?: string | null }
export interface MetricAgg { unit: string; better: 'higher' | 'lower'; median: number; mean: number; min: number; max: number; cv: number; n: number; samples: number[] }
export interface Series { name: string; xLabel: string; yLabel: string; points: [number, number][] }
export interface TestResult { id: string; group: string; title: string; tool: string; repeats?: number; warmup?: number; metrics?: Record<string, MetricAgg>; series?: Series[]; notes?: string; error?: string }
export interface Run {
  schema: 1; id: string; label: string; provider: string | null; pricePerHour: number | null; profile: string; groups: string[]; startedAt: number; durationMs: number
  lab: { version: string; commit: string | null }; forceBuiltin: boolean; fingerprint: Fingerprint; results: TestResult[]
}
export interface RunSummary { id: string; label: string; provider: string | null; profile: string; groups: string[]; startedAt: number; durationMs: number; tests: number; errors: number; virt?: string; cpu?: string; vcpus?: number }
export interface Fingerprint {
  host: { hostname: string }; virtualization: { label: string; class: string; evidence: string[] }
  security: { checks: { id: string; label: string; ok: boolean | null }[] }
  tools: Record<string, string | null>
}
export interface SummaryRow { section: string; label: string; value: string }
export interface CompareCell { v: number; cv: number; n: number; min: number; max: number }
export interface CompareResult {
  machines: { name: string; provider: string | null; pricePerHour: number | null; profile: string; startedAt: number }[]
  fingerprint: { section: string; label: string; values: string[]; differs: boolean }[]
  groups: { id: string; scores: (number | null)[]; tests: { id: string; title: string; tool: string; metrics: { key: string; unit: string; better: string; values: (CompareCell | null)[]; ratios: (number | null)[]; best: number | null; noisy: boolean[] }[] }[] }[]
  overall: (number | null)[]; warnings: string[]; scoreNote: string
}

export const api = {
  fingerprint: (egress: boolean, redact: boolean) => req<{ fingerprint: Fingerprint; summary: SummaryRow[] }>(`/api/fingerprint?egress=${egress ? 1 : 0}&redact=${redact ? 1 : 0}`),
  plan: (profile: string) => req<{ tools: { fio: boolean; sysbench: boolean }; tests: { id: string; group: string; title: string }[]; params: Record<string, number | boolean> }>(`/api/plan?profile=${profile}`),
  startJob: (body: object) => post<Job>('/api/jobs', body),
  currentJob: () => req<Job | null>('/api/jobs/current'),
  cancelJob: () => req<{ ok: boolean }>('/api/jobs/current', { method: 'DELETE' }),
  runs: () => req<RunSummary[]>('/api/runs'),
  run: (id: string) => req<Run>(`/api/runs/${encodeURIComponent(id)}`),
  deleteRun: (id: string) => req<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importRun: (run: unknown) => post<{ id: string }>('/api/runs/import', run),
  compare: (ids: string[], runs: Run[]) => post<CompareResult>('/api/compare', { ids, runs }),
}

export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const reload = useRef(() => {})
  reload.current = () => { api.runs().then(setRuns).catch(() => {}) }
  useEffect(() => reload.current(), [])
  return { runs, reload: () => reload.current() }
}

export const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2))
export const NOISY_CV = 25
export const GROUP_TITLES: Record<string, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk', network: 'Network', workload: 'Workloads' }
export const download = (name: string, data: unknown) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

export const fmtBytes = (n: number, d = 1) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : d)} ${u[i]}`
}
export const fmtRate = (n: number) => `${fmtBytes(n)}/s`
export const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`
}
