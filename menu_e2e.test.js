'use strict'
// 端到端实测：逐项验证菜单 26 格 + 底部按钮 + 横竖屏切换
let T = 1780000000000
const timers = []; let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = () => {}
global.setInterval = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = () => {}
global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {}
global.Date.now = () => T
function step(ms) {
  const end = T + ms
  for (;;) {
    timers.sort((a, b) => a.fireAt - b.fireAt)
    const t = timers[0]
    if (!t || t.fireAt > end) break
    timers.shift(); T = t.fireAt; t.fn()
    if (t.interval) { t.fireAt = T + t.interval; timers.push(t) }
  }
  T = end
}
const mem = {}
let pageRef = null
let orientCalls = []
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN), getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k], setStorageSync: (k, v) => { mem[k] = v }, removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn() {}, setScreenBrightness() {}, getScreenBrightness(o) { o && o.success && o.success({ value: 0.6 }) },
  setPageOrientation: (o) => { orientCalls.push(o.orientation); const w = o.orientation === 'landscape' ? 812 : 375; const h = o.orientation === 'landscape' ? 375 : 812; setTimeout(() => { if (pageRef && pageRef.onResize) pageRef.onResize({ size: { windowWidth: w, windowHeight: h } }) }, 0) },
  navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => { const q = { _cb: null, in() { return q }, select() { return q }, boundingClientRect(cb) { q._cb = cb; return q }, exec() { if (q._cb) q._cb(null) } }; return q }
}
const prefsEngine = require('./miniprogram/engine/prefs.js')
global.getApp = () => ({ globalData: { prefs: prefsEngine.load() }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } })
let def = null
global.Page = (d) => { def = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

const SCRIPT = '林晚：第一句台词，比较长一点用来撑行。\n陈默：第二句台词。\n林晚：第三句台词。\n陈默：第四句台词。\n林晚：第五句台词。\n陈默：第六句台词。'
const s = store.create('菜单全测稿', SCRIPT); store.save(s)
mem['baoge_guide_tp'] = 1

function fresh() {
  for (const k of Object.keys(mem)) delete mem[k]
  mem['baoge_guide_tp'] = 1
  store.save(s) // 清空 mem 会把 script 也删掉，这里重新落盘
  const p = Object.create(def)
  p.data = JSON.parse(JSON.stringify(def.data))
  p.setData = function (x) { if (x && typeof x === 'object') Object.assign(this.data, x) }
  pageRef = p
  p.onLoad({ id: s.id })
  p.onReady()
  return p
}

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}

console.log('════════ 1. 速度：改速后引擎 pxPerSecond 真实变化 ════════')
{
  const p = fresh()
  const before = p.engine.pxPerSecond
  ok('引擎已初始化（pxPerSecond > 0）', before > 0, 'pxPerSecond=' + before)
  p._applySliderRatio('vs-speed', 1.0) // 拉到最大 1500cpm
  const after = p.engine.pxPerSecond
  ok('改速后引擎 pxPerSecond 立即更新（非播放态）', after > before, `${before.toFixed(2)} → ${after.toFixed(2)}`)
  ok('data.settings.speedCpm 已到最大值', p.data.settings.speedCpm === 1500, 'speedCpm=' + p.data.settings.speedCpm)
  // 播放验证：_play 前也应保持新速
  const beforePlay = p.engine.pxPerSecond
  p._play()
  ok('_play 后仍用新速度（不回落）', p.engine.pxPerSecond === beforePlay, `play 前 ${beforePlay.toFixed(2)} vs 后 ${p.engine.pxPerSecond.toFixed(2)}`)
  p._pause()
}

console.log('════════ 2. 对齐两档：data + WXML 消费 ════════')
{
  const p = fresh()
  for (const k of ['center', 'left']) {
    p.onSetAlign({ currentTarget: { dataset: { key: k } } })
    ok(`对齐「${k}」写入 data`, p.data.textAlign === k, 'textAlign=' + p.data.textAlign)
    ok(`对齐「${k}」写入 settings`, p.data.settings.textAlign === k)
  }
  // 老四档里的 justify/right 已被拒绝
  p.onSetAlign({ currentTarget: { dataset: { key: 'justify' } } })
  ok('对齐：justify 已下线（不会被写回）', p.data.settings.textAlign !== 'justify', p.data.settings.textAlign)
}

console.log('════════ 3. 台词区宽度：marginHorizontal 变化 + WXML 消费 ════════')
{
  const p = fresh()
  const before = p.data.marginHorizontal
  p._applySliderRatio('hs-contentWidth', 0) // 拉到最小 10%
  const after = p.data.marginHorizontal
  ok('contentWidth 变小时 marginHorizontal 变大', after > before, `${before} → ${after}`)
  ok('settings.contentWidth 已到 10', p.data.settings.contentWidth === 10, 'contentWidth=' + p.data.settings.contentWidth)
}

console.log('════════ 4. 字号/行距/字距/指示线 滑块 ════════')
{
  const p = fresh()
  p._applySliderRatio('vs-fontSize', 1.0)
  ok('字号拉到最大 150', p.data.settings.fontSize === 150, 'fontSize=' + p.data.settings.fontSize)
  p._applySliderRatio('vs-lineHeight', 1.0)
  ok('行距拉到最大 3', p.data.settings.lineHeight === 3, 'lineHeight=' + p.data.settings.lineHeight)
  p._applySliderRatio('vs-letterSpacing', 1.0)
  ok('字距拉到最大 20', p.data.settings.letterSpacing === 20, 'letterSpacing=' + p.data.settings.letterSpacing)
  p._applySliderRatio('vs-cuePosition', 1.0)
  ok('指示线拉到 90', p.data.settings.cuePosition === 90, 'cuePosition=' + p.data.settings.cuePosition)
  p._applySliderRatio('hs-countdown', 1.0)
  ok('倒计时拉到 10s', p.data.settings.countdown === 10, 'countdown=' + p.data.settings.countdown)
}

console.log('════════ 5. 开关类（10 项）════════')
{
  const p = fresh()
  p.onToggleStartPosition(); ok('底部开始 翻转', p.data.settings.startPosition === 'bottom', p.data.settings.startPosition)
  p.onToggleBold(); ok('加粗 翻转', p.data.settings.fontBold === true)
  const fam0 = p.data.settings.fontFamily
  p.onToggleFontFamily(); ok('字体 循环切换', p.data.settings.fontFamily !== fam0, `${fam0}→${p.data.settings.fontFamily}`)
  p.onToggleMirror(); ok('镜像 翻转', p.data.settings.mirror === true)
  p.onToggleLoop(); ok('循环 翻转', p.data.settings.loop === true)
  p.onToggleFocus(); ok('聚焦 翻转', p.data.settings.focus === true)
  p.onToggleClocks(); ok('时间 翻转', p.data.settings.showClocks === false)
  p.onToggleFillLight(); ok('补光 翻转', p.data.settings.fillLight === true)
  p.onToggleRoleHighlight(); ok('角色色 翻转', p.data.settings.roleHighlight === false)
  p.onToggleCue(); ok('参考线 翻转', p.data.settings.showCue === false)
  p.onToggleKeepScreenOn(); ok('屏幕常亮 翻转', p.data.settings.keepScreenOn === false)
}

console.log('════════ 6. 配色托盘（文字色 / 背景色 / 主题，三入口合一）════════')
{
  const p = fresh()
  p.onOpenColor()
  ok('点配色格打开托盘', p.data.colorPicker === 'all', 'colorPicker=' + p.data.colorPicker)
  p.onOpenColor()
  ok('再点一次收起托盘', p.data.colorPicker === '', 'colorPicker=' + p.data.colorPicker)
  p.onOpenColor()
  p.onPickColor({ currentTarget: { dataset: { color: '#FF0000', kind: 'text' } } })
  ok('文字色写入', p.data.settings.textColor === '#FF0000', p.data.settings.textColor)
  p.onPickColor({ currentTarget: { dataset: { color: '#EEEEEE', kind: 'bg' } } })
  ok('背景色写入（不影响文字色）', p.data.settings.backgroundColor === '#EEEEEE' && p.data.settings.textColor === '#FF0000',
    `bg=${p.data.settings.backgroundColor} text=${p.data.settings.textColor}`)
  p.onTapTheme({ currentTarget: { dataset: { bg: '#FFFFFF', text: '#1C1C1E' } } })
  ok('主题套用背景+文字', p.data.settings.backgroundColor === '#FFFFFF' && p.data.settings.textColor === '#1C1C1E')
}

console.log('════════ 7. 速度单位切换（不跳变）════════')
{
  const p = fresh()
  const ms0 = p.engine.pxPerSecond
  p.onToggleSpeedUnit() // cpm → px
  const ms1 = p.engine.pxPerSecond
  ok('切单位后引擎实际速度不变（±2%）', Math.abs(ms1 - ms0) / ms0 < 0.02, `${ms0.toFixed(3)} → ${ms1.toFixed(3)}`)
  ok('单位已切到 px', p.data.settings.speedUnit === 'px', p.data.settings.speedUnit)
}

console.log('════════ 8. 智能总闸（同源 prefs）════════')
{
  const p = fresh()
  const before = p.data.smartOff
  p.onToggleSmartOff()
  ok('智能总闸翻转 + 全局 prefs 同步', p.data.smartOff === !before, `smartOff ${before}→${p.data.smartOff}`)
  p.onToggleSmartOff()
  ok('智能总闸再翻回', p.data.smartOff === before)
}

console.log('════════ 9. 恢复默认 / 声控关闭 / 引导 ════════')
{
  const p = fresh()
  p._setSetting({ speedCpm: 400 }, 'quick')
  p.onResetSettings()
  ok('恢复默认：speedCpm 回 200', p.data.settings.speedCpm === 200, 'speedCpm=' + p.data.settings.speedCpm)
  ok('恢复默认：fontSize 回 45', p.data.settings.fontSize === 45, 'fontSize=' + p.data.settings.fontSize)
  // 声控关闭路径（避免触发 vad 权限）
  p.data.settings.voiceControl = true; p.data.voiceEnabled = true
  p.onToggleVoice()
  ok('声控关闭路径：voiceControl 翻 false', p.data.settings.voiceControl === false, String(p.data.settings.voiceControl))
  // 引导重显
  p.onReplayGuide()
  ok('新手引导重显', p.data.guideVisible === true)
}

console.log('════════ 10. 横竖屏切换 ════════')
{
  const p = fresh()
  const before = p.data.orientation
  p.onToggleOrientation()
  step(600)
  ok('方向已切换', p.data.orientation !== before, `${before}→${p.data.orientation}`)
  ok('setPageOrientation 被调用', orientCalls.length >= 1, JSON.stringify(orientCalls))
}

console.log('════════ 11. WXML 消费点静态核对 ════════')
{
  const fs = require('fs')
  const wxml = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
  ok('台词区绑定对齐 class', /tp-align-\{\{textAlign\}\}/.test(wxml))
  // 2026-10-29：改成全量渲染后不再有切片偏移，margin 回到两段
  ok('台词区绑定宽度 margin', /margin:\s*0 \{\{marginHorizontal\}\}px/.test(wxml))
  // 台词循环必须直接吃 lines（唯一一份数据）；再出现 visibleLines 说明切片逻辑又回来了
  ok('台词直接循环 lines（全量渲染，不再切片）',
    /wx:for="\{\{lines\}\}"/.test(wxml) && !/wx:for="\{\{visibleLines\}\}"/.test(wxml))
  ok('模板里没有切片补偿 visibleTop', !/visibleTop/.test(wxml))
  // 行盒不能再写死 height，否则折行时会和下一行叠在一起
  ok('台词行用 min-height（不写死 height）', /min-height:\s*' \+ lineHeightPx/.test(wxml) && !/style="height: \{\{lineHeightPx\}\}px/.test(wxml))
  // 滑块事件节点必须自带 data-slider，否则 e.currentTarget.id 是空的（2026-10-28 速度锁死真因）
  const vhits = wxml.match(/catchtouchstart="onVSliderStart"/g) || []
  const dsliders = wxml.match(/data-slider="vs-[A-Za-z]+"/g) || []
  ok('每个竖滑块命中区都带 data-slider', vhits.length > 0 && dsliders.length === vhits.length, `${dsliders.length}/${vhits.length}`)
  ok('横滑块也带 data-slider', (wxml.match(/data-slider="hs-[A-Za-z]+"/g) || []).length === 2)
}

console.log('════════ 12. 菜单精简：重复入口已合并/移除 ════════')
{
  const fs = require('fs')
  const wxml = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
  ok('速度：保留竖滑块', /id="vs-speed"/.test(wxml))
  ok('速度：单位并入数值区（点数值切单位）', /tp-val-tap[^>]*catchtap="onToggleSpeedUnit"/.test(wxml))
  ok('速度：独立「速度单位」格已移除', !/tp-cell-label">速度单位/.test(wxml))
  ok('速度：独立「语速预设」行已移除', !/tp-cell-label">语速预设/.test(wxml) && !/onTapSpeedPreset/.test(wxml))
  ok('配色：文字色/背景色合成一格', /tp-color-dual/.test(wxml) && !/tp-cell-label">字体颜色/.test(wxml) && !/tp-cell-label">背景颜色/.test(wxml))
  ok('配色：托盘内含主题快捷', /themePresets/.test(wxml) && /onTapTheme/.test(wxml))
  ok('指示线：位置+显隐合成一格', /tp-val-tap[^>]*catchtap="onToggleCue"/.test(wxml) && !/tp-cell-label">参考线/.test(wxml))
  // 每个控件都有且只有一个 .tp-cell-label，用它数控件数最准
  const cells = (wxml.match(/tp-cell-label/g) || []).length
  ok('菜单控件数已精简到 21 个以内', cells <= 21, `实际 ${cells} 个控件`)
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
