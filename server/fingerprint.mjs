// Environment fingerprint: what is this sandbox made of? Everything is best-effort and Linux-oriented;
// any probe that fails yields null/"unknown" instead of throwing.
import fs from 'node:fs'
import os from 'node:os'
import { read, exists, run, has } from './util.mjs'

const kv = (text) => {
  const o = {}
  for (const l of text.split('\n')) { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim() }
  return o
}
const num = (s) => { const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null }
const first = (s) => (s || '').split('\n')[0].trim()
const safe = (fn, fallback = null) => { try { return fn() } catch { return fallback } }
const gib = (b) => (b == null ? '?' : b >= 2 ** 40 ? `${(b / 2 ** 40).toFixed(1)} TiB` : b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GiB` : `${(b / 2 ** 20).toFixed(0)} MiB`)

// ---------------- CPU ----------------
async function cpu() {
  const l = kv((await run('lscpu')).stdout)
  const ci = kv(read('/proc/cpuinfo').split('\n\n')[0] || '')
  const flags = (l.Flags || ci.flags || '').split(/\s+/).filter(Boolean)
  const vulns = {}
  for (const f of safe(() => fs.readdirSync('/sys/devices/system/cpu/vulnerabilities'), [])) vulns[f] = first(read(`/sys/devices/system/cpu/vulnerabilities/${f}`))
  const cgPath = (read('/proc/self/cgroup').match(/^0::(.*)$/m)?.[1] || '').trim()
  const cg = (f) => read(`/sys/fs/cgroup${cgPath}/${f}`) || read(`/sys/fs/cgroup/${f}`)
  const [quota, period] = first(cg('cpu.max')).split(' ')
  const cstat = kv(cg('cpu.stat').replace(/ /g, ':'))
  return {
    model: l['Model name'] || ci['model name'] || os.cpus()[0]?.model || null,
    vendor: l['Vendor ID'] || ci.vendor_id || null,
    family: num(l['CPU family'] || ci['cpu family']), modelId: num(l.Model || ci.model), stepping: num(l.Stepping || ci.stepping),
    microcode: ci.microcode || null,
    arch: l.Architecture || os.arch(),
    vcpus: os.availableParallelism(), onlineCpus: os.cpus().length,
    sockets: num(l['Socket(s)']), coresPerSocket: num(l['Core(s) per socket']), threadsPerCore: num(l['Thread(s) per core']),
    mhz: num(l['CPU MHz']) ?? num(ci['cpu MHz']), maxMhz: num(l['CPU max MHz']), bogomips: num(l.BogoMIPS || ci.bogomips),
    caches: { l1d: l['L1d cache'] || null, l1i: l['L1i cache'] || null, l2: l['L2 cache'] || null, l3: l['L3 cache'] || null },
    numaNodes: num(l['NUMA node(s)']),
    flags,
    vulnerabilities: vulns,
    cgroupQuota: quota && quota !== 'max' ? { quotaUs: Number(quota), periodUs: Number(period), cpus: Number(quota) / Number(period) } : (quota ? { unlimited: true } : null),
    throttle: cstat.nr_throttled != null ? { periods: num(cstat.nr_periods), throttled: num(cstat.nr_throttled), throttledUsec: num(cstat.throttled_usec) } : null,
    hypervisorVendor: l['Hypervisor vendor'] || null, virtualizationType: l['Virtualization type'] || null,
  }
}

// ---------------- virtualization / isolation ----------------
async function virtualization(cpuInfo) {
  const ev = []
  const dmi = Object.fromEntries(['sys_vendor', 'product_name', 'bios_vendor', 'board_vendor'].map((n) => [n, first(read(`/sys/class/dmi/id/${n}`))]).filter(([, v]) => v))
  const hvFlag = cpuInfo.flags.includes('hypervisor')
  if (hvFlag) ev.push('CPU flag "hypervisor" is set')
  if (cpuInfo.hypervisorVendor) ev.push(`lscpu hypervisor vendor: ${cpuInfo.hypervisorVendor}`)
  if (Object.keys(dmi).length) ev.push(`DMI: ${Object.values(dmi).join(' / ')}`); else ev.push('no DMI/SMBIOS data exposed')
  const hvType = first(read('/sys/hypervisor/type')); if (hvType) ev.push(`/sys/hypervisor/type: ${hvType}`)
  const cmdline = read('/proc/cmdline')
  const virtioMmio = /virtio_mmio\.device=/.test(cmdline) || safe(() => fs.readdirSync('/sys/devices/platform').some((n) => n.startsWith('virtio-mmio')), false)
  if (virtioMmio) ev.push('virtio-mmio devices present (typical of microVMs such as Firecracker / Cloud Hypervisor)')
  const hasPci = exists('/sys/bus/pci/devices') && safe(() => fs.readdirSync('/sys/bus/pci/devices').length, 0) > 0
  ev.push(hasPci ? 'PCI bus has devices' : 'no PCI devices')

  const release = os.release()
  const dmesg = (await run('dmesg')).stdout.slice(0, 4000)
  const gvisor = /gvisor|runsc/i.test(dmesg + read('/proc/version')) || release === '4.4.0'
  if (gvisor) ev.push(release === '4.4.0' ? 'kernel release is the fixed value 4.4.0 reported by gVisor' : 'gVisor marker in dmesg or /proc/version')

  const cg1 = read('/proc/1/cgroup')
  const containerSignals = []
  if (exists('/.dockerenv')) containerSignals.push('/.dockerenv')
  if (exists('/run/.containerenv')) containerSignals.push('/run/.containerenv')
  if (/docker|kubepods|containerd|crio|lxc|libpod/.test(cg1)) containerSignals.push('container runtime in /proc/1/cgroup')
  if (process.env.KUBERNETES_SERVICE_HOST) containerSignals.push('Kubernetes env vars')
  if (/microsoft|wsl/i.test(read('/proc/version'))) ev.push('WSL kernel string')
  containerSignals.forEach((s) => ev.push(`container signal: ${s}`))

  const microHint = virtioMmio || (!hasPci && !Object.keys(dmi).length)
  const vmm = cpuInfo.hypervisorVendor || 'unknown VMM'
  let cls, label
  if (gvisor) { cls = 'gvisor'; label = 'gVisor (user-space kernel)' }
  else if (hvFlag && containerSignals.length) { cls = 'container-in-vm'; label = `Container inside a ${microHint ? 'microVM' : 'VM'} (${vmm})` }
  else if (hvFlag && microHint) { cls = 'microvm'; label = `microVM (${vmm})` }
  else if (hvFlag) { cls = 'vm'; label = `Virtual machine (${cpuInfo.hypervisorVendor || dmi.sys_vendor || 'hypervisor'})` }
  else if (containerSignals.length) { cls = 'container'; label = 'Container (shared host kernel)' }
  else { cls = 'bare-metal-or-unknown'; label = 'Bare metal or undetectable' }
  return { class: cls, label, hypervisor: cpuInfo.hypervisorVendor || hvType || null, dmi, evidence: ev, note: 'Heuristic classification from the signals listed in evidence.' }
}

// ---------------- memory ----------------
function memory() {
  const m = {}
  for (const l of read('/proc/meminfo').split('\n')) { const [k, v] = l.split(':'); if (v) m[k] = parseInt(v) * 1024 }
  const lim = (f) => { const v = first(read(`/sys/fs/cgroup/${f}`)); return v && v !== 'max' ? Number(v) : v === 'max' ? 'max' : null }
  const thp = read('/sys/kernel/mm/transparent_hugepage/enabled').match(/\[(\w+)\]/)?.[1] || null
  return { total: m.MemTotal ?? os.totalmem(), swapTotal: m.SwapTotal ?? 0, hugepagesTotal: parseInt(kv(read('/proc/meminfo')).HugePages_Total) || 0, thp, cgroupMax: lim('memory.max'), cgroupSwapMax: lim('memory.swap.max'), overcommit: first(read('/proc/sys/vm/overcommit_memory')) || null }
}

// ---------------- storage ----------------
function mounts() {
  return read('/proc/self/mountinfo').split('\n').filter(Boolean).map((l) => {
    const [pre, post] = l.split(' - ')
    const f = pre.split(' '), g = post.split(' ')
    return { mountPoint: f[4].replace(/\\040/g, ' '), opts: f[5], fstype: g[0], source: g[1], superOpts: g.slice(2).join(' ') }
  })
}
function fsFor(target, mt) {
  const m = mt.filter((x) => target === x.mountPoint || target.startsWith(x.mountPoint === '/' ? '/' : x.mountPoint + '/')).sort((a, b) => b.mountPoint.length - a.mountPoint.length)[0]
  const st = safe(() => fs.statfsSync(target))
  return {
    path: target, mountPoint: m?.mountPoint ?? null, fstype: m?.fstype ?? null, source: m?.source ?? null,
    options: m ? m.opts.split(',').filter((o) => ['ro', 'rw', 'noatime', 'relatime', 'nosuid', 'nodev', 'noexec', 'sync'].includes(o)).join(',') : null,
    overlay: m?.fstype === 'overlay' ? m.superOpts.replace(/(lowerdir|upperdir|workdir)=[^,]*/g, '$1=…') : null,
    totalBytes: st ? st.blocks * st.bsize : null, freeBytes: st ? st.bavail * st.bsize : null, inodes: st?.files ?? null, inodesFree: st?.ffree ?? null,
  }
}
function storage() {
  const mt = mounts()
  const targets = [...new Set(['/', os.tmpdir(), os.homedir(), '/dev/shm', '/var'].filter(exists))]
  const blockDevices = safe(() => fs.readdirSync('/sys/block'), []).filter((d) => !/^(loop|ram|zram|nbd)/.test(d)).map((d) => {
    const b = (f) => first(read(`/sys/block/${d}/${f}`))
    return { name: d, sizeBytes: (num(b('size')) ?? 0) * 512, rotational: b('queue/rotational') === '1', // unreliable on virtual disks
       readOnly: b('ro') === '1', scheduler: b('queue/scheduler').match(/\[(\S+)\]/)?.[1] || b('queue/scheduler') || null, model: b('device/model') || null, logicalBlock: num(b('queue/logical_block_size')) }
  })
  return { filesystems: targets.map((t) => fsFor(t, mt)), blockDevices }
}

// ---------------- network ----------------
async function network(egress) {
  const ifaces = Object.entries(os.networkInterfaces()).filter(([n]) => n !== 'lo').map(([name, addrs]) => ({
    name, mtu: num(first(read(`/sys/class/net/${name}/mtu`))), speedMbps: num(first(read(`/sys/class/net/${name}/speed`))), mac: addrs?.[0]?.mac,
    addresses: (addrs ?? []).map((a) => `${a.address}/${a.cidr?.split('/')[1] ?? ''}`),
  }))
  const dns = read('/etc/resolv.conf').split('\n').filter((l) => l.startsWith('nameserver')).map((l) => l.split(/\s+/)[1])
  const ipv6 = Object.values(os.networkInterfaces()).flat().some((a) => a && a.family === 'IPv6' && !a.internal && !a.address.startsWith('fe80'))
  let eg = null
  if (egress) {
    try {
      const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(4000) })
      const j = await r.json()
      eg = { ip: j.ip, city: j.city, region: j.region, country: j.country, org: j.org, timezone: j.timezone }
    } catch { eg = { error: 'lookup failed or blocked' } }
  }
  return { interfaces: ifaces, dns, ipv6, egress: eg }
}

// ---------------- security & capabilities ----------------
async function capabilities() {
  const st = kv(read('/proc/self/status'))
  const seccomp = { 0: 'disabled', 1: 'strict', 2: 'filter' }[st.Seccomp] ?? null
  const kvmOk = exists('/dev/kvm') && safe(() => (fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK), true), false)
  const probe = async (cmd, args) => ((await has(cmd)) ? (await run(cmd, args, { timeout: 8000 })).ok : null)
  const [userns, sudo, ping] = await Promise.all([probe('unshare', ['-Ur', 'true']), probe('sudo', ['-n', 'true']), probe('ping', ['-c1', '-W1', '127.0.0.1'])])
  const iou = first(read('/proc/sys/kernel/io_uring_disabled'))
  return {
    uid: process.getuid?.(), pid1: first(read('/proc/1/comm')) || null,
    seccomp, noNewPrivs: st.NoNewPrivs === '1', capEff: st.CapEff || null, lsm: first(read('/sys/kernel/security/lsm')) || null,
    checks: [
      { id: 'kvm', label: '/dev/kvm usable (nested virtualization)', ok: kvmOk },
      { id: 'fuse', label: '/dev/fuse present', ok: exists('/dev/fuse') },
      { id: 'tun', label: '/dev/net/tun present', ok: exists('/dev/net/tun') },
      { id: 'userns', label: 'unprivileged user namespaces', ok: userns },
      { id: 'sudo', label: 'passwordless sudo', ok: sudo },
      { id: 'raw', label: 'raw sockets (ping)', ok: ping },
      { id: 'docker', label: 'Docker daemon socket', ok: exists('/var/run/docker.sock') },
      { id: 'io_uring', label: 'io_uring enabled', ok: iou === '' ? null : iou === '0' },
      { id: 'systemd', label: 'systemd as PID 1', ok: first(read('/proc/1/comm')) === 'systemd' },
    ],
  }
}

// ---------------- tools & runtime ----------------
async function tools() {
  const ver = async (cmd, args, re) => (await has(cmd)) ? (((await run(cmd, args, { timeout: 8000 })).stdout + '').match(re)?.[1] ?? 'installed') : null
  const [python, gcc, git, fio, sysbench, stress, npm, docker] = await Promise.all([
    ver('python3', ['--version'], /([\d.]+)/), ver('gcc', ['--version'], /([\d.]+)\s*$/m), ver('git', ['--version'], /([\d.]+)/),
    ver('fio', ['--version'], /fio-([\d.]+)/), ver('sysbench', ['--version'], /([\d.]+)/), ver('stress-ng', ['--version'], /([\d.]+)/),
    ver('npm', ['--version'], /([\d.]+)/), ver('docker', ['--version'], /([\d.]+)/),
  ])
  return { node: process.version, npm, python, gcc, git, fio, sysbench, 'stress-ng': stress, docker }
}

export async function collectFingerprint({ egress = true } = {}) {
  const c = await cpu()
  const [virt, net, caps, tl] = await Promise.all([virtualization(c), network(egress), capabilities(), tools()])
  const osr = kv(read('/etc/os-release').replace(/=/g, ':').replace(/"/g, ''))
  const clean = (read('/proc/cmdline').trim().split(/\s+/)).filter((a) => !/token|key|secret|pass|auth/i.test(a)).join(' ')
  return {
    schema: 1, collectedAt: new Date().toISOString(),
    host: { hostname: os.hostname(), os: osr.PRETTY_NAME || os.type(), kernel: os.release(), kernelVersion: os.version(), arch: os.arch(), uptimeSec: Math.round(os.uptime()), clocksource: first(read('/sys/devices/system/clocksource/clocksource0/current_clocksource')) || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, cmdline: clean },
    virtualization: virt, cpu: c, memory: memory(), storage: storage(), network: net, security: caps, tools: tl,
  }
}

/** Strip identifying data (hostname, IPs, MACs) before sharing a result file. */
export function redact(fp) {
  const x = JSON.parse(JSON.stringify(fp))
  x.host.hostname = 'redacted'; x.host.cmdline = ''
  for (const i of x.network.interfaces) { delete i.mac; i.addresses = [] }
  x.network.dns = []
  if (x.network.egress?.ip) x.network.egress.ip = 'redacted'
  x.redacted = true
  return x
}

/** Flat, human-readable rows used by the System tab and the comparison table. */
export function summarize(fp) {
  const { host, cpu: c, memory: m, storage: s, network: n, security: sec, tools: t, virtualization: v } = fp
  const rows = []
  const add = (section, label, value) => rows.push({ section, label, value: value == null || value === '' ? '—' : String(value) })
  add('Identity', 'Hostname', host.hostname); add('Identity', 'OS', host.os); add('Identity', 'Kernel', `${host.kernel} (${host.arch})`)
  add('Identity', 'Clock source', host.clocksource)
  add('Isolation', 'Class', v.label); add('Isolation', 'Hypervisor', v.hypervisor); add('Isolation', 'PID 1', sec.pid1)
  add('CPU', 'Model', c.model); add('CPU', 'Vendor / family-model-stepping', `${c.vendor ?? '?'} / ${c.family ?? '?'}-${c.modelId ?? '?'}-${c.stepping ?? '?'}`)
  add('CPU', 'vCPUs', c.vcpus); add('CPU', 'Topology', `${c.sockets ?? '?'} socket × ${c.coresPerSocket ?? '?'} core × ${c.threadsPerCore ?? '?'} thread`)
  add('CPU', 'Frequency', c.mhz ? `${c.mhz.toFixed(0)} MHz${c.maxMhz ? ` (max ${c.maxMhz.toFixed(0)})` : ''}` : null)
  add('CPU', 'Caches (L1d / L2 / L3)', `${c.caches.l1d ?? '?'} / ${c.caches.l2 ?? '?'} / ${c.caches.l3 ?? '?'}`)
  add('CPU', 'ISA extensions', ['sse4_2', 'avx', 'avx2', 'avx512f', 'amx_tile', 'aes', 'sha_ni', 'bmi2'].filter((f) => c.flags.includes(f)).join(' '))
  add('CPU', 'cgroup CPU quota', c.cgroupQuota ? (c.cgroupQuota.unlimited ? 'unlimited' : `${c.cgroupQuota.cpus} CPUs`) : 'no cgroup v2 cpu.max')
  add('CPU', 'Throttled periods', c.throttle ? `${c.throttle.throttled} / ${c.throttle.periods}` : null)
  const vv = Object.values(c.vulnerabilities); add('CPU', 'Vulnerability status', vv.length ? `${vv.filter((x) => /^Mitigation/.test(x)).length} mitigated, ${vv.filter((x) => /^Vulnerable/.test(x)).length} vulnerable, ${vv.filter((x) => /^Not affected/.test(x)).length} n/a` : null)
  add('Memory', 'Total', gib(m.total)); add('Memory', 'Swap', m.swapTotal ? gib(m.swapTotal) : 'none')
  add('Memory', 'cgroup memory.max', m.cgroupMax === 'max' ? 'unlimited' : m.cgroupMax != null ? gib(m.cgroupMax) : 'n/a'); add('Memory', 'Transparent huge pages', m.thp)
  for (const f of s.filesystems.filter((x) => ['/', '/tmp', '/dev/shm'].includes(x.path))) add('Storage', `${f.path}`, `${f.fstype ?? '?'} · ${gib(f.totalBytes)} total, ${gib(f.freeBytes)} free${f.inodes ? ` · ${f.inodes.toLocaleString()} inodes` : ''}`)
  add('Storage', 'Block devices', s.blockDevices.map((d) => `${d.name} ${gib(d.sizeBytes)}${d.readOnly ? ' ro' : ''}`).join(', '))
  add('Network', 'Egress', n.egress?.ip ? `${n.egress.ip} · ${[n.egress.city, n.egress.region, n.egress.country].filter(Boolean).join(', ')} · ${n.egress.org ?? ''}` : n.egress?.error ?? 'not queried')
  add('Network', 'Interfaces', n.interfaces.map((i) => `${i.name} mtu ${i.mtu ?? '?'}`).join(', ')); add('Network', 'IPv6', n.ipv6 ? 'yes' : 'no'); add('Network', 'DNS servers', n.dns.join(', '))
  add('Security', 'seccomp', sec.seccomp); add('Security', 'uid', sec.uid); add('Security', 'LSM', sec.lsm)
  for (const k of sec.checks) add('Capabilities', k.label, k.ok == null ? 'unknown' : k.ok ? 'yes' : 'no')
  add('Tools', 'Runtime', `node ${t.node}${t.python ? `, python ${t.python}` : ''}${t.gcc ? `, gcc ${t.gcc}` : ''}`)
  add('Tools', 'Native bench tools', `fio ${t.fio ?? '✗'}, sysbench ${t.sysbench ?? '✗'}`)
  return rows
}
