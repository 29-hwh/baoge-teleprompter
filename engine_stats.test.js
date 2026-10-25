/**
 * StatsCollector 纯逻辑单测（注入可控时钟，不依赖微信运行时）
 */
'use strict'
const StatsCollector = require('./miniprogram/engine/stats.js')

let clock = 0
function makeCollector(opts) {
  return new StatsCollector(Object.assign({ now: () => clock }, opts))
}
function eq(a, b) {
  return Math.abs(a - b) < 1e-6
}

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
}

// 1) 完整一遍提词：start -> tick -> pause -> resume -> tick -> end
clock = 0
const c = makeCollector({ totalLines: 100, pxPerSecond: 120 })
c.onStart()
clock = 2000
c.onTick(0.1)
clock = 3000
c.onTick(0.2)
c.onPause() // 暂停：pausedCount=1
clock = 5000
c.onResume()
clock = 8000
c.onTick(0.5)
c.onEnd()
const s = c.snapshot()
ok('completed=true', s.completed === true)
ok('totalLines=100', s.totalLines === 100)
ok('rolledLines=50', s.rolledLines === 50, 'got ' + s.rolledLines)
ok('pausedCount=1', s.pausedCount === 1)
ok('activeMs=6000（不含暂停的2000ms）', s.activeMs === 6000, 'got ' + s.activeMs)
ok('durationMs=8000', s.durationMs === 8000, 'got ' + s.durationMs)
ok('maxProgress=0.5', eq(s.maxProgress, 0.5))
ok('speed=120', s.speed === 120)

// 2) 循环播放（不触发 onEnd）：start -> tick(满) -> loop -> tick
clock = 0
const c2 = makeCollector({ totalLines: 50, pxPerSecond: 100 })
c2.onStart()
clock = 1000
c2.onTick(1)
c2.onLoop()
clock = 2000
c2.onTick(0.8)
const s2 = c2.snapshot()
ok('循环模式未 completed', s2.completed === false)
ok('loopCount=1', s2.loopCount === 1)
ok('循环 activeMs=2000', s2.activeMs === 2000, 'got ' + s2.activeMs)

// 3) reset 清空
c2.reset()
const s3 = c2.snapshot()
ok('reset 后 activeMs=0', s3.activeMs === 0)
ok('reset 后 pausedCount=0', s3.pausedCount === 0)

// 4) onStart 守卫：running 时重复 onStart 不重置 startTs
clock = 0
const c4 = makeCollector({})
c4.onStart()
clock = 5000
c4.onStart() // 不生效
clock = 6000
c4.onEnd()
ok('重复 onStart 不重置 startTs', c4.snapshot().durationMs === 6000, 'got ' + c4.snapshot().durationMs)

// 5) 暂停期间不累计 active，但仍更新 maxProgress
clock = 0
const c5 = makeCollector({})
c5.onStart()
clock = 1000
c5.onTick(0.1)
c5.onPause()
clock = 9000 // 暂停期间流逝，不应累计
c5.onTick(0.2)
const s5 = c5.snapshot()
ok('暂停期间不累计 active', s5.activeMs === 1000, 'got ' + s5.activeMs)
ok('暂停期间 tick 仍更新 maxProgress', eq(s5.maxProgress, 0.2))

// 汇总
const passed = results.filter((r) => r.pass).length
console.log(`engine_stats.test.js: ${passed}/${results.length} 通过`)
const fails = results.filter((r) => !r.pass)
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL ' + f.name + (f.extra ? ' (' + f.extra + ')' : '')))
  process.exitCode = 1
} else {
  console.log('全部通过 ✅')
}
