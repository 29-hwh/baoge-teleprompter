'use strict'
/**
 * 台词排版 / 叠字回归测试（2026-10-28）
 *
 * 真机症状：台词一行压一行（截图上「袁甘哥（挠了挠头打岔…」与下一行叠在一起）。
 * 根因链：
 *   1) 行盒写死 height: lineHeightPx，而 CSS 一旦把内容折成两行，第二行就会画到
 *      下一行的位置上 → 叠字（overflow 可见，不报错）。
 *   2) 可用宽度没扣安全区（横屏刘海），每行多算 1–2 个字 → 折行更容易发生。
 *   3) 虚拟列表只渲染切片，却把「切片高度」当全文高度量回来 → 长稿 totalScroll 只有
 *      真实值的一小截（读一半就滑到底、字/分钟全错）。
 * 这个文件把三条都钉住。
 */
let T = 1780000000000
const timers = []
let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.requestAnimationFrame = () => 1
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
let CUR = null // 当前页面实例，供 selectorQuery 模拟真实 DOM 高度

global.wx = {
  getWindowInfo: () => Object.assign({}, WIN),
  getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn() {},
  setScreenBrightness() {},
  getScreenBrightness(o) { o && o.success && o.success({ value: 0.6 }) },
  setPageOrientation() {},
  navigateBack() {},
  showModal() {},
  showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = {
      _sel: '',
      in() { return q },
      select(sel) { q._sel = sel; return q },
      boundingClientRect(cb) { q._cb = cb; return q },
      exec(done) {
        // 模拟真实布局：.tp-lines 的高度 = 当前渲染切片各行高度之和
        if (q._sel === '.tp-lines' && CUR && CUR._lineHs) {
          const start = CUR.data.visibleStart || 0
          const n = (CUR.data.visibleLines || []).length
          let h = 0
          for (let i = start; i < start + n && i < CUR._lineHs.length; i++) h += CUR._lineHs[i]
          if (q._cb) q._cb({ height: h, width: 343, top: 0, bottom: h, left: 16, right: 359 })
        } else if (q._cb) {
          q._cb(null)
        }
        if (done) done([])
      }
    }
    return q
  }
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
global.getApp = () => ({
  globalData: { prefs: prefsEngine.load() },
  updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs }
})

let def = null
global.Page = (d) => { def = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}

function fresh(script, width) {
  for (const k of Object.keys(mem)) delete mem[k]
  const s = store.create('排版稿', script)
  store.save(s)
  mem['baoge_guide_tp'] = 1
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
  CUR = p
  p.onLoad({ id: s.id })
  p.onReady()
  step(120)
  return p
}

/* ── 1. 源文件静态检查 ── */
console.log('══════ 1. 行盒不再写死高度 ══════')
{
  const fs = require('fs')
  const wxml = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
  const wxss = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxss', 'utf8')
  ok('行样式用 min-height', /min-height:\s*' \+ lineHeightPx/.test(wxml))
  ok('行样式不再有 height: {{lineHeightPx}}', !/style="height: \{\{lineHeightPx\}\}px;/.test(wxml))
  ok('.tp-align-justify 已下线（对齐只剩居中/左）', !/\.tp-align-justify/.test(wxss))
  ok('.tp-line overflow 保持 visible（折行不裁字）', /\.tp-line\s*\{[^}]*overflow:\s*visible/.test(wxss))
}

/* ── 2. 折行估高 ── */
console.log('══════ 2. 超宽行按 2 行算高 ══════')
{
  // 375 宽 / 字号 45 / 内容宽 100%：每行 7 个汉字。
  // 下面这句第 8 个字符是「。」（避头尾规则不允许出现在行首），解析器会把它留在上一行，
  // 于是这一行有 8 个字、必然被 CSS 折成两行 —— 老版本写死 height 时就是这里叠字。
  const p = fresh('一二三四五六七。\n乙：短句')
  const lineH = p.data.lineHeightPx
  const over = p.displayLines.filter((l) => l.body && l.body.length >= 8)
  ok('确实存在超宽行（构造前提）', over.length > 0, 'lines=' + p.displayLines.map((l) => l.body).join('|'))
  ok('超宽行按 2 行算高', p._lineHs[0] === lineH * 2, `hs=${p._lineHs.join(',')}`)
  ok('短行仍是 1 行', p._lineHs[p._lineHs.length - 1] === lineH, `hs=${p._lineHs.join(',')}`)
  ok('contentHeight = 各行高度之和', p.contentHeight === p._lineHs.reduce((a, b) => a + b, 0))
  ok('行高地形图单调递增', p._lineTops.every((v, i) => i === 0 || v > p._lineTops[i - 1]))
}

/* ── 3. 地形图二分 ── */
console.log('══════ 3. offset → 行号 二分定位 ══════')
{
  const p = fresh('甲：一二三四五六七八九十十一十二十三\n乙：短句\n丙：另一句台词')
  const tops = p._lineTops
  ok('y=0 落在第 0 行', p._indexAtOffset(0) === 0)
  ok('第 1 行顶部落在第 1 行', p._indexAtOffset(tops[1]) === 1, `tops=${tops.join(',')}`)
  ok('第 1 行中部仍落在第 1 行', p._indexAtOffset(tops[1] + 5) === 1)
  ok('超出末尾钳制到最后一行', p._indexAtOffset(999999) === tops.length - 1)
}

/* ── 4. 虚拟列表切片定位（长稿不再整屏偏移） ── */
console.log('══════ 4. 虚拟列表切片带 visibleTop ══════')
{
  const body = Array.from({ length: 200 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来撑出足够长的滚动距离。`)
  const p = fresh(body.join('\n'))
  const lineH = p.data.lineHeightPx
  ok('长稿已裁剪（不是全量渲染）', p.data.visibleLines.length < p.displayLines.length, `${p.data.visibleLines.length}/${p.displayLines.length}`)
  const target = Math.round(p.data.totalScroll * 0.5)
  p._seekPx(target)
  step(20)
  const startTop = p._lineTops[p.data.visibleStart]
  const sliceH = p._lineHs.slice(p.data.visibleStart, p.data.visibleStart + p.data.visibleLines.length).reduce((a, b) => a + b, 0)
  ok('滚到中段后切片起点 > 0', p.data.visibleStart > 0, 'start=' + p.data.visibleStart)
  ok('visibleTop 与切片起点一致', p.data.visibleTop === startTop, `${p.data.visibleTop} vs ${startTop}`)
  // 视口 [offset, offset+winH] 必须被渲染切片覆盖，否则真机就是白屏
  const viewTop = target - (p.data.startPad || 0)
  ok('切片覆盖视口顶部', p.data.visibleTop <= viewTop, `${p.data.visibleTop} <= ${viewTop}`)
  ok('切片覆盖视口底部', p.data.visibleTop + sliceH >= viewTop + p.winHeight, `${p.data.visibleTop + sliceH} >= ${viewTop + p.winHeight}`)
  ok('切片高度不超过 40 行', p.data.visibleLines.length <= Math.ceil(p.winHeight / lineH) + 25)
}

/* ── 5. 长稿 totalScroll 用标定，不被切片截断 ── */
console.log('══════ 5. 长稿滚动距离 = 全文高度（不是切片高度）══════')
{
  const body = Array.from({ length: 120 }, (_, i) => `陈默：第 ${i + 1} 行。`)
  const p = fresh(body.join('\n'))
  const estFull = p._lineHs.reduce((a, b) => a + b, 0)
  ok('textHeight ≈ 全文估算高度', Math.abs(p.data.textHeight - estFull) <= 2, `textHeight=${p.data.textHeight} est=${estFull}`)
  const expectTotal = Math.max(0, p.data.startPad + p.data.textHeight + p.data.endPad - p.winHeight)
  ok('totalScroll 用全文高度算', Math.abs(p.data.totalScroll - expectTotal) <= 2, `${p.data.totalScroll} vs ${expectTotal}`)
  ok('totalScroll 远大于「前 35 行」的高度', p.data.totalScroll > 35 * p.data.lineHeightPx, `totalScroll=${p.data.totalScroll}`)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
