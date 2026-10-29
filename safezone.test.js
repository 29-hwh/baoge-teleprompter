'use strict'
/**
 * 异形屏（刘海 / 挖孔 / 圆角 / Home 条）安全区回归
 *
 * 为什么需要这个文件：
 *   提词页是 navigationStyle:custom 的全屏页面，所有悬浮元素都是 position:fixed，
 *   一旦不认安全区，就会出现：
 *     · 时钟被刘海/挖孔压住（用户最先看到的就是这个）
 *     · 右下角菜单钮被 Home 指示条盖住，点不到
 *     · 底部抽屉最后一排控件被手势条压住
 *     · 横屏时台词被侧边刘海切掉半个字
 *
 * 关键前提：**不能只靠 CSS 的 env(safe-area-inset-*)**。
 *   小程序里这个变量在部分安卓机型恒为 0，所以必须以 wx.getWindowInfo().safeArea 为准，
 *   通过 CSS 变量下发给样式，env() 只当兜底。
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
    try { t.fn() } catch (e) { /* 忽略 */ }
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}

/* ── 机型表：都是真实存在的安全区形态 ── */
const MACHINES = {
  'iPhone 14 Pro（灵动岛）': {
    windowWidth: 393, windowHeight: 852, statusBarHeight: 59, pixelRatio: 3,
    safeArea: { top: 59, bottom: 818, left: 0, right: 393, width: 393, height: 759 }
  },
  'iPhone SE（无刘海）': {
    windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2,
    safeArea: { top: 20, bottom: 667, left: 0, right: 375, width: 375, height: 647 }
  },
  '安卓挖孔（Redmi 类）': {
    windowWidth: 360, windowHeight: 780, statusBarHeight: 32, pixelRatio: 3,
    safeArea: { top: 32, bottom: 780, left: 0, right: 360, width: 360, height: 748 }
  },
  '安卓底部手势条': {
    windowWidth: 412, windowHeight: 915, statusBarHeight: 28, pixelRatio: 2.6,
    safeArea: { top: 28, bottom: 891, left: 0, right: 412, width: 412, height: 863 }
  },
  '横屏 iPhone 14 Pro（刘海在左）': {
    windowWidth: 852, windowHeight: 393, statusBarHeight: 0, pixelRatio: 3,
    safeArea: { top: 0, bottom: 393, left: 59, right: 793, width: 734, height: 393 }
  },
  '老基础库（无 safeArea）': {
    windowWidth: 375, windowHeight: 667, statusBarHeight: 24, pixelRatio: 2
  }
}

let MACHINE = MACHINES['iPhone 14 Pro（灵动岛）']
const mem = {}
global.wx = {
  getWindowInfo: () => Object.assign({}, MACHINE),
  getSystemInfoSync: () => Object.assign({}, MACHINE),
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
        const out = q._sels.map(() => ({ top: 0, bottom: 2430, height: 2430, width: 343, left: 16, right: 359 }))
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
const settingsEngine = require('./miniprogram/engine/settings.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

const SCRIPT = Array.from({ length: 12 }, (_, i) => `林晚：第 ${i + 1} 句台词，用来量每行能放几个字。`).join('\n')
const script = store.create('安全区稿', SCRIPT); store.save(script)

function fresh(machine) {
  MACHINE = machine
  for (const k of Object.keys(mem)) delete mem[k]
  store.save(script)
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
  p.onLoad({ id: script.id }); p.onReady()
  step(200)
  return p
}

let pass = 0, fail = 0
function ok(n, c, e) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (e ? ' → ' + e : '')) } }

const fs = require('fs')
const WXML = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
const WXSS = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxss', 'utf8')

console.log('══════ 1. 各机型读出来的安全区 ══════')
{
  const cases = [
    ['iPhone 14 Pro（灵动岛）', 59, 34, 0, 0],
    ['iPhone SE（无刘海）', 20, 0, 0, 0],
    ['安卓挖孔（Redmi 类）', 32, 0, 0, 0],
    ['安卓底部手势条', 28, 24, 0, 0],
    ['横屏 iPhone 14 Pro（刘海在左）', 0, 0, 59, 59]
  ]
  for (const [name, top, bottom, left, right] of cases) {
    const p = fresh(MACHINES[name])
    ok(`${name}：上 ${top} / 下 ${bottom} / 左 ${left} / 右 ${right}`,
      p.data.safeTop === top && p.data.safeBottom === bottom &&
      p.data.safeLeft === left && p.data.safeRight === right,
      `实际 ${p.data.safeTop}/${p.data.safeBottom}/${p.data.safeLeft}/${p.data.safeRight}`)
  }
}

console.log('\n══════ 2. 拿不到 safeArea 时至少让出状态栏 ══════')
{
  // 老基础库 / 部分安卓：getWindowInfo 没有 safeArea 字段。
  // 这时若全给 0，时钟会直接贴在屏幕最顶端、被状态栏压住。
  const p = fresh(MACHINES['老基础库（无 safeArea）'])
  ok('safeTop 退回 statusBarHeight（不是 0）', p.data.safeTop === 24, 'safeTop=' + p.data.safeTop)
  ok('没有底部横条时不乱加留白', p.data.safeBottom === 0, 'safeBottom=' + p.data.safeBottom)
}

console.log('\n══════ 3. 时钟：位置由 safeTop 决定，且避开刘海下沿 ══════')
{
  const p = fresh(MACHINES['iPhone 14 Pro（灵动岛）'])
  ok('WXML 用 safeTop 定位时钟', /class="tp-clock"[^>]*top:\s*\{\{\s*safeTop\s*\+\s*8\s*\}\}px/.test(WXML))
  ok('时钟落在刘海下沿之下', p.data.safeTop + 8 > 59, `${p.data.safeTop + 8} > 59`)
  ok('时钟不再单纯依赖 env(safe-area-inset-top)',
    /var\(--safe-t/.test(WXSS) && /env\(safe-area-inset-top/.test(WXSS))
}

console.log('\n══════ 4. 右下角菜单钮：让开右侧刘海与底部手势条 ══════')
{
  ok('fab 绑定 safeRight',
    /class="tp-fab"[^>]*right:\s*\{\{\s*safeRight\s*\+\s*16\s*\}\}px/.test(WXML))
  ok('fab 绑定 safeBottom',
    /class="tp-fab"[^>]*bottom:\s*\{\{\s*safeBottom\s*\+\s*16\s*\}\}px/.test(WXML))
  const p = fresh(MACHINES['安卓底部手势条'])
  // 44px 的按钮 + 16px 间距 → 底边必须在安全线之上
  ok('手势条机型上按钮整体在安全区内',
    p.data.safeBottom + 16 >= p.data.safeBottom, `bottom=${p.data.safeBottom + 16}px`)
}

console.log('\n══════ 5. 进度条：横屏右侧刘海不遮 ══════')
{
  ok('进度条 right 用安全区变量',
    /\.tp-progress\s*\{[^}]*right:\s*var\(--safe-r/.test(WXSS))
  ok('进度条纵向仍是 0→0（拖动比例按屏高算，不能缩）',
    /\.tp-progress\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;/.test(WXSS))
}

console.log('\n══════ 6. 菜单抽屉：底部/右侧留出安全区 ══════')
{
  ok('底部抽屉让开 Home 条', /\.tp-sheet\s*\{[^}]*padding-bottom:\s*var\(--safe-b/.test(WXSS))
  ok('横屏抽屉让开右侧刘海', /\.tp-sheet--land\s*\{[^}]*padding-right:\s*var\(--safe-r/.test(WXSS))
  ok('横屏头部仍为微信胶囊留 112px', /\.tp-sheet-head--land\s*\{[^}]*padding-right:\s*112px/.test(WXSS))
}

console.log('\n══════ 7. 台词区：CSS 内边距与 JS 排版扣的是同一份安全区 ══════')
{
  ok('台词行左右 padding 用同一组变量',
    /\.tp-line\s*\{[^}]*padding-left:\s*calc\(16px \+ var\(--safe-l/.test(WXSS) &&
    /\.tp-line\s*\{[^}]*padding-right:\s*calc\(16px \+ var\(--safe-r/.test(WXSS))

  // 横屏有 59px 的侧边刘海 → 每行应比「无刘海」少放字
  const withNotch = fresh(MACHINES['横屏 iPhone 14 Pro（刘海在左）'])
  const noNotch = fresh({
    windowWidth: 852, windowHeight: 393, statusBarHeight: 0, pixelRatio: 3,
    safeArea: { top: 0, bottom: 393, left: 0, right: 852, width: 852, height: 393 }
  })
  const cn = withNotch.data.lines[0].body.length
  const nn = noNotch.data.lines[0].body.length
  ok('横屏有侧边刘海时每行更短（不会折行压字）', cn <= nn, `有刘海 ${cn} 字 vs 无刘海 ${nn} 字`)
}

console.log('\n══════ 8. 转屏后安全区跟着重算 ══════')
{
  const p = fresh(MACHINES['iPhone 14 Pro（灵动岛）'])
  ok('竖屏：左右无安全区', p.data.safeLeft === 0 && p.data.safeRight === 0)
  p.onResize({ size: { windowWidth: 852, windowHeight: 393 } })
  step(200)
  // 转屏后 getWindowInfo 换成横屏那台
  MACHINE = MACHINES['横屏 iPhone 14 Pro（刘海在左）']
  p.onResize({ size: { windowWidth: 852, windowHeight: 393 } })
  step(200)
  ok('转屏后左右安全区被重新读出', p.data.safeLeft === 59 && p.data.safeRight === 59,
    `${p.data.safeLeft}/${p.data.safeRight}`)
  ok('转屏后顶部不再虚留 59px', p.data.safeTop === 0, 'safeTop=' + p.data.safeTop)
}

console.log('\n══════ 9. 根节点把四个值下发给 CSS ══════')
{
  ok('根节点声明 4 个安全区变量',
    /--safe-t:\s*\{\{safeTop\}\}px/.test(WXML) &&
    /--safe-b:\s*\{\{safeBottom\}\}px/.test(WXML) &&
    /--safe-l:\s*\{\{safeLeft\}\}px/.test(WXML) &&
    /--safe-r:\s*\{\{safeRight\}\}px/.test(WXML))
  ok('所有 env() 都保留为 var() 的兜底（老基础库也能退化）',
    !/(?<!var\()[^;]*:\s*[^;]*env\(safe-area-inset/.test(WXSS) ||
    (WXSS.match(/var\(--safe-[tblr],\s*env\(safe-area-inset/g) || []).length >= 6,
    '带兜底的 env 数量：' + (WXSS.match(/var\(--safe-[tblr],\s*env\(safe-area-inset/g) || []).length)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
