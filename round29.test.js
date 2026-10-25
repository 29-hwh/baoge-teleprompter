'use strict'
/**
 * round29 · 表格剧本「解析准确性」四项修复的回归锁定
 *
 * 背景：拿真实文档（《建华&小凤的生活》81-90.docx，10 张表 736 格）走完整链路对账后，
 * 查出 4 处会让提词「不准」的缺陷，本文件逐项锁定：
 *   29-A 单元格软换行没拆 → 两条台词粘成一段
 *   29-B 垃圾角色名（「无」「（环境音」）混进角色列表
 *   29-C 「名字 + 动作描述 + 冒号」丢角色 → 不高亮、还躲过角色过滤
 *   29-D 同一角色全称/简称被算成两个人
 */
const util = require('./miniprogram/utils/util.js')
const role = require('./miniprogram/engine/role.js')
const parser = require('./miniprogram/engine/parser.js')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS | ' + name + (extra ? '  -> ' + extra : '')) }
  else { fail++; console.log('FAIL | ' + name + (extra ? '  -> ' + extra : '')) }
}
const squash = (s) => String(s || '').replace(/\s/g, '')

// ============================================================
console.log('\n=== 29-A. 单元格软换行：必须先拆开，再按说话人拆 ===')
// ============================================================
ok('A1 「A：…<换行>B：…」拆成两行（不再粘成一段）',
  JSON.stringify(util.splitDialogueCell('杨凤：你吃几串了？\n王建华：才3串。')) ===
  JSON.stringify(['杨凤：你吃几串了？', '王建华：才3串。']),
  JSON.stringify(util.splitDialogueCell('杨凤：你吃几串了？\n王建华：才3串。')))

ok('A2 第二段没有冒号也照样拆（软换行是硬边界）',
  JSON.stringify(util.splitDialogueCell('妈，吃饭了。\n来了。')) ===
  JSON.stringify(['妈，吃饭了。', '来了。']))

ok('A3 连续多个换行压成一个边界，不产生空行',
  JSON.stringify(util.splitDialogueCell('甲：一。\n\n\n乙：二。')) ===
  JSON.stringify(['甲：一。', '乙：二。']))

ok('A4 单行单元格不受影响',
  JSON.stringify(util.splitDialogueCell('杨凤：没事。')) === JSON.stringify(['杨凤：没事。']))

ok('A5 段内仍按说话人拆（同一行两人，无换行）',
  JSON.stringify(util.splitDialogueCell('甲：一。乙：二。')) ===
  JSON.stringify(['甲：一。', '乙：二。']))

ok('A6 超长（>600 字）单段不拆，但换行边界依然生效',
  (() => {
    const long = '甲：' + '啊'.repeat(700)
    const r = util.splitDialogueCell(long + '\n乙：收。')
    return r.length === 2 && r[1] === '乙：收。' && r[0].length > 600
  })())

ok('A7 零丢字：拆开后压平与原文一致',
  (() => {
    const src = '婆婆（不看杨凤）：行了，刚才是妈话说重了。\n婆婆把汤往杨凤面前推了推：先喝口热的。'
    return squash(util.splitDialogueCell(src).join('')) === squash(src)
  })())

ok('A8 空/空白输入原样返回，不炸',
  JSON.stringify(util.splitDialogueCell('')) === JSON.stringify(['']) &&
  JSON.stringify(util.splitDialogueCell('   ')) === JSON.stringify(['   ']))

// 端到端：docx XML → 表格 → 台词行，必须没有任何一行带内嵌换行
const xmlBr =
  '<w:document><w:body><w:p><w:t>第91集</w:t></w:p><w:tbl>' +
  '<w:tr>' + ['镜头', '画面', '台词', '备注'].map((x) => '<w:tc><w:p><w:t>' + x + '</w:t></w:p></w:tc>').join('') + '</w:tr>' +
  '<w:tr><w:tc><w:p><w:t>1</w:t></w:p></w:tc><w:tc><w:p><w:t>她抬头</w:t></w:p></w:tc>' +
  '<w:tc><w:p><w:t>杨凤：你吃几串了？</w:t><w:br/><w:t>王建华：才3串。</w:t></w:p></w:tc>' +
  '<w:tc><w:p><w:t>无</w:t></w:p></w:tc></w:tr>' +
  '</w:tbl></w:body></w:document>'
const resBr = util.splitScripts(util.extractDocxBlocks(xmlBr))
const linesBr = (resBr.segments[0] || {}).lines || []
ok('A9 端到端：带 <w:br/> 的表格格拆成独立两行',
  linesBr.indexOf('杨凤：你吃几串了？') >= 0 && linesBr.indexOf('王建华：才3串。') >= 0,
  JSON.stringify(linesBr))
ok('A10 端到端：输出行里没有任何内嵌换行',
  linesBr.every((l) => !/[\n\r]/.test(l)))

// ============================================================
console.log('\n=== 29-B. 角色名卫生：挡掉括号名与舞台说明词 ===')
// ============================================================
const nullOf = (x) => { const m = role.matchRole(x, [], []); return m ? m.name : null }

ok('B1 「（环境音：…）」不再被截成角色「（环境音」',
  nullOf('（环境音：窗外鸟叫、远处邻居家炒菜声）') === null,
  JSON.stringify(nullOf('（环境音：窗外鸟叫、远处邻居家炒菜声）')))

ok('B2 「（无）」不再被认成角色「无」', nullOf('（无）') === null)
ok('B3 「（无台词，…）」不会被当成角色', nullOf('（无台词，手机屏幕微微照亮她的脸）') === null)
ok('B4 正常「名字（修饰）：」不受影响', nullOf('王建华（笑着）：我晾') === '王建华')
ok('B5 括号名格式【林晚】不受影响', nullOf('【林晚】你知道吗') === '林晚')
ok('B6 isValidRoleName 拒绝含括号的名字',
  role.isValidRoleName('（环境音') === false && role.isValidRoleName('王（小）明') === false)
ok('B7 isValidRoleName 仍接受正常中文名与英文名',
  role.isValidRoleName('婆婆') === true && role.isValidRoleName('Tom') === true)
ok('B8 过滤词表已补占位/声音提示词',
  ['无', '环境音', '背景音', '空', '略'].every((w) => role.FILTER_WORDS.indexOf(w) >= 0))
ok('B9 isValidRoleName 拒绝纯数字序号（既有行为不回退）', role.isValidRoleName('12') === false)

// ============================================================
console.log('\n=== 29-C. 行首角色回填：「名字 + 动作描述 + 冒号」 ===')
// ============================================================
function parse(text) {
  const out = parser.parseScript(text, { roleHighlight: true })
  return out.lines.filter((l) => !l.isSpacer)
}

const c1 = parse('婆婆：凤儿，帮我把碗端过来。\n杨凤：好。\n婆婆把汤往杨凤面前推了推：先喝口热的。')
const c1Hit = c1.find((l) => l.text.indexOf('婆婆把汤') === 0)
ok('C1 动作描述型行首能回填出角色', !!c1Hit && c1Hit.role === '婆婆',
  c1Hit ? c1Hit.role : 'null')
ok('C2 回填的段落顺带切出前缀（名字高亮模式下也着色）',
  !!c1Hit && c1Hit.rolePrefix === '婆婆把汤往杨凤面前推了推：' && c1Hit.body === '先喝口热的。',
  c1Hit ? JSON.stringify(c1Hit.rolePrefix) : '')
ok('C3 回填结果计入角色统计', (() => {
  const out = parser.parseScript('婆婆：凤儿。\n婆婆把汤往杨凤面前推了推：先喝口热的。', { roleHighlight: true })
  const p = out.roles.find((r) => r.name === '婆婆')
  return !!p && p.count === 2
})())

// 不覆盖已识别出的角色
const linesNoOverwrite = [
  { text: '婆婆：凤儿。', role: '婆婆', sectionIndex: 0 },
  { text: '杨凤把碗接过来：谢谢妈。', role: null, sectionIndex: 1 }
]
parser.backfillRoleByKnownName(linesNoOverwrite, ['婆婆', '杨凤'])
ok('C4 绝不覆盖已识别出的角色', linesNoOverwrite[0].role === '婆婆')
ok('C5 无角色的行被正确回填', linesNoOverwrite[1].role === '杨凤')

ok('C6 名字之后超 15 字才到冒号 → 不回填',
  parse('婆婆：来了。\n婆婆把汤端过来放在杨凤面前轻轻推了推：先喝口热的。')
    .every((l) => l.text.indexOf('婆婆把汤端过来') !== 0 || l.role !== '婆婆'))

ok('C7 名字与冒号之间夹句末标点 → 不回填（防跨句误命中）',
  (() => {
    const ls = [
      { text: '婆婆：来了。', role: '婆婆', sectionIndex: 0 },
      { text: '婆婆说完了。把汤推了推：喝吧。', role: null, sectionIndex: 1 }
    ]
    parser.backfillRoleByKnownName(ls, ['婆婆'])
    return ls[1].role === null
  })())

ok('C8 角色名不在已知集合里 → 不回填',
  (() => {
    const ls = [{ text: '张三把门关上了：走吧。', role: null, sectionIndex: 0 }]
    parser.backfillRoleByKnownName(ls, ['婆婆', '杨凤'])
    return ls[0].role === null
  })())

ok('C9 名字有包含关系时优先更长的那个',
  (() => {
    const ls = [{ text: '凤凰男把书放下了：我走了。', role: null, sectionIndex: 0 }]
    parser.backfillRoleByKnownName(ls, ['凤凰', '凤凰男'])
    return ls[0].role === '凤凰男'
  })())

ok('C10 回填后行拿到角色色（可高亮）', (() => {
  const out = parser.parseScript('婆婆：凤儿。\n婆婆把汤往杨凤面前推了推：先喝口热的。', { roleHighlight: true })
  const hit = out.lines.find((l) => l.text.indexOf('婆婆把汤') === 0)
  return !!hit && !!hit.color
})())

// ============================================================
console.log('\n=== 29-D. 角色简称归并（保守） ===')
// ============================================================
const alias1 = role.computeAliases(['王建华', '建华'], {}, { 王建华: 10, 建华: 3 })
ok('D1 简称归并到全称（建华 → 王建华）', alias1['建华'] === '王建华', JSON.stringify(alias1))

const alias2 = role.computeAliases(['建华', '王建华'], {}, { 建华: 20, 王建华: 3 })
ok('D2 更长的名字出现次数更少 → 不归并（避免误并）', !alias2['建华'], JSON.stringify(alias2))

const alias3 = role.computeAliases(['杨凤', '小凤'], {}, { 杨凤: 100, 小凤: 14 })
ok('D3 非前后缀关系（小凤/杨凤）不会被误并', !alias3['小凤'], JSON.stringify(alias3))

const alias4 = role.computeAliases(['建华', '司马欧阳建华'], {}, { 建华: 1, 司马欧阳建华: 1 })
ok('D4 长度差 > 2 → 不归并', !alias4['建华'], JSON.stringify(alias4))

const alias5 = role.computeAliases(['建华', '王建华'], { 建华: '老王' }, { 王建华: 10, 建华: 3 })
ok('D5 手动规则优先于自动简称归并', alias5['建华'] === '老王', JSON.stringify(alias5))

const alias6 = role.computeAliases(['王建华', '王建华（笑着）', '建华'], {}, { 王建华: 10, '王建华（笑着）': 2, 建华: 3 })
ok('D6 括号变体与简称叠加归并到同一人',
  alias6['王建华（笑着）'] === '王建华' && alias6['建华'] === '王建华', JSON.stringify(alias6))

const alias7 = role.computeAliases(['李', '李明'], {}, { 李: 5, 李明: 1 })
ok('D7 单字名不参与归并（下游本就会过滤）', !alias7['李'], JSON.stringify(alias7))

ok('D8 端到端：同集内全称/简称合并成一个角色', (() => {
  const out = parser.parseScript('王建华：我晾。\n王建华：行。\n建华：走了。', { roleHighlight: true })
  return out.roles.length === 1 && out.roles[0].name === '王建华' && out.roles[0].count === 3
})())

ok('D9 端到端：合并后每一行都是同一个角色（颜色一致）', (() => {
  const out = parser.parseScript('王建华：我晾。\n王建华：行。\n建华：走了。', { roleHighlight: true })
  const named = out.lines.filter((l) => !l.isSpacer && l.role)
  return named.length === 3 && named.every((l) => l.role === '王建华')
})())

// ============================================================
console.log(`\n通过 ${pass} / ${pass + fail}`)
if (fail) {
  console.log('失败项：')
  process.exitCode = 1
}
