'use strict'
/**
 * fixture_findings_repro.js —— P1~P5 的修复验证（带断言，可当回归跑）
 * ---------------------------------------------------------------------------
 * 本脚本最初是「问题复现」：用最小输入把三个缺陷钉死。
 * 2026-09-24 缺陷全部修完，遂升级为**验证脚本**：每条缺陷都有一个 PASS/FAIL 断言，
 * 将来谁改坏了一眼就能看出来。
 *
 * 用法：node fixture_findings_repro.js
 * 退出码：全部通过 = 0；任一失败 = 1
 */
const fs = require('fs')
const path = require('path')
const util = require('./miniprogram/utils/util.js')
const { SPECS, buildDoc } = require('./fixtures/table_specs.js')
const squash = (s) => String(s || '').replace(/\s+/g, '')

let PASS = 0
let FAIL = 0
const FAILS = []
function ok(cond, name, detail) {
  if (cond) {
    PASS++
    console.log('  PASS | ' + name + (detail ? '  -> ' + detail : ''))
  } else {
    FAIL++
    FAILS.push(name + (detail ? '  -> ' + detail : ''))
    console.log('  FAIL | ' + name + (detail ? '  -> ' + detail : ''))
  }
  return cond
}

console.log('=== P1：smartSplitScripts 必须保留首个边界之前的内容（前言/剧名/出场人物）===')
console.log('  修复点：sliceByBoundaries 原来从 idxs[0] 起切，首个标题前的内容整体消失。')
;[
  ['01_短剧_分集', '第1集'],
  ['09_边界_说话人写法', '第1集']
].forEach(([f, firstHead]) => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'text', f + '.txt'), 'utf8')
  const smart = util.smartSplitScripts(raw)
  const out = smart.map((p) => p.content).join('\n')
  const i = raw.indexOf(firstHead)
  const prefix = i > 0 ? raw.slice(0, i) : ''
  const kept = i <= 0 || squash(out).indexOf(squash(prefix)) >= 0
  ok(kept, f + ' 首个边界之前的内容已保留', 'smart 切出 ' + smart.length + ' 篇')
})
{
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'text', '04_话剧_幕场.txt'), 'utf8')
  const smart = util.smartSplitScripts(raw)
  const firstAct = raw.indexOf('第一幕')
  ok(squash(smart.map((p) => p.content).join('\n')).indexOf(squash(raw.slice(0, firstAct))) >= 0,
    '04_话剧_幕场 剧名与出场人物表已保留', 'smart 切出 ' + smart.length + ' 篇')
}

console.log('\n=== P2：无表头 + 台词列不在末列，多模态必须拿到台词（原整篇丢失）===')
console.log('  修复点：legacy 由「≥4 列取末列」改为按内容评分选列；悟空不启用，保持原样。')
{
  const s = SPECS.find((x) => x.id === 'T5b')
  const blocks = util.extractDocxBlocks(buildDoc(s.spec))
  const mm = util.splitScripts(blocks)
  const wk = util.splitScripts(blocks, { mode: 'wukong' })
  const mmLines = ((mm.segments[0] || {}).lines || [])
  const wkLines = ((wk.segments[0] || {}).lines || [])
  ok(mmLines.length === 4, 'T5b 多模态恢复 4 行台词', 'lines=' + JSON.stringify(mmLines))
  ok(mmLines.length > 0 && mmLines[0].indexOf('妈妈：吃饭了') >= 0, 'T5b 多模态取到的是台词列（不是备注列）', mmLines[0])
  ok(wkLines.length === 0, 'T5b 悟空侧保持原行为（规则锁定，有意不变）', '悟空行=' + wkLines.length)
}

console.log('\n=== P3：两条文本路径口径必须一致（幕/场拆不拆）===')
console.log('  修复点：findHeadingBoundaries 改两级 —— 有集信号只按集；无集信号才退化到幕/场。')
{
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'text', '04_话剧_幕场.txt'), 'utf8')
  const smart = util.smartSplitScripts(raw)
  const head = util.splitImportBlocks(raw, 'headings')
  ok(smart.length === head.length, '纯幕稿件：智能拆分与按标题拆篇数一致',
    'smart=' + smart.length + ' headings=' + head.length)
  ok(smart.length === 5, '04_话剧_幕场 智能拆分得到 5 篇（前言+序幕+2幕+1场）', '篇数=' + smart.length)

  // 混合稿校验：有「第N集」时幕不得触发拆分（这是老设计意图，必须保住）
  const para = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>'
  const body = para('第一集') + para('周朴园：你来干什么？') + para('第二幕') +
    para('周朴园：谁指使你来的？') + para('第二集') + para('鲁侍萍：命指使我来的。')
  const res = util.splitScripts(util.extractDocxBlocks(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + '</w:body></w:document>'))
  ok(res.segments.length === 2, '混合稿仍按「集」拆 2 集（第二幕不拆）', 'segments=' + res.segments.length)
}

console.log('\n=== P4：直角引号台词「名｢台词｣」必须能归属角色 ===')
console.log('  修复点：normalizeCornerQuote 在 splitDialogueCell 入口规范化；悟空不经过此函数。')
{
  const s = SPECS.find((x) => x.id === 'T2')
  const blocks = util.extractDocxBlocks(buildDoc(s.spec))
  const mm = util.splitScripts(blocks)
  const wk = util.splitScripts(blocks, { mode: 'wukong' })
  const lines = ((mm.segments[0] || {}).lines || [])
  const withRole = lines.filter((l) => /^[^：:]{1,12}[：:]/.test(l) && !/^(镜号|场景|景别|画面描述|台词|时长|转场)[：:]/.test(l))
  ok(withRole.length === 5, 'T2 多模态 5 行台词全部带上角色前缀', JSON.stringify(withRole.slice(0, 2)))
  ok(squash(lines.join('')).indexOf('回来啦，先洗手。') >= 0, 'T2 台词内容未丢（仅去掉装饰引号）')
  // 行中引用不能被误判成说话人
  const cell = util.normalizeCornerQuote('母亲：他跟我说｢好的｣，然后就走了。')
  ok(cell.indexOf('：好的') < 0, '行中引用不被误判为说话人', JSON.stringify(cell))
  // 悟空侧零影响
  const wkLines = ((wk.segments[0] || {}).lines || [])
  ok(squash(wkLines.join('')).indexOf('\uFF62') >= 0, 'T2 悟空侧保留原文（含｢｣，未被规范化）')
}

console.log('\n=== P5：占位形态必须被多模态识别（无 / N-A / 斜杠）===')
console.log('  修复点：isPlaceholderLine 补形态 + 加长度闸（≤6 字）；悟空不使用此过滤。')
{
  ;['无', '（无）', '(无)', '无台词', '（无对白）', '—', '-', '/', 'N/A'].forEach((t) => {
    ok(util.isPlaceholderLine(t), '占位识别 ' + t)
  })
  ;['（无台词，手机屏幕微微照亮她的脸）', '无力站起来还得帮他把东西搬完', '', '她：又是一个人。'].forEach((t) => {
    ok(!util.isPlaceholderLine(t), '非占位不受影响 ' + (t || '(空行)'))
  })
  const s = SPECS.find((x) => x.id === 'T7')
  const blocks = util.extractDocxBlocks(buildDoc(s.spec))
  const mm = util.splitScripts(blocks)
  const wk = util.splitScripts(blocks, { mode: 'wukong' })
  const mmLines = ((mm.segments[0] || {}).lines || [])
  ok(mmLines.indexOf('无') < 0, 'T7 多模态已滤掉孤立的「无」', JSON.stringify(mmLines))
  ok(((wk.segments[0] || {}).lines || []).indexOf('无') >= 0, 'T7 悟空侧仍保留「无」（规则锁定）')
}

console.log('\n==================== 汇总 ====================')
console.log('断言：通过 ' + PASS + ' / 失败 ' + FAIL)
if (FAILS.length) {
  console.log('\n失败明细：')
  FAILS.forEach((f) => console.log('  ✗ ' + f))
} else {
  console.log('✅ P1~P5 全部修复并锁定')
}
process.exit(FAIL === 0 ? 0 : 1)
