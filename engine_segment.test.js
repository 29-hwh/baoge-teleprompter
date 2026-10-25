/**
 * 智能分段引擎测试：覆盖长文按句拆分、对话按说话人切分、空行保留、超长无标点切块。
 * 运行：node engine_segment.test.js
 */
'use strict'

const parser = require('./miniprogram/engine/parser.js')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '  -> ' + extra : ''))
  }
}

console.log('=== 1. 长文按句末标点拆分 ===')
// 首句本身 > 40 字，会在句末标点处断开；短段落（<40 字）保持完整
const longNarration =
  '这真的是一段非常非常长的台词内容用来测试智能分段功能是否能够按照句末标点正常地把长句拆分开来方便阅读。第二句话也单独成一段。'
const seg1 = parser.smartSegment(longNarration).split('\n')
ok('长文被拆成多段', seg1.length >= 2, `segments=${seg1.length}`)
ok('第一段以句号结尾', seg1[0].endsWith('。'), seg1[0])
ok('每段都带内容', seg1.every((s) => s.trim().length > 0))

console.log('\n=== 2. 同一行多说话人按轮次切分 ===')
const dialogue = '张三：你好啊今天天气不错。李四：是啊一起去散步吧。'
const seg2 = parser.smartSegment(dialogue).split('\n')
ok('对话被切成多段', seg2.length >= 2, `segments=${seg2.length}`)
ok('含「张三：」轮次', seg2.some((s) => s.indexOf('张三：') === 0), JSON.stringify(seg2))
ok('含「李四：」轮次', seg2.some((s) => s.indexOf('李四：') === 0), JSON.stringify(seg2))
ok('不是把名字当普通句子拆碎', seg2.filter((s) => s.indexOf('张三：') === 0).length === 1)

console.log('\n=== 3. 短段落保持完整（不强行拆句） ===')
const shortP = '今天天气真好。'
const seg3 = parser.smartSegment(shortP).split('\n')
ok('短段落仍是单段', seg3.length === 1 && seg3[0] === shortP, JSON.stringify(seg3))

console.log('\n=== 4. 空行作为呼吸点被保留 ===')
const withBlank = '第一段内容\n\n第二段内容'
const seg4 = parser.smartSegment(withBlank)
ok('空行被保留', seg4.indexOf('\n\n') >= 0, JSON.stringify(seg4))

console.log('\n=== 5. 超长无标点文本按块切分 ===')
const noPunct = '一'.repeat(125) // 125 个无标点字符
const seg5 = parser.smartSegment(noPunct).split('\n')
ok('无标点长文被切块（多段）', seg5.length >= 2, `segments=${seg5.length}`)
ok('单块不超过 70 字', seg5.every((s) => s.length <= 70), `max=${Math.max(...seg5.map((s) => s.length))}`)

console.log('\n=== 6. 括号角色名不被误判为说话人 ===')
const parenRole = '婆婆（冲着门口喊）：建华快过来吃饭。'
const seg6 = parser.smartSegment(parenRole).split('\n')
ok('括号角色名整段保留', seg6.length === 1 && seg6[0].indexOf('婆婆（冲着门口喊）：') === 0, JSON.stringify(seg6))

console.log('\n=== 7. 空输入安全 ===')
ok('空串返回空串', parser.smartSegment('') === '')
ok('纯空白返回空串/仅空白', parser.smartSegment('   \n  ').trim() === '')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
