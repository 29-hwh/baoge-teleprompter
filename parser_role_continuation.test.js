// 锁定「超长台词被分段后，后半截丢失角色」的修复
// 触发样本：《建华&小凤的生活81-90.docx》第84集 王建华（画外音）的 128 字广告词。
// 现象（名字+台词高亮模式）：同一句话念到「而且现在大家伙都在追的爆款」起忽然掉色，
// 因 splitSections 把 >120 字的行按句末标点切成多段，而第 2 段起不再带「角色名：」前缀，
// parseScript 又是逐段跑 role.matchRole 的 → 后半截 matchRole 失败、role=null。
const parser = require('./miniprogram/engine/parser.js')

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')) }
}

// 真实样本：第84集 128 字广告词（>120，必然被 splitLongSentence 切开）
const LONG_LINE =
  '王建华（画外音）： 你看，我就是在这个悟空浏览器上面看的，这里面短剧特别多，家长里短、古装穿越、' +
  '重生逆袭、悬疑烧脑全都有，各种题材都分得清清楚楚，想找啥剧一眼就能看到，很方便。' +
  '而且现在大家伙都在追的爆款，刚上线的新剧也都能在里面找到，根本不愁找不到爱看的。'

console.log('1. 超长台词：所有显示行都必须保持同一角色')
{
  const parsed = parser.parseScript(LONG_LINE, { charsPerLine: 26, roleHighlight: true })
  const spoken = parsed.lines.filter((l) => !l.isSpacer && String(l.body || '').trim())
  ok('确认该行已被切成多段（否则本用例无意义）', spoken.length > 4, '显示行=' + spoken.length)
  ok('每一行都归到王建华（无角色行=0）', spoken.every((l) => l.role === '王建华'),
    spoken.map((l) => l.role))
  ok('只有首行带「王建华（画外音）：」前缀',
    spoken.filter((l) => String(l.rolePrefix || '').indexOf('王建华') >= 0).length === 1)
  ok('「而且现在大家伙都在追的爆款」这一段有角色',
    spoken.filter((l) => String(l.body).indexOf('而且现在大家伙') >= 0).every((l) => l.role === '王建华'))
}

console.log('\n2. 短台词（≤120字）行为不变')
{
  const shortLine = '王建华（画外音）： 关键是这里的短剧全都是免费的，不用一集一集解锁，随便点开一部就能从头顺畅看到大结局，追剧特过瘾。'
  const parsed = parser.parseScript(shortLine, { charsPerLine: 26, roleHighlight: true })
  const spoken = parsed.lines.filter((l) => !l.isSpacer && String(l.body || '').trim())
  ok('短台词不会被切段', spoken.length <= 4, '显示行=' + spoken.length)
  ok('短台词全部保持角色', spoken.every((l) => l.role === '王建华'))
}

console.log('\n3. 防误伤：独立的无角色行不得被继承染色')
{
  const text = '王建华：前面的台词。\n（无台词，画面转向窗外）'
  const parsed = parser.parseScript(text, { charsPerLine: 26, roleHighlight: true })
  const stage = parsed.lines.filter((l) => String(l.body || '').indexOf('画面转向窗外') >= 0)
  ok('存在该舞台提示行', stage.length === 1)
  ok('舞台提示行仍为无角色（不被上一句染上）', stage.length === 1 && stage[0].role === null,
    stage.map((l) => l.role))
}

console.log('\n4. 回归保护：splitSections 与 stats 段数口径')
{
  const secs = parser.splitSections('第一段内容\n\n\n第二段内容')
  ok('splitSections 仍返回字符串数组', typeof secs[0] === 'string')
  ok('splitSections 保留一个空行占位段', secs.length === 3 && secs[1] === '', JSON.stringify(secs))
  const parsed = parser.parseScript('第一段。\n\n第二段。', { charsPerLine: 26 })
  ok('stats.sections 不把空行计入段数', parsed.stats.sections === 2, parsed.stats.sections)
  ok('stats.chars 不受空行影响', parsed.stats.chars === 8, parsed.stats.chars)
  const qs = parser.quickStats('第一段。\n\n第二段。')
  ok('quickStats 段数口径一致', qs.sections === 2, qs.sections)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
