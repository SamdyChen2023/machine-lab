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
  uptime: number; self: { rss: number }; busy: string | null
}
export type Kind = 'cpu' | 'memory' | 'disk' | 'network'
export interface BenchRecord { id: string; kind: Kind; at: number; durationMs: number; params: Record<string, unknown>; result: any }

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

export async function runBench(kind: Kind, body: object): Promise<BenchRecord> {
  const r = await fetch(`/api/bench/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}

export function useResults() {
  const [results, setResults] = useState<BenchRecord[]>([])
  const reload = useRef(() => {})
  reload.current = () => { fetch('/api/results').then((r) => r.json()).then(setResults) }
  useEffect(() => reload.current(), [])
  const clear = async () => { await fetch('/api/results', { method: 'DELETE' }); reload.current() }
  return { results, reload: () => reload.current(), clear }
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
