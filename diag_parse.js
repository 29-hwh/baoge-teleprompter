'use strict'
/**
 * 诊断（v2）：走产品完整链路 splitScripts → parseScript，检查「角色识别 / 行归属」准确性。
 * 用法：node diag_parse.js /tmp/jsxf_doc.xml
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')

const xml = fs.readFileSync(process.argv[2], 'utf8')
const blocks = util.extractDocxBlocks(xml)
const res = util.splitScripts(blocks)

const allRoleStat = {}
let totalLines = 0, nullRole = 0
const suspicious = []
const orphan = [] // 有冒号但没归到角色

console.log('===== 每集：角色识别质量 =====')
res.segments.forEach((seg) => {
  const text = (seg.lines || []).join('\n')
  const out = parser.parseScript(text, { roleHighlight: true })
  const named = out.lines.filter((l) => !l.isSpacer)
  const withRole = named.filter((l) => l.role)
  const noRole = named.filter((l) => !l.role)
  totalLines += named.length
  nullRole += noRole.length

  const roleStr = out.roles.map((r) => `${r.name}×${r.count}`).join(' ')
  console.log(`\n【${seg.name}】段${named.length}行 / 有角色${withRole.length} / 无角色${noRole.length}`)
  console.log(`  角色(${out.roles.length}): ${roleStr}`)

  out.roles.forEach((r) => { allRoleStat[r.name] = (allRoleStat[r.name] || 0) + r.count })

  // 无角色行里，含「：」的——疑似归属丢失（说话人没被认出来）
  noRole.forEach((l) => {
    const t = (l.text || '').trim()
    if (!t) return
    if (/[：:]/.test(t) && t.length > 6) {
      orphan.push({ ep: seg.name, text: t })
    }
    if (/^（无）$|^\(无\)$/.test(t)) suspicious.push({ kind: '（无）当成角色?', ep: seg.name, text: t })
  })
})

console.log('\n\n===== 汇总：全片角色分布 =====')
const names = Object.keys(allRoleStat).sort((a, b) => allRoleStat[b] - allRoleStat[a])
names.forEach((n) => {
  const flag = /^\d+$/.test(n) || /[，。！？、；：]/.test(n) || n.length > 8
  console.log(`  ${flag ? '⚠️ ' : '   '}${n} ×${allRoleStat[n]}`)
})
console.log(`角色总数 ${names.length}`)

console.log(`\n===== 行统计：共 ${totalLines} 行，其中无角色 ${nullRole} 行（${(nullRole / totalLines * 100).toFixed(1)}%）=====`)

console.log('\n===== 疑似「说话人没认出来」的行（无角色但含冒号）=====')
if (!orphan.length) console.log('  无')
orphan.forEach((o) => console.log(`  [${o.ep}] ${JSON.stringify(o.text).slice(0, 130)}`))

console.log('\n===== 可疑角色名 =====')
const sus = names.filter((n) => /^\d+$/.test(n) || /[，。！？、；：]/.test(n) || n.length > 8 || n.length === 1)
if (!sus.length) console.log('  无')
sus.forEach((n) => console.log(`  ${JSON.stringify(n)} ×${allRoleStat[n]}`))

// 抽样：第 87 集（含内嵌换行那集）
console.log('\n===== 抽样：第 87 集 全部行（含 role）=====')
const ep87 = res.segments.find((s) => String(s.name).indexOf('87') >= 0)
if (ep87) {
  const out = parser.parseScript((ep87.lines || []).join('\n'), { roleHighlight: true })
  out.lines.forEach((l, i) => {
    if (l.isSpacer) { console.log(`  ${String(i + 1).padStart(2)}| (空行)`); return }
    console.log(`  ${String(i + 1).padStart(2)}| [${l.role || '—'}] ${l.text}`)
  })
}
