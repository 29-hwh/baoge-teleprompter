'use strict'
/**
 * 滑块触摸层回归测试
 *
 * 为什么单独有这个文件：之前 menu_e2e / menu_panel 都是直接调 _applySliderRatio()，
 * 绕过了触摸层 —— 于是「真机上滑块点了完全没反应」这类问题测不出来（假绿）。
 * 这里从 onVSliderStart/onHSliderStart 入口进，喂真实触摸坐标，覆盖三条致命路径：
 *   1. 几何缓存为空（首次触摸 / 查询失败）
 *   2. 菜单滚动后坐标变了（缓存过期）
 *   3. 页面里误用 selectorQuery.in(this)（Page 上非法，会拿不到任何 rect）
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
    try { t.fn() } catch (e) { console.log('    [定时器抛异常] ' + e.message) }
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}
const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
// 可变的轨道几何：模拟菜单滚动后坐标变化
let TRACK = { top: 200, bottom: 320, height: 120, width: 4, left: 100, right: 104 }
let RECT_MODE = 'ok' // ok | null | offscreen
let IN_CALLED = false
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN), getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k], setStorageSync: (k, v) => { mem[k] = v }, removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn() {}, setScreenBrightness() {}, getScreenBrightness(o) { o && o.success && o.success({ value: 0.6 }) },
  setPageOrientation() {}, navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = { _sels: [], _cbs: [], _scope: null,
      in(c) { IN_CALLED = true; q._scope = c; return q },
      select(sel) { q._sels.push(sel); return q },
      boundingClientRect(cb) { if (typeof cb === 'function') q._cbs.push(cb); return q },
      exec(cb) {
        // 若代码仍误用 .in()，模拟真机：全部拿不到
        if (q._scope) { q._cbs.forEach(f => f(null)); return cb ? cb([]) : undefined }
        // RECT_MODE: ok（正常）/ null（量不到）/ offscreen（菜单动画中，坐标在屏幕外）
        if (RECT_MODE === 'null') { q._cbs.forEach(f => f(null)); return cb ? cb([]) : undefined }
        const base = RECT_MODE === 'offscreen'
          ? { top: 1400, bottom: 1520, height: 120, width: 4, left: 100, right: 104 }
          : TRACK
        const HTRACK = { top: 400, bottom: 404, height: 4, width: 200, left: 20, right: 220 }
        const out = q._sels.map((sel) => {
          const m = sel.match(/^#([\w-]+)/)
          const id = m ? m[1] : ''
          const isH = id.indexOf('hs-') === 0
          if (/\.tp-vtrack$/.test(sel)) return isH ? null : Object.assign({}, base)
          if (/\.tp-htrack$/.test(sel)) return isH ? Object.assign({}, HTRACK) : null
          if (sel === '.tp-lines') return { top: 0, bottom: 2430, height: 2430, width: 343, left: 16, right: 359 }
          return isH
            ? { top: 380, bottom: 424, height: 44, width: 220, left: 10, right: 230 }
            : { top: base.top - 26, bottom: base.bottom + 22, height: base.height + 48, width: 100, left: 40, right: 140 }
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
require('./miniprogram/pages/teleprompter/teleprompter.js')
const SCRIPT = Array.from({length: 30}, (_, i) => `林晚：这是第 ${i+1} 句台词，用来撑出足够长的滚动距离。`).join('\n')
const s = store.create('速度探针稿', SCRIPT); store.save(s)
function fresh() {
  for (const k of Object.keys(mem)) delete mem[k]
  store.save(s)
  TRACK = { top: 200, bottom: 320, height: 120, width: 4, left: 100, right: 104 }
  mem['baoge_guide_tp'] = 1
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
  p.onLoad({ id: s.id }); p.onReady()
  return p
}
let pass = 0, fail = 0
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + e : '')) } }
function touchV(p, y, opts) {
  opts = opts || {}
  const before = p.engine.pxPerSecond
  p.onVSliderStart({ currentTarget: { id: 'vs-speed' }, touches: [{ clientX: 100, clientY: y }] })
  step(opts.wait || 40)
  p.onVSliderEnd()
  return { before, after: p.engine.pxPerSecond, cpm: p.data.settings.speedCpm }
}

console.log('══════ 1. 冷启动直接触摸（无任何预缓存）══════')
{
  const p = fresh(); step(400)
  p.onOpenMenu(); step(50)
  ok('打开菜单后滑块几何已预取', Object.keys(p._sliderRects).length >= 7, JSON.stringify(Object.keys(p._sliderRects)))
  const p2 = fresh(); step(400)
  p2._sliderRects = {}   // 彻底清空，模拟「缓存从来没成功」
  const r = touchV(p2, 205)
  ok('缓存为空时第一次触摸也生效', Math.abs(r.after - r.before) > 0.01, `px/s ${r.before.toFixed(2)}→${r.after.toFixed(2)}, cpm=${r.cpm}`)
  ok('往上拖 → 变快', r.after > r.before, `cpm=${r.cpm}`)
  const r2 = touchV(p2, 315)
  ok('往下拖 → 变慢', r2.after < r2.before, `cpm=${r2.cpm}`)
}

console.log('══════ 2. 菜单打开后触摸 ══════')
{
  const p = fresh(); step(300)
  p.onOpenMenu(); step(100)
  const r = touchV(p, 210)
  ok('打开菜单后拖动生效', Math.abs(r.after - r.before) > 0.01, `px/s ${r.before.toFixed(2)}→${r.after.toFixed(2)}`)
  ok('速度值已写入 settings', p.data.settings.speedCpm > 400, 'cpm=' + p.data.settings.speedCpm)
}

console.log('══════ 3. 菜单滚动后坐标变化（缓存过期）══════')
{
  const p = fresh(); step(300)
  p.onOpenMenu(); step(100)
  const stale = p._sliderRects['vs-speed'].top
  TRACK = { top: 60, bottom: 180, height: 120, width: 4, left: 100, right: 104 } // 菜单往上滚了 140px
  const r = touchV(p, 70)  // 新坐标里靠近顶部 → 应该变快
  ok('滚动后按新坐标计算', r.after > r.before, `旧 top=${stale} 新 top=60, cpm=${r.cpm}`)
  ok('缓存已被实时测量刷新', p._sliderRects['vs-speed'].top === 60, 'top=' + p._sliderRects['vs-speed'].top)
}

console.log('══════ 4. 全量滑块可动性（竖 5 + 横 2）══════')
{
  const p = fresh(); step(300)
  p.onOpenMenu(); step(100)
  const cases = [
    ['vs-fontSize', 'fontSize', 45, 150],
    ['vs-lineHeight', 'lineHeight', 1.5, 3],
    ['vs-letterSpacing', 'letterSpacing', 0, 20],
    ['vs-cuePosition', 'cuePosition', 42, 90]
  ]
  for (const [id, key, min, max] of cases) {
    const before = p.data.settings[key]
    p.onVSliderStart({ currentTarget: { id }, touches: [{ clientX: 100, clientY: 205 }] })
    step(40); p.onVSliderEnd(); step(120)
    const after = p.data.settings[key]
    ok(`竖滑块 ${id} 拖动生效`, after !== before, `${before}→${after}`)
  }
  // 横滑块（contentWidth 触发重排，单独等）
  const beforeW = p.data.settings.contentWidth
  p.onHSliderStart({ currentTarget: { id: 'hs-contentWidth' }, touches: [{ clientX: 200, clientY: 400 }] })
  step(40); p.onHSliderEnd(); step(200)
  ok('横滑块 hs-contentWidth 拖动生效', p.data.settings.contentWidth !== beforeW, `${beforeW}→${p.data.settings.contentWidth}`)
  const beforeC = p.data.settings.countdown
  p.onHSliderStart({ currentTarget: { id: 'hs-countdown' }, touches: [{ clientX: 40, clientY: 400 }] })
  step(40); p.onHSliderEnd(); step(120)
  ok('横滑块 hs-countdown 拖动生效', p.data.settings.countdown !== beforeC, `${beforeC}→${p.data.settings.countdown}`)
}

console.log('══════ 5. 不再误用 .in() ══════')
{
  IN_CALLED = false
  const p = fresh(); step(400)
  p.onOpenMenu(); step(200)
  ok('selectorQuery 未调用 .in()', IN_CALLED === false, '.in() 仍被调用')
}

console.log('══════ 6. 播放中调速：滚动真的变快（用户核心诉求）══════')
{
  const p = fresh()
  p._setSetting({ countdown: 0 }, 'none') // 关倒计时，直接起播
  step(200)
  p._play()
  ok('已进入播放态', p.data.status === 'playing', 'status=' + p.data.status)
  const t0 = p.engine.current
  step(1000)
  const slow = p.engine.current - t0

  p.onToggleSpeedUnit()          // 切到像素口径
  p._setSetting({ speed: 100 }, 'quick') // 拉到最快
  step(50)
  const t1 = p.engine.current
  step(1000)
  const fast = p.engine.current - t1
  ok('播放中提速：1 秒位移明显变大', fast > slow * 2, `慢 ${slow.toFixed(1)}px → 快 ${fast.toFixed(1)}px`)
  ok('引擎速度已换成新值', p.engine.pxPerSecond > 100, 'px/s=' + p.engine.pxPerSecond.toFixed(1))
  p._pause()
}

console.log('══════ 7. 数值区点击不与滑块抢事件 ══════')
{
  const fs = require('fs')
  const wxml = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
  const wxss = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxss', 'utf8')
  ok('速度数值区可点（切单位）', /tp-val-tap[^>]*catchtap="onToggleSpeedUnit"/.test(wxml))
  ok('指示线数值区可点（切显隐）', /tp-val-tap[^>]*catchtap="onToggleCue"/.test(wxml))
  ok('命中区只覆盖轨道段（.tp-vhit 从 20px 起）', /\.tp-vhit\s*\{[^}]*top:\s*20px/.test(wxss))
  ok('数值区层级高于命中区（否则点数值会变成拖滑块）', /\.tp-val-tap\s*\{[^}]*z-index:\s*3/.test(wxss))
  // 2026-10-28 第三次：事件从 .tp-vhit 提到整格 .tp-cell ——
  // 命中面积从 94px 高变成整格 132px，且不再受「内层绝对定位算错/被盖住」影响。
  ok('速度格的 touch 挂在整个格子上（命中面积最大）', /id="vs-speed"[\s\S]{0,200}?catchtouchstart="onVSliderStart"/.test(wxml))
  ok('整格也带 data-slider（id 之外的二级兜底）', /data-slider="vs-speed"/.test(wxml))
  ok('补了 touchcancel（scroll-view 接管手势时不至于卡在半途）', /catchtouchcancel="onVSliderEnd"/.test(wxml))
}

console.log('══════ 8. 真机语义：事件节点是 .tp-vhit（没 id，只有 data-slider）══════')
{
  // 这一节防的是真机上真正的失败模式：
  // 事件绑在 .tp-vhit 上，e.currentTarget 就是 .tp-vhit —— 它没有 id。
  // 老实现写 `const id = e.currentTarget.id` → 取到空串 → _applySliderRatio('') 直接 return
  // → 整个滑块静默失效（速度"锁死在 300"）。老测试手工喂了 id，所以一直是假绿。
  const p = fresh(); step(300)
  p.onOpenMenu(); step(150)
  const before = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { id: '', dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 205 }] })
  step(60)
  p.onVSliderEnd()
  const after = p.data.settings.speedCpm
  ok('命中区无 id、只有 data-slider 也能调速', after !== before, `cpm ${before}→${after}`)

  // 拖动中（move）也必须认得同一个 id
  const mid = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { id: '', dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 205 }] })
  step(30)
  p.onVSliderMove({ currentTarget: { id: '', dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 315 }] })
  step(30)
  p.onVSliderEnd()
  ok('move 阶段按 data-slider 继续生效', p.data.settings.speedCpm !== mid, `${mid}→${p.data.settings.speedCpm}`)

  // 一个既没 id 也没 data-slider 的事件不能把状态搞坏
  const g = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: {}, touches: [{ clientX: 100, clientY: 205 }] })
  step(30)
  p.onVSliderEnd()
  ok('空事件不崩且不改值', p.data.settings.speedCpm === g, `cpm=${p.data.settings.speedCpm}`)
}

console.log('══════ 9. 几何完全失效时也要拖得动（相对位移兜底）══════')
{
  // 真机上「量不到轨道」有三种常见情形：首帧查询失败、菜单 260ms 动画途中、
  // scroll-view 里刚滚动过。老实现一律 `if (!rect) return` —— 表现就是"拖不动"。
  // 现在没有几何时按手指位移换算，保证手感存在。
  const p = fresh(); step(300)
  p.onOpenMenu(); step(400)
  p._sliderRects = {}
  RECT_MODE = 'null'
  const before = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(40)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 220 }] })
  step(40)
  const after = p.data.settings.speedCpm
  p.onVSliderEnd()
  ok('无几何：向上拖仍然提速', after > before, `${before}→${after}`)

  const mid = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(20)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 360 }] })
  step(20)
  const after2 = p.data.settings.speedCpm
  p.onVSliderEnd()
  ok('无几何：向下拖降速', after2 < mid, `${mid}→${after2}`)

  // 抖动 1px 不应该把读数甩飞
  const guard = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(20)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(20)
  p.onVSliderEnd()
  ok('无几何：零位移不改值', Math.abs(p.data.settings.speedCpm - guard) <= 10, `${guard}→${p.data.settings.speedCpm}`)
  RECT_MODE = 'ok'
}

console.log('══════ 10. 菜单动画中的错误几何不能被采信 ══════')
{
  const p = fresh(); step(300)
  p.onOpenMenu(); // 立刻测：此时 rect 还在屏幕外
  step(400) // 等动画结束后的补测
  ok('开菜单后几何缓存已就绪', Object.keys(p._sliderRects).length >= 7)
  const keys = Object.keys(p._sliderRects)
  ok('缓存里的 rect 都落在视口内', keys.every((k) => p._rectUsableV(p._sliderRects[k]) || p._rectUsableH(p._sliderRects[k])), keys.join(','))

  // 强行塞一个屏幕外的 rect（模拟动画途中量到的），拖动必须拒绝它、退到相对位移
  RECT_MODE = 'offscreen'
  p._sliderRects['vs-speed'] = { top: 1400, bottom: 1520, height: 120, width: 4, left: 100, right: 104 }
  const before = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 300 }] })
  step(30)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 250 }] })
  step(30)
  p.onVSliderEnd()
  const after = p.data.settings.speedCpm
  // 上拖 50px ≈ 一整个轨道高度，按对数刻度应放大约 75 倍 → 会顶到上限，但不该掉到最慢
  ok('屏幕外 rect 被拒绝，改用相对位移（不跳极值）', after > before && after <= 1500, `${before}→${after}`)
  RECT_MODE = 'ok'
}

console.log('══════ 11. 菜单滚动后旧坐标必须作废 ══════')
{
  // 菜单是 scroll-view：滚动后所有轨道的 top 都变了。
  // 缓存不清 → 拖动按旧坐标算 ratio → 数值直接跳到别处（"一拖就飞"）。
  const p = fresh(); step(300)
  p.onOpenMenu(); step(400)
  ok('开菜单后缓存非空', Object.keys(p._sliderRects).length > 0)
  p.onSheetScroll()
  ok('滚动后缓存被清空', Object.keys(p._sliderRects).length === 0)
  // 滚动后再拖：靠触摸时的实时补量，仍然要生效
  TRACK = { top: 120, bottom: 240, height: 120, width: 4, left: 100, right: 104 }
  const before = p.data.settings.speedCpm
  p.onVSliderStart({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 200 }] })
  step(60)
  p.onVSliderMove({ currentTarget: { dataset: { slider: 'vs-speed' } }, touches: [{ clientX: 100, clientY: 140 }] })
  step(40)
  p.onVSliderEnd()
  ok('滚动后拖动按新坐标生效', p.data.settings.speedCpm !== before, `${before}→${p.data.settings.speedCpm}`)
  TRACK = { top: 200, bottom: 320, height: 120, width: 4, left: 100, right: 104 }
}

console.log('══════ 12. 速度是「值」而不是「比例」的回归 ══════')
{
  const p = fresh(); step(300)
  // 直接给值（相对拖动走的就是这条路）：600 就是 600，不是 0.8 之类
  p._applySliderValue('vs-speed', 320)
  ok('给值即生效（cpm）', p.data.settings.speedCpm === 320, 'cpm=' + p.data.settings.speedCpm)
  ok('读数跟着变', p.data.speedText === '320', 'text=' + p.data.speedText)
  const px1 = p.engine.pxPerSecond
  p._applySliderValue('vs-speed', 560)
  ok('提速后引擎 px/s 立即变大', p.engine.pxPerSecond > px1, `${px1.toFixed(2)}→${p.engine.pxPerSecond.toFixed(2)}`)
  p._applySliderValue('vs-speed', 9999)
  ok('超上限被钳到 1500', p.data.settings.speedCpm === 1500, 'cpm=' + p.data.settings.speedCpm)
  p._applySliderValue('vs-speed', -5)
  ok('超下限被钳到 20', p.data.settings.speedCpm === 20, 'cpm=' + p.data.settings.speedCpm)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
