'use strict'
/**
 * 诊断：用产品链路解析真实表格剧本，逐格对账「解析结果 vs 源文档真实内容」。
 * 用法：node diag_accuracy.js /tmp/jsxf_doc.xml
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')

const xml = fs.readFileSync(process.argv[2], 'utf8')
const blocks = util.extractDocxBlocks(xml)
const res = util.splitScripts(blocks)

const squash = (s) => String(s || '').replace(/\s/g, '')
const isSkippedText = (t) => {
  const s = String(t || '').trim()
  if (!s) return true
  if (s === '-' || s === '—' || s === '－' || s === '–') return true
  if (/^[-—－–·•\s]+$/.test(s)) return true
  if (s === '无台词' || s === '无对白') return true
  if (/（无台词）/.test(s) || /（无对白）/.test(s)) return true
  return false
}

console.log('块数：', blocks.length, ' 表格块：', blocks.filter((b) => b.type === 'table').length)
console.log('段数：', res.segments.length)

// ---------- 1. 每表结构 ----------
console.log('\n===== 1. 每张表的结构识别 =====')
const tables = blocks.filter((b) => b.type === 'table')
tables.forEach((t, i) => {
  const rows = t.rows || []
  let headerIdx = -1
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length >= 2 && row.some(util.isDialogueHeaderCell)) {
      if (r + 1 >= rows.length) continue
      headerIdx = r
      break
    }
  }
  let dlgCol = -1
  if (headerIdx >= 0) rows[headerIdx].forEach((c, ix) => { if (util.isDialogueHeaderCell(c)) dlgCol = ix })
  const cols = util.tableColCount(rows)
  const seg = res.segments[i] || {}
  console.log(
    `表${i + 1}: 行=${rows.length} 列=${cols} 表头行=${headerIdx < 0 ? '无(legacy)' : headerIdx + 1}` +
    ` 台词列=${dlgCol < 0 ? '推断' : dlgCol} 表头=[${(rows[headerIdx] || []).map((c) => String(c).slice(0, 8)).join(' | ')}]`
  )
  console.log(`      集名="${seg.name}" 行数=${seg.lineCount} range=${seg.lineRange}`)
})

// ---------- 2. 逐格对账：源台词格 vs 输出行 ----------
console.log('\n===== 2. 逐格零丢字对账（源台词列 → 输出行）=====')
let totalSrcCells = 0, totalOutLines = 0
const lostCells = []
tables.forEach((t, ti) => {
  const rows = t.rows || []
  let headerIdx = -1
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length >= 2 && row.some(util.isDialogueHeaderCell)) { if (r + 1 >= rows.length) continue; headerIdx = r; break }
  }
  let dlgCol = -1
  if (headerIdx >= 0) rows[headerIdx].forEach((c, ix) => { if (util.isDialogueHeaderCell(c)) dlgCol = ix })
  if (dlgCol < 0) { const cols = util.tableColCount(rows); dlgCol = cols >= 4 ? cols - 1 : cols >= 3 ? 2 : cols - 1 }

  const srcCells = []
  rows.forEach((cells, ri) => {
    if (ri === headerIdx) return
    const v = cells[dlgCol] != null ? String(cells[dlgCol]) : ''
    if (isSkippedText(v)) return
    if (util.isDialogueHeaderCell(v)) return
    // 表头之前且明显是元数据（人物/场景/时间…）→ 不算台词源
    if (ri < headerIdx && /^(人物|场景|道具|时间|时间段|地点|场次|集数|镜头|景别|画面)\s*[:：]/.test(v.trim())) return
    if (ri < headerIdx && /^(第\s*\d|第[一二三四五六七八九十]+)/.test(v.trim()) && v.trim().length < 40) return
    srcCells.push({ ri, v })
  })
  const srcAll = squash(srcCells.map((c) => c.v).join(''))
  const outAll = squash(((res.segments[ti] || {}).lines || []).join(''))
  totalSrcCells += srcCells.length
  totalOutLines += ((res.segments[ti] || {}).lines || []).length
  if (srcAll !== outAll) {
    // 找到第一个差异位置，定位是哪一格
    let k = 0
    while (k < Math.min(srcAll.length, outAll.length) && srcAll[k] === outAll[k]) k++
    lostCells.push({ ti: ti + 1, k, srcLen: srcAll.length, outLen: outAll.length, ctxSrc: srcAll.slice(Math.max(0, k - 20), k + 30), ctxOut: outAll.slice(Math.max(0, k - 20), k + 30), srcCells })
  }
})
console.log(`源台词格 ${totalSrcCells} 个 / 输出行 ${totalOutLines} 行`)
if (!lostCells.length) console.log('✅ 压平后逐字一致：零丢字、零污染')
else {
  console.log(`❌ ${lostCells.length} 张表压平后不一致：`)
  lostCells.forEach((L) => {
    console.log(`  表${L.ti}: 首处差异@${L.k}  源长${L.srcLen}/输出长${L.outLen}`)
    console.log(`     源: …${L.ctxSrc}…`)
    console.log(`     出: …${L.ctxOut}…`)
    const hit = L.srcCells.find((c) => !squash(c.v).length || L.ctxSrc.includes(squash(c.v).slice(0, 10)))
    if (hit) console.log(`     疑点格 R${hit.ri}: ${JSON.stringify(hit.v).slice(0, 160)}`)
  })
}

// ---------- 3. 输出行里残留换行符（行内多行未拆） ----------
console.log('\n===== 3. 行内残留换行（提词器会把多行挤成一行）=====')
let nlCount = 0
res.segments.forEach((s) => {
  (s.lines || []).forEach((ln, i) => {
    if (/\n|\r/.test(ln)) { nlCount++; if (nlCount <= 12) console.log(`  ${s.name} L${i + 1}: ${JSON.stringify(ln).slice(0, 140)}`) }
  })
})
console.log(nlCount ? `❌ 共 ${nlCount} 行含内嵌换行` : '✅ 无内嵌换行')

// ---------- 4. 输出行里疑似「非台词」（元数据/镜头号混入） ----------
console.log('\n===== 4. 输出行疑似非台词（镜头号/元数据混入）=====')
let metaCount = 0
res.segments.forEach((s) => {
  (s.lines || []).forEach((ln) => {
    const t = String(ln).trim()
    if (/^(镜头|景别|画面|备注|时间|地点|场次|音效|音乐|服化|道具)\s*[:：]/.test(t) || /^\d{1,3}\s*$/.test(t) || /^R?\d{1,3}\s*[:：]/.test(t)) {
      metaCount++
      if (metaCount <= 12) console.log(`  ${s.name}: ${JSON.stringify(t).slice(0, 120)}`)
    }
  })
})
console.log(metaCount ? `⚠️ 共 ${metaCount} 行疑似非台词` : '✅ 未发现')

// ---------- 5. 说话人抽取质量 ----------
console.log('\n===== 5. 说话人抽取（角色名分布）=====')
const roleStat = {}
res.segments.forEach((s) => {
  (s.lines || []).forEach((ln) => {
    const m = String(ln).trim().match(/^([\u4e00-\u9fa5A-Za-z·]{1,8}(?:（[^）]*）)?)\s*[:：]/)
    if (m) roleStat[m[1]] = (roleStat[m[1]] || 0) + 1
  })
})
const roles = Object.keys(roleStat).sort((a, b) => roleStat[b] - roleStat[a])
roles.forEach((r) => console.log(`  ${r} ×${roleStat[r]}`))

// ---------- 6. 无冒号行（无法归属角色） ----------
console.log('\n===== 6. 无「角色：」前缀的行 =====')
let noRole = 0
res.segments.forEach((s) => {
  (s.lines || []).forEach((ln) => {
    const t = String(ln).trim()
    if (t && !/^([\u4e00-\u9fa5A-Za-z·]{1,8}(?:（[^）]*）)?)\s*[:：]/.test(t)) {
      noRole++
      if (noRole <= 15) console.log(`  ${s.name}: ${JSON.stringify(t).slice(0, 120)}`)
    }
  })
})
console.log(`共 ${noRole} 行无角色前缀`)

// ---------- 7. 抽样：第 84 集全部输出行 ----------
console.log('\n===== 7. 抽样：第 84 集输出行 =====')
const ep84 = res.segments.find((s) => String(s.name).indexOf('84') >= 0) || res.segments[3]
if (ep84) {
  console.log(`集名=${ep84.name} 行数=${(ep84.lines || []).length}`)
  ;(ep84.lines || []).forEach((ln, i) => console.log(`  ${String(i + 1).padStart(2)}| ${ln}`))
}
