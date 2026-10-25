/**
 * 纯函数单测：docx 文本提取 + 自动命名
 * 运行：node engine_docx.test.js
 */
const assert = require('assert')
const util = require('./miniprogram/utils/util.js')

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

// 一个贴近真实的 document.xml：多段落 / 多 run / xml:space / 空段落 / 段落属性
const xml = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '  <w:body>',
  '    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>建华&小凤的生活71</w:t></w:r></w:p>',
  '    <w:p><w:r><w:t>婆婆（冲着门口喊）：</w:t></w:r><w:r><w:t xml:space="preserve"> 建华！</w:t></w:r></w:p>',
  '    <w:p><w:r><w:t>建华：</w:t></w:r><w:r><w:t>公司临时出状况，领导让我回去处理。</w:t></w:r></w:p>',
  '    <w:p></w:p>',
  '    <w:p><w:r><w:t>小凤：</w:t></w:r><w:r><w:t>你记不记得，上个月你打电话给妈</w:t></w:r></w:p>',
  '    <w:p w:rsidR="00AB"><w:r><w:t>婆婆：</w:t></w:r><w:r><w:t>路上慢点……</w:t></w:r></w:p>',
  '  </w:body>',
  '</w:document>'
].join('')

console.log('extractDocxText')
const text = util.extractDocxText(xml)
ok('开头是文档标题', text.indexOf('建华&小凤的生活71') === 0)
ok('相邻 run 的 preserve 空格被保留', text.indexOf('婆婆（冲着门口喊）： 建华！') >= 0)
ok('多段落之间用换行分隔', (text.match(/\n/g) || []).length >= 4)
ok('空段落不引入多余文本碎片', text.indexOf('<w:p') === -1)
ok('段落属性 <w:pPr> 不被误判为段落', text.indexOf('Heading1') === -1)

console.log('autoTitleFromText')
ok('去除空白与标点', util.autoTitleFromText('婆 婆（喊）：建华！') === '婆婆喊建华')
ok('保留中文/英文/数字/&', util.autoTitleFromText('建华&小凤的生活71') === '建华&小凤的生活71')
ok('保留 @ #', util.autoTitleFromText('联系@宝哥#001') === '联系@宝哥#001')
ok('截取前 maxLen 个有效字', util.autoTitleFromText('一二三四五六七八九十十一十二十三', 12) === '一二三四五六七八九十十一')
ok('空输入返回空串', util.autoTitleFromText('') === '')
ok('仅标点返回空串', util.autoTitleFromText('，。！？') === '')
ok('默认上限 20 字', util.autoTitleFromText('ABCDEFGHIJKLMNOPQRSTUVWXYZ一二三四五六', 20).length === 20)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
