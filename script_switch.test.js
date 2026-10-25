/**
 * 台本切换（菜单「上/下一个台本」）专项回归。
 * 覆盖：索引越界/未同步刷新(需求1)、边界禁用置灰(需求2)、切换后状态重置与保留(需求3)、
 * 异常场景——空列表/单台本/快速连点/数据未加载(需求4)、与其他入口一致(需求5)。
 * 伪时钟 + mock 微信运行时，范式同 bug_audit / _e2e_test。
 *
 * 顺序语义：切换严格按「集号递增」推进（第N集→第N+1集），由 _scriptOrder() = util.sortByEpisode(store.list()) 决定。
 * 所有"序列"均取自 page._scriptOrder()（集号排序），不再假设 store.list 的更新时间顺序。
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
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
  setPageOrientation: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  showModal: (opts) => { modalCalls++; if (opts && typeof opts.success === 'function') opts.success(MODAL_RESULT) },
  showToast: () => {},
  requirePrivacyAuthorize: (opts) => { if (opts && opts.success) opts.success() },
  getSetting: (opts) => { if (opts && opts.success) opts.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}
global.wx = wx

const prefsEngine = require('./miniprogram/engine/prefs.js')
const util = require('./miniprogram/utils/util.js')
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
  inst.setData = function (patch) { this._setDataCount++; if (patch && typeof patch === 'object') Object.assign(this.data, patch) }
  return inst
}

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}\n      ${detail || ''}`) }
}

// 创建台本并推进时间戳（仅保证 createdAt 互异，顺序由集号决定）
function mkScript(title, body) {
  T += 1000
  const s = store.create(title, body)
  store.save(s)
  return s
}

function resetStore() {
  for (const k of Object.keys(memStorage)) delete memStorage[k]
}

// 取「按集号排序」的序列（与菜单切换、角标同源）
function episodeOrder() {
  const probe = makePage()
  probe.onLoad({ id: store.list()[0].id })
  probe.onReady()
  return probe._scriptOrder()
}

console.log('\n══════ 1. 正常切换 + 角标/按钮态同步刷新（需求1，按集号递增）═══════')
{
  resetStore()
  mkScript('第1集', '甲：内容一')
  mkScript('第2集', '甲：内容二')
  mkScript('第3集', '甲：内容三')
  const order = episodeOrder()
  const first = order[0], mid = order[1], last = order[2]
  const page = makePage()
  page.onLoad({ id: first.id })
  page.onReady()
  check('进入首条(第1集) 角标=1/3', page.data.scriptPosText === '1 / 3', `got ${page.data.scriptPosText}`)
  check('首条 hasPrev=false 置灰', page.data.hasPrevScript === false)
  check('首条 hasNext=true 可点', page.data.hasNextScript === true)

  page.onTapNextScript()
  check('点下一个 → 第2集(集号+1)', page.scriptId === mid.id, `got ${page.scriptId}`)
  check('切到第2集 角标=2/3', page.data.scriptPosText === '2 / 3', `got ${page.data.scriptPosText}`)
  check('切到第2集 hasPrev/hasNext 均 true', page.data.hasPrevScript === true && page.data.hasNextScript === true)

  page.onTapPrevScript()
  check('点上一个 → 回到第1集', page.scriptId === first.id, `got ${page.scriptId}`)
  check('回首条 角标=1/3 且 hasPrev 重新置灰', page.data.scriptPosText === '1 / 3' && page.data.hasPrevScript === false)
}

console.log('\n══════ 2. 边界统一为禁用置灰（需求2，不循环）═══════')
{
  resetStore()
  mkScript('第1集', '甲：内容一')
  mkScript('第2集', '甲：内容二')
  mkScript('第3集', '甲：内容三')
  const order = episodeOrder()
  const first = order[0], last = order[order.length - 1]
  const page = makePage()
  page.onLoad({ id: last.id })
  page.onReady()
  check('末条(第3集) hasNext=false 置灰', page.data.hasNextScript === false)
  const before = page.scriptId
  page.onTapNextScript()
  check('末条点「下一个」不越界、不切换', page.scriptId === before, `竟切到 ${page.scriptId}`)

  const page2 = makePage()
  page2.onLoad({ id: first.id })
  page2.onReady()
  check('首条(第1集) hasPrev=false 置灰', page2.data.hasPrevScript === false)
  const before2 = page2.scriptId
  page2.onTapPrevScript()
  check('首条点「上一个」不越界、不切换', page2.scriptId === before2, `竟切到 ${page2.scriptId}`)
}

console.log('\n══════ 3. 切换后状态：明确重置/保留（需求3）═══════')
{
  resetStore()
  mkScript('第1集', '甲：内容一')
  mkScript('第2集', '甲：内容二')
  const order = episodeOrder()
  const page = makePage()
  page.onLoad({ id: order[0].id })
  page.onReady()
  stepFrames(200)
  page.engine.syncTo(50)
  page.setData({ finished: true, playing: true, resumePosition: 0.5 })
  const fontSizeBefore = page.data.fontSizePx

  page.onTapNextScript()
  check('切换后 playing=false', page.data.playing === false)
  check('切换后 finished=false', page.data.finished === false)
  check('切换后 progress=0', page.data.progress === 0, `got ${page.data.progress}`)
  check('切换后 progressText=0%', page.data.progressText === '0%', `got ${page.data.progressText}`)
  check('切换后 resumePosition=0', page.data.resumePosition === 0)
  check('切换后引擎 offset 归零', page.engine.current === 0, `got ${page.engine.current}`)
  check('切换后统计收集器已重置(未跑)', page.stats.running === false)
  check('切换后字号偏好保留(未回落默认)', page.data.fontSizePx === fontSizeBefore, `before ${fontSizeBefore}, after ${page.data.fontSizePx}`)
}

console.log('\n══════ 4. 异常场景：空列表 / 单台本 / 快速连点 / 当前台本被删（需求4）═══════')
{
  resetStore()
  console.log('--- 4a 仅一个台本 ---')
  const only = mkScript('唯一台本', '甲：内容')
  const page = makePage()
  page.onLoad({ id: only.id })
  page.onReady()
  check('单台本 hasPrev=false', page.data.hasPrevScript === false)
  check('单台本 hasNext=false', page.data.hasNextScript === false)
  const idBefore = page.scriptId
  page.onTapNextScript()
  page.onTapPrevScript()
  check('单台本点上下均不切换、不崩溃', page.scriptId === idBefore)

  console.log('--- 4b 列表为空（当前台本 id 不在任何列表）---')
  const page2 = makePage()
  page2.scriptId = 'no-such-id'
  page2.data.scriptPosText = ''
  page2.onTapNextScript()
  page2.onTapPrevScript()
  check('列表为空时点击不崩溃', true)

  console.log('--- 4c 当前台本在首页被删除（idx<0）后切换 ---')
  resetStore()
  mkScript('第1集', '甲：内容一')
  const mid = mkScript('第2集', '甲：内容二')
  mkScript('第3集', '甲：内容三')
  const order = episodeOrder()
  const first = order[0]
  const page3 = makePage()
  page3.onLoad({ id: mid.id })
  page3.onReady()
  store.remove(mid.id)
  check('删除后 _scriptOrder 已不含第2集', page3._scriptOrder().every((s) => s.id !== mid.id))
  page3.onTapNextScript()
  check('当前台本被删后点下一个 → 落到首条(第1集)', page3.scriptId === first.id, `got ${page3.scriptId}`)
  check('落到首条后 hasPrev 置灰', page3.data.hasPrevScript === false)
  page3.onTapPrevScript()
  check('首条点上一个越界保持', page3.scriptId === first.id)

  console.log('--- 4d 快速连续点击（重入锁 + 倒计时不叠加）---')
  resetStore()
  mkScript('第1集', '甲：内容一')
  mkScript('第2集', '甲：内容二')
  mkScript('第3集', '甲：内容三')
  const order4 = episodeOrder()
  const first4 = order4[0], last4 = order4[order4.length - 1]
  const page4 = makePage()
  page4.onLoad({ id: first4.id })
  page4.onReady()
  timers.length = 0
  rafCbs.length = 0
  const cdBefore = timers.filter((t) => t.interval === 1000).length
  for (let i = 0; i < 5; i++) page4.onTapNextScript()
  check('快速连点后在末条(第3集)停下，不绕回', page4.scriptId === last4.id, `got ${page4.scriptId}`)
  check('连点结束后 hasNext 置灰', page4.data.hasNextScript === false)
  check('连点结束后 _switching 已释放', page4._switching === false)
  const cdAfter = timers.filter((t) => t.interval === 1000).length
  check('倒计时定时器未泄漏（最终仅1个）', cdAfter === 1, `before=${cdBefore}, after=${cdAfter}`)
  check('连点后数据态一致：scriptPosText=N/M 末位', page4.data.scriptPosText === `${order4.length} / ${order4.length}`, `got ${page4.data.scriptPosText}`)
}

console.log('\n══════ 5. 与其他入口一致：切换顺序=角标顺序=集号排序，且纯函数可取邻集（需求5）═══════')
{
  resetStore()
  mkScript('第1集', '甲：内容一')
  mkScript('第2集', '甲：内容二')
  mkScript('第3集', '甲：内容三')
  const order = episodeOrder() // 集号排序：[第1集,第2集,第3集]
  const page = makePage()
  page.onLoad({ id: order[1].id }) // 从第2集进入
  page.onReady()
  check('切换序列 = 集号排序序列（第1→第2→第3）', page._scriptOrder().map((s) => s.id).join(',') === order.map((s) => s.id).join(','), page._scriptOrder().map((s) => s.id).join(','))
  check('切换序列与角标序列同源', page._scriptOrder().map((s) => s.id).join(',') === page._scriptOrder().map((s) => s.id).join(','))
  const idx = order.findIndex((s) => s.id === page.scriptId)
  check('当前台本在序列下标 = 角标 N-1', idx >= 0 && page.data.scriptPosText === `${idx + 1} / ${order.length}`, `pos=${page.data.scriptPosText}`)
  // 核心：给定当前第2集，纯函数返回下一集=第3集、上一集=第1集
  const next = util.getNextEpisodeScript(order, page.scriptId)
  check('getNextEpisodeScript(第2集) === 第3集', next && next.id === order[2].id, next && next.id)
  const prev = util.getPrevEpisodeScript(order, page.scriptId)
  check('getPrevEpisodeScript(第2集) === 第1集', prev && prev.id === order[0].id, prev && prev.id)
  const before = page.scriptId
  page.onTapNextScript()
  check('点下一个 = 集号+1（第3集）', page.scriptId === order[2].id, `got ${page.scriptId}`)
}

console.log('\n══════ 6. 主动切换不弹「继续上次进度」(fresh)，立即生效（需求3/4）═══════')
{
  resetStore()
  const a = mkScript('第1集', '甲：内容一')
  const b = mkScript('第2集', '甲：内容二')
  store.updatePosition(b.id, 0.5)
  modalCalls = 0
  const page = makePage()
  page.onLoad({ id: a.id })
  page.onReady()
  page.onTapNextScript()
  check('切到「有历史进度」的台本不弹续播询问', modalCalls === 0, `modalCalls=${modalCalls}`)
  check('切换后立即进入倒计时（showControls=false）', page.data.showControls === false)
  check('旧台本 A 的进度已落盘', store.getPosition(a.id) !== undefined)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
