/**
 * 角色显示选择（编辑页 + 台词页）验证：新语义「默认显示全文、可单独勾选某角色」
 * - 默认 = 显示全文（roleDisplayNames===null，showFullText=true，所有角色 chip 不选中）
 * - 显示全文态点某角色 → 仅选中该角色（提词页只显示该角色台词 + 标题/说明）
 * - 再次点已选角色 → 取消；取消后无一选中 → 回到显示全文
 * - 合并切换键 onToggleAllRoleDisplay：未全选→「全选」(选中全部)；已全选→「取消全选」(回到显示全文)
 * - 显示全文键 onShowFullText：恢复显示全部原文
 * - 台词页 _roleDisplayFilter：undefined/null→全显, []→无显示, [names]→仅显示这些
 * 自包含 harness（复用 round23 同款 mock wx + 伪时钟）。
 */
'use strict'

let T = 1780000000000
const timers = []
let timerSeq = 1
global.requestAnimationFrame = () => 0
global.cancelAnimationFrame = () => {}
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T

const memStorage = {}
const wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {}, setScreenBrightness: () => {}, setPageOrientation: () => {},
  navigateTo: () => {}, navigateBack: () => {},
  showModal: (o) => { if (o && o.success) o.success({ confirm: true }) },
  showToast: () => {}, showActionSheet: (o) => { if (o && o.success) o.success({ tapIndex: 0 }) },
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}
global.wx = wx

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = { globalData: { prefs: prefsEngine.load(), currentScript: null }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } }
global.getApp = () => appMock

let pageDef = null
global.Page = (def) => { pageDef = def }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef
// 重新捕获台词页定义
pageDef = null
require('./miniprogram/pages/teleprompter/teleprompter.js')
const teleDef = pageDef

function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) { if (patch && typeof patch === 'object') Object.assign(this.data, patch) }
  return inst
}

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// 多角色台本
const SCRIPT = [
  '林晚：你终于来了。',
  '建华：我等你很久了。',
  '王二：那我们走吧。',
  '林晚（轻声）：外面风大。'
].join('\n')
const script = store.create('角色显示选择测试', SCRIPT)
store.save(script)
const SID = script.id

// 静态护栏：wxml 不得再在 class/文本插值里直接调用 indexOf（部分基础库对属性插值里数组方法调用求值不稳，会导致 .on 类不生效）；
// 且不得再引用已移除的 onSelectAllRoleDisplay / onClearRoleDisplay
const fs = require('fs')
const wxml = fs.readFileSync('./miniprogram/pages/edit/edit.wxml', 'utf8')
ok('wxml 已移除角色显示选择里的 indexOf 插值（改用预计算 item.selected）', !/roleDisplayNames\.indexOf/.test(wxml))
ok('wxml 已改用显示全文/合并切换键（无 onSelectAllRoleDisplay/onClearRoleDisplay）', !/onSelectAllRoleDisplay|onClearRoleDisplay/.test(wxml))

console.log('=== 编辑页：默认显示全文 / 勾选 / 显示全文 / 合并切换 ===')
{
  const ed = makePage(editDef)
  ed.onLoad({ id: SID })
  const names = (ed.data.roles || []).map(r => r.name)
  const A = names[0], B = names[1]
  ok('加载后识别到多角色（roles.length>=3）', names.length >= 3, names.join(','))

  // 1) 默认 = 显示全文：roleDisplayNames 为 null，showFullText=true，所有角色 chip 不选中
  ok('默认 roleDisplayNames === null（显示全文态）', ed.data.roleDisplayNames === null, JSON.stringify(ed.data.roleDisplayNames))
  ok('默认 showFullText === true', ed.data.showFullText === true)
  ok('默认 roleDisplayItems 全部 selected=false（不选中任何角色）', (ed.data.roleDisplayItems || []).length === names.length && ed.data.roleDisplayItems.every(i => i.selected === false))

  // 2) 显示全文态点角色A → 仅选中 A（roleDisplayNames=[A]），showFullText=false
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: A } } })
  ok('显示全文态点 A → roleDisplayNames 仅含 A', ed.data.roleDisplayNames.length === 1 && ed.data.roleDisplayNames[0] === A, JSON.stringify(ed.data.roleDisplayNames))
  ok('显示全文态点 A → showFullText=false', ed.data.showFullText === false)
  ok('显示全文态点 A → 仅 roleDisplayItems[A].selected=true', ed.data.roleDisplayItems.filter(i => i.selected).length === 1 && ed.data.roleDisplayItems.find(i => i.name === A).selected === true)

  // 3) 再点 B → 多选 [A,B]
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: B } } })
  ok('再点 B → roleDisplayNames=[A,B]', ed.data.roleDisplayNames.length === 2 && ed.data.roleDisplayNames.indexOf(A) >= 0 && ed.data.roleDisplayNames.indexOf(B) >= 0, JSON.stringify(ed.data.roleDisplayNames))

  // 4) 再点 A → 取消 A，剩 [B]
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: A } } })
  ok('再点 A → 取消 A，剩 [B]', ed.data.roleDisplayNames.length === 1 && ed.data.roleDisplayNames[0] === B, JSON.stringify(ed.data.roleDisplayNames))

  // 5) 再点 B → 取消后为空 → 回到显示全文（null）
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: B } } })
  ok('取消最后一个角色 → 回到显示全文（roleDisplayNames=null）', ed.data.roleDisplayNames === null, JSON.stringify(ed.data.roleDisplayNames))
  ok('取消最后一个角色 → showFullText=true', ed.data.showFullText === true)

  // 6) 显示全文键：从任意态回到显示全文
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: A } } }) // 先选中 A
  ed.onShowFullText()
  ok('onShowFullText → roleDisplayNames=null、showFullText=true', ed.data.roleDisplayNames === null && ed.data.showFullText === true)

  // 7) 合并切换键：未全选 → 全选（选中全部角色）
  ed.onToggleAllRoleDisplay()
  ok('未全选时 onToggleAllRoleDisplay → 选中全部角色', ed.data.roleDisplayNames.length === names.length && names.every(n => ed.data.roleDisplayNames.indexOf(n) >= 0), JSON.stringify(ed.data.roleDisplayNames))
  ok('未全选时 onToggleAllRoleDisplay → allRoleSelected=true', ed.data.allRoleSelected === true)

  // 8) 已全选 → 取消全选（回到显示全文）
  ed.onToggleAllRoleDisplay()
  ok('已全选时 onToggleAllRoleDisplay → 回到显示全文（null）', ed.data.roleDisplayNames === null, JSON.stringify(ed.data.roleDisplayNames))
  ok('已全选时 onToggleAllRoleDisplay → showFullText=true、allRoleSelected=false', ed.data.showFullText === true && ed.data.allRoleSelected === false)

  // 9) 合并切换键：部分选中 → 全选（选中全部）
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: A } } }) // 仅选 A
  ed.onToggleAllRoleDisplay()
  ok('部分选中时 onToggleAllRoleDisplay → 全选', ed.data.roleDisplayNames.length === names.length, JSON.stringify(ed.data.roleDisplayNames))
}

console.log('=== 编辑页：抗 _recalc / 持久化 ===')
{
  const ed = makePage(editDef)
  ed.onLoad({ id: SID })
  const names = (ed.data.roles || []).map(r => r.name)
  const A = names[0], B = names[1]
  // 仅勾选 A、B
  ed.onShowFullText()
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: A } } })
  ed.onToggleRoleDisplay({ currentTarget: { dataset: { name: B } } })
  ok('准备：仅勾选 A、B', ed.data.roleDisplayNames.length === 2)

  // 改正文触发 _recalc，已勾选保持 + 可视列表同步
  ed.onInputContent({ detail: { value: SCRIPT + '\n林晚：再等等。' } })
  ok('_recalc 后仍只勾选 A、B', ed.data.roleDisplayNames.length === 2 && ed.data.roleDisplayNames.indexOf(A) >= 0 && ed.data.roleDisplayNames.indexOf(B) >= 0, JSON.stringify(ed.data.roleDisplayNames))
  ok('_recalc 后 roleDisplayItems 仅 A、B selected', ed.data.roleDisplayItems.filter(i => i.selected).length === 2)

  // 持久化（角色筛选态）：onUnload 写入 script.roleDisplay（数组落库）
  ed.onUnload && ed.onUnload()
  const saved = store.get(SID)
  ok('onUnload 持久化 roleDisplay=[A,B]', (saved.roleDisplay || []).length === 2 && saved.roleDisplay.indexOf(A) >= 0, JSON.stringify(saved.roleDisplay))
}

console.log('=== 编辑页：显示全文态持久化（不落角色数组） ===')
{
  // 用全新脚本验证：老脚本无 roleDisplay 字段 → 默认显示全文（不选中任何角色）
  const fresh = store.create('显示全文持久化测试', SCRIPT)
  store.save(fresh)
  const ed = makePage(editDef)
  ed.onLoad({ id: fresh.id }) // 全新脚本，无 roleDisplay → 默认显示全文
  ok('全新脚本加载 roleDisplayNames === null（显示全文态）', ed.data.roleDisplayNames === null, JSON.stringify(ed.data.roleDisplayNames))
  // 显式保存（编辑页 _save 入口）验证：显示全文态 roleDisplay 落库为 null（不落角色数组）
  ed._save()
  const saved = store.get(fresh.id)
  ok('默认显示全文 _save 落库 → roleDisplay 为 null（不落角色数组）', saved.roleDisplay === null, JSON.stringify(saved.roleDisplay))
}

console.log('=== 台词页 _roleDisplayFilter 三态 ===')
{
  // 构造一个台词页实例，手动喂入 script / allRoles / allAliases
  const tp = makePage(teleDef)
  const allRoles = [
    { name: '林晚', index: 0, color: '#fff', count: 2 },
    { name: '建华', index: 1, color: '#fff', count: 1 },
    { name: '王二', index: 2, color: '#fff', count: 1 }
  ]
  tp.allRoles = allRoles
  tp.allAliases = {}
  // 全显态：老台本无 roleDisplay 字段
  tp.script = { id: 'x', roleDisplay: undefined }
  ok('undefined roleDisplay → 全显（返回 null）', tp._roleDisplayFilter() === null)
  tp.script = { id: 'x', roleDisplay: null }
  ok('null roleDisplay → 全显（返回 null）', tp._roleDisplayFilter() === null)
  // 无显示态：旧数据里的空数组
  tp.script = { id: 'x', roleDisplay: [] }
  const emptySet = tp._roleDisplayFilter()
  ok('[] roleDisplay → 无显示（空集合）', emptySet instanceof Set && emptySet.size === 0)
  // 仅显示某角色
  tp.script = { id: 'x', roleDisplay: ['建华'] }
  const fset = tp._roleDisplayFilter()
  ok('[建华] → 过滤集合含「建华」', fset instanceof Set && fset.has('建华') && fset.size === 1, fset ? Array.from(fset).join(',') : 'null')
}

const passed = results.filter(r => r.pass).length
console.log(`\n结果：${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)
