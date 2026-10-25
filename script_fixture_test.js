'use strict'
/**
 * 台词拆分 · 分类测试台
 * ------------------------------------------------------------------
 * 拿「从网络收集的多类型台词本样本」跑小程序产品的真实拆分链路，逐项验证。
 *
 *   纯文本稿 fixtures/text/*.txt
 *     → smartSplitScripts(text)              （自动识边界：系列名+N / 第N集 / 空行）
 *     → splitImportBlocks(text, mode)        （mode = headings | blank | size）
 *
 *   表格稿 fixtures/table/*.xml（docx OOXML，由 table_specs.js 生成）
 *     → extractDocxBlocks(xml) → splitScripts(blocks)                    （智能多模态）
 *                              → splitScripts(blocks, {mode:'wukong'})   （悟空脚本专属）
 *
 * 逐项断言：
 *   文本路径 P1 不抛异常 / P2 零丢字 / P3 块非空且标题非空
 *   表格路径 Q1 集数守恒 / Q2 集名正确 / Q3 零丢字（两种模式各自口径）
 *            Q4 无粘连 / Q5 角色归属可识别率 / Q6 占位行策略 / Q7 表头前台词救回
 *
 * 用法：node script_fixture_test.js [--json out.json]
 */
const fs = require('fs')
const path = require('path')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')
const { SPECS, buildDoc } = require('./fixtures/table_specs.js')

const ROOT = __dirname
const TEXT_DIR = path.join(ROOT, 'fixtures', 'text')
const TABLE_DIR = path.join(ROOT, 'fixtures', 'table')

const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, '')
const nl = (s) => String(s == null ? '' : s)

let PASS = 0, FAIL = 0
const FAILS = []
const SOFT = []      // 探针样本的「已知限制」（不计入硬失败，单列）
const INFO = []      // 每条记录的实测事实（供报告用）
function ok(cond, name, detail, soft) {
  if (cond) { PASS++; return true }
  if (soft) { SOFT.push({ name, detail: detail || '' }); return false }
  FAIL++
  FAILS.push({ name, detail: detail || '' })
  return false
}
function note(x) { INFO.push(x) }

// ==================== 一、表格稿 ====================
// 每张表的「期望口径」：header = 表头行下标（-1 表示无表头）；dlg = 台词列下标；
// role = 角色列下标（-1 无）；mergeRole = 多模态是否把角色列合并进正文（悟空不合并）。
const TEXP = {
  T1:  { eps: 2, titles: ['第81集', '第82集'], tables: [{ header: 1, dlg: 2, role: -1 }] },
  T2:  { eps: 1, titles: ['第1集'],             tables: [{ header: 0, dlg: 4, role: -1 }] },
  T3:  { eps: 1, titles: ['第一段'],            tables: [{ header: 0, dlg: 1, role: 0 }] },
  T4:  { eps: 1, titles: ['第一幕'],            tables: [{ header: 0, dlg: 1, role: 0 }] },
  T5:  { eps: 1, titles: ['第90集'],            tables: [{ header: -1, dlg: 2, role: -1 }] },
  T5b: { eps: 1, titles: ['第91集'],            tables: [{ header: -1, dlg: 2, role: -1 }], probe: true },
  T6:  { eps: 1, titles: ['第7集'],             tables: [{ header: 3, dlg: 2, role: -1 }] },
  T7:  { eps: 1, titles: ['第3集'],             tables: [{ header: 0, dlg: 2, role: -1 }] },
  T8:  { eps: 1, titles: ['第5集'],             tables: [{ header: 0, dlg: 2, role: -1 }] }
}

/** 从 spec 行数组算「期望台词行」（独立实现，不复用产品内部函数） */
function expectedLines(rows, exp, mergeRole) {
  const out = []
  rows.forEach((cells, ri) => {
    if (exp.header >= 0 && ri === exp.header) return
    if (cells.length < 2) return // 单列合并行（集标题 / 人物｜场景）不是台词
    if (mergeRole && exp.role >= 0) {
      const rn = String(cells[exp.role] == null ? '' : cells[exp.role]).trim()
      const d = String(cells[exp.dlg] == null ? '' : cells[exp.dlg]).trim()
      if (rn) { out.push(d ? rn + '：' + d : rn); return }
    }
    nl(cells[exp.dlg]).split('\n').forEach((ln) => { const s = ln.trim(); if (s) out.push(s) })
  })
  return out
}

fs.mkdirSync(TABLE_DIR, { recursive: true })
SPECS.forEach((s) => fs.writeFileSync(path.join(TABLE_DIR, s.id + '.xml'), buildDoc(s.spec)))

console.log('==================== 一、表格稿（docx 表格拆分路径）====================\n')

let tableTotal = 0, tableOk = 0, tableProbe = 0
SPECS.forEach((s) => {
  const exp = TEXP[s.id]
  const xml = buildDoc(s.spec)
  const blocks = util.extractDocxBlocks(xml)
  const tables = blocks.filter((b) => b.type === 'table')
  const mm = util.splitScripts(blocks)
  const wk = util.splitScripts(blocks, { mode: 'wukong' })

  const tag = s.id + ' ' + s.genre
  const checks = []
  checks.push(['Q1 集数守恒', exp.eps, mm.segments.length])
  checks.push(['Q1 集数守恒(悟空)', exp.eps, wk.segments.length])

  // Q2 集名
  exp.titles.forEach((t, i) => {
    checks.push(['Q2 集名#' + (i + 1) + '=' + t, t, (mm.segments[i] || {}).name])
  })

  // Q3 零丢字：逐表压平比对
  let mmLoss = null, wkLoss = null
  ;(s.spec.blocks.filter((b) => b.table) || []).forEach((b, ti) => {
    const t = exp.tables[Math.min(ti, exp.tables.length - 1)]
    // 多模态期望值必须与产品同源：多模态会把「名｢台词｣」规范化成「名：台词」（P4 修复），
    // 所以源侧也要先跑同一函数，否则把**规范化**误判成丢字。
    // 判定仍然字符级严格：规范化之后的每一个字符都必须还在，真丢字照样会被抓出来。
    const srcMM = expectedLines(b.table, t, true)
      .map((l) => util.normalizeCornerQuote(l))
      .join('\n').split('\n').map((l) => l.trim()).filter((l) => l)
      .filter((l) => !util.isPlaceholderLine(l))
    const srcWK = expectedLines(b.table, t, false)
    const outMM = ((mm.segments[ti] || {}).lines || [])
    const outWK = ((wk.segments[ti] || {}).lines || [])
    if (squash(srcMM.join('\n')) !== squash(outMM.join('\n'))) mmLoss = { ti: ti + 1, src: srcMM, out: outMM }
    if (squash(srcWK.join('\n')) !== squash(outWK.join('\n'))) wkLoss = { ti: ti + 1, src: srcWK, out: outWK }
  })
  checks.push(['Q3 零丢字(多模态)', 'ok', mmLoss ? 'LOSS@表' + mmLoss.ti : 'ok'])
  checks.push(['Q3 零丢字(悟空)', 'ok', wkLoss ? 'LOSS@表' + wkLoss.ti : 'ok'])

  // Q4 无粘连：多模态输出行里不应含第二个「白名单说话人+冒号」——
  // 必须排除「联合说话人」组（「王建华、杨凤：」是合法前缀，切点在行首不算粘连），
  // 判定直接调产品 resolveJointCut，保证与解析同源（否则会把合法联合误报成粘连）。
  const known = util.collectSpeakerNames(tables)
  let glued = null
  ;(mm.segments || []).forEach((seg) => {
    ;(seg.lines || []).forEach((ln) => {
      Object.keys(known).forEach((n) => {
        const p = ln.indexOf(n + '：')
        if (p > 0 && !util.insideQuote(ln, p) && util.resolveJointCut(ln, p, known) > 0 && !glued) {
          glued = n + ' @「' + ln.slice(0, 40) + '」'
        }
      })
    })
  })
  checks.push(['Q4 无粘连(多模态)', 'ok', glued ? 'GLUE ' + glued : 'ok'])

  // Q5 角色归属可识别率（多模态）
  let covRows = []
  ;(mm.segments || []).forEach((seg) => {
    const parsed = parser.parseScript((seg.lines || []).join('\n'), { roleHighlight: true })
    const named = parsed.lines.filter((l) => !l.isSpacer && String(l.text || '').trim())
    const withRole = named.filter((l) => l.role)
    covRows.push({ ep: seg.name, total: named.length, withRole: withRole.length })
  })
  const totNamed = covRows.reduce((a, r) => a + r.total, 0)
  const totRole = covRows.reduce((a, r) => a + r.withRole, 0)

  // Q6 占位行策略：多模态过滤、悟空保留
  const hasPlaceholder = (arr) => arr.some((l) => util.isPlaceholderLine(l))
  const mmHasPh = (mm.segments || []).some((sg) => hasPlaceholder(sg.lines || []))
  const wkHasPh = (wk.segments || []).some((sg) => hasPlaceholder(sg.lines || []))
  if (s.id === 'T7') {
    checks.push(['Q6 多模态过滤占位行', false, mmHasPh])
    checks.push(['Q6 悟空保留占位行', true, wkHasPh])
  }

  // Q7 表头前台词救回（T6）
  if (s.id === 'T6') {
    const allMM = (mm.segments[0] || {}).lines || []
    checks.push(['Q7 表头前台词救回', true, allMM.some((l) => l.indexOf('老王：这个方案') === 0)])
    checks.push(['Q7 表头前台词救回2', true, allMM.some((l) => l.indexOf('小张：能，下午三点前') === 0)])
  }

  // 汇总本样本（probe 样本的失败记为「已知限制」，不计入硬失败）
  let bad = 0
  checks.forEach(([name, want, got]) => {
    const cond = String(want) === String(got)
    if (!ok(cond, tag + ' · ' + name, '期望=' + want + ' 实际=' + got, exp.probe)) {
      if (!exp.probe) bad++
    }
  })
  note({
    kind: 'table', id: s.id, genre: s.genre, note: s.note,
    eps: mm.segments.length,
    titles: (mm.segments || []).map((x) => x.name),
    mmLines: (mm.segments || []).map((x) => x.lineCount),
    wkLines: (wk.segments || []).map((x) => x.lineCount),
    roleCov: totNamed ? (totRole + '/' + totNamed) : '0/0',
    roleDetail: covRows,
    probe: !!exp.probe
  })
  const mark = exp.probe ? '⚠️' : (bad ? '❌' : '✅')
  if (exp.probe) tableProbe++; else { tableTotal++; if (!bad) tableOk++ }
  console.log(mark + ' ' + tag +
    '  集=' + mm.segments.length + ' 多模态行=[' + (mm.segments || []).map((x) => x.lineCount).join(',') +
    '] 悟空行=[' + (wk.segments || []).map((x) => x.lineCount).join(',') + '] 角色覆盖=' + totRole + '/' + totNamed)
  if (bad) {
    checks.forEach(([name, want, got]) => {
      if (String(want) !== String(got)) console.log('     ✗ ' + name + '  期望=' + want + ' 实际=' + got)
    })
  }
  if (exp.probe || bad) {
    if (mmLoss) console.log('      多模态源: ' + JSON.stringify(mmLoss.src) + '\n      多模态出: ' + JSON.stringify(mmLoss.out))
    if (wkLoss) console.log('      悟空源: ' + JSON.stringify(wkLoss.src) + '\n      悟空出: ' + JSON.stringify(wkLoss.out))
  }
})

// ==================== 二、纯文本稿 ====================
console.log('\n==================== 二、纯文本稿（文本导入拆分路径）====================\n')

/**
 * 标题行判定 —— **必须与产品 splitImportBlocks 的 isHeading 同口径**：
 *   isHeading = HEAD_LINE_RE || HEAD_WORD_RE
 * 产品 HEAD_LINE_RE 的类别字是 [集场章节回幕篇部季话]（含 幕/场！），
 * 早先这里误抄成 EP_HEAD_RE 的 [集期话卷部]，导致「第一幕/第二幕」被
 * 误判成「非标题」，把产品的正确剥离当成丢字 —— 判定脚本自身的缺陷。
 */
const IS_HEAD = (t) => {
  const s = String(t || '').trim()
  const HEAD_LINE_RE = /^[【\[]?\s*第\s*[0-9０-９一二三四五六七八九十百千万零两]+\s*(?:[集场章节回幕篇部季话]|部分)[】\]]?/
  const HEAD_WORD_RE = /^[【\[]?\s*(?:序|序章|楔子|引子|题记|尾声|终章|片头|片尾|花絮|彩蛋|正片|预告)[】\]]?/
  return HEAD_LINE_RE.test(s) || HEAD_WORD_RE.test(s)
}

/** 依据输出块重建正文：titleWhen(p) 为真时把标题算作正文（headings 模式的标题行被剥离进 title） */
function recon(parts, titleWhen) {
  return parts.map((p) => ((titleWhen && titleWhen(p)) ? p.title + '\n' : '') + p.content).join('\n')
}

const textFiles = fs.readdirSync(TEXT_DIR).filter((f) => f.endsWith('.txt')).sort()
let textTotal = 0, textOk = 0
textFiles.forEach((f) => {
  const raw = fs.readFileSync(path.join(TEXT_DIR, f), 'utf8')
  const name = f.replace(/\.txt$/, '')
  let bad = 0
  const rec = { kind: 'text', id: name, smart: 0, headings: 0, blank: 0, size: 0 }

  // smartSplitScripts
  let smart = []
  try { smart = util.smartSplitScripts(raw) } catch (e) { ok(false, name + ' · smart 抛异常', String(e)) ; bad++ }
  ok(Array.isArray(smart), name + ' · P1 smart 返回数组', typeof smart)
  const smartNonEmpty = smart.every((p) => p.title && p.content)
  ok(smartNonEmpty, name + ' · P3 smart 块标题/内容非空', JSON.stringify(smart.map((p) => [p.title, p.content.length])))
  const smartGot = recon(smart, null)
  const smartLoss = squash(raw) === squash(smartGot)
  ok(smartLoss, name + ' · P2 smart 零丢字', smartLoss ? '' : diffHint(raw, smartGot))
  rec.smart = smart.length
  if (!smartNonEmpty || !smartLoss) bad++

  // splitImportBlocks 三种模式
  const modes = [
    ['headings', false],
    ['blank', false],
    ['size', false]
  ]
  let modeSummary = []
  modes.forEach(([mode]) => {
    let parts = []
    try { parts = util.splitImportBlocks(raw, mode, 800) } catch (e) { ok(false, name + ' · ' + mode + ' 抛异常', String(e)); bad++ }
    ok(Array.isArray(parts), name + ' · P1 ' + mode + ' 返回数组', typeof parts)
    const nonEmpty = parts.length === 0 || parts.every((p) => p.title && p.content)
    ok(nonEmpty, name + ' · P3 ' + mode + ' 块非空', JSON.stringify(parts.map((p) => [p.title, p.content.length])))
    // headings 模式：命中标题的行被剥离进 title（重建时补回）；其余模式标题是自动摘要，不补
    const got = recon(parts, mode === 'headings' ? ((p) => IS_HEAD(p.title)) : null)
    const loss = squash(raw) === squash(got)
    ok(loss, name + ' · P2 ' + mode + ' 零丢字', loss ? '' : diffHint(raw, got))
    rec[mode] = parts.length
    modeSummary.push(mode + '=' + parts.length)
    if (!nonEmpty || !loss) bad++
  })

  textTotal++
  if (!bad) textOk++
  console.log((bad ? '❌' : '✅') + ' ' + name + '  smart=' + rec.smart + '  ' + modeSummary.join(' '))
  note(rec)
})

function diffHint(src, got) {
  const a = squash(src), b = squash(got)
  let k = 0
  while (k < Math.min(a.length, b.length) && a[k] === b[k]) k++
  return '首处差异@' + k + ' 源「' + a.slice(Math.max(0, k - 12), k + 18) + '」 出「' + b.slice(Math.max(0, k - 12), k + 18) + '」'
}

// ==================== 三、边界专项 ====================
console.log('\n==================== 三、边界专项（格式变体与极端输入）====================\n')

const E = (s) => s
const OO = (inner) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + inner + '</w:body></w:document>'
const pXml = (t) => (t === '' || t == null ? '<w:p/>'
  : '<w:p><w:r><w:t xml:space="preserve">' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</w:t></w:r></w:p>')
const tcXml = (inner) => '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' + inner + '</w:tc>'
const rowXml = (cells) => '<w:tr>' + cells.map((c) => tcXml((c && c.raw) ? c.raw : pXml(c))).join('') + '</w:tr>'
const tblXml = (rows) => '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' + rows.map(rowXml).join('') + '</w:tbl>'
const linesOf = (mm) => (mm.segments[0] || {}).lines || []

let edgeTotal = 0, edgeOk = 0
function edgeCase(name, fn) {
  let bad = 0
  const before = FAIL
  fn((cond, nm, dt) => { if (!ok(cond, nm, dt)) bad++ })
  edgeTotal++; if (FAIL === before) edgeOk++
  console.log((bad ? '❌' : '✅') + ' ' + name)
}
let EDGE = 0

// B1：台词列表头的同义列名都应被识别（台词/对白/内容/独白/口播/话术）
edgeCase('B1 台词列表名变体', (okc) => {
  ['台词', '对白', '内容', '独白', '口播', '话术'].forEach((h) => {
    const rows = [['角色', h], ['甲', '一。'], ['乙', '二。']]
    const mm = util.splitScripts(util.extractDocxBlocks(OO(tblXml(rows))))
    const got = linesOf(mm).join('|')
    okc(got === '甲：一。|乙：二。', 'B1 列名「' + h + '」→台词列', got)
    EDGE++
  })
})

// B2：台词正文里出现「第3集」字样，不应被误判为分集边界
edgeCase('B2 正文含「第N集」不误切', (okc) => {
  const t = '第1集\n甲：第一集的话。\n乙：好。\n第2集\n甲：他说“我们第3集见”。\n乙：嗯。\n'
  const smart = util.smartSplitScripts(t)
  okc(smart.length === 2, 'B2 应切成 2 集', 'smart=' + smart.length + ' titles=' + smart.map((x) => x.title).join(','))
  okc(squash(smart.map((x) => x.content).join('')).indexOf(squash('我们第3集见')) >= 0, 'B2 正文「第3集」保留', '')
})

// B3：空 / 纯空白 / 空块 不崩
edgeCase('B3 空输入不崩', (okc) => {
  okc(util.splitImportBlocks('', 'headings', 800).length === 0, 'B3 空文本 headings → []', '')
  okc(util.smartSplitScripts('   \n\n  ').length === 0, 'B3 纯空白 smart → []', '')
  okc(util.splitScripts([]).ok === false, 'B3 空块 splitScripts → ok:false', '')
  okc(util.splitDialogueCell('').length === 1, 'B3 splitDialogueCell("") 不崩', '')
})

// B4：表头出现在表格「末行」（其后无数据）→ 不得把表头之前的台词吞掉
edgeCase('B4 表头在末行', (okc) => {
  const rows = [['第9集'], ['1', '【近景】她抬头', '她：天亮了。'], ['2', '【近景】他', '他：嗯。'], ['镜号', '画面', '台词']]
  const mm = util.splitScripts(util.extractDocxBlocks(OO(tblXml(rows))))
  const ls = linesOf(mm)
  okc(ls.some((l) => l.indexOf('她：天亮了') === 0), 'B4 表头前台词「她：天亮了。」保留', JSON.stringify(ls))
  okc(ls.some((l) => l.indexOf('他：嗯') === 0), 'B4 表头前台词「他：嗯。」保留', JSON.stringify(ls))
})

// B5：单元格内的段落边界（</w:p><w:p>）与软换行（<w:br/>）都应拆成多行
edgeCase('B5 段落边界/软换行拆行', (okc) => {
  const rows = [
    ['镜头', '画面', '台词', '备注'],
    ['1', 'a', { raw: pXml('A：一。') + pXml('B：二。') }, ''],
    ['2', 'b', { raw: '<w:p><w:r><w:t>A：三。</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>B：四。</w:t></w:r></w:p>' }, '']
  ]
  const got = linesOf(util.splitScripts(util.extractDocxBlocks(OO(tblXml(rows)))))
  okc(got.length === 4 && got.join('|') === 'A：一。|B：二。|A：三。|B：四。', 'B5 段内 4 行', JSON.stringify(got))
})

// B6：含「角色」列，且台词格里还有第二说话人 → 合并后仍应拆成两行
edgeCase('B6 角色列 + 同格第二说话人', (okc) => {
  const rows = [['角色', '台词'], ['杨凤', '你吃几串了？王建华：才3串。']]
  const got = linesOf(util.splitScripts(util.extractDocxBlocks(OO(tblXml(rows)))))
  okc(got.length === 2 && got[0].indexOf('杨凤：') === 0 && got[1].indexOf('王建华：') === 0, 'B6 拆成 2 行且各自带角色', JSON.stringify(got))
})

// B7：占位行「无」（分镜表常见）当前是否被当占位行（信息项，用于报告）
edgeCase('B7 占位形态盘点', (okc) => {
  const forms = ['无', '（无台词）', '无台词', '—', '-', '（无对白）', 'N/A', '/']
  const recognized = forms.map((f) => f + ':' + (util.isPlaceholderLine(f) ? 'Y' : 'N'))
  okc(true, 'B7 占位识别（信息）', '')
  console.log('     占位识别：' + recognized.join('  '))
  note({ kind: 'edge', id: 'B7', forms: recognized })
})

// ==================== 汇总 ====================
console.log('\n==================== 汇总 ====================')
console.log('表格稿：' + tableOk + '/' + tableTotal + ' 个样本全项通过' + (tableProbe ? '（另含探针样本 ' + tableProbe + ' 个，单列）' : ''))
console.log('文本稿：' + textOk + '/' + textTotal + ' 个样本全项通过')
console.log('断言：通过 ' + PASS + ' / 失败 ' + FAIL + (SOFT.length ? ' / 已知限制 ' + SOFT.length : ''))
if (FAILS.length) {
  console.log('\n失败明细：')
  FAILS.slice(0, 40).forEach((f) => console.log('  ✗ ' + f.name + (f.detail ? '  [' + f.detail + ']' : '')))
}
if (SOFT.length) {
  console.log('\n已知限制（探针样本，非硬失败）：')
  SOFT.forEach((f) => console.log('  ⚠ ' + f.name + (f.detail ? '  [' + f.detail + ']' : '')))
}

const jsonIx = process.argv.indexOf('--json')
if (jsonIx >= 0 && process.argv[jsonIx + 1]) {
  fs.writeFileSync(process.argv[jsonIx + 1], JSON.stringify({ pass: PASS, fail: FAIL, fails: FAILS, info: INFO }, null, 2))
  console.log('\n已写出 JSON：' + process.argv[jsonIx + 1])
}
process.exit(FAIL ? 1 : 0)
