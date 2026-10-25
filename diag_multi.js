/**
 * 多人同格专项诊断（只读，不写任何文件）
 *
 * 用法：node diag_multi.js /tmp/jsxf_doc.xml
 *
 * 目的：专门盯「同一个台词格里出现两个或多个人物」这一场景。
 * 与 diag_accuracy.js 的分工：那个看整篇零丢字；这个**逐格**核对「一行一人」是否成立。
 *
 * 四类检查（全部用产品自身函数，不另写一套解析）：
 *   M1 行数守恒  解析出的行数 == 格子自身的行结构（软件换行/段落边界切出的非空行数）
 *   M2 零丢字    各段拼接（去空白）== 原文（去空白）→ 既不吞字也不改写
 *   M3 无粘连    任何一段里不得再出现第二个「行首说话人 + 冒号」
 *   M4 归属正确  每段要么能识别出角色，要么是舞台说明（整段被括号包住）
 *
 * 末节列出「本文档没有、但现实中必然出现」的边界写法，逐条验证。
 *
 * ⚠️ 判定规则必须与产品同源：早期版本这里自己写了一套「左边界非中文就切」的
 * 简化规则，结果把产品**故意不切**的两种情形（引号内的引用、并列连接后的
 * 联合说话人）误报成「粘连」。现已改为直接调用产品的 insideQuote /
 * jointSpeakerBefore，判定与解析同源。
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const role = require('./miniprogram/engine/role.js')

const xmlPath = process.argv[2] || '/tmp/jsxf_doc.xml'
const xml = fs.readFileSync(xmlPath, 'utf8')

let pass = 0
const fails = []
function ok(cond, name) { if (cond) pass++; else fails.push(name) }

const nospace = (s) => String(s || '').replace(/\s+/g, '')

/**
 * 说话人切点的判定 —— 与产品同一套规则（左边界非中文 && 不在引号内 && 不在并列连接之后）
 */
// 本稿已知说话人白名单：由下方 knownNames / edgeNames 在使用前赋值。
// 与产品链路一致 —— 说话人左边界是汉字时，只有白名单里的名字才敢切。
let NAMES = {}
const SPK = /([\u4e00-\u9fa5A-Za-z·]{1,5}(?:（[^）]*）)?)[：:]/g
function speakerCuts(s) {
  const cuts = []
  let m
  SPK.lastIndex = 0
  while ((m = SPK.exec(s)) !== null) {
    const before = m.index > 0 ? s[m.index - 1] : ''
    if (before && !/[^\u4e00-\u9fa5·]/.test(before) && !NAMES[m[1]]) continue
    if (util.insideQuote(s, m.index)) continue
    // 联合说话人（「A、B：」）的切点要左移到整组最前面；-1 表示该切点作废。
    // 直接调产品函数，保证「诊断判定」与「实际解析」不会各说各话。
    const c = util.resolveJointCut(s, m.index, NAMES)
    if (c >= 0 && (!cuts.length || c > cuts[cuts.length - 1])) cuts.push(c)
  }
  return cuts
}
const hasRole = (s) => !!role.matchRole(s, [], [])
const isStage = (s) => /^[（(]/.test(s) && /[）)]/.test(s)

// ---------- 产品链路取格子 ----------
const blocks = util.extractDocxBlocks(xml)
const tables = blocks.filter((b) => b.type === 'table')
const allCells = []
tables.forEach((t, ti) => {
  ;(t.rows || []).forEach((cells, ri) => {
    ;(cells || []).forEach((txt, ci) => {
      if (txt) allCells.push({ ti: ti + 1, ri: ri + 1, ci: ci + 1, txt })
    })
  })
})
const dialogueCells = allCells.filter((c) => c.ci === 3)

// 一路独立的原始 XML 扫描（仅作统计与交叉核对，不参与判定）
const rawBr = (xml.match(/<w:br\b[^>]*\/?>/g) || []).length
const rawTc = (xml.match(/<w:tc>/g) || []).length

const docLines = (txt) => String(txt).split(/\n+/).map((x) => x.trim()).filter((x) => x)
const isMulti = (txt) => {
  const ls = docLines(txt)
  return ls.filter((l) => speakerCuts(l).length >= 1).length >= 2
}
const multi = dialogueCells.filter((c) => isMulti(c.txt))

// 产品链路在拆整表时是**带白名单**的（collectSpeakerNames 预扫全稿），
// 所以逐格复核也必须带上，否则会把「靠白名单才救得回来的真粘连」误判成丢行。
const knownNames = util.collectSpeakerNames(tables)
NAMES = knownNames

console.log('=== 多人同格专项诊断 ===')
console.log('文档：' + xmlPath)
console.log('表 ' + tables.length + ' 个 / 单元格 ' + rawTc + ' 个 / <w:br/> ' + rawBr + ' 个')
console.log('台词列格子 ' + dialogueCells.length + ' 个，其中**多人同格** ' + multi.length + ' 个')
console.log('已知说话人白名单：' + Object.keys(knownNames).length + ' 个\n')

// ---------- 逐格四检 ----------
let m1bad = 0, m2bad = 0, m3bad = 0, m4bad = 0
const m3d = [], m4d = []
multi.forEach((c) => {
  const tag = '表' + c.ti + ' R' + c.ri
  const expect = docLines(c.txt)
  const got = util.splitDialogueCell(c.txt, knownNames)

  // M1 行数守恒：产品输出行数必须 ≥ 文档自身的行结构（少了就是丢行）。
  // 多于文档行数是**允许**的：文档把两人写在同一物理行（真粘连）时，
  // 产品按白名单拆成两行正是我们想要的行为。
  if (got.length < expect.length) {
    m1bad++
    fails.push('M1 ' + tag + ' 丢行 ' + got.length + ' < 文档行结构 ' + expect.length +
      '  「' + got.join(' | ').slice(0, 90) + '」')
  } else pass++

  if (nospace(got.join('')) !== nospace(c.txt)) {
    m2bad++
    fails.push('M2 ' + tag + ' 丢字/变形 「' + nospace(c.txt).slice(0, 70) + '」→「' + nospace(got.join('')).slice(0, 70) + '」')
  } else pass++

  got.forEach((seg) => {
    if (speakerCuts(seg).length >= 2) { m3bad++; m3d.push(tag + ' 「' + seg.slice(0, 70) + '」') } else pass++
  })
  got.forEach((seg) => {
    if (!hasRole(seg) && !isStage(seg)) { m4bad++; m4d.push(tag + ' 「' + seg.slice(0, 70) + '」') } else pass++
  })
})

console.log('--- M1 行数守恒 ---  失败 ' + m1bad + ' 格')
console.log('--- M2 零丢字   ---  失败 ' + m2bad + ' 格')
console.log('--- M3 无粘连   ---  失败 ' + m3bad + ' 段')
m3d.slice(0, 10).forEach((x) => console.log('      ' + x))
console.log('--- M4 归属正确 ---  失败 ' + m4bad + ' 段')
m4d.slice(0, 12).forEach((x) => console.log('      ' + x))

const dist = {}
multi.forEach((c) => {
  const n = docLines(c.txt).filter((l) => speakerCuts(l).length >= 1).length
  dist[n] = (dist[n] || 0) + 1
})
console.log('\n说话人数分布：' + Object.keys(dist).sort().map((k) => k + '人×' + dist[k]).join('  '))

// ---------- 边界写法 ----------
console.log('\n=== 边界写法（本文档未出现，必须同样正确）===')
// 每条用例都在「产品真实上下文」下跑：白名单由全部用例文本预扫得到 ——
// 真实链路 collectSpeakerNames 也是从全稿预扫，测试条件必须一致。
const edge = [
  ['同段两人·句末标点相隔', '杨凤：你吃几串了？王建华：才3串。', 2],
  ['同段两人·无标点相隔（真粘连）', '杨凤：你吃几串了王建华：才3串。', 2],
  ['三人同段', '杨凤：你吃几串了？王建华：才3串。婆婆：给我留两串！', 3],
  ['软换行 1 个', '杨凤：你吃几串了？\n王建华：才3串。', 2],
  ['软换行 2 个（空行）', '杨凤：你吃几串了？\n\n王建华：才3串。', 2],
  ['段间空行 + 3 人', '杨凤：一。\n王建华：二。\n\n婆婆：三。', 3],
  ['名字带括号动作', '王建华（小声嘟囔）：就高一点点。\n杨凤（瞪他一眼）：你说啥？', 2],
  ['括号在冒号之后', '小凤：（笑）你还没用悟空浏览器？\n建华：（疑惑）不花钱？', 2],
  ['名字+动作描述+冒号', '婆婆：先喝汤。\n婆婆把汤往杨凤面前推了推：先喝口热的。\n杨凤：谢谢妈。', 3],
  ['联合说话·顿号', '王建华、杨凤：我们一起回来了。', 1],
  ['联合说话·和', '王建华和杨凤：我们一起回来了。', 1],
  ['联合说话·还有', '王建华还有杨凤：我们一起回来了。', 1],
  ['联合说话·以及', '王建华以及杨凤：我们一起回来了。', 1],
  ['联合说话·顿号+动作', '王建华、杨凤（齐声）：我们一起回来了。', 1],
  ['联合说话·齐声', '两人（齐声）：新年好！', 1],
  ['正文里的「和」不是连接词', '杨凤：我买了菜和肉。王建华：知道了。', 2],
  ['英文冒号', '杨凤:你吃几串了?\n王建华:才3串.', 2],
  ['单字名', '爸：早点睡。\n妈：知道了。', 2],
  ['间隔号名字', '阿·依：我到了。\n阿·依：路上慢点。', 2],
  ['间隔号名字·真粘连', '杨凤：你到哪了阿·依：到楼下了。', 2],
  ['舞台说明夹中间', '杨凤：你吃几串了？\n（无台词，手机屏幕微微照亮她的脸）\n王建华：才3串。', 3],
  ['行首提示语 + 说话人', '（静场三秒）建华：饭在锅里。', 2],
  ['正文里出现别人名+冒号（引号内）', '杨凤：他跟我说"王建华：我不去"，你信吗？', 1],
  ['嵌套引号（引号内再引号）', '杨凤：妈说"你问他\'建华：我不去\'"，你信吗？', 1],
  ['四人对答 + 空行', '李阿姨：真有这么好的事？\n张阿姨：那你也给我下一个呗！\n\n婆婆（豪气地）：行！\n杨凤：好嘞。', 4]
]
// 白名单：拿全部用例文本走一次产品自己的收集器（与真实链路同源）
const edgeNames = util.collectSpeakerNames([{ rows: edge.map((e) => [e[1]]) }])
NAMES = edgeNames

const edgeBad = []
edge.forEach(([name, text, expect]) => {
  const got = util.splitDialogueCell(text, edgeNames)
  const loss = nospace(got.join('')) !== nospace(text)
  const glue = got.some((s) => speakerCuts(s).length >= 2)
  const good = got.length === expect && !loss && !glue
  console.log((good ? '  ✅ ' : '  ❌ ') + name +
    '  行数 ' + got.length + '/' + expect + (loss ? '  ⚠丢字' : '') + (glue ? '  ⚠粘连' : ''))
  if (!good) {
    edgeBad.push(name)
    got.forEach((s) => console.log('        → 「' + s.replace(/\n/g, '⏎') + '」'))
  }
})

console.log('\n=== 汇总 ===')
console.log('逐格断言：通过 ' + pass + ' / 失败 ' + fails.length)
if (fails.length) {
  console.log('失败明细：')
  fails.slice(0, 25).forEach((f) => console.log('  ✗ ' + f))
}
console.log('边界写法：' + (edge.length - edgeBad.length) + '/' + edge.length +
  (edgeBad.length ? '  未通过 → ' + edgeBad.join(' / ') : ' 全通过'))
process.exit(fails.length || edgeBad.length ? 1 : 0)
