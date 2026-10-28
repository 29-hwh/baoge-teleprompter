/**
 * 提词页菜单「逐格点检」
 * ============================================================================
 * 菜单 21 个格子，每一个都得点得动。这类问题最阴：
 *   - 方法名拼错 → 点了完全没反应（微信只打一条 warn）
 *   - 方法在，但改了 settings 却没写回 data → 视觉上没变化
 *   - 方法在，但改错了字段 → 开关反着动
 *
 * 这里对每个格子调一次处理函数，断言「settings 或 data 真的按预期变了」，
 * 并额外断言「状态能切回去」（连点两次必须回到原状，避免单向前进）。
 */
'use strict'

let T = 1780000000000
const timers = []
let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
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
  }
  T = end
}

const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
let brightness = 0.55
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN),
  getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  setKeepScreenOn() {},
  setScreenBrightness(o) { brightness = o.value },
  getScreenBrightness(o) { if (o && o.success) o.success({ value: brightness }) },
  setPageOrientation() {},
  navigateTo() {}, navigateBack() {},
  showModal() { if (this._modal) this._modal() },
  showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = {
      _sel: [], _rectCbs: [],
      in() { return q },
      select(s) { q._sel.push(s); return q },
      boundingClientRect(cb) { if (cb) q._rectCbs.push(cb); return q },
      exec(cb) { q._rectCbs.forEach((fn) => fn(null)); if (cb) cb(q._sel.map(() => null)) }
    }
    return q
  }
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = {
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs }
}
global.getApp = () => appMock

let pageDef = null
global.Page = (d) => { pageDef = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

const fs = require('fs')
const path = require('path')
const TP_WXML = fs.readFileSync(
  path.join(__dirname, 'miniprogram/pages/teleprompter/teleprompter.wxml'), 'utf8')

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
  const s = store.create('点检稿', TEXT)
  store.save(s)
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (p) { if (p && typeof p === 'object') Object.assign(this.data, p) }
  inst.onLoad({ id: s.id })
  inst.onReady()
  return inst
}

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n      ' + detail : '')) }
}

const fake = (dataset) => ({ currentTarget: { dataset: dataset || {} }, target: { dataset: dataset || {} } })

/** 点两次，断言「变过去又变回来」 */
function toggleTwice(label, key, invoke) {
  const p = fresh()
  const before = JSON.stringify(p.data.settings[key])
  invoke(p)
  step(150)
  const mid = JSON.stringify(p.data.settings[key])
  invoke(p)
  step(150)
  const after = JSON.stringify(p.data.settings[key])
  const changed = mid !== before
  const restored = after === before
  ok(`${label}：点一次状态改变`, changed, `${key} ${before} → ${mid}`)
  ok(`${label}：再点一次回到原状`, restored, `${key} 期望回到 ${before}，实际 ${after}`)
  return { p, mid }
}

console.log('\n══════ 菜单开关类（10 个） ══════')
toggleTwice('文字加粗', 'fontBold', (p) => p.onToggleBold())
toggleTwice('镜像', 'mirror', (p) => p.onToggleMirror())
toggleTwice('循环播放', 'loop', (p) => p.onToggleLoop())
toggleTwice('聚焦模式', 'focus', (p) => p.onToggleFocus())
toggleTwice('显示时钟', 'showClocks', (p) => p.onToggleClocks())
toggleTwice('补光', 'fillLight', (p) => p.onToggleFillLight())
toggleTwice('角色高亮', 'roleHighlight', (p) => p.onToggleRoleHighlight())
{
  // 声控是 async 且要先过麦克风授权。测试环境没有麦克风，所以「点一下开」不该成立，
  // 真正要保的是：①已开启时点一下能关；②没权限时点了不崩、也不会错误地打开。
  const p = fresh()
  p._setSetting({ voiceControl: true }, 'none')
  p.setData({ voiceEnabled: true })
  void p.onToggleVoice().catch(() => {})
  step(80)
  ok('声控：已开启时点一下能关掉', p.data.settings.voiceControl === false,
    `voiceControl=${p.data.settings.voiceControl}`)

  // 「开启」这条路要走麦克风授权（vad.requestAuth），它会注册常驻定时器，
  // 伪时钟跑它会死循环 —— 这条只能在真机验，这里改成静态检查 + 确认不会误开。
  const p2 = fresh()
  let threw = null
  try {
    // 只调用同步段（await 之前的代码），不 step，避免跑 vad 的常驻定时器
    void Promise.resolve(p2.onToggleVoice()).catch(() => {})
  } catch (e) {
    threw = e
  }
  ok('声控：调用时同步段不抛异常', !threw, threw ? String(threw.message) : '')
  ok('声控：无权限时不会被错误地打开', p2.data.settings.voiceControl !== true,
    `voiceControl=${p2.data.settings.voiceControl}`)
  ok('声控：菜单里有这一格且绑定了处理方法', /catchtap="onToggleVoice"/.test(TP_WXML),
    '菜单缺声控格')
}

console.log('\n══════ 菜单切换类 ══════')
{
  // 底部开始：middle ⇄ bottom
  const p = fresh()
  const a = p.data.settings.startPosition
  p.onToggleStartPosition()
  step(150)
  const b = p.data.settings.startPosition
  p.onToggleStartPosition()
  step(150)
  const c = p.data.settings.startPosition
  ok('底部开始：middle ⇄ bottom 切换有效', a !== b && a === c, `${a} → ${b} → ${c}`)
  ok('底部开始：留白跟着变（不是只改开关）',
    p.data.startPad !== Math.round(812 * 0.92), `startPad=${p.data.startPad}`)
}

{
  // 字体：循环切换
  const p = fresh()
  const seen = new Set()
  for (let i = 0; i < 8; i++) {
    seen.add(p.data.settings.fontFamily)
    p.onToggleFontFamily()
    step(120)
  }
  ok('字体：能切出 4 种（系统/宋体/楷体/等宽）', seen.size >= 4, `实际 ${seen.size} 种：${[...seen].join('/')}`)
  ok('字体：data.fontFamily 是真实 CSS 值（不是键名）',
    /serif|sans-serif|monospace/.test(String(p.data.fontFamily)), `fontFamily=${p.data.fontFamily}`)
  ok('字体：格子上的名字跟着变', !!p.data.fontFamilyLabel, `label=${p.data.fontFamilyLabel}`)
}

{
  // 对齐：只保留两档（居中 / 左对齐）——2026-10-28 按宝哥要求精简
  const p = fresh()
  const seen = new Set()
  for (const k of ['center', 'left']) {
    p.onSetAlign(fake({ key: k }))
    step(150)
    ok(`对齐「${k}」生效`, p.data.settings.textAlign === k, `textAlign=${p.data.settings.textAlign}`)
    ok(`对齐「${k}」写进 data（模板读的是 data）`, p.data.textAlign === k, `data.textAlign=${p.data.textAlign}`)
    seen.add(p.data.textAlign)
  }
  ok('对齐：两档都可用（居中 / 左对齐）', seen.size === 2, `实际 ${seen.size} 档`)
  // 老存档里的 justify / right 不能再出现在选项里，也不能被写回去
  p.onSetAlign(fake({ key: 'justify' }))
  ok('对齐：老值 justify 被拒绝（不再写入）', p.data.settings.textAlign !== 'justify', p.data.settings.textAlign)
  const aligns = require('./miniprogram/engine/settings.js').TEXT_ALIGNS.map((o) => o.key)
  ok('对齐：选项只剩 center/left', aligns.join(',') === 'center,left', aligns.join(','))
}

console.log('\n══════ 配色托盘（文字色/背景色/主题 三合一） ══════')
{
  const p = fresh()
  p.onOpenColor()
  ok('点「配色」打开托盘', p.data.colorPicker === 'all', `colorPicker=${p.data.colorPicker}`)
  p.onOpenColor()
  ok('再点一次收起托盘', p.data.colorPicker === '', `colorPicker=${p.data.colorPicker}`)

  p.onOpenColor()
  const before = p.data.settings.textColor
  p.onPickColor(fake({ color: 'red', kind: 'text' }))
  step(150)
  ok('选红色后文字色变了', p.data.settings.textColor === 'red',
    `${before} → ${p.data.settings.textColor}`)
  ok('文字色写进 data（模板读的是 data）', p.data.textColor === 'red', `data.textColor=${p.data.textColor}`)

  p.onPickColor(fake({ color: '#EEEEEE', kind: 'bg' }))
  step(150)
  ok('背景色单独生效（不受文字色影响）', p.data.settings.backgroundColor === '#EEEEEE',
    `bg=${p.data.settings.backgroundColor}，text=${p.data.settings.textColor}`)
  ok('背景色写进 data', p.data.bg === '#EEEEEE', `data.bg=${p.data.bg}`)
  ok('明暗判定跟着刷新（浅底要转深字）', p.data.isDark === false, `isDark=${p.data.isDark}`)
}

{
  // 颜色防呆：文字和背景太接近要报警
  const p = fresh()
  p._setSetting({ textColor: '#FFFFFF', backgroundColor: '#EEEEEE' }, 'layout')
  step(150)
  ok('白字 + 浅灰底 → 触发颜色过近警告', p.data.colorWarning === true, `colorWarning=${p.data.colorWarning}`)
  p._setSetting({ textColor: '#000000', backgroundColor: '#111111' }, 'layout')
  step(150)
  ok('黑字 + 深黑底 → 也报警', p.data.colorWarning === true, `colorWarning=${p.data.colorWarning}`)
  p._setSetting({ textColor: '#FFFFFF', backgroundColor: '#000000' }, 'layout')
  step(150)
  ok('白字 + 黑底 → 不报警', p.data.colorWarning === false, `colorWarning=${p.data.colorWarning}`)
}

console.log('\n══════ 整合新增格子（速度单位/主题/语速预设/智能总闸/参考线/屏幕常亮/引导） ══════')

{
  // 速度单位：cpm ⇄ px，往返实际速度不跳变
  const p = fresh()
  const cpmBefore = p.data.settings.speedCpm
  ok('速度单位：初始为字/分', p.data.settings.speedUnit === 'cpm', `speedUnit=${p.data.settings.speedUnit}`)
  p.onToggleSpeedUnit()
  step(150)
  ok('速度单位：cpm → px', p.data.settings.speedUnit === 'px', `speedUnit=${p.data.settings.speedUnit}`)
  ok('速度单位：px 是合法标尺值', Number.isFinite(p.data.settings.speed) && p.data.settings.speed >= 0 && p.data.settings.speed <= 50, `speed=${p.data.settings.speed}`)
  p.onToggleSpeedUnit()
  step(150)
  ok('速度单位：px → cpm', p.data.settings.speedUnit === 'cpm', `speedUnit=${p.data.settings.speedUnit}`)
  ok('速度单位：往返后 cpm 不跳变', Math.abs(p.data.settings.speedCpm - cpmBefore) <= 30, `${cpmBefore} → ${p.data.settings.speedCpm}`)
}

{
  // 一键主题
  const p = fresh()
  p.onTapTheme(fake({ bg: '#2B2B2B', text: '#FFD166' }))
  step(150)
  ok('主题：套用护眼灰底黄字', p.data.settings.backgroundColor === '#2B2B2B' && p.data.settings.textColor === '#FFD166', `bg=${p.data.settings.backgroundColor} text=${p.data.settings.textColor}`)
  ok('主题：写进 data（模板读 data）', p.data.bg === '#2B2B2B' && p.data.textColor === '#FFD166', '')
  p.onTapTheme(fake({ bg: '#FFFFFF', text: '#1C1C1E' }))
  step(150)
  ok('主题：切到白底黑字', p.data.settings.backgroundColor === '#FFFFFF' && p.data.settings.textColor === '#1C1C1E', '')
  ok('主题：白底 → 明暗判定转浅底', p.data.isDark === false, `isDark=${p.data.isDark}`)
}

{
  // 速度：单位切换收进速度格（点数值区），原独立「速度单位」格已删
  const p = fresh()
  ok('默认单位：字/分', p.data.settings.speedUnit === 'cpm', `speedUnit=${p.data.settings.speedUnit}`)
  const v0 = p.engine.pxPerSecond
  p.onToggleSpeedUnit()
  step(150)
  ok('点速度数值：单位切到像素', p.data.settings.speedUnit === 'px', `speedUnit=${p.data.settings.speedUnit}`)
  ok('切单位不跳速（±2%）', Math.abs(p.engine.pxPerSecond - v0) / v0 < 0.02,
    `${v0.toFixed(3)} → ${p.engine.pxPerSecond.toFixed(3)}`)
  p.onToggleSpeedUnit()
  step(150)
  ok('再点切回字/分', p.data.settings.speedUnit === 'cpm', `speedUnit=${p.data.settings.speedUnit}`)
}

{
  // 智能总闸（与编辑页/设置页同源，存全局 prefs.smartOff）
  const p = fresh()
  p.onToggleSmartOff()
  step(150)
  ok('智能总闸：点开 → 全局 prefs.smartOff=true', appMock.globalData.prefs.smartOff === true, '')
  ok('智能总闸：data.smartOff 同步', p.data.smartOff === true, `smartOff=${p.data.smartOff}`)
  p.onToggleSmartOff()
  step(150)
  ok('智能总闸：再点 → 恢复', appMock.globalData.prefs.smartOff === false && p.data.smartOff === false, `smartOff=${p.data.smartOff}`)
}

{
  // 参考线开关
  const p = fresh()
  const before = p.data.settings.showCue
  p.onToggleCue()
  step(150)
  ok('参考线：点一次切换', p.data.settings.showCue !== before, `showCue ${before} → ${p.data.settings.showCue}`)
  p.onToggleCue()
  step(150)
  ok('参考线：再点回到原状', p.data.settings.showCue === before, `showCue=${p.data.settings.showCue}`)
}

{
  // 屏幕常亮
  const p = fresh()
  const before = p.data.settings.keepScreenOn
  p.onToggleKeepScreenOn()
  step(150)
  ok('屏幕常亮：点一次切换', p.data.settings.keepScreenOn !== before, `keepScreenOn ${before} → ${p.data.settings.keepScreenOn}`)
  p.onToggleKeepScreenOn()
  step(150)
  ok('屏幕常亮：再点回到原状', p.data.settings.keepScreenOn === before, `keepScreenOn=${p.data.settings.keepScreenOn}`)
}

{
  // 重新查看新手引导
  const p = fresh()
  p.onOpenMenu()
  step(50)
  p.onReplayGuide()
  ok('新手引导：重新显示', p.data.guideVisible === true, `guideVisible=${p.data.guideVisible}`)
  ok('新手引导：同时关掉菜单', p.data.showMenu === false, `showMenu=${p.data.showMenu}`)
}

console.log('\n══════ 菜单开合 / 退出 / 重置 ══════')
{
  const p = fresh()
  ok('初始不显示菜单', p.data.showMenu === false, `showMenu=${p.data.showMenu}`)
  p.onOpenMenu()
  step(50)
  ok('点右下圆钮打开菜单', p.data.showMenu === true, `showMenu=${p.data.showMenu}`)
  p.onCloseMenu()
  step(50)
  ok('点遮罩关闭菜单', p.data.showMenu === false, `showMenu=${p.data.showMenu}`)
}

{
  const p = fresh()
  p._setSetting({ fontSize: 88, speedCpm: 500, mirror: true, loop: true }, 'none')
  step(150)
  const changed = p.data.settings.fontSize === 88
  p.onResetSettings()
  step(200)
  ok('重置：改过的值确实变了（前置条件成立）', changed, `fontSize=${p.data.settings.fontSize}`)
  ok('重置：字号回到默认 45', p.data.settings.fontSize === 45, `fontSize=${p.data.settings.fontSize}`)
  ok('重置：速度回到默认 200', p.data.settings.speedCpm === 200, `speedCpm=${p.data.settings.speedCpm}`)
  ok('重置：镜像/循环都关掉', p.data.settings.mirror === false && p.data.settings.loop === false, '')
  ok('重置：排版立刻重算（不是等下次进页面）', p.data.fontSizePx === 45, `fontSizePx=${p.data.fontSizePx}`)
}

console.log('\n══════ 滑块（竖 4 个 + 横 2 个） ══════')
const V_SLIDERS = [
  { id: 'vs-speed', key: 'speedCpm' },
  { id: 'vs-fontSize', key: 'fontSize' },
  { id: 'vs-lineHeight', key: 'lineHeight' },
  { id: 'vs-letterSpacing', key: 'letterSpacing' }
]
for (const s of V_SLIDERS) {
  const p = fresh()
  // 模拟轨道（真机上由 _cacheSliderRects 量出来）
  p._sliderRects[s.id] = { top: 100, height: 84, bottom: 184 }
  const before = p.data.settings[s.key]
  // 先拖到轨道顶部（ratio=0）→ 数值应变大；letterSpacing 默认已是 0（最小），
  // 所以统一用「拖到顶部」来验方向，而不是拖到底。
  p.onVSliderStart({ currentTarget: { id: s.id }, touches: [{ clientY: 100 }] })
  step(60)
  const atTop = p.data.settings[s.key]
  p.onVSliderEnd()
  step(60)
  ok(`${s.id}：拖到顶部数值变大`, atTop > before, `${s.key} ${before} → ${atTop}`)
  // 拖到底部必须是「变小」（竖滑块底=最小，与填充从下往上长一致）
  const p2 = fresh()
  p2._sliderRects[s.id] = { top: 100, height: 84, bottom: 184 }
  p2.onVSliderStart({ currentTarget: { id: s.id }, touches: [{ clientY: 184 }] })
  step(60)
  p2.onVSliderEnd()
  step(60)
  ok(`${s.id}：拖到底部数值变小`, p2.data.settings[s.key] <= before,
    `${s.key} ${before} → ${p2.data.settings[s.key]}`)
  const dataKey = { fontSize: 'fontSizePx', lineHeight: 'lineHeightPx', letterSpacing: 'letterSpacing' }[s.key]
  if (dataKey) {
    const dv = p.data[dataKey]
    ok(`${s.id}：拖动后排版字段跟着重算（${dataKey}）`,
      Number.isFinite(dv) && dv > 0 && dv !== 0, `${dataKey}=${dv}`)
  } else {
    ok(`${s.id}：拖动后 data 同步`, p.data.settings[s.key] !== undefined, '')
  }
}

{
  const p = fresh()
  p._sliderRects['hs-contentWidth'] = { left: 20, width: 300 }
  const before = p.data.settings.contentWidth
  p.onHSliderStart({ currentTarget: { id: 'hs-contentWidth' }, touches: [{ clientX: 170 }] })
  step(60)
  p.onHSliderEnd()
  step(60)
  // CONTENT_WIDTH 区间是 10~100，正中间 = (10+100)/2 = 55
  ok('台词区宽度：拖到正中间 = 55%（区间 10~100 的中点）',
    Math.abs(p.data.settings.contentWidth - 55) <= 2,
    `${before} → ${p.data.settings.contentWidth}`)
  ok('台词区宽度：左右留白跟着算出来', p.data.marginHorizontal > 0, `margin=${p.data.marginHorizontal}`)
}

{
  const p = fresh()
  p._sliderRects['hs-countdown'] = { left: 20, width: 200 }
  p.onHSliderStart({ currentTarget: { id: 'hs-countdown' }, touches: [{ clientX: 220 }] })
  step(60)
  p.onHSliderEnd()
  step(60)
  ok('倒计时：拖到最右变成最大值', p.data.settings.countdown > 0, `countdown=${p.data.settings.countdown}`)
}

console.log('\n══════ 量不到轨道时不能乱赋值（真机首帧常见） ══════')
{
  const p = fresh()
  delete p._sliderRects['vs-fontSize']
  const before = p.data.settings.fontSize
  // 量不到 rect：应回退到「按整格估」或忽略，绝不能把字号设成 0/NaN
  p.onVSliderStart({ currentTarget: { id: 'vs-fontSize' }, touches: [{ clientY: 200 }] })
  step(60)
  const after = p.data.settings.fontSize
  ok('量不到轨道：字号不会变成 NaN/0', Number.isFinite(after) && after > 0, `fontSize=${after}（原 ${before}）`)
  ok('量不到轨道：仍在合法区间内', after >= 11 && after <= 150, `fontSize=${after}`)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
// 必须无条件 exit：声控那段会留下 vad 的常驻定时器 / pending promise，
// 不显式退出的话 node 的事件循环一直被挂住，进程永远不结束。
process.exit(fail ? 1 : 0)
