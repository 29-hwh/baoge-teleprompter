'use strict'
/**
 * compare_before_after.js —— 证明「悟空专属拆分」零变化，同时量化多模态的改善
 * -----------------------------------------------------------------------------
 * 做法：把 git HEAD 里的旧 util.js 取到临时目录，与本轮修改后的 util.js
 * **同时加载**，跑同一批输入，逐条比对输出。这是唯一能证明「悟空没被改动带偏」的方式
 * ——只看宏观行数不够，必须逐行比内容。
 *
 * 输入面：
 *   ① fixtures/table 里全部表格样本
 *   ② 真实稿件（桌面的 建华&小凤的生活91-100.docx）
 *   ③ 随机生成的模糊样本（3 个种子 × 表格结构）
 *
 * 输出：
 *   - 悟空：任何一处不相同 → 红线，必须回滚
 *   - 多模态：列出差异，作为修复证据（P2/P4/P5 的效果）
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const REPO = __dirname
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp_'))

// 取出改动前的 util.js
const oldSrc = execSync('git -C ' + JSON.stringify(REPO) + ' show HEAD:miniprogram/utils/util.js', { maxBuffer: 1 << 28 }).toString('utf8')
const oldPath = path.join(TMP, 'old_util.js')
fs.writeFileSync(oldPath, oldSrc)

const OLD = require(oldPath)
const NEW = require(path.join(REPO, 'miniprogram/utils/util.js'))
const { SPECS, buildDoc } = require(path.join(REPO, 'fixtures/table_specs.js'))

const wukongOf = (U, blocks) => U.splitScripts(blocks, { mode: 'wukong' })
const multiOf = (U, blocks) => U.splitScripts(blocks)

const dump = (res) => (res.segments || []).map((s) => s.name + '⟨' + (s.lines || []).join(' ⏎ ') + '⟩').join('\n')
const lineCount = (res) => (res.segments || []).reduce((n, s) => n + ((s.lines || []).length), 0)

let wukDiff = 0, mulDiff = 0, total = 0
const EVIDENCE = []

function compare(label, blocks) {
  total++
  const ow = wukongOf(OLD, blocks)
  const nw = wukongOf(NEW, blocks)
  const om = multiOf(OLD, blocks)
  const nm = multiOf(NEW, blocks)
  const sameW = dump(ow) === dump(nw)
  const sameM = dump(om) === dump(nm)
  if (!sameW) {
    wukDiff++
    console.log('\n🔴 [悟空变化] ' + label)
    console.log('  旧：' + dump(ow).slice(0, 400))
    console.log('  新：' + dump(nw).slice(0, 400))
  }
  if (!sameM) {
    mulDiff++
    const o = dump(om).split('\n')
    const n = dump(nm).split('\n')
    for (let i = 0; i < Math.max(o.length, n.length); i++) {
      if (o[i] === n[i]) continue
      EVIDENCE.push({ label, old: o[i] || '(无)', new: n[i] || '(无)' })
    }
  }
  console.log((sameW ? '✅' : '🔴') + ' ' + label +
    '  悟空 ' + lineCount(ow) + '→' + lineCount(nw) + (sameW ? ' 零变化' : ' 已变化') +
    ' ｜ 多模态 ' + lineCount(om) + '→' + lineCount(nm) + (sameM ? ' 零变化' : ' 已改善'))
}

console.log('=== 悟空零变化验证（旧版 vs 新版 同时对跑）===\n')
console.log('--- A. fixtures 表格样本 ---')
SPECS.forEach((s) => compare(s.id + ' ' + s.genre, NEW.extractDocxBlocks(buildDoc(s.spec))))

console.log('\n--- B. 随机表格样本（多种子）---')
// 简易可复现随机源（与既有模糊测试同构）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const NAMES = ['杨凤', '王建华', '婆婆', '李阿姨']
;[11, 202, 3003, 44004].forEach((seed) => {
  const rng = mulberry32(seed)
  const rows = [['镜头', '画面 / 动作', '台词', '备注']]
  for (let i = 0; i < 8; i++) {
    const a = NAMES[Math.floor(rng() * NAMES.length)]
    const b = NAMES[Math.floor(rng() * NAMES.length)]
    const cell = rng() < 0.4 ? a + '：第' + seed + '句台词，测试用。\n' + b + '：回应一句。' : a + '：单句台词' + i + '。'
    rows.push([String(i + 1), '【近景】动作' + i, cell, ''])
  }
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>第' + seed + '集</w:t></w:r></w:p>' +
    '<w:tbl><w:tr>' + rows[0].map((c) => '<w:tc><w:p><w:r><w:t>' + c + '</w:t></w:r></w:p></w:tc>').join('') + '</w:tr>' +
    rows.slice(1).map((r) => '<w:tr>' + r.map((c) => String(c).split('\n').map((x) => '<w:p><w:r><w:t>' + x + '</w:t></w:r></w:p>').join('')).map((x) => '<w:tc>' + x + '</w:tc>').join('') + '</w:tr>').join('') +
    '</w:tbl></w:body></w:document>'
  compare('随机样本 seed=' + seed, NEW.extractDocxBlocks(xml))
})

console.log('\n--- C. 真实稿件（桌面 91-100）---')
{
  const dir = '/Users/huweihua/桌面文件/2026悟空脚本'
  const src = path.join(dir, '建华&小凤的生活91-100.docx')
  if (fs.existsSync(src)) {
    const xml = execSync('unzip -p ' + JSON.stringify(src) + ' word/document.xml', { maxBuffer: 1 << 28 }).toString('utf8')
    compare('真实稿件 91-100', NEW.extractDocxBlocks(xml))
  } else {
    console.log('⚠️ 真实稿件不存在，跳过：' + src)
  }
}

console.log('\n==================== 结论 ====================')
console.log('比对样本数：' + total)
console.log('悟空侧变化数：' + wukDiff + (wukDiff === 0 ? '  ✅ 悟空规则零变化（完全达成）' : '  🔴 红线！必须回滚'))
console.log('多模态变化数：' + mulDiff)
if (EVIDENCE.length) {
  console.log('\n多模态差异明细（前 12 条，作为修复证据）：')
  EVIDENCE.slice(0, 12).forEach((e) => {
    console.log('  ' + e.label)
    console.log('    旧 → ' + String(e.old).slice(0, 120))
    console.log('    新 → ' + String(e.new).slice(0, 120))
  })
}
fs.rmSync(TMP, { recursive: true, force: true })
process.exit(wukDiff === 0 ? 0 : 1)
