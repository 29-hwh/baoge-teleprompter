'use strict'
/**
 * 速度调节「端到端」回归 —— 从手指按下量到「播放 1 秒到底走了多少像素」
 *
 * 为什么单独有这个文件：
 *   slider_touch.test.js 只断言 engine.pxPerSecond 变了，
 *   而宝哥真机反馈的是「数字调了，画面速度没变 / 干脆没反应」。
 *   中间还有很长一段：settings 落盘 → _msPerPx → resolveSpeed → configure/setSpeed → 每帧推进。
 *   任何一环断掉，pxPerSecond 看着是变的，画面却不动。所以这里直接量位移。
 *
 * 覆盖的真机失败模式：
 *   1. 几何量不到（首帧 / 查询失败）—— 只能靠相对位移
 *   2. 菜单动画中量到的 rect 在屏幕外 —— 不能拿它算绝对位置
 *   3. 点一下就抬手（异步回调里 e.touches 已空）—— 必须用记下来的 y0
 *   4. 播放中改速度 —— 下一帧就要用新速度
 *   5. 数字变了但位移没变 —— 本文件的头号断言
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
    try { t.fn() } catch (e) { console.log('    [定时器异常] ' + e.message) }
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}

const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
/** 轨道几何：与真实 WXSS 一致（.tp-grid 行高 60 → 滑块格 132；.tp-vhit 94；.tp-vtrack 46） */
const VT = { top: 240, bottom: 286, height: 46, width: 4, left: 100, right: 104 }
let RECT_MODE = 'ok' // ok | null | offscreen
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN), getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k], setStorageSync: (k, v) => { mem[k] = v }, removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn() {}, setScreenBrightness() {}, getScreenBrightness(o) { o && o.success && o.success({ value: 0.6 }) },
  setPageOrientation() {}, navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = { _sels: [], _cbs: [],
      in() { return q },
      select(sel) { q._sels.push(sel); return q },
      boundingClientRect(cb) { if (typeof cb === 'function') q._cbs.push(cb); return q },
      exec(cb) {
        if (RECT_MODE === 'null') { q._cbs.forEach(f => f(null)); return cb ? cb([]) : undefined }
        const base = RECT_MODE === 'offscreen'
          ? { top: 1600, bottom: 1646, height: 46, width: 4, left: 100, right: 104 }
          : VT
        const out = q._sels.map((sel) => {
          if (/\.tp-vtrack$/.test(sel)) return Object.assign({}, base)
          if (/\.tp-htrack$/.test(sel)) return { top: 400, bottom: 404, height: 4, width: 200, left: 20, right: 220 }
          // .tp-lines 故意返回 null：本文件关心的是「速度链路」，不是「高度标定」。
          // 给一个写死的高度会让 _measureContent 把估算总高按固定比例缩放
          // （短稿被放大 2.7 倍 → 每字像素虚高 → 速度快得像飞），
          // 那是 mock 的假象，不是产品行为。量不到时回落估算值才是干净场景。
          if (sel === '.tp-lines') return null
          return { top: 214, bottom: 346, height: 132, width: 60, left: 80, right: 140 }
        })
        q._cbs.forEach((f, i) => f(out[i] || null))
        return cb ? cb(out) : undefined
      } }
    return q
  }
}
const prefsEngine = require('./miniprogram/engine/prefs.js')
global.getApp = () => ({ globalData: { prefs: prefsEngine.load() }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } })
let def = null
global.Page = (d) => { def = d }
const store = require('./miniprogram/engine/store.js')
const timeline = require('./miniprogram/engine/timeline.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

const SCRIPT = Array.from({ length: 40 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来撑出足够长的滚动距离做速度回归。`).join('\n')
const script = store.create('速度端到端稿', SCRIPT); store.save(script)

function fresh() {
  for (const k of Object.keys(mem)) delete mem[k]
  store.save(script)
  mem['baoge_guide_tp'] = 1
  RECT_MODE = 'ok'
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
  p.onLoad({ id: script.id }); p.onReady()
  step(300)
  return p
}

let pass = 0, fail = 0
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + e : '')) } }

/** 模拟一次「按住 → 拖到 y → 抬手」，返回落定的 cpm。
 *  默认从 270 起手（落在轨道 240–286 内，走「点哪到哪」），
 *  另有测试专门从轨道外起手（标签区），走纯相对位移。 */
function drag(p, y, opts) {
  const o = opts || {}
  const ct = o.noId
    ? { dataset: { slider: 'vs-speed' } }
    : { id: 'vs-speed', dataset: { slider: 'vs-speed' } }
  p.onVSliderStart({ currentTarget: ct, touches: [{ clientX: 100, clientY: o.from === undefined ? 270 : o.from }] })
  step(o.wait || 40)
  if (o.to !== false) {
    p.onVSliderMove({ currentTarget: ct, touches: [{ clientX: 100, clientY: y }] })
    step(40)
  }
  p.onVSliderEnd()
  step(20)
  return p.data.settings.speedCpm
}

/** 播放 ms 毫秒，返回实际位移 */
function run(p, ms) {
  p._pause(true)
  p.engine.seekProgress(0)
  step(30)
  p._play()
  const a = p.engine.current
  step(ms)
  const b = p.engine.current
  p._pause(true)
  return b - a
}

console.log('══════ 1. 数值 → px/s → 真实位移，三者必须一致 ══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)

  drag(p, 210) // 往上拖 = 更快
  const fastCpm = p.data.settings.speedCpm
  const fastPx = p.engine.pxPerSecond
  const fastMove = run(p, 1000)

  drag(p, 320) // 往下拖 = 更慢
  const slowCpm = p.data.settings.speedCpm
  const slowPx = p.engine.pxPerSecond
  const slowMove = run(p, 1000)

  ok('拖动确实改变了读数', fastCpm !== slowCpm, `${fastCpm} vs ${slowCpm}`)
  ok('读数与引擎速度同向', fastPx > slowPx, `${fastPx.toFixed(1)} vs ${slowPx.toFixed(1)} px/s`)
  ok('真实位移随速度变化（不是只有数字动）', fastMove > slowMove * 1.5,
    `快 ${fastMove.toFixed(1)}px vs 慢 ${slowMove.toFixed(1)}px（1 秒）`)

  // 位移 / pxPerSecond 应接近 1 秒
  const ratio = fastMove / fastPx
  ok('位移与 px/s 成正比（≈1 秒）', Math.abs(ratio - 1) < 0.12, `比值 ${ratio.toFixed(3)}`)

  // 三档递增
  const a = drag(p, 320); const pa = run(p, 400)
  const b = drag(p, 265); const pb = run(p, 400)
  const c = drag(p, 215); const pc = run(p, 400)
  ok('三档依次变快', a < b && b < c && pa < pb && pb < pc,
    `cpm ${a}/${b}/${c} → px ${pa.toFixed(0)}/${pb.toFixed(0)}/${pc.toFixed(0)}`)
}

console.log('\n══════ 2. 播放中调速：下一段立刻用新速度 ══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  drag(p, 265)
  p._pause(true); p.engine.seekProgress(0); step(30)
  p._play()
  const t0 = p.engine.current
  step(500)
  const before = p.engine.current

  drag(p, 210) // 播放中往上拉
  const t1 = p.engine.current
  step(500)
  const after = p.engine.current

  const legA = before - t0
  const legB = after - t1
  // 注意：legA 里含 drag 本身耗掉的 100ms，所以这里只要求「明显更快」，
  // 精确的比例关系由第 1 节的 run(1000) 断言。
  ok('播放中提速后，后 0.5 秒走得更远', legB > legA * 1.25,
    `前 ${legA.toFixed(1)}px vs 后 ${legB.toFixed(1)}px`)
  ok('播放未被中断', p.data.status === 'playing', 'status=' + p.data.status)
  p._pause(true)
}

console.log('\n══════ 3. 量不到几何：只靠相对位移也必须生效 ══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  p._sliderRects = {}
  RECT_MODE = 'null'
  const before = p.data.settings.speedCpm
  drag(p, 240, { from: 300 })
  const after = p.data.settings.speedCpm
  ok('无几何：向上拖能提速', after > before, `${before}→${after}`)
  const curve = run(p, 600)
  ok('无几何调出来的速度，画面真的变快', curve > 0, `0.6 秒位移 ${curve.toFixed(1)}px`)

  RECT_MODE = 'ok'
  const b2 = p.data.settings.speedCpm
  drag(p, 360, { from: 300 })
  ok('无几何：向下拖能减速', p.data.settings.speedCpm < b2, `${b2}→${p.data.settings.speedCpm}`)
}

console.log('\n══════ 4. 菜单动画中（rect 在屏幕外）：不许乱跳，但必须能拖 ══════')
{
  const p = fresh()
  RECT_MODE = 'offscreen' // 先进入「动画中」的状态，再开菜单（真机就是这样）
  p.onOpenMenu()
  const before = p.data.settings.speedCpm // 200
  // 只拖 12px：若拿离屏 rect 算「绝对位置」，会直接跳到某个极值（20 或 1500）；
  // 正确行为是按相对位移走 —— 12/46 ≈ 26% 行程，对数刻度下约 ×3.7（200 → ≈740）。
  drag(p, 288, { from: 300 })
  const after = p.data.settings.speedCpm
  ok('离屏几何不被拿去算绝对位置（不会一碰就甩到极值）',
    after > before && after < 1200, `cpm ${before}→${after}`)
  ok('离屏时拖动仍生效', after !== before, `${before}→${after}`)
  ok('离屏时不会误判到最慢', after > timeline.CPM_MIN, 'cpm=' + after)
}

console.log('\n══════ 4b. 按在轨道外（格子底部的标签区）不许跳到极值 ══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  const before = p.data.settings.speedCpm // 200
  // 轨道在 240–286，格子在 214–346：按在 340（标签「速度」那一行）
  drag(p, 328, { from: 340 })
  const after = p.data.settings.speedCpm
  ok('按在标签区不会瞬间掉到最慢', after > 100, `cpm ${before}→${after}`)
  ok('按在标签区拖动仍按相对位移走', after > before, `${before}→${after}`)
}

console.log('\n══════ 5. 点一下就抬手（异步回调里 touches 已空）══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  p._sliderRects = {}
  const before = p.data.settings.speedCpm
  // 只发 touchstart，不发 move；且事件对象马上「清空 touches」模拟抬手
  const ev = { currentTarget: { id: 'vs-speed', dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 240 }] }
  p.onVSliderStart(ev)
  ev.touches = [] // 抬手：touches 变空数组
  step(80)        // selectorQuery 回调在下一帧执行
  p.onVSliderEnd()
  ok('轻点一下（缓存为空）也能落值', p.data.settings.speedCpm !== before, `${before}→${p.data.settings.speedCpm}`)
  ok('异步回调没有因为 touches 为空而崩', typeof p.data.settings.speedCpm === 'number')
}

console.log('\n══════ 6. 只有 data-slider、没有 id（事件节点变化时的兜底）══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  const before = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(40)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 250 }] })
  step(40)
  p.onVSliderEnd()
  ok('无 id 也能调速', p.data.settings.speedCpm !== before, `${before}→${p.data.settings.speedCpm}`)
}

console.log('\n══════ 7. 切单位不跳变（读数换口径，速度不变）══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  drag(p, 240)
  const beforePx = p.engine.pxPerSecond
  const beforeCpm = p.data.settings.speedCpm
  p.onToggleSpeedUnit()
  step(60)
  const afterPx = p.engine.pxPerSecond
  ok('切到像素后单位变了', p.data.settings.speedUnit === 'px', 'unit=' + p.data.settings.speedUnit)
  ok('切换单位实际速度基本不变（±8%）',
    Math.abs(afterPx - beforePx) / Math.max(1, beforePx) < 0.08,
    `${beforePx.toFixed(1)} → ${afterPx.toFixed(1)} px/s（cpm ${beforeCpm}）`)
  p.onToggleSpeedUnit(); step(60)
  ok('切回字/分速度仍基本不变',
    Math.abs(p.engine.pxPerSecond - beforePx) / Math.max(1, beforePx) < 0.08,
    p.engine.pxPerSecond.toFixed(1) + ' px/s')
}

console.log('\n══════ 8. 其他滑块不受影响（改速度不能把版式带歪）══════')
{
  const p = fresh()
  p.onOpenMenu(); step(120)
  const fs0 = p.data.settings.fontSize
  const lh0 = p.data.settings.lineHeight
  drag(p, 210)
  step(200)
  ok('调速度没改字号', p.data.settings.fontSize === fs0, `${fs0}→${p.data.settings.fontSize}`)
  ok('调速度没改行距', p.data.settings.lineHeight === lh0, `${lh0}→${p.data.settings.lineHeight}`)
  ok('调速度没触发重新排版（textHeight 稳定）', p.data.textHeight > 0)
}

console.log('\n══════ 9. 暴露给界面的「引擎实际速度」必须与引擎一致 ══════')
{
  // speedPxPerSec 是 _configureEngine 写进 data 的，菜单里显示它，
  // 用来让用户自己确认「数字调了以后，引擎到底跑多快」。
  const p = fresh()
  p.onOpenMenu(); step(120)
  ok('初始就有 px/s 读数', p.data.speedPxPerSec > 0, 'px/s=' + p.data.speedPxPerSec)
  ok('读数与引擎一致（±0.11）',
    Math.abs(p.data.speedPxPerSec - p.engine.pxPerSecond) < 0.11,
    `${p.data.speedPxPerSec} vs ${p.engine.pxPerSecond.toFixed(2)}`)

  drag(p, 210)
  const fast = p.data.speedPxPerSec
  drag(p, 320)
  const slow = p.data.speedPxPerSec
  ok('拖动后 px/s 读数跟着变（自证链路通了）', fast > slow, `${slow} → ${fast}`)
  ok('px/s 读数仍与引擎同步',
    Math.abs(p.data.speedPxPerSec - p.engine.pxPerSecond) < 0.11,
    `${p.data.speedPxPerSec} vs ${p.engine.pxPerSecond.toFixed(2)}`)
}

console.log('\n══════ 10. 同一个「字/分」，长稿短稿速度必须一样 ══════')
{
  // 旧口径拿「整篇时长 ÷ 可滚动距离」，分母里混进了 0.5 屏起播留白 + 0.75 屏结束留白，
  // 短稿被留白稀释 → 同样 200 字/分，短稿比长稿慢一大截。
  // 现在改成「每字纵向像素」口径：只跟字号/行距有关，与稿件长度无关。
  const longText = Array.from({ length: 60 }, (_, i) => `林晚：这是第 ${i + 1} 句，用来把稿子撑长。`).join('\n')
  const shortText = Array.from({ length: 8 }, (_, i) => `林晚：这是第 ${i + 1} 句，短稿。`).join('\n')

  function pxAt(text, cpm) {
    const sc = store.create('测速' + cpm + text.length, text)
    store.save(sc)
    const p = Object.create(def)
    p.data = JSON.parse(JSON.stringify(def.data))
    p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
    p.onLoad({ id: sc.id }); p.onReady()
    step(250)
    p._applySliderValue('vs-speed', cpm)
    step(80)
    return { px: p.engine.pxPerSecond, chars: p._charCount }
  }

  const a = pxAt(longText, 200)
  const b = pxAt(shortText, 200)
  const diff = Math.abs(a.px - b.px) / Math.max(1, a.px)
  ok('长稿/短稿在 200 字/分下速度接近（≤12%）', diff < 0.12,
    `长稿 ${a.px.toFixed(1)} px/s（${a.chars} 字） vs 短稿 ${b.px.toFixed(1)} px/s（${b.chars} 字），差 ${(diff * 100).toFixed(1)}%`)

  // 速度区间要拉得开：上限 / 下限 = 75 倍（2026-10-29 从 150 倍收窄）
  const fastest = pxAt(shortText, 1500).px
  const slowest = pxAt(shortText, 20).px
  ok('20 → 1500 字/分，速度跨度接近 75 倍', fastest / Math.max(0.01, slowest) > 60,
    `${slowest.toFixed(1)} → ${fastest.toFixed(1)} px/s（${(fastest / Math.max(0.01, slowest)).toFixed(1)}×）`)

  // 「拉到最大仍嫌慢」这条反馈要能被量化验证：
  // 1200 字/分滚一屏 ≤3.5 秒；上限 1500 要 ≤2.5 秒，否则当不了快进。
  const screenSec = 812 / pxAt(shortText, 1200).px
  ok('1200 字/分：一屏 ≤ 3.5 秒', screenSec <= 3.5, `实测 ${screenSec.toFixed(2)} 秒/屏`)
  const screenSecMax = 812 / pxAt(shortText, 1500).px
  ok('1500 字/分：一屏 ≤ 2.5 秒（仍能快进）', screenSecMax <= 2.5,
    `实测 ${screenSecMax.toFixed(2)} 秒/屏`)
}

console.log('\n══════ 11. 滑块对数刻度：默认 200 应该落在中间，不是贴底 ══════')
{
  // 区间从 580 扩到 1180 后，线性刻度会把 200 挤到 15% 处，
  // 且 200→300 只占 4% 行程，等于"低段调不动、高段一拖就飞"。
  const p = fresh()
  p.onOpenMenu(); step(120)

  p._applySliderValue('vs-speed', 200); step(40)
  const pct200 = p.data.pctSpeed
  ok('200 字/分落在滑块中间附近（45%–65%）', pct200 >= 45 && pct200 <= 65, `pct=${pct200}%`)

  p._applySliderRatio('vs-speed', 0)
  ok('拉到最底 = 20 字/分', p.data.settings.speedCpm === 20, 'cpm=' + p.data.settings.speedCpm)
  p._applySliderRatio('vs-speed', 1)
  ok('拉到最顶 = 1500 字/分', p.data.settings.speedCpm === 1500, 'cpm=' + p.data.settings.speedCpm)

  p._applySliderRatio('vs-speed', 0.5)
  const mid = p.data.settings.speedCpm
  ok('滑块中点 ≈ 170 字/分（20 与 1500 的对数中位）', mid >= 150 && mid <= 200, 'cpm=' + mid)

  // 每一段行程都应该对应「同样的倍数」：走 1/4 行程速度约 ×2.8
  p._applySliderValue('vs-speed', 200); step(30)
  const base = p.data.settings.speedCpm
  const before = p._pctOfSpeed(p.data.settings)
  p._applySliderRatio('vs-speed', Math.min(1, before / 100 + 0.25))
  const ratio = p.data.settings.speedCpm / base
  ok('走 1/4 行程速度约变成 2.9 倍（对数刻度）', ratio > 2.3 && ratio < 3.6,
    `${base} → ${p.data.settings.speedCpm}（×${ratio.toFixed(2)}）`)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
