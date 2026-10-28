/**
 * 稿件解析引擎
 *
 * 关键设计（见架构文档 8.1）：
 * 断行必须预计算出行数组，不能依赖 CSS 自动换行。
 * 原因：提词台需要精确定位「当前读到第几行」，CSS 换行拿不到行索引。
 */

const role = require('./role.js')

/** 不允许出现在行首的标点（避头尾规则） */
const NO_LINE_START = '，。、；：！？）」』》】}%…·,.;:!?)]}'

/** 句末标点，用于长段二次切分与句子计数 */
const SENTENCE_END = /[。！？!?]/

/**
 * 字符可视宽度：中文/全角算 1，ASCII 算 0.5
 */
function charWidth(ch) {
  return /[\x00-\xff]/.test(ch) ? 0.5 : 1
}

/**
 * 计算字符串的可视宽度（中文/全角算 1，ASCII 算 0.5）
 */
function visualWidth(s) {
  let w = 0
  for (let i = 0; i < s.length; i++) w += charWidth(s[i])
  return w
}

/**
 * 把一段文本按可视宽度断行
 * @param {string} text
 * @param {number} maxWidth 每行可容纳的中文字数
 * @param {number} [firstLineMax] 首行可用宽度（带角色前缀时减去前缀宽度，避免溢出）
 * @returns {Array<string>}
 */
function breakLine(text, maxWidth, firstLineMax) {
  const lines = []
  let cur = ''
  let w = 0
  // 首行预算若算出 <=0（角色名比整行还宽），直接回落到整行宽度，
  // 避免「第一行只挤进 1 个字、又把超宽前缀留在同一行」导致后续台词被裁掉的死分支。
  let budget = firstLineMax == null || firstLineMax <= 0 ? maxWidth : firstLineMax
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const cw = charWidth(ch)
    if (w + cw > budget && cur.length > 0) {
      // 避头尾：这个字符不能出现在行首，就允许它溢出留在当前行
      if (NO_LINE_START.indexOf(ch) >= 0) {
        cur += ch
        lines.push(cur)
        cur = ''
        w = 0
      } else {
        lines.push(cur)
        cur = ch
        w = cw
      }
      // 第一行之后统一用 maxWidth，并重置宽度预算
      budget = maxWidth
    } else {
      cur += ch
      w += cw
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/**
 * 长段落按句末标点二次切分，避免单段过长导致滚动时视线跳跃。
 * 若整段没有任何句末标点（长口播稿常见），则按固定长度切块制造自然停顿。
 */
function splitLongSentence(text) {
  const parts = []
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    buf += text[i]
    if (SENTENCE_END.test(text[i]) && buf.length >= 40) {
      parts.push(buf)
      buf = ''
    }
  }
  if (!buf.trim()) return parts
  // 没有触发过句末切分：说明是超长无标点文本，按块切分
  if (parts.length === 0) {
    const CHUNK = 60
    for (let i = 0; i < buf.length; i += CHUNK) {
      parts.push(buf.slice(i, i + CHUNK))
    }
    return parts
  }
  if (buf.trim()) parts.push(buf)
  return parts
}

/**
 * 把原始文本切成段落，并标出哪些段是「因超长而被切出来的延续段」。
 *
 * 为什么需要 continued 标记：超过 120 字的行会被 splitLongSentence 按句末标点
 * 切成多段，而切出来的第 2 段起天然不再带「角色名：」前缀（前缀只在首段）。
 * parseScript 是逐段跑 role.matchRole 的，于是后半截匹配不到角色 →
 * 「名字+台词高亮」下表现为同一句话念到一半掉色、后半截归类为无角色。
 * 典型样本：《建华&小凤的生活》第84集 王建华（画外音）的 128 字广告词，
 * 从「而且现在大家伙都在追的爆款」起整段丢失角色色（同集 98 字那句不受影响）。
 *
 * @returns {Array<{text:string, continued:boolean}>} continued=true 表示是延续段
 */
function splitSectionsEx(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let pendingGap = false
  raw.forEach((line) => {
    const t = line.trim()
    if (!t) {
      // 空行是用户刻意留的段落间隔：压成一个占位空段（连续空行只算一个），
      // parseScript 会把它渲染成一条空行呼吸点，而不是直接丢弃。
      if (sections.length > 0) pendingGap = true
      return
    }
    if (pendingGap) {
      sections.push({ text: '', continued: false })
      pendingGap = false
    }
    if (t.length <= 120) {
      sections.push({ text: t, continued: false })
    } else {
      const parts = splitLongSentence(t)
      parts.forEach((s, i) => {
        sections.push({ text: s, continued: i > 0 })
      })
    }
  })
  return sections
}

/**
 * 把原始文本切成段落（旧签名，返回纯字符串数组）
 */
function splitSections(text) {
  return splitSectionsEx(text).map((s) => s.text)
}

/**
 * 智能分段：把一大段「粘贴进来、没有好好排版」的台词整理成适合提词器阅读的段落。
 *
 * 设计依据（线上调研）：
 * - GoTeleprompter / 奇叶提词器的最佳实践：每行 35-50 字、每段 2-3 句、空行当呼吸点；
 *   长文必须按「句末标点(。！？)」断句，绝不在句子中间断开（避头尾）。
 * - 对话体按「说话人轮次」切分：一行里出现多个「角色名：」时，每人各成一段。
 * - 超长且无标点的文本按固定长度切块（60 字），制造自然停顿。
 * - 过短的残片合并回上一段，避免屏幕上出现一两个字的碎行。
 *
 * 与 splitSections 的区别：splitSections 只在解析期按 \n 切；smartSegment 是「导入时」
 * 把原文真正改写成带换行的可读稿，结果会落库、可在编辑器里继续手改，所见即所得。
 *
 * @param {string} text 原始文本
 * @returns {string} 用 \n 连接、已分段好的文本（空行保留为呼吸点）
 */
function smartSegment(text) {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  blocks.forEach((raw) => {
    const t = raw.trim()
    if (!t) {
      out.push('') // 保留用户主动留的空行（呼吸点）
      return
    }
    // 1) 按说话人轮次切（同一条里出现多个角色名时每人一段）
    const turns = splitBySpeakers(t)
    turns.forEach((turn) => {
      // 2) 每个轮次按句末标点拆句；过长再按块切（与 splitLongSentence 同源逻辑）
      splitLongSentence(turn).forEach((seg) => out.push(seg))
    })
  })
  return mergeShortSegments(out).join('\n')
}

/**
 * 在字符串中从 from 之后寻找下一个「说话人标记」的起始下标。
 * 说话人标记：括号名【x】/[x]/（x）/(x)，或「名字 + 冒号」。
 * 命中后校验名字合法性，避免把「我的想法是：」误判为说话人。
 * 注意：名字部分排除句末标点（。！？），否则贪婪匹配会跨过句号把
 * 「啊今天天气不错。李四：」误当成一个标记，导致真「李四：」被跳过。
 * @returns {number} 下标；找不到返回 -1
 */
function nextSpeakerIndex(s, from) {
  const re = /[【\[（(][^】\]）)]{1,12}[】\]）)]\s*|[^\s：:。！？!?]{1,10}[：:]\s*/g
  re.lastIndex = from
  let m
  while ((m = re.exec(s))) {
    const idx = m.index
    if (idx < from) continue
    const colonMatch = m[0].match(/([^\s：:。！？!?]{1,10})[：:]/)
    if (colonMatch) {
      const name = role.normalizeName(colonMatch[1])
      if (!role.isValidRoleName(name)) continue
    }
    return idx
  }
  return -1
}

/**
 * 把一段文字按说话人轮次切成数组。
 * 起点无角色 → 整段作为独白返回；否则从「当前说话人内容」里找下一个说话人标记继续切分。
 * 关键：只在 matchRole 解析出的 content（即当前说话人台词）中找下一个标记，
 * 避免把「张三：」里的「三：」误判成一个新轮次。
 */
function splitBySpeakers(block) {
  const parts = []
  let rest = block
  while (rest && rest.length) {
    const m = role.matchRole(rest, [], [])
    if (!m) {
      parts.push(rest.trim())
      break
    }
    const next = nextSpeakerIndex(m.content, 0)
    const end = next < 0 ? m.content.length : next
    const turn = (m.prefix + m.content.slice(0, end)).trim()
    if (turn) parts.push(turn)
    if (next < 0) break
    rest = m.content.slice(next)
  }
  return parts.length ? parts : [block]
}

/**
 * 合并过短残片（< 8 字）到上一段，避免一两个字的碎行。
 * 仅在「同一连续段落内」合并：遇到空行（用户主动留的呼吸点）立即 flush，
 * 不跨空行合并，保留原文的分段意图。若残片自身以说话人标记开头（新一轮次），不合并。
 */
function mergeShortSegments(segs) {
  const MIN = 8
  const out = []
  let buf = ''
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i].trim()
    if (!s) {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      out.push('')
      continue
    }
    if (buf && s.length < MIN && !role.matchRole(s, [], [])) {
      buf = buf + s
    } else {
      if (buf) out.push(buf)
      buf = s
    }
  }
  if (buf) out.push(buf)
  return out
}

/**
 * 行首角色回填（保守）。
 *
 * 为什么需要：脚本里常见「说话人名 + 动作描述 + 冒号」的写法，
 * 例如「婆婆把汤往杨凤面前推了推：先喝口热的。」——
 * 内置模式要求名字后**紧跟**冒号，这种写法一个都匹配不上，
 * 于是整句 role=null：不高亮，而且因为 filterLinesByRole 对无角色行「恒保留」，
 * 它还躲过了角色过滤（勾谁都显示），是漏词的隐形来源。
 *
 * 做法：只用**已经识别出来的角色名**去回填，且必须同时满足
 *   1) 角色名出现在段首（优先更长的名字，避免「凤凰」抢在「凤凰男」前面）；
 *   2) 名字之后到第一个冒号之间不超过 15 字（即「名字 + 短动作描述 + ：」形态）；
 *   3) 这段没有句末标点，否则可能是跨句误命中。
 * 命中后整段归给该角色；单行段落顺带把「名字…：」切成前缀，名字高亮模式下也正确着色。
 *
 * 注意：只处理「整段本来就没有角色」的段落，绝不覆盖已识别出的角色。
 */
function backfillRoleByKnownName(lines, knownNames) {
  const names = (knownNames || [])
    .map((n) => String(n || ''))
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return
  const groups = {}
  const order = []
  lines.forEach((l) => {
    if (l.isSpacer) return
    const k = l.sectionIndex
    if (!groups[k]) {
      groups[k] = []
      order.push(k)
    }
    groups[k].push(l)
  })
  order.forEach((k) => {
    const g = groups[k]
    if (!g.length || g.some((l) => l.role)) return
    const full = g.map((l) => String(l.text || '')).join('')
    if (!full) return
    for (let i = 0; i < names.length; i++) {
      const n = names[i]
      if (full.indexOf(n) !== 0) continue
      const rest = full.slice(n.length)
      const ci = rest.search(/[：:]/)
      if (ci < 0 || ci > 15) continue
      if (/[。！？!?；;]/.test(rest.slice(0, ci))) continue
      g.forEach((l) => {
        l.role = n
      })
      if (g.length === 1) {
        const cut = n.length + ci + 1
        g[0].rolePrefix = full.slice(0, cut)
        g[0].body = full.slice(cut)
        g[0].text = full
        g[0].isSectionStart = true
      }
      return
    }
  })
}

/**
 * 解析整篇稿件
 *
 * @param {string} text 原始文本
 * @param {Object} options
 *   charsPerLine 每行字数
 *   manualRoles  手动指定的角色名数组（白名单）
 *   roleBlacklist 手动排除的角色名数组（删掉误判）
 *   roleHighlight 是否启用角色高亮
 *   isDark       是否深色背景（决定色板）
 *   roleColorOverride 用户自定义颜色
 * @returns {{lines:Array, roles:Array, stats:Object}}
 */
function parseScript(text, options) {
  const opts = Object.assign(
    {
      charsPerLine: 26,
      manualRoles: [],
      roleBlacklist: [],
      roleAlias: {},
      roleHighlight: true,
      isDark: true,
      roleColorOverride: {}
    },
    options || {}
  )

  const sections = splitSectionsEx(text)
  const lines = []
  let charCount = 0
  let sentenceCount = 0
  // 上一轮的说话人：仅用于给「超长台词被切出来的延续段」兜底（见 splitSectionsEx 注释）。
  // 普通独立行若自身没有说话人前缀，行为与修复前完全一致，
  // 不会因为挨着一句台词就凭空被染上颜色。
  let lastRole = null

  sections.forEach((item, sectionIndex) => {
    const section = item.text
    // 空行呼吸点：渲染为一条空行，不计字数/句数
    if (section === '') {
      lines.push({
        text: '',
        body: '',
        rolePrefix: '',
        role: null,
        color: null,
        sectionIndex: sectionIndex,
        isSectionStart: true,
        isSpacer: true
      })
      return
    }
    charCount += section.replace(/\s/g, '').length
    sentenceCount += (section.match(/[。！？!?]/g) || []).length

    let matched = null
    if (opts.roleHighlight) {
      matched = role.matchRole(section, opts.manualRoles, opts.roleBlacklist)
      // 延续段（超长台词被切开后的第 2 段起）本身没有「角色名：」前缀，
      // 必然匹配失败。但它说的仍是上一段那个人，这里直接继承，
      // 避免「同一句话念到一半掉色 / 后半截归类为无角色」。
      if (!matched && item.continued && lastRole) {
        matched = { name: lastRole, prefix: '', content: section }
      }
    }
    if (matched) lastRole = matched.name

    const body = matched ? matched.content : section
    // 首行带角色前缀时，把前缀可视宽度从首行预算里扣掉，避免第一行溢出屏幕
    const prefixWidth = matched ? visualWidth(matched.prefix) : 0

    if (matched && prefixWidth >= opts.charsPerLine) {
      // 角色名比整行还宽（竖屏每行字数少时极易触发）：不能再把「名字 + 第一句台词」
      // 挤在同一行，否则 overflow:hidden 会把名字后的台词裁掉、只露出名字。
      // 处理：把「名字本身也按行宽断成多段」（每段仍是 1 行、高度=1 行，滚动定位不会错位），
      // 再接台词行。这样超长「名字（动作描述）：」也能完整显示而不被裁切；若名字较短则仍独占一行。
      breakLine(matched.prefix, opts.charsPerLine, null).forEach((seg) => {
        lines.push({
          text: seg,
          body: '',
          rolePrefix: seg,
          role: matched.name,
          sectionIndex: sectionIndex,
          isSectionStart: false
        })
      })
      breakLine(body, opts.charsPerLine, null).forEach((bl) => {
        lines.push({
          text: bl,
          body: bl,
          rolePrefix: '',
          role: matched.name,
          sectionIndex: sectionIndex,
          isSectionStart: false
        })
      })
    } else {
      const bodyLines = breakLine(body, opts.charsPerLine, opts.charsPerLine - prefixWidth)
      bodyLines.forEach((bl, i) => {
        const prefix = matched && i === 0 ? matched.prefix : ''
        lines.push({
          text: prefix + bl,
          body: bl,
          rolePrefix: prefix,
          role: matched ? matched.name : null,
          sectionIndex: sectionIndex,
          isSectionStart: i === 0
        })
      })
    }
  })

  // 角色归并：自动（净名字存在性归并）+ 手动（roleAlias 合并规则）
  let mergedAlias = {}
  if (opts.roleHighlight) {
    const rawNames = []
    const seen = {}
    const counts = {}
    lines.forEach((l) => {
      if (l.role) {
        counts[l.role] = (counts[l.role] || 0) + 1
        if (!seen[l.role]) {
          seen[l.role] = true
          rawNames.push(l.role)
        }
      }
    })
    if (rawNames.length) {
      const alias = role.computeAliases(rawNames, opts.roleAlias, counts)
      if (Object.keys(alias).length) {
        lines.forEach((l) => {
          l.role = role.applyAlias(l.role, alias)
        })
        mergedAlias = alias
      }
    }

    // 行首角色回填（见 backfillRoleByKnownName 注释）。
    // 放在别名归并之后：用到的就是归并后的标准名，回填结果与角色列表天然一致。
    const known = []
    const seen2 = {}
    lines.forEach((l) => {
      if (l.role && !seen2[l.role]) {
        seen2[l.role] = true
        known.push(l.role)
      }
    })
    if (known.length) backfillRoleByKnownName(lines, known)
  }

  const roleList = opts.roleHighlight ? role.summarize(lines) : []
  const roles = role.assignColors(roleList, opts.isDark, opts.roleColorOverride)

  // 把颜色落到每一行上，作为渲染的唯一来源；关闭高亮或空角色时颜色为 null
  const colorMap = {}
  roles.forEach((r) => {
    colorMap[r.name] = r.color
  })
  lines.forEach((l) => {
    l.color = opts.roleHighlight && l.role && colorMap[l.role] ? colorMap[l.role] : null
  })

  return {
    lines: lines,
    roles: roles,
    alias: mergedAlias,
    stats: {
      chars: charCount,
      // 注意：这里的 sections 元素是 {text, continued} 对象，判空必须取 s.text。
      // 写成 s !== '' 会恒为真，把空行呼吸点也算进段数。
      sentences: sentenceCount || (sections.some((s) => s.text !== '') ? 1 : 0),
      sections: sections.filter((s) => s.text !== '').length,
      lines: lines.length,
      roleCount: roles.length
    }
  }
}

/**
 * 轻量统计，编辑页实时显示用（不做断行，性能更好）
 */
function quickStats(text) {
  const t = String(text || '')
  const sections = splitSections(t)
  const roleList = role.summarize(
    sections
      .map((s) => {
        const m = role.matchRole(s, [])
        return m ? { role: m.name } : { role: null }
      })
      .filter((x) => x.role)
  )
  return {
    chars: t.replace(/\s/g, '').length,
    sentences: (t.match(/[。！？!?]/g) || []).length,
    sections: sections.filter((s) => s !== '').length,
    roleCount: roleList.length
  }
}

/**
 * 估算朗读时长（分钟）
 */
function estimateMinutes(chars, speed) {
  if (!speed) return 0
  return chars / speed
}

module.exports = {
  NO_LINE_START,
  charWidth,
  visualWidth,
  breakLine,
  splitSections,
  splitLongSentence,
  smartSegment,
  parseScript,
  backfillRoleByKnownName,
  quickStats,
  estimateMinutes
}
