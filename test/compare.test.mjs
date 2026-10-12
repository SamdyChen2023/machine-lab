import test from 'node:test'
import assert from 'node:assert/strict'
import { compareRuns } from '../server/compare.mjs'

const fp = (host, vcpus) => ({
  host: { hostname: host, os: 'Linux', kernel: '6', arch: 'x64' }, virtualization: { label: 'VM', hypervisor: null, evidence: [] },
  cpu: { model: 'X', vendor: 'V', vcpus, flags: [], caches: {}, vulnerabilities: {} }, memory: { total: 2 ** 32, swapTotal: 0 },
  storage: { filesystems: [], blockDevices: [] }, network: { interfaces: [], dns: [], egress: null }, security: { checks: [] }, tools: { node: 'v24' },
})
const m = (median, better = 'higher', cv = 1) => ({ unit: 'u', better, median, mean: median, min: median, max: median, cv, n: 3, samples: [median] })
const run = (label, vcpus, metrics) => ({ schema: 1, id: label, label, profile: 'quick', startedAt: 1, fingerprint: fp(label, vcpus), results: [{ id: 't', group: 'cpu', title: 'T', tool: 'x', metrics }] })

test('best value is flagged per direction and ratios are relative to it', () => {
  const c = compareRuns([run('a', 2, { thr: m(100), lat: m(10, 'lower') }), run('b', 4, { thr: m(50), lat: m(20, 'lower') })])
  const [thr, lat] = c.groups[0].tests[0].metrics
  assert.equal(thr.best, 0); assert.equal(thr.ratios[1], 0.5)
  assert.equal(lat.best, 0); assert.equal(lat.ratios[1], 0.5)
  assert.deepEqual(c.overall, [100, 50])
})

test('metrics present on one machine only are shown but not scored or starred', () => {
  const c = compareRuns([run('a', 2, { shared: m(10), only_a: m(5) }), run('b', 2, { shared: m(10) })])
  const only = c.groups[0].tests[0].metrics.find((x) => x.key === 'only_a')
  assert.equal(only.best, null); assert.equal(only.values[1], null)
  assert.deepEqual(c.groups[0].scores, [100, 100])
})

test('noisy cells are flagged and environment differences detected', () => {
  const c = compareRuns([run('a', 2, { x: m(10, 'higher', 40) }), run('b', 4, { x: m(10) })])
  assert.deepEqual(c.groups[0].tests[0].metrics[0].noisy, [true, false])
  assert.ok(c.fingerprint.find((r) => r.label === 'vCPUs').differs)
})

test('duplicate labels get distinct column names; mixed profiles warn', () => {
  const a = run('same', 2, { x: m(1) }), b = { ...run('same', 2, { x: m(1) }), profile: 'full' }
  const c = compareRuns([a, b])
  assert.deepEqual(c.machines.map((x) => x.name), ['same', 'same (2)'])
  assert.equal(c.warnings.length, 1)
})
