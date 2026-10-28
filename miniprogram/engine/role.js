/**
 * 角色识别与多色高亮
 *
 * 设计要点见架构文档第 7 节：
 * - 行首匹配四种常见剧本格式
 * - 过滤词表挡掉「场景」「音效」这类舞台提示
 * - 配色按黑底高对比挑选，白底模式切换深色版色板
 * - 渲染时整行上色（提词板距离 1.5-2 米，只染角色名看不清）
 */

/**
 * 行首角色名匹配模式，按优先级从高到低。
 * colonLoose 是兜底：允许名字里带空格（「林 晚：」），
 * 因为放得宽，所以必须额外过一遍虚词检查，否则「我的想法是：」会被当成角色。
 */
const ROLE_PATTERNS = [
  { type: 'bracket', re: /^【([^【】]{1,8})】\s*/ }, // 【林晚】
  { type: 'bracketFull', re: /^［([^［］]{1,8})］\s*/ }, // ［林晚］全角方括号（中文输入法下按 [ 常出全角）
  { type: 'square', re: /^\[([^[\]]{1,12})\]\s*/ }, // [Tom]
  { type: 'parenFull', re: /^（([^（）]{1,8})）\s*/ }, // （旁白）
  { type: 'parenHalf', re: /^\(([^()]{1,12})\)\s*/ }, // (Tom)
  // 「名字（修饰）：」台词格式（无空格）。覆盖 colonLoose 12 字上限够不到的长修饰。
  // 例：婆婆（红了眼眶，但赶紧笑了）：→ 净名「婆婆」。修饰允许含逗号最长 20 字。
  { type: 'parenRole', re: /^([^\s：:（）]{1,8})[（(][^（）()]{1,20}[）)][：:]\s*/ },
  { type: 'colon', re: /^([^\s:：]{1,8})[：:]\s*/ }, // 林晚： 或 林晚:
  { type: 'colonLoose', re: /^([^:：]{1,12})[：:]\s*/, loose: true }, // 林 晚：
  { type: 'action', re: /^([^\s]{1,8})\s+[（(]/ } // 顾辞 （放下杯子）
]

/**
 * 虚词表。出现在「名字」里基本可以断定那不是人名，而是半截句子。
 * 只对宽松匹配模式生效，严格模式（无空格、8 字内）本身误判概率就低。
 */
const STOP_WORDS = [
  '的', '是', '了', '在', '和', '与', '对', '把', '被', '让', '给', '有',
  '我', '你', '他', '她', '它', '这', '那', '就', '都', '也', '还', '很',
  '要', '会', '能', '说', '做', '去', '来', '个', '们', '为', '以', '而'
]

/**
 * 这些词即便符合格式也不是角色名，是舞台提示/序号/说明
 * 注意：不要放「旁白」，剧本里旁白常常是正经角色
 */
const FILTER_WORDS = [
  '注意', '提示', '说明', '备注', '示例', '例子', '注', 'PS', 'ps', 'Tips', 'tips',
  '小贴士', '重点', '总结', '摘要', '小结', '要点',
  '第一', '第二', '第三', '第四', '第五', '第六', '首先', '其次', '再次', '最后', '其其',
  '时间', '地点', '场景', '镜头', '画面', '音效', 'BGM', 'bgm', '音乐', '字幕', '灯光',
  '步骤', '方法', '原因', '结果', '结论', '背景', '目的', '备注说明',
  'http', 'https', 'www',
  '无台词', '静场', '切光', '空镜', '画外音', // 舞台提示，不是角色
  '无', '空', '略', '同上', '待定', // 占位符（「（无）」曾让角色列表多出一个「无」）
  '环境音', '背景音', '现场音', '同期声' // 声音提示
]

/**
 * 舞台提示前缀。括号格式（parenFull「（静场三秒）」）在剧本里既可能表示
 * 「这个人在说话」，也可能是没有标点的舞台说明。带标点的说明（「（无台词，…）」
 * 「（环境音：…）」）已由 isValidRoleName 的标点判定挡掉，这里补上无标点的那一类。
 * 只做**前缀**匹配，词表刻意保守：像「旁白」「画外音」这类在剧本里常是正经角色/提示，
 * 交给 FILTER_WORDS 精确表处理，不放进这里。
 */
const STAGE_PREFIX = [
  '静场', '静默', '沉默', '停顿', '灯光', '镜头', '画面', '特写', '近景', '中景',
  '远景', '全景', '空镜', '字幕', '环境音', '背景音', '现场音', '同期声', '音效',
  '音乐', 'BGM', '画外', '闪回', '黑场', '白场', '淡出', '淡入', '转场'
]

/** 黑底高对比色板，按出场频次分配，第一个给主角 */
const PALETTE_DARK = [
  '#FFD166', // 琥珀黄
  '#4CC9F0', // 天蓝
  '#7BE0AD', // 薄荷绿
  '#FF9FB2', // 粉红
  '#C9A7FF', // 淡紫
  '#FFA94D', // 橙
  '#A0E7A0', // 草绿
  '#F0A8D0' // 洋红
]

/** 白底模式专用深色版色板，浅色在白底上会看不见 */
const PALETTE_LIGHT = [
  '#B8860B',
  '#186FA5',
  '#2E7D5B',
  '#C2185B',
  '#6A3FA0',
  '#C25E00',
  '#4A7A2C',
  '#A8327E'
]

/** 角色名归一化：去掉所有空白，用于合并「林晚」与「林 晚」 */
function normalizeName(name) {
  return String(name || '').replace(/\s+/g, '')
}

/** 判断是否为合法角色名 */
function isValidRoleName(name) {
  if (!name) return false
  const n = normalizeName(name)
  if (!n) return false
  // 中文不超过 8 字，英文/混合可放宽到 12 字符
  const maxLen = /^[\x00-\x7F]+$/.test(n) ? 12 : 8
  if (n.length > maxLen) return false
  // 纯数字序号不算
  if (/^\d+$/.test(n)) return false
  // 含标点不算。**务必包含括号**：宽松模式会把「（环境音：…）」的名字截成「（环境音」，
  // 旧判定只查句读标点，于是角色列表里冒出「（环境音」这种带左括号的垃圾角色。
  // & < > = / 这类符号不会出现在角色名里（多半是 XML 实体残留或正文串进了名字）
  if (/[，。！？、；：""''（）()【】《》&<>=\\/]/.test(n)) return false
  // 过滤词表
  if (FILTER_WORDS.indexOf(n) >= 0) return false
  // 舞台提示前缀（「（静场三秒）」这类无标点说明）
  for (let i = 0; i < STAGE_PREFIX.length; i++) {
    if (n.indexOf(STAGE_PREFIX[i]) === 0) return false
  }
  return true
}

/**
 * 尝试从一行文本的行首解析出角色名
 * @param {string} line
 * @param {Array<string>} manualNames 用户手动指定的角色名（白名单，识别不准时的兜底）
 * @param {Array<string>} blacklistNames 用户手动排除的角色名（删掉误判用）
 * @returns {{name:string, prefix:string, content:string}|null}
 */
function matchRole(line, manualNames, blacklistNames) {
  if (!line) return null
  const text = String(line).trim()
  const isBlack = (n) => !!(blacklistNames && blacklistNames.indexOf(n) >= 0)

  // 手动指定的名字优先（白名单），允许出现在行首
  if (manualNames && manualNames.length) {
    for (let i = 0; i < manualNames.length; i++) {
      const n = normalizeName(manualNames[i])
      if (!n) continue
      const idx = text.indexOf(n)
      if (idx === 0) {
        if (isBlack(n)) continue // 同时被排除，跳过白名单
        // 行首命中，把名字后面紧跟的冒号一起吃掉
        let end = n.length
        if (/^[：:]/.test(text.slice(end, end + 1))) end += 1
        while (end < text.length && /\s/.test(text[end])) end += 1
        return {
          name: n,
          prefix: text.slice(0, end),
          content: text.slice(end)
        }
      }
    }
  }

  // 内置格式匹配
  for (let i = 0; i < ROLE_PATTERNS.length; i++) {
    const p = ROLE_PATTERNS[i]
    const m = text.match(p.re)
    if (!m || !isValidRoleName(m[1])) continue
    // 宽松模式额外挡掉「我的想法是：」这类半截句子
    if (p.loose && containsStopWord(normalizeName(m[1]))) continue
    const name = normalizeName(m[1])
    if (isBlack(name)) continue // 用户已手动排除，不要当成角色
    return {
      name: name,
      prefix: m[0],
      content: text.slice(m[0].length)
    }
  }
  return null
}

/** 是否包含虚词 */
function containsStopWord(name) {
  for (let i = 0; i < STOP_WORDS.length; i++) {
    if (name.indexOf(STOP_WORDS[i]) >= 0) return true
  }
  return false
}

/**
 * 汇总角色列表，按出现次数降序（主角排前面，拿到最醒目的颜色）
 * @param {Array} lines 已解析的行数组
 * @returns {Array<{name:string, count:number}>}
 */
function summarize(lines) {
  const counter = {}
  lines.forEach((line) => {
    if (line.role) {
      counter[line.role] = (counter[line.role] || 0) + 1
    }
  })
  return Object.keys(counter)
    .map((name) => ({ name: name, count: counter[name] }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 给角色分配颜色
 * @param {Array} roles summarize 的输出
 * @param {boolean} isDark 是否深色背景
 * @param {Object} override 用户自定义颜色 { '林晚': '#FF0000' }
 * @returns {Array} 带 color 与 index 的角色数组
 */
function assignColors(roles, isDark, override) {
  const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT
  return roles.map((r, i) => ({
    name: r.name,
    count: r.count,
    index: i,
    // 超过色板长度就循环复用，同时由调用方提示「角色过多」
    color: (override && override[r.name]) || palette[i % palette.length]
  }))
}

/**
 * 取某个角色的颜色，找不到就返回 null（调用方回落到默认文字色）
 */
function colorOf(roles, name) {
  for (let i = 0; i < roles.length; i++) {
    if (roles[i].name === name) return roles[i].color
  }
  return null
}

/**
 * 去掉角色名里的中文/英文括号修饰，得到「净名字」。
 * 例：王二（小声说）→ 王二；王二(os) → 王二；林晚（急切）→ 林晚。
 * 用于把同一角色在不同台词里的「状态标注」归并到一个人。
 */
function stripModifier(name) {
  const m = String(name || '').match(/^(.{1,8}?)[（(][^（）()]{0,8}[）)]$/)
  if (m && isValidRoleName(m[1])) return m[1]
  return name
}

/**
 * 计算角色名别名表（合并规则）。
 * 1) 自动归并（核心）：只要是「净名字 + 括号修饰」的变体，就归并到净名字。
 *    例：王二（小声说）→ 王二；王二（笑着）→ 王二；王二(os) → 王二。
 *    关键：即使稿件里从没写过裸「王二」，只有这些带修饰的变体，也会统一归并成「王二」，
 *    反复出现的类似名称自动分成同一类。
 * 2) 手动归并：roleAlias（{ 源: 目标 }），用户主动把两个角色合并/拆分。
 *    手动规则优先于自动规则。
 * @param {Array<string>} names 当前稿件识别到的角色名（去重）
 * @param {Object} manualAlias 用户手动合并规则
 * @param {Object} [counts] 各角色出现次数（用于「简称归并」判断谁是全称）
 * @returns {Object} { 源名: 标准名 }
 */
function computeAliases(names, manualAlias, counts) {
  const alias = {}
  // 先放手动规则（用户意图优先）。
  // 允许「自指」规则（src === tgt，如 王二（笑着）→ 王二（笑着））：
  // 它的含义是「把这个变体钉成独立角色，不要被自动归并吸走」，用于手动拆分。
  if (manualAlias && typeof manualAlias === 'object') {
    Object.keys(manualAlias).forEach((src) => {
      const tgt = manualAlias[src]
      if (src && tgt) alias[src] = tgt
    })
  }
  // 再叠加自动规则：任何带括号修饰的变体，归并到其净名字
  names.forEach((name) => {
    if (alias[name]) return
    const base = stripModifier(name)
    if (base && base !== name) alias[name] = base
  })
  // 自动规则 2：简称归并（保守）。
  // 稿件里同一角色常有全称与简称两种写法（「王建华」/「建华」），会被算成两个角色：
  // 角色列表多出一项、两种写法还各分一个颜色。
  // 仅在**短名是长名的前缀或后缀、长度差 ≤ 2、且长名出现次数不少于短名**时才归并。
  // 例：建华 → 王建华（后缀，差 1）；反例：小凤 / 杨凤（非前后缀，不会被误并）。
  const cnt = counts || {}
  names.forEach((shortName) => {
    if (alias[shortName]) return
    const a = String(shortName)
    if (a.length < 2) return
    let best = null
    names.forEach((longName) => {
      const b = String(longName)
      if (b === a) return
      if (b.length <= a.length || b.length - a.length > 2) return
      const isAffix = b.indexOf(a) === 0 || b.lastIndexOf(a) === b.length - a.length
      if (!isAffix) return
      const cShort = cnt[a] || 0
      const cLong = cnt[b] || 0
      if (cLong < cShort) return // 更长的那个必须出现得更多，才更像「全称」
      if (!best || b.length < String(best).length || (b.length === String(best).length && cLong > (cnt[best] || 0))) best = b
    })
    if (best) alias[shortName] = alias[best] || best
  })
  return alias
}

/** 应用别名：若 name 在别名表内则替换为标准名，否则原样返回 */
function applyAlias(name, alias) {
  if (!name || !alias) return name
  return alias[name] || name
}

/**
 * 把「角色名称 / 角色 ID / 含修饰的原始名」解析成一组标准角色名（Set）。
 * 用于「按角色筛选显示」：返回 null 表示不过滤（显示全部）。
 *
 * @param {null|Array|Set|Object} filterDef
 *   - null / undefined / 空 → 不过滤，返回 null
 *   - ['林晚', '建华'] 或 { names: [...] } → 按角色标准名匹配
 *   - { ids: [0, 2] } → 按角色分配序号（roleList[i].index）匹配
 * @param {Array<{name,index,color,count}>} roleList 当前稿识别到的角色（带标准名）
 * @param {Object} [aliasMap] 角色别名表（源名→标准名），把「王二（笑着）」归并到「王二」
 * @returns {Set<string>|null}
 */
function resolveRoleFilter(filterDef, roleList, aliasMap) {
  if (!filterDef) return null
  const list = roleList || []
  let rawNames = []
  if (Array.isArray(filterDef)) {
    rawNames = filterDef
  } else if (filterDef instanceof Set) {
    rawNames = Array.from(filterDef)
  } else if (typeof filterDef === 'object') {
    if (Array.isArray(filterDef.names)) rawNames = rawNames.concat(filterDef.names)
    if (Array.isArray(filterDef.ids)) {
      filterDef.ids.forEach((id) => {
        const r = list.find((x) => x.index === id)
        if (r) rawNames.push(r.name)
      })
    }
  }
  if (!rawNames.length) return null
  const out = new Set()
  rawNames.forEach((n) => {
    if (!n) return
    let name = normalizeName(String(n))
    // 别名表归并（手动/自动合并后的「王二（笑着）」→「王二」）
    if (aliasMap && aliasMap[name]) name = normalizeName(aliasMap[name])
    let hit = list.find((r) => r.name === name)
    // 否则按「去掉括号修饰」再匹配（用户用带状态标注的原始名也能点中标准角色）
    if (!hit) {
      const base = stripModifier(name)
      if (base && base !== name) hit = list.find((r) => r.name === base)
    }
    if (hit) out.add(hit.name)
  })
  // 解析后一个有效角色都没有：视为不过滤，避免误触把整屏清空
  return out.size ? out : null
}

/**
 * 按角色筛选台词行（视图派生，不改原台词存储与结构）。
 * @param {Array} lines 完整解析行（每行带 role:string|null）
 * @param {Set<string>|null} filterSet 标准角色名集合；null/空 = 不过滤（原样返回）
 * @returns {Array} 筛选后行（仅持有原对象引用，不复制）
 *
 * 说明（已修复「选角后标题/非台词文字消失」缺陷）：
 *  - null        → 原样返回全部（标题/舞台提示/旁白等非角色行一并保留）
 *  - 空 Set      → 显式「无显示」（用户取消全选），返回 []
 *  - 非空 Set    → 保留「非角色行（role===null：标题、舞台提示、旁白、非台词说明）」
 *                  + 命中角色的台词；仅把「其它角色」的台词隐藏。
 *                  这样用户做出角色选择后，标题与非台词说明不再丢失，符合角色显示选择的预期。
 */
function filterLinesByRole(lines, filterSet) {
  if (!lines || !lines.length) return lines || []
  if (!filterSet) return lines
  if (filterSet.size === 0) return []
  // 关键修复：非选角行（标题/舞台提示/旁白/说明，role 为 null）始终保留，
  // 只隐藏「其它角色」的台词，确保选中角色后不再丢文本。
  return lines.filter((l) => !l.role || filterSet.has(l.role))
}

module.exports = {
  ROLE_PATTERNS,
  FILTER_WORDS,
  PALETTE_DARK,
  PALETTE_LIGHT,
  normalizeName,
  isValidRoleName,
  matchRole,
  summarize,
  assignColors,
  colorOf,
  stripModifier,
  computeAliases,
  applyAlias,
  resolveRoleFilter,
  filterLinesByRole
}
