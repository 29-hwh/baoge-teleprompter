/**
 * 台词表格处理 —— 大规模随机样本端到端验证
 *
 * 用法：
 *   node gen_table_cases.js [组数=64] [种子=20260919]   # 生成样本 cases.json
 *   python3 build_case_docx.py                          # 构建真实 .docx
 *   node e2e_table_verify.js                            # 端到端验证（读 cases.json）
 * 依赖：先跑 `node gen_table_cases.js` 与 `python3 build_case_docx.py`
 *
 * 链路（与线上一致，仅 wx.unzip 用 python 解压替代，其余全为产品代码）：
 *   testcases/docx/CXXX.docx
 *     →(解压)→ word/document.xml
 *     → util.extractDocxBlocks
 *     → util.splitScripts（智能拆分）
 *     → store 落库（真实存储模块）
 *     → 真实页面模块 pages/teleprompter/teleprompter.js 的 onLoad/onReady 生命周期
 *     → allLines / displayLines / visibleLines（真实渲染数据）
 *
 * 四项验证（按用户给定优先级）：
 *   V1 台词零遗漏 —— 逐条比对条数、顺序、内容，输出缺失明细
 *   V2 智能拆分无误 —— 不重复、不乱序、切点落在标点后（不截断语义）
 *   V3 人物识别准确 —— 不错配、漏配，不误把舞台提示判成角色
 *   V4 显示正确 —— 无乱码、无截断、换行合规、显示层与源字符级一致、滚动可达全部
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const PY = '/Users/huweihua/.workbuddy/binaries/python/versions/3.13.12/bin/python3'
const HERE = __dirname

// ================= 微信运行时 mock（复用项目既有范式） =================
let T = 1780000000000
const rafCbs = []
const timers = []
let timerSeq = 1
global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length }
global.cancelAnimationFrame = () => {}
global.setTimeout = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: 0 }); return id }
global.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.setInterval = (fn, ms) => { const id = timerSeq++; timers.push({ id, fireAt: T + (ms || 0), fn, interval: ms || 1 }); return id }
global.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
global.Date.now = () => T
function stepFrames(n) {
  for (let f = 0; f < n; f++) {
    T += 16
    for (const t of timers.slice()) {
      if (t.fireAt <= T) { t.fn(); if (t.interval) t.fireAt = T + t.interval; else { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } }
    }
    const cbs = rafCbs.splice(0, rafCbs.length)
    for (const cb of cbs) cb(T)
  }
}
const memStorage = {}
global.wx = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47, pixelRatio: 3 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  removeStorageSync: (k) => { delete memStorage[k] },
  setKeepScreenOn: () => {}, setScreenBrightness: () => {}, setPageOrientation: () => {},
  navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, showToast: () => {},
  showModal: (o) => { if (o && typeof o.success === 'function') o.success({ confirm: true }) },
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} }),
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }), exec: () => {} })
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const util = require('./miniprogram/utils/util.js')
const roleEngine = require('./miniprogram/engine/role.js')
const parser = require('./miniprogram/engine/parser.js')
const store = require('./miniprogram/engine/store.js')
const appMock = { globalData: { prefs: prefsEngine.load(), currentScript: null }, updatePrefs(p) { this.globalData.prefs = prefsEngine.patch(p); return this.globalData.prefs } }
global.getApp = () => appMock
let pageDef = null
global.Page = (def) => { pageDef = def }
require('./miniprogram/pages/teleprompter/teleprompter.js')

function makePage() {
  const p = Object.assign({ data: {} }, pageDef)
  p.setData = function (patch) { Object.assign(this.data, patch) }
  return p
}

// ================= 工具 =================
const squash = (s) => String(s == null ? '' : s).replace(/\s/g, '')
function countOcc(hay, needle) {
  if (!needle) return 0
  let n = 0, i = hay.indexOf(needle)
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length) }
  return n
}
const SENT_END = /[。！？!?…；;]$/

// ================= 结果收集 =================
const R = {
  cases: 0, gtUnits: 0,
  v1: { miss: [], dup: [], disorder: [] },
  v2: { dupFrag: [], badCut: [], overflow: [] },
  v3: { lost: [], wrong: [], stageAsRole: [], adherentSkipped: 0, checked: 0 },
  v4: { garble: [], truncated: [], newline: [], contentMismatch: [], unreachable: [] }
}
const LIMIT = 12 // 每类最多打印的明细条数
function push(bucket, item) { if (bucket.length < 200) bucket.push(item) }

// ================= 主流程 =================
function main() {
  // 注意：本脚本只读 testcases/cases.json，不负责生成样本。
  // 要换种子请先跑 `node gen_table_cases.js <组数> <种子>` 再跑 `python3 build_case_docx.py`。
  const casesPath = path.join(HERE, 'testcases', 'cases.json')
  if (!fs.existsSync(casesPath)) { console.error('缺少 testcases/cases.json，请先运行 gen_table_cases.js'); process.exit(1) }
  const data = JSON.parse(fs.readFileSync(casesPath, 'utf8'))
  console.log('样本种子：' + data.seed + '   组数：' + data.count)

  for (const c of data.cases) {
    verifyCase(c)
  }
  report()
}

function verifyCase(c) {
  R.cases++
  const docxPath = path.join(HERE, 'testcases', 'docx', c.id + '.docx')
  if (!fs.existsSync(docxPath)) { push(R.v1.miss, { id: c.id, why: 'docx 缺失' }); return }

  // ---- 真实 .docx 解压（替代 wx.getFileSystemManager().unzip） ----
  let xml
  try {
    xml = execFileSync(PY, ['-c',
      'import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))',
      docxPath], { maxBuffer: 64 * 1024 * 1024 }).toString()
  } catch (e) { push(R.v1.miss, { id: c.id, why: '解压失败: ' + e.message }); return }

  // ---- 智能拆分 ----
  const blocks = util.extractDocxBlocks(xml)
  const res = util.splitScripts(blocks)
  const segs = (res && res.segments) || []
  if (!segs.length) {
    // 整篇没拆出东西 = 最严重的零遗漏事故
    const gtAll = []
    c.tables.forEach((t) => t.gt.forEach((g) => g.units.forEach((u) => gtAll.push(u.text))))
    push(R.v1.miss, { id: c.id, scenario: c.scenario, why: '整篇未拆出任何集', gtCount: gtAll.length, sample: squash(gtAll[0] || '').slice(0, 40) })
    return
  }

  // ---- 落库（真实存储模块） ----
  const saved = segs.map((s) => {
    const sc = store.create(s.name || (c.id + '-' + s.epNo), (s.lines || []).join('\n'))
    store.save(sc)
    return sc
  })

  // ---- Ground Truth 扁平化（按源顺序） ----
  const gt = []
  c.tables.forEach((t, ti) => {
    t.gt.forEach((g) => {
      if (g.units.length === 0) {
        // 舞台提示 / 无台词标记：记录为「不应产生角色」的单元
        gt.push({ text: g.cell, speaker: null, isStage: !!g.isStage, noDialogue: !!g.noDialogue, ti: ti, row: g.rowIdx })
      } else {
        g.units.forEach((u) => gt.push({
          text: u.text, speaker: u.speaker, adherent: !!u.adherent,
          isStage: false, noDialogue: false, ti: ti, row: g.rowIdx
        }))
      }
    })
  })
  R.gtUnits += gt.filter((g) => g.speaker).length

  // ---- 落库全文（用于零遗漏/顺序/内容比对） ----
  const storedAll = saved.map((s) => s.content).join('\n')
  const Q = squash(storedAll)

  // ---------- V1 台词零遗漏：逐条命中 / 条数 / 顺序 ----------
  // 期望出现次数 = 该文本在【源台词全文】里的出现次数。
  // 两层坑都在这里：
  //   ① 语料池有限，同一句台词会天然重复出现在不同单元 → 不能硬编码「必须只出现 1 次」；
  //   ② 短句可能被包在另一条长台词里（子串碰撞）→ 只能数「单元条数」，
  //      要按「源全文中出现几次」来算，否则把生成器的语料重复报成代码的重复片段缺陷。
  const SEP = '\u0001'
  const srcQ = gt.filter((g) => g.speaker).map((g) => squash(g.text)).join(SEP)
  const expectCount = {}
  gt.forEach((g) => {
    if (!g.speaker) return
    const q = squash(g.text)
    if (expectCount[q] === undefined) expectCount[q] = countOcc(srcQ, q)
  })

  let cursor = 0
  const spans = []
  gt.forEach((g) => {
    if (!g.speaker) return // 舞台提示不参与零遗漏（不是台词）
    const q = squash(g.text)
    R.gtUnits += 0
    let pos = q ? Q.indexOf(q, cursor) : 0
    if (pos < 0) {
      // 放宽：全局再找一次（顺序错乱时也能定位）
      pos = q ? Q.indexOf(q) : 0
      if (pos < 0) {
        push(R.v1.miss, {
          id: c.id, scenario: c.scenario, row: g.row, table: g.ti,
          input: g.text.slice(0, 60), expect: '完整出现在结果中', actual: '未找到'
        })
        return
      }
      push(R.v1.disorder, { id: c.id, scenario: c.scenario, row: g.row, input: g.text.slice(0, 40), expect: '顺序不早于前一条', actual: '出现位置早于前一条（乱序）' })
    }
    const occ = countOcc(Q, q)
    const exp = expectCount[q] || 0
    if (occ > exp) push(R.v1.dup, { id: c.id, scenario: c.scenario, row: g.row, input: g.text.slice(0, 40), expect: '出现 ' + exp + ' 次（与源一致）', actual: '出现 ' + occ + ' 次（重复片段）' })
    spans.push({ g: g, from: pos, to: pos + q.length })
    cursor = pos + q.length
  })

  // ---------- 逐集：真实页面生命周期 → 显示层 ----------
  const epOffsets = []
  let accOff = 0
  saved.forEach((sc) => { epOffsets.push(accOff); accOff += squash(sc.content || '').length })

  saved.forEach((sc, si) => {
    const p = makePage()
    try { p.onLoad({ id: sc.id }); p.onReady(); stepFrames(3) } catch (e) {
      push(R.v4.garble, { id: c.id, ep: si, input: '页面 onLoad', actual: '抛错: ' + e.message })
      return
    }
    const all = p.allLines || []
    const disp = p.displayLines || []
    const vis = p.data.visibleLines || []
    const cpl = p.charsPerLine || 0

    // ---- 内容行 → 分段（section）映射：用于 V2 切点检查 ----
    const contentLines = String(sc.content || '').split('\n')
    const groups = []
    all.forEach((l) => {
      if (l.isSpacer) { groups.push({ spacer: true, text: '' }); return }
      const gi = l.sectionIndex
      if (gi == null) return
      if (!groups[gi]) groups[gi] = { spacer: false, text: '' }
      groups[gi].text += (l.text || '')
    })

    // ---- V2 智能拆分：不重复 / 不乱序 / 切点落在标点后 ----
    let ci = 0
    let acc = ''
    const secsOfLine = []
    groups.forEach((g) => {
      if (g.spacer) return
      const gt2 = squash(g.text)
      if (!gt2) return
      acc += gt2
      secsOfLine.push(g.text)
      const q = squash(contentLines[ci] || '')
      if (q && acc.length >= q.length) {
        if (acc.length > q.length) {
          push(R.v2.overflow, { id: c.id, ep: si, input: (contentLines[ci] || '').slice(0, 40), expect: '分段合计 = 原文', actual: '分段合计超出原文 ' + (acc.length - q.length) + ' 字（重复/乱序）' })
        }
        // 该内容行被切成多段 → 检查切点
        if (secsOfLine.length > 1) {
          secsOfLine.forEach((s, k) => {
            if (k === secsOfLine.length - 1) return
            if (!SENT_END.test(String(s).trim())) {
              push(R.v2.badCut, { id: c.id, ep: si, input: (contentLines[ci] || '').slice(0, 44), expect: '切点落在句末标点后', actual: '第' + (k + 1) + '段结尾「' + String(s).slice(-6) + '」非句末标点（语义被截断）' })
            }
          })
        }
        ci++
        acc = ''
        secsOfLine.length = 0
      }
    })
    // 相邻重复片段：只有当**源数据里没有这段重复**时才算缺陷
    // （源里本来就写了两句一模一样的台词，显示两行相同是正确的）
    const sqContent = squash(sc.content || '')
    for (let i = 1; i < disp.length; i++) {
      const a = squash(disp[i - 1].text), b = squash(disp[i].text)
      if (!a || a !== b) continue
      if (sqContent.indexOf(a + a) >= 0) continue
      push(R.v2.dupFrag, { id: c.id, ep: si, input: a.slice(0, 30), expect: '不产生重复片段', actual: '相邻两行完全相同，且源数据无此重复' })
    }

    // ---- V4 显示正确：乱码 / 截断 / 换行 / 显示层一致性 ----
    const joinedDisp = squash(disp.map((l) => l.text || '').join(''))
    const joinedSrc = squash(contentLines.join(''))
    if (joinedDisp !== joinedSrc) {
      push(R.v4.contentMismatch, {
        id: c.id, ep: si,
        input: '源 ' + joinedSrc.length + ' 字',
        expect: '显示层拼接与源字符级一致',
        actual: '显示层 ' + joinedDisp.length + ' 字，差 ' + (joinedDisp.length - joinedSrc.length)
      })
    }
    disp.forEach((l, li) => {
      const t = l.text || ''
      if (/[\uFFFD]/.test(t) || /&(amp|lt|gt|quot|#\d+);/.test(t) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) {
        push(R.v4.garble, { id: c.id, ep: si, input: t.slice(0, 40), expect: '无乱码', actual: '含乱码/未解码实体/控制字符' })
      }
      if (/\n/.test(t)) push(R.v4.newline, { id: c.id, ep: si, input: t.slice(0, 30), expect: '单行不含换行', actual: '行内含 \\n' })
      if (cpl && squash(t).length > cpl + 3) {
        push(R.v4.truncated, { id: c.id, ep: si, input: t.slice(0, 30), expect: '≤每行字数 ' + cpl + '(+3 标点溢出)', actual: squash(t).length + ' 字' })
      }
    })
    // 滚动可达：contentHeight 覆盖全部行
    if (disp.length && p.contentHeight != null) {
      const lh = p.lineHeightPx || 1
      if (p.contentHeight < disp.length * lh - 1) {
        push(R.v4.unreachable, { id: c.id, ep: si, input: disp.length + ' 行', expect: 'contentHeight ≥ 行数×行高', actual: p.contentHeight + ' < ' + disp.length * lh })
      }
    }
    // visibleLines 必须是 displayLines 的连续窗口（不是抽样丢弃）
    if (vis.length && disp.length > vis.length) {
      // 比对必须用「角色前缀 + 正文」拼接后的完整文本：
      // vis[0].body 不含角色前缀，拿它和含前缀的 l.text 做前缀匹配会永远失败。
      const first = squash((vis[0].rolePrefix || '') + (vis[0].body != null ? vis[0].body : vis[0].text || ''))
      const hit = first ? disp.some((l) => squash(l.text || '') === first) : true
      if (!hit) {
        push(R.v4.unreachable, { id: c.id, ep: si, input: '首屏首行', expect: 'visibleLines 是 displayLines 连续窗口', actual: '首屏首行不在 displayLines 中：' + first.slice(0, 24) })
      }
    }

    // ---- V3 人物识别：把显示行映射回 GT 单元 ----
    let lineCursor = epOffsets[si] || 0
    all.forEach((l) => {
      if (l.isSpacer) return
      const q = squash(l.text || '')
      if (!q) return
      // 顺序游标定位：显示行是内容的连续切片，必须按顺序推进。
      // 用全局 indexOf 会在「重复语料」时命中前面那条同文本的行 → 归属判到错的说话人。
      const lpos = Q.indexOf(q, lineCursor)
      if (lpos < 0) return
      lineCursor = lpos + q.length
      let owner = null
      for (const sp of spans) {
        if (lpos >= sp.from && lpos < sp.to) { owner = sp.g; break }
      }
      if (!owner) return
      if (!owner.speaker) {
        if (owner.isStage || owner.noDialogue) {
          if (l.role) push(R.v3.stageAsRole, { id: c.id, ep: si, input: owner.text.slice(0, 40), expect: '舞台提示/无台词不应有角色', actual: '被判为角色「' + l.role + '」' })
        }
        return
      }
      if (owner.adherent) { R.v3.adherentSkipped++; return } // 粘连：代码按设计不拆，不计错配
      R.v3.checked++
      const r = l.role
      if (!r) {
        push(R.v3.lost, { id: c.id, ep: si, input: owner.text.slice(0, 40), expect: '角色=' + owner.speaker, actual: '无角色（漏配）' })
      } else if (r !== owner.speaker) {
        const ok = String(r).indexOf(owner.speaker) === 0 || owner.speaker.indexOf(String(r)) === 0
        if (!ok) push(R.v3.wrong, { id: c.id, ep: si, input: owner.text.slice(0, 40), expect: '角色=' + owner.speaker, actual: '角色=' + r + '（错配）' })
      }
    })
  })
}

// ================= 报告 =================
function show(title, bucket, cols) {
  console.log('\n──── ' + title + ' ────')
  if (!bucket.length) { console.log('  ✅ 0 项（全部通过）'); return }
  console.log('  🔴 ' + bucket.length + ' 项，示例（最多 ' + LIMIT + '）：')
  bucket.slice(0, LIMIT).forEach((b, i) => {
    console.log('   [' + (i + 1) + '] 样本 ' + (b.id || '?') + (b.ep != null ? ' 第' + (b.ep + 1) + '集' : '') + (b.scenario ? ' (' + b.scenario + ')' : '') + (b.row != null ? ' 行' + b.row : ''))
    if (b.input !== undefined) console.log('       输入原文：' + String(b.input))
    console.log('       期望输出：' + b.expect)
    console.log('       实际输出：' + b.actual)
  })
}

function report() {
  const total = R.v1.miss.length + R.v1.dup.length + R.v1.disorder.length +
    R.v2.dupFrag.length + R.v2.badCut.length + R.v2.overflow.length +
    R.v3.lost.length + R.v3.wrong.length + R.v3.stageAsRole.length +
    R.v4.garble.length + R.v4.truncated.length + R.v4.newline.length +
    R.v4.contentMismatch.length + R.v4.unreachable.length

  console.log('\n================ 执行结果摘要 ================')
  console.log('样本组数：' + R.cases + '   Ground Truth 台词条数：' + R.gtUnits + '   人物归属校验次数：' + R.v3.checked + '（粘连跳过 ' + R.v3.adherentSkipped + '）')
  console.log('问题总数：' + total)

  console.log('\n【第一优先级 · V1 台词零遗漏】')
  console.log('  缺失：' + R.v1.miss.length + '   重复：' + R.v1.dup.length + '   乱序：' + R.v1.disorder.length)
  show('V1-1 台词缺失明细', R.v1.miss)
  show('V1-2 重复片段', R.v1.dup)
  show('V1-3 顺序错乱', R.v1.disorder)

  console.log('\n【V2 智能拆分】')
  console.log('  重复片段：' + R.v2.dupFrag.length + '   切点截断语义：' + R.v2.badCut.length + '   分段越界：' + R.v2.overflow.length)
  show('V2-1 相邻重复片段', R.v2.dupFrag)
  show('V2-2 切点未落在句末标点（语义截断）', R.v2.badCut)
  show('V2-3 分段合计超出原文', R.v2.overflow)

  console.log('\n【V3 人物识别】')
  console.log('  漏配：' + R.v3.lost.length + '   错配：' + R.v3.wrong.length + '   舞台提示被判角色：' + R.v3.stageAsRole.length)
  show('V3-1 漏配（无角色）', R.v3.lost)
  show('V3-2 错配（归给别人）', R.v3.wrong)
  show('V3-3 舞台提示/无台词被误判为角色', R.v3.stageAsRole)

  console.log('\n【V4 显示正确】')
  console.log('  乱码：' + R.v4.garble.length + '   截断：' + R.v4.truncated.length + '   行内含换行：' + R.v4.newline.length + '   显示层与源不一致：' + R.v4.contentMismatch.length + '   滚动不可达：' + R.v4.unreachable.length)
  show('V4-1 乱码 / 未解码实体 / 控制字符', R.v4.garble)
  show('V4-2 显示层拼接与源不一致', R.v4.contentMismatch)
  show('V4-3 超行宽截断', R.v4.truncated)
  show('V4-4 行内含换行', R.v4.newline)
  show('V4-5 滚动不可达（内容高度不足）', R.v4.unreachable)

  console.log('\n================ 结论 ================')
  console.log(total === 0 ? '✅ 四项全部通过，0 问题' : '🔴 共 ' + total + ' 项问题，见上明细')

  // 落一份 JSON 便于后续比对
  fs.writeFileSync(path.join(HERE, 'testcases', 'verify_result.json'), JSON.stringify(R, null, 1), 'utf8')
}

main()
