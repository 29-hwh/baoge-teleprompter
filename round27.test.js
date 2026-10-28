/**
 * 第 27 轮回归测试：台词展示功能 5 项调整的行为锁定。
 *
 *   1) 纯净显示模式（横竖屏一致）：屏幕上只留台词 + 底部进度条；
 *      顶栏/声控条跟随 showControls 显隐；常驻设置浮钮已移除；
 *      进度条不再有「横屏隐藏」条件（横竖都被一个 wx:if 覆盖）
 *   2) 角色显示选择弱化为次级入口：默认折叠
 *   3/4) 折叠面板内含精简操作区与漏词风险说明
 *   5) 一键关闭智能功能：开启后提词页停用角色过滤与高亮 → displayLines 恒等于 allLines
 *
 * 隐藏风险的中间层（_applyRoleFilter）也被显式覆盖：它是另一条会改 roleFilter 的入口，
 * 漏了兜底就会绕过开关把台词又滤掉。
 */
'use strict'

const fs = require('fs')
const path = require('path')

// ---------- 伪时钟（与 round23 同款） ----------
let T = 1780000000000
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

const wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
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
  navigateTo: () => {},
  navigateBack: () => {},
  showModal: (opts) => { if (opts && typeof opts.success === 'function') opts.success({ confirm: true }) },
  showToast: () => {},
  showActionSheet: (opts) => { if (opts && typeof opts.success === 'function') opts.success({ tapIndex: 0 }) },
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
const tpDef = pageDef
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef

function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  return inst
}

// ---------- 数据 ----------
const SCRIPT = [
  '林晚： 你真的要走了吗',
  '顾辞： 公司调我去深圳',
  '林晚： 那我呢',
  '顾辞： 等我回来'
].join('\n')

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// ================= 静态断言：纯净显示模式的 DOM/样式面 =================
const TP_WXML = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/teleprompter/teleprompter.wxml'), 'utf-8')
const TP_WXSS = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/teleprompter/teleprompter.wxss'), 'utf-8')
const ED_WXML = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/edit/edit.wxml'), 'utf-8')
const SET_WXML = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/settings/settings.wxml'), 'utf-8')

console.log('=== 27-1. 纯净显示模式：只留台词 + 进度条 ===')
// 2026-10-27 改造：提词页对齐浅纸「全屏纯净」——顶栏整块删除，
// 屏幕上只剩台词、右侧进度条、右下角菜单钮、视线指示线。
// 旧断言要求的「顶栏跟随 showControls 显隐」已不适用，改为锁定「顶栏确实不存在」。
ok('顶栏已整块移除（纯净模式不再有顶部状态条）',
  TP_WXML.indexOf('class="tp-topbar') < 0 && TP_WXML.indexOf('tp-topbar') < 0)
ok('常驻设置浮钮已从 WXML 移除', TP_WXML.indexOf('tp-float-settings') < 0)
ok('常驻设置浮钮样式已从 WXSS 移除', TP_WXSS.indexOf('tp-float-settings') < 0)
// 声控在 v1 由菜单开关驱动（vad.js 检测到人声才滚动），不再有独立的声控状态条
ok('提词页无独立声控条（声控走菜单开关，不占屏幕）',
  TP_WXML.indexOf('class="tp-voice') < 0 && TP_WXSS.indexOf('.tp-voice {') < 0)

// 进度条：横竖屏都常驻 —— 该 view 上不得再出现任何 wx:if
const progressLineIdx = TP_WXML.indexOf('class="tp-progress-wrap')
const progressLineStart = TP_WXML.lastIndexOf('<view', progressLineIdx)
const progressTag = TP_WXML.slice(progressLineStart, TP_WXML.indexOf('>', progressLineIdx) + 1)
ok('进度条横竖屏都常驻（无 wx:if 隐藏条件）', progressTag.indexOf('wx:if') < 0,
  progressTag.replace(/\s+/g, ' ').slice(0, 90))
// 出口收敛：设置全部收进菜单，唯二出口是「退出提词页」与关闭菜单
ok('菜单头部提供唯一退出出口（点它回首页）',
  /catchtap="onTapBack">退出</.test(TP_WXML) && /onTapBack\s*\(\s*\)\s*\{[\s\S]{0,80}navigateBack/.test(
    fs.readFileSync(path.join(__dirname, 'miniprogram/pages/teleprompter/teleprompter.js'), 'utf-8')))
ok('不再有指向独立设置页的入口（设置已内嵌菜单）',
  TP_WXML.indexOf('onTapSettings') < 0)
ok('横屏专属「设置/退出」重复入口已移除（不再按 orientation 分支）',
  TP_WXML.indexOf("wx:if=\"{{orientation === 'landscape'}}\" class=\"tp-row\"") < 0)
ok('引导文案不再指向已删除的「右上浮钮」', TP_WXML.indexOf('右上浮钮') < 0)
// 用带 { 的选择器判定，避免命中 WXSS 里说明「已删除」的注释文字
ok('旧的角色筛选菜单样式已清理（无死代码）',
  TP_WXSS.indexOf('.tp-role-chip {') < 0 && TP_WXSS.indexOf('.tp-role-chip.on') < 0 &&
  TP_WXSS.indexOf('.tp-role-filter-row {') < 0 && TP_WXSS.indexOf('.tp-role-chips {') < 0)

// ================= 行为断言 =================
console.log('\n=== 27-5. 一键关闭智能功能（漏词兜底） ===')
const script = store.create('第27轮测试台本', SCRIPT)
script.roleDisplay = ['林晚'] // 只显示林晚 → 提词页应过滤掉顾辞
store.save(script)
const SID = script.id

const tp = makePage(tpDef)
pageInstanceRef = tp
tp.onLoad({ id: SID })
stepFrames(60)

const allCount = tp.allLines.length
const filteredCount = tp.displayLines.length
ok('角色过滤生效：仅显示勾选角色时台词变少',
  filteredCount > 0 && filteredCount < allCount, `all=${allCount} filtered=${filteredCount}`)

// 开「一键关闭智能功能」
appMock.updatePrefs({ smartOff: true })
tp._parseAndLayout()
ok('smartOff 开：displayLines 恒等于 allLines（台词 100% 完整）',
  tp.displayLines.length === allCount && tp.displayLines === tp.allLines,
  `display=${tp.displayLines.length} all=${allCount}`)
ok('smartOff 开：roleFilter 被清空（不过滤）', tp.roleFilter === null)

// 角色高亮一并停用：不应再有行使用角色色
const roleColors = (tp.allRoles || []).map((r) => r.color).filter(Boolean)
const stained = tp.allLines.filter((l) => roleColors.indexOf(l.prefixColor) >= 0 || roleColors.indexOf(l.bodyColor) >= 0)
ok('smartOff 开：角色高亮停用（无行使用角色色）', stained.length === 0, `染色行=${stained.length}`)

// 另一条改 roleFilter 的入口也必须被兜底
tp.onSetRoleFilter(['顾辞'])
ok('smartOff 开：程序化 onSetRoleFilter 也被兜底（仍不过滤）',
  tp.roleFilter === null && tp.displayLines.length === allCount,
  `roleFilter=${tp.roleFilter === null ? 'null' : tp.roleFilter.size} display=${tp.displayLines.length}`)

// 关掉开关 → 恢复原有过滤行为（不改动已有逻辑）
appMock.updatePrefs({ smartOff: false })
tp._parseAndLayout()
ok('smartOff 关：恢复角色过滤（回到变少的状态）',
  tp.displayLines.length === filteredCount, `display=${tp.displayLines.length} expect=${filteredCount}`)

// ================= 编辑页：折叠次级入口 + 风险说明 + 开关 =================
console.log('\n=== 27-2/3/4. 角色显示选择：次级入口 + 精简面板 ===')
ok('入口默认折叠（rolePanelOpen 初值 false）', editDef.data.rolePanelOpen === false)
ok('WXML 面板内容由 rolePanelOpen 控制显隐',
  /wx:if="\{\{rolePanelOpen\}\}"\s+class="role-display-panel"/.test(ED_WXML))
ok('折叠行常显当前状态（roleDisplaySummary）', ED_WXML.indexOf('roleDisplaySummary') >= 0)
ok('风险说明存在（漏词警示）',
  ED_WXML.indexOf('role-risk') >= 0 && ED_WXML.indexOf('可能漏词') >= 0)
ok('面板内提供「一键关闭智能功能」开关', ED_WXML.indexOf('onToggleSmartOff') >= 0)
// 2026-10-28 口径变更：设置页去重后不再重复摆一份智能总闸（唯一真源＝提词页菜单，
// 编辑页角色面板里的同名开关是"就地兜底"，与菜单读写同一份 prefs.smartOff）。
ok('设置页不再重复提供智能总闸（消除双入口）', SET_WXML.indexOf('data-key="smartOff"') < 0)
ok('旧的冗余长说明已移除（信息密度下降）', ED_WXML.indexOf('role-display-hint') < 0)
ok('旧的一级标题样式已移除（不再与主操作同级）',
  fs.readFileSync(path.join(__dirname, 'miniprogram/pages/edit/edit.wxss'), 'utf-8').indexOf('.role-display-title') < 0)

const ed = makePage(editDef)
ed.onLoad({})
ok('编辑页 onLoad：面板保持折叠', ed.data.rolePanelOpen === false)
ok('编辑页 onLoad：smartOff 与全局 prefs 同源', ed.data.smartOff === false, `smartOff=${ed.data.smartOff}`)
ed.onToggleRoleDisplayPanel()
ok('点击入口可展开面板', ed.data.rolePanelOpen === true)

ed.onToggleSmartOff()
ok('一键关闭智能功能：写入全局 prefs', appMock.globalData.prefs.smartOff === true)
ok('一键关闭智能功能：本地 data 同步', ed.data.smartOff === true)
ed.onToggleSmartOff()
ok('再点一次可恢复', appMock.globalData.prefs.smartOff === false && ed.data.smartOff === false)

// 折叠态摘要在配置过滤后应能反映出来
ed.setData({ roleDisplayNames: ['林晚'] })
ed.setData({ roles: [{ name: '林晚', count: 2, color: '#fff' }, { name: '顾辞', count: 2, color: '#000' }] })
ed._syncRoleDisplayItems()
ok('折叠态摘要反映当前过滤（仅 N 个角色）', ed.data.roleDisplaySummary === '仅 1 个角色', ed.data.roleDisplaySummary)
ed.onShowFullText()
ok('显示全文后摘要回到「全文」', ed.data.roleDisplaySummary === '全文', ed.data.roleDisplaySummary)

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.pass)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('失败项：')
  failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? '  -> ' + f.extra : '')))
  process.exit(1)
}
