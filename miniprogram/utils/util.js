/**
 * 通用工具函数
 */

/**
 * 生成短 id，够用即可，不需要全局唯一性保证
 */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 格式化时间为 YYYY-MM-DD HH:mm
 */
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / 具体日期
 */
function fromNow(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return Math.floor(diff / min) + ' 分钟前'
  if (diff < day) return Math.floor(diff / hour) + ' 小时前'
  if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'
  return formatTime(ts).slice(0, 10)
}

/**
 * 防抖。
 * 返回的函数带 cancel()，页面销毁时可手工清掉挂起的定时器，
 * 避免定时器在页面已销毁后仍然触发 setData。
 */
function debounce(fn, wait) {
  let timer = null
  const wrapped = function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, args)
    }, wait)
  }
  wrapped.cancel = function () {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return wrapped
}

/**
 * 数值钳制
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 复制文本到剪贴板
 */
function copyText(text) {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 轻提示
 */
function toast(title, icon) {
  wx.showToast({
    title: String(title).slice(0, 14),
    icon: icon || 'none',
    duration: 1600
  })
}

/**
 * 解码 XML/HTML 实体。
 * docx 的 word/document.xml 里 &、<、>、"、'、不间断空格等会以实体形式存储
 * （如「A&amp;B」「3&lt;5」），若不解码，导入后会原样显示成 &amp; 等乱码。
 * @param {string} s
 * @returns {string}
 */
function decodeXmlEntities(s) {
  if (!s || typeof s !== 'string') return s
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16))
      } catch (e) {
        return m
      }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10))
      } catch (e) {
        return m
      }
    })
    .replace(/&amp;/g, '&') // 放最后解码，避免把上面刚还原出来的 & 又转回去
}

/**
 * 从 docx 的 word/document.xml 提取纯文本（按段落换行）。
 *
 * docx 本质是 zip 包，正文文本都在 <w:t> 元素内，段落以 <w:p> 分隔。
 * 配合小程序内置 FileSystemManager.unzip 即可在纯前端解析 .docx，无需第三方库。
 *
 * @param {string} xml word/document.xml 内容
 * @returns {string} 纯文本，段落间以换行分隔；入参异常时返回空串
 */
function extractDocxText(xml) {
  if (!xml || typeof xml !== 'string') return ''
  const paras = xml.split(/<w:p\b/g)
  const out = []
  for (let i = 0; i < paras.length; i++) {
    // 第 0 段是 XML 头（<w:body> 之前），不是真实段落，直接跳过
    if (i === 0) continue
    // 切分后其余段不含 <w:p 前缀，需补回，避免丢失段落起始标签
    const seg = '<w:p' + paras[i]
    const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
    const texts = []
    let m
    while ((m = re.exec(seg)) !== null) {
      texts.push(m[1])
    }
    // 重要：空段落必须保留为空行。
    // 旧实现把空段直接丢掉，导致 Word 导入后整篇没有任何空行，
    // 「按空行拆分成多篇台本」永远只能拆出 1 篇（用户反馈：点了拆分没反应）。
    out.push(decodeXmlEntities(texts.join('')))
  }
  // 去掉文首/文尾的空段，正文中间的空行（分段信息）原样保留
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join('\n')
}

/**
 * 从正文前面几个字自动生成台本标题。
 * 去除空白与标点，仅保留中文/英文/数字与 &@#，取前 maxLen 个有效字符。
 *
 * @param {string} text 正文
 * @param {number} [maxLen=20] 最大长度（标题输入框上限 30）
 * @returns {string} 自动标题；正文无有效内容时返回空串
 */
function autoTitleFromText(text, maxLen) {
  maxLen = maxLen || 20
  if (!text) return ''
  const cleaned = text
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9&@#]/g, '')
  return cleaned.slice(0, maxLen)
}

/** 标题行识别：第N集/场/章/节/回/幕/篇…（支持【第1集】等括号包裹），或 序/楔子/尾声 等 */
const HEAD_LINE_RE = /^[【\[]?\s*第\s*[0-9０-９一二三四五六七八九十百千万零两]+\s*(?:[集场章节回幕篇部季话]|部分)[】\]]?/
const HEAD_WORD_RE = /^[【\[]?\s*(?:序|序章|楔子|引子|题记|尾声|终章|片头|片尾|花絮|彩蛋|正片|预告)[】\]]?/

/** 一级边界（分集）：仅「集/期/话/卷/部」触发。命中它就不再看幕/场 —— 见 findHeadingBoundaries */
const EP_HEAD_RE = /^[【\[]?\s*(?:第\s*[0-9０-９一二三四五六七八九十百千万零两]+\s*[集期话卷部]|EP\s*\d{1,3}|E\d{1,3})\s*[】\]]?/i

/**
 * 二级边界（幕/场/回/章）：**只在全稿没有任何一级边界时**才启用。
 *
 * 【P3 修复的准确形态】过去它不存在 —— 于是 findHeadingBoundaries 只认 集/期/话/卷/部，
 * 而 splitImportBlocks('headings') 用的是 HEAD_LINE_RE（含 幕/场），同一份稿两个入口
 * 给出不同答案（话剧样本：智能拆分 1 篇 ｜ 按标题拆 5 篇）。
 *
 * 直接让一级也认「幕/场」是错的：稿件同时有「第1集」和「第二幕」时（混合稿，真实常见），
 * 「第二幕」属于第1集内部的结构标记，切开会破坏按集推进。所以保留"一级优先"，
 * 仅在**全稿根本没有分集信号**（纯话剧/纯广播剧）时才退化到幕/场。
 */
const SUB_HEAD_RE = /^[【\[]?\s*第\s*[0-9０-９一二三四五六七八九十百千万零两]+\s*[幕场回章][】\]]?/

/**
 * 系列名识别正则：捕获「系列名」前缀（A 级强信号用）。
 * 形如「建华&小凤的生活71」「婆婆·年夜饭 第3」等「名字(隔符)数字(后缀)」的行。
 */
const SERIES_RE = /^(.+?)\s*(?:[·&_\-：:（(]|第)?\s*\d{1,3}\s*(?:集|期|话|卷|）|\))?\s*$/


/**
 * 从台本标题解析「集号」整数（用于按集顺序切换 / 排序）。
 * 解析优先级：
 *   1) 开头「第N集/话/期/卷/章…」（支持中文数字、阿拉伯数字、括号包裹）
 *      — 例：「第2集」→2、「第二十一集」→21、「【第3集】」→3
 *   2) 末尾「系列名 + 数字(+ 集/期/话…可选)」
 *      — 例：「建华&小凤的生活71」→71、「婆婆·年夜饭 第3」→3、「3集」→3
 *   3) 兜底：标题中最后一个连续数字串
 *   解析不到返回 null（如「序章」「未命名台本」这类无集号标题）。
 */
function cnDigitsToNum(cn) {
  const s = String(cn).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const d = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
  const u = { '十': 10, '百': 100, '千': 1000 }
  let total = 0, section = 0, num = 0
  for (const ch of s) {
    if (d[ch] !== undefined) num = d[ch]
    else if (u[ch] !== undefined) {
      if (num === 0) num = 1
      section += num * u[ch]
      num = 0
    }
  }
  return total + section + num
}
function parseEpisodeNo(title) {
  if (!title) return null
  const t = String(title).trim()
  let m = t.match(/^[【\[]?\s*第\s*([0-9０-９一二三四五六七八九十百千万零两]+)\s*(?:[集场章节回幕篇部季话]|部分)/)
  if (m) return cnDigitsToNum(m[1])
  m = t.match(/(\d{1,3})\s*(?:[集期话卷部]|[）\)])?\s*$/)
  if (m) return parseInt(m[1], 10)
  const nums = t.match(/\d+/g)
  if (nums && nums.length) return parseInt(nums[nums.length - 1], 10)
  return null
}

/**
 * 按「集号」升序排列台本，使上一个/下一个严格遵循 第N集→第N+1集 的连续顺序。
 * 规则：
 *   - 列表里只要有任意一篇能解析出集号，就整体按集号升序；
 *   - 解析不到集号（如随笔/序章）的台本排在末尾，保持入参相对顺序（不强行打断）；
 *   - 若整个列表都没有可解析的集号，则原样返回（退化为 store.list 的更新时间排序，兼容纯随笔用户）。
 */
function sortByEpisode(scripts) {
  if (!Array.isArray(scripts) || !scripts.length) return scripts || []
  const arr = scripts.slice()
  const tagged = arr.map((s) => ({ s, no: parseEpisodeNo(s && s.title) }))
  if (!tagged.some((x) => x.no !== null)) return arr
  tagged.sort((a, b) => {
    if (a.no === null && b.no === null) return 0
    if (a.no === null) return 1
    if (b.no === null) return -1
    return a.no - b.no
  })
  return tagged.map((x) => x.s)
}

/** 按集号递增，返回当前台本的「下一集」（找不到或已是最后一集返回 null） */
function getNextEpisodeScript(scripts, currentId) {
  const ordered = sortByEpisode(scripts)
  const idx = ordered.findIndex((s) => s.id === currentId)
  if (idx < 0 || idx + 1 >= ordered.length) return null
  return ordered[idx + 1]
}

/** 按集号递增，返回当前台本的「上一集」（找不到或已是第一集返回 null） */
function getPrevEpisodeScript(scripts, currentId) {
  const ordered = sortByEpisode(scripts)
  const idx = ordered.findIndex((s) => s.id === currentId)
  if (idx <= 0) return null
  return ordered[idx - 1]
}


/**
 * ================================================================
 * 台本标题命名规则（单一事实来源，供拆分与页面共用）
 * ================================================================
 *   TITLE_MAX_LEN   30   标题入库/输入框长度上限
 *   AUTO_TITLE_LEN  20   自动「摘要式」标题长度（取正文开头 N 个有效字）
 *   PLACEHOLDER_TITLE   空内容兜底标题「未命名台本」
 *
 *   命名优先级（autoName）：
 *     1) 正文首个非空行本身就是「标题行」（第N集/序章…或 系列名+数字）
 *        → 直接用该行原文做标题（用户最想要的“第1集”就是标题本身）；
 *     2) 否则取正文开头去空白/标点后的前 AUTO_TITLE_LEN 个有效字（摘要式）；
 *     3) 以上都为空 → 返回空串，由调用方落 PLACEHOLDER_TITLE。
 *
 *   不变量：标题行判定只看首行；台词行（含“角色：台词”或逗号句号）永不抢标题。
 * ================================================================
 */
const TITLE_MAX_LEN = 30
const AUTO_TITLE_LEN = 20
const PLACEHOLDER_TITLE = '未命名台本'

/** 取内容的首个非空行 */
function firstNonEmptyLine(content) {
  if (!content) return ''
  const s = String(content).replace(/\r\n?/g, '\n')
  const first = s.split('\n').map((l) => l.trim()).find((l) => l !== '')
  return first || ''
}

/**
 * 判断某行是否适合直接做标题（标题行 or 简洁的“系列名+数字”行）。
 * 规则：不含台词/叙述标点（：:，。！？、），避免「林晚：台词」这类行抢标题。
 * @returns {'heading'|'series'|''} 命中类型，未命中返回空串
 */
function titleLineKind(line) {
  if (!line) return ''
  const s = String(line).trim()
  if (!s) return ''
  if (/[：:，。！？、]/.test(s)) return '' // 疑似台词/叙述行
  if (HEAD_LINE_RE.test(s) || HEAD_WORD_RE.test(s)) return 'heading'
  if (s.length <= 14 && SERIES_RE.test(s)) return 'series'
  return ''
}

/**
 * 自动为整篇/整块内容命名（核心入口，拆分与编辑页共用）。
 * 见上方「命名规则」注释。
 * @param {string} content 正文
 * @param {number} [maxLen=AUTO_TITLE_LEN] 摘要式标题长度（标题行优先不受此限，按 TITLE_MAX_LEN 截断）
 * @returns {string} 命名结果；内容为空返回 ''
 */
function autoName(content, maxLen) {
  const first = firstNonEmptyLine(content)
  const kind = titleLineKind(first)
  if (kind) return first.slice(0, TITLE_MAX_LEN)
  const auto = autoTitleFromText(content, maxLen == null ? AUTO_TITLE_LEN : maxLen)
  return auto.slice(0, TITLE_MAX_LEN)
}

/**
 * 把导入的长文本拆成多个台本块（Req 5：一级页导入 Word 可选拆分）。
 *
 * @param {string} text 原始正文（段落间换行）
 * @param {string} mode 拆分方式：
 *   - 'headings'：按「第N集/场/章/节…」「序/楔子/尾声…」标题行切分；
 *     没有命中任何标题时退化为整篇一块，不会误伤。
 *   - 'blank'：按空行分隔的段落块切分（Word 中一集之间通常有空行）。
 * @returns {Array<{title: string, content: string}>} 每块独立成一篇台本；
 *   标题优先取命中标题行原文，否则用正文开头自动命名；空块会被剔除
 */
/**
 * 按字数分批拆分（保底拆分）。
 * 在段落边界上累积，达到 maxChars 就切一块并附上序号标题；
 * 用于「没有集/场/章标题、也没有空行」的长文档，保证拆分一定产出多篇。
 *
 * @param {string} src 已规范化的正文（\n 分隔）
 * @param {number} [maxChars=800] 每篇上限字数
 * @returns {Array<{title:string, content:string}>}
 */
function splitBySize(src, maxChars) {
  const limit = maxChars > 0 ? maxChars : 800
  const lines = src.split('\n')
  const parts = []
  let buf = []
  let len = 0

  const flush = () => {
    const content = buf.join('\n').trim()
    buf = []
    len = 0
    if (!content) return
    parts.push({ title: autoName(content), content })
  }

  for (const raw of lines) {
    const piece = raw.replace(/\s+/g, '').length
    // 单段本身超限且缓冲区已有内容 → 先切一刀，避免一篇被撑得过大
    if (len > 0 && len + piece > limit) flush()
    buf.push(raw)
    len += piece
    if (len >= limit) flush()
  }
  flush()

  // 加上序号前缀，一级页文件夹里能看出阅读顺序
  const total = parts.length
  return parts.map((p, i) => ({
    title: total > 1 ? `第${i + 1}部分 ${p.title}`.slice(0, 30) : p.title,
    content: p.content
  }))
}

function splitImportBlocks(text, mode, maxChars) {
  const src = String(text || '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return []

  // 空行模式：按空行分隔的段落块拆，与标题无关；块标题统一走命名规则
  if (mode === 'blank') {
    const parts = src.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
    return parts.map((content) => ({
      title: autoName(content),
      content
    }))
  }

  // 字数分批模式：按段落边界累积，够 maxChars 就切一块。
  // 这是「保底拆分」——没有标题、也没有空行的长文档（Word 常见）也能拆出多篇。
  if (mode === 'size') {
    return splitBySize(src, maxChars)
  }

  // headings 模式：按标题行切分；没有标题命中时整篇退化为一块
  const lines = src.split('\n')
  const blocks = []
  let cur = null

  const isHeading = (t) => HEAD_LINE_RE.test(t) || HEAD_WORD_RE.test(t)
  const close = () => {
    if (!cur) return
    const content = cur.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (content) {
      // 命中标题行则用标题行原文，否则按命名规则自动命名（自动摘要 20 字）
      const title = (cur.title || autoName(content)).slice(0, TITLE_MAX_LEN)
      blocks.push({ title, content })
    }
    cur = null
  }

  for (const raw of lines) {
    const t = raw.trim()
    if (!t) {
      // 空行保留在块内（段落间隔），不切块
      if (cur) cur.lines.push(raw)
      continue
    }
    if (isHeading(t)) {
      if (cur && (cur.lines.length || cur.title)) close()
      if (!cur) cur = { title: t, lines: [] }
      continue
    }
    if (!cur) cur = { title: '', lines: [] }
    cur.lines.push(raw)
  }
  close()
  return blocks
}

/**
 * 智能拆分：导入 Word/文本后自动识别分集边界。
 * 优先级：① 系列名+数字（如「建华&小凤的生活71」）② 「第N集/场/章」标题 ③ 空行分段。
 * 任一命中即切片；都不命中返回空数组，由调用方走字数兜底，保证长文档一定能拆开。
 */
function smartSplitScripts(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return []
  const lines = src.split('\n')
  const seriesName = extractSeriesName(lines)
  let idxs = seriesName ? findSeriesBoundaries(lines, seriesName) : []
  if (idxs.length === 0) idxs = findHeadingBoundaries(lines)
  if (idxs.length === 0) idxs = findBlankBoundaries(src)
  if (idxs.length === 0) return []
  return sliceByBoundaries(lines, idxs)
}

/** 从台词稿里自动提取「系列名」：扫描所有「系列名+数字」候选，取出现≥2次的前缀 */
function extractSeriesName(lines) {
  const count = {}
  for (const raw of lines) {
    const s = (raw || '').trim()
    if (!s || s.length > 40) continue
    const m = s.match(SERIES_RE)
    if (!m) continue
    const name = (m[1] || '').trim()
    if (name.length < 2 || name === '第') continue
    count[name] = (count[name] || 0) + 1
  }
  let best = ''
  let max = 0
  for (const k in count) {
    if (count[k] > max) {
      max = count[k]
      best = k
    }
  }
  return max >= 2 ? best : ''
}

/** 系列名 + 数字 的边界行（A 级强信号） */
function findSeriesBoundaries(lines, seriesName) {
  const re = buildSeriesRegex(seriesName)
  const idxs = []
  lines.forEach((raw, i) => {
    if (re.test(raw)) idxs.push(i)
  })
  return idxs
}

/**
 * 「第N集/第N幕/序章…」标题边界行 —— 两级制（P3）。
 *
 *  一级：集/期/话/卷/部（+ 序/楔子/尾声 等词标题）。有它就只用它，
 *        因为混合稿里「第1集 → 第二幕 → 第2集」的「第二幕」是第1集内部的结构。
 *  二级：幕/场/回/章。仅当全稿一个一级边界都没有（纯话剧/纯广播剧）时才启用，
 *        否则这种稿会被整篇塞进一个台本里，与「按标题拆」的结果也对不上。
 */
function findHeadingBoundaries(lines) {
  const ep = []
  const sub = []
  lines.forEach((raw, i) => {
    const t = (raw || '').trim()
    if (!t) return
    if (EP_HEAD_RE.test(t)) ep.push(i)
    else if (SUB_HEAD_RE.test(t)) sub.push(i)
  })
  if (ep.length) return ep
  // 二级要带上 序/楔子/尾声 这类词标题 —— 纯话剧的「序幕」与「第一幕」同级，
  // 缺了它「序幕」会退化成前言块，与「按标题拆」的口径又对不齐了。
  const word = []
  lines.forEach((raw, i) => {
    const t = (raw || '').trim()
    if (t && HEAD_WORD_RE.test(t)) word.push(i)
  })
  return word.concat(sub).sort((a, b) => a - b)
}

/** 空行分段：每块首行作为边界；仅有一块时返回空（交给字数兜底） */
function findBlankBoundaries(src) {
  const lines = src.split('\n')
  const idxs = []
  let cur = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) {
      cur = -1
      continue
    }
    if (cur < 0) {
      cur = i
      idxs.push(i)
    }
  }
  return idxs.length > 1 ? idxs : []
}

/**
 * 按边界行下标切片成多篇台本：标题统一走命名规则 autoName（首行标题行优先，P2-3）
 *
 * 【P1 修复】首个边界**之前**的内容必须单独成块，不能丢。
 * 旧实现从 idxs[0] 起切，于是「剧名 / 出场人物 / 楔子前言」这类写在第一个
 * 「第1集」之前的内容会整体消失 —— 它们既不在任何一篇里，也不会报错，用户
 * 只会觉得「导入后前言没了」。这对 `smartSplitScripts`（preview 页「智能拆分」
 * 按钮用的真实入口）与 `splitParagraphScript` 同时成立。
 *
 * 只补 idxs[0] 之前这一段：边界之间的空隙是空行/元数据，无需额外处理。
 */
function sliceByBoundaries(lines, idxs) {
  const blocks = []
  const push = (part) => {
    const seg = part.map((l) => l.trim()).filter((l) => l !== '')
    if (seg.length === 0) return
    const content = seg.join('\n')
    blocks.push({ title: autoName(content), content: content })
  }
  if (idxs.length && idxs[0] > 0) push(lines.slice(0, idxs[0]))
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i]
    const end = i + 1 < idxs.length ? idxs[i + 1] : lines.length
    push(lines.slice(start, end))
  }
  return blocks
}

/** 构造「系列名 + 数字」的 A 级强信号正则（seriesName 来自 extractSeriesName） */
function buildSeriesRegex(seriesName) {
  const esc = seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    '^\\s*' + esc + '\\s*(?:[\\s·&_\\-：:（(]|第)?\\s*(\\d{1,3})\\s*(?:集|期|话|卷|）|\\))?\\s*$',
    'i'
  )
}



/**
 * 表格感知的 docx 解析：从 word/document.xml 提取「块数组」，保留表格结构。
 * 块类型：{type:'paragraph', text} 或 {type:'table', rows:[[cellText,...], ...]}。
 * 拆分规则_v1 的「规则 A（表格稿）」依赖表格结构（一表=一集、台词取第3列），
 * 故不能再用 extractDocxText 的纯段落提取（会丢失表格）。
 */
/** 从一段 OOXML（单元格/段落）中提取所有 <w:t> 文本；按 <w:p> 分段后再取，避免 <w:tc>/<w:p> 前缀被吞进捕获组。 */
function extractWtText(xml) {
  if (!xml) return ''
  const out = []
  const paras = String(xml).split(/<w:p\b/)
  for (let i = 1; i < paras.length; i++) {
    // 一个 <w:tc> 里可能有多个 <w:p>（各是一段）。段与段之间必须还原成换行，
    // 否则同一格里的多段文字会被拼成一行。
    if (i > 1) out.push('\n')
    // 必须 <w:t\b（单词边界），否则 <w:t 会误匹配 <w:tr>/<w:tc>/<w:tblPr> 等元素，
    // 把排版 XML（含 <w:rPr>）当文本吞入，导致拆出内容全是乱码。
    // 同时必须认 <w:br/>（段落内的软换行）：脚本文档里「一个说话人一行」正是靠它分隔的，
    // 只拼 <w:t> 会把换行整段吞掉，把同一格里两个人的台词粘成一行 —— 即「台词粘连」。
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>/g
    let t
    while ((t = re.exec(paras[i])) !== null) {
      // 第二个分支（<w:br/>）没有捕获组 → t[1] 为 undefined，落成换行
      out.push(t[1] === undefined ? '\n' : t[1])
    }
  }
  return decodeXmlEntities(out.join(''))
}

function pushParagraphBlocks(blocks, sliceXml) {
  const paras = sliceXml.split(/<w:p\b/g)
  for (let i = 0; i < paras.length; i++) {
    if (i === 0) continue
    const seg = '<w:p' + paras[i]
    blocks.push({ type: 'paragraph', text: extractWtText(seg) })
  }
}

/** 解析一个 <w:tbl> 为二维单元格文本数组（行→单元格）。合并单元格仅首格有文字，符合集标题行特征。 */
function parseTableBlock(tblXml) {
  const rows = []
  const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g
  let rm
  while ((rm = rowRe.exec(tblXml)) !== null) {
    const rowXml = rm[0]
    const cells = []
    const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g
    let cm
    while ((cm = cellRe.exec(rowXml)) !== null) {
      cells.push(extractWtText(cm[0]))
    }
    rows.push(cells)
  }
  return { type: 'table', rows }
}

/** 从 docx document.xml 提取保留表格结构的块数组（见上）。 */
function extractDocxBlocks(xml) {
  if (!xml || typeof xml !== 'string') return []
  const blocks = []
  const tblRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/g
  let last = 0
  let m
  while ((m = tblRe.exec(xml)) !== null) {
    if (m.index > last) pushParagraphBlocks(blocks, xml.slice(last, m.index))
    blocks.push(parseTableBlock(m[0]))
    last = tblRe.lastIndex
  }
  if (last < xml.length) pushParagraphBlocks(blocks, xml.slice(last))
  return blocks
}

/** 把块数组拼回纯文本（段落块按行、表格块拼所有单元格），用于「作为一篇导入」兜底。 */
function blocksToText(blocks) {
  if (!blocks || !blocks.length) return ''
  const out = []
  blocks.forEach((b) => {
    if (b.type === 'paragraph') {
      out.push(b.text || '')
    } else if (b.type === 'table') {
      ;(b.rows || []).forEach((cells) => {
        ;(cells || []).forEach((c) => {
          if (c) out.push(c)
        })
      })
    }
  })
  return out.join('\n')
}

/** 从集标题解析集号（阿拉伯数字；覆盖「第N集」与「系列名+数字」）。中文数字可后续扩展。 */
/** 从集标题解析集号（阿拉伯数字；覆盖「第N集」「系列名+数字」「…（口播）」后缀）。中文数字可后续扩展。 */
function episodeNoFromTitle(title) {
  if (!title) return null
  const m = title.match(/(?:第\s*)?(\d{1,3})\s*(?:集|期|话|卷|部分)?\s*(?:（[^）]*）)?\s*$/)
  if (m) return parseInt(m[1], 10)
  return null
}

/** 判断一行是否「像集标题」：含集/期/话/卷 或 以数字结尾且含中文，且不含冒号与人物/场景/道具等关键词（排除元数据行）。 */
function isEpisodeTitleRow(s) {
  if (!s || s.length > 40) return false
  if (/[：:]/.test(s)) return false
  if (/(人物|场景|道具|镜头|画面|台词|备注|角色)/.test(s)) return false
  if (/(第\s*\d|集|期|话|卷|EP\s*\d|E\d|口播)/i.test(s)) return true
  if (/[\u4e00-\u9fa5].*\d{1,3}$/.test(s)) return true
  return false
}

/**
 * 【P4 修复】把舞台/分镜表常见的「说话人 + 直角引号」写法规范化成标准台词行。
 *
 * 分镜表里台词常写成「母亲｢回来啦，先洗手。｣」而不是「母亲：回来啦，先洗手。」。
 * 拆分器与角色抽取都建立在「名字 + 冒号」这一约定上，于是这种稿 →
 * 台词**不丢字**（整行进内容），但**角色归属 0/6**（不高亮、也躲过按角色筛选）。
 *
 * 只认两种安全位置：
 *   ① 段首（前面没有字）
 *   ② 紧跟在句末标点 / 另一个闭合引号之后（「沈亦｢别——｣母亲｢吃完再走。｣」）
 * 行中间的「他跟我说｢好的｣」是**引用**，绝不当说话人。
 *
 * ⚠️ 只作用于多模态路径：本函数在 splitDialogueCell 里调用，而悟空专属拆分走的是
 * 单元格原文复制（raw.split('\n')），永远不经过这里 —— 悟空行为不受影响。
 *
 * @param {string} text 单元格原文
 * @returns {string} 规范化后的文本（用 \n 分隔各句，交由上层按软换行拆行）
 */
function normalizeCornerQuote(text) {
  const src = String(text == null ? '' : text)
  if (src.indexOf('\uFF62') < 0) return src // ｢ 都没出现，原样返回（零开销）
  const RE = /([\u4e00-\u9fa5A-Za-z·（）()]{1,12})\uFF62([^\uFF63]*)\uFF63/g
  const OK_BEFORE = /[。！？!?；;…\n\uFF63\u300D\u300F\u201D\u2019）)]/
  return src.replace(RE, (m, name, body, off) => {
    const b = String(body).trim()
    if (!b) return m // 「到嘴边又咽了回去｣」这种空引号不动
    const before = src.slice(0, off).replace(/\s+$/, '')
    if (before && !OK_BEFORE.test(before.slice(-1))) return m // 行中引用，不是说话人
    return '\n' + name + '：' + b + '\n'
  })
}

/**
 * 把一个「台词」单元格按说话人拆成多行：
 * 形如「婆婆：…儿媳妇：…」拆成「婆婆：…」「儿媳妇：…」；
 * 说话人允许带括号动作（婆婆（喊）：…）；单行无冒号则原样返回。
 */
function splitDialogueCell(text, names) {
  if (!text) return [text]
  const s = normalizeCornerQuote(String(text)) // P4：「名｢台词｣」→「名：台词」
  // 单元格内的软换行（原文档 <w:br/>，已由 extractWtText 还原为换行符）是排版上的硬边界：
  // 必须先按它拆开，再在每一段内部按说话人拆。否则「A：…换行B：…」里 B 那半句会被
  // 并回 A 的段落，两条台词粘成一行（行数统计也随之偏少）。
  const paras = s.split(/\n+/).map((x) => x.trim()).filter((x) => x)
  if (!paras.length) return [s]
  const out = []
  paras.forEach((p) => {
    splitDialogueCellSingle(p, names).forEach((x) => {
      const v = String(x || '').trim()
      if (v) out.push(v)
    })
  })
  return out.length ? out : [s]
}

/** 统计字符串里某字符出现次数（用于引号配对判断） */
function countOccur(s, ch) {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++
  return n
}

/**
 * 位置 pos 是否落在「尚未闭合的引号」里面。
 *
 * 为什么需要：台词正文里引用别人的话很常见，
 * 例如「杨凤：他跟我说“王建华：我不去”，你信吗？」——
 * 引号里的「王建华：」是**引用内容**，不是说话人。若不挡住，
 * 这一句会被切成两行，前一行只剩「杨凤：他跟我说“」这半句。
 */
function insideQuote(s, pos) {
  const head = s.slice(0, pos)
  const pairs = [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』']]
  for (let i = 0; i < pairs.length; i++) {
    if (countOccur(head, pairs[i][0]) > countOccur(head, pairs[i][1])) return true
  }
  if (countOccur(head, '"') % 2 === 1) return true
  if (countOccur(head, "'") % 2 === 1) return true
  return false
}

/**
 * 「边界放宽」判定：说话人名字**紧贴在汉字之后**时，判断它是否真该当切点。
 *
 * 背景：常规规则要求说话人左边是「非中文」，否则不敢切 ——
 * 因为「…也当晚处理掉：要么分装冷藏…」这类正文，宽松正则会把
 * 「当晚处理掉」当成说话人，一切就碎句（真实稿件里出现过）。
 *
 * 但「你吃几串了王建华：才3串。」这种真粘连也确实存在，不切就会把
 * 两个角色的台词并成一行：不高亮、且躲过按角色筛选。
 *
 * 判据：**只有本稿别处确实当过说话人的名字**才允许切（白名单）。
 * 于是「王建华」能救回来，「当晚处理掉」永远不会被误切。
 *
 * @param {string} sp       宽松正则抓到的候选（≤5 字，可能带括号动作）
 * @param {number} colonAt  冒号下标
 * @param {Object} names    本稿已知说话人白名单
 * @returns {number} 切点下标；-1 表示不切
 */
function matchKnownNameEndingAt(sp, colonAt, names) {
  if (!names) return -1
  const start = colonAt - sp.length
  // 情形 A：候选尾部带括号动作「名字（动作）」→ 只看括号前的名字
  const pm = /（[^）]*）$/.exec(sp)
  const core = pm ? sp.slice(0, sp.length - pm[0].length) : sp
  if (core) {
    const maxLen = Math.min(5, core.length)
    // 从长到短试后缀：优先认更长的名字（「王建华」优先于「建华」）
    for (let len = maxLen; len >= 2; len--) {
      const nm = core.slice(core.length - len)
      // 切完只剩 1 个字留在上一段，几乎必然是误切
      // （把真名「王建华」切成「王」+「建华：」就是这种），跳过它试更短的
      if (names[nm] && core.length - len !== 1) return start + (core.length - len)
    }
  }
  // 情形 B：括号里就是名字「（名字）：」——正则会把它并成「前一个字 +（名字）」，
  // 名字在括号内，切点应落在左括号上（整个「（名字）：」都归这个名字）
  const pm2 = /（([^）]{1,5})）$/.exec(sp)
  if (pm2 && names[pm2[1]]) return start + (sp.length - pm2[0].length)
  return -1
}

/**
 * 收集「本稿已知说话人名」白名单（供 matchKnownNameEndingAt 用）。
 * 只认「行首 ≤5 个汉字/字母（可带括号动作）+ 冒号」这一种写法 —— 与稿件的排版约定一致。
 * STOP 表挡掉表格元信息列名（人物/场景/道具…），免得把列名当成说话人。
 * 单字名不进白名单（歧义太大），它们仍走常规边界规则。
 */
function collectSpeakerNames(tables) {
  const names = {}
  const STOP = {
    人物: 1, 场景: 1, 道具: 1, 镜头: 1, 画面: 1, 备注: 1, 时间: 1, 地点: 1,
    音效: 1, 音乐: 1, 字幕: 1, 标题: 1, 集数: 1, 分组: 1, 部分: 1, 台词: 1,
    角色: 1, 分镜: 1, 景别: 1, 时长: 1, 序号: 1
  }
  ;(tables || []).forEach((tbl) => {
    ;((tbl && tbl.rows) || []).forEach((cells) => {
      ;(cells || []).forEach((cell) => {
        String(cell || '').split(/\n+/).forEach((line) => {
          const t = line.trim()
          if (!t) return
          const m = /^([\u4e00-\u9fa5A-Za-z·]{1,5})(?:（[^）]*）)?[：:]/.exec(t)
          // 「（名字）：」这种写法拆分器认、角色识别也认，白名单收集必须同样认，
          // 否则这类说话人永远进不了白名单，跨格粘连就救不回来。
          const m2 = m ? null : /^（([\u4e00-\u9fa5A-Za-z·]{1,5})）[：:]/.exec(t)
          const nm = m ? m[1] : (m2 ? m2[1] : '')
          if (!nm) return
          if (nm.length < 2) return
          if (STOP[nm]) return
          names[nm] = (names[nm] || 0) + 1
        })
      })
    })
  })
  return names
}

/**
 * 计算「行首提示语」的结束位置（返回 0 表示没有可单独成段的提示语）。
 *
 * 为什么需要：切点只有一个、又不在行首时，旧实现会把整格当作一行 ——
 * 例如「（静场三秒）建华：饭在锅里。」会被视为一条台词，
 * 于是「（静场三秒）」连带着被错认成角色（括号格式的伪角色）。
 *
 * 两类提示语：
 *   1) 切点前本身就是完整提示（以右括号或句末标点收尾）→ 就取切点
 *   2) 切点落在括号内部（如「（环境音：…）名字：…」，切点在「环境音」处）
 *      → 把括号补全后再单独成段，避免把提示语劈成半个括号
 * 完全闭合不了的（例如只有「（」而全篇没有「）」）返回 0，保持原样贴在首段上。
 */
const BR_PAIRS = [['（', '）'], ['(', ')'], ['【', '】'], ['「', '」'], ['『', '』']]
/** 是否含「正文内容」字符（汉字/字母/数字/间隔号）——用来区分「提示语」与「光秃秃的标点」 */
function hasWordChar(s) {
  return /[\u4e00-\u9fa5A-Za-z0-9·]/.test(String(s || ''))
}
function leadEndAt(text, firstCut) {
  const before = text.slice(0, firstCut)
  if (!before) return 0
  // 尾部空白不算提示语的一部分，否则「（切光） 名字：…」这种带空格的写法会判定失败
  const bt = before.replace(/\s+$/, '')
  // 情形 1：切点前是一段「有内容的完整提示」（以右括号或句末标点收尾）
  if (hasWordChar(bt) && (/[）)】」』]$/.test(bt) || /[。！？!?；;]$/.test(bt))) return firstCut
  // 情形 2：切点落在括号内部（「（环境音：…）名字：…」的切点在「环境音」上）→ 补全括号
  for (let i = 0; i < BR_PAIRS.length; i++) {
    const open = BR_PAIRS[i][0]
    const close = BR_PAIRS[i][1]
    if (countOccur(before, open) <= countOccur(before, close)) continue
    const ci = text.indexOf(close, firstCut)
    if (ci >= 0) return ci + 1
  }
  return 0
}

/**
 * 切点左侧是不是「并列连接」——即「A、B：」「A和B：」这种**联合说话人**。
 *
 * 为什么需要：说话人左边界规则只要求「前一字符非中文」，而 `、` `和` `与` 这些
 * 连接成分本身就是非中文/非常用名用字，于是「王建华、杨凤：我们一起回来了。」
 * 会在「杨凤」前切一刀，产出「王建华、」这半句残词 —— 两人齐声的台词本应是一行。
 *
 * 判据只认「切点左侧紧邻的并列连接」，不做更复杂的句法推断：
 *   · 单字：、 和 与 及 跟 同
 *   · 双字：还有 以及 加上
 *
 * 宁可整行不切（最坏结果是这一行不带角色、不高亮），也不产出残句
 * —— 残句会破坏「零丢字」红线与逐行朗读的连贯性，代价大得多。
 * 实测现行三部剧本里「正文以顿号收尾再接说话人」的写法为 0 处，
 * 所以这条规则的误伤面基本不存在。
 */
const JOINT_SINGLE = '、和与及跟同'
const JOINT_WORDS = ['还有', '以及', '加上']

/** 切点左侧紧邻的并列连接成分的起点；返回 -1 表示左侧不是并列连接 */
function jointConnectorStartAt(text, cut) {
  if (cut <= 0) return -1
  if (JOINT_SINGLE.indexOf(text[cut - 1]) >= 0) return cut - 1
  for (let i = 0; i < JOINT_WORDS.length; i++) {
    const w = JOINT_WORDS[i]
    if (cut >= w.length && text.slice(cut - w.length, cut) === w) return cut - w.length
  }
  return -1
}

/** 切点左侧是不是「并列连接」（纯判定，不含处置；供诊断/测试与产品同源使用） */
function jointSpeakerBefore(text, cut) {
  return jointConnectorStartAt(text, cut) >= 0
}

/**
 * 联合说话人的**处置**：把切点从「B：」左移到整组最前面（「A、B：」里 A 之前）。
 *
 * 为什么不能简单「不切」：那会把复合场景一起吃掉 ——
 *   「…追剧还儿子、王建华：明天还得早起。」（上一句以汉字收尾的真粘连）
 * 里联合组是「儿子、王建华」，一律不切就漏掉一次断开，两行粘成一行。
 * 左移之后两种情况都正确：段首组左移到 0 仍是一行；真粘连组左移到「儿」前正好断开。
 *
 * @returns {number} 新切点；-1 表示该切点作废（连接词左侧不是名字，视为正文里的并列标点）
 */
function resolveJointCut(text, cut, names) {
  let c = cut
  // 反复左移，直到组的最前面 —— 「王建华、杨凤、婆婆：」要连移两级才到位。
  for (let guard = 0; guard < 8; guard++) {
    const jp = jointConnectorStartAt(text, c)
    if (jp < 0) return c // 左侧不是并列连接，切点就定在这里
    // 连接成分左侧要确实是一个已确认的名字，才认这是联合说话人组
    let moved = -1
    for (let len = Math.min(5, jp); len >= 2; len--) {
      const cand = text.slice(jp - len, jp)
      if (names && names[cand]) { moved = jp - len; break }
    }
    // 一级都没移过就找不到名字 → 那个连接成分属正文，切点作废（整格不切）
    if (moved < 0) return guard === 0 ? -1 : c
    c = moved
  }
  return c
}

/** 单元格「单段内」按说话人拆（软换行已由 splitDialogueCell 先拆） */
function splitDialogueCellSingle(text, names) {
  if (!text || String(text).length > 600) return [text]
  // 两种说话人写法都要认：
  //   ① 「名字：」/「名字（动作）：」（m[1]）
  //   ② 「（名字）：」——role.js 把它当正经角色，拆分器也必须认，
  //      否则同一格里用这种写法的人永远拆不开，两个人会被并成一行。
  const re = /([\u4e00-\u9fa5A-Za-z·]{1,5}(?:（[^）]*）)?)[：:]|（([\u4e00-\u9fa5A-Za-z·]{1,5})）[：:]/g
  const cuts = []
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[2] !== undefined) {
      // 形式②：切点在左括号上
      const at = m.index
      const pb = at > 0 ? text[at - 1] : ''
      const okB = !pb || /[^\u4e00-\u9fa5·]/.test(pb)
      // 左边界是汉字时同样只认白名单里的名字（与形式①一致，避免把句中括注当说话人）
      const knownInner = !!(names && names[m[2]])
      // 并列连接后的（名字）：同样是联合说话人（「王建华、（杨凤）：…」）→ 切点左移
      const at2 = resolveJointCut(text, at, names)
      if ((okB || knownInner) && at2 >= 0 && !insideQuote(text, at2) &&
        (!cuts.length || at2 > cuts[cuts.length - 1])) {
        cuts.push(at2)
      }
      continue
    }
    const sp = m[1]
    const spStart = m.index
    const colonAt = m.index + sp.length
    const before = spStart > 0 ? text[spStart - 1] : ''
    // 说话人左边界必须是「非中文/非间隔号」才切分：粘连（前一字为中文，如「我想多了王建华：」）
    // 不能当切分点，否则会把前句内容截断、把真实说话人名字污染成伪说话人。
    const boundaryOk = !before || /[^\u4e00-\u9fa5·]/.test(before)
    // **白名单优先**：正则抓到的候选常常不是真名，而是「正文尾巴 + 真名」粘在一起
    // （「你先吃公公：」「…开销又超了杨凤：」都会被抓成 5 个字）。
    // 只要真名确实在本稿别处当过说话人，就按真名切；白名单里找不到才退回边界规则。
    let cut = matchKnownNameEndingAt(sp, colonAt, names)
    if (cut < 0 && boundaryOk) cut = spStart
    // 联合说话人：把切点左移到整组最前面（找不到就作废），避免留下「王建华、」这样的残词。
    // 必须在 insideQuote 之前做：左移后的位置才是真正的段边界。
    if (cut >= 0) cut = resolveJointCut(text, cut, names)
    // 引号里的「名字：」是引用内容，不是说话人
    if (cut >= 0 && !insideQuote(text, cut) && (!cuts.length || cut > cuts[cuts.length - 1])) cuts.push(cut)
  }
  if (!cuts.length) return [text]
  // 段边界：默认首段从 0 起（这样「切点之前的内容」不会丢，见下方沿革说明），
  // 但如果切点前是一段完整的提示语，则把提示语结束处也补成边界，让它单独成段。
  const leadEnd = leadEndAt(text, cuts[0])
  // 段边界分三种情形：
  //   ① 切点前是一段完整提示语 → 提示语单独成段；落在其内部/末尾的切点要去掉，
  //      否则会把提示语劈成两半（「（环境音：…）」里那个「环境音：」就是这种切点）
  //   ② 切点前只有标点/空白（「……名字：」）→ 贴在首段上，不多出一行
  //   ③ 切点前是「正文尾巴」（「你先吃公公：」）→ 自己单独成段，否则整格会被当一行
  let starts
  if (leadEnd > 0) {
    starts = [0, leadEnd].concat(cuts.filter((c) => c > leadEnd))
  } else if (!hasWordChar(text.slice(0, cuts[0]))) {
    starts = [0].concat(cuts.slice(1))
  } else {
    starts = [0].concat(cuts)
  }
  const out = []
  for (let i = 0; i < starts.length; i++) {
    // 第一段必须从 0 起，不能用 cuts[0]：
    // 切点之前的内容（形如「环境音：…」外面的左括号、或说话人前的提示语）
    // 也是单元格文本的一部分，若从 cuts[0] 切就会被静默丢掉，
    // 表现为括号只剩右半边、或前言整段消失（且各段拼接无法还原原文）。
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : text.length
    const seg = text.slice(start, end).trim()
    if (seg) out.push(seg)
  }
  return out.length ? out : [text]
}


/**
 * 把文档块数组按「拆分规则_v1」切成多集台本。
 * 第0步：有表格→规则A（表格稿）；无表格→规则B（段落稿）。
 * 返回 { ok, message, segments:[{ep, epNo, name, source, lineRange, lineCount, lines}] }
 */
function splitScripts(blocks, opts) {
  if (!blocks || !blocks.length) return { ok: false, message: '文档为空', segments: [] }
  const wukong = !!(opts && opts.mode === 'wukong')
  const tables = blocks.filter((b) => b.type === 'table')
  if (tables.length >= 1) {
    // 为每个表格定位其之前的最后一个非空段落块，作为该集标题（规则A 集标题常写在表格前的段落里）
    const headings = tables.map((tbl) => {
      const ti = blocks.indexOf(tbl)
      for (let k = ti - 1; k >= 0; k--) {
        if (blocks[k].type === 'paragraph' && (blocks[k].text || '').trim()) return (blocks[k].text || '').trim()
      }
      return ''
    })
    return wukong ? splitTableScriptWukong(tables, headings) : splitTableScript(tables, headings)
  }
  return splitParagraphScript(blocks)
}

/**
 * 表格稿结构定位内核（「悟空脚本专属拆分」与「智能多模态拆分」共用）
 * ---------------------------------------------------------------
 * 一次算出两种拆分方式都需要的结构信息，避免两份实现各写一套、改一处漏一处：
 *   - headerIdx   表头行号（含「台词/对白/内容/独白/口播/话术」列名且 ≥2 列的行）
 *   - dialogueCol 台词列下标；表头里找不到台词列名时按列数推断
 *   - roleCol     角色列下标（-1 表示没有）
 *   - title/name  集标题：优先表头前的集信息行，其次表格前的段落
 *   - fromRow     数据起始行；dataRows 数据行数组（表头之前的台词行也会被救回，
 *                 表头行自己绝不进数据 —— 见 headerPreDataStart 的注释）
 * 返回 { ok: false } 表示没找到可识别表头，调用方退回 splitTableLegacy。
 */
function locateTableStructure(rows, headingBefore) {
  let headerIdx = -1
  let headerRow = null
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length >= 2 && row.some(isDialogueHeaderCell)) {
      // 表头之后必须还剩数据行：否则（例如末行内容是「无台词」）
      // 会把内容行当成表头，导致它之前的整篇台词被判定为「表头之前」而丢弃。
      if (r + 1 >= rows.length) continue
      headerIdx = r
      headerRow = row
      break
    }
  }
  if (headerIdx < 0) return { ok: false }

  // 台词列 / 角色列 定位
  let dialogueCol = -1
  let roleCol = -1
  headerRow.forEach((c, idx) => {
    if (isDialogueHeaderCell(c)) dialogueCol = idx
    if (isRoleHeaderCell(c)) roleCol = idx
  })
  if (dialogueCol < 0) {
    const cols = tableColCount(rows)
    if (cols >= 4) dialogueCol = cols - 1
    else if (cols >= 3) dialogueCol = 2
    else dialogueCol = cols - 1
  }

  // 表头前的合并单格 = 集信息行（集标题 / 人物·场景·道具 / 场景）
  const metaRows = rows.slice(0, headerIdx)
  let title = ''
  for (const mr of metaRows) {
    const t = (mr[0] || '').trim()
    if (t && isEpisodeTitleRow(t)) { title = t; break }
  }
  if (!title && headingBefore && !/时间段|【|】|分组|部分/.test(headingBefore)) {
    title = (headingBefore || '').trim()
  }
  const epNo = episodeNoFromTitle(title)
  const meta = metaRows.map((mr) => (mr[0] || '').trim()).filter((t) => t && t !== title)

  // 起点不能再写死「表头 + 1」：表头若出现在表格中部，它前面的台词行会被静默丢弃。
  const fromRow = headerIdx > 0 ? headerPreDataStart(rows, dialogueCol, headerIdx) : headerIdx + 1
  // 表头行自己绝不能进数据：取「表头之前被救回的行」+「表头之后的行」，中间跳过表头。
  const dataRows = (fromRow < headerIdx ? rows.slice(fromRow, headerIdx) : []).concat(rows.slice(headerIdx + 1))

  return { ok: true, headerIdx, headerRow, dialogueCol, roleCol, title, epNo, name: title, meta, fromRow, dataRows }
}

/**
 * 规则 A：表格稿。一个表格=一集。
 * - 集标题：优先表格前段落（headingBefore）；其次表格首行（单行标题）。
 * - 台词列：优先按表头（台词/对白/内容/独白/口播/话术）定位；无表头时按列数推断
 *   （两列取末列、三列取第3列、四列+取末列=「镜号/景别/画面/台词」）。
 * - 含「角色」列时，合并为「角色：台词」，演员既能见台词也见谁说。
 * - 数据首行：有表头行则表头之后；仅标题行(单行)则第2行起；否则按列数兜底。
 */
/**
 * 规则 A：表格稿（拍摄脚本表）。一个表格 = 一集。
 * 结构识别：
 *   - 全表扫描找「真实表头行」（含 台词/对白/内容/独白/口播/话术 列名，且≥2列），表头之前合并单格视为集信息行；
 *   - 集标题：优先集信息行里「像集标题」的单格（排除 时间段/人物/场景/道具/场景 等）；其次表格前段落（不含分组标记）；
 *   - 台词列：表头中 台词 列；无表头则按列数推断（两列取末列、三列取第3列、四列+取末列）；
 *   - 含「角色」列时合并为「角色：台词」；
 *   - 一个台词单元格可能含多轮对白（「A：…B：…」）→ 拆成多行，便于提词器逐句滚动。
 * 找不到可识别表头时退回 splitTableLegacy（兼容无表头旧表格）。
 */
function splitTableScript(tables, headings) {
  const segments = []
  // 全文预扫：先收集「本稿出现过的说话人名」，作为拆分器的已知说话人白名单。
  // 有了它，才敢在「名字被汉字紧贴」时判断该不该切（见 matchKnownNameEndingAt）。
  const knownNames = collectSpeakerNames(tables)
  tables.forEach((tbl, i) => {
    const ep = i + 1
    const rows = tbl.rows || []
    if (!rows.length) return

    // 步骤1~3：结构定位（表头行 / 台词列 / 角色列 / 集标题 / 数据行区间）。
    // 与「悟空脚本专属拆分」共用同一内核 locateTableStructure —— 结构识别永远一致，
    // 两者只在下游「怎么处理数据行」上分叉（多模态做清洗，悟空规则原样复制）。
    const st = locateTableStructure(rows, headings && headings[i])
    if (!st.ok) {
      // P2：多模态启用「按内容评分选台词列」，避免台词列不在末列时整篇丢失
      segments.push(splitTableLegacy(tbl, ep, headings && headings[i], { contentPick: true }))
      return
    }
    const dialogueCol = st.dialogueCol
    const roleCol = st.roleCol
    const epNo = st.epNo
    const name = st.name || (epNo ? '第' + epNo + '集' : '第' + ep + '集')
    const meta = st.meta
    const fromRow = st.fromRow
    const dataRows = st.dataRows

    // 步骤4：数据行抽台词。
    const lines = []
    dataRows.forEach((cells) => {
      let text = ''
      if (roleCol >= 0 && cells[roleCol] != null && String(cells[roleCol]).trim()) {
        const roleName = String(cells[roleCol]).trim()
        const dlg = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
        text = dlg ? roleName + '：' + dlg : roleName
      } else {
        text = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
      }
      if (!text) return
      // 占位行逐行过滤：只丢「（无台词）/（无对白）/—」那一行，
      // 同格里的其他台词必须原样保留（见 isPlaceholderLine 的注释）。
      splitDialogueCell(text, knownNames).forEach((ln) => {
        const s = ln.trim()
        if (!s) return
        if (isPlaceholderLine(s)) return
        lines.push(s)
      })
    })

    segments.push({
      ep: ep,
      epNo: epNo || null,
      name: name,
      meta: meta.length ? meta : undefined,
      source: '表' + ep + ' R' + (fromRow + 1),
      lineRange: '表' + ep + ' R' + (fromRow + 1) + '~R' + rows.length,
      lineCount: lines.length,
      lines: lines
    })
  })
  return { ok: true, message: '按表格拆出 ' + segments.length + ' 集', segments: segments }
}

/**
 * 「悟空脚本专属拆分」：把表格稿的「台词」栏整列复制出来
 * ---------------------------------------------------------------
 * 归纳自人工整理流程「拆分步骤1：把台词栏进行复制得出结果」
 * （样张：最终台词.docx，源稿：建华&小凤的生活81-90.docx）。
 *
 * 复制规则
 *   - 字段映射：只取「台词」列；「镜头」「画面 / 动作」「备注」列与
 *     「人物｜场景｜道具」摘要行一律不进结果（它们不是台词）。
 *   - 行序：严格按表格行序自上而下；一个单元格内部若含多个软换行
 *     （<w:br/>）或多个段落（<w:p>），按出现顺序拆成多行。
 *   - 内容原样：不做任何语义清洗 —— 占位行（（无台词）/（无对白）/ —）
 *     与空行都忠实保留；这是「复制」而不是「提纯」。
 *   - 只折叠**连续**空行（保留 1 行），并去掉整集**末尾**空行；
 *     首部空行保留 —— 它标记「这一行画面没有台词」，是有意义的位置信息。
 *   - 集标题：取表头前的集信息行；缺失时退回表格前段落 / 「第N集」。
 *   - 结果结构：每集一个 segment
 *     { ep, epNo, name, column:'台词', wukong:true, lineCount, lines }
 *     其中 column 只作元数据记录来源列名，不混进台本正文 ——
 *     否则提词器会把「台词」两个字当成台词念出来。
 *
 * 与「智能多模态拆分」的关系：同一内核（locateTableStructure）、同一行序、
 * 同一列映射；唯一分叉是多模态会过滤占位行、悟空规则原样保留。
 */
function splitTableScriptWukong(tables, headings) {
  const segments = []
  tables.forEach((tbl, i) => {
    const ep = i + 1
    const rows = tbl.rows || []
    if (!rows.length) return
    const st = locateTableStructure(rows, headings && headings[i])
    if (!st.ok) {
      // ⚠️ 悟空规则锁定：这里**不要传 { contentPick: true }**。
      // 悟空专属拆分必须保持原有行为（几何推断台词列），只有多模态才用内容评分。
      segments.push(splitTableLegacy(tbl, ep, headings && headings[i]))
      return
    }
    const name = st.name || (st.epNo ? '第' + st.epNo + '集' : '第' + ep + '集')
    const lines = []
    st.dataRows.forEach((cells) => {
      const cell = cells[st.dialogueCol]
      const raw = cell == null ? '' : String(cell)
      // 只去行尾空白（不把源文档的尾随空格带进提词器），行内与行首留白原样保留
      raw.split('\n').forEach((ln) => {
        const s = ln.replace(/[ \t]+$/, '')
        // 连续空行折叠为 1 行；首部空行保留（见上）
        if (!s && lines.length && !lines[lines.length - 1]) return
        lines.push(s)
      })
    })
    // 整集末尾的空行没有信息，去掉（表格尾部常有多余空行）
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    segments.push({
      ep: ep,
      epNo: st.epNo || null,
      name: name,
      meta: st.meta.length ? st.meta : undefined,
      column: '台词',
      wukong: true,
      source: '表' + ep + ' R' + (st.fromRow + 1),
      lineRange: '表' + ep + ' R' + (st.fromRow + 1) + '~R' + rows.length,
      lineCount: lines.length,
      lines: lines
    })
  })
  return { ok: true, message: '按悟空脚本规则拆出 ' + segments.length + ' 集', segments: segments }
}

/**
 * 表格列数推断：取「出现次数最多的列数」（单列合并行不参与统计）。
 *
 * 为什么不能用 rows[0].length / rows[1].length：拍摄脚本表的开头常是
 * 「第85集」「人物：…｜场景：…」这类**单列合并行**，长度恒为 1。
 * 一旦用它代表整表列数，台词列就会被算成第 0 列 → 拆出来的是镜头号/景别，
 * 而真正的台词整篇丢失（零遗漏红线）。
 */
function tableColCount(rows) {
  const stat = {}
  ;(rows || []).forEach((r) => {
    const n = (r || []).length
    if (n <= 1) return // 单列行是标题/合并行，不代表表格真实列数
    stat[n] = (stat[n] || 0) + 1
  })
  let best = 0
  let bestN = 0
  Object.keys(stat).forEach((k) => {
    const n = Number(k)
    if (stat[k] > bestN || (stat[k] === bestN && n > best)) {
      bestN = stat[k]
      best = n
    }
  })
  if (best) return best
  return (rows || []).reduce((m, r) => Math.max(m, (r || []).length), 0)
}

/** 台词列的表头关键词 */
const DLG_HEAD_RE = /台词|对白|内容|独白|口播|话术/

/**
 * 单元格是否「台词列的表头列名」。
 *
 * 必须排除「无台词」「无对白」这类**否定式内容**：它们出现在数据行里，
 * 却同样含有「台词」二字。旧判定会把它们当成表头行，于是
 * 「表头之后才算数据」的规则直接把整篇台词丢光（零遗漏红线）。
 * 同时限制列名长度（列名不会是一整句台词）。
 */
function isDialogueHeaderCell(c) {
  const t = String(c || '').trim()
  if (!t) return false
  if (/无\s*(台词|对白)/.test(t)) return false
  if (/[:：]/.test(t)) return false // 列名不带冒号；带冒号的是台词/内容本身
  if (t.length > 8) return false
  return DLG_HEAD_RE.test(t)
}

/**
 * 单元格是否「角色列的表头列名」。
 *
 * 必须是列名本身（角色 / 角色名 / 人物 / 说话人 / 演员），
 * 不能是「人物：杨凤、王建华」这种**元数据行**。
 * 旧判定用 /人物/ 子串匹配，会把「人物：…」整行当成表头、并把角色列定位到
 * 第 0 列 —— 于是每一行都变成了「镜头号：台词」（推镜：…、切：…），
 * 台词被拼上错误的角色名，文字内容与源数据不再一致。
 */
function isRoleHeaderCell(c) {
  const t = String(c || '').trim()
  if (!t) return false
  if (/[:：]/.test(t)) return false // 含冒号说明这一格有内容，不是列名
  if (t.length > 6) return false
  return /^(角色|角色名|人物|说话人|演员)$/.test(t)
}

/**
 * 一行内容是否「无台词的占位行」。
 *
 * 判定必须**逐行**做，绝不能拿整格文本去测 —— 这是模糊测试抓出来的真缺陷：
 * 旧实现在**整格**上做 `/（无台词）/.test(整格)`，于是一格里只要出现一行
 * 「（无对白）」，同格的另外几句台词会被一起丢掉（3 句连坐消失，零遗漏红线）。
 *
 * 认这些形态：「（无台词）」「（无对白）」「无台词」「无对白」「—」「-」「·」。
 * 不认真的内容：「（无台词，手机屏幕微微照亮她的脸）」这类带说明的，要保留。
 */
/**
 * 【P5 修复】补入分镜表里最常见的占位写法。原实现只认全角括号的中文占位，
 * 于是拍摄脚本表里单独一个「无」（表示这一镜头没台词）会原样进正文，
 * 提词器上就是一行孤零零的「无」。
 * 现在认：`无` / `(无)` / `（无）` / `无台词` / `无对白` / `-` — `·` / `/` / `N/A`。
 *
 * 三条防线：① 整行匹配（带说明的不认）② 长度 ≤ 6（长句里含「无」不是占位）
 * ③ 空行仍不算占位行 —— 空行与占位行在多模态里都过滤、在悟空里都保留，
 *   但它们是两个概念，混同会让「是什么」的判断失准。
 */
function isPlaceholderLine(s) {
  const t = String(s || '').trim()
  if (!t) return false // 空行不是占位行
  if (t.length > 6) return false // 正常台词不可能这么短就结束，「无……」长句不算
  if (t === '无台词' || t === '无对白' || t === '无') return true
  if (/^[（(]无(台词|对白)?[）)]$/.test(t)) return true
  if (/^[-—－–·•]+$/.test(t)) return true
  if (/^\/+$/.test(t)) return true
  if (/^(N\/A|NA)$/i.test(t)) return true
  return false
}

/** 元数据行前缀：人物/场景/道具 这类不是台词，不能据此判定「这里是台词」 */
const META_PREFIX_RE = /^(人物|场景|道具|时间|时间段|镜头|景别|画面|备注|地点|场次|集数|拍摄|时长|音乐|音效|服化|集)\s*[:：]/

/**
 * 单元格内容是否「像一句台词」。
 * 用途：无表头表格里，前导行能不能被跳过 —— **只有确认不是台词才允许跳过**，
 * 绝不能再无条件 slice(2) 吃掉开头两行。
 */
function cellLooksLikeDialogue(s) {
  const t = String(s || '').trim()
  if (!t) return false
  if (META_PREFIX_RE.test(t)) return false
  if (t.length > 200) return true // 超长文本几乎只可能是台词/口播
  if (/^[（(【\[][^）)】\]]{0,12}[）)】\]]\s*[:：]/.test(t)) return true
  if (/^[\u4e00-\u9fa5A-Za-z·]{1,10}(（[^）]*）)?\s*[:：]/.test(t)) return true
  if (t.length >= 8 && /[。！？!?，,、]/.test(t)) return true
  return false
}

/**
 * 无表头表格的数据起始行：从 0 开始，最多跳过 2 行，
 * 一旦某行在台词列上「像台词」就立即停下（该行必须保留）。
 */
function legacyDataStart(rows, dialogueCol) {
  let from = 0
  while (from < 2 && from < rows.length) {
    const cells = rows[from] || []
    const v = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
    if (cellLooksLikeDialogue(v)) break
    from++
  }
  return from
}

/**
 * 有表头表格的数据起始行。
 *
 * 旧规则：无条件从「表头下一行」开始 —— 表头之前的行一律丢弃。
 * 一旦表头出现在表格中部（前面已经写了台词行），那几行台词就被静默吃掉了
 * （实测：表头在第 4 行时，第 3 行整句 102 字台词消失，属零遗漏红线事故）。
 *
 * 改为：从 0 开始逐行判断，**遇到像台词的行就停下（该行必须保留）**，
 * 最多扫到表头所在行为止（表头自己不参与）。
 * 这样「集标题 / 人物：…｜场景：…」这类元信息行仍会被跳过，真台词则被救回。
 */
function headerPreDataStart(rows, dialogueCol, headerIdx) {
  const limit = Math.max(0, Math.min(headerIdx, (rows || []).length))
  for (let i = 0; i < limit; i++) {
    const cells = rows[i] || []
    const v = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
    if (cellLooksLikeDialogue(v)) return i
  }
  return headerIdx + 1
}

/**
 * 【P2 修复】无表头表格的台词列推断：由「按列数硬猜」改为「按内容评分」。
 *
 * 原规则只有一条几何判据：≥4 列取末列、3 列取第 3 列。
 * 它默认台词总在最右边 —— 可一旦表格是「镜号/画面/台词/备注」（台词在倒数第二列，
 * （这是拍摄脚本表最常见的排布），末列是空的备注列，于是**整篇台词丢失
 * 且无任何报错**（实测多模态与悟空两条路径都输出 0 行，属零遗漏红线）。
 *
 * 改为逐列打分：
 *   - 「角色名：台词」式前缀          权重最高（3） —— 有它几乎可以断定是台词列
 *   - 通不过 cellLooksLikeDialogue    不计分
 *   - 整列大量为空（如备注列）        乘 0.3 惩罚
 * 所有列都得 0 分（判断不出）时返回 -1，调用方退回原几何规则 —— 宁可不改也不错改。
 *
 * @param {Array} rows 表格行
 * @returns {number} 列下标；-1 表示无法判定
 */
function pickDialogueColByContent(rows) {
  const cols = tableColCount(rows)
  if (cols < 2) return -1
  const ROLE_PREFIX_RE = /^[\u4e00-\u9fa5A-Za-z·]{1,10}(（[^）]*）)?\s*[:：]/
  const scores = []
  for (let j = 0; j < cols; j++) {
    let total = 0
    let nonEmpty = 0
    let prefixed = 0
    let looks = 0
    ;(rows || []).forEach((r) => {
      const cell = (r || [])[j]
      const v = cell == null ? '' : String(cell).trim()
      total++
      if (!v) return
      nonEmpty++
      if (ROLE_PREFIX_RE.test(v)) prefixed++
      if (cellLooksLikeDialogue(v)) looks++
    })
    let sc = prefixed * 3 + looks
    if (total && nonEmpty / total < 0.4) sc *= 0.3 // 大片空白 → 像备注/备注列
    scores.push(sc)
  }
  let best = -1
  let bestScore = 0
  for (let j = 0; j < cols; j++) {
    if (scores[j] > bestScore) {
      bestScore = scores[j]
      best = j
    }
  }
  return bestScore > 0 ? best : -1
}

/**
 * 旧逻辑兼容：找不到可识别表头（无 台词 列表名）的表格，沿用「首行即标题/表头」推断。
 *
 * @param {Object} tbl       表格块
 * @param {number} ep        集序号
 * @param {string} headingBefore 表格前段落
 * @param {Object} [opts]    { contentPick: true } 启用 P2 的「按内容评分选台词列」。
 *                           仅智能多模态拆分使用；「悟空脚本专属拆分」不传，
 *                           沿用原几何推断 —— 悟空规则必须保持零变化。
 */
function splitTableLegacy(tbl, ep, headingBefore, opts) {
  const rows = tbl.rows || []
  let title = (headingBefore && headingBefore.trim()) || ''
  const firstRow = rows[0] || []
  const firstIsTitle = firstRow.length <= 1 && !/台词|对白|角色|内容|独白|口播|话术|镜头|画面|镜号|景别|时长/.test(firstRow[0] || '')
  if (!title && firstIsTitle) title = (firstRow[0] || '').trim()
  const epNo = episodeNoFromTitle(title)
  const name = title || (epNo ? '第' + epNo + '集' : '第' + ep + '集')
  const headerRow = firstIsTitle ? (rows[1] || []) : firstRow
  const isHeader = headerRow.some((c) => isDialogueHeaderCell(c) || isRoleHeaderCell(c))
  const cols = tableColCount(rows)
  let dialogueCol = -1
  let roleCol = -1
  if (isHeader) {
    headerRow.forEach((c, idx) => {
      if (isDialogueHeaderCell(c)) dialogueCol = idx
      if (isRoleHeaderCell(c)) roleCol = idx
    })
  }
  if (dialogueCol < 0) {
    // P2：多模态走「按内容评分」，悟空保持下面的几何推断（不传 opts）
    if (opts && opts.contentPick) {
      const picked = pickDialogueColByContent(rows)
      if (picked >= 0) dialogueCol = picked
    }
    if (dialogueCol < 0) {
      if (cols >= 4) dialogueCol = cols - 1
      else if (cols >= 3) dialogueCol = 2
      else dialogueCol = cols - 1
    }
  }
  // 前导行能不能跳：无表头时**不能**再无条件 slice(2) ——
  // 那会静默吃掉开头的台词（零遗漏红线）。改为逐行判断，像台词就立即停下。
  const from = isHeader ? (firstIsTitle ? 2 : 1) : legacyDataStart(rows, dialogueCol)
  const dataRows = rows.slice(from)
  const lines = []
  dataRows.forEach((cells) => {
    let text = ''
    if (roleCol >= 0 && cells[roleCol] != null && String(cells[roleCol]).trim()) {
      const roleName = String(cells[roleCol]).trim()
      const dlg = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
      text = dlg ? roleName + '：' + dlg : roleName
    } else {
      text = cells[dialogueCol] != null ? String(cells[dialogueCol]).trim() : ''
    }
    if (!text) return
    // 与有表头路径保持一致：先按说话人拆，再按软换行拆。
    // 旧实现只按 \n 拆，导致无表头表格里「A：… B：…」两个人的台词挤在同一行，
    // 显示时整行归给第一个人 → 人物错配（实测 7 个样本 200 条）。
    // 占位行同样**逐行**过滤（整格过滤会连坐丢掉同格台词）。
    splitDialogueCell(text).forEach((chunk) => {
      String(chunk).split(/\n+/).forEach((ln) => {
        const s = ln.trim()
        if (!s) return
        if (isPlaceholderLine(s)) return
        lines.push(s)
      })
    })
  })
  return {
    ep: ep,
    epNo: epNo || null,
    name: name,
    source: '表' + ep + ' R0',
    lineRange: '表' + ep + ' R' + (from + 1) + '~R' + rows.length,
    lineCount: lines.length,
    lines: lines
  }
}


/** 规则 B：段落稿。靠「系列名+数字」标题行切集；0 命中则整篇当 1 集。 */
function splitParagraphScript(blocks) {
  const lines = []
  blocks.forEach((b) => {
    if (b.type === 'paragraph') String(b.text || '').split('\n').forEach((ln) => lines.push(ln))
  })
  const text = lines.join('\n')
  const seriesName = extractSeriesName(lines)
  let idxs = seriesName ? findSeriesBoundaries(lines, seriesName) : []
  if (idxs.length === 0) idxs = findHeadingBoundaries(lines)
  if (idxs.length === 0) {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: '文档里没有可导入的文字', segments: [] }
    return {
      ok: true,
      message: '未识别到分集信号，整篇作为 1 集',
      segments: [{ ep: 1, epNo: null, name: autoName(trimmed), source: '全篇', lineRange: '全篇', lineCount: lines.length, lines: lines.map((l) => l.trim()).filter(Boolean) }]
    }
  }
  const parts = sliceByBoundaries(lines, idxs)
  const segments = parts.map((p, i) => ({
    ep: i + 1,
    epNo: episodeNoFromTitle(p.title),
    name: p.title,
    source: '段' + (i + 1),
    lineRange: '段' + (i + 1),
    lineCount: (p.content.match(/\n/g) || []).length + 1,
    lines: p.content.split('\n').map((l) => l.trim()).filter(Boolean)
  }))
  return { ok: true, message: '按标题拆出 ' + segments.length + ' 集', segments: segments }
}

module.exports = {
  genId,
  formatTime,
  fromNow,
  debounce,
  clamp,
  copyText,
  toast,
  extractDocxText,
  extractDocxBlocks,
  blocksToText,
  splitScripts,
  splitTableScriptWukong,
  locateTableStructure,
  splitDialogueCell,
  splitDialogueCellSingle,
  collectSpeakerNames,
  insideQuote,
  leadEndAt,
  jointSpeakerBefore,
  jointConnectorStartAt,
  resolveJointCut,
  tableColCount,
  isDialogueHeaderCell,
  isRoleHeaderCell,
  cellLooksLikeDialogue,
  isPlaceholderLine,
  normalizeCornerQuote,
  pickDialogueColByContent,
  legacyDataStart,
  headerPreDataStart,
  decodeXmlEntities,
  autoTitleFromText,
  splitImportBlocks,
  smartSplitScripts,
  // 台本标题命名规则（见文件内「命名规则」注释块）
  autoName,
  titleLineKind,
  TITLE_MAX_LEN,
  AUTO_TITLE_LEN,
  PLACEHOLDER_TITLE,
  // 按集顺序切换 / 排序（第N集 → 第N+1集 连续推进）
  parseEpisodeNo,
  sortByEpisode,
  getNextEpisodeScript,
  getPrevEpisodeScript
}
