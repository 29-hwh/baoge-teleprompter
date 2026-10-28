/**
 * 稿源格式兼容矩阵
 * ============================================================================
 * 用户报的是「台词导入进去，页面没有台词」。
 * 根因之一是 WXML 循环变量没声明（已修，见 wxml_template.test.js）。
 * 但还有另一半没验：**不同来源的稿子，解析出来到底有没有字**。
 *
 * 这里把宝哥真实会遇到的所有稿源各造一份，走完整链路
 * （store.create → 提词页 onLoad/onReady → data.lines），
 * 逐条检查「行数 > 0」且「每行 body 有可显示字符」。
 *
 * 判定铁律：只要出现 lines=0 或 body 全空，就是又一处「导进去没字」。
 */
'use strict'

let T = 1780000000000
const timers = []
let seq = 1
global.setTimeout = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = seq++; timers.push({ id, fireAt: T + (ms || 0), fn }); return id }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T

const mem = {}
const WIN = { windowWidth: 375, windowHeight: 812, statusBarHeight: 44, pixelRatio: 3 }
global.wx = {
  getWindowInfo: () => Object.assign({}, WIN),
  getSystemInfoSync: () => Object.assign({}, WIN),
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v },
  setKeepScreenOn() {}, setScreenBrightness() {}, setPageOrientation() {},
  navigateTo() {}, navigateBack() {}, showModal() {}, showToast() {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: {} }) },
  getRecorderManager: () => ({ start() {}, stop() {}, onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {} }),
  createSelectorQuery: () => {
    const q = {
      _sel: [], _rectCbs: [],
      in() { return q },
      select(s) { q._sel.push(s); return q },
      boundingClientRect(cb) { if (cb) q._rectCbs.push(cb); return q },
      exec(cb) { q._rectCbs.forEach((fn) => fn(null)); if (cb) cb(q._sel.map(() => null)) }
    }
    return q
  }
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = {
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p) }
}
global.getApp = () => appMock

let pageDef = null
global.Page = (d) => { pageDef = d }
const store = require('./miniprogram/engine/store.js')
require('./miniprogram/pages/teleprompter/teleprompter.js')

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (p) { if (p && typeof p === 'object') Object.assign(this.data, p) }
  return inst
}

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n      ' + detail : '')) }
}

/** 把一份稿子跑完整链路，返回提词页实例 */
function run(name, content) {
  for (const k of Object.keys(mem)) delete mem[k]
  mem['baoge_guide_tp'] = 1
  T += 1000
  const s = store.create(name, content)
  store.save(s)
  const p = makePage()
  p.onLoad({ id: s.id })
  p.onReady()
  return p
}

/** 一行是否「有可显示的字符」：去掉空白/零宽/控制字符后仍有内容 */
function visible(s) {
  return String(s == null ? '' : s)
    .replace(/[\s\u200b\u200c\u200d\ufeff\u00a0]/g, '')
    .length > 0
}

const CASES = [
  {
    key: '纯文本口播稿（无角色）',
    text: [
      '大家好，今天我们来聊一个很多人都踩过的坑。',
      '买保险的时候，第一件事不是看保额，而是看免责条款。',
      '因为理赔的时候，决定赔不赔的就是那几行小字。'
    ].join('\n')
  },
  {
    key: '中文冒号角色（林晚：）',
    role: '林晚',
    text: ['林晚：你到底还回不回来？', '陈默：姐，我在楼下。', '林晚：那你上来啊。'].join('\n')
  },
  {
    key: '英文冒号角色（林晚:）',
    role: '林晚',
    text: ['林晚: 你到底还回不回来？', '陈默: 姐，我在楼下。'].join('\n')
  },
  {
    key: '方括号角色（【林晚】）',
    role: '林晚',
    text: ['【林晚】你到底还回不回来？', '【陈默】姐，我在楼下。'].join('\n')
  },
  {
    key: '方头括号角色（［林晚］全角）',
    role: '林晚',
    text: ['［林晚］你到底还回不回来？', '［陈默］姐，我在楼下。'].join('\n')
  },
  {
    key: '场景标题 + 空行（短剧标准格式）',
    role: '林晚',
    text: [
      '第一场 办公室 日',
      '',
      '林晚：小陈，这份报表今天必须发出去。',
      '陈默：姐，财务还差一组数。',
      '',
      '第二场 楼道 夜',
      '',
      '陈默：我上来了。'
    ].join('\n')
  },
  {
    key: '带集数标记（拆分导入产物）',
    role: '林晚',
    text: [
      '第1集',
      '',
      '林晚：这是第一集的台词内容。',
      '陈默：收到。',
      '',
      '第2集',
      '',
      '林晚：这是第二集的台词内容。'
    ].join('\n')
  },
  {
    key: 'Windows 换行（CRLF，WPS/Word 导出常见）',
    role: '林晚',
    text: ['林晚：第一句。', '陈默：第二句。', '林晚：第三句。'].join('\r\n')
  },
  {
    key: '带 UTF-8 BOM（记事本另存常见）',
    role: '林晚',
    text: '\ufeff' + ['林晚：第一句。', '陈默：第二句。'].join('\n')
  },
  {
    key: '全角空格缩进（中文排版习惯）',
    role: '林晚',
    text: ['　　林晚：第一句。', '　　陈默：第二句。'].join('\n')
  },
  {
    key: '单行超长（整篇没换行，纯口播粘贴）',
    text: '大家好今天我们来聊一个很多人都踩过的坑买保险的时候第一件事不是看保额而是看免责条款因为理赔的时候决定赔不赔的就是那几行小字'
  },
  {
    key: 'Markdown 格式（从笔记软件复制）',
    text: [
      '# 开场',
      '',
      '- 第一句话，带列表符号',
      '- 第二句话，**加粗过**',
      '',
      '## 正文',
      '',
      '普通段落，没有任何标记。'
    ].join('\n')
  },
  {
    key: '每段之间空一行（docx 转换常见）',
    role: '林晚',
    text: [
      '林晚：第一句。',
      '',
      '陈默：第二句。',
      '',
      '林晚：第三句。'
    ].join('\n')
  },
  {
    key: '全角标点 + 引号包裹台词',
    role: '林晚',
    text: ['林晚：“你到底还回不回来？”', '陈默：“姐，我在楼下。”'].join('\n')
  }
]

console.log('\n══════ 稿源格式兼容矩阵（14 种） ══════')
console.log('判定：lines > 0 且 每一行都有可显示字符\n')

/* ── 判定口径 ──
 * 「空行」是合法设计：短剧/docx 稿子段落之间本来就有空行，渲染成一行空白做视觉间隔，
 * 与浅纸一致。所以不能要求「每行都有字」，而要保证：
 *     ① 至少渲染出内容（rendered > 0）
 *     ② 原稿里的非空行，一个字都没丢（rendered ≥ 原稿非空行数）
 * 断行只会把一行拆成多行，绝不会让可显示行数变少，所以 ② 是严格的。
 *
 * 带 role 的用例额外验两件事：
 *     ③ 角色标记被识别（有行 role === 期望名）
 *     ④ 正文里不残留原始标记（否则会把「林晚」念出来）
 */
for (const c of CASES) {
  const p = run(c.key, c.text)
  const lines = p.data.lines || []
  const rendered = lines.filter((l) => visible(l.body || l.text)).length
  const srcNonEmpty = c.text
    .replace(/[\ufeff\u200b]/g, '')
    .split(/\r?\n/)
    .filter((l) => visible(l)).length

  ok(
    c.key,
    rendered > 0 && rendered >= srcNonEmpty,
    `lines=${lines.length}，可显示=${rendered}，原稿非空行=${srcNonEmpty}` +
      (rendered < srcNonEmpty ? `\n      丢了 ${srcNonEmpty - rendered} 行` : '')
  )

  if (c.role) {
    const got = lines.filter((l) => l.role === c.role)
    ok(`  └ 角色「${c.role}」被识别`, got.length > 0,
      `识别到的角色：${JSON.stringify([...new Set(lines.filter((l) => l.role).map((l) => l.role))])}`)
    const bodyText = lines.map((l) => l.body || l.text).join('')
    ok(`  └ 正文不残留角色标记`, bodyText.indexOf(c.role + '：') < 0 &&
      bodyText.indexOf(c.role + ':') < 0 && bodyText.indexOf('【' + c.role + '】') < 0 &&
      bodyText.indexOf('［' + c.role + '］') < 0,
      `正文前 40 字：${JSON.stringify(bodyText.slice(0, 40))}`)
  }
}

/* ── 额外：极端输入不能崩 ── */
console.log('\n══════ 极端输入（不能崩，要么有字要么体面空） ══════')
const EDGE = [
  ['空字符串', ''],
  ['只有空白字符', '   \n\n  \t \n'],
  ['只有换行', '\n\n\n\n'],
  ['单个字', '啊'],
  ['超长单字无标点', '啊'.repeat(8000)]
]
for (const [name, text] of EDGE) {
  let lines = null
  let err = null
  try {
    const p = run(name, text)
    lines = (p.data.lines || []).length
  } catch (e) {
    err = e
  }
  ok(`${name}：不抛异常`, !err, err ? String(err && err.message) : '')
  if (!err) {
    ok(`${name}：行数有限（≤ 3000）`, lines <= 3000, `lines=${lines}`)
  }
}

/* ── 超长稿守卫：> 1200 行必须降级，否则 setData 过桥超 1MB 白屏 ── */
console.log('\n══════ 超长稿守卫（整季剧本场景） ══════')

function longScript(n) {
  return Array.from({ length: n }, (_, i) => `林晚：这是第 ${i + 1} 句台词，长度为二十来个字左右。`).join('\n')
}

{
  // 正常稿：不降级
  const p = run('正常长度', longScript(300))
  ok('300 行：不降级（保持逐行渲染，保留角色高亮）',
    p.data.blobMode === false && p.data.lines.length > 100,
    `blobMode=${p.data.blobMode}，lines=${p.data.lines.length}`)
}

{
  // 阈值看的是「视觉行」（断行后的 displayLines），不是原稿行数。
  // 一句 24 字在 375 宽 / 45px 字号下会断成约 4 个视觉行，所以要按视觉行反推。
  const p1 = run('约 1000 视觉行', longScript(250))
  const visual1 = p1.data.blobMode ? null : p1.data.lines.length
  ok('约 1000 视觉行：不降级（仍逐行渲染、保留角色高亮）',
    p1.data.blobMode === false,
    `原稿 250 行 → 视觉行 ${visual1}，blobMode=${p1.data.blobMode}`)

  const p2 = run('约 1600 视觉行', longScript(400))
  ok('约 1600 视觉行：已降级', p2.data.blobMode === true, `blobMode=${p2.data.blobMode}`)
}

{
  // 整季剧本：3000 行 → 必须降级
  const p = run('整季剧本', longScript(3000))
  ok('3000 行：已降级为纯文本块', p.data.blobMode === true && p.data.lines.length === 1, '')
  ok('3000 行：块内是完整原文（一字不丢）',
    String(p.data.lines[0].body).indexOf('这是第 3000 句台词') >= 0 &&
      String(p.data.lines[0].body).indexOf('这是第 1 句台词') >= 0,
    `body 长度=${String(p.data.lines[0].body).length}`)
  ok('3000 行：setData 体积仍很小（< 400KB）',
    Buffer.byteLength(JSON.stringify(p.data.lines), 'utf8') < 400 * 1024,
    `实测 ${(Buffer.byteLength(JSON.stringify(p.data.lines), 'utf8') / 1024).toFixed(0)}KB（逐行渲染会是 1.0MB）`)
  ok('3000 行：总高为合理正数（能正常滚动）',
    p.data.textHeight > 100000 && p.data.totalScroll > 0,
    `textHeight=${p.data.textHeight}，totalScroll=${p.data.totalScroll}`)
  ok('3000 行：不出角色胶囊（降级后无角色高亮）',
    p.data.lines.every((l) => !l.showRole), '')
}

{
  // 极端：10000 行也不能崩
  let err = null
  let p = null
  try {
    p = run('万字长篇', longScript(10000))
  } catch (e) {
    err = e
  }
  ok('10000 行：不抛异常', !err, err ? String(err && err.message) : '')
  if (p) {
    ok('10000 行：已降级且能看到末尾内容',
      p.data.blobMode === true && String(p.data.lines[0].body).indexOf('这是第 10000 句') >= 0, '')
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)