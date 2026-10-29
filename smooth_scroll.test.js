'use strict'
/**
 * 滚动平顺性 + 速度保真 回归
 *
 * 宝哥两次反馈的同一组症状：
 *   「调到 1200 还是慢」+「滚动时间歇性跳一下」
 * 它们其实同源 —— 引擎按「帧」推进，而真机的定时器并不守时。
 *
 * 这里钉住四件事：
 *   ① 定时器被拖慢（16 → 40/50/65ms）时，**平均速度必须仍然等于设定值**
 *      （旧实现直接丢掉超出的时间：40ms → 80%，50ms → 64%，65ms → 49%）
 *   ② 单帧位移仍有上限（≤4 帧的量），卡顿不会被放大成一次大跳
 *   ③ 播放期间**列表零重建**（换批那一帧必掉帧，就是「间歇性跳一下」）
 *   ④ 慢速档做亚像素过滤：不值得重绘的帧不发 setData
 */
let T = 1780000000000
const timers = []; let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {}
global.Date.now = () => T
function step(ms) {
  const end = T + ms
  for (;;) {
    timers.sort((a, b) => a.fireAt - b.fireAt)
    const t = timers[0]
    if (!t || t.fireAt > end) break
    timers.shift(); T = t.fireAt
    try { t.fn() } catch (e) { /* ignore */ }
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}

let pass = 0, fail = 0
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + e : '')) } }

const ScrollEngine = require('./miniprogram/engine/scroll.js')

/* ══════════════════════════════════════════════════════════════
 * 1. 引擎：定时器不守时，速度也必须守住
 * ════════════════════════════════════════════════════════════ */
console.log('══════ 1. 定时器被拖慢，平均速度仍等于设定值 ══════')
{
  const realNow = Date.now
  let NOW = 1000000
  global.Date.now = () => NOW

  function run(gapMs, seconds, px) {
    NOW = 1000000
    const e = new ScrollEngine({})
    e.configure(81, 400000, 812, px, 812)
    e.playing = true
    e._lastTs = 0
    const t0 = NOW
    let maxStep = 0
    let prev = 0
    while (NOW - t0 < seconds * 1000) {
      NOW += gapMs
      e._tick()
      maxStep = Math.max(maxStep, e.current - prev)
      prev = e.current
    }
    const secs = (NOW - t0) / 1000
    return { actual: e.current / secs, maxStep }
  }

  const PX = 282 // ≈1200 字/分
  for (const gap of [16, 40, 50, 65]) {
    const r = run(gap, 10, PX)
    const ratio = r.actual / PX
    ok(`间隔 ${gap}ms：实际 ${r.actual.toFixed(0)}px/s（达成率 ${(ratio * 100).toFixed(0)}%）`,
      ratio >= 0.97, `设定 ${PX}px/s，实际 ${r.actual.toFixed(1)}`)
  }

  // 单帧位移上限：即使 100ms 才来一帧，也只走 4 帧的量
  const r2 = run(100, 6, PX)
  const cap = (PX * 64) / 1000
  ok('单帧位移不超过 4 帧的量（卡顿不被放大成跳跃）', r2.maxStep <= cap * 1.02,
    `最大 ${r2.maxStep.toFixed(2)}px，上限 ${cap.toFixed(2)}px`)

  // 偶发长卡顿之后能补回来（累计位移 ≈ 设定 × 时长）
  NOW = 1000000
  const e = new ScrollEngine({})
  e.configure(81, 400000, 812, PX, 812)
  e.playing = true
  e._lastTs = 0
  const t0 = NOW
  const gaps = [16, 16, 16, 48, 16, 16, 50, 16, 33, 16, 16, 64, 16, 16, 40, 16, 16, 16, 16, 16, 16, 16, 16, 16]
  for (const g of gaps) { NOW += g; e._tick() }
  const secs = (NOW - t0) / 1000
  const want = PX * secs
  ok('抖动序列结束后累计位移对得上（时间没被扔掉）',
    Math.abs(e.current - want) / want < 0.06,
    `实走 ${e.current.toFixed(1)}px vs 应有 ${want.toFixed(1)}px`)

  global.Date.now = realNow
}

/* ══════════════════════════════════════════════════════════════
 * 2. 页面层：播放期间列表零重建
 * ════════════════════════════════════════════════════════════ */
const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3, safeArea: { top: 44, bottom: 778, left: 0, right: 375 } }
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN), getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k], setStorageSync: (k, v) => { mem[k] = v }, removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn() {}, setScreenBrightness() {}, getScreenBrightness(o) { o && o.success && o.success({ value: 0.6 }) },
  setPageOrientation() {}, navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = { _s: [], _c: [], in() { return q }, select(s) { q._s.push(s); return q },
      boundingClientRect(cb) { if (typeof cb === 'function') q._c.push(cb); return q },
      exec(cb) { q._c.forEach((f) => f(null)); return cb ? cb(q._s.map(() => null)) : undefined } }
    return q
  }
}
const prefsEngine = require('./miniprogram/engine/prefs.js')
global.getApp = () => ({ globalData: { prefs: prefsEngine.load() }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } })
let def = null
global.Page = (d) => { def = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

const SCRIPT = Array.from({ length: 90 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来撑出足够长的滚动距离做平顺性测试。`).join('\n')
const script = store.create('平顺性稿', SCRIPT); store.save(script)

function fresh() {
  for (const k of Object.keys(mem)) delete mem[k]
  store.save(script)
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p._setDataCalls = 0
  p._listWrites = 0
  p._offsetWrites = 0
  p.setData = function (x) {
    if (x && typeof x === 'object') {
      this._setDataCalls++
      if ('lines' in x || 'visibleLines' in x) this._listWrites++
      if ('offset' in x) this._offsetWrites++
      Object.assign(this.data, x)
    }
  }
  p.onLoad({ id: script.id }); p.onReady()
  step(300)
  return p
}

console.log('\n══════ 2. 播放 3 秒：列表零重建，offset 每帧都在写 ══════')
{
  const p = fresh()
  p._applySliderValue('vs-speed', 600)
  step(60)
  p._setDataCalls = 0; p._listWrites = 0; p._offsetWrites = 0
  p._play()
  const t0 = T
  step(3000)
  const elapsed = T - t0
  p._pause(true)

  const frames = Math.round(elapsed / 16)
  ok('播放期间没有重建过台词列表', p._listWrites === 0, `${p._listWrites} 次写 lines`)
  ok('offset 写入次数 ≈ 帧数（每帧都在推进）', Math.abs(p._offsetWrites - frames) <= frames * 0.2,
    `${p._offsetWrites} 次 / 约 ${frames} 帧`)
  ok('setData 总次数 ≈ offset 次数（没有额外的第二遍渲染）',
    p._setDataCalls <= p._offsetWrites + 3,
    `${p._setDataCalls} vs ${p._offsetWrites}`)
}

console.log('\n══════ 3. 慢速档：亚像素过滤，不白耗渲染 ══════')
{
  const p = fresh()
  p._applySliderValue('vs-speed', 20) // 约 4.7px/s → 每帧 0.075px
  step(60)
  p._offsetWrites = 0; p._setDataCalls = 0
  p._play()
  const t0 = T
  step(3000)
  const elapsed = T - t0
  p._pause(true)
  const frames = Math.round(elapsed / 16)
  ok('20 字/分：offset 写入远少于帧数（只在肉眼可分辨时重绘）',
    p._offsetWrites < frames * 0.5, `${p._offsetWrites} 次 / 约 ${frames} 帧`)
  ok('慢速档仍然真的在动', p.engine.current > 5, `走了 ${p.engine.current.toFixed(1)}px`)
}

console.log('\n══════ 4. 速度标签与实际位移一致（1200 → 20 字/秒）══════')
{
  const p = fresh()
  p._applySliderValue('vs-speed', 1200)
  step(60)
  const px = p.engine.pxPerSecond
  const pxPerChar = p._speedContext().pxPerChar
  ok('1200 字/分 = 20 字/秒（按每字像素折算回去）',
    Math.abs((px / pxPerChar) - 20) < 0.5,
    `${px.toFixed(1)}px/s ÷ ${pxPerChar.toFixed(2)}px/字 = ${(px / pxPerChar).toFixed(2)} 字/秒`)

  p._pause(true)
  p.engine.seekProgress(0)
  step(30)
  p._play()
  const a = p.engine.current
  step(2000)
  const moved = p.engine.current - a
  p._pause(true)
  ok('播放 2 秒的位移 = 速度 × 2 秒（误差 <8%）',
    Math.abs(moved - px * 2) / (px * 2) < 0.08,
    `实走 ${moved.toFixed(0)}px vs 应有 ${(px * 2).toFixed(0)}px`)
}

console.log('\n══════ 5. 任何位置都不需要「窗口覆盖」了（全量渲染）══════')
{
  const p = fresh()
  ok('渲染列表 = 全部台词', p.data.lines.length === p.displayLines.length,
    `${p.data.lines.length}/${p.displayLines.length}`)
  const ref = p.data.lines
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    p.engine.seekProgress(ratio)
    p._updateVisible(true)
  }
  ok('滚遍全篇，列表引用始终不变（零重建）', p.data.lines === ref)
  ok('没有切片补偿字段参与渲染（visibleTop 恒 0）', p.data.visibleTop === 0)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
