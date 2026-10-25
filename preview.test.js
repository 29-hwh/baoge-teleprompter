/**
 * 文档预览页 preview 单元测试（mock 微信运行时）。
 * 验证：
 *  - onLoad 读取 getApp().globalData.importPayload，分别计算
 *    原版纯文字拆分篇数(plainCount) 与 最新多模态（表格）集数(multiCount)，
 *    并以「分集预览（多模态）在上、原文在下」的顺序填充数据；
 *  - 三个导入入口：onImportSingle（作为一篇）/ onImportPlain（原版纯文字）/
 *    onImportMultimodal（最新多模态表格）；
 *  - 无 payload 时安全退出。
 * 运行：node preview.test.js
 */
'use strict'
const store = require('./miniprogram/engine/store.js')

const mem = {}
let navTo = null
let redirectTo = null
let navigateBackCalls = 0
let toastMsg = null
global.wx = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] },
  showLoading: () => {},
  hideLoading: () => {},
  showToast: (o) => { toastMsg = (o && o.title) || '' },
  navigateTo: (o) => { navTo = o.url },
  redirectTo: (o) => { redirectTo = o.url },
  navigateBack: () => { navigateBackCalls++ }
}
const appData = { globalData: { importPayload: null } }
global.getApp = () => appData

let pageOpts = null
global.Page = (opts) => { pageOpts = opts }

require('./miniprogram/pages/preview/preview.js')
if (!pageOpts) { console.error('preview 页面未注册'); process.exit(1) }
const inst = { data: JSON.parse(JSON.stringify(pageOpts.data)) }
Object.keys(pageOpts).forEach((k) => {
  if (k === 'data') return
  if (typeof pageOpts[k] === 'function') inst[k] = pageOpts[k].bind(inst)
})
inst.setData = function (patch) { Object.assign(this.data, patch) }

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')) }
}
function clearStore() { mem['scripts_v1'] = []; mem['folders_v1'] = [] }

console.log('文档预览页（三选项导入 + 固定顶栏布局数据）')
clearStore()

// 1) docx payload
appData.globalData.importPayload = {
  kind: 'docx',
  name: '建华9.1.docx',
  plain: '建华：回家\n小凤：好',
  result: { segments: [
    { name: '建华&小凤的生活71', lines: ['婆婆：吃饭', '建华：来了'] },
    { name: '建华&小凤的生活72', lines: ['小凤：走'] }
  ] }
}
inst.onLoad()
ok('docx 预览填充 name', inst.data.name === '建华9.1.docx')
ok('docx 最新多模态识别 2 集(multiCount)', inst.data.multiCount === 2 && inst.data.canSplit === true)
ok('docx 原版纯文字拆分篇数(plainCount) 已计算', typeof inst.data.plainCount === 'number')
ok('docx 原文=plain（分集预览在上、原文在下：原文独立字段）', inst.data.text === '建华：回家\n小凤：好')
ok('docx 分集预览卡片=2（置顶展示）', inst.data.segments.length === 2)

// 2) onImportSingle(docx) → 作为一篇导入 → redirectTo 编辑页
redirectTo = null
inst.data.loading = false
inst.onImportSingle()
ok('onImportSingle 创建 1 篇台本', store.list().length === 1)
ok('onImportSingle redirectTo 编辑页', /^\/pages\/edit\/edit\?id=/.test(redirectTo || ''))

// 3) onImportMultimodal(docx) → 最新多模态规则逐集落盘 + navigateBack
clearStore(); navigateBackCalls = 0
inst.data.loading = false
inst.onImportMultimodal()
ok('onImportMultimodal(docx) 落盘 2 篇', store.list().length === 2)
ok('onImportMultimodal(docx) 建了文件夹', store.listFolders().length === 1)
ok('onImportMultimodal(docx) navigateBack', navigateBackCalls === 1)

// 4) onImportPlain(docx) → 原版 smartSplitScripts 处理纯文本（不崩溃）
clearStore(); navigateBackCalls = 0; toastMsg = null
inst.data.loading = false
inst.onImportPlain()
ok('onImportPlain(docx) 走原版逻辑不崩溃且 navigateBack', navigateBackCalls === 1)

// 5) text payload（单段）→ 多模态/原版均识别为 1，仅「作为一篇」可用
clearStore(); navigateBackCalls = 0; redirectTo = null
appData.globalData.importPayload = { kind: 'text', name: '台词.txt', content: '甲：你好' }
inst.onLoad()
ok('text 单段：multiCount=1, canSplit=false', inst.data.multiCount === 1 && inst.data.canSplit === false)
inst.data.loading = false
inst.onImportSingle()
ok('text 单段 onImportSingle 创建 1 篇', store.list().length === 1)

// 6) text payload（多段，含系列名）→ onImportMultimodal 走最新段落规则拆多集
clearStore(); navigateBackCalls = 0
appData.globalData.importPayload = {
  kind: 'text', name: '剧本.txt',
  content: '建华&小凤的生活 1\n甲：你好\n\n建华&小凤的生活 2\n乙：再见'
}
inst.onLoad()
ok('text 多段：multiCount>=2（最新规则识别多集）', inst.data.multiCount >= 2)
inst.data.loading = false
inst.onImportMultimodal()
ok('onImportMultimodal(text) 拆出多集并 navigateBack', navigateBackCalls === 1 && store.list().length >= 2)

// 7) text 原版纯文字拆分（多段含集号）→ onImportPlain 拆多篇
clearStore(); navigateBackCalls = 0
appData.globalData.importPayload = {
  kind: 'text', name: '剧本2.txt',
  content: '第1集\n甲：你好\n\n第2集\n乙：再见'
}
inst.onLoad()
ok('text 多段：plainCount>=2（原版逻辑识别多集）', inst.data.plainCount >= 2)
inst.data.loading = false
inst.onImportPlain()
ok('onImportPlain(text) 原版逻辑拆分并 navigateBack', navigateBackCalls === 1 && store.list().length >= 2)

// 8) 无 payload 时安全退出
clearStore(); navigateBackCalls = 0
appData.globalData.importPayload = null
inst.onLoad()
ok('无 payload 时安全 navigateBack', navigateBackCalls === 1)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
