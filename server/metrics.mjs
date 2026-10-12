// Live system metrics sampled from /proc (Linux only).
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'

const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

function cpuTimes() {
  const out = []
  for (const line of read('/proc/stat').split('\n')) {
    if (!line.startsWith('cpu')) continue
    const [name, ...f] = line.trim().split(/\s+/)
    const n = f.map(Number)
    const idle = n[3] + (n[4] || 0)
    out.push({ name, idle, steal: n[7] || 0, total: n.reduce((a, b) => a + b, 0) })
  }
  // non-Linux: no /proc/stat, keep a zeroed entry so sampling doesn't crash
  return out.length ? out : [{ name: 'cpu', idle: 0, steal: 0, total: 0 }]
}

function netBytes() {
  let rx = 0, tx = 0
  for (const line of read('/proc/net/dev').split('\n').slice(2)) {
    const [iface, rest] = line.split(':')
    if (!rest || iface.trim() === 'lo') continue
    const f = rest.trim().split(/\s+/).map(Number)
    rx += f[0]; tx += f[8]
  }
  return { rx, tx }
}

function diskSectors() {
  let r = 0, w = 0
  for (const line of read('/proc/diskstats').split('\n')) {
    const f = line.trim().split(/\s+/)
    // whole-disk devices only (vda, sda, nvme0n1), not partitions
    if (/^(vd[a-z]|sd[a-z]|nvme\d+n\d+)$/.test(f[2] || '')) { r += Number(f[5]); w += Number(f[9]) }
  }
  return { r: r * 512, w: w * 512 }
}

function meminfo() {
  const m = {}
  for (const line of read('/proc/meminfo').split('\n')) {
    const [k, v] = line.split(':')
    if (v) m[k] = parseInt(v) * 1024
  }
  return {
    total: m.MemTotal, free: m.MemFree, available: m.MemAvailable,
    cached: m.Cached, buffers: m.Buffers,
    used: m.MemTotal - m.MemAvailable,
    swapTotal: m.SwapTotal, swapUsed: m.SwapTotal - m.SwapFree,
  }
}

function topProcs() {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid,pcpu,rss,comm', '--sort=-rss', '--no-headers'], (err, out) => {
      if (err) return resolve([])
      resolve(out.trim().split('\n').slice(0, 6).map((l) => {
        const [pid, cpu, rss, ...c] = l.trim().split(/\s+/)
        return { pid: +pid, cpu: +cpu, rss: +rss * 1024, name: c.join(' ') }
      }))
    })
  })
}

export function staticInfo() {
  const cpus = os.cpus()
  const release = read('/etc/os-release').match(/PRETTY_NAME="(.+)"/)?.[1]
  return {
    hostname: os.hostname(), os: release || os.type(), kernel: os.release(), arch: os.arch(),
    cpuModel: cpus[0]?.model, cores: cpus.length, memTotal: os.totalmem(),
    node: process.version, uptime: os.uptime(),
    flags: (read('/proc/cpuinfo').match(/^flags\s*:(.*)$/m)?.[1] || '').trim().split(/\s+/)
      .filter((f) => ['avx', 'avx2', 'avx512f', 'amx_tile', 'aes', 'sse4_2', 'bmi2'].includes(f)),
  }
}

let prev = { t: Date.now(), cpu: cpuTimes(), net: netBytes(), disk: diskSectors() }
let procs = []
setInterval(async () => { procs = await topProcs() }, 3000).unref()

export async function sample() {
  const now = Date.now()
  const cpu = cpuTimes(), net = netBytes(), disk = diskSectors()
  const dt = Math.max((now - prev.t) / 1000, 0.001)
  const pct = (a, b) => (!a || !b || b.total === a.total ? 0 : (1 - (b.idle - a.idle) / (b.total - a.total)) * 100)
  const s = {
    t: now,
    cpu: pct(prev.cpu[0], cpu[0]),
    steal: cpu[0].total === prev.cpu[0].total ? 0 : ((cpu[0].steal - prev.cpu[0].steal) / (cpu[0].total - prev.cpu[0].total)) * 100,
    cores: cpu.slice(1).map((c, i) => pct(prev.cpu[i + 1], c)),
    load: os.loadavg(),
    mem: meminfo(),
    net: { rx: (net.rx - prev.net.rx) / dt, tx: (net.tx - prev.net.tx) / dt },
    disk: { read: (disk.r - prev.disk.r) / dt, write: (disk.w - prev.disk.w) / dt },
    procs,
    uptime: os.uptime(),
    self: { rss: process.memoryUsage().rss },
  }
  prev = { t: now, cpu, net, disk }
  return s
}
