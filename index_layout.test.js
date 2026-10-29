'use strict'
/**
 * 首页布局契约（2026-10-29 视觉重做后新增）
 * ──────────────────────────────────────────────────────────
 * 这一轮改的是「看得见的东西」，最容易悄悄坏掉的是三件事：
 *   1) 分组之间没有可见边界 —— 文件夹组最后一张卡和单篇卡只隔 8px，
 *      实机上会被读成「单篇也属于这个文件夹」。所以补了一条「单篇台本」分节线，
 *      这条测试盯住它「有且只在有文件夹+有单篇时出现」；
 *   2) 分节线在切换分区时不能乱入（单篇分区里再写一遍「单篇台本」就是废话）；
 *   3) 异形屏报头位置 —— navigationStyle=custom 之后页面从 y=0 开始画，
 *      padding-top 必须等于「状态栏 + 胶囊带」，算错就钻刘海或压胶囊。
 *
 * 运行：node index_layout.test.js
 */

const mem = {}
global.wx = {
  env: { USER_DATA_PATH: '/tmp/wxuser' },
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  showToast: () => {},
  showModal: () => {},
  navigateTo: () => {},
  stopPullDownRefresh: () => {},
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812 })
}
global.getApp = () => ({ globalData: { prefs: {} }, updatePrefs: (p) => p })

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''))
  }
}

const store = require('./miniprogram/engine/store.js')

let po = null
global.Page = (o) => { po = o }
require('./miniprogram/pages/index/index.js')

function newPage() {
  const p = { data: JSON.parse(JSON.stringify(po.data)) }
  Object.keys(po).forEach((k) => { if (k !== 'data' && typeof po[k] === 'function') p[k] = po[k].bind(p) })
  p.setData = function (patch) { Object.assign(this.data, patch) }
  return p
}

function reset() {
  Object.keys(mem).forEach((k) => delete mem[k])
  ;(store.list() || []).forEach((s) => store.remove(s.id))
  ;(store.listFolders() || []).forEach((f) => store.removeFolder(f.id))
}

/* ══════════════════════════════════════════════════════════════
 * 1. 分节线：有文件夹 + 有单篇 → 恰好一条，且夹在两个分组之间
 * ════════════════════════════════════════════════════════════ */
console.log('\n═══ 1. 分节线：文件夹组与单篇组之间必须有可见边界 ═══')
{
  reset()
  const f = store.createFolder('短剧《归期》拆分')
  ;['第一集', '第二集'].forEach((t, i) => {
    const s = store.create(t, '林晚：你好')
    s.folderId = f.id
    s.createdAt = Date.now() + i
    store.save(s)
  })
  ;['口播开场', '婚礼致辞'].forEach((t) => store.save(store.create(t, '林晚：你好')))

  const p = newPage()
  p.data.filter = 'all'
  p.loadList()

  const kinds = p.data.list.map((i) => i.kind)
  const secs = p.data.list.filter((i) => i.kind === 'section')
  ok('恰好一条分节线', secs.length === 1, 'kinds=' + kinds.join(','))
  ok('分节线名字是「单篇台本」', secs[0] && secs[0].name === '单篇台本', secs[0] && secs[0].name)
  ok('分节线篇数 = 单篇数 2', secs[0] && secs[0].count === 2, secs[0] && String(secs[0].count))

  const secIdx = kinds.indexOf('section')
  const lastInFolder = p.data.list.map((i) => !!i.inFolder).lastIndexOf(true)
  const firstSingle = p.data.list.map((i, n) => (i.kind === 'script' && !i.inFolder ? n : -1)).filter((n) => n >= 0)[0]
  ok('分节线排在文件夹组之后', secIdx > lastInFolder, `sec=${secIdx} lastInFolder=${lastInFolder}`)
  ok('分节线排在单篇之前', secIdx < firstSingle, `sec=${secIdx} first=${firstSingle}`)
}

/* ══════════════════════════════════════════════════════════════
 * 2. 分节线不该出现的三种情况
 * ════════════════════════════════════════════════════════════ */
console.log('\n═══ 2. 分节线只在「混合」时出现 ═══')
{
  const p = newPage()

  p.data.filter = 'single'
  p.loadList()
  ok('单篇分区内不再出现分节线', p.data.list.every((i) => i.kind === 'script'), p.data.list.map((i) => i.kind).join(','))

  p.data.filter = 'split'
  p.loadList()
  ok('拆分分区内不出现分节线', p.data.list.every((i) => i.kind !== 'section'), p.data.list.map((i) => i.kind).join(','))

  // 只有单篇、没有文件夹 → 不需要「单篇台本」这种废话标题
  reset()
  store.save(store.create('独稿', '林晚：你好'))
  const q = newPage()
  q.data.filter = 'all'
  q.loadList()
  ok('纯单篇时不出现分节线', q.data.list.every((i) => i.kind !== 'section'), q.data.list.map((i) => i.kind).join(','))
}

/* ══════════════════════════════════════════════════════════════
 * 3. 报头安全区：headTop = 状态栏 + 胶囊带(46)
 * ════════════════════════════════════════════════════════════ */
console.log('\n═══ 3. 异形屏：报头必须落在胶囊带下方 ═══')
{
  const cases = [
    { name: 'iPhone SE / 旧安卓（状态栏 20）', statusBarHeight: 20, want: 66 },
    { name: 'iPhone 13（状态栏 44）', statusBarHeight: 44, want: 90 },
    { name: 'iPhone 14 Pro 灵动岛（状态栏 54）', statusBarHeight: 54, want: 100 }
  ]
  cases.forEach((c) => {
    global.wx.getWindowInfo = () => ({
      statusBarHeight: c.statusBarHeight,
      windowWidth: 375,
      windowHeight: 812,
      safeArea: { left: 0, right: 375, top: c.statusBarHeight, bottom: 778 }
    })
    const p = newPage()
    p._syncViewport()
    ok(`${c.name} → headTop ${c.want}px`, p.data.headTop === c.want, 'got ' + p.data.headTop)
    ok(`${c.name} → 竖屏无左右安全区`, p.data.safeL === 0 && p.data.safeR === 0)
  })

  // 横屏刘海机：safeArea 左右各内缩 44，页面内边距要跟着让开
  global.wx.getWindowInfo = () => ({
    statusBarHeight: 0,
    windowWidth: 812,
    windowHeight: 375,
    safeArea: { left: 44, right: 768, top: 0, bottom: 354 }
  })
  const l = newPage()
  l._syncViewport()
  ok('横屏刘海：左侧让 44px', l.data.safeL === 44, 'got ' + l.data.safeL)
  ok('横屏刘海：右侧让 44px', l.data.safeR === 812 - 768, 'got ' + l.data.safeR)
}

/* ══════════════════════════════════════════════════════════════
 * 4. 降级：拿不到窗口信息也不能崩
 * ════════════════════════════════════════════════════════════ */
console.log('\n═══ 4. 降级：窗口信息缺失时不能崩 ═══')
{
  delete global.wx.getWindowInfo
  delete global.wx.getSystemInfoSync
  const p = newPage()
  let threw = false
  try { p._syncViewport() } catch (e) { threw = true }
  ok('没有窗口 API 时不抛错', !threw)
  ok('退化为保守值（状态栏 20 → 66px）', p.data.headTop === 66, 'got ' + p.data.headTop)

  global.wx.getWindowInfo = () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812 })
}

/* ══════════════════════════════════════════════════════════════
 * 5. 模板契约
 * ════════════════════════════════════════════════════════════ */
console.log('\n═══ 5. 模板与样式契约 ═══')
{
  const fs = require('fs')
  const path = require('path')
  const WXML = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/index/index.wxml'), 'utf8')
  const WXSS = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/index/index.wxss'), 'utf8')
  const JSON = fs.readFileSync(path.join(__dirname, 'miniprogram/pages/index/index.json'), 'utf8')

  ok('分节线有模板分支', WXML.indexOf("item.kind === 'section'") >= 0)
  ok('报头用 headTop 内联避让', WXML.indexOf('{{headTop}}px') >= 0)
  ok('页面用自定义导航（否则会和报头标题重复）', /navigationStyle"\s*:\s*"custom"/.test(JSON))
  ok('左右安全区以 CSS 变量注入', WXML.indexOf('--safe-l') >= 0 && WXSS.indexOf('var(--safe-l') >= 0)
  ok('页脚不再 fixed（fixed 会永久压住列表最后一屏）', !/\.idx-foot\s*\{[^}]*position:\s*fixed/.test(WXSS))
  ok('主操作不再 sticky（sticky top:0 会顶到胶囊下面）', !/\.idx-actions\s*\{[^}]*position:\s*sticky/.test(WXSS))
  ok('列表末尾有「再新建一篇」兜底入口', WXML.indexOf('idx-more') >= 0 && WXML.indexOf('再新建一篇') >= 0)
  ok('宽屏断点用 px 而非 rpx（rpx 在平板上会放大两倍）', /@media \(min-width: 600px\)[\s\S]{0,400}font-size: 40px/.test(WXSS))
  ok('尊重「减弱动效」系统设置', WXSS.indexOf('prefers-reduced-motion') >= 0)
  ok('朱红不再用于分组标记', !/\.idx-folder-tick\s*\{[^}]*background:\s*var\(--red\)/.test(WXSS))
}

console.log('\n────────────────────────────')
console.log(pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
