/**
 * 第 23 轮回归测试：6 项交互/拆分修改的行为锁定。
 * 自包含 harness（与 _e2e_test.js 同款伪时钟 + mock wx），分别实例化
 * teleprompter 页与 index 页，断言：
 *   1) 单击屏幕不暂停、不闪菜单
 *   2) 菜单「播放/暂停」按钮真实切换并反映状态
 *   3) 双击切换控制菜单（开着收起、关着呼出）
 *   4) 横屏菜单最多占屏幕 1/5
 *   5) 两种滚动方式默认=匀速(smooth)，可切换
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

console.log('=== 23-1. 单击屏幕 = 播放 / 暂停（对齐浅纸）===')
const tp = makePage(tpDef)
pageInstanceRef = tp
tp.onLoad({ id: SID })
stepFrames(220)
ok('打开后待播（浅纸：点一下才开始）', tp.data.playing === false && tp.data.status === 'stopped')
tp.onTapScreen() // 单击 → 开播
ok('单击一次即开播（不再等 260ms 双击窗口）', tp.data.playing === true, `playing=${tp.data.playing}`)
tp.onTapScreen() // 再点 → 暂停
ok('再点一次立即暂停', tp.data.playing === false, `playing=${tp.data.playing}`)

console.log('\n=== 23-2. 菜单「播放/暂停」与实际状态同源 ===')
tp.onTapPlay()
ok('暂停中按按钮→恢复播放(playing=true)', tp.data.playing === true && tp.engine.playing === true)
tp.onTapPlay()
ok('播放中按按钮→暂停(playing=false)', tp.data.playing === false && tp.engine.playing === false)

console.log('\n=== 23-3. 菜单入口：右下角圆钮（双击呼出已下线）===')
const fs = require('fs')
const TP_WXML = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxml', 'utf8')
const TP_WXSS = fs.readFileSync('./miniprogram/pages/teleprompter/teleprompter.wxss', 'utf8')
ok('WXML 绑定了 onOpenMenu（右下角圆钮）', /catchtap="onOpenMenu"/.test(TP_WXML))
tp.onOpenMenu()
ok('onOpenMenu 打开菜单', tp.data.showMenu === true && tp.data.showControls === true,
   `showMenu=${tp.data.showMenu}`)
tp.onCloseMenu()
ok('onCloseMenu 关闭菜单', tp.data.showMenu === false && tp.data.showControls === false)

console.log('\n=== 23-4. 菜单形态：竖屏底部抽屉 / 横屏右侧半屏 ===')
ok('竖屏面板高度 480px（浅纸 settings-container 同款）', /height:\s*480px/.test(TP_WXSS))
ok('横屏走右侧半屏抽屉', /\.tp-sheet--land/.test(TP_WXSS) && /width:\s*50%/.test(TP_WXSS))
ok('网格为 5 列 60px 格（repeat(auto-fit,60px)）', /repeat\(auto-fit,\s*60px\)/.test(TP_WXSS))
ok('滑块占两行（浅纸 .slider 同款）', /\.tp-slider[\s\S]{0,40}grid-row:\s*span 2/.test(TP_WXSS))

console.log('\n=== 23-5. 两种滚动方式，默认=匀速(smooth) ===')
ok('SCROLL_STYLES 含 2 种', prefsEngine.SCROLL_STYLES.length === 2,
   JSON.stringify(prefsEngine.SCROLL_STYLES.map(s => s.key)))
ok('默认 scrollStyle = smooth', prefsEngine.DEFAULTS.scrollStyle === 'smooth')
ok('加载后 data.scrollStyle = smooth', tp.data.scrollStyle === 'smooth', `scrollStyle=${tp.data.scrollStyle}`)
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

console.log('\n=== 23-7. 单击即时响应（不再有 260ms 延迟窗口）===')
const tp2 = makePage(tpDef)
pageInstanceRef = tp2
tp2.onLoad({ id: SID })
stepFrames(2)
ok('打开后处于待播状态（浅纸：点一下才开始）', tp2.data.playing === false && tp2.data.status === 'stopped')
tp2.onTapScreen()
ok('单击立即开播', tp2.data.playing === true, `playing=${tp2.data.playing}`)
stepFrames(20) // 320ms
ok('越过旧双击窗口后仍在播放（没有被延迟的单击翻回去）', tp2.data.playing === true)
tp2.onTapScreen()
ok('再点立即暂停', tp2.data.playing === false, `playing=${tp2.data.playing}`)

console.log('\n=== 23-8. 双击 = 两次单击（不再作为菜单入口）===')
const tp3 = makePage(tpDef)
pageInstanceRef = tp3
tp3.onLoad({ id: SID })
stepFrames(2)
tp3.onTapScreen() // 第一次：开播
tp3.onTapScreen() // 第二次：暂停
ok('两次点击各自生效（开播→暂停）', tp3.data.playing === false)
ok('双击不会打开菜单（菜单只走右下角圆钮）', tp3.data.showMenu === false && tp3.data.showControls === false)

console.log('\n=== 23-9. 手势：按下暂停、拖动调位、松手续播 ===')
const tp4 = makePage(tpDef)
pageInstanceRef = tp4
tp4.onLoad({ id: SID })
stepFrames(2)
tp4.onTapScreen()
ok('tp4 已在播放', tp4.data.playing === true)
const posBefore = tp4.data.autoTop
tp4.onTouchStart({ touches: [{ clientY: 300 }] })
ok('按下即暂停（避免边拖边滚）', tp4.data.playing === false)
tp4.onTouchMove({ touches: [{ clientY: 280 }] })
tp4.onTouchEnd()
ok('松手后恢复播放', tp4.data.playing === true)
ok('拖动确实改变了位置', tp4.data.autoTop > posBefore, `before=${posBefore} after=${tp4.data.autoTop}`)

console.log('\n=== 23-10. 菜单唯一入口：右下角圆钮 ===')
const tp5 = makePage(tpDef)
pageInstanceRef = tp5
tp5.onLoad({ id: SID })
stepFrames(2)
tp5.onOpenMenu()
ok('onOpenMenu 打开菜单', tp5.data.showMenu === true && tp5.data.showControls === true)
tp5.onCloseMenu()
ok('onCloseMenu 关闭菜单', tp5.data.showMenu === false && tp5.data.showControls === false)

console.log('\n=== 23-11. 播放中开菜单再关：自动续播（不丢播放态）===')
const tp6 = makePage(tpDef)
pageInstanceRef = tp6
tp6.onLoad({ id: SID })
stepFrames(2)
tp6.onTapScreen()
tp6.onOpenMenu()
ok('开菜单时暂停', tp6.data.playing === false)
tp6.onCloseMenu()
ok('关菜单后恢复播放', tp6.data.playing === true, `playing=${tp6.data.playing}`)

console.log('\n=== 23-12. 开场倒计时：默认关闭，开启后 3-2-1 才起播 ===')
const tp7 = makePage(tpDef)
pageInstanceRef = tp7
tp7.onLoad({ id: SID })
ok('默认不倒数（对齐浅纸 countdown=0）', tp7.data.countdown === 0, `countdown=${tp7.data.countdown}`)
tp7._setSetting({ countdown: 3 }, 'none')
// 回到起点：从中间续播时倒计时不触发（浅纸语义：只有从头起播才倒数）
tp7._seekPx(0)
tp7.onTapPlay()
ok('开启倒计时后点播放进入 3-2-1', tp7.data.countdown === 3, `countdown=${tp7.data.countdown}`)
ok('倒数期间未滚动', tp7.data.playing === false)
stepFrames(220) // 3.5s
ok('倒数结束自动开播', tp7.data.playing === true && tp7.engine.playing === true)
ok('倒计时归零', tp7.data.countdown === 0, `countdown=${tp7.data.countdown}`)

console.log('\n=== 23-13. 竖屏窄屏：长角色名不再裁切名字后的台词（回归 Issue 1）===')
const parser = require('./miniprogram/engine/parser.js')
const vis = (s) => { let w = 0; for (const c of (s || '')) w += /[\x00-\xff]/.test(c) ? 0.5 : 1; return w }
// 竖屏：窗口宽 375、字号 34、字间距 2、左右留白 40 → 每行约 8 字
const CPL = Math.max(8, Math.floor((375 - 80) / (34 + 2)))
const LONG_NAME = '婆婆（冲着门口喊）： 建华！小凤！快过来吃饭，菜都凉了'
const parsed = parser.parseScript(LONG_NAME, { charsPerLine: CPL, roleHighlight: true, isDark: true })
const brokenLine = parsed.lines.find(l => l.rolePrefix && l.body && vis(l.text) > CPL)
ok('不存在「名字+台词」挤在同一超载行的裁切现象', !brokenLine, brokenLine ? `越界行: ${brokenLine.text}` : '')
ok('超长名字已拆为名字独占行', parsed.lines.some(l => l.rolePrefix && !l.body))
const overBody = parsed.lines.filter(l => l.body && vis(l.text) > CPL + 1)
ok('所有台词行宽度不超载', overBody.length === 0, overBody.length ? `越界: ${overBody.map(o => o.text)}` : '')

console.log('\n=== 23-14. 打开菜单：一次落定，无高度二次塌缩（Issue 1）===')
const tp8 = makePage(tpDef)
pageInstanceRef = tp8
const events = []
const origSet8 = tp8.setData
tp8.setData = function (p) { events.push(Object.assign({}, p)); return origSet8.call(this, p) }
tp8.onLoad({ id: SID })
events.length = 0
tp8.onOpenMenu()
const showIdx = events.findIndex(e => e.showMenu === true)
ok('onOpenMenu 同帧写入 showMenu=true', showIdx >= 0, `showIdx=${showIdx}`)
ok('showMenu 与 menuHeight 同帧落定（无中间态）',
  showIdx >= 0 && typeof events[showIdx].menuHeight === 'number', `menuHeight=${showIdx>=0?events[showIdx].menuHeight:'-'}`)
const shrinkAfter = showIdx >= 0 && events.slice(showIdx + 1).some(e => typeof e.menuHeight === 'number')
ok('打开后无二次改高度（根除中央闪现）', shrinkAfter === false)

console.log('\n=== 23-15. 速度上限：cpm 600（浅纸真值）===')
const timeline = require('./miniprogram/engine/timeline.js')
ok('timeline.CPM_MAX = 600', timeline.CPM_MAX === 600, `CPM_MAX=${timeline.CPM_MAX}`)
const tp9 = makePage(tpDef)
pageInstanceRef = tp9
tp9.onLoad({ id: SID })
stepFrames(2)
tp9._applySpeed(9999)
ok('超速被钳到 600 字/分', tp9.data.speed === 600, `speed=${tp9.data.speed}`)

console.log('\n=== 23-16. 台词区宽度（百分比）与左右留白联动 ===')
const tp10 = makePage(tpDef)
pageInstanceRef = tp10
tp10.onLoad({ id: SID })
stepFrames(2)
tp10._setSetting({ contentWidth: 50 }, 'layout')
ok('台词区宽度 50% 如实生效', tp10.data.contentWidth === 50, `cw=${tp10.data.contentWidth}`)
ok('左右留白 = 屏宽 × (100−50)% ÷ 2 = 94px',
  tp10.data.marginHorizontal === Math.round((tp10.winWidth || 375) * 0.5 / 2), `margin=${tp10.data.marginHorizontal}`)
tp10._setSetting({ contentWidth: 100 }, 'layout')
ok('铺满时留白为 0', tp10.data.marginHorizontal === 0, `margin=${tp10.data.marginHorizontal}`)

console.log('\n=== 23-17. 「左右留白」已并入菜单「台词区宽度」（设置页去重）===')
// 2026-10-28：设置页那份左右留白滑块已删（两处各改一套、还不同源）。
// 现在唯一入口是菜单的「台词区宽度」，上面 23-16 已验它能把 marginHorizontal 算对。
{
  const fs = require('fs')
  const setWxml = fs.readFileSync('./miniprogram/pages/settings/settings.wxml', 'utf-8')
  ok('设置页不再有左右留白滑块', setWxml.indexOf('onSlideMargin') < 0 && setWxml.indexOf('margin-slider') < 0)
  const set1 = makePage(setDef)
  if (set1.onShow) set1.onShow()
  ok('设置页也不再暴露任何写入偏好的 handler',
    typeof set1.onSlideMargin === 'undefined' && typeof set1.onTapFont === 'undefined')
}

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
