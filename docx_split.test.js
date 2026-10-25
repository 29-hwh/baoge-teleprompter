/**
 * Word 导入「拆分规则_v1」验证：
 * - 规则A（表格稿）：extractDocxBlocks 保留表格结构；splitScripts 一表=一集、台词取第3列、按集标题命名
 * - 规则B（段落稿）：无表格时按「系列名+数字」标题行切集
 * - blocksToText 兜底拼回纯文本
 * 直接调用 util 纯函数，无需小程序运行时。
 */
'use strict'
const util = require('./miniprogram/utils/util.js')

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// 规则A 表格稿：两个表格，每个表格 = 一集；第3列是台词
const TABLE_XML = `<?xml version="1.0"?>
<w:document><w:body>
<w:tbl>
  <w:tr><w:tc><w:p><w:t>建华&amp;小凤的生活71</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>镜头</w:t></w:p></w:tc><w:tc><w:p><w:t>画面</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc><w:tc><w:p><w:t>备注</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>1</w:t></w:p></w:tc><w:tc><w:p><w:t>客厅</w:t></w:p></w:tc><w:tc><w:p><w:t>婆婆（喊）：吃饭了</w:t></w:p></w:tc><w:tc><w:p><w:t>—</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>2</w:t></w:p></w:tc><w:tc><w:p><w:t>厨房</w:t></w:p></w:tc><w:tc><w:p><w:t>建华（笑）：来了</w:t></w:p></w:tc><w:tc><w:p><w:t>无台词</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>3</w:t></w:p></w:tc><w:tc><w:p><w:t>门口</w:t></w:p></w:tc><w:tc><w:p><w:t>（无台词）</w:t></w:p></w:tc><w:tc><w:p><w:t>转场</w:t></w:p></w:tc></w:tr>
</w:tbl>
<w:tbl>
  <w:tr><w:tc><w:p><w:t>建华&amp;小凤的生活72</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>镜头</w:t></w:p></w:tc><w:tc><w:p><w:t>画面</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc><w:tc><w:p><w:t>备注</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>1</w:t></w:p></w:tc><w:tc><w:p><w:t>卧室</w:t></w:p></w:tc><w:tc><w:p><w:t>小凤：明天去哪玩</w:t></w:p></w:tc><w:tc><w:p><w:t>—</w:t></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`

console.log('=== 规则A · 表格稿 ===')
{
  const blocks = util.extractDocxBlocks(TABLE_XML)
  ok('extractDocxBlocks 解析出 2 个表格块', blocks.filter(b => b.type === 'table').length === 2, 'blocks=' + blocks.length)
  const firstTbl = blocks.find(b => b.type === 'table')
  ok('表格块保留二维单元格结构（rows[0][0]=集标题）', firstTbl.rows[0][0] === '建华&小凤的生活71', firstTbl.rows[0][0])

  const res = util.splitScripts(blocks)
  ok('splitScripts 按表格拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集 name=集标题原文', res.segments[0].name === '建华&小凤的生活71', res.segments[0].name)
  ok('第1集 epNo=71', res.segments[0].epNo === 71, String(res.segments[0].epNo))
  ok('第2集 name=建华&小凤的生活72', res.segments[1].name === '建华&小凤的生活72', res.segments[1].name)
  ok('第2集 epNo=72', res.segments[1].epNo === 72, String(res.segments[1].epNo))
  // 台词取第3列：只含第3列非空文本，且（无台词）行被跳过
  const lines1 = res.segments[0].lines
  ok('第1集台词仅来自第3列（含「婆婆」「建华」）', lines1.indexOf('婆婆（喊）：吃饭了') >= 0 && lines1.indexOf('建华（笑）：来了') >= 0, JSON.stringify(lines1))
  ok('第1集不含第1/2/4列内容（镜头/画面/备注）', lines1.indexOf('客厅') < 0 && lines1.indexOf('厨房') < 0 && lines1.indexOf('—') < 0, JSON.stringify(lines1))
  ok('第1集跳过「（无台词）」行', lines1.indexOf('（无台词）') < 0, JSON.stringify(lines1))
  ok('第2集台词=小凤那句', res.segments[1].lines.join('|') === '小凤：明天去哪玩', JSON.stringify(res.segments[1].lines))
  ok('blocksToText 兜底能拼回纯文本（含表格单元格）', util.blocksToText(blocks).indexOf('建华&小凤的生活71') >= 0)
}

// 规则B 段落稿：无表格，靠「系列名+数字」标题行切集
const PARA_XML = `<?xml version="1.0"?>
<w:document><w:body>
<w:p><w:t>建华&amp;小凤的生活71</w:t></w:p>
<w:p><w:t>婆婆：吃饭了</w:t></w:p>
<w:p><w:t>建华：来了</w:t></w:p>
<w:p><w:t>建华&amp;小凤的生活72</w:t></w:p>
<w:p><w:t>小凤：明天去哪玩</w:t></w:p>
<w:p><w:t>建华：听你的</w:t></w:p>
</w:body></w:document>`

console.log('=== 规则B · 段落稿 ===')
{
  const blocks = util.extractDocxBlocks(PARA_XML)
  ok('段落稿无表格块', blocks.filter(b => b.type === 'table').length === 0)
  const res = util.splitScripts(blocks)
  ok('splitScripts 按标题拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集 name=建华&小凤的生活71', res.segments[0].name === '建华&小凤的生活71', res.segments[0].name)
  ok('第2集 name=建华&小凤的生活72', res.segments[1].name === '建华&小凤的生活72', res.segments[1].name)
  ok('第1集台词含婆婆/建华', res.segments[0].lines.join('|').indexOf('婆婆：吃饭了') >= 0 && res.segments[0].lines.join('|').indexOf('建华：来了') >= 0, res.segments[0].lines.join('|'))
  ok('第2集台词含小凤/建华', res.segments[1].lines.join('|').indexOf('小凤：明天去哪玩') >= 0 && res.segments[1].lines.join('|').indexOf('建华：听你的') >= 0, res.segments[1].lines.join('|'))
}

// 边界：0 表格且 0 标题信号 → 整篇当 1 集
const PLAIN_XML = `<?xml version="1.0"?>
<w:document><w:body>
<w:p><w:t>今天天气真好</w:t></w:p>
<w:p><w:t>我们去公园散步</w:t></w:p>
</w:body></w:document>`
console.log('=== 边界 · 无表格无标题 ===')
{
  const res = util.splitScripts(util.extractDocxBlocks(PLAIN_XML))
  ok('无表格无标题信号 → 整篇作为 1 集', res.segments.length === 1, 'segments=' + res.segments.length)
  ok('单集台词含两行', res.segments[0].lines.length === 2, JSON.stringify(res.segments[0].lines))
}

const passed = results.filter(r => r.pass).length
console.log(`\n结果：${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)
