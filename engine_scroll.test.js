/**
 * 滚动引擎回归测试
 * 覆盖：匀速推进、暂停后立刻再点播放(resume 竞态) 必须恢复滚动、
 * 段末停顿、到底结束。
 * 用可控时钟 + 可控 setInterval/setTimeout 驱动（引擎主循环已改为 setInterval）。
 */
'use strict'

let CLOCK = 1_000_000
let intervalQueue = []
let intervalSeq = 0
let timeoutQueue = []
let timeoutSeq = 0

// 引擎主循环依赖全局 setInterval/clearInterval
global.setInterval = (fn, ms) => { intervalSeq += 1; intervalQueue.push({ id: intervalSeq, fn, interval: ms || 16, at: CLOCK + (ms || 16) }); return intervalSeq }
global.clearInterval = (id) => { intervalQueue = intervalQueue.filter((t) => t.id !== id) }

Date.now = () => CLOCK

// 时钟驱动的 setTimeout/clearTimeout（让 pauseFor 等真实生效）
global.setTimeout = (fn, ms) => { timeoutSeq += 1; timeoutQueue.push({ id: timeoutSeq, fn, at: CLOCK + (ms || 0) }); return timeoutSeq }
global.clearTimeout = (id) => { timeoutQueue = timeoutQueue.filter((t) => t.id !== id) }

function drive(frames, stepMs) {
  for (let i = 0; i < frames; i++) {
    CLOCK += stepMs
    // 触发到期 timeout（setTimeout）
    timeoutQueue.slice().forEach((t) => {
      if (CLOCK >= t.at) {
        timeoutQueue = timeoutQueue.filter((x) => x.id !== t.id)
        try { t.fn() } catch (e) { console.error('[timeout error]', e) }
      }
    })
    // 触发到期 interval（引擎主循环）
    intervalQueue.slice().forEach((t) => {
      if (CLOCK >= t.at) {
        try { t.fn() } catch (e) { console.error('[interval error]', e) }
        t.at = CLOCK + t.interval
      }
    })
  }
}

const ScrollEngine = require('./miniprogram/engine/scroll.js')

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name) }
}

function newEngine() {
  const e = new ScrollEngine({})
  e.configure(60, 2400, 800, 300) // 行高60 内容2400 视口800 -> maxOffset=1600, 速度300px/s
  return e
}

console.log('T1 匀速推进：start 后 offset 持续增长')
{
  const e = newEngine()
  e.start()
  drive(30, 16)
  ok('offset 已推进 (>30px)', e.current > 30)
  ok('engine.playing=true', e.playing === true)
  e.stop()
}

console.log('T2 根因回归：暂停后「零延迟」再点播放，引擎必须恢复滚动')
{
  const e = newEngine()
  e.start()
  drive(30, 16)
  const before = e.current
  e.pause()                 // playing=false，timer 立即清空
  e.start()                 // 模拟用户立刻再点「播放」：此时 _timer 已为 null
  ok('start() 后 engine.playing 必须为 true（修复点）', e.playing === true)
  drive(30, 16)
  ok('再次播放后 offset 继续推进 (> before+30)', e.current > before + 30)
  e.stop()
}

console.log('T3 暂停稍后(循环已收敛)再点播放，依旧恢复')
{
  const e = newEngine()
  e.start()
  drive(30, 16)
  const before = e.current
  e.pause()
  drive(60, 16)             // 让收敛彻底完成并清空 _timer
  ok('收敛后 _timer 为 null', e._timer === null)
  e.start()
  drive(30, 16)
  ok('收敛后再次播放 offset 继续推进', e.current > before + 30)
  e.stop()
}

console.log('T4 段末停顿 pauseFor 生效且能自动恢复')
{
  const e = newEngine()
  e.start()
  e.pauseFor(200)
  ok('pauseFor 后 playing=false', e.playing === false)
  drive(30, 16)             // 时钟推进超过 200ms，pauseFor 的 setTimeout 应触发 resume
  ok('停顿结束后自动恢复 playing=true', e.playing === true)
  e.stop()
}

console.log('T5 台本结束(末行滚过参考线)触发 onEnd 且停止循环')
{
  let ended = false
  const e = new ScrollEngine({ onEnd: () => { ended = true } })
  // 第 5 参 guideOffset=200：参考线偏移。endOffset = 内容高(2400) - 200 = 2200。
  // 旧「滚到底」判定 maxOffset=内容高-视口高=2400-800=1600，会在末行停在 92% 屏高时提前收场；
  // 新判定让末行继续滚到参考线(50%)才结束（offset=2200）。
  e.configure(60, 2400, 800, 400, 200)
  ok('endOffset = 内容高 - 参考线偏移', e.endOffset === 2200)
  ok('非循环 maxOffset 取 endOffset（不再是 内容高-视口高）', e.maxOffset === 2200 && e.maxOffset !== 1600)
  e.start()
  drive(600, 16) // 远超所需时间
  ok('结束位置 offset 接近 endOffset(2200)', Math.abs(e.current - 2200) < 2)
  ok('onEnd 已触发', ended === true)
  ok('结束后循环停止 _timer=null', e._timer === null)
  e.stop()
}

console.log('T7 结束判定唯一定义为「末行滚过参考线」，而非滚到底/行数索引')
{
  let ended = false
  const e = new ScrollEngine({ onEnd: () => { ended = true } })
  const guide = 200 // 与 T5 同布局
  e.configure(60, 2400, 800, 400, guide)
  e.start()
  drive(300, 16) // 300 帧≈4.8s@400px/s≈1920px：已越过 old「底部」(1600) 但 < endOffset(2200)
  // 旧实现到 1600 就 onEnd；新实现需滚到 2200 才结束
  ok('未滚过参考线前(≈1600)不触发 onEnd', ended === false)
  ok('此刻 offset 已越过旧的「底部」(1600)但仍 < endOffset', e.current >= 1600 && e.current < 2200)
  drive(500, 16) // 继续滚到参考线
  ok('滚过参考线(2200)后才触发 onEnd', ended === true)
  e.stop()
}

console.log('T8 循环(无限滚动)行为不变：不触发 onEnd，回绕续滚')
{
  let ended = false, loops = 0
  const e = new ScrollEngine({ onEnd: () => { ended = true }, onLoop: () => { loops++ } })
  e.configure(60, 2400, 800, 400, 200)
  e.loop = true // 开启无限滚动
  e.start()
  drive(600, 16) // 远超一圈
  ok('循环模式不触发 onEnd（与需求4兼容）', ended === false)
  ok('循环模式触发了 onLoop（回绕续滚）', loops > 0)
  e.stop()
}

console.log('T6 调速 setSpeed 立即生效（模拟「调速度没用」的根因反向验证）')
{
  const e = newEngine()
  e.start()
  drive(10, 16)
  const c0 = e.current
  e.setSpeed(600)            // 拉满速度
  drive(10, 16)
  const c1 = e.current
  // 速度翻倍(300->600px/s)，10 帧(160ms)位移增量应明显变大（约 96px vs 约 48px）
  ok('提速后单位帧位移明显变大', (c1 - c0) > 60)
  e.stop()
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
