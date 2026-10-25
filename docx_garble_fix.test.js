/**
 * 回归测试：锁定「docx 拆分乱码」修复。
 * 根因：extractWtText / extractDocxText 的正则 /<w:t[^>]*>/g 会误匹配 <w:tr>/<w:tc>/<w:tblPr> 等
 * OOXML 元素（<w:t 是它们的名字前缀），把含 <w:rPr> 的排版 XML 当文本吞入，导致拆出内容全是乱码。
 * 修复：改为 /<w:t\b[^>]*>/g（单词边界，只匹配真正的 <w:t> 文本标签）。
 *
 * 本测试用一份「刻意包含 <w:pPr>/<w:rPr>/<w:tblPr>/<w:tr>/<w:tc>」的真实结构 XML，
 * 断言解析出的标题与台词均为干净中文、绝不含有 <w: 开头的 XML 标签。
 */
'use strict'
const util = require('./miniprogram/utils/util.js')

const BLOCK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p>
  <w:pPr><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/></w:rPr></w:pPr>
  <w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>建华&amp;小凤的生活71</w:t></w:r>
</w:p>
<w:tbl>
  <w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
  <w:tr>
    <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>角色</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>台词</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:rPr><w:color w:val="212529"/></w:rPr><w:t>婆婆</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:rPr><w:color w:val="212529"/></w:rPr><w:t>婆婆（冲着门口喊）： 建华！小凤！快过来吃饭</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:rPr><w:color w:val="212529"/></w:rPr><w:t>建华</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:rPr><w:color w:val="212529"/></w:rPr><w:t>建华： 公司临时出状况，领导让我回去处理</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
</w:body></w:document>`

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')) }
}

console.log('docx 拆分乱码修复（<w:tr>/<w:tc>/<w:tblPr> 误匹配回归）')
const blocks = util.extractDocxBlocks(BLOCK_XML)
ok('解析出 1 段落 + 1 表格（共 2 块）', blocks.length === 2 && blocks.filter(b => b.type === 'table').length === 1, 'blocks=' + blocks.length)

const result = util.splitScripts(blocks)
ok('拆出 1 集（一表=一集）', result.segments.length === 1, 'segments=' + result.segments.length)

const name = result.segments[0].name
ok('集标题为干净中文（不含 <w: 标签）', name === '建华&小凤的生活71' && !/<w:/.test(name), JSON.stringify(name))

const allText = result.segments.map(s => s.lines.join('\n')).join('\n')
ok('台词为干净中文、无任何 <w: XML 残留', !/<w:[a-zA-Z]/.test(allText))
ok('台词含「婆婆（冲着门口喊）」', allText.indexOf('婆婆（冲着门口喊）： 建华！小凤！快过来吃饭') >= 0)
ok('台词含「建华： 公司临时出状况」', allText.indexOf('建华： 公司临时出状况，领导让我回去处理') >= 0)

// 关键防护：标题与每一行都不得出现排版标签
const lines = result.segments[0].lines
ok('每一行都不含 <w:rPr / <w:pPr 等排版标签', lines.every(l => !/<w:/.test(l)), lines.join(' | ').slice(0, 80))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
