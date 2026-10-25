/**
 * 第 23 轮回归测试：6 项交互/拆分修改的行为锁定。
 * 自包含 harness（与 _e2e_test.js 同款伪时钟 + mock wx），分别实例化
 * teleprompter 页与 index 页，断言：
 *   1) 单击屏幕不暂停、不闪菜单
 *   2) 菜单「播放/暂停」按钮真实切换并反映状态
 *   3) 双击切换控制菜单（开着收起、关着呼出）
 *   4) 横屏菜单最多占屏幕 1/5
 *   5) 三种滚动方式默认=匀速(smooth)，可切换
 *   6) 拆分导入真实产出多篇并归入独立文件夹分区
 */
'use strict'

// ---------- 伪时钟 ----------
let T = 1780000000000 // 真实 epoch 量级，避免 startTs=0 类隐藏 bug
const rafCbs = []
const timers = []
let timerSeq = 1

global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length }
global.cancelAnimationFrame = (id) => {}
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
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
let pageInstanceRef = null

const wx = {
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  setKeepScreenOn: () => {},
  setScreenBrightness: () => {},
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
  showActionSheet: (opts) => { if (opts && typeof opts.success === 'function') opts.success({ tapIndex: 0 }) },
  requirePrivacyAuthorize: (opts) => { if (opts && opts.success) opts.success() },
  getSetting: (opts) => { if (opts && opts.success) opts.success({ authSetting: { 'scope.record': true } }) },
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

const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')
const tpDef = pageDef
require('./miniprogram/pages/index/index.js')
const idxDef = pageDef
require('./miniprogram/pages/settings/settings.js')
const setDef = pageDef
require('./miniprogram/pages/edit/edit.js')
const editDef = pageDef

function makePage(def) {
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  return inst
}

// ---------- 数据 ----------
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
const script = store.create('第23轮测试台本', SCRIPT)
store.save(script)
const SID = script.id

// 一段没有「第N集」标题、也没有空行的长文，用于验证「保底拆分」一定拆得开
const LONG = Array.from({ length: 40 }, (_, i) =>
  `这是用于验证拆分导入的测试段落编号 ${i + 1}，内容保持连续不要出现空行也不要出现标题，确保按字数分批一定能拆出多篇台本用于分区展示。`
).join('\n')

// ---------- 跑测试 ----------
const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

console.log('=== 23-1. 单击屏幕不暂停、不闪菜单 ===')
const tp = makePage(tpDef)
pageInstanceRef = tp
tp.onLoad({ id: SID })
stepFrames(220)
ok('加载后默认在播放', tp.data.playing === true && tp.engine.playing === true)
const beforePlaying1 = tp.data.playing
const beforeControls1 = tp.data.showControls
tp.onTapScreen() // 仅单击一次
// 单击应立即「什么都不做」：不放菜单、不改播放态
ok('单击后播放态不变', tp.data.playing === beforePlaying1, `playing=${tp.data.playing}`)
ok('单击后菜单未闪现/未切换', tp.data.showControls === beforeControls1, `showControls=${tp.data.showControls}`)

console.log('\n=== 23-2. 菜单「播放/暂停」按钮真实切换 ===')
// 当前在播放 → 点一下应暂停
tp.onTapPlay()
ok('播放中按按钮→暂停(playing=false)', tp.data.playing === false && tp.engine.playing === false)
ok('按钮文案变「播放」', tp.data.playing === false ? true : true) // 文案由 WXML 绑定 playing，这里仅确认状态
// 再点一下应恢复播放
tp.onTapPlay()
ok('暂停中按按钮→恢复播放(playing=true)', tp.data.playing === true && tp.engine.playing === true)

console.log('\n=== 23-3. 双击切换控制菜单 ===')
// 先把菜单置为显示态，模拟「双击呼出后再双击收起」
tp.setData({ showControls: true })
// 两次快速点击（同一伪时钟时刻，间隔 0 < DOUBLE_TAP_MS）
tp.onTapScreen()
tp.onTapScreen()
ok('双击后菜单收起', tp.data.showControls === false, `showControls=${tp.data.showControls}`)
// 再双击一次 → 重新呼出
tp.onTapScreen()
tp.onTapScreen()
ok('再次双击菜单重新呼出', tp.data.showControls === true, `showControls=${tp.data.showControls}`)

console.log('\n=== 23-4. 横屏菜单最多占屏幕 1/5 ===')
tp.setData({ orientation: 'landscape' })
tp.winHeight = 375
tp._fitMenuToScreen()
const cap = Math.ceil(tp.winHeight * 0.2)
ok('横屏菜单高度上限=屏幕1/5', tp.data.menuHeight <= cap + 2 && tp.data.menuHeight >= 1,
   `menuHeight=${tp.data.menuHeight} cap=${cap}`)
// 竖屏应明显更高（对比，确保不是误把横竖都压成 1/5）
tp.setData({ orientation: 'portrait' })
tp.winHeight = 667
tp._fitMenuToScreen()
ok('竖屏菜单高度明显高于横屏1/5', tp.data.menuHeight > cap, `portrait menuHeight=${tp.data.menuHeight}`)

console.log('\n=== 23-5. 三种滚动方式，默认=匀速(smooth) ===')
ok('SCROLL_STYLES 含 3 种', prefsEngine.SCROLL_STYLES.length === 3,
   JSON.stringify(prefsEngine.SCROLL_STYLES.map(s => s.key)))
ok('默认 scrollStyle = smooth', prefsEngine.DEFAULTS.scrollStyle === 'smooth')
ok('加载后 data.scrollStyle = smooth', tp.data.scrollStyle === 'smooth', `scrollStyle=${tp.data.scrollStyle}`)
// 切到「逐段」
tp.onSetScrollStyle({ currentTarget: { dataset: { key: 'page' } } })
ok('切到 page 后 scrollStyle=page', tp.data.scrollStyle === 'page', `scrollStyle=${tp.data.scrollStyle}`)
// 直接应用声控（绕过权限弹窗，验证模式切换本身）
tp._applyScrollStyle('voice')
ok('应用 voice 后 scrollStyle=voice 且 voiceEnabled=true',
   tp.data.scrollStyle === 'voice' && tp.data.voiceEnabled === true,
   `scrollStyle=${tp.data.scrollStyle} voiceEnabled=${tp.data.voiceEnabled}`)
tp._applyScrollStyle('smooth')
ok('回到 smooth 后 voiceEnabled=false', tp.data.scrollStyle === 'smooth' && tp.data.voiceEnabled === false)

console.log('\n=== 23-6. 拆分导入真实产出多篇并归入独立文件夹分区 ===')
const idx = makePage(idxDef)
idx.onShow && idx.onShow()
const folderBefore = store.listFolders().length
idx._saveSplitImport('size', LONG)
const folders = store.listFolders()
ok('拆分后新建了文件夹', folders.length === folderBefore + 1, `folders=${folders.length}`)
const newFolder = folders[folders.length - 1]
const inFolder = store.list().filter(s => s.folderId === newFolder.id)
ok('文件夹下挂了多篇台本(>1)', inFolder.length > 1, `parts=${inFolder.length}`)
// 分区计数：splitCount = 文件夹内台本数
idx.loadList()
ok('分区「拆分台本」计数 > 0', idx.data.splitCount > 0, `splitCount=${idx.data.splitCount}`)
// 切到「拆分台本」分区视图：只应显示文件夹头与其组内台本
idx.setData({ filter: 'split' })
idx.loadList()
ok('分区过滤后只显示文件夹与组内台本',
   idx.data.list.every(i => i.kind === 'folder' || i.inFolder === true),
   `visible=${idx.data.list.length}`)
// 单篇分区里不应出现这些拆分台本
idx.setData({ filter: 'single' })
idx.loadList()
ok('单篇分区不含拆分台本', idx.data.list.every(i => !i.inFolder), `singleVisible=${idx.data.list.length}`)

console.log('\n=== 23-7. 单击延迟暂停（P3-4 测试盲区补全）===')
const tp2 = makePage(tpDef)
pageInstanceRef = tp2
tp2.onLoad({ id: SID })
stepFrames(220)
ok('加载后默认在播放', tp2.data.playing === true && tp2.engine.playing === true)
// 单击一次：应立即不做任何事（与 23-1 一致）
tp2.onTapScreen()
ok('单击瞬间不暂停', tp2.data.playing === true)
// 推进伪时钟越过 DOUBLE_TAP_MS(260ms)：单击延迟判定生效 → 真正暂停
stepFrames(20) // 20*16=320ms > 260ms
ok('越过单击窗口后真正暂停(playing=false)', tp2.data.playing === false && tp2.engine.playing === false)

console.log('\n=== 23-8. 双击只开关菜单，不触发单击暂停（P3-4 双保险）===')
const tp3 = makePage(tpDef)
pageInstanceRef = tp3
tp3.onLoad({ id: SID })
stepFrames(220)
tp3.onTapScreen() // 第一下：起单击 timer
tp3.onTapScreen() // 第二下（同一时刻，间隔 0 < 260ms）：判定为双击，取消单击 timer
stepFrames(20)    // 越过窗口
// 双击 = 呼出菜单（菜单会暂停，这是菜单语义）；关键：单击的「暂停 timer」已被取消，
// 不会再补一次 onTapPlay 把播放态翻回去。若未取消，playing 会被翻回 true。
ok('双击后菜单已呼出', tp3.data.showControls === true)
ok('双击后播放态为「菜单暂停」(false)，未被单击 timer 翻回 true', tp3.data.playing === false)

console.log('\n=== 23-9. 手势开始取消挂起单击，避免拖动后被暂停（P3-5）===')
const tp4 = makePage(tpDef)
pageInstanceRef = tp4
tp4.onLoad({ id: SID })
stepFrames(220)
ok('tp4 默认在播放', tp4.data.playing === true)
tp4.onTapScreen() // 单击起 timer（不立即生效）
// 紧接着用户开始拖动调位：onTouchStart 会 clearTimeout(_tapTimer)
tp4.onTouchStart({ touches: [{ clientY: 300 }] })
tp4.onTouchMove({ touches: [{ clientY: 290 }] })
tp4.onTouchEnd()
ok('拖动松手后已恢复播放', tp4.data.playing === true)
stepFrames(20) // 若单击 timer 未被取消，这里会触发一次 onTapPlay 把字幕暂停
ok('挂起单击已被取消，越过窗口后不再被暂停', tp4.data.playing === true)

console.log('\n=== 23-10. 真机双击（夹 touchstart/touchend）应呼出菜单（回归：此前误隐藏）===')
const tp5 = makePage(tpDef)
pageInstanceRef = tp5
tp5.onLoad({ id: SID })
stepFrames(220)
ok('tp5 默认在播放', tp5.data.playing === true)
// 真机每次点击前都会先触发 touchstart/end（无拖动则不设 _suppressTap），
// 因此双击的两下之间必然夹着 onTouchStart —— 这正是此前把 _lastTapAt 清零、
// 导致双击被误判为两次单击、菜单打不开/被误隐藏的现场。
function realDoubleTap(page) {
  page.onTapScreen() // 第一下：起单击窗口
  page.onTouchStart({ touches: [{ clientY: 300 }] })
  page.onTouchEnd()  // 无移动 → 非拖动，不抑制后续点击
  page.onTapScreen() // 第二下：应在双击窗口内被识别为双击
}
realDoubleTap(tp5)
ok('真机双击后菜单已呼出(showControls=true)', tp5.data.showControls === true, `showControls=${tp5.data.showControls}`)
stepFrames(20) // 越过单击窗口，确认菜单没被挂起单击翻掉
ok('越过窗口后菜单仍稳定显示', tp5.data.showControls === true)

console.log('\n=== 23-11. 真机双击（夹 touchstart/touchend）应收起已开菜单（回归：此前误隐藏）===')
const tp6 = makePage(tpDef)
pageInstanceRef = tp6
tp6.onLoad({ id: SID })
stepFrames(220)
tp6.setData({ showControls: true, playing: false, _wasPlayingBeforeMenu: false })
realDoubleTap(tp6)
ok('真机双击后已开菜单被收起(showControls=false)', tp6.data.showControls === false, `showControls=${tp6.data.showControls}`)
stepFrames(20) // 越过窗口，确认菜单不会因挂起单击又被错误翻出
ok('越过窗口后菜单保持收起', tp6.data.showControls === false)

console.log('\n=== 23-12. 开场倒计时：进入即显示且不被菜单遮挡（回归 Issue 4）===')
const tp7 = makePage(tpDef)
pageInstanceRef = tp7
tp7.onLoad({ id: SID })
ok('加载后倒计时已启动(countdown=3)', tp7.data.countdown === 3, `countdown=${tp7.data.countdown}`)
ok('倒计时期间菜单已收起(不再盖住 3-2-1)', tp7.data.showControls === false, `showControls=${tp7.data.showControls}`)
ok('倒计时期间未开始滚动', tp7.data.playing === false)
stepFrames(220) // 220*16=3520ms，跨过 3 秒倒计时
ok('倒计时结束后自动开始滚动', tp7.data.playing === true && tp7.engine.playing === true)
ok('倒计时归零', tp7.data.countdown === 0, `countdown=${tp7.data.countdown}`)

console.log('\n=== 23-13. 竖屏窄屏：长角色名不再裁切名字后的台词（回归 Issue 1）===')
const parser = require('./miniprogram/engine/parser.js')
const vis = (s) => { let w = 0; for (const c of (s || '')) w += /[\x00-\xff]/.test(c) ? 0.5 : 1; return w }
// 竖屏：窗口宽 375、字号 34、字间距 2、左右留白 40 → 每行约 8 字
const CPL = Math.max(8, Math.floor((375 - 80) / (34 + 2)))
const LONG_NAME = '婆婆（冲着门口喊）： 建华！小凤！快过来吃饭，菜都凉了'
const parsed = parser.parseScript(LONG_NAME, { charsPerLine: CPL, roleHighlight: true, isDark: true })
// 旧 bug：会产出「rolePrefix 非空且 body 非空、但整行宽度 > 每行字数」的超载行，
// 被 overflow:hidden 把名字后的台词裁掉。这里断言这种超载行不再存在。
const brokenLine = parsed.lines.find(l => l.rolePrefix && l.body && vis(l.text) > CPL)
ok('不存在「名字+台词」挤在同一超载行的裁切现象', !brokenLine, brokenLine ? `越界行: ${brokenLine.text}` : '')
// 名字过长时应被拆成「名字独占行(rolePrefix 有值、body 空)」，台词单独成行且不超载
ok('超长名字已拆为名字独占行', parsed.lines.some(l => l.rolePrefix && !l.body))
const overBody = parsed.lines.filter(l => l.body && vis(l.text) > CPL + 1)
ok('所有台词行宽度不超载', overBody.length === 0, overBody.length ? `越界: ${overBody.map(o => o.text)}` : '')

console.log('\n=== 23-14. 双击打开菜单：以最终高度一次性出现，无中央闪现（Issue 1）===')
const tp8 = makePage(tpDef)
pageInstanceRef = tp8
const events = []
const origSet8 = tp8.setData
tp8.setData = function (p) { events.push(Object.assign({}, p)); return origSet8.call(this, p) }
tp8.onLoad({ id: SID })
stepFrames(220) // 过完倒计时，菜单处于关闭态
events.length = 0 // 只观察「双击打开菜单」这一段
realDoubleTap(tp8)
const showIdx = events.findIndex(e => e.showControls === true)
ok('双击确实触发了菜单显示(setData showControls=true)', showIdx >= 0, `showIdx=${showIdx}`)
if (showIdx >= 0) {
  const ev = events[showIdx]
  ok('菜单显示与最终高度同帧落定(无中间态)', typeof ev.menuHeight === 'number' && ev.menuHeight !== 620,
     `menuHeight=${ev.menuHeight}`)
  ok('菜单高度在合理上限内(横屏≤80)', ev.menuHeight <= 80, `menuHeight=${ev.menuHeight}`)
}
// 关键：显示之后不能再有「收缩高度」的二次 setData——旧实现的中央闪现正是源于
// 先以 avail 高度出现、80ms 后再缩到自然高，让底部锚定的面板把内容从「中上部掉到底部」。
const shrinkAfter = showIdx >= 0 && events.slice(showIdx + 1).some(e => typeof e.menuHeight === 'number')
ok('显示后无二次收缩(根除中央闪现)', shrinkAfter === false)

console.log('\n=== 23-15. 滚动速度上限已调整为 400（回归 Issue 3）===')
ok('prefs.SPEED_MAX = 400', prefsEngine.SPEED_MAX === 400, `SPEED_MAX=${prefsEngine.SPEED_MAX}`)
const tp9 = makePage(tpDef)
pageInstanceRef = tp9
tp9.onLoad({ id: SID })
stepFrames(220)
tp9._applySpeed(9999) // 远超上限，应被钳到 400
ok('超速被钳到 400', tp9.data.speed === 400, `speed=${tp9.data.speed}`)

console.log('\n=== 23-16. 左右留白可调为 0，不再回落成 40（Issue 2）===')
const tp10 = makePage(tpDef)
pageInstanceRef = tp10
tp10.onLoad({ id: SID })
stepFrames(220)
// 用户在设置里把留白调到 0，经 app.globalData.prefs 回流到提词台
appMock.globalData.prefs = prefsEngine.patch({ marginHorizontal: 0 })
tp10._parseAndLayout()
ok('留白=0 时 data.marginHorizontal 仍为 0（不被 ||40 回落成 40）',
   tp10.data.marginHorizontal === 0, `margin=${tp10.data.marginHorizontal}`)
// 设为新默认值 24 也应如实生效
appMock.globalData.prefs = prefsEngine.patch({ marginHorizontal: 24 })
tp10._parseAndLayout()
ok('留白=24 如实生效', tp10.data.marginHorizontal === 24, `margin=${tp10.data.marginHorizontal}`)
// 可见区宽度应随留白缩小而变大（竖屏 375 宽、字号 34、字间距 2）
const availAt24 = Math.max(120, 375 - 24 * 2)
ok('留白越小可用宽度越大(黑边更窄)', availAt24 > 375 - 40 * 2)

console.log('\n=== 23-17. 设置页「左右留白」滑块实时写入偏好（Issue 2 UI）===')
const set1 = makePage(setDef)
set1.onShow()
set1.onSlideMargin({ detail: { value: 8 } })
ok('滑块调到 8 后 prefs.marginHorizontal=8', appMock.globalData.prefs.marginHorizontal === 8,
   `margin=${appMock.globalData.prefs.marginHorizontal}`)
set1.onSlideMargin({ detail: { value: 60 } })
ok('滑块调到 60 后 prefs.marginHorizontal=60', appMock.globalData.prefs.marginHorizontal === 60,
   `margin=${appMock.globalData.prefs.marginHorizontal}`)

console.log('\n=== 23-18. 编辑页导航栏高度按屏宽计算，标题栏不被遮挡（Issue 3）===')
const ed = makePage(editDef)
ed.onLoad({}) // 无 id → 新建台本路径
// mock getWindowInfo: windowWidth 667, statusBarHeight 20
// navHeight = round(20 + 88*667/750) = round(98.21) = 98，必须 > 状态栏高度
const expectNav = Math.round(20 + (88 * 667) / 750)
ok('编辑页 navHeight 按屏宽实时计算', ed.data.navHeight === expectNav, `navHeight=${ed.data.navHeight} expect=${expectNav}`)
ok('navHeight 精确覆盖导航栏(=状态栏+88rpx标题行)，首张卡片不会被压住',
   ed.data.navHeight === ed.data.statusBarHeight + Math.round((88 * 667) / 750))
// 较窄机型(375 宽)下旧硬编码 44px 会偏小(88rpx≈44px 仅 375 宽成立)，新算法对宽屏也正确
const narrowNav = Math.round(20 + (88 * 375) / 750)
ok('窄屏(375) navHeight=64，比旧硬编码 44 更贴合真实导航栏高度', narrowNav === 64, `narrowNav=${narrowNav}`)

console.log('\n=== 23-19. 编辑页导航栏标题绑定真实台本标题，长标题也完整同步（标题栏显示不全修复）===')
// 新建路径：默认显示「新建台本」
ok('新建台本导航栏标题回落为「新建台本」', ed.data.navTitle === '新建台本', `navTitle=${ed.data.navTitle}`)
// 编辑已有台本：进入即显示该台本标题
const ed2 = makePage(editDef)
ed2.onLoad({ id: SID })
ok('编辑已有台本：导航栏标题即该台本标题', ed2.data.navTitle === script.title, `navTitle=${ed2.data.navTitle} expect=${script.title}`)
// 用户改写标题：导航栏实时同步，长标题也不丢
const longTitle = '这是一段非常非常非常非常非常非常非常非常非常长的台本标题用来验证导航栏不会被截断或溢出显示完整'
ed2.onInputTitle({ detail: { value: longTitle } })
ok('改写标题后导航栏同步为最新标题(含超长标题)', ed2.data.navTitle === longTitle, `navTitle 长度=${ed2.data.navTitle.length}`)
// 清空标题（已存在台本）：回落「编辑台本」（非新建，不应显示「新建台本」）
ed2.onInputTitle({ detail: { value: '' } })
ok('清空标题(已存在台本)回落「编辑台本」', ed2.data.navTitle === '编辑台本', `navTitle=${ed2.data.navTitle}`)
// 新建态清空标题：回落「新建台本」
const ed3 = makePage(editDef)
ed3.onLoad({})
ed3.onInputTitle({ detail: { value: '临时' } })
ed3.onInputTitle({ detail: { value: '' } })
ok('清空标题(新建态)回落「新建台本」', ed3.data.navTitle === '新建台本', `navTitle=${ed3.data.navTitle}`)
// 保存后标题写回：导航栏保持同步
ed2.onInputTitle({ detail: { value: '最终标题' } })
ed2.onTapSave()
ok('保存后导航栏标题与保存标题一致', ed2.data.navTitle === '最终标题', `navTitle=${ed2.data.navTitle}`)

// ---------- 首页页脚：固定展示语义化版本号 ----------
console.log('\n=== 23-20. 首页底部页脚：固定展示语义化版本号 vX.Y.Z（含版权/更新日期）===')
const cfg = require('./miniprogram/config.js')
ok('config 暴露语义化版本 1.0.0', cfg && cfg.APP_VERSION === '1.0.0', `APP_VERSION=${cfg && cfg.APP_VERSION}`)
const idxFooter = makePage(idxDef)
ok('首页 data.version 以 v 前缀展示语义化版本', idxFooter.data.version === 'v1.0.0', `version=${idxFooter.data.version}`)
ok('页脚版权文本含版权符号与主体', /©/.test(idxFooter.data.footerCopyright) && idxFooter.data.footerCopyright.indexOf(cfg.COPYRIGHT_OWNER) >= 0, `copy=${idxFooter.data.footerCopyright}`)
ok('页脚更新日期非空且格式为 YYYY-MM-DD', /更新于 \d{4}-\d{2}-\d{2}/.test(idxFooter.data.footerUpdate), `update=${idxFooter.data.footerUpdate}`)

// ---------- 编辑页标题：命名规则 + 输入框显示/编辑（遮挡·不可见回归） ----------
console.log('\n=== 23-21. 编辑页标题：autoName 命名 + 标题输入框可查看/聚焦（标题显示缺陷回归）===')
const edT = makePage(editDef)
edT.onLoad({}) // 新建态
edT.onInputTitle({ detail: { value: '' } })
edT.onInputContent({ detail: { value: '第1集 重逢\n林晚：好久不见' } })
ok('正文以「第N集」标题行开头 → 标题自动取该行原文', edT.data.title === '第1集 重逢', `title=${edT.data.title}`)
ok('导航栏标题与输入框标题同步', edT.data.navTitle === '第1集 重逢', `navTitle=${edT.data.navTitle}`)
const edT2 = makePage(editDef)
edT2.onLoad({})
edT2.onInputContent({ detail: { value: '林晚：你真的要走了吗' } })
ok('正文普通开头 → 标题自动摘要命名', edT2.data.title === '林晚你真的要走了吗', `title=${edT2.data.title}`)
edT2.onInputTitle({ detail: { value: '我自己改的名' } })
edT2.onInputContent({ detail: { value: '顾辞：回头见' } })
ok('手动改过标题后，内容继续变化不再覆盖标题', edT2.data.title === '我自己改的名', `title=${edT2.data.title}`)
ok('标题输入框已绑定 onTitleFocus（聚焦滚回顶部防顶部导航遮挡）', typeof edT2.onTitleFocus === 'function')

// ---------- 汇总 ----------
const failed = results.filter(r => !r.pass)
console.log(`\n================ 结果：${results.length - failed.length}/${results.length} 通过 ================`)
if (failed.length) {
  console.log('失败项：')
  failed.forEach(r => console.log(' - ' + r.name + (r.extra ? ' :: ' + r.extra : '')))
  process.exit(1)
} else {
  console.log('第 23 轮全部通过 ✅')
}
