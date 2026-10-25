'use strict'
/**
 * 多人同格 · 随机结构文档模糊测试台
 *
 * 用法：node fuzz_multi.js [文档数] [每集行数] [种子]
 *   例：node fuzz_multi.js 300 8 20260919
 *
 * 为什么单独做一套：常规 fuzz_scripts.js 面向「单说话人 + 少量同行追加」，
 * 这一套专攻「同一个台词格里两个或多个人物先后说话」，并把它放进真实 OOXML 结构
 * 跑完整链路：
 *
 *   生成随机 docx（真 tblPr / tcPr / rPr / 随机 run 切分 / <w:br/> / 段落边界 / XML 实体）
 *     → util.extractDocxBlocks   （解包子表）
 *     → util.splitScripts        （拆集；内含说话人白名单预扫）
 *     → parser.parseScript       （角色归属）
 *
 * 生成的每行都带「标准答案」（谁说的、应是第几行），逐行回验。
 *
 * 同一格内的分隔方式（随机混用）：
 *   br1    单个 <w:br/>
 *   br2    两个 <w:br/>（空行）
 *   brAlt  <w:br w:type="textWrapping"/>
 *   para   </w:p><w:p>（段落边界）
 *   punct  无分隔符 + 上一句以句末标点收尾
 *   space  无分隔符 + 插入空格
 *   glueWl 无分隔符 + 上一句以汉字收尾（真粘连；靠「已知说话人白名单」救回）
 *   glueFk 无分隔符 + 上一句以汉字收尾 + 后接假说话人（正文动词短语，必须不切）
 *
 * 另有一类「行形式」（与上面的分隔方式正交，任何分隔都可能配它）：
 *   joint  「A、B：正文」联合说话人 —— 一行两人齐声，**必须整行不拆**。
 *          这是 jointSpeakerBefore 的正面用例：即使 A、B 都在白名单里也不许切开，
 *          用来守住「白名单优先 ≠ 白名单越权」这条界线。
 *          只生成「顿号连接 + 两名字互不为子串」的组合，原因见 makeCell 内注释：
 *          中文连接词（和/还有）会被角色识别整体当成一个角色名，那是另一层的事；
 *          而「建华、王建华」这种包含关系本身就歧义，不该算进本测试。
 *
 * 不变量：
 *   IM1 行数守恒、IM2 零丢字、IM3 无粘连、IM4 归属正确、
 *   IM5 角色名卫生、IM6 分隔方式等价、IM7 白名单覆盖
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
function makeG(seed) {
  const r = mulberry32(seed)
  return { r, pick: (a) => a[Math.floor(r() * a.length)], int: (n) => Math.floor(r() * n), chance: (p) => r() < p }
}
function weightedPick(g, table) {
  let tot = 0
  Object.keys(table).forEach((k) => { tot += table[k] })
  let x = g.r() * tot
  for (const k of Object.keys(table)) { x -= table[k]; if (x <= 0) return k }
  return Object.keys(table)[0]
}

// ---------------- 语料 ----------------
const REAL = ['王建华', '杨凤', '婆婆', '李阿姨', '张阿姨', '儿媳妇', '公公', '儿子', '建华', '小凤', 'Tom', '阿·依']
const FAKE = ['当晚处理掉', '说完了', '想起来', '没办法', '心里想着', '回过头看', '越琢磨越', '念叨着', '琢磨明白', '翻了翻']
const ACTS = ['小声嘟囔', '瞪他一眼', '笑着', '叹了口气', '放下杯子', '红了眼眶', '探出头']
const STAGE = ['（环境音：窗外鸟叫、远处邻居家炒菜声）', '（静场三秒）', '（两人对视，谁都没先开口）', '（切光）', '（画面转向窗外，阳光很好）']
const SENT = [
  '今天天气真不错', '你先吃吧我不饿', '这事儿咱们回头再说', '我把衣服晾出去了',
  '妈您别忙了歇会儿', '明天还得早起上班呢', '饭在锅里自己盛', '这个月的开销又超了',
  '孩子作业写完了没有', '楼下超市在打折', '悟空浏览器上面短剧特别多', '追剧还能攒金币提现',
  '想找啥剧一眼就能看到', '关键是全都是免费的', '不用一集一集解锁', '刚上线的新剧也都能找到'
]
// 注：XML 实体解码由集标题「建华&小凤的生活NN」与画面格里注入的实体覆盖，
// 台词正文里不再放 & —— 句中 & 会造出人为的「非中文边界」，不属本测试要考的场景。
const SEPS = ['br1', 'br2', 'brAlt', 'para', 'punct', 'space', 'glueWl', 'glueFk']
const SEP_WEIGHT = { br1: 28, br2: 6, brAlt: 6, para: 12, punct: 9, space: 9, glueWl: 14, glueFk: 16 }

// ---------------- XML 片段（结构取自真实稿件表3 R1/R3/R5） ----------------
const RPR = '<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:b/><w:sz w:val="28"/></w:rPr>'
const RPR20 = '<w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:b/><w:sz w:val="20"/></w:rPr>'
const PPR = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="324" w:lineRule="exact"/><w:jc w:val="left"/><w:snapToGrid w:val="0"/></w:pPr>'
const PPRC = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="232" w:lineRule="exact"/><w:jc w:val="center"/><w:snapToGrid w:val="0"/></w:pPr>'
const TBLPR = '<w:tblPr><w:tblW w:type="dxa" w:w="14600"/><w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/><w:jc w:val="center"/></w:tblPr>'
const BR_OPEN = '<w:r>' + RPR + '<w:br/></w:r>'
const BR_SELF = '<w:r>' + RPR + '<w:br w:type="textWrapping"/></w:r>'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------------- 生成逻辑行 ----------------
const dropPunct = (s) => String(s).replace(/[。！？，、；：!?.,;:…]+$/, '')

function speakerPrefix(g, name, form) {
  if (form === 'parenBefore') return name + '（' + g.pick(ACTS) + '）：'
  if (form === 'parenAfter') return name + '：' + '（' + g.pick(ACTS) + '）'
  if (form === 'parenFull') return '（' + name + '）：'
  if (form === 'spaceName') return name + ' ：'
  return name + '：'
}
function makeBody(g, min, max) {
  const target = min + g.int(Math.max(1, max - min))
  let s = ''
  while (s.length < target) s += g.pick(SENT)
  return s.slice(0, Math.max(4, target))
}
/** 逻辑行文本（唯一来源；渲染与标准答案都从这里取，避免两份数据不一致） */
function lineText(ln) {
  if (ln.kind === 'stage') return ln.text
  if (ln.kind === 'decoy') return ln.tok + '：' + ln.body
  if (ln.kind === 'joint') return ln.who + ln.connector + ln.who2 + '：' + ln.body + (ln.suffix || '')
  return speakerPrefix({ pick: () => ln.act }, ln.who, ln.form) + ln.body + (ln.suffix || '')
}

/**
 * 生成一个格子的逻辑行规格（只生成一次，渲染策略另行施加）。
 * @param {Object} opts {noDecoy, forceSuffix}
 */
function makeCell(g, used, opts) {
  opts = opts || {}
  const n = 1 + g.int(5)
  const lines = []
  for (let i = 0; i < n; i++) {
    let sep = i === 0 ? null : weightedPick(g, SEP_WEIGHT)
    if (opts.noDecoy && sep === 'glueFk') sep = 'punct'
    if (i > 0 && (sep === 'glueWl' || sep === 'glueFk')) {
      // 这两种要求「上一句以汉字收尾」，所以把上一行的句末标点去掉
      const prev = lines[i - 1]
      prev.suffix = ''
      const endsCn = prev.body && /[\u4e00-\u9fa5·]$/.test(prev.body)
      if (!endsCn || (prev.kind !== 'line' && prev.kind !== 'joint')) sep = 'punct'
    }
    if (i > 0 && sep === 'punct') {
      // punct 的语义就是「靠上一句的句末标点分段」，所以上一行必须有句末标点
      const prev = lines[i - 1]
      if (prev.kind === 'line' || prev.kind === 'joint') {
        prev.suffix = /[。！？!?]$/.test(prev.suffix || '') ? prev.suffix : '。'
      } else if (prev.kind === 'decoy') {
        prev.body = prev.body + '。'
      }
    }
    if (!opts.noDecoy && g.chance(0.06)) {
      // 舞台说明只能靠「硬分隔」（<w:br/> 或段落边界）独立成行。
      // 空格 / 句末标点 / 粘连 这三类分隔的前提都是「下一段以可识别的说话人开头」——
      // 舞台说明没有说话人前缀，靠它们根本分不出行（这不是产品缺陷，是格式本身的限制）。
      const HARD = { br1: 1, br2: 1, brAlt: 1, para: 1 }
      if (!HARD[sep]) sep = ['br1', 'brAlt', 'para', 'br2'][g.int(4)]
      lines.push({ kind: 'stage', text: g.pick(STAGE), who: null, sep: sep })
      continue
    }
    if (sep === 'glueFk') {
      // 防意外：候选窗口（冒号前 ≤5 字）的后缀不得恰好是真名
      let tok = null
      for (let t = 0; t < 6 && !tok; t++) {
        const cand = g.pick(FAKE)
        const prev = lines[i - 1]
        const tail = (prev.body + cand)
        let badHit = false
        for (let L = 2; L <= 5; L++) {
          const sfx = tail.slice(Math.max(0, tail.length - L))
          if (toPlainRole(sfx)) badHit = true
        }
        if (!badHit) tok = cand
      }
      if (!tok) {
        // 退化为普通句末分隔，避免制造歧义
        lines.push({ kind: 'line', who: g.pick(REAL), form: 'colon', body: makeBody(g, 6, 60), suffix: '。', sep: 'punct' })
        continue
      }
      lines.push({ kind: 'decoy', tok: tok, body: makeBody(g, 6, 40), who: null, sep: sep })
      continue
    }
    // 联合说话人：「A、B：正文」是一行（两人齐声）。两个名字都会被注册进
    // heads，也就是说它们必然也在别处当过行首说话人、必然都在白名单里 ——
    // 这正是最严格的守门用例：白名单命中也不能越过并列连接规则把它切开。
    //
    // 只生成「顿号 + 互不为子串的两个名字」，两条约束都是为了不引入本测试之外的歧义：
    //   · 中文连接词（「A和B：」「A还有B：」）在角色识别层会被整体当成**一个**角色名
    //     （「张阿姨和儿媳妇」），那是 role.js 的既有行为；混进来只会让归属断言打架，
    //     而这里要考的仅仅是「拆分器不许切开联合说话人」。连接词变体放在
    //     diag_multi.js 的边界写法里单独验证「行数不被切开」。
    //   · 「建华、王建华：」里短名是长名的后缀，归属本身就有歧义。
    if (!opts.noJoint && g.chance(0.10)) {
      // 两个名字必须**已经在别处以物理行首形式露过面**（heads 登记过），这样才在
      // 白名单里 —— 否则「已进白名单也不许切开」这条守门断言就落空了。
      // 联合行自身不以「名字：」起头，collectSpeakerNames 收不到它，指望不上。
      const pool = opts.heads ? REAL.filter((x) => opts.heads[x]) : []
      let a = null, b = null
      for (let t = 0; t < 8 && !a && pool.length >= 2; t++) {
        const x = g.pick(pool), y = g.pick(pool)
        if (x !== y && x.indexOf(y) < 0 && y.indexOf(x) < 0) { a = x; b = y }
      }
      if (a) {
        used[a] = true
        used[b] = true
        lines.push({
          kind: 'joint', who: a, who2: b, connector: '、',
          body: makeBody(g, 6, 60),
          suffix: opts.forceSuffix !== undefined ? opts.forceSuffix : g.pick(['。', '！', '？']),
          sep: sep
        })
        continue
      }
    }
    const name = g.pick(REAL)
    const form = g.chance(0.18) ? g.pick(['parenBefore', 'parenAfter', 'parenFull']) : 'colon'
    const act = g.pick(ACTS)
    used[name] = true
    // 每个说话人至少要在「物理行首」露一次面 —— 真实稿件就是这样（一人一行），
    // collectSpeakerNames 才能真正把它收进白名单；否则跨格粘连救不回来，
    // 那是本测试的布置缺陷而非产品缺陷。
    if (opts.heads && !opts.heads[name]) {
      opts.heads[name] = 1
      if (i > 0) sep = 'br1'
    }
    lines.push({
      kind: 'line', who: name, form: form, act: act, body: makeBody(g, 6, 90),
      suffix: opts.forceSuffix !== undefined ? opts.forceSuffix : g.pick(['。', '！', '？', '']),
      sep: sep
    })
  }
  return lines
}
/** 是否像一个「行首说话人」名字（用于生成期的防歧义检查 & 期望白名单） */
function toPlainRole(tok) {
  return REAL.indexOf(tok) >= 0 ? tok : null
}

/**
 * 逻辑行 → 单元格应有的文本（独立推算，不依赖产品实现）。
 * 用于 IM2 零丢字与 IM7 白名单的独立基准。
 */
function expectedCellText(lines) {
  let out = ''
  lines.forEach((ln, i) => {
    if (i > 0) {
      const sep = ln.sep
      if (sep === 'br1' || sep === 'br2' || sep === 'brAlt' || sep === 'para') out += '\n'
      else if (sep === 'space') out += ' '
      // punct / glueWl / glueFk 不加任何字符
    }
    out += lineText(ln)
  })
  return out
}

/** 逻辑行 → 标准答案（把被吸收的假说话人并进上一行） */
function toAnswer(lines) {
  const exp = []
  lines.forEach((ln, i) => {
    const absorbed = i > 0 && ln.sep === 'glueFk' && ln.kind === 'decoy'
    if (!absorbed) {
      // joint（联合说话人）实测由产品归给排在前面的那个名字：既不丢行、又能高亮，
      // 比归 null 好，所以期望值就按 who（= 第一个名字）来。
      exp.push({
        text: lineText(ln),
        who: (ln.kind === 'line' || ln.kind === 'joint') ? ln.who : null,
        kind: ln.kind
      })
    } else {
      const last = exp[exp.length - 1]
      last.text = last.text + lineText(ln)
    }
  })
  return exp
}

// ---------------- 渲染 XML ----------------
function runs(g, t) {
  const pieces = []
  if (t.length <= 2 || g.chance(0.35)) pieces.push(t)
  else {
    const k = 1 + g.int(Math.min(4, Math.max(1, t.length - 1)))
    const cuts = [0]
    for (let j = 0; j < k; j++) cuts.push(1 + g.int(Math.max(1, t.length - 1)))
    cuts.push(t.length)
    const uniq = Array.from(new Set(cuts)).filter((v) => v >= 0 && v <= t.length).sort((a, b) => a - b)
    for (let j = 0; j + 1 < uniq.length; j++) {
      const p = t.slice(uniq[j], uniq[j + 1])
      if (p) pieces.push(p)
    }
    if (!pieces.length) pieces.push(t)
  }
  let out = ''
  pieces.forEach((p, idx) => {
    if (!p) return
    if (idx > 0 && g.chance(0.08)) out += '<w:r>' + RPR + '</w:r>' // 空 run 干扰
    const sp = g.chance(0.2) ? ' xml:space="preserve"' : ''
    out += '<w:r>' + RPR + '<w:t' + sp + '>' + esc(p) + '</w:t></w:r>'
  })
  return out || ('<w:r>' + RPR + '<w:t>' + esc(t) + '</w:t></w:r>')
}

/**
 * 渲染台词格。
 * @param {string} forceSep 若非空，则强制所有分隔都用它（用于「分隔方式等价」验证）
 */
function renderDialogueCell(g, lines, forceSep) {
  let xml = '<w:p>' + PPR + '<w:r/>'
  lines.forEach((ln, i) => {
    const sep = i === 0 ? null : (forceSep || ln.sep)
    if (i > 0) {
      if (sep === 'br1') xml += (g.chance(0.5) ? BR_OPEN : BR_SELF)
      else if (sep === 'br2') xml += BR_OPEN + BR_SELF
      else if (sep === 'brAlt') xml += BR_SELF
      else if (sep === 'para') xml += '</w:p><w:p>' + PPR
      else if (sep === 'space') xml += runs(g, ' ')
      // punct：句末标点已在上一行的文本里，这里不再补任何东西
      // glueWl / glueFk：不加任何东西
    }
    xml += runs(g, lineText(ln))
  })
  xml += '</w:p>'
  return '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="9689"/><w:vAlign w:val="center"/></w:tcPr>' + xml + '</w:tc>'
}

function renderMergeCell(text, w) {
  return '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="' + w + '"/><w:gridSpan w:val="4"/><w:vAlign w:val="center"/></w:tcPr>' +
    '<w:p>' + PPRC + '<w:r/><w:r>' + RPR + '<w:t>' + esc(text) + '</w:t></w:r></w:p></w:tc>'
}
function renderPlainCell(text, w, size) {
  const rpr = size === 20 ? RPR20 : RPR
  return '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="' + w + '"/><w:vAlign w:val="center"/></w:tcPr>' +
    '<w:p>' + PPRC + '<w:r/><w:r>' + rpr + '<w:t>' + esc(text) + '</w:t></w:r></w:p></w:tc>'
}
const HEADER_ROW = '<w:tr>' + renderPlainCell('镜头', 309, 20) + renderPlainCell('画面 / 动作', 4287, 20) +
  renderPlainCell('台词', 9689, 20) + renderPlainCell('备注', 315, 20) + '</w:tr>'

function genDoc(seed, rowsPerEp) {
  const g = makeG(seed)
  const used = {}
  const eps = 1 + g.int(2)
  const tables = []
  const answers = []
  const cellTexts = []
  const firstHead = {}
  for (let e = 0; e < eps; e++) {
    const epNo = 81 + e
    const rows = []
    rows.push('<w:tr><w:trPr><w:tblHeader/></w:trPr>' + renderMergeCell('建华&小凤的生活' + epNo, 315) + '</w:tr>')
    const metaNames = REAL.slice(0, 2 + g.int(5))
    rows.push('<w:tr>' + renderMergeCell('人物：' + metaNames.join('、') + '　｜　场景：客厅、厨房　｜　道具：沙发、手机', 315) + '</w:tr>')
    rows.push(HEADER_ROW)
    const nRows = rowsPerEp || (4 + g.int(6))
    for (let r = 0; r < nRows; r++) {
      const lines = makeCell(g, used, { heads: firstHead })
      answers.push(toAnswer(lines))
      cellTexts.push(expectedCellText(lines))
      rows.push('<w:tr>' + renderPlainCell(String(r + 1), 309, 20) +
        renderPlainCell('【近景】客厅 下午，' + g.pick(SENT) + g.pick(['', '（A&B<C>）']), 4287, 28) +
        renderDialogueCell(g, lines) +
        renderPlainCell(g.chance(0.4) ? '' : '　', 315, 20) + '</w:tr>')
    }
    tables.push('<w:tbl>' + TBLPR + rows.join('') + '</w:tbl>')
  }
  // 保证每个用到的真名都至少有一条「行首 名字+冒号」的行 —— 否则它进不了白名单
  const heads = {}
  answers.forEach((exp) => exp.forEach((x) => {
    if (x.who && /^[^（(]/.test(x.text) && x.text.indexOf(x.who + '：') === 0) heads[x.who] = 1
  }))
  return { xml: '<w:document><w:body>' + tables.join('') + '</w:body></w:document>', answers, used, heads, cellTexts }
}

// ---------------- 校验 ----------------
const squash = (s) => String(s || '').replace(/\s+/g, '')
const fails = {}
let checks = 0
function bad(cat, msg) {
  if (!fails[cat]) { fails[cat] = []; fails[cat].n = 0 }
  fails[cat].n++
  if (fails[cat].length < 4) fails[cat].push(msg)
  if (process.env.FUZZ_DBG && fails[cat].n <= 2) console.log('  [' + cat + '] ' + msg)
}

function runOne(seed, rowsPerEp) {
  const doc = genDoc(seed, rowsPerEp)
  const blocks = util.extractDocxBlocks(doc.xml)
  const tables = blocks.filter((b) => b.type === 'table')
  const res = util.splitScripts(blocks)
  if (!res.ok || !res.segments.length) { bad('IM1_未拆出集', 'seed=' + seed); return }

  // ---- IM7 白名单覆盖：凡在「物理行首」当过说话人的名字，都必须被收进白名单 ----
  // 基准用独立推算出的单元格文本，不依赖产品实现。
  const STOP = { 人物: 1, 场景: 1, 道具: 1, 镜头: 1, 画面: 1, 备注: 1 }
  const wl = util.collectSpeakerNames(tables)
  doc.cellTexts.forEach((ct) => {
    String(ct).split(/\n+/).forEach((line) => {
      const t = line.trim()
      const m = /^([\u4e00-\u9fa5A-Za-z·]{1,5})(?:（[^）]*）)?[：:]/.exec(t)
      if (!m) return
      const nm = m[1]
      if (nm.length < 2 || STOP[nm]) return
      checks++
      if (!wl[nm]) bad('IM7_白名单漏名', 'seed=' + seed + ' 「' + nm + '」是行首说话人却没进白名单')
    })
  })

  // ---- IM1 行数守恒 ----
  const expect = []
  doc.answers.forEach((exp) => exp.forEach((x) => expect.push(x)))
  const got = []
  res.segments.forEach((s) => (s.lines || []).forEach((l) => got.push(l)))
  checks++
  if (got.length !== expect.length) {
    const A = got.map(squash).join('')
    const B = expect.map((x) => squash(x.text)).join('')
    let d = 0
    while (d < A.length && d < B.length && A[d] === B[d]) d++
    bad('IM1_行数不守恒', 'seed=' + seed + ' 行数 期望' + expect.length + '/实际' + got.length +
      '；首个字符差异 @' + d +
      ' 期望…「' + B.slice(Math.max(0, d - 24), d) + ' ⟨' + B.slice(d, d + 18) + '⟩」' +
      ' 实际…「' + A.slice(Math.max(0, d - 24), d) + ' ⟨' + A.slice(d, d + 18) + '⟩」')
    return
  }

  // ---- IM2 零丢字 ----
  const srcAll = doc.cellTexts.join('')
  checks++
  if (squash(got.join('')) !== squash(srcAll)) {
    bad('IM2_丢字', 'seed=' + seed + ' 源 ' + squash(srcAll).length + ' 字 → 出 ' + squash(got.join('')).length + ' 字')
  }

  // ---- IM3 无粘连：行内（非行首、非引号内）不得出现真说话人 + 冒号；假说话人不得跑到行首 ----
  const namesByLen = Object.keys(wl).sort((a, b) => b.length - a.length)
  got.forEach((t) => {
    String(t).split('\n').forEach((seg) => {
      // 先剥掉行首的说话人前缀：否则「王建华：…」会被误判成含「建华：」
      let rest = seg
      let stripped = true
      while (stripped) {
        stripped = false
        for (let i = 0; i < namesByLen.length; i++) {
          const n = namesByLen[i]
          if (rest.indexOf(n + '：') === 0) { rest = rest.slice(n.length + 1); stripped = true; break }
        }
      }
      // 先把所有「白名单名 + 冒号」的命中收齐，再做「更长名字覆盖」去重：
      // 白名单里同时有「王建华」和简称「建华」时，「建华：」会落在「王建华：」
      // 内部被重复命中一次 —— 那是同一个说话人，不该算两遍（否则必误报）。
      const hits = []
      namesByLen.forEach((n) => {
        let from = 0
        for (;;) {
          const p = rest.indexOf(n + '：', from)
          if (p < 0) break
          hits.push({ p: p, end: p + n.length, n: n })
          from = p + 1
        }
      })
      const kept = []
      hits.sort((a, b) => a.p - b.p || b.end - a.end)
      hits.forEach((h) => {
        // 「被覆盖」= 起点不晚于自己、且与之**有重叠**的更早命中。
        // 用「重叠」而非「严格包含」：白名单里的简称（建华）落在长名（王建华）
        // 内部时，两段区间只重叠、不包含，但确实是同一个说话人。
        const covered = kept.some((k) => k.p <= h.p && k.end > h.p)
        if (!covered) kept.push(h)
      })
      kept.forEach((h) => {
        checks++
        // 与产品同源的两条豁免：引号内的引用、并列连接后的联合说话人（「A、B：」）。
        // 这两处产品是**故意不切**的，把它们算成「未拆开」会误报。
        if (h.p > 0 && !util.insideQuote(rest, h.p) && !util.jointSpeakerBefore(rest, h.p)) {
          bad('IM3_真说话人未拆开', 'seed=' + seed + ' 行「' + seg.slice(0, 48) + '」内含第二个「' + h.n + '：」')
        }
      })
    })
    checks++
    FAKE.forEach((f) => { if (String(t).indexOf(f + '：') === 0) bad('IM3_假说话人被切到行首', 'seed=' + seed + '「' + t.slice(0, 40) + '」') })
  })

  // ---- IM4 归属正确 ----
  // 注意：charsPerLine 传 0 会被解析器当成「每行 0 字」，把每行拆成单字——
  // 那是测试台自己的错误配置，不是产品问题。这里取真实使用区间的值。
  const cpl = [18, 26, 34, 44][seed % 4]
  const parsed = parser.parseScript(got.join('\n'), {
    charsPerLine: cpl, roleHighlight: true, isDark: false, manualRoles: [], roleBlacklist: []
  })
  const alias = parsed.alias || {}
  parsed.lines.forEach((l) => {
    if (l.isSpacer) return
    const probe = squash(l.text)
    if (!probe) return
    const owners = expect.filter((p) => squash(p.text).indexOf(probe) >= 0)
    if (owners.length !== 1) return
    const p = owners[0]
    // 联合说话人（「A、B：」）的归属由角色识别层决定：归 A 或归 null 都合理
    // （matchRole 本身返回 null，归谁是 parseScript 拿全篇角色表回填的结果）。
    // 本测试只管拆分，所以这里只守一条底线 —— 不许凭空造出含并列标点的怪角色名。
    if (p.kind === 'joint') {
      checks++
      const allowed = [p.who, p.who2, role.applyAlias(p.who, alias), role.applyAlias(p.who2, alias)]
      if (l.role && allowed.indexOf(l.role) < 0) {
        bad('IM4c_联合行角色异常', 'seed=' + seed + ' 得「' + l.role + '」  「' + probe.slice(0, 40) + '」')
      }
      return
    }
    checks++
    const want = p.who ? role.applyAlias(p.who, alias) : null
    if (want !== l.role) {
      if (want && !l.role) bad('IM4a_丢失角色', 'seed=' + seed + ' 期望「' + want + '」→ null  「' + probe.slice(0, 40) + '」')
      else bad('IM4b_归属错误', 'seed=' + seed + ' 期望「' + want + '」得「' + l.role + '」  「' + probe.slice(0, 40) + '」')
    }
  })

  // ---- IM5 角色名卫生 ----
  ;(parsed.roles || []).forEach((r) => {
    checks++
    if (/[（）()【】\[\]、，]/.test(r.name)) bad('IM5a_角色名带标点', 'seed=' + seed + ' 「' + r.name + '」')
    if (FAKE.indexOf(r.name) >= 0) bad('IM5b_假说话人成为角色', 'seed=' + seed + ' 「' + r.name + '」')
  })
}

/** IM6 分隔方式等价：同一批逻辑行，换 6 种分隔渲染，拆集结果必须完全一致 */
function runSepEquivalence(seed) {
  const g = makeG(seed)
  const used = {}
  const logical = []
  for (let r = 0; r < 5; r++) {
    const lines = makeCell(g, used, { noDecoy: true, noJoint: true, forceSuffix: '。' })
    // 生成期可能因粘连策略清掉过 suffix，这里统一恢复：
    // 「分隔方式等价」比的是同一批逻辑行，不能让后缀差异混进来
    lines.forEach((ln) => { if (ln.kind === 'line') ln.suffix = '。' })
    lines.forEach((ln, k) => { if (k > 0) ln.sep = 'br1' })
    logical.push(lines)
  }
  const policies = ['br1', 'br2', 'brAlt', 'para', 'punct', 'space']
  const outs = policies.map((pol) => {
    const gg = makeG(seed + 999)
    const rows = logical.map((lines, r) => '<w:tr>' + renderPlainCell(String(r + 1), 309, 20) +
      renderPlainCell('【近景】客厅', 4287, 28) + renderDialogueCell(gg, lines, pol) +
      renderPlainCell('', 315, 20) + '</w:tr>')
    const xml = '<w:document><w:body><w:tbl>' + TBLPR +
      '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + renderMergeCell('等价性', 315) + '</w:tr>' +
      '<w:tr>' + renderMergeCell('人物：甲、乙　｜　场景：客厅', 315) + '</w:tr>' + HEADER_ROW +
      rows.join('') + '</w:tbl></w:body></w:document>'
    const res = util.splitScripts(util.extractDocxBlocks(xml))
    return { pol: pol, lines: res.segments.length ? res.segments[0].lines.map(squash) : [] }
  })
  const logicalCount = logical.reduce((a, l) => a + l.length, 0)
  const base = outs[0]
  outs.forEach((o) => {
    checks++
    if (o.lines.length !== logicalCount) bad('IM6_行数不对', 'seed=' + seed + ' ' + o.pol + ' 行数 ' + o.lines.length + '≠逻辑 ' + logicalCount)
    checks++
    if (JSON.stringify(o.lines) !== JSON.stringify(base.lines)) {
      bad('IM6_分隔方式不等价', 'seed=' + seed + ' ' + base.pol + ' vs ' + o.pol +
        '（' + base.lines.length + ' vs ' + o.lines.length + ' 行）')
    }
  })
}

// ---------------- 主流程 ----------------
// 被 require（作为库用于调试）时不跑主流程
if (require.main !== module) {
  module.exports = { genDoc, toAnswer, lineText, renderDialogueCell, makeCell, makeG, runOne, runSepEquivalence, REAL, FAKE, SEP_WEIGHT }
} else {
const N = parseInt(process.argv[2] || '200', 10)
const ROWS = parseInt(process.argv[3] || '0', 10) || 0
const SEED0 = parseInt(process.argv[4] || '20260919', 10)

console.log('=== 多人同格模糊测试 ===')
console.log('文档数 ' + N + ' / 每集行数 ' + (ROWS || '随机4-9') + ' / 起始种子 ' + SEED0 + '\n')
for (let i = 0; i < N; i++) runOne(SEED0 + i * 7919, ROWS)
for (let i = 0; i < Math.min(N, 60); i++) runSepEquivalence(SEED0 + i * 104729 + 13)

const cats = Object.keys(fails)
console.log('断言次数 ' + checks)
if (!cats.length) {
  console.log('✅ 全部通过：0 类失败')
} else {
  console.log('❌ 失败类别 ' + cats.length + '：')
  cats.forEach((c) => {
    console.log('  ' + c + '  ×' + fails[c].n)
    fails[c].slice(0, 3).forEach((m) => console.log('      ' + m))
  })
}
process.exit(cats.length ? 1 : 0)
}
