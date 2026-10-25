'use strict'
/**
 * 同类问题全量排查工具 —— 「延续段上下文丢失（CCL）」及其衍生模式
 *
 * 基线问题：《建华&小凤的生活》第84集，超长台词被切段后，第2段起丢失「角色名：」前缀，
 *          而下游逐段推导角色 → 后半截 role=null → 名字+台词高亮下掉色。
 *
 * 抽象判定标准（四要素同时成立即为同类）：
 *   A 切分点：存在「1 个文本单元 → N 个片段」的切分函数
 *   B 上下文：被切单元携带「位置相关」的上下文（行首说话人前缀 / 角色 / 包裹符号配对）
 *   C 推导点：下游对每个片段【独立】重新推导该上下文，未跨片段传递
 *   D 触发条件：切分由阈值或标点触发 → 只有部分数据命中（表现为「有些句子出错」）
 *
 * 检测项：
 *   CK1 切分后延续片段缺失说话人前缀（主模式）
 *   CK2 超阈值静默不拆（P1-d）
 *   CK3 配对符号被切破（P1-e）
 *   CK4 延续段继承角色是否生效（正向验证基线修复）
 *   CK5 延续段【误继承】——无角色长段被切开后，后半截被染上前一个角色（反向缺陷）
 *   CK6 角色名被包裹符号污染（P1-f）
 *   CK7 多人齐说「A、B：」无法识别（P1-g）
 *   CK8 smartSegment 潜伏的同模式缺陷（死代码，重新启用即发作）
 *   CK9 quickStats 与 parseScript 角色数一致性（P1-c 双路径）
 *
 * 运行：node audit_context_loss.js <document.xml> [...]
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')

const files = process.argv.slice(2)
const paths = files.length ? files : ['/tmp/jh81_90.xml', '/tmp/hy81_90.xml']

/** 片段是否以「说话人前缀」开头（宽松判定，用于找孤儿片段） */
function hasSpeakerPrefix(s) {
  const t = String(s || '').trim()
  if (!t) return false
  return /^(?:[（(【\[][^）)】\]]{1,12}[）)】\]]\s*)?[^\s：:。！？!?，、]{1,8}(?:[（(][^（）()]{1,20}[）)])?[：:]/.test(t)
}

/** 配对符号计数 */
function bracketBalance(s) {
  const pairs = [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']'], ['「', '」'], ['《', '》']]
  const bad = []
  pairs.forEach(([l, r]) => {
    const a = (s.split(l).length - 1)
    const b = (s.split(r).length - 1)
    if (a !== b) bad.push(`${l}${a}/${r}${b}`)
  })
  return bad
}

let totalFindings = 0
function report(tag, items, limit) {
  const n = items.length
  const badge = n === 0 ? '✅' : '🔴'
  console.log(`  ${badge} ${tag}: ${n} 条`)
  if (n) {
    totalFindings += n
    items.slice(0, limit || 5).forEach((x) => console.log('       · ' + x))
    if (n > (limit || 5)) console.log(`       … 另有 ${n - (limit || 5)} 条`)
  }
}

paths.forEach((p) => {
  if (!fs.existsSync(p)) {
    console.log(`\n########## ${p} —— 文件不存在，跳过 ##########`)
    return
  }
  console.log(`\n########## ${p} ##########`)
  const xml = fs.readFileSync(p, 'utf8')
  const blocks = util.extractDocxBlocks(xml)
  const res = util.splitScripts(blocks)
  const segs = res.segments || []

  // ---------- 收集原始单元格 ----------
  const cells = []
  blocks.filter((b) => b.type === 'table').forEach((tbl) => {
    ;(tbl.rows || []).forEach((row, ri) => {
      ;(row || []).forEach((c, ci) => {
        if (c && String(c).trim()) cells.push({ text: String(c).trim(), at: `R${ri + 1}C${ci + 1}` })
      })
    })
  })
  console.log(`  表格单元格(非空)=${cells.length}  集数=${segs.length}`)

  // ---------- CK1 延续片段缺失说话人前缀 ----------
  const ck1 = []
  let multiFrag = 0
  cells.forEach((c) => {
    const frags = util.splitDialogueCell(c.text)
    if (frags.length > 1) {
      multiFrag++
      frags.forEach((f, i) => {
        if (i > 0 && !hasSpeakerPrefix(f)) ck1.push(`${c.at} 第${i + 1}段无前缀: "${f.slice(0, 30)}…"`)
      })
    }
  })
  console.log(`  [CK1] 被拆成多段的单元格=${multiFrag}`)
  report('CK1 延续片段缺失说话人前缀', ck1)

  // ---------- CK2 超阈值静默不拆 ----------
  const ck2 = cells.filter((c) => c.text.length > 600).map((c) => `${c.at} 长度=${c.text.length} → splitDialogueCell 直接原样返回，多轮对白不再拆行`)
  report('CK2 超 600 字静默不拆', ck2)

  // ---------- CK3 配对符号被切破 ----------
  const ck3 = []
  cells.forEach((c) => {
    if (bracketBalance(c.text).length) return // 原文本身就不配对，不算切分造成
    const frags = util.splitDialogueCell(c.text)
    if (frags.length > 1) {
      frags.forEach((f, i) => {
        const b = bracketBalance(f)
        if (b.length) ck3.push(`${c.at} 第${i + 1}段括号不配对[${b.join(' ')}]: "${f.slice(0, 30)}…"`)
      })
    }
  })
  report('CK3 配对符号被切破', ck3)

  // ---------- CK4 / CK5 延续段继承（正向 + 反向误继承） ----------
  const ck5 = []
  const ck4ok = []
  const ck10 = []
  let longLines = 0
  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    let lastRole = null
    content.split('\n').forEach((raw) => {
      const t = raw.trim()
      if (!t) return
      const parts = t.length <= 120 ? [t] : parser.splitLongSentence(t)
      if (parts.length <= 1) {
        const m0 = role.matchRole(t, [], [])
        if (m0) lastRole = m0.name
        return
      }
      longLines++
      // 首段是否自带角色：决定延续段继承是「正确继承」还是「误继承」
      const head = role.matchRole(parts[0], [], [])
      if (!head) ck10.push(`第${s.ep}集 超长行首段即无角色(长度${t.length})，延续段将继承上一个角色「${lastRole || '无'}」: "${t.slice(0, 30)}…"`)
      parts.forEach((part, i) => {
        const m = role.matchRole(part, [], [])
        const continued = i > 0
        const effRole = m ? m.name : (continued && lastRole ? lastRole : null)
        if (m) lastRole = m.name
        if (!m && continued && lastRole) {
          if (head) {
            ck4ok.push(`第${s.ep}集 正确继承「${effRole}」`) // 首段有角色 → 延续段继承是对的
          } else {
            ck5.push(`第${s.ep}集 误继承：整行本无角色，延续段却被染成「${effRole}」: "${part.slice(0, 34)}…"`)
          }
        }
      })
    })
  })
  console.log(`  [CK4] 超过 120 字被切分的行=${longLines}  其中延续段【正确】继承=${ck4ok.length}`)
  report('CK5 延续段误继承（整行本无角色却被染上前一个角色）', ck5)
  report('CK10 超长行首段无角色（CK5 的前置条件）', ck10)

  // CK1 抽样复核：打印若干真实多段样本，确认判定不是「过松导致 0 命中」
  console.log('  [CK1 抽样] 多段样本前 3 例：')
  let shown = 0
  for (const c of cells) {
    const frags = util.splitDialogueCell(c.text)
    if (frags.length > 1 && shown < 3) {
      shown++
      console.log(`       ${c.at} → ${frags.length} 段: ` + frags.map((f) => '「' + f.slice(0, 14) + '」').join(' | '))
    }
  }

  // ---------- CK6 角色名被包裹符号污染 ----------
  const ck6 = []
  const badNameRe = /[（）()【】\[\]、，。！？；：]/
  segs.forEach((s) => {
    const parsed = parser.parseScript((s.lines || []).join('\n'), { roleHighlight: true })
    ;(parsed.roles || []).forEach((r) => {
      if (badNameRe.test(r.name)) ck6.push(`第${s.ep}集 角色名="${r.name}"（含包裹/分隔符号）`)
    })
  })
  report('CK6 角色名被包裹符号污染', ck6)

  // ---------- CK7 多人齐说「A、B：」 ----------
  const ck7 = []
  segs.forEach((s) => {
    ;(s.lines || []).forEach((ln) => {
      if (/^[^\s：:]{1,12}[、，][^\s：:]{1,12}[：:]/.test(ln) && !role.matchRole(ln, [], [])) {
        ck7.push(`第${s.ep}集 "${ln.slice(0, 26)}…"`)
      }
    })
  })
  report('CK7 多人齐说无法识别', ck7)

  // ---------- CK9 双路径角色数一致性 ----------
  const ck9 = []
  segs.forEach((s) => {
    const content = (s.lines || []).join('\n')
    const q = parser.quickStats(content)
    const p = parser.parseScript(content, { roleHighlight: true })
    if (q.roleCount !== p.stats.roleCount) {
      ck9.push(`第${s.ep}集 quickStats.roleCount=${q.roleCount} ≠ parseScript.roleCount=${p.stats.roleCount}`)
    }
  })
  report('CK9 quickStats 与 parseScript 角色数不一致', ck9, 10)
})

// ---------- CK8 smartSegment 潜伏缺陷（与文档无关，静态复现） ----------
console.log('\n########## CK8 smartSegment 潜伏同模式缺陷（静态复现） ##########')
const sample = '王建华（画外音）：你看，我就是在这个悟空浏览器上面看的，这里面短剧特别多，家长里短、古装穿越、重生逆袭、悬疑烧脑全都有，各种题材都分得清清楚楚。而且现在大家伙都在追的爆款，刚上线的新剧也都能在里面找到。'
const out = parser.smartSegment(sample).split('\n')
console.log('  输入（含「王建华（画外音）：」前缀、长度 ' + sample.length + '）')
out.forEach((l, i) => {
  const m = role.matchRole(l, [], [])
  console.log(`   →[${i + 1}] ${m ? 'role=' + m.name : 'role=❌无'}  "${l.slice(0, 36)}…"`)
})
const lost = out.filter((l, i) => i > 0 && !role.matchRole(l, [], []) && l.trim())
if (lost.length) {
  totalFindings += lost.length
  console.log(`  🔴 smartSegment 有 ${lost.length} 个延续段丢失说话人前缀（同 CK1 主模式，落库后不可逆）`)
} else {
  console.log('  ✅ smartSegment 本次未出现前缀丢失')
}
console.log('  注：smartSegment 当前在 miniprogram/ 下无任何调用点（仅 prefs 开关与测试引用），属潜伏缺陷')

console.log(`\n===== 合计命中 ${totalFindings} 条 =====`)
