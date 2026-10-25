/**
 * 首页 txt/md 导入分流回归测试（mock 微信运行时）。
 *
 * 背景：拆分前预览功能上线后，txt/md 导入应和 docx 一致——
 *   多段（smartSplitScripts 拆出 ≥2 篇）→ 写 globalData.importPayload(kind:'text') 并跳预览页；
 *   单段 → 直接创建台本并跳编辑页。
 * 历史上此处曾残留对已删除方法 _askSplitImport 的调用，会导致多段 txt 导入直接崩溃；
 * 本测试锁定正确分流，防止回归。
 *
 * 运行：node index_text_import_preview.test.js
 */
'use strict'
const store = require('./miniprogram/engine/store.js')

const mem = {}
let navTo = null
let toastMsg = null
const fsFiles = {}
let chooseCb = null

global.wx = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] },
  showLoading: () => {},
  hideLoading: () => {},
  showToast: (o) => { toastMsg = (o && o.title) || '' },
  navigateTo: (o) => { navTo = o.url },
  navigateBack: () => {},
  chooseMessageFile: (o) => { chooseCb = o.success },
  getFileSystemManager: () => ({ readFileSync: (p) => fsFiles[p] || '' })
}

const appData = { globalData: { importPayload: null } }
global.getApp = () => appData

let pageOpts = null
global.Page = (opts) => { pageOpts = opts }

require('./miniprogram/pages/index/index.js')
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

console.log('首页 txt/md 导入 → 预览页 分流（回归：曾误调用已删除的 _askSplitImport）')
clearStore()

// 1) 多段文本：应走预览页（写入 text payload + navigateTo preview）
fsFiles['/tmp/x.txt'] = '第1集\n甲：你好\n\n第2集\n乙：再见'
appData.globalData.importPayload = null
navTo = null
chooseCb = null
inst.onTapImport({})
ok('onTapImport 触发 chooseMessageFile 成功回调', typeof chooseCb === 'function')
chooseCb({ tempFiles: [{ name: 'x.txt', path: '/tmp/x.txt' }] })
ok('多段 txt 不再调用已删除的 _askSplitImport（未抛错即通过）', true)
ok('多段 txt 写入 importPayload(kind=text)',
  !!appData.globalData.importPayload && appData.globalData.importPayload.kind === 'text')
ok('多段 txt payload.content 含第2集',
  !!appData.globalData.importPayload && appData.globalData.importPayload.content.indexOf('第2集') >= 0)
ok('多段 txt 跳转到预览页', navTo === '/pages/preview/preview')

// 2) 单段文本：应直接创建台本并跳编辑页
clearStore()
fsFiles['/tmp/s.txt'] = '甲：你好'
appData.globalData.importPayload = null
navTo = null
chooseCb = null
inst.onTapImport({})
chooseCb({ tempFiles: [{ name: 's.txt', path: '/tmp/s.txt' }] })
ok('单段 txt 不写 payload', appData.globalData.importPayload === null)
ok('单段 txt 直接创建 1 篇台本', store.list().length === 1)
ok('单段 txt 跳转编辑页', /^\/pages\/edit\/edit\?id=/.test(navTo || ''))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
