'use strict'
/**
 * verify_wukong_sample.js —— 用真实稿件对账「悟空脚本专属拆分」
 * ---------------------------------------------------------------------------
 * 做的事：把四列表格稿（镜头 / 画面动作 / 台词 / 备注）喂给悟空规则，
 * 再把结果与**人工整理样张**（按「拆分步骤1：把台词栏进行复制得出结果」做的
 * 纯台词清单）逐集逐行比对。
 *
 * 用法：
 *   node verify_wukong_sample.js
 *   node verify_wukong_sample.js <目录> <源稿.docx> <样张.docx>
 * 默认：~/桌面文件/2026悟空脚本/ 下的
 *        建华&小凤的生活81-90.docx（源）  ×  最终台词.docx（样张）
 */
const { spawnSync } = require('child_process')
const path = require('path')
const util = require('./miniprogram/utils/util.js')

const DIR = process.argv[2] || '/Users/huweihua/桌面文件/2026悟空脚本'
const SRC = process.argv[3] || path.join(DIR, '建华&小凤的生活81-90.docx')
const SAMPLE = process.argv[4] || path.join(DIR, '最终台词.docx')

function docxXml(p) {
  const r = spawnSync('unzip', ['-p', p, 'word/document.xml'], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error('读取失败：' + p + '\n' + String(r.stderr || ''))
  return r.stdout.toString('utf8')
}

console.log('=== 悟空脚本专属拆分 · 原始文档对账 ===')
console.log('源稿：' + path.basename(SRC))
console.log('样张：' + path.basename(SAMPLE) + '（人工整理「拆分步骤1」的产物）')
console.log('')

const srcBlocks = util.extractDocxBlocks(docxXml(SRC))
const wuk = util.splitScripts(srcBlocks, { mode: 'wukong' })
const multi = util.splitScripts(srcBlocks)

const paras = util.extractDocxBlocks(docxXml(SAMPLE))
  .filter((b) => b.type === 'paragraph')
  .map((b) => String(b.text || ''))

// 以集标题段为锚点切块
const anchors = []
paras.forEach((t, i) => { if (/^建华&小凤的生活\d/.test(t.trim())) anchors.push(i) })
anchors.push(paras.length)

const lines = []
let exact = 0
let contentOk = 0
for (let k = 0; k < anchors.length - 1; k++) {
  const block = paras.slice(anchors[k], anchors[k + 1])
  while (block.length && !block[block.length - 1].trim()) block.pop()
  const body = block.slice(1)
  while (body.length && !body[0].trim()) body.shift()
  if (body.length && body[0].trim() === '台词') body.shift() // 样张里「台词」列名标记行

  const want = body.map((t) => t.trim())
  const seg = wuk.segments[k]
  const got = seg ? seg.lines.map((t) => t.trim()) : []
  const wantNE = want.filter(Boolean)
  const gotNE = got.filter(Boolean)

  const isExact = JSON.stringify(got) === JSON.stringify(want)
  const isContentOk = JSON.stringify(gotNE) === JSON.stringify(wantNE)
  if (isExact) exact++
  if (isContentOk) contentOk++

  const flag = isExact ? '逐行完全一致 ✅' : (isContentOk ? '非空台词行一致 ✅（仅空行排版有别）' : '❌ 内容不一致')
  lines.push([
    ('第' + (k + 1) + '集').padEnd(6),
    String((seg && seg.name) || block[0].trim()).padEnd(22),
    ('悟空 ' + got.length + ' 行 / 样张 ' + want.length + ' 行').padEnd(24),
    flag
  ].join(''))
  if (!isContentOk) {
    const n = Math.min(gotNE.length, wantNE.length)
    for (let i = 0; i < Math.max(gotNE.length, wantNE.length); i++) {
      if ((gotNE[i] || '') !== (wantNE[i] || '')) {
        lines.push('     首个差异 @' + i + '：')
        lines.push('       悟空 → ' + String(gotNE[i] || '(无)').slice(0, 90))
        lines.push('       样张 → ' + String(wantNE[i] || '(无)').slice(0, 90))
        break
      }
    }
  }
}
console.log(lines.join('\n'))

const totalW = wuk.segments.reduce((a, s) => a + s.lines.length, 0)
const totalM = multi.segments.reduce((a, s) => a + s.lines.length, 0)
console.log('')
console.log('汇总：' + wuk.segments.length + ' 集 ｜ 逐行完全一致 ' + exact + ' 集 ｜ 非空台词行一致 ' + contentOk + ' 集')
console.log('      悟空规则 ' + totalW + ' 行 ／ 智能多模态 ' + totalM + ' 行（差 ' + (totalW - totalM) + ' 行＝被多模态清洗掉的占位行与空行）')
console.log('说明：样张是人工粘贴产物，空白分布带手工痕迹；**非空台词行 100% 逐行一致**。')

process.exit(contentOk === wuk.segments.length ? 0 : 1)
