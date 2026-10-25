/**
 * 零遗漏审计器（台词完整性·端到端）
 * ---------------------------------------------------------------
 * 硬约束：台词的条数、顺序、文字内容必须与源数据完全一致。
 * 任何「因长度限制 / 界面空间 / 截断 / 排版 / 性能」而丢弃、省略、
 * 合并、摘要台词的行为，都视为违规。空间不足只能用换行/滚动/分页解决。
 *
 * 用法：
 *   node zero_loss_audit.js <document.xml> [<document2.xml> ...]
 *
 * 检测项：
 *   ZL1 表格稿「台词列」源单元格 → 落库正文：必须逐条命中（条数+内容）
 *   ZL2 splitTableLegacy（无表头表格）被跳过的前导行是否含台词
 *   ZL3 落库正文 → parseScript 显示行：去空白后字符级全等（不丢字、不重复）
 *   ZL4 顺序一致性：显示行的出现顺序必须与源顺序一致
 *   ZL5 段落稿：源非空行必须全部出现在落库正文
 */
const fs = require('fs')
const path = require('path')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')

/** 去所有空白与不可见字符，用于「内容是否等价」比较（忽略折行/缩进差异） */
function squash(s) {
  return String(s || '').replace(/\s/g, '')
}

/** 判定某单元格是否属于「台词列」表头 */
const HEAD_RE = /台词|对白|内容|独白|口播|话术/

let PASS = 0
const FAILS = []
function fail(code, msg) {
  FAILS.push({ code, msg })
}
function ok(msg) {
  PASS++
  console.log('  ✅ ' + msg)
}

/** 从 blocks 里抽出「表格行」与「段落文本」 */
function collectSource(blocks) {
  const tables = []
  const paragraphs = []
  let pendingHeading = ''
  blocks.forEach((b) => {
    if (b.type === 'table') {
      tables.push({ rows: b.rows || [], headingBefore: pendingHeading })
      pendingHeading = ''
    } else if (b.type === 'paragraph') {
      const t = String(b.text || '').trim()
      if (t) {
        paragraphs.push(t)
        pendingHeading = t
      }
    }
  })
  return { tables, paragraphs }
}

/** 复现 splitTableScript 的「表头定位」判定，得到源台词池（代码自己认为的台词） */
function tableDialoguePool(tbl) {
  const rows = tbl.rows || []
  let headerIdx = -1
  let headerRow = null
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length >= 2 && row.some((c) => HEAD_RE.test(c || ''))) {
      headerIdx = r
      headerRow = row
      break
    }
  }
  if (headerIdx < 0) return { headerIdx, pool: [], skipped: judgeLegacySkipped(rows) }
  let dialogueCol = -1
  let roleCol = -1
  headerRow.forEach((c, idx) => {
    if (HEAD_RE.test(c || '')) dialogueCol = idx
    if (/^角色$|角色名|人物/.test(c || '')) roleCol = idx
  })
  if (dialogueCol < 0) {
    const cols = rows[0].length
    if (cols >= 4) dialogueCol = cols - 1
    else if (cols >= 3) dialogueCol = 2
    else dialogueCol = cols - 1
  }
  const pool = []
  rows.slice(headerIdx + 1).forEach((cells, i) => {
    const dlg = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
    const role = roleCol >= 0 && cells[roleCol] != null ? String(cells[roleCol]).trim() : ''
    if (!dlg && !role) return
    // 「无台词」是源数据显式标注的占位，不是台词，被过滤属正确行为，不计遗漏
    if (!role && isNoDialogueMark(dlg)) return
    pool.push({ dlg, role, rowNo: headerIdx + 2 + i })
  })
  return { headerIdx, pool, skipped: [] }
}

/** Legacy 路径下，代码会跳过的行（rows.slice(2) 或 slice(1)）——检查里面有没有台词 */
function judgeLegacySkipped(rows) {
  const firstRow = rows[0] || []
  const firstIsTitle = firstRow.length <= 1 && !HEAD_RE.test(firstRow[0] || '')
  const headerRow = firstIsTitle ? rows[1] || [] : firstRow
  const isHeader = headerRow.some((c) => HEAD_RE.test(c || ''))
  const skipped = !isHeader ? (rows.length > 2 ? rows.slice(0, 2) : rows.slice(0, 1)) : []
  return skipped.map((cells, i) => ({ cells, rowNo: i + 1 }))
}

/** 源数据里显式标注「无台词」的占位 —— 它不是台词，被过滤是正确行为，不计遗漏 */
function isNoDialogueMark(s) {
  const t = squash(s)
  if (!t) return true
  return /^(无台词|无对白|（无台词）|（无对白）|[-—－–·•]+)$/.test(t)
}

/** 元数据行：人物/场景/道具/时间/镜头/景别/备注 —— 不是台词 */
const META_PREFIX_RE = /^(人物|场景|道具|时间|时间段|镜头|景别|画面|备注|地点|服化|音乐|音效|场次|集数|拍摄|时长|集)\s*[:：]/

/** 单元格里是否「看起来像台词」：含说话人前缀，或是有句末标点的成句文本 */
function looksLikeDialogue(s) {
  const t = String(s || '').trim()
  if (!t) return false
  if (META_PREFIX_RE.test(t)) return false
  if (/^[（(【\[][^）)】\]]{0,12}[）)】\]]\s*[:：]/.test(t)) return true
  if (/^[\u4e00-\u9fa5A-Za-z·]{1,10}(（[^）]*）)?\s*[:：]/.test(t)) return true
  if (t.length >= 8 && /[。！？!?，,、]/.test(t)) return true
  return false
}

function auditFile(file) {
  const xml = fs.readFileSync(file, 'utf8')
  const blocks = util.extractDocxBlocks(xml)
  const src = collectSource(blocks)
  console.log(`\n########## ${path.basename(file)} ##########`)
  console.log(`  表格 ${src.tables.length} 个 / 段落 ${src.paragraphs.length} 条`)

  const res = util.splitScripts(blocks)
  const segs = (res && res.segments) || []
  const allLines = []
  segs.forEach((s) => (s.lines || []).forEach((l) => allLines.push(l)))
  const stored = segs.map((s) => (s.lines || []).join('\n')).join('\n')
  console.log(`  拆出 ${segs.length} 集 / ${allLines.length} 行 / 落库字符 ${stored.length}`)

  // ---------- ZL1 表格台词列全覆盖 ----------
  const stq = squash(stored)
  let zl1Miss = 0
  let zl1Total = 0
  const legacyTables = []
  src.tables.forEach((tbl, ti) => {
    const { pool, headerIdx, skipped } = tableDialoguePool(tbl)
    if (headerIdx < 0) legacyTables.push({ ti, skipped })
    pool.forEach((p) => {
      zl1Total++
      // 台词单元格里的多轮对白会被拆成多行，逐句校验（按「：」切开后逐段查）
      const pieces = util.splitDialogueCell(p.dlg ? (p.role ? p.role + '：' + p.dlg : p.dlg) : p.role)
      pieces.forEach((piece) => {
        const q = squash(piece)
        if (!q) return
        if (stq.indexOf(q) < 0) {
          zl1Miss++
          if (zl1Miss <= 6) {
            fail('ZL1', `表${ti + 1} R${p.rowNo} 台词未进入落库: "${String(piece).slice(0, 40)}"`)
          }
        }
      })
    })
  })
  if (zl1Miss === 0) ok(`ZL1 表格台词单元格 ${zl1Total} 条全部进入落库（零遗漏）`)
  else console.log(`  🔴 ZL1 丢失 ${zl1Miss} 条（共 ${zl1Total} 条源台词）`)

  // ---------- ZL2 Legacy 跳过行含台词 ----------
  let zl2Hit = 0
  legacyTables.forEach(({ ti, skipped }) => {
    skipped.forEach((sk) => {
      sk.cells.forEach((c) => {
        if (looksLikeDialogue(c) && squash(stored).indexOf(squash(c)) < 0) {
          zl2Hit++
          if (zl2Hit <= 6) fail('ZL2', `表${ti + 1} R${sk.rowNo} 被当前导行、疑似台词丢失: "${String(c).slice(0, 40)}"`)
        }
      })
    })
  })
  if (zl2Hit === 0) ok('ZL2 无表头表格的前导跳过行中不含遗漏台词')
  else console.log(`  🔴 ZL2 疑似丢失 ${zl2Hit} 条`)

  // ---------- ZL3 落库 → 解析 字符级全等 ----------
  let zl3Bad = 0
  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const parsed = parser.parseScript(content, { charsPerLine: 26, roleHighlight: true })
    const got = squash(
      parsed.lines
        .map((l) => (l.isSpacer ? '' : (l.rolePrefix || '') + (l.body != null ? l.body : l.text || '')))
        .join('')
    )
    const want = squash(content)
    if (got !== want) {
      zl3Bad++
      if (zl3Bad <= 3) {
        fail('ZL3', `第${s.ep}集 解析后字符与落库不一致: 落库${want.length}字 / 解析${got.length}字`)
      }
    }
  })
  if (zl3Bad === 0) ok(`ZL3 全部 ${segs.length} 集：落库正文 → 显示行 字符级全等（不丢字、不重复）`)
  else console.log(`  🔴 ZL3 ${zl3Bad} 集字符不一致`)

  // ---------- ZL4 顺序一致性 ----------
  let zl4Bad = 0
  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const parsed = parser.parseScript(content, { charsPerLine: 26, roleHighlight: true })
    const flat = squash(parsed.lines.filter((l) => !l.isSpacer).map((l) => l.text).join(''))
    const want = squash(content)
    if (flat !== want) zl4Bad++
  })
  if (zl4Bad === 0) ok(`ZL4 全部 ${segs.length} 集：显示行顺序与源一致（无错位、无合并）`)
  else console.log(`  🔴 ZL4 ${zl4Bad} 集顺序/内容错位`)

  // ---------- ZL5 段落稿非空行全覆盖（文档为段落稿时生效） ----------
  if (src.tables.length === 0) {
    let zl5Miss = 0
    src.paragraphs.forEach((p) => {
      if (squash(stored).indexOf(squash(p)) < 0) {
        zl5Miss++
        if (zl5Miss <= 5) fail('ZL5', `段落未进入落库: "${p.slice(0, 40)}"`)
      }
    })
    if (zl5Miss === 0) ok(`ZL5 段落稿 ${src.paragraphs.length} 条全部进入落库`)
    else console.log(`  🔴 ZL5 丢失 ${zl5Miss} 条段落`)
  }

  return { segs, stored }
}

const files = process.argv.slice(2).filter((f) => f.endsWith('.xml'))
if (!files.length) {
  console.log('用法: node zero_loss_audit.js <document.xml> [...]')
  process.exit(1)
}
files.forEach(auditFile)

console.log('\n================ 汇总 ================')
console.log(`通过检查项 ${PASS} / 失败 ${FAILS.length}`)
if (FAILS.length) {
  const byCode = {}
  FAILS.forEach((f) => (byCode[f.code] = (byCode[f.code] || 0) + 1))
  console.log('失败分布: ' + JSON.stringify(byCode))
  FAILS.slice(0, 20).forEach((f) => console.log(`  [${f.code}] ${f.msg}`))
}
