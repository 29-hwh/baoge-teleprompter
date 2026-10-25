'use strict'
/**
 * 拆分规则 / 角色名区分 / 显示方式 —— 随机数据多轮模糊测试台
 *
 * 用法：node fuzz_scripts.js <轮次 1|2|3> [脚本数] [随机种子]
 *
 * 被测链路：生成器 → splitDialogueCell / splitScripts(表格稿·段落稿) → parseScript
 *          → computeAliases / assignColors / resolveRoleFilter / filterLinesByRole / breakLine
 *
 * 不变量（违反即按「子类别」聚类，便于区分已知问题与新增问题）：
 *   INV1  无损：splitDialogueCell 各段拼接（去空白）可还原原文
 *   INV2  归属：显示行角色 == 该行所属单元的真实说话人（子分类：丢失/被动作污染/其他）
 *   INV3  不误染：舞台提示·口播·占位符不得产生角色（子分类：口播继承/括号提示/占位符）
 *   INV4  行宽：每行可视宽度 <= charsPerLine + 1（避头尾允许 1 字溢出）
 *   INV5  断行无损且超宽
 *   INV6  配色唯一（角色数 <= 色板长度时）
 *   INV7  同角色同色
 *   INV8  角色数一致
 *   INV9  按角色筛选不丢行
 *   INV10 表格稿「一表一集」
 *   INV11 角色名污染：角色名含括号/顿号/动作词
 *   INV12 手动别名生效
 *   INV13 黑名单生效
 */
const util = require('./miniprogram/utils/util.js')
const parser = require('./miniprogram/engine/parser.js')
const role = require('./miniprogram/engine/role.js')

// ---------------- 可复现随机源 ----------------
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rnd = Math.random
const pick = (a) => a[Math.floor(rnd() * a.length)]
const int = (n) => Math.floor(rnd() * n)
const chance = (p) => rnd() < p

// ---------------- 语料 ----------------
const NAMES = ['王建华', '杨凤', '小凤', '婆婆', '儿媳妇', '公公', '儿子', '李阿姨', '张阿姨', '兄弟A', '兄弟B', '林晚', 'Tom']
const MODS = ['（画外音）', '（小声）', '（嘟囔）', '（笑着）', '（红了眼眶，但赶紧笑了）', '(os)', '（急切）', '（不看杨凤）']
const ACTS = ['看一眼客厅', '头也不抬', '放下杯子', '叹了口气', '转身要走']
const SENT = [
  '今天天气真不错', '你先吃吧我不饿', '这事儿咱们回头再说', '我把衣服晾出去了',
  '妈您别忙了歇会儿', '明天还得早起上班呢', '饭在锅里自己盛', '这个月的开销又超了',
  '孩子作业写完了没有', '楼下超市在打折', '悟空浏览器上面短剧特别多', '家长里短古装穿越全都有',
  '想找啥剧一眼就能看到', '追剧还能攒金币提现', '关键是全都是免费的', '不用一集一集解锁',
  '刚上线的新剧也都能找到', '根本不愁找不到爱看的'
]
const STAGE = [
  '（无台词，手机屏幕微微照亮她的脸）', '（环境音：窗外鸟叫、远处邻居家炒菜声）',
  '（音效：手机震动）', '（无）', '（静场三秒）', '（切光）', '无台词',
  '（画面转向窗外，阳光很好）', '（两人对视，谁都没先开口）'
]
const ORAL_LEAD = ['这里面的短剧资源特别丰富', '悬疑烧脑玄幻修仙古装穿越重生逆袭应有尽有', '各种题材都分得清清楚楚']

function makeSentence(minLen, maxLen) {
  const target = minLen + int(Math.max(1, maxLen - minLen))
  let s = ''
  while (s.length < target) {
    s += pick(SENT)
    if (chance(0.5) && s.length < target) s += chance(0.5) ? '，' : '、'
  }
  if (chance(0.75)) s += pick(['。', '！', '？'])
  return s.slice(0, Math.max(4, target + int(20)))
}

/** 说话人写法 → {pre 前缀, who 真实姓名, form 形式标记} */
function makeSpeaker(profile) {
  const name = pick(NAMES)
  const r = rnd()
  if (r < 0.30) return { pre: name + '：', who: name, form: 'colon' }
  if (r < 0.52) return { pre: name + pick(MODS) + '：', who: name, form: 'parenRole' }
  if (r < 0.62) return { pre: '【' + name + '】', who: name, form: 'bracket' }
  if (r < 0.70) return { pre: '（' + name + '）', who: name, form: 'parenFull' }
  if (r < 0.76) return { pre: '[' + name + ']', who: name, form: 'square' }
  if (r < 0.82) return { pre: name + ' ' + '（' + pick(ACTS) + '）', who: name, form: 'action' }
  // 「名字+动作：」6~8 字候选（P1-k 区）
  if (r < 0.93) return { pre: name + pick(ACTS) + '：', who: name, form: 'nameAct' }
  // 多人齐说（P1-g 区）
  const other = pick(NAMES)
  return { pre: name + '、' + other + '：', who: name, form: 'multi', second: other }
}

function makeUnit(profile, mode) {
  const r = rnd()
  if (r < 0.07) return { kind: 'blank', text: '', parts: [] }
  if (r < 0.20) {
    const t = pick(STAGE)
    return { kind: 'stage', text: t, who: null, parts: [{ text: t, who: null }] }
  }
  if (r < 0.30) {
    // 超长无标点口播（切块区，P1-i 温床）
    let s = ''
    const len = profile === 'adv' ? 150 + int(150) : 90 + int(90)
    while (s.length < len) s += pick(ORAL_LEAD)
    return { kind: 'oral', text: s, who: null, parts: [{ text: s, who: null }] }
  }
  const sp = makeSpeaker(profile)
  const longRate = profile === 'adv' ? 0.35 : 0.18
  const body = chance(longRate) ? makeSentence(121, 280) : makeSentence(6, 100)
  const parts = [{ text: sp.pre + body, who: sp.who, form: sp.form }]
  let text = sp.pre + body
  // 同格/同行追加第二说话人：仅表格稿有意义（splitDialogueCell 会按说话人拆）。
  // 段落稿不做按说话人切分，一行多人在解析层本就归第一人，故不生成，避免伪失败。
  if (mode === 'table' && chance(profile === 'adv' ? 0.45 : 0.3)) {
    const sp2 = makeSpeaker(profile)
    const glue = chance(0.3) ? '' : (chance(0.5) ? ' ' : '。')
    const body2 = makeSentence(6, 60)
    text += glue + sp2.pre + body2
    // 预期归属：粘连(glue==='')、说话人名超 5 字(nameAct)、多人齐说(multi)
    // 三种情况按现有设计不会拆开 → 仍归第一个说话人
    const splittable = glue !== '' && sp2.form !== 'nameAct' && sp2.form !== 'multi'
    parts.push({ text: sp2.pre + body2, who: splittable ? sp2.who : sp.who, form: sp2.form, merged: !splittable })
  }
  return { kind: 'dialogue', text: text, who: sp.who, parts: parts }
}

function makeEpisode(profile, mode) {
  const n = 5 + int(12)
  const units = []
  for (let i = 0; i < n; i++) units.push(makeUnit(profile, mode))
  if (!units[0].text) units[0] = makeUnit(profile, mode)
  return units
}
const render = (units) => units.map((u) => u.text).join('\n')

// ---------------- 失败聚类 ----------------
const fails = {}
let checks = 0
function fail(cat, msg) {
  if (!fails[cat]) { fails[cat] = []; fails[cat].n = 0 }
  fails[cat].n++
  if (fails[cat].length < 4) fails[cat].push(msg)
}
const squash = (s) => String(s || '').replace(/\s+/g, '')
const vw = (s) => { let w = 0; for (const c of String(s || '')) w += /[\x00-\xff]/.test(c) ? 0.5 : 1; return w }

// ---------------- 主测试 ----------------
function testOne(profile) {
  const units = makeEpisode(profile, 'para')
  const content = render(units)

  // INV1
  units.forEach((u) => {
    if (!u.text) return
    checks++
    const frags = util.splitDialogueCell(u.text)
    if (squash(frags.join('')) !== squash(u.text)) {
      fail('INV1_拆分丢失字符', `原文="${u.text.slice(0, 26)}…" → "${frags.join('|').slice(0, 36)}…"`)
    }
  })

  const cpl = pick([14, 18, 26, 34])
  const hl = chance(0.85)
  const parsed = parser.parseScript(content, {
    charsPerLine: cpl, roleHighlight: hl, isDark: chance(0.5), manualRoles: [], roleBlacklist: []
  })

  // INV4
  parsed.lines.forEach((l) => {
    checks++
    const w = vw(l.text)
    if (w > cpl + 1.001) fail('INV4_行宽溢出', `cpl=${cpl} w=${w.toFixed(1)} "${(l.text || '').slice(0, 24)}"`)
  })

  // INV2 / INV3：把显示行映射回所属「片段」（同一单元内可能有两个说话人，必须按片段归属）
  const flat = []
  units.forEach((u) => (u.parts || []).forEach((p) => flat.push({ text: p.text, who: p.who, form: p.form, kind: u.kind })))
  parsed.lines.forEach((l) => {
    if (l.isSpacer) return
    const probe = squash(l.body || l.text)
    if (!probe) return
    const owners = flat.filter((p) => squash(p.text).indexOf(probe) >= 0)
    if (owners.length !== 1) return
    checks++
    const p = owners[0]
    const got = l.role
    if (!hl) {
      if (got !== null) fail('INV0_关闭高亮仍有角色', `got=${got}`)
      return
    }
    if (p.who == null) {
      if (got !== null) {
        const sub = p.kind === 'oral' ? 'INV3a_口播被误继承染色' : 'INV3b_舞台提示或占位符被误染'
        fail(sub, `got角色="${got}" 原文="${p.text.slice(0, 26)}…"`)
      }
      return
    }
    const merged = role.applyAlias(p.who, parsed.alias || {})
    if (got !== merged) {
      if (got === null) fail('INV2a_丢失角色', `期望="${p.who}" 形式=${p.form} 原文="${p.text.slice(0, 30)}"`)
      else if (String(got).indexOf(p.who) === 0) fail('INV2b_角色名被动作污染', `期望="${p.who}" 得到="${got}" 形式=${p.form}`)
      else {
        fail('INV2c_归属其他错误', `期望="${p.who}" 得到="${got}" 形式=${p.form} 原文="${p.text.slice(0, 30)}"`)
        if (process.env.DBG && !global.__dbg) {
          global.__dbg = 1
          console.log('\n===== DBG 首个 INV2c 现场 =====')
          units.forEach((u, i) => console.log(`U${i} kind=${u.kind} who=${u.who} "${u.text.slice(0, 70)}"`))
          console.log('--- parsed lines ---')
          parsed.lines.forEach((l, i) => console.log(`L${i} role=${l.role} sec=${l.sectionIndex} start=${l.isSectionStart} body="${(l.body || '').slice(0, 34)}"`))
          console.log('--- alias ---', JSON.stringify(parsed.alias))
        }
      }
    }
  })

  // INV11 角色名污染
  if (hl) {
    ;(parsed.roles || []).forEach((r) => {
      checks++
      if (/[（）()【】\[\]、，]/.test(r.name)) fail('INV11a_角色名含包裹或顿号', `"${r.name}"`)
      else if (ACTS.some((a) => r.name.indexOf(a) >= 0)) fail('INV11b_角色名含动作词', `"${r.name}"`)
    })

    // INV6/7/8
    const names = Array.from(new Set(parsed.lines.filter((l) => l.role).map((l) => l.role)))
    checks++
    if (parsed.roles.length !== names.length) fail('INV8_角色数不一致', `roles=${parsed.roles.length} 行内=${names.length}`)
    if (parsed.roles.length && parsed.roles.length <= 8) {
      const cs = parsed.roles.map((r) => r.color)
      checks++
      if (new Set(cs).size !== cs.length) fail('INV6_配色重复', `n=${parsed.roles.length} ${cs.join(',')}`)
    }
    const cmap = {}
    parsed.lines.forEach((l) => {
      if (!l.role) return
      checks++
      if (cmap[l.role] === undefined) cmap[l.role] = l.color
      else if (cmap[l.role] !== l.color) fail('INV7_同角色不同色', l.role)
    })

    // INV9 筛选不丢
    if (parsed.roles.length) {
      const target = pick(parsed.roles).name
      const set = role.resolveRoleFilter([target], parsed.roles, parsed.alias || {})
      const filtered = role.filterLinesByRole(parsed.lines, set)
      const should = parsed.lines.filter((l) => !l.role || l.role === target).length
      checks++
      if (filtered.length < should) fail('INV9_筛选丢行', `目标="${target}" 应=${should} 实=${filtered.length}`)
    }

    // INV12 手动别名
    if (parsed.roles.length >= 2) {
      const src = parsed.roles[parsed.roles.length - 1].name
      const tgt = parsed.roles[0].name
      const p2 = parser.parseScript(content, { charsPerLine: cpl, roleHighlight: true, roleAlias: { [src]: tgt } })
      const left = p2.lines.filter((l) => l.role && role.applyAlias(l.role, p2.alias) === src).length
      checks++
      if (left > 0) fail('INV12_手动别名未生效', `${src}→${tgt} 仍有 ${left} 行`)
    }

    // INV13 黑名单
    if (parsed.roles.length) {
      const banned = parsed.roles[0].name
      const p3 = parser.parseScript(content, { charsPerLine: cpl, roleHighlight: true, roleBlacklist: [banned] })
      const left = p3.lines.filter((l) => l.role === banned).length
      checks++
      if (left > 0) fail('INV13_黑名单未生效', `拉黑"${banned}" 仍有 ${left} 行`)
    }
  }

  // INV5 breakLine 直接测
  const t = makeSentence(20, 200)
  const bl = parser.breakLine(t, cpl, cpl - 3)
  checks++
  if (bl.join('') !== t) fail('INV5a_断行拼接不等于原文', `len=${t.length}`)
  bl.forEach((x) => { checks++; if (vw(x) > cpl + 1.001) fail('INV5b_断行超宽', `cpl=${cpl} w=${vw(x).toFixed(1)}`) })
}

function testTable(profile) {
  const tables = 1 + int(3)
  const blocks = []
  for (let i = 0; i < tables; i++) {
    blocks.push({ type: 'paragraph', text: `测试剧第${81 + i}集` })
    const rows = [['镜号', '人物', '台词']]
    const n = 3 + int(10)
    for (let r = 0; r < n; r++) {
      const u = makeUnit(profile, 'table')
      if (!u.text) continue
      rows.push([String(r + 1), u.who || '', u.text])
    }
    blocks.push({ type: 'table', rows })
  }
  checks++
  const res = util.splitScripts(blocks)
  if (!res.ok || !res.segments || res.segments.length !== tables) {
    fail('INV10_表格集数不符', `期望=${tables} 实际=${res.segments ? res.segments.length : 0}`)
    return
  }
  res.segments.forEach((s) => {
    const parsed = parser.parseScript((s.lines || []).join('\n'), { roleHighlight: true, charsPerLine: 26 })
    parsed.lines.forEach((l) => {
      checks++
      if (vw(l.text) > 27.001) fail('INV4_行宽溢出(表格)', `w=${vw(l.text).toFixed(1)}`)
    })
  })
}

// ---------------- 主流程 ----------------
const round = Number(process.argv[2] || 1)
const N = Number(process.argv[3] || 3000)
const SEED = Number(process.argv[4] || (round === 3 ? 20260919 : 1000 + round))
rnd = mulberry32(SEED)
const profile = round === 2 ? 'adv' : 'broad'

console.log(`===== 第 ${round} 轮 profile=${profile} 脚本数=${N} 种子=${SEED} =====`)
for (let i = 0; i < N; i++) {
  testOne(profile)
  if (i % 3 === 0) testTable(profile)
}
console.log('\n===== 失败聚类 =====')
const cats = Object.keys(fails).sort()
if (!cats.length) console.log('  ✅ 全部不变量通过')
cats.forEach((c) => {
  console.log(`  🔴 ${c}: ${fails[c].n} 条`)
  fails[c].forEach((m) => console.log('       · ' + m))
})
console.log('\n===== 汇总 =====')
console.log(`  断言次数=${checks}  类别数=${cats.length}  失败总数=${cats.reduce((a, c) => a + fails[c].n, 0)}`)
