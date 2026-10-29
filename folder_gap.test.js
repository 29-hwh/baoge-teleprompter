'use strict'
/**
 * 第二十二轮新增功能验证：
 *  1) 一级页文件夹（Word 智能拆分归组、改名、删除、分组展示）
 *  2) 提词台首圈开篇留空（循环模式开篇不显示结尾文字，回绕后恢复无缝）
 *
 * 运行：node folder_gap.test.js
 */

const mem = {}
global.wx = {
  env: { USER_DATA_PATH: '/tmp/wxuser' },
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  showToast: () => {},
  showModal: (o) => o.success && o.success({ confirm: false }),
  showLoading: () => {},
  hideLoading: () => {},
  showActionSheet: () => {},
  navigateBack: () => {},
  navigateTo: () => {},
  stopPullDownRefresh: () => {},
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 667 }),
  getMenuButtonBoundingClientRect: () => ({ bottom: 80 }),
  getFileSystemManager: () => ({ readFileSync: () => '', unzip: (o) => o.success(), rmdir: () => {} })
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
const util = require('./miniprogram/utils/util.js')

console.log('\n═══ 1. 文件夹：store 层 ═══')
{
  const f = store.createFolder('09-03')
  ok('createFolder 返回带 id 对象', !!f && !!f.id)
  const s1 = store.create('第一集', '甲：你好')
  s1.folderId = f.id
  store.save(s1)
  const s2 = store.create('第二集', '乙：再见')
  s2.folderId = f.id
  store.save(s2)
  ok('台本可挂入文件夹', store.list().filter((s) => s.folderId === f.id).length === 2)
  ok('文件夹列表', store.listFolders().length === 1)
  store.renameFolder(f.id, '改名组')
  ok('renameFolder 生效', store.getFolder(f.id).name === '改名组')
  store.removeByFolder(f.id)
  store.removeFolder(f.id)
  ok('removeByFolder+removeFolder 清空', store.listFolders().length === 0 && store.list().length === 0)
}

console.log('\n═══ 2. 拆分工具仍可用（文件夹输入源）═══')
{
  const parts = util.splitImportBlocks('第1集 重逢\n甲：你好\n\n第2集 争执\n乙：走开', 'headings')
  ok('按标题拆出 2 块', parts.length === 2, 'len=' + parts.length)
  ok('标题取自原文', parts[0].title === '第1集 重逢' && parts[1].title === '第2集 争执')
}

console.log('\n═══ 3. index 页：拆分导入自动建文件夹并归组 ═══')
{
  let po = null
  global.Page = (o) => { po = o }
  require('./miniprogram/pages/index/index.js')
  const inst = { data: JSON.parse(JSON.stringify(po.data)) }
  Object.keys(po).forEach((k) => { if (k !== 'data' && typeof po[k] === 'function') inst[k] = po[k].bind(inst) })
  inst.setData = function (p) { Object.assign(this.data, p) }

  inst._saveSplitImport('headings', '第1集 重逢\n甲：你好啊\n\n第2集 争执\n乙：别走')
  const folders = store.listFolders()
  ok('自动创建 1 个文件夹', folders.length === 1)
  ok('默认名是日期 MM-DD 格式', /^\d{2}-\d{2}$/.test(folders[0].name), 'name=' + folders[0].name)
  const inFolder = store.list().filter((s) => s.folderId === folders[0].id)
  ok('2 篇台本全部归组', inFolder.length === 2)

  inst.loadList()
  const kinds = inst.data.list.map((i) => i.kind)
  ok('列表按 组头+组内台本 展示', kinds.join(',') === 'folder,script,script', kinds.join(','))
  const folderCard = inst.data.list.find((i) => i.kind === 'folder')
  ok('组头卡片含篇数', folderCard && folderCard.count === 2)
  ok('组内台本标记 inFolder', inst.data.list.filter((i) => i.kind === 'script').every((s) => s.inFolder))

  // 改名
  inst.data.folderRenameId = folders[0].id
  inst.data.folderRenameName = '改成新名字'
  inst.onFolderRenameOk()
  ok('重命名落库', store.getFolder(folders[0].id).name === '改成新名字')
  // 长按删除整组（mock showModal 返回 confirm=false 时不应删除）
  inst.onLongPressFolder({ currentTarget: { dataset: { fid: folders[0].id, name: 'x', count: 2 } } })
  ok('删除取消不删', store.list().length === 2)
  // 清空存储，避免影响后续用例
  global.wx.showModal = (o) => o.success && o.success({ confirm: true })
  inst.onLongPressFolder({ currentTarget: { dataset: { fid: folders[0].id, name: 'x', count: 2 } } })
  ok('确认后整组删除', store.list().length === 0 && store.listFolders().length === 0)
}

console.log('\n═══ 4. 提词台：虚拟列表裁剪（2026-10-28 恢复原有逐帧内核）═══')
{
  // 2026-10-29：从「虚拟列表 + 换批」改成「全量渲染 + 只动 transform」。
  // 换批那一帧要重建几十个节点 → 必掉一帧，观感就是「间歇性跳一下」。
  // 新契约：渲染列表 == 全部台词，首行就是第一行、末行就是最后一行，
  // 滚到任何位置都不换列表（所以不可能出现「结尾接到开头」或白屏）。
  let cfg2 = null
  global.Page = (o) => { cfg2 = o }
  require('./miniprogram/pages/teleprompter/teleprompter.js')
  const p2 = { data: JSON.parse(JSON.stringify(cfg2.data)) }
  Object.keys(cfg2).forEach((k) => { if (k !== 'data' && typeof cfg2[k] === 'function') p2[k] = cfg2[k].bind(p2) })
  p2.setData = function (obj) { Object.assign(this.data, obj) }

  const makeLines = (n) => Array.from({ length: n }, (_, i) => ({
    _i: i, role: null, rolePrefix: '', body: '第' + (i + 1) + '行台词',
    color: null, prefixColor: '#fff', bodyColor: '#fff', sectionIndex: 0
  }))

  p2.displayLines = makeLines(12)
  p2.data.lineHeightPx = 40
  p2.data.startPad = 0
  p2.data.blobMode = false
  p2.winHeight = 600
  p2.engine = { current: 0 }
  p2._updateVisible(true)
  const v0 = p2.data.lines
  ok('短稿（12 行）全量渲染', v0.length === 12, 'len=' + v0.length)
  ok('首行即台词第一行（不取模、不接结尾）', v0[0].body === '第1行台词', v0[0] && v0[0].body)
  ok('末行即台词最后一行', v0[v0.length - 1].body === '第12行台词', v0[v0.length - 1].body)

  // 长稿：同样是全量，列表不再随滚动换批
  const longLines = makeLines(300)
  p2.displayLines = longLines
  p2.engine = { current: 9000 } // 滚到中间
  p2._updateVisible(true)
  const v1 = p2.data.lines
  ok('长稿也是全量渲染（滚动期间零重建）', v1.length === 300, 'len=' + v1.length)
  ok('列表引用就是 displayLines，滚到哪都不换', v1 === longLines)
  ok('第 0 行仍是第一行（不会把结尾接到开头）', v1[0].body === '第1行台词')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
