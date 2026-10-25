'use strict'
/**
 * 全文档扫描：找出「同一句台词念到一半丢失角色」的行。
 * 用法：node scan_role_loss.js <document.xml>
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')

const file = process.argv[2] || '/tmp/jh81_90.xml'
const xml = fs.readFileSync(file, 'utf8')
const res = util.splitScripts(util.extractDocxBlocks(xml))

let badTotal = 0
;(res.segments || []).forEach((seg) => {
  const content = seg.lines.join('\n')
  const parsed = parser.parseScript(content, {
    charsPerLine: 26,
    manualRoles: [],
    roleBlacklist: [],
    roleAlias: {},
    roleHighlight: true,
    isDark: true,
    roleColorOverride: {}
  })
  // 逐个原始台词行检查：它派生出的显示行里，是否存在「前几行有角色、后面行丢了」
  let orphan = 0
  const samples = []
  parsed.lines.forEach((l) => {
    if (l.isSpacer) return
    const body = String(l.body || '')
    if (!body.trim()) return
    if (!l.role) {
      orphan++
      if (samples.length < 3) samples.push(body.slice(0, 30))
    }
  })
  const flag = orphan > 0 ? ' ⚠' : ' ✓'
  console.log(`第${seg.epNo}集 显示行${parsed.lines.length} 无角色${orphan}${flag}`)
  if (samples.length) console.log('    例：' + samples.join(' / '))
  badTotal += orphan
})

console.log(`\n合计「丢失角色的显示行」：${badTotal} 行`)
