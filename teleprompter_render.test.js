/**
 * 提词页真机问题回归（2026-10-28）
 * ============================================================================
 * 这一轮修的都是「单测绿、真机废」的问题，所以每条断言都对着一个具体现象：
 *
 *   1. 整页无台词 —— WXML 循环变量没声明（见 wxml_template.test.js）
 *   2. 同一句台词连贴 3 个「林晚」—— 断行后的续行也带角色
 *   3. 起播位置偏上 8% —— 留白用了 42%/78%，浅纸是 50%/92%
 *   4. 字号拖不到头 —— 滑块量的是 132px 整格，而轨道只有 84px
 *   5. 聚焦模式高亮错行 —— focusIndex 漏算顶部留白，整篇偏 4 行
 *   6. 手动滚完点播放从旧位置起 —— 节流后的真实位置没被采纳
 */
'use strict'

let T = 1780000000000
const timers = []
let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.requestAnimationFrame = (cb) => { const id = seq++; timers.push({ id, fireAt: T + 16, fn: cb, interval: 0 }); return id }
global.cancelAnimationFrame = () => {}
global.Date.now = () => T

function step(ms) {
  const end = T + ms
  for (;;) {
    timers.sort((a, b) => a.fireAt - b.fireAt)
    const t = timers[0]
    if (!t || t.fireAt > end) break
    timers.shift()
    T = t.fireAt
    t.fn()
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}

const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
const queried = []
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN),
  getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  setKeepScreenOn() {}, setScreenBrightness() {}, setPageOrientation() {},
  navigateTo() {}, navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = {
      _sel: [],
      _rectCbs: [],
      in() { return q },
      select(s) { q._sel.push(s); return q },
      boundingClientRect(cb) { if (cb) q._rectCbs.push(cb); return q },
      exec(cb) {
        queried.push(q._sel.slice())
        // 真机量不到时回调参数是 null，这里如实模拟（页面靠 contentHeight 兜底）
        q._rectCbs.forEach((fn) => fn(null))
        if (cb) cb(q._sel.map(() => null))
      }
    }
    return q
  }
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = {
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p) }
}
global.getApp = () => appMock

let pageDef = null
global.Page = (d) => { pageDef = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (p) { if (p && typeof p === 'object') Object.assign(this.data, p) }
  return inst
}

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n      ' + detail : '')) }
}

const TEXT = [
  '第一场 办公室 日',
  '',
  '林晚：小陈，这份报表今天必须发出去，客户那边已经催了两遍，别再拖了。',
  '陈默：姐，财务还差一组数。',
  '林晚：那就先发，缺的明天补。'
].join('\n')

function fresh() {
  for (const k of Object.keys(mem)) delete mem[k]
  mem['baoge_guide_tp'] = 1
  T += 1000
  const s = store.create('回归稿', TEXT)
  store.save(s)
  const p = makePage()
  p.onLoad({ id: s.id })
  p.onReady()
  return p
}

console.log('\n══════ 1. 台词真的渲染进 data（不是空壳） ══════')
{
  const p = fresh()
  ok('lines 非空', (p.data.lines || []).length > 0, `lines=${(p.data.lines || []).length}`)
  ok('每行都有可渲染文本或角色', (p.data.lines || []).every((l) => l.body !== undefined), '')
  ok('首行文本含「第一场」', String(p.data.lines[0].body || p.data.lines[0].text).indexOf('第一场') >= 0,
    JSON.stringify(p.data.lines[0]))
}

console.log('\n══════ 2. 角色胶囊：每段只贴一次 ══════')
{
  const p = fresh()
  const withRole = p.data.lines.filter((l) => l.role)
  const shown = p.data.lines.filter((l) => l.showRole)
  ok('有角色行数 > 段数（确实被断成多行）', withRole.length > shown.length,
    `带角色行=${withRole.length}，显示胶囊=${shown.length}`)
  ok('每段台词只显示一个胶囊（3 段 → 3 个）', shown.length === 3, `实际 ${shown.length}`)
  ok('林晚的台词被断成 3 行，但胶囊只在首行',
    p.data.lines.filter((l) => l.role === '林晚' && l.showRole).length === 2,
    `林晚胶囊数=${p.data.lines.filter((l) => l.role === '林晚' && l.showRole).length}`)
}

console.log('\n══════ 3. 起播留白对齐浅纸（50vh / 92vh） ══════')
{
  const p = fresh()
  ok('middle → 812 × 50% = 406', p.data.startPad === 406, `startPad=${p.data.startPad}`)
  p._setSetting({ startPosition: 'bottom' }, 'layout')
  step(300) // 排版有 90ms 节流
  ok('bottom → 812 × 92% = 747', p.data.startPad === 747, `startPad=${p.data.startPad}`)
}

console.log('\n══════ 4. 滑块量的是轨道，不是整格 ══════')
{
  queried.length = 0
  const p = fresh()
  p.onOpenMenu()
  step(400) // 等过 260ms 抽屉动画 + 320ms 缓存
  const sels = queried.length ? queried[queried.length - 1] : []
  ok('选择器里包含竖滑块轨道 .tp-vtrack', sels.some((s) => s.indexOf('.tp-vtrack') >= 0), JSON.stringify(sels))
  ok('选择器里包含横滑块轨道 .tp-htrack', sels.some((s) => s.indexOf('.tp-htrack') >= 0), JSON.stringify(sels))
  // 2026-10-28：不再靠「开菜单后延迟 320ms 一次性缓存」——菜单可滚动，滚动后坐标就废了，
  // 而且首次触摸经常赶不上。改为「打开当拍同步量一次 + 动画结束后补量一次」，触摸时再实时补量。
  // 这里钉住四点。
  const cacheSrc = String(pageDef._cacheSliderRects)
  const firstQueryAt = cacheSrc.indexOf('_querySlider')
  const firstTimerAt = cacheSrc.indexOf('setTimeout')
  ok('预取第一拍是同步查询（不等定时器）',
    firstQueryAt >= 0 && (firstTimerAt < 0 || firstQueryAt < firstTimerAt), cacheSrc.slice(0, 80))
  ok('动画结束后还有一次补量（坐标才准）', firstTimerAt > firstQueryAt, cacheSrc.slice(0, 80))
  ok('页面里不再误用 selectorQuery.in(this)', !/\n\s*\.in\(/.test(String(pageDef._measureContent)) && !/\n\s*\.in\(/.test(cacheSrc))
  const startSrc = String(pageDef.onVSliderStart)
  ok('触摸开始时会实时补量几何（缓存为空也能生效）', /_querySlider/.test(startSrc), startSrc.slice(0, 60))
}

console.log('\n══════ 5. 聚焦模式：当前行按指示线算 ══════')
{
  const p = fresh()
  p._setSetting({ focus: true }, 'none')
  ok('focus 已写进 data', p.data.focus === true, `focus=${p.data.focus}`)
  p._paintProgress(0)
  ok('刚起播时高亮第 0 行（不是第 4 行）', p.data.focusIndex === 0, `focusIndex=${p.data.focusIndex}`)
  const half = Math.round(p.data.totalScroll / 2)
  p._paintProgress(half)
  ok('滚到一半高亮行 > 0', p.data.focusIndex > 0, `focusIndex=${p.data.focusIndex}`)
}

console.log('\n══════ 6. 手动滚完点播放：从滚动位置起播 ══════')
{
  const p = fresh()
  const total = p.data.totalScroll
  const target = Math.round(total * 0.6)
  // 模拟 scroll-view 连发 30 次 bindscroll（节流后 data 只更新少数几次）
  for (let i = 0; i < 30; i++) {
    T += 16
    p.onFreeScroll({ detail: { scrollTop: Math.round((target * (i + 1)) / 30) } })
  }
  // 节流窗口内 data.autoTop 可能滞后，但真实位置必须已经跟上
  ok('真实滚动位置已记录', Math.abs(p._freeTop - target) <= 2, `_freeTop=${p._freeTop} target=${target}`)
  const beforeStatus = p.data.status
  p._play()
  ok('从滚动位置起播，而不是回到 0', Math.abs(p.data.autoTop - target) <= 2,
    `status ${beforeStatus} → autoTop=${p.data.autoTop} target=${target}`)
  ok('进入播放态', p.data.status === 'playing', `status=${p.data.status}`)
}

console.log('\n══════ 7. 退出再进来，位置能接上（点「接着读」） ══════')
{
  // 场景：长稿读到 40% 退出，下次进来点「接着读」必须回到原位。
  // 这条以前没测过 —— 而 _savePosition 用的是 data.autoTop / total，
  // 手动滚动走的是 _freeTop，两者不同步一点就会静默存成 0。
  const mem2 = {}
  for (const k of Object.keys(mem)) delete mem[k]
  T += 1000
  const LONG = Array.from({ length: 40 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来撑出足够长的滚动距离。`).join('\n')
  const s = store.create('位置恢复稿', LONG)
  store.save(s)

  const p1 = makePage()
  p1.onLoad({ id: s.id })
  p1.onReady()
  ok('长稿撑出了足够的滚动距离', p1.data.totalScroll > 5000, `totalScroll=${p1.data.totalScroll}`)

  const target = Math.round(p1.data.totalScroll * 0.4)
  p1.onFreeScroll({ detail: { scrollTop: target } })
  step(200)
  p1.onUnload() // 退出时落盘
  step(50)

  const saved = store.getPosition(s.id)
  ok('退出时把进度比例存下来了（不是 0）', saved > 0.3 && saved < 0.5, `store.getPosition=${saved}`)

  // 重新进入：本文件的 showModal 是空实现，这里临时改成「用户点了接着读」
  const origModal = global.wx.showModal
  global.wx.showModal = (o) => { if (o && o.success) o.success({ confirm: true, cancel: false }) }
  const p2 = makePage()
  p2.onLoad({ id: s.id })
  p2.onReady()
  step(300)
  global.wx.showModal = origModal
  ok('点「接着读」后位置精确恢复', Math.abs(p2.data.autoTop - target) <= 3,
    `恢复后 autoTop=${p2.data.autoTop}，退出前 ${target}`)

  // 反向：点「从头开始」必须回到 0，不能残留
  const p3 = makePage()
  global.wx.showModal = (o) => { if (o && o.success) o.success({ confirm: false, cancel: true }) }
  p3.onLoad({ id: s.id })
  p3.onReady()
  step(300)
  global.wx.showModal = origModal
  ok('点「从头开始」后回到 0', p3.data.autoTop === 0, `autoTop=${p3.data.autoTop}`)
}

console.log('\n══════ 8. 播放中直接退出：进度不丢到起点 ══════')
{
  // 场景：播放到一半，用户 iOS 侧滑返回 / Android 系统返回键直接退出（绕过菜单「退出」按钮）。
  // 恢复 ScrollEngine 逐帧内核后：播放中 offset 每帧推进，退出时 _savePosition 直接读
  // engine.current（实时位置），天然不会丢到起点（不再需要 _anim 插值反算）。
  for (const k of Object.keys(mem)) delete mem[k]
  mem['baoge_guide_tp'] = 1
  T += 1000
  const LONG2 = Array.from({ length: 60 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来撑出足够长的滚动距离。`).join('\n')
  const s2 = store.create('播放退出稿', LONG2)
  store.save(s2)

  const p = makePage()
  p.onLoad({ id: s2.id })
  p.onReady()
  p._play()
  ok('进入播放态', p.data.status === 'playing', `status=${p.data.status}`)
  const total = p.data.totalScroll
  const msPerPx = p._msPerPx()
  ok('播放速度已算出', msPerPx > 0, `msPerPx=${msPerPx}`)

  // 推进到大约一半
  const duration = Math.round(total * msPerPx)
  step(Math.round(duration / 2))
  const mid = p.engine.current
  ok('播放中位置已逐帧推进（不再是起点）', mid > 0 && mid < total, `mid=${mid} total=${total}`)

  p.onUnload()
  const saved = store.getPosition(s2.id)
  ok('播放中退出：进度存成 ~50% 而不是 0', saved > 0.3 && saved < 0.7, `saved=${saved.toFixed(4)}`)
}

console.log('\n' + '─'.repeat(56))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
