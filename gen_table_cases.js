/**
 * 台词表格随机测试样本生成器（带种子，可复现）
 *
 * 用法：node gen_table_cases.js [组数=64] [种子=20260919]
 * 产出：testcases/cases.json
 *
 * 设计红线：
 *   Ground Truth（源台词清单）**由生成器产出**，绝不复现被测代码的任何推断逻辑
 *   （列数、表头位置、说话人识别一律由生成器自己记录）。
 *   上一轮踩过的坑：审计器若复用被测代码的列推断，会跟着一起算错列，报出大量假阳性。
 *
 * 覆盖场景（每组一个主场景，同时随机混入其它特征）：
 *   S1 多人物交错对话
 *   S2 单人连续多段
 *   S3 超长台词（>120 / >600 字）
 *   S4 特殊标点与换行（单元格内软换行）
 *   S5 空行 / 空单元格
 *   S6 缺列（行长度不齐）
 *   S7 异常格式（无表头 / 表头居中 / 末行「无台词」/ 前置单列合并行 / 全空表 / 只有表头）
 *   S8 混合随机（人物名 × 台词内容随机组合）
 */
'use strict'
const fs = require('fs')
const path = require('path')

// ---------- 可复现随机 ----------
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let SEED = 20260919
let rnd = mulberry32(SEED)
const setSeed = (s) => { SEED = s; rnd = mulberry32(s) }
const int = (n) => Math.floor(rnd() * n)
const pick = (a) => a[int(a.length)]
const chance = (p) => rnd() < p
const range = (a, b) => a + int(b - a + 1)

// ---------- 语料 ----------
const SURNAME = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙', '马', '朱', '胡']
const GIVEN = ['建华', '小凤', '凤儿', '建军', '秀英', '春花', '大海', '明子', '小梅', '志强', '玉兰', '婷婷', '阿康', '子涵']
const KIN = ['婆婆', '儿媳妇', '公公', '小姑子', '大伯哥', '妈妈', '爸爸', '儿子', '女儿', '爷爷', '奶奶', '邻居', '老板', '同事', '医生', '老师']
const MODS = ['', '', '', '（画外音）', '（小声）', '（叹气）', '（笑）', '（哽咽）', '（手机里）', 'OS']

const CLAUSE = [
  '你今天回来得挺早啊',
  '可不是嘛，厂里今天没什么事',
  '饭在锅里热着，你自己盛',
  '妈，我明天想去趟城里',
  '去城里干啥，又要花钱',
  '不花钱，就是随便看看',
  '那你去吧，记得早点回来',
  '哎，知道了',
  '这事儿咱得从长计议',
  '你别总是一个人扛着',
  '我这不是怕你担心嘛',
  '担心有啥用，日子还得过',
  '你看这花儿开得多好',
  '是啊，今年雨水足',
  '等忙完这阵子我带你出去走走',
  '真的？可别又骗我',
  '骗你干啥，票我都看好了',
  '那我可当真了',
  '当真当真，一言为定',
  '这孩子，跟你还客气什么'
]
const PUNCT_END = ['。', '！', '？', '……']
const PUNCT_MID = ['，', '、', '；'] // 正文绝不能出现「：」——会与说话人前缀混淆，属生成器自造歧义
const SPECIAL = ['「', '」', '『', '』', '“', '”', '‘', '’', '——', '…', '《', '》', '·', '【', '】', '！', '？']
const NOISE = ['1', '中景', '全景', '推镜', '切', '无', '室内', '日', '2', '特写', '摇镜', '夜', '跟拍', '外']
const NO_DIALOGUE = ['（无台词）', '无台词', '—', '（无对白）']

// ---------- 构造人物名 ----------
function makeName() {
  const r = rnd()
  if (r < 0.4) return pick(SURNAME) + pick(GIVEN)
  if (r < 0.7) return pick(KIN)
  if (r < 0.85) return pick(SURNAME) + pick(SURNAME) // 复姓感
  return pick(GIVEN)
}
function makeSpeaker() {
  const name = makeName()
  const mod = pick(MODS)
  return { name: name, mod: mod, pre: name + mod + '：' }
}

// ---------- 构造台词正文 ----------
/** 正文不含「：」，避免与说话人前缀混淆导致断言歧义 */
function makeBody(minLen, maxLen, opt) {
  opt = opt || {}
  let s = ''
  const target = range(minLen, maxLen)
  while (s.length < target) {
    let c = pick(CLAUSE)
    if (opt.special && chance(0.5)) {
      // 随机插入特殊标点
      const p = pick(SPECIAL)
      const at = int(Math.max(1, c.length - 1))
      c = c.slice(0, at) + p + c.slice(at)
    }
    if (opt.breakLine && chance(0.25) && s.length > 0) s += '\n'
    s += c + pick(PUNCT_END)
    if (chance(0.3)) s += pick(PUNCT_MID)
  }
  let out = s.slice(0, Math.max(target, 4))
  // 收尾规范化：正文不能以句中标点（尤其是「：」）结尾，否则会被当成下一个说话人的前缀
  while (out.length > 1 && PUNCT_MID.indexOf(out[out.length - 1]) >= 0) out = out.slice(0, -1)
  if (!PUNCT_END.some((e) => out.endsWith(e))) out += pick(PUNCT_END)
  return out
}

// ---------- 构造一个台词单元格 ----------
/**
 * @returns {{cell:string, units:Array<{speaker:string, text:string, adherent:boolean}>, isStage:boolean}}
 *  units 即 Ground Truth：每个说话人一段台词。
 *  adherent=true 表示该段与前一段粘连（中间无分隔），代码按设计不拆 → 不计入人物错配。
 */
function makeDialogueCell(opt) {
  opt = opt || {}
  if (opt.stage && chance(0.8)) {
    const s = pick(['（环境音：窗外的鸟叫）', '（静场三秒）', '（无台词，画面转向窗外）'])
    return { cell: s, units: [], isStage: true }
  }
  if (chance(0.06)) {
    const s = pick(NO_DIALOGUE)
    return { cell: s, units: [], isStage: false, noDialogue: true }
  }
  const n = opt.nSpeakers || (chance(0.55) ? 1 : chance(0.7) ? 2 : 3)
  const lenMin = opt.lenMin || 8
  const lenMax = opt.lenMax || 90
  const parts = []
  const units = []
  for (let i = 0; i < n; i++) {
    const sp = makeSpeaker()
    const body = makeBody(lenMin, lenMax, opt)
    parts.push({ pre: sp.pre, name: sp.name, body: body })
    units.push({ speaker: sp.name, text: body, adherent: i > 0 && opt.adherent === true })
  }
  // 连接：分隔（可拆）或粘连（设计上不拆）
  let cell = parts[0].pre + parts[0].body
  for (let i = 1; i < parts.length; i++) {
    let glue
    if (opt.adherent) glue = ''
    else glue = chance(0.5) ? ' ' : '。'
    cell += glue + parts[i].pre + parts[i].body
    units[i].adherent = glue === ''
  }
  return { cell: cell, units: units, isStage: false }
}

// ---------- 场景定义 ----------
const SCENARIOS = [
  { id: 'S1', desc: '多人物交错对话', opt: { nSpeakers: 3, lenMin: 8, lenMax: 60 } },
  { id: 'S2', desc: '单人连续多段', opt: { nSpeakers: 1, lenMin: 10, lenMax: 70 } },
  { id: 'S3', desc: '超长台词（>120 字）', opt: { nSpeakers: 1, lenMin: 121, lenMax: 320, long: true } },
  { id: 'S4', desc: '特殊标点与换行', opt: { nSpeakers: 2, lenMin: 20, lenMax: 100, special: true, breakLine: true } },
  { id: 'S5', desc: '空行 / 空单元格', opt: { nSpeakers: 2, lenMin: 8, lenMax: 50, emptyRate: 0.45 } },
  { id: 'S6', desc: '缺列（行长度不齐）', opt: { nSpeakers: 2, lenMin: 8, lenMax: 60, ragged: true } },
  { id: 'S7', desc: '异常格式（无表头/表头居中/末行无台词/前置合并行）', opt: { nSpeakers: 2, lenMin: 8, lenMax: 60, abnormal: true } },
  { id: 'S8', desc: '混合随机（人物名 × 台词随机组合）', opt: { lenMin: 6, lenMax: 130 } }
]

const HEADER_SETS = [
  ['镜头', '画面 / 动作', '台词', '备注'],
  ['镜号', '景别', '画面', '台词'],
  ['人物', '台词'],
  ['角色', '台词', '道具'],
  ['序号', '画面', '台词', '音乐']
]

// ---------- 生成一张表 ----------
function makeTable(scn, caseId, ti) {
  const o = scn.opt || {}
  const cols = range(2, 5)
  const withHeader = o.abnormal ? chance(0.35) : chance(0.75)
  const rows = []
  const gt = [] // Ground Truth：{rowIdx, cell, units, isStage, noDialogue}

  // 前置：集标题 / 人物场景行（单列合并行）—— 异常格式场景必带
  const lead = o.abnormal ? range(1, 2) : (chance(0.5) ? range(1, 2) : 0)
  for (let i = 0; i < lead; i++) {
    if (i === 0) rows.push(['第' + range(1, 20) + '集'])
    else rows.push(['人物：' + makeName() + '、' + makeName() + '　｜　场景：客厅　｜　道具：手机'])
  }

  let headerRowIdx = -1
  let dlgCol = cols - 1
  let roleCol = -1
  let header = null
  if (withHeader) {
    header = pick(HEADER_SETS).slice(0, cols)
    // 保证表头里一定有一列叫「台词」
    if (!header.some((c) => c === '台词')) header[Math.min(2, cols - 1)] = '台词'
    const idx = header.indexOf('台词')
    dlgCol = idx >= 0 ? idx : Math.min(2, cols - 1)
    // 表头里若有「人物/角色」列，代码会把它当说话人拼在台词前。
    // 生成器必须往这一列填**真实姓名**，填噪音（如「2」）会造出「2：小姑子：台词」
    // 这种源数据里根本不存在的畸形行 —— 那是生成器的错，不是代码的错。
    const ri = header.indexOf('人物')
    roleCol = ri >= 0 ? ri : header.indexOf('角色')
  }

  // 异常场景：表头出现在表格中部（前面先写几行数据）。
  // 关键：这些行的**列必须与表头一致**（台词放 dlgCol，人物放 roleCol），
  // 否则等于源表格自己列错位，测出来的问题不属于被测代码。
  if (withHeader && o.abnormal && chance(0.4)) {
    const dOpt = roleCol >= 0 ? Object.assign({}, o, { nSpeakers: 1 }) : o
    const pad = range(1, 2)
    for (let k = 0; k < pad; k++) {
      const d = makeDialogueCell(dOpt)
      const cells = []
      for (let c = 0; c < cols; c++) cells.push(pick(NOISE))
      if (roleCol >= 0 && d.units[0]) cells[roleCol] = d.units[0].speaker
      cells[dlgCol] = d.cell
      rows.push(cells)
      gt.push({ rowIdx: rows.length - 1, cell: d.cell, units: d.units, isStage: d.isStage, noDialogue: d.noDialogue, col: dlgCol })
    }
  }

  if (withHeader) {
    rows.push(header)
    headerRowIdx = rows.length - 1
  }

  // 数据行
  const dataRows = range(4, 12)
  for (let i = 0; i < dataRows; i++) {
    // 空行 / 空单元格
    if (o.emptyRate && chance(o.emptyRate)) {
      const cells = []
      const n = o.ragged ? range(1, cols) : cols
      for (let c = 0; c < n; c++) cells.push('')
      rows.push(cells)
      continue
    }
    let d
    // 有「人物/角色」列时只放一个说话人（该列只能写一个名字，多说话人会自造歧义）
    const dOpt = roleCol >= 0 ? Object.assign({}, o, { nSpeakers: 1 }) : o
    if (o.long && chance(0.5)) d = makeDialogueCell(Object.assign({}, dOpt, { lenMin: 601, lenMax: 900 }))
    else d = makeDialogueCell(dOpt)

    // 缺列：行可以短，但**台词列必须存在**（n > dlgCol），
    // 否则源表格里根本没有这一格，台词丢了属于「源数据里就没有」，不是被测代码的问题。
    const n = o.ragged ? range(Math.min(dlgCol + 1, cols), cols) : cols
    const cells = []
    for (let c = 0; c < n; c++) cells.push(pick(NOISE))
    cells[dlgCol] = d.cell
    if (roleCol >= 0 && roleCol < n && d.units[0]) cells[roleCol] = d.units[0].speaker
    rows.push(cells)
    gt.push({ rowIdx: rows.length - 1, cell: d.cell, units: d.units, isStage: d.isStage, noDialogue: d.noDialogue, col: dlgCol })
  }

  // 异常：末行是「无台词」（曾导致整篇台词被误判为表头之前而全丢）
  if (o.abnormal && chance(0.5)) {
    const cells = []
    for (let c = 0; c < cols; c++) cells.push(pick(NOISE))
    cells[dlgCol] = pick(NO_DIALOGUE)
    rows.push(cells)
    gt.push({ rowIdx: rows.length - 1, cell: cells[dlgCol], units: [], isStage: false, noDialogue: true, col: dlgCol })
  }

  return { rows: rows, cols: cols, withHeader: withHeader, headerRowIdx: headerRowIdx, dlgCol: dlgCol, roleCol: roleCol, gt: gt }
}

function makeCase(i, scn) {
  const id = 'C' + String(i + 1).padStart(3, '0')
  const nTables = chance(0.25) ? 2 : 1
  const tables = []
  for (let t = 0; t < nTables; t++) tables.push(makeTable(scn, id, t))
  return {
    id: id,
    scenario: scn.id,
    desc: scn.desc,
    nTables: nTables,
    tables: tables
  }
}

// ---------- 主流程 ----------
function main() {
  const nGroups = parseInt(process.argv[2] || '64', 10)
  const seed = parseInt(process.argv[3] || '20260919', 10)
  setSeed(seed)

  const cases = []
  // 每个场景均分，保证 8 类边界全覆盖
  const per = Math.max(4, Math.round(nGroups / SCENARIOS.length))
  let i = 0
  for (const scn of SCENARIOS) {
    for (let k = 0; k < per; k++) { cases.push(makeCase(i++, scn)); if (cases.length >= nGroups) break }
    if (cases.length >= nGroups) break
  }
  while (cases.length < nGroups) cases.push(makeCase(i++, pick(SCENARIOS)))

  const outDir = path.join(__dirname, 'testcases')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir)
  const outFile = path.join(outDir, 'cases.json')
  fs.writeFileSync(outFile, JSON.stringify({ seed: seed, count: cases.length, cases: cases }, null, 1), 'utf8')

  // 统计
  let gtUnits = 0
  let gtCells = 0
  const byScn = {}
  cases.forEach((c) => {
    byScn[c.scenario] = (byScn[c.scenario] || 0) + 1
    c.tables.forEach((t) => {
      t.gt.forEach((g) => { gtCells++; gtUnits += g.units.length })
    })
  })
  console.log('样本组数：' + cases.length + '  种子：' + seed)
  console.log('场景分布：' + JSON.stringify(byScn))
  console.log('台词单元格：' + gtCells + '  Ground Truth 台词条数：' + gtUnits)
  console.log('输出：' + outFile)
}
main()
