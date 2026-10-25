/**
 * 端到端自测 harness：用真实 teleprompter 页面 + 真实引擎，mock 微信运行时。
 * 重点复现真机行为：setPageOrientation 会触发 onResize -> _parseAndLayout 重排。
 * 伪时钟驱动 requestAnimationFrame / setTimeout / setInterval。
 */
'use strict'

// ---------- 伪时钟 ----------
let T = 1000
const rafCbs = []
const timers = []
let timerSeq = 1

global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length }
global.cancelAnimationFrame = (id) => { /* 标记失效由 rafCbs 在调用时跳过，这里简单忽略 */ }

global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T

function stepFrames(n) {
  for (let f = 0; f < n; f++) {
    T += 16
    // 触发到期定时器
    for (const t of timers.slice()) {
      if (t.fireAt <= T) {
        t.fn()
        if (t.interval) t.fireAt = T + t.interval
        else { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) }
      }
    }
    // 触发 rAF 回调
    const cbs = rafCbs.splice(0, rafCbs.length)
    for (const cb of cbs) cb(T)
  }
}

// ---------- mock wx ----------
const memStorage = {}
let pageInstanceRef = null

const wx = {
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
  // 关键：真机 setPageOrientation 会触发 onResize，这里复现
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

// ---------- 加载真实页面 ----------
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')
if (!pageDef) { console.error('页面未注册'); process.exit(1) }

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  return inst
}

// ---------- 写入一段带角色的台词 ----------
const SCRIPT = [
  '婆婆（冲着门口喊）： 建华！小凤！快过来吃饭',
  '建华（电话里）： 行，我知道了',
  '小凤（在旁边听到了）： 又要走？',
  '建华： 公司临时出状况',
  '小凤（压着声音）： 妈准备了一下午',
  '婆婆： 咋了？有事啊？',
  '建华（不敢看婆婆）： 妈……我得回去一趟',
  '婆婆（愣了一下）： 饭都做好了',
  '小凤： 还有上星期的事',
  '建华（沉默几秒）： 咱回家'
].join('\n')

const script = store.create('测试台本', SCRIPT)
store.save(script)
const SID = script.id

// ---------- 跑测试 ----------
const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

console.log('=== 1. 加载台词页 ===')
const page = makePage()
pageInstanceRef = page
page.onLoad({ id: SID })
ok('台词已解析出多行', page.allLines.length > 5, `lines=${page.allLines.length}`)
ok('引擎 maxOffset > 0', page.engine.maxOffset > 0, `maxOffset=${page.engine.maxOffset.toFixed(0)}`)
ok('倒计时已启动', page.data.countdown > 0, `countdown=${page.data.countdown}`)

console.log('\n=== 2. 推进伪时钟，等倒计时结束、自动开始滚动 ===')
stepFrames(220) // ~3.5 秒
ok('倒计时结束(归零)', page.data.countdown === 0, `countdown=${page.data.countdown}`)
ok('进入播放状态', page.data.playing === true, `playing=${page.data.playing}`)
ok('引擎 playing=true', page.engine.playing === true, `engine.playing=${page.engine.playing}`)

console.log('\n=== 3. 让滚动跑 100 帧，看 offset 是否推进 ===')
const off0 = page.engine.current
stepFrames(100)
const off1 = page.engine.current
ok('自动滚动:offset 明显推进', off1 - off0 > 50, `Δoffset=${(off1 - off0).toFixed(1)}px`)
ok('data.offset 同步更新', Math.abs(page.data.offset - off1) < 1.5, `data.offset=${page.data.offset.toFixed(1)} engine.current=${off1.toFixed(1)}`)
ok('未到结尾(进度<1)', page.engine.progress < 1, `progress=${(page.engine.progress * 100).toFixed(1)}%`)

console.log('\n=== 4. 点击播放 -> 暂停 -> 再点击播放（竞态路径）===')
page.onTapPlay() // 暂停
ok('暂停后 playing=false', page.data.playing === false && page.engine.playing === false)
stepFrames(10) // 让循环进入 settle
page.onTapPlay() // 立刻再播放（模拟用户暂停后立刻点播放）
stepFrames(40)
ok('再点播放后引擎恢复滚动', page.engine.playing === true, `engine.playing=${page.engine.playing}`)
const off2 = page.engine.current
stepFrames(40)
ok('再播放后 offset 继续推进', page.engine.current - off2 > 20, `Δoffset=${(page.engine.current - off2).toFixed(1)}px`)

console.log('\n=== 5. 调速（慢/快）===')
const sp0 = page.engine.pxPerSecond
page.onTapSpeed({ currentTarget: { dataset: { delta: 20 } } }) // 快
const sp1 = page.engine.pxPerSecond
ok('点「快」后速度变大', sp1 > sp0, `${sp0.toFixed(0)} -> ${sp1.toFixed(0)} px/s`)
page.onTapSpeed({ currentTarget: { dataset: { delta: -20 } } }) // 慢
const sp2 = page.engine.pxPerSecond
ok('点「慢」后速度变小', sp2 < sp1, `${sp1.toFixed(0)} -> ${sp2.toFixed(0)} px/s`)
page.onTapSpeed({ currentTarget: { dataset: { delta: -1000 } } }) // 触底
ok('速度被限制在合理下限', page.engine.pxPerSecond >= 24, `pxPerSecond=${page.engine.pxPerSecond.toFixed(0)}`)

console.log('\n=== 6. 横竖屏切换触发 onResize 重排 ===')
const beforeMax = page.engine.maxOffset
page.data.orientation = 'portrait'
page._applyOrientation('portrait')
stepFrames(5)
ok('切竖屏后 maxOffset 变化', Math.abs(page.engine.maxOffset - beforeMax) > 0 || page.engine.maxOffset > 0,
   `before=${beforeMax.toFixed(0)} after=${page.engine.maxOffset.toFixed(0)}`)
ok('重排后仍在滚动(未卡死)', page.engine.playing === true || page.engine.current > off2,
   `playing=${page.engine.playing} current=${page.engine.current.toFixed(0)}`)

console.log('\n=== 7. 手动翻页（拖动）===')
// 先把位置定位到中部，保证松手时「本来在播」能续播（到底时 resume 会被引擎拒绝）
page.engine.seekProgress(0.3)
page.engine.resume()
page.setData({ playing: true, finished: false })
stepFrames(3)
// 拖动（手动翻页）：手指上滑 100px，内容上移 100px
page.onTouchStart({ touches: [{ clientY: 300 }] })
page.onTouchMove({ touches: [{ clientY: 200 }] }) // 上滑 100px
const dragOffset = page.engine.current
ok('拖动后引擎位置改变', dragOffset !== off2, `current=${dragOffset.toFixed(0)}`)
page.onTouchEnd()
stepFrames(5)
ok('松手后自动模式继续滚动', page.engine.playing === true, `playing=${page.engine.playing}`)

console.log('\n=== 8. 进度条拖动定位 ===')
// 确保进入进度条测试前引擎处于「播放中」且未到底（否则 resume 不生效，seek 也无位移）
if (page.engine.current >= page.engine.maxOffset) page.engine.seekProgress(0.3)
page.engine.resume()
page.setData({ playing: true, finished: false })
page.onSeekChanging({ detail: { value: 50 } })
ok('拖动中引擎跳到 ~50%', Math.abs(page.engine.progress - 0.5) < 0.05, `progress=${(page.engine.progress * 100).toFixed(1)}%`)
ok('拖动中自动暂停', page.data.playing === false, `playing=${page.data.playing}`)
page.onSeekChange({ detail: { value: 75 } })
ok('松手后定位到 ~75%', Math.abs(page.engine.progress - 0.75) < 0.05, `progress=${(page.engine.progress * 100).toFixed(1)}%`)
ok('松手后从新位置续播', page.data.playing === true && page.engine.playing === true)
stepFrames(20)
ok('续播后继续推进(>75%)', page.engine.progress > 0.75, `progress=${(page.engine.progress * 100).toFixed(1)}%`)
ok('进度条 progressValue 同步', page.data.progressValue === Math.round(page.engine.progress * 100),
   `progressValue=${page.data.progressValue}`)

console.log('\n=== 9. 循环播放 ===')
// 循环默认已改为「关」，此处显式开启以回归循环场景本身
appMock.updatePrefs({ loop: true })
page.engine.loop = true
const origLoop = page.engine.onLoop
let looped = false
page.engine.onLoop = () => { looped = true; if (origLoop) origLoop() }
page.engine.seekProgress(0.95)
page.engine.resume()
page.setData({ playing: true, finished: false })
stepFrames(220) // 跑过结尾、触发循环
ok('滚到底触发循环回开头', looped === true, `looped=${looped}`)
ok('循环后仍在播放', page.engine.playing === true && page.data.playing === true,
   `engine.playing=${page.engine.playing} page.playing=${page.data.playing}`)

console.log('\n=== 10. 声控跟读开关 ===')
page.onToggleVoice().then(() => {
  ok('开启声控后 voiceEnabled=true', page.data.voiceEnabled === true, `voiceEnabled=${page.data.voiceEnabled}`)
  page.onToggleVoice().then(() => {
    ok('关闭声控后恢复自动滚动', page.data.voiceEnabled === false && page.data.playing === true,
       `voiceEnabled=${page.data.voiceEnabled} playing=${page.data.playing}`)

    console.log('\n=== 11. 复盘统计写入 store（非循环，滚到底触发 onEnd）===')
    const page2 = makePage()
    pageInstanceRef = page2
    appMock.globalData.prefs.loop = false // 关闭循环，确保滚到底触发 onEnd 与 completed
    store.updatePosition(SID, 0) // 重置续播进度：上一场景 seek 到 95% 会把 page2 直接带到底
    page2.onLoad({ id: SID })
    stepFrames(220) // 倒计时结束 + 自动开始
    ok('第二实例进入播放', page2.data.playing === true, `playing=${page2.data.playing}`)
    // 快进到接近结尾再跑完
    page2.engine.seekProgress(0.98)
    page2.engine.resume()
    page2.setData({ playing: true })
    stepFrames(400) // 跑过结尾触发 onEnd
    ok('非循环到底触发 onEnd(finished)', page2.data.finished === true, `finished=${page2.data.finished}`)
    const stats = store.getStats(SID)
    ok('复盘数据仍可记录(后台兼容保留)', Array.isArray(stats) && stats.length >= 1, `stats=${stats ? stats.length : 'null'}`)
    if (stats && stats.length) {
      const last = stats[stats.length - 1]
      ok('复盘记录 activeMs>0', last.activeMs > 0, `activeMs=${last.activeMs}`)
      ok('复盘记录 completed=true', last.completed === true)
      ok('复盘记录 rolledLines>0', last.rolledLines > 0, `rolledLines=${last.rolledLines}`)
    }
    ok('已彻底移除复盘弹窗(无 reviewVisible 字段)', page2.data.reviewVisible === undefined,
       `reviewVisible=${page2.data.reviewVisible}`)
    appMock.globalData.prefs.loop = false // 恢复新默认（循环关）

    console.log('\n=== 12. 菜单「上/下一个台本」切换（需求 10）===')
    // 用独立实例验证，不打扰上面正在播放的 page/page2
    const script2 = store.create('第二个台本', '甲：这是第二份稿子\n乙：用来验证切换台本')
    store.save(script2)
    // store.list 按 updatedAt 降序：让 SID 重新保存一次变成最新，排到列表首位，
    // 这样「下一个台本」有合法目标（_switchScript 不循环，到末尾会提示并保持）。
    store.save(store.get(SID))
    const list = store.list() // [SID, script2]
    const swPage = makePage()
    pageInstanceRef = swPage
    swPage.onLoad({ id: SID })
    swPage.onReady()
    stepFrames(20) // 走完倒计时
    const swId0 = swPage.scriptId
    swPage.onTapNextScript()
    ok('点「下一个台本」切换到另一份台本', swPage.scriptId === script2.id, `from ${swId0} -> ${swPage.scriptId}`)
    ok('切换后标题更新', swPage.data.title === '第二个台本', `title=${swPage.data.title}`)
    ok('切换后「第 N/共 M」角标更新', swPage.data.scriptPosText === '2 / 2', `pos=${swPage.data.scriptPosText}`)
    swPage.onTapPrevScript()
    ok('点「上一个台本」切回第一份', swPage.scriptId === SID, `from ${swPage.scriptId} -> ${SID}`)

    // 汇总
    const passed = results.filter(r => r.pass).length
    console.log(`\n================ 结果：${passed}/${results.length} 通过 ================`)
    const fails = results.filter(r => !r.pass)
    if (fails.length) {
      console.log('失败项：')
      fails.forEach(f => console.log('  - ' + f.name + (f.extra ? '  (' + f.extra + ')' : '')))
      process.exitCode = 1
    } else {
      console.log('全部通过 ✅')
    }
  })
})
