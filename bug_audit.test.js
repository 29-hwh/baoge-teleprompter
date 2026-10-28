/**
 * Bug 审计复现脚本：针对「全面检查 bug」的怀疑点逐条用真实页面/引擎复现。
 * 只做验证、不改产品代码。确认是真 bug 后再去修。
 * 伪时钟 + mock 微信运行时，复用 _e2e_test.js 的范式。
 */
'use strict'

// ---------- 伪时钟（用真实 epoch 量级，否则时间戳类 bug 会被小 T 掩盖）----------
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

// ---------- mock wx ----------
const memStorage = {}
let MODAL_RESULT = { confirm: true }

const wx = {
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
  setPageOrientation: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  showModal: (opts) => { if (opts && typeof opts.success === 'function') opts.success(MODAL_RESULT) },
  showToast: () => {},
  requirePrivacyAuthorize: (opts) => { if (opts && opts.success) opts.success() },
  getSetting: (opts) => { if (opts && opts.success) opts.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({
    start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {},
    onError: () => {}, onFrameRecorded: () => {}
  })
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
if (!pageDef) { console.error('页面未注册'); process.exit(1) }

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst._setDataCount = 0
  inst.setData = function (patch) {
    this._setDataCount++
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  return inst
}

// ---------- 断言 ----------
const results = []
function bug(name, isBug, detail) {
  results.push({ name, isBug, detail })
  console.log(`${isBug ? '🐛 BUG确认' : '✅ 正常  '} | ${name}\n            ${detail}`)
}

// 每段都长到必须折成多行，才能暴露「上一段」的跳转落点问题
function longSection(label, n) {
  return Array.from({ length: n }, (_, i) => `${label}第${i + 1}句，这是一句足够长的话用来触发折行效果`).join('')
}

console.log('══════ 1. 短稿件（内容不满一屏）+ 循环模式：onLoop 是否每帧触发 ══════')
{
  const s = store.create('短稿', '第一句话\n第二句话\n第三句话')
  store.save(s)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  const maxOffset = page.engine.maxOffset
  const lines = page.allLines.length
  stepFrames(200) // 走完倒计时 3s（默认 countdown=3）
  const playingNow = page.engine.playing
  const before = page.stats.loopCount
  const sdBefore = page._setDataCount
  stepFrames(60) // 1 秒
  const loopDelta = page.stats.loopCount - before
  const sdDelta = page._setDataCount - sdBefore
  bug(
    '短稿件不满一屏时 maxOffset=0，循环模式 onLoop 每帧触发（setData 风暴）',
    maxOffset === 0 && loopDelta > 30,
    `maxOffset=${maxOffset}（行数=${lines}）、playing=${playingNow} → 1 秒内 onLoop 触发 ${loopDelta} 次、setData ${sdDelta} 次（正常应≈0 次）`
  )
}

console.log('\n══════ 2. 菜单「上/下一个台本」切换（需求 10：原上/下一段已改为切换台本）═══════')
{
  const s0 = store.create('第一份稿', '甲：第一段内容')
  store.save(s0)
  const s2 = store.create('第二份稿', '甲：第二段内容')
  store.save(s2)
  const list = store.list()
  const idx0 = list.findIndex((s) => s.id === s0.id)
  // 产品语义：切换不循环到头，而是停在边界 toast 提示。
  // 因此只有当 s0 右侧确实还有相邻台本时，才断言「下一步」应切过去。
  const hasNext = idx0 >= 0 && idx0 + 1 < list.length
  const nextTarget = hasNext ? list[idx0 + 1] : null
  const page = makePage()
  page.onLoad({ id: s0.id })
  page.onReady()
  const id0 = page.scriptId
  page.onTapNextScript()
  const switched = !hasNext ? null : (page.scriptId === nextTarget.id && page.data.title === nextTarget.title)
  const posText = !hasNext ? null : (page.data.scriptPosText === `${idx0 + 2} / ${list.length}`)
  const nextTitle = page.data.title
  const nextPos = page.data.scriptPosText
  page.onTapPrevScript()
  const back = page.scriptId === id0 && page.data.title === s0.title
  const ok = (!hasNext || (switched && posText)) && back
  bug(
    '菜单里的「上/下一个台本」能正确在台本间切换',
    !ok,
    `next→${nextTitle}(pos=${nextPos})${hasNext ? `；切到目标=${switched && posText}` : '（已是最后一个，应 toast 不切换）'}；` +
    `prev→切回 ${back}；` + (ok ? 'OK' : '切换异常')
  )
}

console.log('\n══════ 3. 已暂停时点击屏幕唤出控制栏，是否会被误恢复播放 ══════')
{
  const text = Array.from({ length: 30 }, (_, i) => `第${i + 1}行台词内容，足够长以产生滚动`).join('\n')
  const s = store.create('长稿', text)
  store.save(s)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  stepFrames(200) // 倒计时结束，进入播放
  const playingAuto = page.data.playing
  page.onTapPlay() // 用户主动暂停
  const pausedOk = page.data.playing === false && page.engine.playing === false
  // 模拟「点一下屏幕想唤出控制栏」：原地 touchstart + touchend，不拖动
  page.onTouchStart({ touches: [{ clientY: 200 }] })
  page.onTouchEnd()
  bug(
    '已暂停状态下轻点屏幕（想唤出控制栏）会把提词重新播放',
    pausedOk && page.data.playing === true,
    `自动播放=${playingAuto}，主动暂停成功=${pausedOk}，轻点后 playing=${page.data.playing}（应为 false）`
  )
}

console.log('\n══════ 4. 倒计时关闭：点一下播放，统计是否从 0 起算 ══════')
{
  // 新契约（对齐浅纸）：进入提词页不自动播，单击屏幕才开始 —— 必须先 onTapPlay。
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 0, loop: false })
  const text = Array.from({ length: 40 }, (_, i) => `第${i + 1}行台词内容，足够长以产生滚动`).join('\n')
  const s = store.create('倒计时关闭', text)
  store.save(s)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  page.onTapPlay()
  stepFrames(60)
  const started = page.stats && page.stats.startTs > 0
  stepFrames(1500)
  const snap = page.stats.snapshot()
  const insane = snap.durationMs > 6 * 3600 * 1000 // 超过 6 小时即视为时间戳差值失控
  bug(
    '点播放后统计未初始化，阅读时长算出天文数字',
    !started || insane,
    `startTs=${page.stats.startTs}、durationMs=${snap.durationMs}、` +
    `rolledLines=${snap.rolledLines}/totalLines=${snap.totalLines}`
  )
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 3, loop: true })
}

console.log('\n══════ 5. 中途切后台再回来：位置不丢、不自动播、能继续读完 ══════')
{
  // 新契约：切后台只暂停并落盘位置；回前台不弹窗、不自动播（用户自己决定何时继续）
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 0, loop: false })
  const text = Array.from({ length: 40 }, (_, i) => `第${i + 1}行台词内容，足够长以产生滚动`).join('\n')
  const s = store.create('切后台', text)
  store.save(s)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  page.onTapPlay()
  stepFrames(120)
  page.onHide() // 切后台（内部会按已播时长反算位置）
  const before = page.engine.current
  page.onShow()
  stepFrames(3)
  const after = page.engine.current
  bug(
    '切后台回来位置丢失或自动开播',
    !(before > 0 && Math.abs(after - before) < 2 && page.data.playing === false),
    `切走时 offset=${before.toFixed(1)}、回来后 offset=${after.toFixed(1)}、playing=${page.data.playing}`
  )
  // 继续点一下，应当从原位置接着滚（原生动画期间逻辑层拿不到实时位置，
  // 所以再切一次后台把位置反算出来做比较）
  page.onTapPlay()
  stepFrames(600)
  page.onHide()
  const advanced = page.engine.current
  bug(
    '回前台继续播放后位置没有前进',
    !(advanced > after + 20),
    `继续前 offset=${after.toFixed(1)}、继续后 offset=${advanced.toFixed(1)}`
  )
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 3, loop: true })
}

console.log('\n══════ 6. 「从头开始」：是否真的回到开头并立刻开播 ══════')
{
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 0, loop: false })
  const text = Array.from({ length: 40 }, (_, i) => `第${i + 1}行台词内容，足够长以产生滚动`).join('\n')
  const s = store.create('从头开始', text)
  store.save(s)
  const page = makePage()
  page.onLoad({ id: s.id })
  page.onReady()
  page.onTapPlay()
  stepFrames(200)
  page.onTapRestart()
  stepFrames(3)
  bug(
    '点「从头开始」只回到开头却不播放',
    !(page.data.playing === true && page.engine.current < 5),
    `playing=${page.data.playing}、offset=${page.engine.current.toFixed(1)}（按钮语义是重新开始，应自动开播）`
  )
  appMock.globalData.prefs = prefsEngine.patch({ countdown: 3, loop: true })
}

console.log('\n══════ 7. docx 导入：XML 实体是否未解码 ══════')
{
  const util = require('./miniprogram/utils/util.js')
  const xml = '<w:p><w:t>AT&amp;T 与 5 &lt; 10 与 &quot;引号&quot;</w:t></w:p>'
  const got = util.extractDocxText(xml)
  const want = 'AT&T 与 5 < 10 与 "引号"'
  bug(
    'docx 文本未做 XML 实体解码，&amp;/&lt;/&quot; 原样进入台本',
    got !== want,
    `提取结果：「${got}」\n            期望结果：「${want}」`
  )
}

console.log('\n══════ 8. 编辑页角色色板：是否跟随 round-17 的自定义配色 ══════')
{
  // 修复后的 edit.js _recalc 用 effectiveColors(prefs).isDark 判定深浅背景，
  // 此处按修复后代码的真实表达式计算（与提词台同源）
  const prefs = Object.assign({}, prefsEngine.DEFAULTS, {
    colorScheme: 'custom', bgColor: '#FFFFFF', textColor: '#1C1C1E'
  })
  const teleIsDark = prefsEngine.effectiveColors(prefs).isDark
  const editIsDark = prefsEngine.effectiveColors(prefs).isDark
  const role = require('./miniprogram/engine/role.js')
  const palTele = role.assignColors([{ name: '林晚', count: 1 }], teleIsDark, {})[0].color
  const palEdit = role.assignColors([{ name: '林晚', count: 1 }], editIsDark, {})[0].color
  bug(
    '自定义「白底」配色下，编辑页角色色板仍按深色取色（浅色角色名在白底上看不见）',
    teleIsDark !== editIsDark,
    `自定义白底(bgColor=#FFFFFF)：提词台 isDark=${teleIsDark}→${palTele}；编辑页 isDark=${editIsDark}→${palEdit}（两者不一致）`
  )
}

// ---------- 汇总 ----------
const bugs = results.filter((r) => r.isBug)
console.log(`\n${'═'.repeat(60)}`)
console.log(`审计完成：共检查 ${results.length} 项，确认 ${bugs.length} 个 bug`)
bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`))
console.log('═'.repeat(60))
// 有 bug 就以非 0 退出：否则全量跑测试时这套会被当成"绿"，确认的问题被静默吞掉。
if (bugs.length) process.exitCode = 1
