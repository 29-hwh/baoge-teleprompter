/**
 * 编辑页「台本标题显示不全」修复验证
 *
 * 背景：标题原用 <input>（单行原生组件），超出框宽即硬裁切 —— 既无省略号也不可换行，
 * 30 字标题在窄屏下尾部直接被切掉。已改为 textarea + auto-height（自动换行完整显示）。
 *
 * 本测试从两层锁死该修复：
 *   A. 静态层：直接读 edit.wxml / edit.wxss，检查组件结构、绑定完整性、
 *      以及「不存在单行裁切 / 存在换行断行 / 有高度上下限」等样式约束；
 *   B. 数据层：用超长标题（30 字中文 / 中英混排 / 无空格长英文）驱动页面，
 *      确认 title 与 navTitle 完整同步、一字不丢，且编辑逻辑入口未变。
 */
'use strict'

const fs = require('fs')
const path = require('path')

// ---------- 伪时钟 + mock wx（与 round23 同款，够 edit 页跑起来即可） ----------
let T = 1780000000000
const timers = []
let timerSeq = 1
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
  navigateTo: () => {},
  navigateBack: () => {},
  pageScrollTo: () => {},            // onTitleFocus 聚焦滚回顶部
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({}) }), exec: () => {} }) }),
  showModal: (o) => { if (o && typeof o.success === 'function') o.success({ confirm: true }) },
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showActionSheet: (o) => { if (o && o.success) o.success({ tapIndex: 0 }) },
  chooseMessageFile: (o) => { if (o && o.success) o.success({ tempFiles: [] }) },
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getFileSystemManager: () => ({ readFileSync: () => '' })
}
global.wx = wx

const prefsEngine = require('./miniprogram/engine/prefs.js')
global.getApp = () => ({
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs }
})

let pageDef = null
global.Page = (def) => { pageDef = def }
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef

function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) { if (patch && typeof patch === 'object') Object.assign(this.data, patch) }
  return inst
}

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS | ' + name + (extra ? '  -> ' + extra : '')) }
  else { fail++; console.log('  FAIL | ' + name + (extra ? '  -> ' + extra : '')) }
}

// ---------- A. 静态层：组件结构与样式约束 ----------
const WXML = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/edit/edit.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/edit/edit.wxss'), 'utf8')

/** 取出某个选择器规则块的花括号内容（只匹配「单独出现」的该选择器） */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(esc + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : ''
}

// 标题组件块：wxml 里 class="ed-title-input" 的那段标签
const titleTag = (WXML.match(/<(input|textarea)[\s\S]*?ed-title-input[\s\S]*?>/) || [''])[0]
const titleCss = ruleBody(WXSS, '.ed-title-input')
const navTitleCss = ruleBody(WXSS, '.ed-nav-title')

console.log('=== A1. 标题组件：必须是可换行的 textarea + auto-height（而非单行 input）===')
ok('标题组件已由 input 改为 textarea', /^<textarea/.test(titleTag), titleTag.slice(0, 12) + '...')
ok('开启 auto-height（内容自动增高、自动折行）', /auto-height\s*=\s*"\{\{true\}\}"/.test(titleTag))
ok('不再是单行 input（不存在 <input ... ed-title-input）', !/<input[^>]*ed-title-input/.test(WXML))

console.log('\n=== A2. 数据来源与编辑逻辑零改动：绑定与事件全部保留 ===')
ok('保留 value="{{title}}" 数据绑定', /value\s*=\s*"\{\{title\}\}"/.test(titleTag))
ok('保留 bindinput="onInputTitle"', /bindinput\s*=\s*"onInputTitle"/.test(titleTag))
ok('保留 bindfocus="onTitleFocus"（聚焦滚回顶部防遮挡）', /bindfocus\s*=\s*"onTitleFocus"/.test(titleTag))
ok('保留 maxlength="30" 字数上限', /maxlength\s*=\s*"30"/.test(titleTag))
ok('保留 placeholder / placeholder-class', /placeholder\s*=\s*"台本标题"/.test(titleTag) && /placeholder-class/.test(titleTag))
ok('JS 侧 onInputTitle / onTitleFocus / _syncNavTitle 均存在',
   typeof editDef.onInputTitle === 'function' &&
   typeof editDef.onTitleFocus === 'function' &&
   typeof editDef._syncNavTitle === 'function')

console.log('\n=== A3. 样式：不得出现「单行裁切 / 省略号」类约束 ===')
ok('标题样式无 text-overflow: ellipsis（不省略）', !/text-overflow\s*:\s*ellipsis/.test(titleCss))
ok('标题样式无 white-space: nowrap（不锁死单行）', !/white-space\s*:\s*nowrap/.test(titleCss))

console.log('\n=== A4. 样式：必须具备换行/断行能力（中英混排、无空格长串）===')
ok('有 word-break（长英文/数字可断行）', /word-break\s*:/.test(titleCss))
ok('有 overflow-wrap: anywhere（无空格长串不溢出）', /overflow-wrap\s*:\s*anywhere/.test(titleCss))

console.log('\n=== A5. 样式：高度上下限（空标题不塌陷 / 超长不撑爆卡片挤压下方）===')
const minH = (titleCss.match(/min-height\s*:\s*(\d+)rpx/) || [])[1]
const maxH = (titleCss.match(/max-height\s*:\s*(\d+)rpx/) || [])[1]
ok('有 min-height（空/短标题与原子输入框等高，视觉不跳动）', !!minH, 'min-height=' + minH + 'rpx')
ok('有 max-height 兜底（不无限撑高、不挤压下方按钮）', !!maxH, 'max-height=' + maxH + 'rpx')
ok('max-height 明确大于 min-height', Number(maxH) > Number(minH), `${minH} -> ${maxH}`)

console.log('\n=== A6. 导航栏标题：两行高度不得撑破导航标题行(88rpx)，避免遮挡首张卡片 ===')
const navLh = Number((navTitleCss.match(/line-height\s*:\s*(\d+)rpx/) || [])[1] || 0)
const navClamp = Number((navTitleCss.match(/-webkit-line-clamp\s*:\s*(\d+)/) || [])[1] || 0)
ok('导航栏标题限制行数且两行总高 ≤ 88rpx',
   navClamp > 0 && navLh > 0 && navClamp * navLh <= 88,
   `${navClamp} 行 × ${navLh}rpx = ${navClamp * navLh}rpx ≤ 88rpx`)
ok('导航栏标题保留断行能力（中英混排不横向溢出）',
   /word-break\s*:/.test(navTitleCss) && /overflow-wrap\s*:\s*anywhere/.test(navTitleCss))

// ---------- B. 数据层：超长标题不丢字 ----------
console.log('\n=== B. 超长标题：title 与 navTitle 完整同步，一字不丢 ===')
const CASES = [
  { name: '30 字中文（maxlength 满额）', t: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十' },
  { name: '中英混排带空格', t: '第71集 Reunion 重逢 Part One 上集回顾' },
  { name: '无空格超长英文', t: 'SupercalifragilisticexpialidociousTeleprompterScript' },
  { name: '中英数字标点混排', t: '建华&小凤的生活 EP.71-80 (最终剪辑版 v2)' }
]
CASES.forEach((c) => {
  const ed = makePage(editDef)
  ed.onLoad({})
  ed.onInputTitle({ detail: { value: c.t } })
  ok(`${c.name}：title 完整保存`, ed.data.title === c.t, `${ed.data.title.length}/${c.t.length} 字`)
  ok(`${c.name}：navTitle 完整同步`, ed.data.navTitle === c.t, `${ed.data.navTitle.length}/${c.t.length} 字`)
})

console.log('\n=== C. 回归：清空标题回落占位文案（原有行为不变）===')
{
  const ed = makePage(editDef)
  ed.onLoad({})
  ed.onInputTitle({ detail: { value: '临时标题' } })
  ed.onInputTitle({ detail: { value: '' } })
  ok('新建态清空标题 → 回落「新建台本」', ed.data.navTitle === '新建台本', 'navTitle=' + ed.data.navTitle)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
