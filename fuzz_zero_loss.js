/**
 * 零遗漏·随机对拍测试（台词完整性）
 * ---------------------------------------------------------------
 * 真实文档只覆盖「有表头表格」路径；无表头（splitTableLegacy）、
 * 超长单元格（>600 字）、超长行（>120 字）、多列推断等分支靠随机数据补齐。
 *
 * 用法：node fuzz_zero_loss.js [轮次] [表格数] [种子]
 *
 * 对拍方式（关键）：
 *   源台词列由**生成器记录的 ground truth** 决定，不复用被测代码的推断逻辑。
 *   （上一版检测器复现了代码的列推断，结果自己也算错列，报出一堆假阳性。）
 *
 * 断言：
 *   ZL-A 零遗漏：源台词单元格必须逐条出现在落库正文
 *   ZL-B 零污染：落库正文里不得出现「非台词列」的内容（镜头号/景别等）
 *   ZL-C 零丢字：落库 → parseScript 显示行，字符级全等
 */
let SEED = 20260919
function rnd() {
  SEED |= 0
  SEED = (SEED + 0x6d2b79f5) | 0
  let t = Math.imul(SEED ^ (SEED >>> 15), 1 | SEED)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n) => Math.floor(rnd() * n)
const pick = (a) => a[int(a.length)]
const chance = (p) => rnd() < p

const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')

const squash = (s) => String(s || '').replace(/\s/g, '')
/** 「无台词」占位：不是台词 */
function isNoDialogueMark(s) {
  const t = squash(s)
  if (!t) return true
  return /^(无台词|无对白|（无台词）|（无对白）|[-—－–·•]+)$/.test(t)
}
/** 舞台/音效提示：整句被括号包裹（「（环境音：鸟叫）」「（静场三秒）」），不是台词 */
function isStageDirection(s) {
  const t = String(s || '').trim()
  if (!t) return true
  return /^[（(【\[][\s\S]*[）)】\]]$/.test(t)
}

const NAMES = ['杨凤', '王建华', '婆婆', '李阿姨', '小凤', '爸爸', '儿子', '儿媳妇', '张婶']
const MODS = ['', '（画外音）', '（小声）', '（叹气）', '（笑）']
const BODY = [
  '你今天回来得挺早啊。',
  '可不是嘛，厂里今天没什么事。',
  '饭在锅里热着，你自己盛。',
  '妈，我明天想去趟城里。',
  '去城里干啥，又要花钱。',
  '不花钱，就是看看。',
  '那你去吧，早点回来。',
  '哎，知道了。'
]
/** 非台词列的内容（镜头/景别/备注），用于污染检测 */
const NOISE = ['1', '中景', '全景', '推镜', '切', '无', '室内', '日', '2', '特写', '摇镜', '夜']

function makeBody(len) {
  let s = ''
  while (s.length < len) s += pick(BODY)
  return s.slice(0, Math.max(len, 4))
}

/**
 * 生成表格。返回 { rows, dlgCol, withHeader }
 * dlgCol 是「台词实际所在的列」= ground truth，对拍时不依赖被测代码的推断。
 */
function makeTable() {
  const cols = pick([2, 3, 4, 5])
  const withHeader = chance(0.6)
  const rows = []
  const lead = int(3)
  if (lead >= 1) rows.push(['第' + (81 + int(10)) + '集'])
  if (lead >= 2) rows.push(['人物：' + NAMES.slice(0, 3).join('、') + '　｜　场景：客厅　｜　道具：手机'])
  const header = ['镜头', '画面 / 动作', '台词', '备注'].slice(0, cols)
  let headerRowIdx = -1
  if (withHeader) {
    headerRowIdx = rows.length
    rows.push(header)
  }

  const dlgCol = withHeader ? Math.min(2, cols - 1) : cols - 1
  const dataRows = 3 + int(8)
  for (let i = 0; i < dataRows; i++) {
    const cells = []
    for (let c = 0; c < cols; c++) cells.push(pick(NOISE))
    if (chance(0.08)) {
      cells[dlgCol] = pick(['（无台词）', '无台词', '—'])
    } else if (chance(0.12)) {
      cells[dlgCol] = pick(['（无台词，画面转向窗外）', '（环境音：鸟叫）', '（静场三秒）'])
    } else {
      const name = pick(NAMES) + pick(MODS)
      const r = rnd()
      let len
      if (r < 0.15) len = 121 + int(160) // 触发 splitLongSentence
      else if (r < 0.18) len = 601 + int(400) // 触发「超 600 不拆」
      else len = 6 + int(90)
      cells[dlgCol] = name + '：' + makeBody(len)
      if (chance(0.25)) {
        cells[dlgCol] += (chance(0.5) ? ' ' : '') + pick(NAMES) + pick(MODS) + '：' + makeBody(6 + int(40))
      }
    }
    rows.push(cells)
  }
  return { rows, dlgCol, withHeader, cols, headerRowIdx, lead }
}

const round = parseInt(process.argv[2] || '1', 10)
const N = parseInt(process.argv[3] || '400', 10)
SEED = parseInt(process.argv[4] || '20260919', 10)

let totalCells = 0
let missCells = 0
let noiseHits = 0
let parseBad = 0
let legacyN = 0
const missSamples = []
const noiseSamples = []

for (let t = 0; t < N; t++) {
  const tbl = makeTable()
  const blocks = [{ type: 'table', rows: tbl.rows }]
  if (chance(0.2)) blocks.unshift({ type: 'paragraph', text: '第' + (81 + int(10)) + '集' })

  const res = util.splitScripts(blocks)
  const segs = (res && res.segments) || []
  if (!segs.length) continue
  const stored = segs.map((s) => (s.lines || []).join('\n')).join('\n')
  const stq = squash(stored)

  const firstRow = tbl.rows[0] || []
  const firstIsTitle = firstRow.length <= 1 && !/台词|对白|内容|独白|口播|话术/.test(firstRow[0] || '')
  const headerRow = firstIsTitle ? (tbl.rows[1] || []) : firstRow
  if (!headerRow.some((c) => /台词|对白|内容|独白|口播|话术/.test(c || ''))) legacyN++

  // ---------- ZL-A 零遗漏（ground truth 列） ----------
  tbl.rows.forEach((cells, ri) => {
    if (ri === tbl.headerRowIdx) return // 表头行本身不是台词
    const v = cells[tbl.dlgCol] != null ? String(cells[tbl.dlgCol]).trim() : ''
    if (!v || isNoDialogueMark(v) || isStageDirection(v)) return
    totalCells++
    util.splitDialogueCell(v).forEach((piece) => {
      const q = squash(piece)
      if (!q) return
      if (stq.indexOf(q) < 0) {
        missCells++
        if (process.env.DBG && missCells <= 2) {
          console.log('\n----- DBG 现场 -----')
          console.log(`withHeader=${tbl.withHeader} cols=${tbl.cols} dlgCol=${tbl.dlgCol} lead=${tbl.lead} 行数=${tbl.rows.length}`)
          tbl.rows.forEach((r, i) => console.log(`  R${i} [${r.length}列]: ${JSON.stringify(r).slice(0, 120)}`))
          console.log('  落库(前200字): ' + String(stored).slice(0, 200))
        }
        if (missSamples.length < 8) {
          missSamples.push(
            `${tbl.withHeader ? '有表头' : '无表头(Legacy)'} cols=${tbl.cols} R${ri} 丢失: "${String(piece).slice(0, 44)}"`
          )
        }
      }
    })
  })

  // ---------- ZL-B 零污染：落库里不得混入非台词列的短噪声 ----------
  if (stq.length && stq.length < 4000) {
    NOISE.forEach((n) => {
      if (n.length < 2) return
      if (stq.indexOf(n) >= 0) {
        noiseHits++
        if (process.env.DBG && noiseHits <= 2) {
          console.log('\n----- DBG 污染现场 -----')
          console.log(`withHeader=${tbl.withHeader} cols=${tbl.cols} dlgCol=${tbl.dlgCol} lead=${tbl.lead} headerRowIdx=${tbl.headerRowIdx} 行数=${tbl.rows.length}`)
          tbl.rows.forEach((r, i) => console.log(`  R${i} [${r.length}列]: ${JSON.stringify(r).slice(0, 100)}`))
          console.log('  落库(前300字): ' + String(stored).slice(0, 300))
        }
        if (noiseSamples.length < 6) noiseSamples.push(`落库混入非台词内容 "${n}"（cols=${tbl.cols} dlgCol=${tbl.dlgCol}）`)
      }
    })
  }

  // ---------- ZL-C 零丢字 ----------
  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const parsed = parser.parseScript(content, { charsPerLine: 26, roleHighlight: true })
    const got = squash(
      parsed.lines.map((l) => (l.isSpacer ? '' : (l.rolePrefix || '') + (l.body != null ? l.body : l.text || ''))).join('')
    )
    if (got !== squash(content)) {
      parseBad++
      if (parseBad <= 3) console.log(`  🔴 解析丢字: 落库${squash(content).length}字 / 解析${got.length}字`)
    }
  })
}

console.log(`\n===== 第 ${round} 轮（种子 ${SEED}）=====`)
console.log(`  随机表格 ${N} 个（无表头/Legacy ${legacyN} 个，占比 ${((legacyN / N) * 100).toFixed(1)}%）`)
console.log(`  源台词单元格 ${totalCells} 条`)
if (missCells === 0) console.log(`  ✅ ZL-A 零遗漏：${totalCells} 条源台词全部进入落库`)
else {
  console.log(`  🔴 ZL-A 丢失 ${missCells} 条（${((missCells / totalCells) * 100).toFixed(2)}%）`)
  missSamples.forEach((s) => console.log('       · ' + s))
}
if (noiseHits === 0) console.log('  ✅ ZL-B 零污染：落库未混入非台词列内容')
else {
  console.log(`  🔴 ZL-B 污染 ${noiseHits} 处`)
  noiseSamples.forEach((s) => console.log('       · ' + s))
}
console.log(parseBad === 0 ? `  ✅ ZL-C 零丢字（${N} 篇全部字符级全等）` : `  🔴 ZL-C 解析层丢字 ${parseBad} 处`)
