/**
 * 智能多模态拆分 · 新规则（拍摄脚本表）验证
 * ---------------------------------------------------------------
 * 文档《好运袁甘哥81-90.docx》暴露出的新表格结构：
 *   表头之前有若干「合并单格」信息行（集标题 / 人物·场景·道具 / 场景），
 *   真实表头（镜头/画面/动作/台词/备注）不在首行，台词在第 3 列。
 * 旧规则会把这些表头前的合并单格和镜头号误当台词，并错把表格前「时间段」段落
 * 当集标题。新规则：全表扫描定位真实表头行、集标题取自表格内标题行、
 * 一个台词单元格含多轮对白（A：…B：…）拆成多行、人物/场景/道具存为 meta。
 * 直接调用 util 纯函数，无需小程序运行时。
 */
'use strict'
const util = require('./miniprogram/utils/util.js')

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

// 构造一份与《好运袁甘哥》同构的 docx（2 表：81 拍摄脚本 + 85 口播），表前带「时间段」段落
const XML = `<?xml version="1.0"?>
<w:document><w:body>
<w:p><w:t>【时间段：0907–0913】</w:t></w:p>
<w:tbl>
  <w:tr><w:tc><w:p><w:t>好运袁甘哥81</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>人物：儿媳妇、婆婆　｜　场景：客厅、厨房　｜　道具：沙发、手机、菜、冰箱、饺子、被子 等</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>场景：客厅人物：儿媳妇、婆婆</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>镜头</w:t></w:p></w:tc><w:tc><w:p><w:t>画面 / 动作</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc><w:tc><w:p><w:t>备注</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>1</w:t></w:p></w:tc><w:tc><w:p><w:t>婆婆坐着</w:t></w:p></w:tc><w:tc><w:p><w:t>婆婆：儿媳妇，妈想跟你请两天假</w:t></w:p></w:tc><w:tc><w:p><w:t></w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>2</w:t></w:p></w:tc><w:tc><w:p><w:t>儿媳妇皱眉</w:t></w:p></w:tc><w:tc><w:p><w:t>儿媳妇：请假？咋了妈？</w:t></w:p></w:tc><w:tc><w:p><w:t></w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>3</w:t></w:p></w:tc><w:tc><w:p><w:t>婆婆解释</w:t></w:p></w:tc><w:tc><w:p><w:t>婆婆：没、没啥事。儿媳妇：那妈别回去了。</w:t></w:p></w:tc><w:tc><w:p><w:t></w:t></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:t>【时间段：0914–0920】</w:t></w:p>
<w:tbl>
  <w:tr><w:tc><w:p><w:t>好运袁甘哥85（口播）</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>人物：袁甘哥　｜　场景：客厅　｜　道具：沙发</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>场景：客厅人物：袁甘哥</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>镜头</w:t></w:p></w:tc><w:tc><w:p><w:t>画面 / 动作</w:t></w:p></w:tc><w:tc><w:p><w:t>台词</w:t></w:p></w:tc><w:tc><w:p><w:t>备注</w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>1</w:t></w:p></w:tc><w:tc><w:p><w:t>袁甘哥对镜头</w:t></w:p></w:tc><w:tc><w:p><w:t>我真是受够了！现在看个短剧怎么这么能折腾人啊？</w:t></w:p></w:tc><w:tc><w:p><w:t></w:t></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:t>2</w:t></w:p></w:tc><w:tc><w:p><w:t>袁甘哥笑</w:t></w:p></w:tc><w:tc><w:p><w:t>无台词</w:t></w:p></w:tc><w:tc><w:p><w:t></w:t></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`

console.log('=== 智能多模态拆分 · 拍摄脚本表新规则 ===')
const blocks = util.extractDocxBlocks(XML)
ok('解析出 2 个表格块', blocks.filter(b => b.type === 'table').length === 2, 'tables=' + blocks.filter(b => b.type === 'table').length)
const res = util.splitScripts(blocks)
ok('拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)

// —— 第1集：拍摄脚本表 ——
const s1 = res.segments[0]
ok('第1集 name=表格内集标题（未被「时间段」段落劫持）', s1.name === '好运袁甘哥81', s1.name)
ok('第1集 epNo=81', s1.epNo === 81, String(s1.epNo))
ok('第1集 meta 含 人物/场景/道具 行', Array.isArray(s1.meta) && s1.meta.some(m => /人物：/.test(m)), JSON.stringify(s1.meta))
ok('第1集 meta 含 场景 行', Array.isArray(s1.meta) && s1.meta.some(m => /^场景：/.test(m)), JSON.stringify(s1.meta))
ok('第1集 台词仅来自第3列（含「婆婆」「儿媳妇」）', s1.lines.indexOf('婆婆：儿媳妇，妈想跟你请两天假') >= 0 && s1.lines.indexOf('儿媳妇：请假？咋了妈？') >= 0, JSON.stringify(s1.lines))
ok('第1集 不含镜头号/画面/备注（第1/2/4列）', s1.lines.indexOf('1') < 0 && s1.lines.indexOf('婆婆坐着') < 0 && s1.lines.indexOf('镜头') < 0, JSON.stringify(s1.lines))
ok('第1集 多轮对白单元格被拆成多行', s1.lines.indexOf('婆婆：没、没啥事。') >= 0 && s1.lines.indexOf('儿媳妇：那妈别回去了。') >= 0, JSON.stringify(s1.lines))
ok('第1集 总行数=4（3数据行，其中第3行拆2行）', s1.lines.length === 4, 'lines=' + s1.lines.length)

// —— 第2集：口播（无说话人冒号，纯旁白）——
const s2 = res.segments[1]
ok('第2集 name=好运袁甘哥85（口播）', s2.name === '好运袁甘哥85（口播）', s2.name)
ok('第2集 epNo=85（容忍「（口播）」后缀）', s2.epNo === 85, String(s2.epNo))
ok('第2集 口播纯旁白原样保留（无冒号不误拆）', s2.lines.length === 1 && s2.lines[0].indexOf('我真是受够了') >= 0, JSON.stringify(s2.lines))
ok('第2集 裸「无台词」行被跳过', s2.lines.indexOf('无台词') < 0, JSON.stringify(s2.lines))

const passed = results.filter(r => r.pass).length
console.log(`\n结果：${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)
