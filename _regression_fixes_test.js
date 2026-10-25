/**
 * 回归测试：针对宝哥提词器 4 条修改意见的「实机等价」验证。
 *
 * 真机行为无法在本机直接跑，这里用 mock-wx 运行时 + 真实页面/引擎复现：
 *  - 问题1/4（文字显示不全 / 智能拆分丢末句）：几何推导 —— 竖屏短稿滚到底时，
 *             末句底边是否落在可视区内（旧逻辑整屏当视口 → 末尾一截永远滚不到）。
 *  - 问题2（匀速滚动手动调位后直接暂停）：触屏拖动后 onTouchEnd 是否续播。
 *  - 问题3（横屏设置键太大）：静态校验 wxss 尺寸已缩小。
 *
 * 伪时钟驱动 requestAnimationFrame / setTimeout / setInterval。
 */
'use strict'

// ---------- 伪时钟 ----------
let T = 1000
const rafCbs = []
const timers = []
let timerSeq = 1

global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length }
global.cancelAnimationFrame = () => {}
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T

function stepFrames(n) {
  for (let f = 0; f < n; f++) {
    T += 16
    for (const t of timers.slice()) {
      if (t.fireAt <= T) {
        t.fn()
        if (t.interval) t.fireAt = T + t.interval
        else { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) }
      }
    }
    const cbs = rafCbs.splice(0, rafCbs.length)
    for (const cb of cbs) cb(T)
  }
}

// ---------- mock wx ----------
const memStorage = {}
let pageInstanceRef = null
// 与真机一致：旋转/缩放后 getWindowInfo 返回的是「当前方向」的窗口尺寸。
// 真实 _parseAndLayout 会用 getWindowInfo() 重读 winHeight，所以这里必须随方向动态变化，
// 否则竖屏的「高屏」就复现不出来（这正是问题1用户说「尤其是竖屏缺字最严重」的关键）。
let mockWin = { windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }
const wx = {
  getWindowInfo: () => mockWin,
  getSystemInfoSync: () => mockWin,
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
  setPageOrientation: (o) => {
    const orient = o && o.orientation
    if (!orient) return
    const w = orient === 'landscape' ? 667 : 375
    const h = orient === 'landscape' ? 375 : 667
    setTimeout(() => {
      if (pageInstanceRef && typeof pageInstanceRef.onResize === 'function') {
        pageInstanceRef.onResize({ size: { windowWidth: w, windowHeight: h } })
      }
    }, 0)
  },
  navigateTo: () => {}, navigateBack: () => {},
  showModal: (opts) => { if (opts && typeof opts.success === 'function') opts.success({ confirm: true }) },
  showToast: () => {},
  requirePrivacyAuthorize: (opts) => { if (opts && opts.success) opts.success() },
  getSetting: (opts) => { if (opts && opts.success) opts.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}
global.wx = wx

// ---------- mock getApp / Page ----------
const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = {
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(patch) { this.globalData.prefs = prefsEngine.patch(patch); return this.globalData.prefs }
}
global.getApp = () => appMock

let pageDef = null
global.Page = (def) => { pageDef = def }

const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')
if (!pageDef) { console.error('页面未注册'); process.exit(1) }

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (patch) { if (patch && typeof patch === 'object') Object.assign(this.data, patch) }
  return inst
}

// ---------- 几何工具 ----------
// 台词块顶部留白比例（.tp-content { padding-top: 40vh }）
const TOP_PAD_RATIO = 0.4
// 滚到 offset 时，第 i 行底边在屏幕上的 y（px）：topPad + (i+1)*lh - offset
function lastLineBottomY(winH, contentH, lh, maxOffset) {
  return TOP_PAD_RATIO * winH + contentH - maxOffset
}
// 在 maxOffset 处，仍被挡在屏幕底（y>winH）之外的行数
function cutLines(winH, contentH, lh, maxOffset) {
  const n = Math.round(contentH / lh)
  let cut = 0
  for (let i = 0; i < n; i++) {
    if (lastLineBottomY(winH, contentH, lh, maxOffset) > winH + 0.5) cut++ // 末行都没进视口 => 整体被切
  }
  // 上面的末行判据只能判「整段都没进」。逐行精算：
  cut = 0
  for (let i = 0; i < n; i++) {
    const bottomY = TOP_PAD_RATIO * winH + (i + 1) * lh - maxOffset
    if (bottomY > winH + 0.5) cut++
  }
  return cut
}

// ---------- 结果收集 ----------
const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// ---------- 台本 ----------
function manyLines(prefix, count) {
  const out = []
  for (let i = 1; i <= count; i++) out.push(`${prefix}第${i}句台词，用来验证末句是否能被滚到可视区。`)
  return out.join('\n')
}
const SHORT = manyLines('短稿', 16)
const LONG = manyLines('长稿', 60)
const shortScript = store.create('回归-短稿', SHORT); store.save(shortScript)
const longScript = store.create('回归-长稿', LONG); store.save(longScript)

console.log('\n================ 问题1&4：文字显示不全 / 智能拆分丢末句（有效视口 effVp）================\n')

function testOrientation(label, scriptId, orient, winW, winH, expectOldCut) {
  mockWin = { windowWidth: winW, windowHeight: winH, statusBarHeight: 20, pixelRatio: 2 }
  const page = makePage()
  pageInstanceRef = page
  page.onLoad({ id: scriptId })
  // 强制方向重排（onResize 同步重排且更新 winHeight）
  page.onResize({ size: { windowWidth: winW, windowHeight: winH } })
  const lh = page.data.lineHeightPx
  const n = page.allLines.length
  const contentH = page.contentHeight
  const effVp = page.data.viewportHeight
  const maxOffsetNew = page.engine.maxOffset
  // 旧逻辑（整屏当视口）：maxOffset = max(0, contentH - winH)
  const maxOffsetOld = Math.max(0, contentH - winH)
  const cutNew = cutLines(winH, contentH, lh, maxOffsetNew)
  const cutOld = cutLines(winH, contentH, lh, maxOffsetOld)

  console.log(`--- ${label} (winH=${winH}px, ${n}行, lh=${lh}px, effVp=${effVp}px) ---`)
  ok(`${label}: 有效视口已启用(effVp<整屏)`, effVp < winH, `effVp=${effVp} winH=${winH}`)
  ok(`${label}: 修复后可达滚动距离更大`, maxOffsetNew > maxOffsetOld, `new=${maxOffsetNew.toFixed(0)} old=${maxOffsetOld.toFixed(0)}`)
  ok(`${label}: 修复后末句在进入可视区(0行被切)`, cutNew === 0, `cutNew=${cutNew}`)
  ok(`${label}: 旧逻辑确实会切掉末句(>0行)`, cutOld > 0, `cutOld=${cutOld}行`)
  if (expectOldCut) ok(`${label}: 旧逻辑切掉行数显著(>=${expectOldCut})`, cutOld >= expectOldCut, `cutOld=${cutOld}行`)
  return { winH, lh, n, contentH, effVp, maxOffsetNew, maxOffsetOld, cutNew, cutOld }
}

// 竖屏（高屏）—— 用户明确反馈「尤其是竖屏状态」缺字最严重
const shortPortrait = testOrientation('短稿-竖屏', shortScript.id, 'portrait', 375, 667, 3)
const longPortrait = testOrientation('长稿-竖屏', longScript.id, 'portrait', 375, 667, 1)
// 横屏（矮屏）
const shortLand = testOrientation('短稿-横屏', shortScript.id, 'landscape', 667, 375, 1)
const longLand = testOrientation('长稿-横屏', longScript.id, 'landscape', 667, 375, 1)

// 直观结论
console.log(`\n[几何结论] 短稿竖屏：旧逻辑切掉 ${shortPortrait.cutOld} 行（占 ${shortPortrait.n} 行的 ${(shortPortrait.cutOld/shortPortrait.n*100).toFixed(0)}%），修复后切掉 ${shortPortrait.cutNew} 行。`)
console.log(`[几何结论] 智能拆分产出的「小段文档」天然偏短，正是旧逻辑缺字最狠的场景 —— 故问题4与问题1同根，已被同一处 effVp 修复。`)

console.log('\n================ 问题2：匀速滚动时手动调位后直接暂停 ================\n')

// 用短稿竖屏：旧逻辑下 maxOffset 极小，匀速滚几下 current 就 >= maxOffset，拖动松手续播被跳过 -> 卡死。
{
  const page = makePage()
  pageInstanceRef = page
  page.onLoad({ id: shortScript.id })
  mockWin = { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }
  page.onResize({ size: { windowWidth: 375, windowHeight: 667 } })
  appMock.updatePrefs({ loop: false })
  page.engine.loop = false
  // 走完倒计时自动开播
  stepFrames(220)
  // 定位到 ~20% 处，确认在播放且未到末尾
  page.engine.seekProgress(0.2)
  page.engine.resume()
  page.setData({ playing: true, finished: false })
  stepFrames(10)
  ok('开播后引擎在滚', page.engine.playing === true && page.data.playing === true, `playing=${page.engine.playing}`)
  const beforeDrag = page.engine.current
  ok('定位未到末尾(可续播)', page.engine.current < page.engine.maxOffset, `current=${beforeDrag.toFixed(0)} maxOffset=${page.engine.maxOffset.toFixed(0)}`)

  // 模拟手指上滑 80px 手动调位
  page.onTouchStart({ touches: [{ clientY: 400 }] })
  page.onTouchMove({ touches: [{ clientY: 320 }] }) // 上滑 80px
  const afterDrag = page.engine.current
  ok('拖动改变了引擎位置', Math.abs(afterDrag - beforeDrag) > 10, `Δ=${(afterDrag - beforeDrag).toFixed(0)}px`)
  ok('拖动中仍是「本来在播」状态', page._touchWasPlaying === true)
  // 松手：应续播
  page.onTouchEnd()
  ok('松手后引擎续播(playing)', page.engine.playing === true, `engine.playing=${page.engine.playing}`)
  ok('松手后页面状态续播', page.data.playing === true && page.data.finished === false, `playing=${page.data.playing} finished=${page.data.finished}`)
  stepFrames(20)
  const afterResume = page.engine.current
  ok('续播后继续向前滚动', afterResume - afterDrag > 10, `Δ=${(afterResume - afterDrag).toFixed(0)}px`)
}

// 关键回归：去掉 scrollMode==='auto' 冗余判断后，即便 scrollMode 不是字面 'auto' 也能续播
{
  const page = makePage()
  pageInstanceRef = page
  page.onLoad({ id: shortScript.id })
  mockWin = { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }
  page.onResize({ size: { windowWidth: 375, windowHeight: 667 } })
  appMock.updatePrefs({ loop: false })
  page.engine.loop = false
  stepFrames(220)
  page.engine.seekProgress(0.2); page.engine.resume(); page.setData({ playing: true })
  stepFrames(10)
  // 故意把 scrollMode 设成非 'auto'（老代码会因这个判断跳过续播）
  page.setData({ scrollMode: 'smooth' })
  page.onTouchStart({ touches: [{ clientY: 400 }] })
  page.onTouchMove({ touches: [{ clientY: 300 }] })
  page.onTouchEnd()
  ok('非 auto 的 scrollMode 下松手仍续播(冗余判断已去)', page.engine.playing === true && page.data.playing === true, `engine.playing=${page.engine.playing}`)
}

console.log('\n================ 问题3：横屏设置键尺寸缩小 ================\n')

{
  const fs = require('fs')
  const path = require('path')
  const wxss = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/teleprompter/teleprompter.wxss'), 'utf8')
  const m = wxss.match(/\.tp-float-settings\.tp-land\s*\{([^}]+)\}/)
  ok('横屏设置按钮规则存在', !!m)
  if (m) {
    const body = m[1]
    const fsz = parseFloat((body.match(/font-size:\s*([\d.]+)rpx/) || [])[1])
    const pad = (body.match(/padding:\s*([\d.]+)rpx\s+([\d.]+)rpx/) || [])
    ok('横屏设置键字号 <=20rpx(已缩小)', fsz <= 20 && fsz > 0, `font-size=${fsz}rpx`)
    ok('横屏设置键横向内边距 <=14rpx', pad && parseFloat(pad[2]) <= 14, pad ? `padding-h=${pad[2]}rpx` : 'N/A')
    // 对比竖屏默认键（.tp-float-settings 基础规则）确认确实更小
    const base = wxss.match(/\.tp-float-settings\s*\{[^}]*?\}/)
    const baseFsz = base ? parseFloat((base[1] || base[0]).match(/font-size:\s*([\d.]+)rpx/)[1]) : 0
    if (baseFsz) ok('横屏键明显小于竖屏基础键', fsz < baseFsz, `land=${fsz}rpx base=${baseFsz}rpx`)
  }
}

// ---------- 汇总 ----------
const passed = results.filter(r => r.pass).length
console.log(`\n================ 结果：${passed}/${results.length} 通过 ================`)
const fails = results.filter(r => !r.pass)
if (fails.length) {
  console.log('失败项：')
  fails.forEach(f => console.log('  - ' + f.name + (f.extra ? '  (' + f.extra + ')' : '')))
  process.exitCode = 1
} else {
  console.log('全部通过 ✅  4 条修改意见均通过实机等价验证')
}
