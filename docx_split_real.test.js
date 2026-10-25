'use strict'
/**
 * 真实脚本样本综合实测：覆盖多种类型/复杂度，验证 splitScripts 拆分正确性。
 * 样本来源：网络搜集的话剧《雷雨》、情景喜剧《老友记》双语本、有声书口播稿、
 * 短视频分镜表，以及表格稿的多种列布局（角色/台词、对白列、集标题在表格前段落等）。
 */
const util = require('./miniprogram/utils/util.js')

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + JSON.stringify(extra) : ''}`)
}

// 工具：构造 docx document.xml 字符串
function docx(body) {
  return `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`
}
function para(t) {
  return `<w:p><w:t>${t}</w:t></w:p>`
}
function cell(t) {
  return `<w:tc><w:p><w:t>${t}</w:t></w:p></w:tc>`
}
function row(cells) {
  return `<w:tr>${cells.map(cell).join('')}</w:tr>`
}
function table(rows) {
  return `<w:tbl>${rows.map(row).join('')}</w:tbl>`
}

console.log('\n########## 1. 话剧《雷雨》剧本（周朴园：台词 + 第一幕/第二幕 幕标记）##########')
{
  // 真实话剧：角色名+冒号+台词，括号里是动作提示；全篇无「第N集」，只有幕标记。
  //
  // 【口径变更 · P3 修复】此处原断言「整篇 1 集（幕≠集）」于 2026-09-24 作废。
  // 旧口径下，同一份稿在「智能拆分」得 1 篇、在「按标题拆」得 5 篇，两个入口打架；
  // 且整部剧几千字塞进一个台本，提词无法按幕推进。现改为**两级边界**：
  //   ① 有分集信号（第N集/EP）时只按集拆 —— 混合稿不被幕拆碎（见 case 12）；
  //   ② 全稿无分集信号时，退化到 幕/场/回/章 —— 纯话剧按幕拆。
  const body =
    para('雷雨（节选）') +
    para('第一幕') +
    para('周朴园（忽然严厉地）你来干什么？') +
    para('鲁侍萍不是我要来的。') +
    para('周朴园谁指使你来的？') +
    para('鲁侍萍（悲愤）命，不公平的命指使我来的！') +
    para('第二幕') +
    para('周朴园（冷冷地）三十年的工夫你还是找到这儿来了。') +
    para('鲁侍萍我没有找你，我以为你早死了。')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('纯幕稿件按幕拆成 3 篇（前言 + 第一幕 + 第二幕）', res.segments.length === 3, 'segments=' + res.segments.length)
  ok('幕名成为该篇标题', res.segments[1].name === '第一幕' && res.segments[2].name === '第二幕',
    JSON.stringify(res.segments.map((s) => s.name)))
  ok('台词保留：含周朴园/鲁侍萍对白', res.segments[1].lines.join('|').indexOf('周朴园') >= 0 && res.segments[1].lines.join('|').indexOf('鲁侍萍') >= 0)
  ok('动作提示（括号）保留在台词内', res.segments[1].lines.join('|').indexOf('忽然严厉地') >= 0)
  // 零遗漏红线：拆幕之后台词一个字都不能少，也不能把第二幕的台词错配到第一幕
  ok('幕内容不串篇（第二幕台词不在第一幕里）',
    res.segments[1].lines.join('|').indexOf('三十年的工夫') < 0 && res.segments[2].lines.join('|').indexOf('忽然严厉地') < 0)
}

console.log('\n########## 2. 情景喜剧《老友记》双语本（[Scene:] + 角色：台词）##########')
{
  const body =
    para('[Scene: Central Perk, Chandler, Joey, Phoebe, and Monica are there.]') +
    para('Monica: There’s nothing to tell! He’s just some guy I work with!') +
    para('莫妮卡：没什么好说的！他不过是我的同事！') +
    para('Joey: Come on, you’re going out with the guy!') +
    para('乔伊：少来了，你和那个人一起出去！') +
    para('Chandler: So does he have a hump?') +
    para('钱德勒：他驼背？')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('情景喜剧无集号标记→整篇 1 集', res.segments.length === 1, 'segments=' + res.segments.length)
  ok('含角色对白（Monica/乔伊）', res.segments[0].lines.join('|').indexOf('Monica') >= 0 && res.segments[0].lines.join('|').indexOf('乔伊') >= 0)
}

console.log('\n########## 3. 有声书口播稿（独白，无角色）##########')
{
  const body =
    para('成年人最好的活法') +
    para('哈喽，晚上好，欢迎来到闲时播。') +
    para('越长大越明白，成年人的世界，没有谁能永远被偏爱。') +
    para('委屈不必逢人就讲，难处不必逢人就诉。') +
    para('管好自己的心，过好自己的日子，不纠缠、不内耗、不盲从。')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('口播稿→整篇 1 集', res.segments.length === 1, 'segments=' + res.segments.length)
  const txt = res.segments[0].lines.join('|')
  ok('口播台词完整保留（含开场白共 5 句）', res.segments[0].lines.length === 5, res.segments[0].lines)
  ok('关键句均保留（欢迎语/不纠缠不内耗）', txt.indexOf('欢迎来到闲时播') >= 0 && txt.indexOf('不纠缠、不内耗、不盲从') >= 0, txt)
}

console.log('\n########## 4. 表格稿·两列（角色 / 台词）##########')
{
  const body =
    table([
      [cell('建华&小凤的生活73')],
      [cell('角色'), cell('台词')],
      [cell('建华'), cell('今天去哪玩')],
      [cell('小凤'), cell('听你的')]
    ])
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('两列表格→1 集', res.segments.length === 1, 'segments=' + res.segments.length)
  const lines = res.segments[0].lines.join('|')
  ok('台词取「台词」列（建华/小凤）', lines.indexOf('今天去哪玩') >= 0 && lines.indexOf('听你的') >= 0, lines)
  ok('不含角色列内容', lines.indexOf('角色') < 0)
}

console.log('\n########## 5. 表格稿·表头叫「对白」而非「台词」##########')
{
  const body =
    table([
      [cell('建华&小凤的生活74')],
      [cell('镜头'), cell('画面'), cell('对白'), cell('时长')],
      [cell('1'), cell('客厅'), cell('婆婆：吃饭了'), cell('3s')],
      [cell('2'), cell('厨房'), cell('建华：来了'), cell('2s')]
    ])
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('表头「对白」列被识别为台词列', res.segments[0].lines.join('|') === '婆婆：吃饭了|建华：来了', res.segments[0].lines)
}

console.log('\n########## 6. 表格稿·集标题在表格前的段落（非表格首行）##########')
{
  const body =
    para('建华&小凤的生活75') +
    table([
      [cell('镜头'), cell('画面'), cell('台词')],
      [cell('1'), cell('卧室'), cell('小凤：明天去哪玩')],
      [cell('2'), cell('阳台'), cell('建华：听你的')]
    ])
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('集标题从表格前段落读取', res.segments[0].name === '建华&小凤的生活75', res.segments[0].name)
  ok('epNo=75', res.segments[0].epNo === 75, String(res.segments[0].epNo))
}

console.log('\n########## 7. 表格稿·含「角色」列（合并「角色：台词」）##########')
{
  const body =
    table([
      [cell('建华&小凤的生活76')],
      [cell('角色'), cell('台词')],
      [cell('建华'), cell('今天去哪玩')],
      [cell('小凤'), cell('听你的')]
    ])
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('含角色列时合并为「角色：台词」', res.segments[0].lines.join('|') === '建华：今天去哪玩|小凤：听你的', res.segments[0].lines)
}

console.log('\n########## 8. 纯「第N集」多集稿（无系列名，段落）##########')
{
  const body =
    para('第71集') +
    para('婆婆：吃饭了') +
    para('建华：来了') +
    para('第72集') +
    para('小凤：明天去哪玩') +
    para('建华：听你的')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('纯「第71集/第72集」拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集 name=第71集', res.segments[0].name === '第71集', res.segments[0].name)
  ok('第2集 name=第72集', res.segments[1].name === '第72集', res.segments[1].name)
}

console.log('\n########## 9. 纯中文数字「第一集/第二集」多集稿 ##########')
{
  const body =
    para('第一集') +
    para('婆婆：吃饭了') +
    para('建华：来了') +
    para('第二集') +
    para('小凤：明天去哪玩')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('「第一集/第二集」拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集 name=第一集', res.segments[0].name === '第一集', res.segments[0].name)
}

console.log('\n########## 10. 纯「EP01/EP02」多集稿 ##########')
{
  const body =
    para('EP01') +
    para('婆婆：吃饭了') +
    para('EP02') +
    para('小凤：明天去哪玩')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('「EP01/EP02」拆出 2 集', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集 name=EP01', res.segments[0].name === 'EP01', res.segments[0].name)
}

console.log('\n########## 11. 短视频分镜表（镜号/景别/画面/台词 四列）##########')
{
  const body =
    table([
      [cell('短视频第1集')],
      [cell('镜号'), cell('景别'), cell('画面'), cell('台词')],
      [cell('1'), cell('近景'), cell('客厅'), cell('主播：今天给大家推荐三款好物')],
      [cell('2'), cell('中景'), cell('厨房'), cell('主播：第一款是厨房神器')]
    ])
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('分镜表台词取「台词」列', res.segments[0].lines.join('|') === '主播：今天给大家推荐三款好物|主播：第一款是厨房神器', res.segments[0].lines)
}

console.log('\n########## 12. 混合：话剧带「第X集」集标记（应按集拆，不按幕）##########')
{
  const body =
    para('第一集') +
    para('周朴园：你来干什么？') +
    para('鲁侍萍：不是我要来的。') +
    para('第二幕') +
    para('周朴园：谁指使你来的？') +
    para('第二集') +
    para('鲁侍萍：命指使我来的。')
  const res = util.splitScripts(util.extractDocxBlocks(docx(body)))
  ok('混合稿按「集」拆 2 集（第二幕不触发拆分）', res.segments.length === 2, 'segments=' + res.segments.length)
  ok('第1集含第一幕内容（周朴园/鲁侍萍）', res.segments[0].lines.join('|').indexOf('周朴园') >= 0 && res.segments[0].lines.join('|').indexOf('鲁侍萍') >= 0)
}

const passed = results.filter((r) => r.pass).length
console.log(`\n结果：${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)
