/**
 * 全功能模块真实数据实测（贯通：导入拆分 → 存储 → 角色显示 → 台词页 → 按集切换 + 边界）。
 * 范式同 script_switch.test.js（伪时钟 + mock 微信运行时 + store）。
 *
 * 覆盖：
 *  A. Word 表格稿导入：4 个表格(71-74) → splitScripts → 存文件夹 → 列表/文件夹分组正确
 *  B. Word 段落稿导入：第75-80集(ep 标题) → splitScripts → 存文件夹 → 集号正确
 *  C. 角色显示选择：打开 ep72 设 roleDisplay=['建华'] → displayLines 仅建华台词
 *  D. 按集顺序切换：ep72 → 下一集应为 ep73（集号递增）
 *  E. 边界：空列表切换/单台本置灰/30字长标题/极短稿滚动结束判定
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

const memStorage = {}
let MODAL_RESULT = { confirm: true }
let modalCalls = 0
const wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {}, setScreenBrightness: () => {}, setPageOrientation: () => {},
  navigateTo: () => {}, navigateBack: () => {},
  showModal: (o) => { modalCalls++; if (o && typeof o.success === 'function') o.success(MODAL_RESULT) },
  showToast: () => {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}
global.wx = wx

const prefsEngine = require('./miniprogram/engine/prefs.js')
const util = require('./miniprogram/utils/util.js')
const roleEngine = require('./miniprogram/engine/role.js')
const parser = require('./miniprogram/engine/parser.js')
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
  const p = Object.assign({ data: {}, _clicks: 0 }, pageDef)
  p.setData = function (patch) { Object.assign(this.data, patch); if (typeof this._onData === 'function') this._onData(patch) }
  const origOn = p.onLoad
  p.onLoad = function (q) { this._loadQuery = q; return origOn.call(this, q) }
  return p
}

// ---------- 真实样本构造 ----------
function docx(body) { return `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>` }
function para(t) { return `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>` }
function cell(t) { return `<w:tc><w:p><w:t>${t}</w:t></w:p></w:tc>` }
function table(rows) { return `<w:tbl>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>` }

// 建华&小凤 表格稿 71-74：每集一个表格，集标题在表格前段落
function buildTableDoc() {
  let body = ''
  for (let n = 71; n <= 74; n++) {
    body += para('建华&小凤的生活' + n)
    body += table([
      [cell('镜头'), cell('画面'), cell('台词')],
      [cell('1'), cell('客厅'), cell('建华：今天天气不错')],
      [cell('2'), cell('厨房'), cell('小凤：去逛街吧')]
    ])
  }
  return docx(body)
}

function buildParagraphDoc() {
  const body = [
    '建华&小凤的生活75', '建华：周末去哪', '小凤：看电影',
    '建华&小凤的生活76', '建华：电影好看吗', '小凤：挺好的',
    '建华&小凤的生活77', '建华：明天呢', '小凤：在家休息'
  ].map(para).join('')
  return docx(body)
}

// ---------- 断言 ----------
let pass = 0, fail = 0
function ok(name, cond, info) {
  if (cond) { pass++; console.log('PASS | ' + name) }
  else { fail++; console.log('FAIL | ' + name + '  -> ' + (info !== undefined ? JSON.stringify(info) : '')) }
}

console.log('\n########## A. 表格稿导入：71-74 → 存文件夹 ##########')
{
  const blocks = util.extractDocxBlocks(buildTableDoc())
  const res = util.splitScripts(blocks)
  ok('splitScripts 拆出 4 集(71-74)', res.segments.length === 4, res.segments.length)
  ok('集号序列 71,72,73,74', res.segments.map((s) => s.epNo).join(',') === '71,72,73,74', res.segments.map((s) => s.epNo))
  // 模拟真实导入落库：建文件夹 + 逐集存
  const folder = store.createFolder('建华&小凤的生活(表格稿)')
  const saved = res.segments.map((s) => {
    const sc = store.create(s.name, s.lines.join('\n'))
    sc.folderId = folder.id
    sc.roleDisplay = null // 默认全显
    store.save(sc)
    return sc
  })
  const listed = store.list().filter((s) => s.folderId === folder.id)
  ok('文件夹内 4 篇台本', listed.length === 4, listed.length)
  ok('按集顺序读取正确(75→76→77 递增)', util.sortByEpisode(listed).map((s) => util.parseEpisodeNo(s.title)).join(',') === '71,72,73,74', util.sortByEpisode(listed).map((s) => s.title))
}

console.log('\n########## B. 段落稿导入：75-77 → 存文件夹 ##########')
{
  const res = util.splitScripts(util.extractDocxBlocks(buildParagraphDoc()))
  ok('段落稿拆出 3 集(75-77)', res.segments.length === 3, res.segments.length)
  const folder = store.createFolder('建华&小凤的生活(段落稿)')
  const saved = res.segments.map((s) => {
    const sc = store.create(s.name, s.lines.join('\n'))
    sc.folderId = folder.id
    store.save(sc)
    return sc
  })
  ok('段落稿台本 content 含角色对白', saved.every((s) => /：/.test(s.content)), true)
}

console.log('\n########## C. 角色显示选择：ep72 仅显示建华 ##########')
{
  const ep72 = store.list().find((s) => s.title === '建华&小凤的生活72')
  ok('找到 ep72', !!ep72, ep72 && ep72.title)
  ep72.roleDisplay = ['建华'] // 仅显示建华
  store.save(ep72)
  const p = makePage()
  p.onLoad({ id: ep72.id })
  p.onReady()
  stepFrames(4)
  const roles = p.displayLines.map((l) => l.role).filter(Boolean)
  ok('displayLines 仅含建华(无小凤)', roles.length > 0 && roles.every((r) => r === '建华'), roles)
  ok('displayLines 不含小凤台词', !p.displayLines.some((l) => /逛街/.test(l.text || '')), p.displayLines.length)
}

console.log('\n########## D. 按集顺序切换：ep72 → 下一集应为 ep73 ##########')
{
  const ep72 = store.list().find((s) => s.title === '建华&小凤的生活72')
  const p = makePage()
  p.onLoad({ id: ep72.id })
  p.onReady()
  p.onTapNextScript()
  ok('下一集为 ep73(集号递增)', p.scriptId === store.list().find((s) => s.title === '建华&小凤的生活73').id, p.scriptId)
}

console.log('\n########## E. 边界场景 ##########')
{
  // E1 空列表切换不崩（先真正清空 store）
  Object.keys(memStorage).forEach((k) => { delete memStorage[k] })
  const p = makePage()
  p.onLoad({ id: 'not-exist' })
  p.onTapNextScript()
  p.onTapPrevScript()
  ok('空/不存在台本切换不抛错', true)

  // E2 单台本：prev/next 置灰(无越界)
  const only = store.create('独白稿', '这是一句独白。\n这是第二句。')
  store.save(only)
  const p2 = makePage()
  p2.onLoad({ id: only.id })
  p2.onReady()
  ok('单台本 hasPrevScript=false', p2.data.hasPrevScript === false, p2.data.hasPrevScript)
  ok('单台本 hasNextScript=false', p2.data.hasNextScript === false, p2.data.hasNextScript)

  // E3 30字长标题完整保存
  const longTitle = '测'.repeat(30)
  ok('长标题=30字', longTitle.length === 30, longTitle.length)
  const ls = store.create(longTitle, '内容')
  store.save(ls)
  ok('长标题台本可正常存取', store.get(ls.id).title === longTitle, store.get(ls.id).title)

  // E4 极短稿滚动结束判定：末行滚过参考线即结束(非循环)
  const shortScript = store.create('短稿', '只有一句。')
  store.save(shortScript)
  const p3 = makePage()
  p3.onLoad({ id: shortScript.id })
  p3.onReady()
  const eng = p3.engine
  ok('短稿 engine 已配置(有总高)', eng.totalHeight > 0, eng.totalHeight)
  // 驱动滚动到末行过参考线
  eng.start()
  let guard = 0
  while (!p3.data.finished && guard < 2000) { stepFrames(1); guard++ }
  ok('极短稿滚动能正常结束(finished)', p3.data.finished === true, p3.data.finished)
}

console.log('\n══════════════════════════════════════')
console.log(`结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
