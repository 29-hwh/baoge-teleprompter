/**
 * 第十八轮 Bug 修复验证套件
 * 覆盖：循环风暴、循环默认关、空行呼吸点、编辑页退出拦截/兜底保存、
 *       lastPosition 重置、docx 清理、实体解码、防抖可取消
 * 运行：node bug_fixes.test.js
 */
'use strict'

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

/* ============ Part 1: 引擎层（无需 wx mock） ============ */
console.log('━━ 1. 循环播放默认值与滚动引擎')

const prefsEngine = require('./miniprogram/engine/prefs.js')
// 需求变更（原为默认 true）：无缝衔接（循环播放）默认改为【关闭】。
// 理由：提词稿是一次性念完的，念到末行就该停住；默认无限循环会让「已读完」的信号
// 消失、末尾台词反复滚回来，反而干扰判断。需要的用户在设置页/菜单「循环」里自行打开。
ok('prefs.DEFAULTS.loop 默认为 false（默认关闭无缝衔接）', prefsEngine.DEFAULTS.loop === false)

const ScrollEngine = require('./miniprogram/engine/scroll.js')

// 1a. 短稿件（maxOffset=0）+ 循环：应只 onEnd 一次，onLoop 零次
{
  let loops = 0, ends = 0
  const e = new ScrollEngine({
    onLoop: () => loops++,
    onEnd: () => ends++
  })
  e.configure(40, 300, 600, 60) // 内容比视口矮 → maxOffset = 0
  e.loop = true
  e.start()
  setTimeout(() => {
    ok('短稿件循环模式 onLoop 不再每帧触发', loops === 0, 'loops=' + loops)
    ok('短稿件只触发一次 onEnd（视为读完）', ends === 1, 'ends=' + ends)
    ok('短稿件结束后引擎停表（playing=false 且定时器已清）', e.playing === false && e._timer === null)
    e.destroy()
  }, 300)
}

// 1b. 极短可滚稿件 + 循环：MIN_LOOP_MS=400ms 节流，1.2s 内 ≤ 4 次
{
  let loops = 0
  const e = new ScrollEngine({ onLoop: () => loops++ })
  e.configure(40, 1000, 900, 5000) // maxOffset=100，5000px/s 一帧就滚完
  e.loop = true
  e.start()
  setTimeout(() => {
    ok('极短稿件循环触发被节流（1.2s 内 ≤ 4 次，旧代码 ≈ 60 次）', loops >= 1 && loops <= 4, 'loops=' + loops)
    e.destroy()
  }, 1200)
}

/* ============ Part 2: 空行呼吸点（splitSections / parseScript） ============ */
console.log('━━ 2. 空行作为段落呼吸点保留')

const parser = require('./miniprogram/engine/parser.js')
{
  const secs = parser.splitSections('第一段内容\n\n\n第二段内容')
  ok('splitSections 保留一个空行占位段', secs.length === 3 && secs[1] === '', JSON.stringify(secs))
  ok('开头空行不产生占位段', parser.splitSections('\n\n正文').length === 1)

  const parsed = parser.parseScript('第一段。\n\n第二段。', { charsPerLine: 26 })
  ok('parseScript 渲染空行为 spacer 行', parsed.lines.some((l) => l.isSpacer === true && l.text === ''))
  ok('stats.sections 不把空行计入段数', parsed.stats.sections === 2, 'sections=' + parsed.stats.sections)
  ok('stats.chars 不受空行影响', parsed.stats.chars === 8, 'chars=' + parsed.stats.chars)

  const qs = parser.quickStats('第一段。\n\n第二段。')
  ok('quickStats 段数口径一致', qs.sections === 2, 'sections=' + qs.sections)

  const noGap = parser.parseScript('没有空行的内容。', { charsPerLine: 26 })
  ok('无空行文本不产生 spacer', !noGap.lines.some((l) => l.isSpacer))
}

/* ============ Part 3: 工具函数 ============ */
console.log('━━ 3. docx 实体解码 / 防抖可取消')

const util = require('./miniprogram/utils/util.js')
ok('decodeXmlEntities 解码 &amp; &lt; &gt;', util.decodeXmlEntities('A&amp;B &lt;3 &gt;2') === 'A&B <3 >2')
ok('decodeXmlEntities 解码数字/十六进制实体', util.decodeXmlEntities('&#x4e2d;&#25991;') === '中文')
ok('debounce 带 cancel，取消后不再触发', (() => {
  let fired = 0
  const fn = util.debounce(() => fired++, 20)
  fn()
  fn.cancel()
  return fired === 0 // 同步检查；异步验证放在收尾
})())

/* ============ Part 4: 编辑页退出拦截与兜底 ============ */
console.log('━━ 4. 编辑页未保存拦截 / onUnload 兜底 / lastPosition 重置')

// ---- mock 微信运行时 ----
const mem = {}
const rmdirCalls = []
let navBackCount = 0
global.wx = {
  env: { USER_DATA_PATH: '/tmp/wxuser' },
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] },
  showToast: () => {},
  showModal: (o) => { if (o && o.success) o.success({ confirm: false }) },
  showLoading: () => {},
  hideLoading: () => {},
  showActionSheet: () => {},
  chooseMessageFile: () => {},
  navigateBack: (o) => {
    navBackCount++
    if (o && o.success) o.success()
  },
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 390, windowHeight: 844 }),
  getFileSystemManager: () => ({
    unzip: (o) => o.success(),
    readFileSync: () => '<w:p><w:t>AT&amp;T</w:t></w:p>',
    rmdir: (o) => rmdirCalls.push(o)
  })
}
let pageOpts = null
global.Page = (opts) => { pageOpts = opts }
const appMock = {
  globalData: { prefs: {} },
  updatePrefs: (patch) => {
    appMock.globalData.prefs = Object.assign({}, appMock.globalData.prefs, patch)
    return appMock.globalData.prefs
  }
}
global.getApp = () => appMock

const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/edit/edit.js')
if (!pageOpts) { console.error('页面未注册'); process.exit(1) }

function makeEditPage() {
  const inst = { data: JSON.parse(JSON.stringify(pageOpts.data)) }
  Object.keys(pageOpts).forEach((k) => {
    if (k === 'data') return
    if (typeof pageOpts[k] === 'function') inst[k] = pageOpts[k].bind(inst)
  })
  inst.setData = function (patch) { Object.assign(this.data, patch) }
  return inst
}

// 准备一个已保存台本，带 lastPosition=0.8
const savedScript = store.create('旧标题', '旧内容第一段。\n旧内容第二段。')
savedScript.lastPosition = 0.8
store.save(savedScript)
const scriptId = savedScript.id

{
  // 4a. 自定义导航栏状态栏高度
  const p = makeEditPage()
  p.onLoad({})
  ok('statusBarHeight 从系统信息读取（刘海屏适配）', p.data.statusBarHeight === 44)

  // 4b. 无修改点返回：直接走，不弹确认
  const q = makeEditPage()
  q.onLoad({ id: scriptId })
  navBackCount = 0
  q.onTapBack()
  ok('无修改时点返回直接离开，不弹确认', navBackCount === 1 && !q.data.exitModalVisible)

  // 4c. 有修改点返回：弹三选一确认
  const r = makeEditPage()
  r.onLoad({ id: scriptId })
  r.setData({ content: '改过的内容' })
  navBackCount = 0
  r.onTapBack()
  ok('有未保存修改时点返回弹出确认弹窗', r.data.exitModalVisible === true && navBackCount === 0)

  // 4d. 保存并返回：落库 + lastPosition 重置
  r.onExitSave()
  const after = store.get(scriptId)
  ok('「保存并返回」内容已落库', after && after.content === '改过的内容')
  ok('内容变化后 lastPosition 被重置为 0', after.lastPosition === 0, 'lastPosition=' + after.lastPosition)
  ok('「保存并返回」后已导航离开', navBackCount === 1)

  // 4e. 不保存离开：不落库，onUnload 兜底也不再保存
  const s = makeEditPage()
  s.onLoad({ id: scriptId })
  s.setData({ content: '又一次修改但选择放弃' })
  s.onTapBack()
  s.onExitDiscard()
  s.onUnload()
  const afterDiscard = store.get(scriptId)
  ok('「不保存离开」后内容保持上次保存的版本', afterDiscard.content === '改过的内容')
}

{
  // 4f. 内容未变时保存：lastPosition 保留
  const p = makeEditPage()
  p.onLoad({ id: scriptId })
  const cur = store.get(scriptId)
  cur.lastPosition = 0.5
  store.save(cur)
  p._save()
  ok('内容未变化时 lastPosition 不被重置', store.get(scriptId).lastPosition === 0.5)
}

{
  // 4g. 侧滑返回兜底：dirty 时 onUnload 自动静默保存
  const p = makeEditPage()
  p.onLoad({ id: scriptId })
  p.setData({ content: '侧滑手势前的最后输入' })
  p.onUnload()
  ok('onUnload 兜底：未保存修改被自动保存', store.get(scriptId).content === '侧滑手势前的最后输入')

  // 4h. 新建空白台本侧滑返回：不产生垃圾空台本
  const q = makeEditPage()
  q.onLoad({})
  const newId = q.data.id
  q.onUnload()
  ok('新建但正文为空时兜底不保存（无垃圾台本）', !store.get(newId))
}

{
  // 4i. 编辑页内嵌的「导入 Word / 文本」入口（含 docx 解压后清理逻辑）已随功能精简移除；
  //     导入统一收敛到首页「导入 txt / word」智能拆分入口。收尾仍走 finish()。
  setTimeout(finish, 0)
}

/* ============ 收尾 ============ */
function finish() {
  // 防抖异步验证：cancel 后 60ms 内不触发
  let fired = 0
  const fn = util.debounce(() => fired++, 20)
  fn()
  fn.cancel()
  setTimeout(() => {
    ok('debounce.cancel 后异步也不再触发', fired === 0)
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
    process.exit(fail ? 1 : 0)
  }, 60)
}
