/**
 * 第 28 轮回归测试
 *
 *   A. 台词粘连的真正根因：extractWtText 必须把 <w:br/>（段落内软换行）
 *      与单元格内的段落边界还原成 \n。老实现只拼 <w:t>，会把同一个格子里
 *      两个人的台词粘成一行 —— 脚本文档里看起来「粘连」就是这么来的。
 *   B. 「名字高亮 / 名字+台词高亮」从显示设置页移到编辑页「角色显示选择」面板，
 *      并在该面板新增「角色高亮」一键关闭开关。
 *      ⚠️ 2026-10-27 变更：“名字+台词”整行高亮已**整个下线**，两个选项的选择器在
 *      编辑页与提词台都删掉了，只剩「仅名字高亮」+ 一个开/关。B 段断言随之改为
 *      「入口已全部清除」口径。
 *   C. 智能总闸（一键关闭智能功能）与角色高亮的联动：开总闸一并关高亮并存快照，
 *      关总闸按快照恢复原状态，两边入口（设置页 / 编辑页）状态永远一致。
 */
'use strict'

const fs = require('fs')
const path = require('path')

// ---------- 伪时钟（与 round27 同款） ----------
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
  setPageOrientation: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  showModal: (o) => { if (o && o.success) o.success({ confirm: true }) },
  showToast: () => {},
  showActionSheet: (o) => { if (o && o.success) o.success({ tapIndex: 0 }) },
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
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

const util = require('./miniprogram/utils/util.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')
const tpDef = pageDef
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef
require('./miniprogram/pages/settings/settings.js')
const settingsDef = pageDef
void tpDef
void pageInstanceRef

function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  return inst
}

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf-8')
const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// ============================================================
console.log('=== 28-A. 解析器：换行必须还原（粘连根因）===')
const XML = [
  '<w:body>',
  '<w:p><w:r><w:t>开头段落</w:t></w:r></w:p>',
  '<w:tbl>',
  '<w:tblPr><w:t>不该被当文本</w:t></w:tblPr>',
  '<w:tr><w:tc><w:p><w:r><w:t>镜头</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>台词</w:t></w:r></w:p></w:tc></w:tr>',
  // ① 自闭合软换行
  '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>杨凤： 你吃几串了？</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>王建华： 才 3 串。</w:t></w:r></w:p></w:tc></w:tr>',
  // ② 成对写法的软换行
  '<w:tr><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>婆婆： 快吃。</w:t></w:r><w:br></w:br><w:r><w:t>杨凤： 谢谢妈。</w:t></w:r></w:p></w:tc></w:tr>',
  // ③ 一个单元格里两个 <w:p>
  '<w:tr><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>爸爸： 吃了吗？</w:t></w:r></w:p><w:p><w:r><w:t>王建华： 还没。</w:t></w:r></w:p></w:tc></w:tr>',
  // ④ 普通单行单元格
  '<w:tr><w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>杨凤： 没事。</w:t></w:r></w:p></w:tc></w:tr>',
  '</w:tbl>',
  '</w:body>'
].join('')

const blocks = util.extractDocxBlocks(XML)
const tbl = blocks.filter((b) => b.type === 'table')[0]
const cell = (r, c) => tbl.rows[r][c]

ok('A1 <w:br/> 还原成换行（两人台词不再粘成一行）',
  cell(1, 1) === '杨凤： 你吃几串了？\n王建华： 才 3 串。', JSON.stringify(cell(1, 1)))
ok('A2 成对写法 <w:br></w:br> 同样还原',
  cell(2, 1) === '婆婆： 快吃。\n杨凤： 谢谢妈。', JSON.stringify(cell(2, 1)))
ok('A3 单元格内多个 <w:p> 之间补换行',
  cell(3, 1) === '爸爸： 吃了吗？\n王建华： 还没。', JSON.stringify(cell(3, 1)))
ok('A4 单行单元格不受影响（不凭空多出换行）',
  cell(4, 1) === '杨凤： 没事。', JSON.stringify(cell(4, 1)))
ok('A5 零丢字：压平后与原字面完全一致',
  cell(1, 1).replace(/\n/g, '') === '杨凤： 你吃几串了？王建华： 才 3 串。')
ok('A6 排版 XML（<w:tblPr>）不被当文本吞入',
  tbl.rows.every((r) => r.every((c) => String(c).indexOf('不该被当文本') < 0)))
ok('A7 表格外的段落块不受影响',
  blocks[0].type === 'paragraph' && blocks[0].text === '开头段落',
  JSON.stringify(blocks[0]))

const joined = util.blocksToText(blocks)
ok('A8 拼接后「一格两人」已分属两行',
  joined.indexOf('杨凤： 你吃几串了？\n王建华： 才 3 串。') >= 0)

// ============================================================
console.log('\n=== 28-B. 高亮方式从显示设置移到台词选择面板 ===')
const SET_WXML = read('miniprogram/pages/settings/settings.wxml')
const SET_JS = read('miniprogram/pages/settings/settings.js')
const ED_WXML = read('miniprogram/pages/edit/edit.wxml')
const ED_JS = read('miniprogram/pages/edit/edit.js')
const TP_WXML = read('miniprogram/pages/teleprompter/teleprompter.wxml')

// 剥离 // 行注释与 /* */ 块注释后再做「悬空引用」判定，避免注释里的说明文字被误判
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const SET_JS_CODE = stripComments(SET_JS)

ok('B1 显示设置页已无「高亮方式」入口',
  SET_WXML.indexOf('onTapRoleMode') < 0 && SET_WXML.indexOf('roleModeOptions') < 0)
ok('B2 设置页逻辑里也清掉了选项与 handler（无悬空引用）',
  SET_JS_CODE.indexOf('roleModeOptions') < 0 && SET_JS_CODE.indexOf('onTapRoleMode') < 0)
ok('B3 编辑页已无「高亮方式」二选一入口（full 下线后没有可选项）',
  ED_WXML.indexOf('onTapRoleMode') < 0 && ED_WXML.indexOf('roleModeOptions') < 0)
// 2026-10-27 口径变更：「名字+台词」整行高亮整个下线，只剩「仅名字高亮」一种方式。
// B3/B4/B6/B7 因此从「入口搬到了哪里」改为「入口已全部清除」——只留一种方式时，
// 再摆一个选择器就是给用户一个永远点不动的假选项。
ok('B4 编辑页逻辑里也删干净了选项与 handler（无悬空引用）',
  stripComments(ED_JS).indexOf("label: '名字+台词高亮'") < 0 &&
  stripComments(ED_JS).indexOf('roleModeOptions') < 0 &&
  stripComments(ED_JS).indexOf('onTapRoleMode') < 0)
ok('B5 面板内保留「角色高亮」一键关闭开关', ED_WXML.indexOf('onToggleRoleHighlight') >= 0)
ok('B6 编辑页 data 只剩高亮开关状态（不再有 highlightMode / roleModeOptions）',
  editDef.data.roleHighlight === true &&
  editDef.data.highlightMode === undefined &&
  editDef.data.roleModeOptions === undefined,
  JSON.stringify({ roleHighlight: editDef.data.roleHighlight, highlightMode: editDef.data.highlightMode }))
ok('B7 提词台菜单把两个模式按钮合并成「高亮 开/关」开关',
  TP_WXML.indexOf('onSetRoleMode') < 0 && TP_WXML.indexOf('onToggleRoleHighlight') >= 0)

// ============================================================
console.log('\n=== 28-C. 智能总闸 ⇄ 角色高亮 联动 ===')
const P = prefsEngine

const pt = P.smartPatch({ smartOff: false, roleHighlight: true, roleHighlightMode: 'name' }, 'smartOff', true)
ok('C1 开总闸：一并把角色高亮关掉', pt.smartOff === true && pt.roleHighlight === false)
ok('C2 开总闸：把开闸前的高亮配置存进快照',
  !!pt.smartOffSaved && pt.smartOffSaved.roleHighlight === true && pt.smartOffSaved.roleHighlightMode === 'name')

const back = P.smartPatch({ smartOff: true, roleHighlight: false, roleHighlightMode: 'name', smartOffSaved: pt.smartOffSaved }, 'smartOff', false)
ok('C3 关总闸：按快照恢复原状态',
  back.smartOff === false && back.roleHighlight === true &&
  back.roleHighlightMode === 'name' && back.smartOffSaved === null)

const pt2 = P.smartPatch({ smartOff: false, roleHighlight: false, roleHighlightMode: 'full' }, 'smartOff', true)
const back2 = P.smartPatch({ smartOff: true, roleHighlight: false, roleHighlightMode: 'full', smartOffSaved: pt2.smartOffSaved }, 'smartOff', false)
ok('C4 原本高亮就是关的：关总闸后仍保持关（恢复原状，不乱打开）', back2.roleHighlight === false)

const on3 = P.smartPatch({ smartOff: true, roleHighlight: false, roleHighlightMode: 'full', smartOffSaved: { roleHighlight: true, roleHighlightMode: 'full' } }, 'roleHighlight', true)
ok('C5 总闸开着时手动开高亮：自动解除总闸（不出现矛盾组合）',
  on3.smartOff === false && on3.roleHighlight === true)

// 写入 / 读取两侧的不变量（含绕过 smartPatch 的直接写）
memStorage.prefs_v1 = { smartOff: true, roleHighlight: true, roleHighlightMode: 'name' }
const p1 = P.load()
ok('C6 读取归一化：总闸开 ⇒ 高亮必为关', p1.smartOff === true && p1.roleHighlight === false)
ok('C7 读取归一化：顺手补快照，用户设置不丢',
  !!p1.smartOffSaved && p1.smartOffSaved.roleHighlightMode === 'name')

memStorage.prefs_v1 = { smartOff: false, roleHighlight: false, smartOffSaved: { roleHighlight: true, roleHighlightMode: 'name' } }
const p2 = P.load()
ok('C8 总闸已关但没走联动：按快照自动恢复高亮',
  p2.roleHighlight === true && p2.roleHighlightMode === 'name' && p2.smartOffSaved === null)

// 页面级联动
appMock.globalData.prefs = P.reset()
const ed = makePage(editDef)
ed.onLoad({})
ok('C9 编辑页初始：总闸关、高亮开', ed.data.smartOff === false && ed.data.roleHighlight === true,
  `smartOff=${ed.data.smartOff} hl=${ed.data.roleHighlight}`)
ed.onToggleSmartOff()
ok('C10 编辑页开总闸：高亮开关自动变关', ed.data.smartOff === true && ed.data.roleHighlight === false)
ok('C11 编辑页开总闸：prefs 里的高亮也同步关掉', appMock.globalData.prefs.roleHighlight === false)
ed.onToggleRoleHighlight()
ok('C12 编辑页在总闸开着时开高亮：总闸被自动解除',
  ed.data.roleHighlight === true && ed.data.smartOff === false)

appMock.globalData.prefs = P.reset()
const ed2 = makePage(editDef)
ed2.onLoad({})
ed2.onToggleRoleHighlight()
ok('C13 编辑页可一键关闭角色高亮', ed2.data.roleHighlight === false)
ed2.onToggleSmartOff()
ok('C14 开总闸后高亮保持关闭（原本就是关的）', ed2.data.roleHighlight === false)
ed2.onToggleSmartOff()
ok('C15 关总闸后高亮恢复为「开闸前的状态」= 关', ed2.data.roleHighlight === false)

// 设置页：同一份 prefs，状态必须一致
appMock.globalData.prefs = P.reset()
const st = makePage(settingsDef)
st.setData({ prefs: appMock.globalData.prefs })
st.onToggle({ currentTarget: { dataset: { key: 'smartOff' } } })
ok('C16 设置页开总闸：同样把高亮一并关掉',
  st.data.prefs.smartOff === true && st.data.prefs.roleHighlight === false)
st.onToggle({ currentTarget: { dataset: { key: 'roleHighlight' } } })
ok('C17 设置页再点高亮：自动解除总闸（两处入口不会互相矛盾）',
  st.data.prefs.roleHighlight === true && st.data.prefs.smartOff === false)

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.pass)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length) {
  console.log('失败项：')
  failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? '  -> ' + f.extra : '')))
  process.exit(1)
}
