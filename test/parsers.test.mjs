import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFio, parseSysbenchCpu, parseSysbenchMem } from '../server/tests.mjs'
import { stats, percentile } from '../server/util.mjs'

test('parseSysbenchCpu reads events per second', () => {
  assert.equal(parseSysbenchCpu('CPU speed:\n    events per second:  1171.24\n'), 1171.24)
  assert.ok(Number.isNaN(parseSysbenchCpu('garbage')))
})

test('parseSysbenchMem reads MiB/sec from the transferred line', () => {
  assert.equal(parseSysbenchMem('4096.00 MiB transferred (29645.66 MiB/sec)'), 29645.66)
})

test('parseFio picks the read side for reads and tolerates leading warnings', () => {
  const j = { jobs: [{ read: { io_bytes: 1000, bw_bytes: 2 * 2 ** 20, iops: 4500, clat_ns: { percentile: { '50.000000': 200000, '99.000000': 1600000 } } }, write: { io_bytes: 0 } }] }
  const r = parseFio('fio: warning\n' + JSON.stringify(j))
  assert.equal(r.iops, 4500); assert.equal(r.mibs, 2); assert.equal(r.p99us, 1600); assert.equal(r.p50us, 200)
})

test('parseFio picks the write side for writes', () => {
  const j = { jobs: [{ read: { io_bytes: 0 }, write: { io_bytes: 5, bw: 1024, iops: 10, clat_ns: { percentile: {} } } }] }
  const r = parseFio(JSON.stringify(j))
  assert.equal(r.mibs, 1); assert.equal(r.p99us, null)
})

test('stats: median, spread and coefficient of variation', () => {
  const s = stats([10, 12, 11, 100, 9])
  assert.equal(s.median, 11); assert.equal(s.min, 9); assert.equal(s.max, 100); assert.equal(s.n, 5)
  assert.ok(s.cv > 100)
  assert.equal(stats([5, 5, 5]).cv, 0)
  assert.equal(stats([]), null)
  assert.equal(stats([NaN, 4]).n, 1)
})

test('percentile index is clamped', () => {
  const a = [1, 2, 3, 4, 5]
  assert.equal(percentile(a, 0), 1); assert.equal(percentile(a, 99), 5); assert.equal(percentile(a, 100), 5)
})
