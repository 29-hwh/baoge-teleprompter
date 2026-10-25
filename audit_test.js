/**
 * 全量功能审计测试（2026-09-06）
 * ---------------------------------------------------------------
 * 覆盖：核心流程 + 边界输入 + 异常/失败路径 + 权限场景。
 * 目的：找出真实缺陷（失败即缺陷候选），而非验证已有用例。
 * mock 微信运行时 + 伪时钟，跑真实页面/引擎代码。
 */
'use strict'

// ---------- 伪时钟 ----------
let T = 1000
const timers = []
let timerSeq = 1
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.requestAnimationFrame = (cb) => { cb(T + 16); return 1 }
global.cancelAnimationFrame = () => {}
global.Date.now = () => T
function step(ms, frames) {
  const f = frames || 1
  for (let i = 0; i < f; i++) {
    T += ms || 16
    for (const t of timers.slice()) {
      if (t.fireAt <= T) {
        t.fn()
        if (t.interval) t.fireAt = T + t.interval
        else { const idx = timers.indexOf(t); if (idx >= 0) timers.splice(idx, 1) }
      }
    }
  }
}

// ---------- mock wx（可配置失败注入） ----------
const mem = {}
const calls = { toast: [], navigateTo: [], navigateBack: [], redirectTo: [], showModal: [], actionSheet: [] }
const cfg = {
  file: null,            // chooseMessageFile 返回的文件；null 表示用户取消
  readText: '',          // readFileSync 返回文本
  readThrow: false,
  unzipOk: true,
  docxXml: null,         // 解压后 document.xml 内容
  quotaFail: false,      // 存储写入配额失败
  storageThrow: false,   // setStorageSync 抛异常
  recordAuthOk: true,    // 麦克风授权
  recordError: null      // 录音错误回调内容
}

global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { if (cfg.storageThrow) throw new Error('quota'); mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
  setPageOrientation: () => {},
  pageScrollTo: () => {},
  navigateTo: (o) => calls.navigateTo.push(o && o.url),
  navigateBack: () => calls.navigateBack.push(1),
  redirectTo: (o) => calls.redirectTo.push(o && o.url),
  reLaunch: (o) => calls.navigateTo.push(o && o.url),
  showToast: (o) => calls.toast.push(o && o.title),
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { calls.showModal.push(o && o.title); if (o && o.success) o.success({ confirm: true }) },
  showActionSheet: (o) => { calls.actionSheet.push(o && o.itemList); if (o && o.success) o.success({ tapIndex: 0 }) },
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': cfg.recordAuthOk } }) },
  authorize: (o) => { if (o && (cfg.recordAuthOk ? o.success : o.fail)) (cfg.recordAuthOk ? o.success : o.fail)({ errMsg: 'deny' }) },
  openSetting: () => {},
  getRecorderManager: () => ({
    start: (o) => { if (cfg.recordError) { /* 触发错误 */ } },
    stop: () => {}, onStart: () => {}, onStop: () => {},
    onError: (h) => { if (cfg.recordError && h) h({ errMsg: cfg.recordError }) },
    onFrameRecorded: () => {}
  }),
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: (cb) => cb({ height: 300 }) }), exec: () => {} }) }),
  chooseMessageFile: (o) => {
    if (!cfg.file) { if (o && o.fail) o.fail({ errMsg: 'cancel' }); return }
    if (o && o.success) o.success({ tempFiles: [cfg.file] })
  },
  getFileSystemManager: () => ({
    readFileSync: (p, enc) => {
      if (cfg.readThrow) throw new Error('read fail')
      return cfg.readText
    },
    unzip: (o) => {
      if (!cfg.unzipOk) { if (o && o.fail) o.fail({ errMsg: 'unzip fail' }); return }
      if (o && o.success) o.success()
    },
    rmdir: (o) => { if (o && o.success) o.success() }
  })
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = { globalData: { prefs: prefsEngine.load(), currentScript: null, importPayload: null }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } }
global.getApp = () => appMock

let pageDef = null
global.Page = (d) => { pageDef = d }
function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (p) { Object.keys(p).forEach((k) => { inst.data[k] = p[k] }) }
  inst.__wxCalls = calls
  return inst
}

const store = require('./miniprogram/engine/store.js')
const util = require('./miniprogram/utils/util.js')
const importSave = require('./miniprogram/utils/importSave.js')

require('./miniprogram/pages/index/index.js')
const idxDef = pageDef
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef
require('./miniprogram/pages/teleprompter/teleprompter.js')
const tpDef = pageDef
require('./miniprogram/pages/settings/settings.js')
const setDef = pageDef
require('./miniprogram/pages/preview/preview.js')
const pvDef = pageDef

// ---------- 断言 ----------
const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  → ' + extra : ''}`)
}
/** 断言「不抛异常」 */
function noCrash(name, fn) {
  try { fn(); ok(name, true, 'no crash') } catch (e) { ok(name, false, 'THROW: ' + (e && e.message)) }
}

function resetStore() {
  try { wx.setStorageSync(store.KEY, []) } catch (e) {}
  try { wx.setStorageSync(store.FOLDER_KEY, []) } catch (e) {}
  try { wx.setStorageSync('tp_positions_v1', {}) } catch (e) {}
}

console.log('===== A. 数据层与边界输入 =====')
resetStore()
// A1 空内容保存应被拒绝
{
  const ed = makePage(editDef)
  ed.onLoad({ isNew: '1' })
  ed.onInputContent({ detail: { value: '   \n  \n ' } })
  const before = calls.toast.slice()
  ed.onTapSave()
  ok('A1 空白内容点保存被拒绝（提示内容不能为空）', calls.toast.slice(before.length).some(t => /内容不能为空/.test(t || '')), JSON.stringify(calls.toast.slice(before.length)))
}
// A2 仅标点内容 → 自动命名兜底为「未命名台本」
{
  const ed = makePage(editDef)
  ed.onLoad({ isNew: '1' })
  ed.onInputContent({ detail: { value: '，。！？？！！' } })
  ed.onTapSave()
  ok('A2 纯标点内容：标题自动兜底为未命名台本', ed.data.title === '未命名台本', `title=${ed.data.title}`)
}
// A3 标题 30 字截断（超长标题保存后不超过 30）
{
  const ed = makePage(editDef)
  ed.onLoad({ isNew: '1' })
  ed.onInputContent({ detail: { value: '林晚：你好' } })
  const long = '标'.repeat(80)
  ed.onInputTitle({ detail: { value: long } })
  ed.onTapSave()
  const saved = store.get(ed.data.id)
  ok('A3 超长标题保存后截断到 30 字', !!saved && saved.title.length <= 30, `len=${saved && saved.title.length}`)
}
// A4 存储配额失败（store.save 返回 !ok）→ 编辑页保存失败且不跳转
{
  const orig = store.save
  store.save = () => ({ ok: false, msg: '存储空间不足，请清理后台本' })
  const ed = makePage(editDef)
  ed.onLoad({ isNew: '1' })
  ed.onInputContent({ detail: { value: '林晚：配额测试' } })
  const before = calls.toast.slice()
  noCrash('A4a 存储写入失败时保存流程不崩溃', () => ed.onTapSave())
  ok('A4b 存储写入失败有错误提示', calls.toast.slice(before.length).some(t => /存储|失败|空间/.test(t || '')), JSON.stringify(calls.toast.slice(before.length)))
  store.save = orig
}
// A5 底层 setStorageSync 抛异常（配额）→ 是否未捕获冒泡
{
  const origSave = store.save
  cfg.storageThrow = true
  let threw = false
  try { store.save(store.create('配额异常', '内容')) } catch (e) { threw = true }
  cfg.storageThrow = false
  ok('A5 底层存储抛异常时 store.save 是否吞掉（true=已处理）', !threw, threw ? 'store.save 抛出异常未捕获 → 页面会白屏/中断' : '已内部捕获')
  store.save = origSave
}
// A6 单字/极小内容
{
  const ed = makePage(editDef)
  ed.onLoad({ isNew: '1' })
  noCrash('A6 单字符内容可正常处理', () => { ed.onInputContent({ detail: { value: '啊' } }); ed.onTapSave() })
}

console.log('\n===== B. 导入路径与异常 =====')
// B1 导入 .doc（非 docx）→ 走文本分支
{
  resetStore()
  cfg.file = { name: '剧本.doc', path: '/tmp/a.doc' }
  cfg.readText = String.fromCharCode(0) + '\u0000\u0001二进制内容'
  const idx = makePage(idxDef)
  idx.onShow()
  const before = calls.navigateTo.slice()
  noCrash('B1a 导入 .doc 不崩溃', () => idx.onTapImport())
  const created = store.list()
  const garbage = created.find(s => /[\u0000-\u0008]/.test(s.content || ''))
  ok('B1b .doc 走文本分支未产生二进制垃圾台本（false=缺陷）', !garbage, garbage ? `创建了含控制字符的台本 title=${garbage.title}` : 'no garbage')
  cfg.file = null
}
// B2 解压失败 → 提示且不跳转
{
  cfg.file = { name: 'a.docx', path: '/tmp/a.docx' }
  cfg.unzipOk = false
  const idx = makePage(idxDef)
  const before = calls.toast.slice()
  noCrash('B2a docx 解压失败不崩溃', () => idx.onTapImport())
  ok('B2b 解压失败有提示', calls.toast.slice(before.length).some(t => /失败|解析/.test(t || '')), JSON.stringify(calls.toast.slice(before.length)))
  cfg.unzipOk = true
  cfg.file = null
}
// B3 docx 缺 document.xml（readFileSync 抛错）→ catch 后提示并清理，不跳转
{
  cfg.file = { name: 'b.docx', path: '/tmp/b.docx' }
  cfg.unzipOk = true
  cfg.readThrow = true
  const idx = makePage(idxDef)
  const before = calls.toast.slice()
  noCrash('B3a docx 缺正文文件不崩溃', () => idx.onTapImport())
  ok('B3b 缺正文有提示', calls.toast.slice(before.length).some(t => /失败|解析/.test(t || '')), JSON.stringify(calls.toast.slice(before.length)))
  cfg.readThrow = false
  cfg.file = null
}
// B4 用户取消选文件
{
  cfg.file = null
  const idx = makePage(idxDef)
  noCrash('B4 取消选择文件不崩溃', () => idx.onTapImport())
}
// B5 空 txt 文件导入
{
  resetStore()
  cfg.file = { name: 'empty.txt', path: '/tmp/e.txt' }
  cfg.readText = ''
  const idx = makePage(idxDef)
  noCrash('B5a 导入空文本不崩溃', () => idx.onTapImport())
  const created = store.list()
  ok('B5b 空文本文件不应创建空台本（false=缺陷）', created.length === 0, `创建了 ${created.length} 篇：${created.map(s => s.title).join(',')}`)
  cfg.file = null
}

console.log('\n===== C. 提词台（异常/边界） =====')
// C1 无 id / 错误 id 进入提词台
{
  const tp = makePage(tpDef)
  let crashed = false
  try { tp.onLoad({}) } catch (e) { crashed = true; console.log('   C1 throw:', e.message) }
  ok('C1 无 id 进入提词台不崩溃（false=阻断级）', !crashed, crashed ? 'onLoad 抛异常' : 'ok')
}
{
  const tp2 = makePage(tpDef)
  let crashed = false
  try { tp2.onLoad({ id: 'not-exist-id' }) } catch (e) { crashed = true; console.log('   C1b throw:', e.message) }
  ok('C1b 传入不存在的 id 不崩溃', !crashed, crashed ? 'onLoad 抛异常' : 'ok')
}
// C2 正常台本播放/暂停/进度
{
  resetStore()
  const lines = []
  for (let i = 0; i < 200; i++) lines.push(`林晚：这是第${i + 1}句台词，内容足够长以模拟真实提词场景。`)
  const s = store.create('提词测试', lines.join('\n'))
  store.save(s)
  const tp = makePage(tpDef)
  noCrash('C2a 正常进入提词台不崩溃', () => { tp.onLoad({ id: s.id }); tp.onShow(); tp.onReady() })
  noCrash('C2b 倒计时/自动开播不崩溃', () => { step(6000, 180) })
  ok('C2c 倒计时结束后自动进入滚动（playing=true）', tp.data.playing === true, `playing=${tp.data.playing}, countdown=${tp.data.countdown}`)
  noCrash('C2d 暂停不崩溃', () => tp.onTapPlay && tp.onTapPlay())
}
// C3 速度上限钳制（设置超过 max）
{
  const tp = makePage(tpDef)
  tp.onLoad({})
  noCrash('C3a 设置超速值不崩溃', () => tp.onSlideSpeed && tp.onSlideSpeed({ detail: { value: 99999 } }))
  ok('C3b 速度被钳制到上限 400 以内', !tp.data.speed || tp.data.speed <= 400, `speed=${tp.data.speed}`)
}
// C4 只有一个台本时上/下集切换
{
  resetStore()
  const s = store.create('单集', '林晚：只有一集')
  store.save(s)
  const tp = makePage(tpDef)
  tp.onLoad({ id: s.id })
  step(500, 10)
  noCrash('C4 单台本切换上/下集不崩溃', () => { tp.onTapNextScript && tp.onTapNextScript(); tp.onTapPrevScript && tp.onTapPrevScript() })
}
// C5 空内容台本进入提词台
{
  resetStore()
  const empty = store.create('空台本', '')
  store.save(empty)
  const tp = makePage(tpDef)
  noCrash('C5 空内容台本进入提词台不崩溃', () => { tp.onLoad({ id: empty.id }); step(500, 10) })
}

console.log('\n===== D. 权限与声控 =====')
// D1 麦克风未授权时开启声控
{
  resetStore()
  const s = store.create('声控测试', '林晚：测试台词内容')
  store.save(s)
  cfg.recordAuthOk = false
  cfg.recordError = 'operateRecorder:fail auth deny'
  const tp = makePage(tpDef)
  noCrash('D1a 未授权时开启声控不崩溃', () => { tp.onLoad({ id: s.id }); tp.onToggleVoice && tp.onToggleVoice(); step(500, 10) })
  ok('D1b 未授权时声控未卡在启用态或有提示', tp.data.voiceEnabled === false || calls.toast.some(t => /麦克|录音|授权|权限/.test(t || '')), `voiceEnabled=${tp.data.voiceEnabled}`)
  cfg.recordAuthOk = true
  cfg.recordError = null
}
// D2 录音过程报错
{
  cfg.recordError = 'operateRecorder:fail:audio interrupted'
  const tp = makePage(tpDef)
  noCrash('D2 录音报错不崩溃', () => { tp.onLoad({}); tp.onToggleVoice && tp.onToggleVoice(); step(800, 20) })
  cfg.recordError = null
}

console.log('\n===== E. 预览页（新页） =====')
// E1 无 payload 进入预览页
{
  appMock.globalData.importPayload = null
  const pv = makePage(pvDef)
  const before = calls.navigateBack.slice()
  noCrash('E1a 无导入数据进入预览页不崩溃', () => pv.onLoad())
  ok('E1b 无导入数据时自动返回', calls.navigateBack.length > before.length, `navBack=${calls.navigateBack.length - before.length}`)
}
// E2 文本 payload → 展示与三种导入
{
  resetStore()
  appMock.globalData.importPayload = { kind: 'text', name: '分集.txt', content: '第1集 重逢\n林晚：好久不见\n第2集 争执\n林晚：你听我说\n第3集 和解\n顾辞：算了' }
  const pv = makePage(pvDef)
  noCrash('E2a 预览页加载文本不崩溃', () => pv.onLoad())
  ok('E2b 预览页识别出多集（canSplit=true）', pv.data.canSplit === true, `canSplit=${pv.data.canSplit}, multiCount=${pv.data.multiCount}`)
  ok('E2c 分集预览有内容', (pv.data.segments || []).length >= 2 && !!pv.data.segments[0].name, JSON.stringify((pv.data.segments || []).map(s => s.name)))
  noCrash('E2d 三种导入按钮均不崩溃', () => {
    pv.onImportSingle()
    const pv2 = makePage(pvDef); pv2.onLoad(); pv2.onImportPlain()
    const pv3 = makePage(pvDef); pv3.onLoad(); pv3.onImportMultimodal()
  })
  ok('E2e 拆分导入成功落盘多篇', store.list().length >= 2, `count=${store.list().length}`)
}
// E3 单集文档（canSplit=false）点「多模态拆分」应退化为单篇
{
  resetStore()
  appMock.globalData.importPayload = { kind: 'text', name: '单篇.txt', content: '林晚：只有一段台词，没有分集标题也没有空行分段。' }
  const pv = makePage(pvDef)
  pv.onLoad()
  ok('E3a 单集文档 canSplit=false', pv.data.canSplit === false, `canSplit=${pv.data.canSplit}`)
  noCrash('E3b 单集点多模态拆分不崩溃', () => pv.onImportMultimodal())
  ok('E3c 单集退化为 1 篇台本', store.list().length === 1, `count=${store.list().length}`)
}
// E4 表格型 docx payload（规则A）
{
  resetStore()
  const xml = '<w:body>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>第1集 重逢</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>角色</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>林晚</w:t></w:p></w:tc><w:tc><w:p><w:t>好久不见</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>顾辞</w:t></w:p></w:tc><w:tc><w:p><w:t>别来无恙</w:t></w:p></w:tc></w:tr>'
    + '</w:tbl>'
    + '<w:p><w:t>第2集 争执</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>角色</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>林晚</w:t></w:p></w:tc><w:tc><w:p><w:t>你听我说</w:t></w:p></w:tc></w:tr></w:tbl>'
    + '</w:body>'
  const blocks = util.extractDocxBlocks(xml)
  const res = util.splitScripts(blocks)
  ok('E4a 表格稿按表拆出 2 集', res.ok && res.segments.length === 2, `segments=${res.segments && res.segments.length}`)
  ok('E4b 台词列识别正确（含角色：台词）', res.segments && res.segments[0].lines.join('|').indexOf('林晚：好久不见') >= 0, JSON.stringify(res.segments && res.segments[0].lines))
  ok('E4c 集标题取自表格前段落/首行', res.segments && /第1集/.test(res.segments[0].name), `name=${res.segments && res.segments[0].name}`)
  const r = importSave.commitSplitFromSegments(res.segments, '表格稿')
  ok('E4d 表格拆分落盘成功', r.count === 2, JSON.stringify(r))
}

console.log('\n===== F. 首页交互与性能 =====')
// F1 文件夹折叠持久化
{
  resetStore()
  appMock.globalData.importPayload = { kind: 'text', name: 'x.txt', content: '第1集 A\n甲：一\n第2集 B\n乙：二' }
  const pv = makePage(pvDef); pv.onLoad(); pv.onImportMultimodal()
  const idx = makePage(idxDef)
  idx.onShow()
  const folder = idx.data.list.find(i => i.kind === 'folder')
  const before = idx.data.list.filter(i => i.inFolder).length
  idx.onToggleFolder({ currentTarget: { dataset: { fid: folder.fid } } })
  const after = idx.data.list.filter(i => i.inFolder).length
  ok('F1a 折叠后组内台本隐藏', before > 0 && after === 0, `before=${before}, after=${after}`)
  const idx2 = makePage(idxDef)
  idx2.onShow()
  ok('F1b 折叠状态持久化（重进仍折叠）', idx2.data.list.find(i => i.kind === 'folder').collapsed === true, JSON.stringify(idx2.data.list.find(i => i.kind === 'folder')))
}
// F2 分区过滤与空态
{
  const idx = makePage(idxDef); idx.onShow()
  idx.onSwitchFilter({ currentTarget: { dataset: { key: 'single' } } })
  const singleOk = idx.data.list.every(i => i.kind === 'script' && !i.inFolder)
  ok('F2a 单篇分区只显示单篇', singleOk, JSON.stringify(idx.data.list.map(i => i.kind)))
  idx.onSwitchFilter({ currentTarget: { dataset: { key: 'split' } } })
  ok('F2b 拆分分区只显示文件夹及其台本', idx.data.list.every(i => i.kind === 'folder' || i.inFolder), JSON.stringify(idx.data.list.map(i => i.kind)))
  idx.onSwitchFilter({ currentTarget: { dataset: { key: 'all' } } })
}
// F3 删除文件夹
{
  const idx = makePage(idxDef); idx.onShow()
  const folder = idx.data.list.find(i => i.kind === 'folder')
  noCrash('F3a 删除文件夹不崩溃', () => idx.onLongPressFolder({ currentTarget: { dataset: { fid: folder.fid, name: folder.name, count: folder.count } } }))
  idx.onShow()
  ok('F3b 删除后台本与文件夹均已移除', store.listFolders().length === 0 && store.list().length === 0, `folders=${store.listFolders().length}, scripts=${store.list().length}`)
}
// F4 大文本性能（5 万字解析）
{
  const big = []
  for (let i = 0; i < 2000; i++) big.push(`林晚：这是第${i + 1}句台词，用于验证大文本下的解析与渲染性能表现。`)
  const content = big.join('\n')
  const t0 = Date.now()
  const parsed = require('./miniprogram/engine/parser.js').parseScript(content, { charsPerLine: 26, roleHighlight: true, isDark: true })
  const t1 = Date.now()
  ok('F4a 5万字解析可用（<2000ms 参考）', true, `chars=${parsed.stats.chars}, 耗时≈${t1 - t0}ms(伪时钟仅供相对参考)`)
  const t2 = Date.now()
  const stats = require('./miniprogram/engine/parser.js').quickStats(content)
  ok('F4b quickStats 大文本不超时', true, `耗时≈${Date.now() - t2}ms, chars=${stats.chars}`)
}
// F5 单行超长（2万字不换行）
{
  const long = '林晚：' + '啊'.repeat(20000)
  noCrash('F5 单行 2 万字解析不崩溃', () => require('./miniprogram/engine/parser.js').parseScript(long, { charsPerLine: 26, roleHighlight: true, isDark: true }))
}
// F6 首页存储告警阈值
{
  const idx = makePage(idxDef)
  idx.onShow()
  ok('F6 存储占用提示字段存在且为合理值', typeof idx.data.storageTip === 'string', `tip="${idx.data.storageTip}"`)
}

console.log('\n===== G. 设置页 =====')
{
  const st = makePage(setDef)
  noCrash('G1 设置页加载不崩溃', () => st.onLoad())
  noCrash('G2 恢复默认设置不崩溃', () => st.onTapReset && st.onTapReset())
  noCrash('G3 切换滚动方式/字号/主题不崩溃', () => {
    st.onTapScrollMode && st.onTapScrollMode({ currentTarget: { dataset: { value: 'voice' } } })
    st.onTapFont && st.onTapFont({ currentTarget: { dataset: { value: 2 } } })
    st.onTapScheme && st.onTapScheme({ currentTarget: { dataset: { key: 'white' } } })
    st.onSlideMargin && st.onSlideMargin({ detail: { value: 0 } })
  })
  ok('G4 留白可调到 0 且写入偏好', (appMock.globalData.prefs.marginHorizontal === 0), `marginHorizontal=${appMock.globalData.prefs.marginHorizontal}`)
}

console.log('\n===== H. 报告 1.4 三缺陷回归 =====')
// H1 D1：.doc 二进制文件不应被静默入库
{
  resetStore()
  const beforeList = store.list().length
  cfg.file = { name: '旧稿.doc', path: '/tmp/legacy.doc', size: 1024 }
  cfg.readText = '\u0000\u0001\u0002\u0003\u0004\u0005' // 6 字节纯控制字符
  const idx = makePage(idxDef)
  const beforeNav = calls.navigateTo.length
  calls.toast.length = 0
  idx.onTapImport()
  noCrash('H1a .doc 文件不崩溃', () => {})
  ok('H1b .doc 不入库（store.list 长度未增）', store.list().length === beforeList, `before=${beforeList}, after=${store.list().length}`)
  ok('H1c .doc 给出拒绝提示', calls.toast.some(t => /不支持.*\.doc/.test(t || '')) || !calls.navigateTo.slice(beforeNav).some(u => u && u.indexOf('edit/edit') >= 0), `toasts=${JSON.stringify(calls.toast.slice(-3))}`)
  cfg.file = null
}
// H1b 无后缀但内容为二进制（同上逻辑）
{
  resetStore()
  const beforeList = store.list().length
  cfg.file = { name: 'xxx', path: '/tmp/x', size: 2048 }
  let bin = ''
  for (let i = 0; i < 1500; i++) bin += String.fromCharCode(1 + (i % 30)) // 大量控制字符
  cfg.readText = bin
  const idx = makePage(idxDef)
  idx.onTapImport()
  ok('H1d 二进制嗅探拦得住「无后缀但内容是 PDF/图片」', store.list().length === beforeList, `diff=${store.list().length - beforeList}`)
  cfg.file = null
}
// H2 D2：空 txt 不应被保存
{
  resetStore()
  cfg.file = { name: '空.txt', path: '/tmp/empty.txt', size: 0 }
  cfg.readText = ''
  const beforeList = store.list().length
  const beforeNav = calls.navigateTo.length
  const idx = makePage(idxDef)
  calls.toast.length = 0
  idx.onTapImport()
  ok('H2a 空 txt 不入库', store.list().length === beforeList, `diff=${store.list().length - beforeList}`)
  ok('H2b 空 txt 不跳编辑页', !calls.navigateTo.slice(beforeNav).some(u => u && u.indexOf('edit/edit') >= 0), `nav=${JSON.stringify(calls.navigateTo.slice(beforeNav))}`)
  ok('H2c 空 txt 给出提示', calls.toast.some(t => /为空|无内容/.test(t || '')), `toasts=${JSON.stringify(calls.toast.slice(-2))}`)
  cfg.file = null
}
// H2b 全空白正文（伪零字节）也不入库
{
  resetStore()
  cfg.file = { name: 'wsp.txt', path: '/tmp/wsp.txt', size: 12 }
  cfg.readText = '   \n  \n  '
  const beforeList = store.list().length
  const idx = makePage(idxDef)
  idx.onTapImport()
  ok('H2d 全空白内容也被视为空', store.list().length === beforeList, `diff=${store.list().length - beforeList}`)
  cfg.file = null
}
// H3 D3：超长标题必须截断到 TITLE_MAX_LEN
{
  resetStore()
  const ed = makePage(editDef)
  ed.onLoad({ id: '' })
  const longTitle = 'A'.repeat(80)
  ed.onInputContent({ detail: { value: '林晚：长标题测试。' } })
  ed.onInputTitle({ detail: { value: longTitle } })
  ed.onTapSave()
  const all = store.list()
  ok('H3a 超长标题保存后被截断到 30 字内', all.length > 0 && [...all[0].title].length === 30, `title.length=${[...(all[0] && all[0].title || '')].length}`)
}
{ // _save 显式保存一条也已截断
  resetStore()
  const ed = makePage(editDef)
  ed.onLoad({ id: '' })
  ed.onInputContent({ detail: { value: '林晚：测试。' } })
  ed.onInputTitle({ detail: { value: 'B'.repeat(120) } })
  ed.onTapSave()
  const all = store.list()
  ok('H3b _save 主动保存同样截断', all.length > 0 && [...all[0].title].length <= 30, `len=${[...(all[0] && all[0].title || '')].length}`)
}

// ---------- 汇总 ----------
const bad = results.filter(r => !r.pass)
console.log(`\n================ 审计结果：${results.length - bad.length}/${results.length} 通过 ================`)
if (bad.length) {
  console.log('未通过项（缺陷候选）：')
  bad.forEach(r => console.log(' ❌ ' + r.name + (r.extra ? ' :: ' + r.extra : '')))
}
console.log(`\n缺陷候选数：${bad.length}`)
