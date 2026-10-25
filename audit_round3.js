'use strict'
/**
 * 第三轮：并入第二轮新发现的模式后重新检索 + 已确认项抽样端到端回归
 *
 * 新增判定标准（第二轮发现后并入）：
 *   P1-f 包裹符号污染角色名：「（环境音：…）」被 colon 模式切成角色「（环境音」
 *   P1-g 多人齐说无法识别：「A、B：」因 isValidRoleName 拒绝含「、」的名字而整体无角色
 *   P1-h 元信息关键词误当角色：人物/道具/时间/地点 未进 FILTER_WORDS，出现即成角色
 *   P1-i 无角色超长段 + 上文有角色 → 延续段误继承（CK10 前置 + lastRole 非空）
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')

const paths = ['/tmp/jh81_90.xml', '/tmp/hy81_90.xml']
const META_LIKE = ['人物', '道具', '时间', '地点', '场景', '画面', '镜头', '音效', '环境音', '画外音', '旁白', '备注', '集', '场']

console.log('========== 第三轮 · A. 并入新标准后的全量重检 ==========')
let allRoles = new Set()
let findings = { 'P1-f': [], 'P1-g': [], 'P1-h': [], 'P1-i': [] }

paths.forEach((p) => {
  const xml = fs.readFileSync(p, 'utf8')
  const blocks = util.extractDocxBlocks(xml)
  const segs = (util.splitScripts(blocks).segments) || []
  const doc = p.includes('jh') ? '建华' : '好运袁'

  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const parsed = parser.parseScript(content, { roleHighlight: true })

    // P1-f：角色名含包裹/分隔符号
    ;(parsed.roles || []).forEach((r) => {
      allRoles.add(r.name)
      if (/[（）()【】\[\]、，。！？；：]/.test(r.name)) {
        findings['P1-f'].push(`${doc} 第${s.ep}集 角色名="${r.name}" 出现${r.count}次`)
      }
      // P1-h：元信息关键词被当成角色
      if (META_LIKE.indexOf(r.name) >= 0) {
        findings['P1-h'].push(`${doc} 第${s.ep}集 元信息词被当角色="${r.name}" 出现${r.count}次`)
      }
    })

    // P1-g：多人齐说
    ;(s.lines || []).forEach((ln) => {
      if (/^[^\s：:]{1,12}[、，][^\s：:]{1,12}[：:]/.test(ln) && !role.matchRole(ln, [], [])) {
        findings['P1-g'].push(`${doc} 第${s.ep}集 "${ln.slice(0, 24)}…"`)
      }
    })

    // P1-i：无角色超长段 + 上文有角色 → 误继承（端到端实证，非模拟）
    let lastRole = null
    content.split('\n').forEach((raw) => {
      const t = raw.trim()
      if (!t) return
      const parts = t.length <= 120 ? [t] : parser.splitLongSentence(t)
      const head = role.matchRole(parts[0], [], [])
      parts.forEach((part, i) => {
        const m = role.matchRole(part, [], [])
        if (m) { lastRole = m.name; return }
        if (i > 0 && !head && lastRole) {
          findings['P1-i'].push(`${doc} 第${s.ep}集 误染成「${lastRole}」: "${part.slice(0, 30)}…"`)
        }
      })
    })
  })
})

Object.keys(findings).forEach((k) => {
  const n = findings[k].length
  console.log(`  ${n === 0 ? '✅' : '🔴'} ${k}: ${n} 条`)
  findings[k].slice(0, 6).forEach((x) => console.log('       · ' + x))
})
console.log('  全部角色名清单：' + Array.from(allRoles).join(' / '))

console.log('\n========== 第三轮 · B. 已确认项端到端抽样回归 ==========')

// B1. P1-f 实证：直接跑 matchRole
console.log('\n[B1] P1-f 括号舞台提示被误判为角色')
;[
  '（环境音：窗外鸟叫、远处邻居家炒菜声）',
  '（画外音）王建华：你看这个',
  '[旁白]这里是旁白内容',
  '（音效：手机震动）'
].forEach((c) => {
  const m = role.matchRole(c, [], [])
  console.log(`   "${c.slice(0, 22)}" → ${m ? 'role="' + m.name + '"  prefix="' + m.prefix + '"' : '无角色'}`)
})

// B2. P1-g 实证
console.log('\n[B2] P1-g 多人齐说')
;['婆婆、儿媳妇：这可是你自己说的！', '婆婆，儿媳妇：这可是你自己说的！', '张三、李四、王五：我们一起上']
  .forEach((c) => {
    const m = role.matchRole(c, [], [])
    const okName = role.isValidRoleName('婆婆、儿媳妇')
    console.log(`   "${c.slice(0, 20)}" → ${m ? 'role=' + m.name : '无角色'}   (isValidRoleName("婆婆、儿媳妇")=${okName})`)
  })

// B3. 基线修复回归：第84集原句
console.log('\n[B3] 基线（第84集超长台词）回归')
const jh = util.splitScripts(util.extractDocxBlocks(fs.readFileSync('/tmp/jh81_90.xml', 'utf8'))).segments
const ep4 = jh.find((s) => Number(s.epNo) === 84) || jh[3]
const target = (ep4.lines || []).find((l) => l.indexOf('悟空浏览器') >= 0)
if (target) {
  const parsed = parser.parseScript((ep4.lines || []).join('\n'), { roleHighlight: true, charsPerLine: 26 })
  const idx = parsed.lines.findIndex((l) => (l.text || '').indexOf('悟空浏览器') >= 0)
  console.log('   原文长度=' + target.length)
  for (let i = idx; i < Math.min(idx + 7, parsed.lines.length); i++) {
    const l = parsed.lines[i]
    console.log(`   [${i}] role=${l.role || '❌无'}  "${(l.text || '').slice(0, 30)}"`)
  }
} else {
  console.log('   ⚠ 未找到该句，需人工确认')
}

// B4. 防误伤回归：舞台提示不应被染上角色色
console.log('\n[B4] 防误伤：无角色独立行不得被染色')
const probe = '王建华：今天天气不错。\n（无台词，手机屏幕微微照亮她的脸）\n小凤：是啊。'
const pp = parser.parseScript(probe, { roleHighlight: true })
pp.lines.forEach((l, i) => console.log(`   [${i}] role=${l.role || '（无，正确）'}  "${l.text}"`))

console.log('\n========== 第三轮 · C. 结论 ==========')
const total = Object.values(findings).reduce((a, b) => a + b.length, 0)
console.log(`合并后命中总数：${total}`)
console.log('若本轮相对上轮无新增模式，则判定收敛。')
