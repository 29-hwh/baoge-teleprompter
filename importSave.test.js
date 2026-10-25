/**
 * 导入落盘模块 importSave 单元测试（mock 微信本地存储）。
 * 验证「首页」与「文档预览页」共用的落盘单一事实来源行为正确。
 * 运行：node importSave.test.js
 */
'use strict'
const store = require('./miniprogram/engine/store.js')
const importSave = require('./miniprogram/utils/importSave.js')

// ---- mock 微信本地存储（内存版） ----
const mem = {}
global.wx = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  removeStorageSync: (k) => { delete mem[k] }
}

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')) }
}

function clearStore() { mem['scripts_v1'] = []; mem['folders_v1'] = [] }

console.log('importSave 落盘逻辑')
clearStore()

// 单篇导入
const r1 = importSave.commitSingle('台词.docx', '建华：回家吃饭')
ok('commitSingle 返回 script', !!(r1.script && r1.script.id))
ok('commitSingle 已写入 store', store.list().length === 1)
ok('commitSingle 标题去掉 .docx 后缀', r1.script.title === '台词')
ok('commitSingle 内容正确', r1.script.content === '建华：回家吃饭')

// 按 segments 逐集落盘（规则A 表格稿）
clearStore()
const segs = [
  { name: '建华&小凤的生活71', lines: ['婆婆：吃饭', '建华：来了'] },
  { name: '建华&小凤的生活72', lines: ['小凤：走了', '建华：bye'] }
]
const r2 = importSave.commitSplitFromSegments(segs, 'doc.docx')
ok('commitSplitFromSegments 返回 count=2', r2.count === 2, JSON.stringify(r2))
ok('commitSplitFromSegments 建了文件夹', !!(r2.folderId && store.listFolders().length === 1))
ok('commitSplitFromSegments 两篇都挂进文件夹', store.list().filter(s => s.folderId === r2.folderId).length === 2)
ok('commitSplitFromSegments 标题用集标题原文', store.list().some(s => s.title === '建华&小凤的生活71'))

// 智能拆分文本
clearStore()
const text = '第1集 重逢\n甲：你好\n\n第2集 争执\n乙：别走'
const r3 = importSave.commitSplitSmart(text, 'smart')
ok('commitSplitSmart 按标题拆出 ≥2 篇', r3.count >= 2, JSON.stringify(r3))
ok('commitSplitSmart 建了文件夹', !!(r3.folderId && store.listFolders().length === 1))

// 退化：仅 1 篇时返回 script（由调用方跳转编辑页）
clearStore()
const r4 = importSave.commitSplitSmart('只有一句话的内容', 'smart')
ok('内容太短时退化为单篇（返回 script）', !!(r4.script && r4.count === 1))

// 异常：空 segments
clearStore()
const r5 = importSave.commitSplitFromSegments([], 'x')
ok('空 segments 返回 error', !!r5.error && r5.count === 0)

// 仅 1 集时退化为单篇（返回 script，由调用方跳转编辑页）
clearStore()
const r6 = importSave.commitSplitFromSegments([{ name: '仅1集', lines: ['甲：你好'] }], 'one.docx')
ok('仅 1 集退化为单篇（返回 script）', !!(r6.script && r6.count === 1))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
