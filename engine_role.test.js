/* 角色引擎回归测试：覆盖所有匹配模式 + 本次修复（parenRole / 无台词过滤） */
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

console.log('== 1. 六种基础匹配模式 ==')
ok('【林晚】bracket', role.matchRole('【林晚】你好', [], []) && role.matchRole('【林晚】你好', [], []).name === '林晚')
ok('[Tom] square', role.matchRole('[Tom] hi', [], []) && role.matchRole('[Tom] hi', [], []).name === 'Tom')
ok('（旁白）parenFull 算角色', (() => { const m = role.matchRole('（旁白）他说', [], []); return m && m.name === '旁白' })())
ok('(OS) parenHalf', role.matchRole('(OS) 自语', [], []) && role.matchRole('(OS) 自语', [], []).name === 'OS')
ok('林晚： colon', role.matchRole('林晚： 你好', [], []) && role.matchRole('林晚： 你好', [], []).name === '林晚')
ok('林 晚： colonLoose（含空格）', role.matchRole('林 晚： 你好', [], []) && role.matchRole('林 晚： 你好', [], []).name === '林晚')
ok('顾辞 （放下杯子）action（空格）', (() => { const m = role.matchRole('顾辞 （放下杯子）台词', [], []); return m && m.name === '顾辞' })())

console.log('== 2. 本次修复：名字（修饰）：无空格格式 ==')
ok('婆婆（红了眼眶，但赶紧笑了）： 长修饰→婆婆', (() => { const m = role.matchRole('婆婆（红了眼眶，但赶紧笑了）： 你们咋回来了？', [], []); return m && m.name === '婆婆' })())
ok('小凤（在旁边听到了，脸色沉下来）： →小凤', (() => { const m = role.matchRole('小凤（在旁边听到了，脸色沉下来）： 又要走？', [], []); return m && m.name === '小凤' })())
ok('建华（认真）： →建华', (() => { const m = role.matchRole('建华（认真）： 妈', [], []); return m && m.name === '建华' })())
ok('建华（电话里）： →建华', (() => { const m = role.matchRole('建华（电话里）： 行', [], []); return m && m.name === '建华' })())

console.log('== 3. 本次修复：无台词/舞台提示不算角色 ==')
ok('（无台词）不算角色', role.matchRole('（无台词）', [], []) === null)
ok('（静场）不算角色', role.matchRole('（静场）', [], []) === null)
ok('（空镜）不算角色', role.matchRole('（空镜）', [], []) === null)

console.log('== 4. 去括号归并（computeAliases）==')
;{
  const names = ['王二（小声说）', '王二（笑着）', '王二(os)']
  const a = role.computeAliases(names, {})
  ok('王二（小声说）→王二', a['王二（小声说）'] === '王二')
  ok('王二（笑着）→王二', a['王二（笑着）'] === '王二')
  ok('王二(os)→王二', a['王二(os)'] === '王二')
}
;{
  // 只有带修饰变体、从没写过裸名，也应归并
  const a = role.computeAliases(['王二（笑着）'], {})
  ok('仅变体也归并到净名', a['王二（笑着）'] === '王二')
}

console.log('== 5. 黑名单排除 ==')
ok('黑名单排除建华', role.matchRole('建华： 你好', [], ['建华']) === null)

console.log('== 6. 手动合并 alias ==')
;{
  const a = role.computeAliases(['小张', '小小'], { '小张': '小小' })
  ok('手动 小张→小小', a['小张'] === '小小')
}

console.log('== 7. 完整 parseScript 跑用户台词 ==')
;{
  const SCRIPT = `婆婆（冲着门口喊）： 建华！小凤！快过来吃饭！
建华（电话里）： 行，我知道了。
小凤（压着声音）： 妈知道我们要回来。
婆婆： 咋了？有事啊？
（无台词）
建华： 公司临时出状况。
小凤：还有上星期，妈说灯泡坏了。
婆婆（红了眼眶，但赶紧笑了）： 你们咋回来了？
建华（认真）：妈，忽略您了。
婆婆： 好，好！`
  const r = parser.parseScript(SCRIPT, { roleHighlight: true, isDark: true })
  const names = r.roles.map((x) => x.name).sort()
  ok('只识别 3 个角色', r.stats.roleCount === 3)
  ok('角色为 婆婆/小凤/建华（按 unicode 排序）', JSON.stringify(names) === JSON.stringify(['婆婆', '小凤', '建华']))
  ok('无「无台词」角色', names.indexOf('无台词') < 0)
  // （无台词）所在行不应带角色
  const wutai = r.lines.filter((l) => l.text.indexOf('无台词') >= 0)
  ok('（无台词）行无角色', wutai.length > 0 && wutai.every((l) => l.role === null))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
