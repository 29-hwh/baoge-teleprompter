/**
 * 「角色显示选择」页面层集成测试（复用 script_switch 的 mock 范式）。
 * 新语义：角色显示配置来自【编辑页】保存的台本字段 script.roleDisplay（角色标准名数组，
 * 空/缺省 = 显示全部）；台词滚动页在 _parseAndLayout 时经 _roleDisplayFilter() 读该配置
 * 构建显示过滤，驱动 displayLines。滚动页菜单不再有角色选择 UI。
 * 验证点：
 *  - 缺省/空配置 → displayLines === allLines（显示全部，无回归）
 *  - roleDisplay=['林晚'] → 只显示林晚；allLines（原始台词存储结构）不变
 *  - roleDisplay=['林晚','建华'] → 两角色并集；无角色旁白行（标题/说明）在筛选时保留
 *  - roleDisplay 含无效名 → 回退显示全部（不误清空）
 *  - 重新进入（重读配置）仍按 roleDisplay 过滤 → 编辑页与滚动页两侧行为一致
 *  - 与角色高亮协同：显示出的行仍按角色色高亮（mode 不变）
 *  - 保留的程序化入口 onSetRoleFilter 仍可用（页内临时覆盖）
 */
'use strict'

let T = 1780000000000
const rafCbs = []
const timers = []
let timerSeq = 1

global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length }
global.cancelAnimationFrame = () => {}
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T

const memStorage = {}
const wx = {
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {}, setScreenBrightness: () => {}, setPageOrientation: () => {},
  navigateTo: () => {}, navigateBack: () => {},
  showModal: () => {}, showToast: () => {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}
global.wx = wx

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

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + '\n      ' + (detail || '')) }
}

function resetStore() { for (const k of Object.keys(memStorage)) delete memStorage[k] }
function mkScript(title, body) { T += 1000; const s = store.create(title, body); store.save(s); return s }
function setRoleDisplay(id, names) { const s = store.get(id); s.roleDisplay = names; store.save(s) }

// 多角色台本：林晚 / 建华 / 王二 各一句，加一条无角色旁白叙述（role=null）
const MULTI = '林晚：你终于来了。\n建华：我等你很久了。\n王二：那我们走吧。\n夜色渐浓，两人沉默地望着窗外。'

console.log('\n══════ 1. 默认（无 roleDisplay 配置）：显示全部 ══════')
{
  resetStore()
  const s = mkScript('多角色稿', MULTI)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  check('默认 roleFilter 为 null（显示全部）', page.roleFilter === null)
  check('displayLines 与 allLines 行数一致', page.displayLines.length === page.allLines.length)
  check('无角色旁白行在不过滤时保留', page.allLines.some((l) => l.role === null))
  check('页面 data 已无菜单筛选 UI 字段', !('roleFilterOptions' in page.data) && !('roleFilterNames' in page.data))
}

console.log('\n══════ 2. 编辑页配置 roleDisplay=[林晚] → 滚动页只显示林晚 ══════')
{
  const s = mkScript('多角色稿2', MULTI)
  setRoleDisplay(s.id, ['林晚'])
  const page = makePage()
  const allRef = page.allLines
  page.onLoad({ id: s.id })
  page.onReady()
  check('allLines 行数不变（原始台词存储/结构未动）', page.allLines.length === 4)
  check('displayLines 含林晚台词 + 无角色旁白行（不含其它角色）', page.displayLines.length === 2 && page.displayLines.every((l) => l.role === '林晚' || l.role === null), page.displayLines.map((l) => l.role).join(','))
  check('displayLines 行数 < allLines（其余角色被隐藏）', page.displayLines.length < page.allLines.length)
  check('contentHeight 随 displayLines 缩小', page.contentHeight === page.displayLines.length * page.data.lineHeightPx)
  check('筛选时保留无角色旁白行（标题/说明不再丢失）', page.displayLines.some((l) => l.role === null))
}

console.log('\n══════ 3. 同时显示角色A+角色B：roleDisplay=[林晚,建华] ══════')
{
  const s = mkScript('多角色稿3', MULTI)
  setRoleDisplay(s.id, ['林晚', '建华'])
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  const shown = page.displayLines.map((l) => l.role)
  check('显示林晚与建华 + 无角色旁白行（不含王二）', shown.length > 0 && shown.every((r) => r === '林晚' || r === '建华' || r === null), shown.join(','))
  check('王二被隐藏', shown.indexOf('王二') < 0)
}

console.log('\n══════ 4. roleDisplay 含无效名 → 回退显示全部（不误清空） ══════')
{
  const s = mkScript('多角色稿4', MULTI)
  setRoleDisplay(s.id, ['根本不存在的角色'])
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  check('roleFilter 为 null（resolveRoleFilter 无命中）', page.roleFilter === null)
  check('displayLines 恢复全部', page.displayLines.length === page.allLines.length)
}

console.log('\n══════ 5. 重新进入/重读配置仍按 roleDisplay（两侧一致） ══════')
{
  const s = mkScript('多角色稿5', MULTI)
  setRoleDisplay(s.id, ['王二'])
  const p1 = makePage(); p1.onLoad({ id: s.id }); p1.onReady()
  check('第一次进入显示王二 + 无角色旁白行', p1.displayLines.every((l) => l.role === '王二' || l.role === null) && p1.displayLines.length > 0)
  // 模拟退出后再次进入：新开一个页面实例重读同一台本
  const p2 = makePage(); p2.onLoad({ id: s.id }); p2.onReady()
  check('再次进入仍显示王二 + 无角色旁白行（配置持久）', p2.displayLines.every((l) => l.role === '王二' || l.role === null) && p2.displayLines.length > 0)
}

console.log('\n══════ 6. 与角色高亮协同：显示出的行仍按角色色高亮 ══════')
{
  const s = mkScript('多角色稿6', MULTI)
  setRoleDisplay(s.id, ['林晚'])
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  // 2026-09-29：默认高亮方式由 'full' 改为 'name'。
  // 2026-10-27：'full'（名字+台词整行高亮）**整个下线** —— 不是"默认 name"而是"只有 name"，
  // 提词台与编辑页的切换入口都已删除。于是这里验两件事：
  //   ① 默认状态：名字角色色 / 台词正文色；
  //   ② 老存档里残留 'full' 时，重排后台词必须仍是正文色 —— 不能让整行高亮"复活"。
  const ln = page.displayLines.find((l) => l.role === '林晚')
  check('林晚行 prefixColor 为角色色（非正文色）', !!ln && !!ln.prefixColor && ln.prefixColor !== page.data.textColor, ln && ln.prefixColor)
  check('名字高亮：林晚 bodyColor 回落正文色', !!ln && ln.bodyColor === page.data.textColor)
  check('名字高亮：隐藏角色行的 bodyColor 同样回落正文色', page.allLines.find((l) => l.role === '建华').bodyColor === page.data.textColor)

  // 老存档残留 'full'：prefs.normalize 会归一成 'name'，渲染层也不该再有 full 分支
  appMock.updatePrefs({ roleHighlightMode: 'full' })
  page._relayoutKeepProgress()
  const lnOld = page.displayLines.find((l) => l.role === '林晚')
  check('残留 full 存档：台词仍为正文色（整行高亮不会复活）',
    !!lnOld && lnOld.bodyColor === page.data.textColor, lnOld && lnOld.bodyColor)
  check('残留 full 存档：名字仍是角色色（分色本身没被误关）',
    !!lnOld && lnOld.prefixColor !== page.data.textColor)
  check('prefs 里存的 roleHighlightMode 已被归一成 name',
    appMock.globalData.prefs.roleHighlightMode === 'name', appMock.globalData.prefs.roleHighlightMode)
}

console.log('\n══════ 7. 保留的程序化入口 onSetRoleFilter 仍可用 ══════')
{
  const s = mkScript('多角色稿7', MULTI)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  page.onSetRoleFilter(['王二'])
  check('onSetRoleFilter([王二]) 后显示王二 + 无角色旁白行', page.displayLines.every((l) => l.role === '王二' || l.role === null) && page.displayLines.length > 0)
  page.onSetRoleFilter([])
  check('onSetRoleFilter([]) = 显式无显示（空画面）', page.displayLines.length === 0)
  page.onSetRoleFilter(null)
  check('onSetRoleFilter(null) 恢复显示全部', page.displayLines.length === page.allLines.length)
}

console.log('\n──────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────────')
process.exit(fail ? 1 : 0)
