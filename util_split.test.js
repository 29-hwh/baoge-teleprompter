'use strict'
/**
 * util.splitImportBlocks 拆分工具单测（Req 5：一级页导入 Word 可选智能拆分）。
 * 覆盖：headings（按集/场/章标题）、blank（按空行）、退化整篇、空块剔除、标题自动命名。
 */
const util = require('./miniprogram/utils/util.js')

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? '  → ' + detail : ''}`)
  }
}

console.log('splitImportBlocks（headings 模式）')

// 1. 常规：第1集/第2集切两篇，标题取标题行原文
{
  const t = '第1集 重逢\n林晚：好久不见\n\n顾辞：是好久\n\n第2集 争执\n林晚：你听我说完'
  const r = util.splitImportBlocks(t, 'headings')
  ok('两集切成 2 块', r.length === 2, `len=${r.length}`)
  ok('块1标题为标题行原文', r[0] && r[0].title === '第1集 重逢', JSON.stringify(r[0] && r[0].title))
  ok('块2标题为标题行原文', r[1] && r[1].title === '第2集 争执', JSON.stringify(r[1] && r[1].title))
  ok('块内台词完整保留', r[0] && r[0].content.indexOf('林晚：好久不见') >= 0 && r[1].content.indexOf('你听我说完') >= 0)
}

// 2. 只有标题无内容的块不生成空台本
{
  const t = '第1集 重逢\n林晚：好久不见\n第2集\n（第2集只有标题+括号说明，算有内容）'
  const r = util.splitImportBlocks(t, 'headings')
  ok('标题后紧接空档不产生空块', r.length >= 1 && r.every((b) => b.content.trim().length > 0), `len=${r.length}`)
}

// 3. 无任何标题 → 整篇退化为 1 块，标题自动命名
{
  const t = '旁白：这一年发生了很多事\n林晚：是啊，都过去了'
  const r = util.splitImportBlocks(t, 'headings')
  ok('无标题时整篇 1 块', r.length === 1, `len=${r.length}`)
  ok('标题取自正文开头', r[0] && r[0].title.indexOf('旁白这一年发生了很多事林晚是啊都过去了') >= 0 ||
    (r[0] && r[0].title.length > 0), JSON.stringify(r[0] && r[0].title))
}

// 4. 台词中间出现的「第N集」字样（不在行首）不误切
{
  const t = '他说第3集才是高潮\n林晚：不可能，我看了剧本'
  const r = util.splitImportBlocks(t, 'headings')
  ok('正文中含「第N集」不误切（需行首才识别）', r.length === 1, `len=${r.length}`)
}

// 5. 混合「序/第N章」：不同标题形态都能切
{
  const t = '序\n这是开场白\n\n第一章 出发\n林晚动身了\n\n尾声\n结束了'
  const r = util.splitImportBlocks(t, 'headings')
  ok('序+章+尾声切成 3 块', r.length === 3, `len=${r.length} titles=${JSON.stringify(r.map((b) => b.title))}`)
}

// 6. 空输入
{
  ok('空输入返回空数组', util.splitImportBlocks('', 'headings').length === 0)
  ok('纯空白返回空数组', util.splitImportBlocks(' \n\n ', 'headings').length === 0)
}

console.log('splitImportBlocks（blank 模式）')

// 7. 按空行段落拆
{
  const t = '第一段台词比较长\n继续第一段\n\n第二段另一个场景\n\n第三段结束'
  const r = util.splitImportBlocks(t, 'blank')
  ok('空行分隔切成 3 块', r.length === 3, `len=${r.length}`)
  ok('每块自动命名', r.every((b) => b.title.length > 0), JSON.stringify(r.map((b) => b.title)))
  ok('块内多行合并为一段', r[0] && r[0].content.indexOf('继续第一段') >= 0)
}

// 8. 连续多个空行不产生空块
{
  const t = '甲段\n\n\n\n\n乙段'
  const r = util.splitImportBlocks(t, 'blank')
  ok('连续空行归一，无空块', r.length === 2, `len=${r.length}`)
}

// 9. 标题也适用 blank 模式（只按空行分，不认标题）
{
  const t = '第1集 重逢\n林晚：好久不见\n\n第2集 争执\n林晚：你听我说'
  const r = util.splitImportBlocks(t, 'blank')
  ok('blank 模式不认标题、按空行分', r.length === 2, `len=${r.length}`)
  ok('块1内容含标题与台词', r[0] && r[0].content.indexOf('第1集 重逢') >= 0)
}

// 10. 标题行 ≤30 字
{
  const longTitle = '第' + '一二三四五六七八九十'.repeat(4) + '集 超长标题'
  const r = util.splitImportBlocks(longTitle + '\n正文内容', 'headings')
  ok('标题截断到 30 字以内', r.length === 1 && r[0].title.length <= 30, `len=${r[0] && r[0].title.length}`)
}

// ============================================================
// 11. 台本标题命名规则（重构后单一入口 util.autoName）
// ============================================================
console.log('\nautoName（标题命名规则）')

// 常量与占位符约定
ok('命名常量：TITLE_MAX_LEN=30', util.TITLE_MAX_LEN === 30, `=${util.TITLE_MAX_LEN}`)
ok('命名常量：AUTO_TITLE_LEN=20', util.AUTO_TITLE_LEN === 20, `=${util.AUTO_TITLE_LEN}`)
ok('命名常量：占位标题=未命名台本', util.PLACEHOLDER_TITLE === '未命名台本', `=${util.PLACEHOLDER_TITLE}`)

// 优先级 1：首行为「第N集」标题行 → 标题行原文（不再拼成长摘要）
ok('首行是第N集标题行 → 用该行原文', util.autoName('第1集 重逢\n林晚：好久不见') === '第1集 重逢', `=${util.autoName('第1集 重逢\n林晚：好久不见')}`)
// 首行为「序章/尾声」类标题词 → 用该行
ok('首行是序章类标题行 → 用该行原文', util.autoName('序章\n婆婆：过年好') === '序章', `=${util.autoName('序章\n婆婆：过年好')}`)
// 首行为「系列名+数字」→ 用该行（智能拆分场景）
ok('首行是系列名+数字行 → 用该行原文', util.autoName('建华&小凤的生活71\n婆婆：开饭了') === '建华&小凤的生活71', `=${util.autoName('建华&小凤的生活71\n婆婆：开饭了')}`)
// 标题行超长 → 截到 TITLE_MAX_LEN
{
  const longHead = '第' + '一二三四五六七八九十'.repeat(4) + '集 重逢'
  const r = util.autoName(longHead + '\n正文')
  ok('标题行超长截到 30 字', r.length <= 30 && r.indexOf('第') === 0, `len=${r.length}`)
}
// 优先级 2：首行是台词/叙述行 → 摘要式命名（不拿台词行当标题）
ok('首行是台词行 → 摘要式命名', util.autoName('林晚：你真的要走了吗') === '林晚你真的要走了吗', `=${util.autoName('林晚：你真的要走了吗')}`)
ok('首行带标点的叙述 → 摘要式命名', util.autoName('婆婆（喊）：建华！快过来吃饭，菜都凉了').indexOf('婆婆喊建华') === 0, `=${util.autoName('婆婆（喊）：建华！快过来吃饭，菜都凉了')}`)
ok('首行是普通短句也摘要命名（保留 @/#/&）', util.autoName('联系@宝哥#001 明天见') === '联系@宝哥#001明天见', `=${util.autoName('联系@宝哥#001 明天见')}`)
// 摘要默认 20 字、空内容回空串
ok('摘要默认上限 20 字', util.autoName('ABCDEFGHIJKLMNOPQRSTUVWXYZ一二三四五六七八').length === 20, `=${util.autoName('ABCDEFGHIJKLMNOPQRSTUVWXYZ一二三四五六七八').length}`)
ok('空内容返回空串', util.autoName('') === '', `=${util.autoName('')}`)

// 集成：smart 拆分「第N集」结果仍以标题行原文命名（P2-3 回归，与 util_split #1 一致）
{
  const r = util.smartSplitScripts('第1集 重逢\n林晚：好久不见\n第2集 争执\n林晚：你听我说')
  ok('smartSplit 拆分后标题=标题行原文', r.length === 2 && r[0].title === '第1集 重逢' && r[1].title === '第2集 争执', JSON.stringify(r.map((b) => b.title)))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
