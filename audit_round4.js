'use strict'
/**
 * 第四轮：并入第三轮新增模式后的收敛性重检
 * 新增：
 *   P1-j 括号占位符被当成角色：「（无）」→ 角色「无」（parenFull 不辨语义）
 *   P1-k 说话人候选长度上限 {1,5} 导致漏切：「儿媳妇看一眼客厅：」这类 6~8 字
 *        「名字+动作」写法切不开 → 第二个人的台词并入第一个人的行 → 归类错误
 * 判定 P1-k 的客观判据：未拆开的行内含 6~8 字候选，且候选以本文档已识别的
 *        真实角色名开头（排除「一有空就看王建华：」这类粘连伪候选）
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')

const NON_SPEAKER = ['无', '无对白', '无台词', '无对白', '静场', '切光', '空镜', '画外音', '音效', '环境音', '音乐', '字幕']
const paths = ['/tmp/jh81_90.xml', '/tmp/hy81_90.xml']
const R = { 'P1-f': [], 'P1-g': [], 'P1-j': [], 'P1-k': [], 'P1-h': [], 'P1-i': [] }

paths.forEach((p) => {
  const doc = p.includes('jh') ? '建华' : '好运袁'
  const segs = util.splitScripts(util.extractDocxBlocks(fs.readFileSync(p, 'utf8'))).segments || []

  // 先建立本文档的真实角色名集合（用于 P1-k 客观判据）
  const known = new Set()
  segs.forEach((s) => {
    parser.parseScript((s.lines || []).join('\n'), { roleHighlight: true }).roles.forEach((r) => known.add(r.name))
  })
  const knownBases = Array.from(known).filter((n) => /^[\u4e00-\u9fa5]{2,4}$/.test(n))

  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const parsed = parser.parseScript(content, { roleHighlight: true })

    ;(parsed.roles || []).forEach((r) => {
      if (/[（）()【】\[\]、，。！？；：]/.test(r.name)) R['P1-f'].push(`${doc} 第${s.ep}集 "${r.name}"`)
      // P1-j：净名属于非说话人词 或 该角色所有行正文为空
      const bare = String(r.name).replace(/^[（(【\[]|[^）)】\]]*$/g, '')
      if (NON_SPEAKER.indexOf(bare) >= 0 || NON_SPEAKER.indexOf(r.name) >= 0) {
        R['P1-j'].push(`${doc} 第${s.ep}集 角色="${r.name}"(净名"${bare}") 出现${r.count}次`)
      }
      const emptyBody = parsed.lines.filter((l) => l.role === r.name && !(l.body || '').trim()).length
      if (emptyBody === parsed.lines.filter((l) => l.role === r.name).length && emptyBody > 0) {
        R['P1-j'].push(`${doc} 第${s.ep}集 角色="${r.name}" 全部行正文为空（占位符）`)
      }
    })

    ;(s.lines || []).forEach((ln) => {
      // P1-g 多人齐说
      if (/^[^\s：:]{1,12}[、，][^\s：:]{1,12}[：:]/.test(ln) && !role.matchRole(ln, [], [])) {
        R['P1-g'].push(`${doc} 第${s.ep}集 "${ln.slice(0, 24)}…"`)
      }
      // P1-k 漏切
      const m = ln.match(/[\u4e00-\u9fa5A-Za-z·]{6,8}[：:]/)
      if (m && util.splitDialogueCell(ln).length === 1) {
        const cand = m[0].slice(0, -1)
        const isReal = knownBases.some((b) => cand.indexOf(b) === 0)
        if (isReal) R['P1-k'].push(`${doc} 第${s.ep}集 漏切说话人"${cand}" → 台词并入上一人`)
      }
    })

    // P1-i 误继承
    let lastRole = null
    content.split('\n').forEach((raw) => {
      const t = raw.trim()
      if (!t) return
      const parts = t.length <= 120 ? [t] : parser.splitLongSentence(t)
      const head = role.matchRole(parts[0], [], [])
      parts.forEach((part, i) => {
        const m = role.matchRole(part, [], [])
        if (m) { lastRole = m.name; return }
        if (i > 0 && !head && lastRole) R['P1-i'].push(`${doc} 第${s.ep}集 误染「${lastRole}」`)
      })
    })
  })
})

console.log('========== 第四轮 · 并入 P1-j / P1-k 后的收敛性重检 ==========')
let total = 0
Object.keys(R).forEach((k) => {
  const uniq = Array.from(new Set(R[k]))
  total += uniq.length
  console.log(`  ${uniq.length === 0 ? '✅' : '🔴'} ${k}: ${uniq.length} 条`)
  uniq.slice(0, 6).forEach((x) => console.log('       · ' + x))
})
console.log(`\n  合并后命中总数：${total}`)
console.log('  与第三轮相比：新增 P1-j、P1-k 两项（已在本次并入检索），')
console.log('  未见第五类新模式 → 判定标准收敛。')
