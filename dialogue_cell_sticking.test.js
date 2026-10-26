// 锁定 splitDialogueCell 的「粘连不拆 / 正常多轮仍拆」修复
// 触发样本：《建华&小凤的生活81-90.docx》第84/85/87集：同一台词单元格内多轮对白
// 的后一句说话人名字与前一句内容直接粘连（无标点/空格），旧规则会把前句截断、
// 把真实说话人名字污染成伪说话人，导致「台词高亮后面半截失效」。
// 用相对路径解析，勿硬编码工程绝对路径（工程目录一挪测试就 MODULE_NOT_FOUND）
const path = require('path')
const U = path.join(__dirname, 'miniprogram/utils/util.js')
const util = require(U)
const sdc = util.splitDialogueCell

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

// 1. 宝哥 Bug1：第84集结尾「好吧，是我想多了」粘连 —— 不应拆两段、不截断、不污染
{
  const t = '杨凤（嘟囔）： 好吧，看来是我想多了王建华：好啦，凤儿，误会解开了，赶紧睡吧。'
  const r = sdc(t)
  ok('Bug1 不拆成两段（返回1行）', r.length === 1)
  ok('Bug1 保留「杨凤（嘟囔）：」前缀', r[0].startsWith('杨凤（嘟囔）：'))
  ok('Bug1 「看来是我想多了」完整不丢', r[0].includes('看来是我想多了'))
  ok('Bug1 不污染为「看来是我想多了王建华：」', !r[0].startsWith('看来是我想多了王建华'))
}

// 2. 第84集 R15 粘连：「怪不」不得被截断
{
  const t = '杨凤： ……还真是，怪不得你一有空就看王建华：我这几天都看了好几部了'
  const r = sdc(t)
  ok('R15 不拆（1行）', r.length === 1)
  ok('R15 保留「杨凤：」前缀', r[0].startsWith('杨凤：'))
  ok('R15 「怪不得」完整不丢', r[0].includes('怪不得'))
}

// 3. 第85集 R9 粘连
{
  const t = '小凤：饭好了，吃完饭再去看建华：（笑）好嘞！'
  const r = sdc(t)
  ok('85R9 不拆（1行）', r.length === 1)
  ok('85R9 保留「小凤：」前缀', r[0].startsWith('小凤：'))
}

// 4. 第87集 R9 粘连（说话人 + 动作描述直接粘连）
{
  const t = '婆婆（不看杨凤）：行了，刚才是妈话说重了。你也上一天班，以后衣服让建华晾。婆婆把汤往杨凤面前推了推：先喝口热的。'
  const r = sdc(t)
  ok('87R9 不拆成「把汤往…推了推」伪说话人', r.length === 1)
  ok('87R9 保留「婆婆（不看杨凤）：」前缀', r[0].startsWith('婆婆（不看杨凤）：'))
}

// 5. 正常多轮（空格分隔）仍应正确拆行
{
  const t = '杨凤： 你少贫。王建华： 行了，我跟你交代。'
  const r = sdc(t)
  ok('正常多轮(空格)拆2行', r.length === 2)
  ok('正常多轮 行1以「杨凤：」开头', r[0].startsWith('杨凤：'))
  ok('正常多轮 行2以「王建华：」开头', r[1].startsWith('王建华：'))
}

// 6. 正常多轮（标点分隔）仍应正确拆行
{
  const t = '王建华：没有啊，咋这么问？杨凤：你最近天天抱着手机看'
  const r = sdc(t)
  ok('正常多轮(标点)拆2行', r.length === 2)
  ok('正常多轮 行2以「杨凤：」开头', r[1].startsWith('杨凤：'))
}

// 7. 长广告词口播（无冒号）不拆
{
  const t = '王建华（画外音）： 你看，我就是在这个悟空浏览器上面看的，这里面短剧特别多，家长里短、古装穿越、重生逆袭、悬疑烧脑全都有，各种题材都分得清清楚楚，想找啥剧一眼就能看到，很方便。'
  const r = sdc(t)
  ok('长广告词不拆（1行）', r.length === 1)
}

// 8. 贪婪长候选（「看来是我想多了王建华：」）不拆
{
  const t = 'A：好吧，看来是我想多了王建华：好嘞'
  const r = sdc(t)
  ok('贪婪候选不拆（1行）', r.length === 1)
}

// 9. 首段之前的文字不得丢失（真实样本：《建华&小凤的生活81-90.docx》环境提示单元格）
//    旧实现每段都从 cuts[i]（说话人起点）开始，导致第一个切点之前的内容
//    从未被任何段覆盖 → 静默丢弃，表现为「（环境音：…）」只剩右半边「…）」。
{
  const t = '（环境音：窗外鸟叫、远处邻居家炒菜声）'
  const r = sdc(t)
  ok('括号提示 左右括号都保留', r[0].indexOf('（') === 0 && r[0].indexOf('）') === r[0].length - 1)
  ok('括号提示 与原文完全一致', r.join('') === t)
}

// 10. 无损性总闸：任意单元格拆分后重新拼接，必须能还原原文（去空白后相等）
{
  const cases = [
    '（环境音：窗外鸟叫、远处邻居家炒菜声）',
    '杨凤（嘟囔）： 好吧，看来是我想多了王建华：好啦，凤儿，误会解开了，赶紧睡吧。',
    '婆婆（不看杨凤）：这汤啊，得慢慢炖婆婆把汤往杨凤面前推了推：',
    '小凤：饭好了，吃完饭再去看建华：好嘞'
  ]
  let allOk = true
  cases.forEach((t) => {
    const joined = sdc(t).join('').replace(/\s/g, '')
    if (joined !== t.replace(/\s/g, '')) allOk = false
  })
  ok('拆分后拼接可还原原文（无损，无丢字）', allOk)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
