'use strict'
/**
 * fuzz_wukong.js —— 「悟空脚本专属拆分」×「智能多模态拆分」随机台词语料模糊测试台
 * ---------------------------------------------------------------------------
 * 用法：
 *   node fuzz_wukong.js [篇数] [每集行数] [种子]
 *   node fuzz_wukong.js 500 6 20260919
 *
 * 生成什么：
 *   随机表格稿（真 blocks 结构：集名行 / 摘要行 / 表头行 / 数据行），
 *   列数 3~5 随机、台词列位置随机、台词列名在「台词/对白/内容/独白/口播/话术」里随机，
 *   分隔方式混用「格内软换行 / 空单元格 / 连续空单元格」，
 *   内容混入占位行（（无台词）/（无对白）/—）与前后空格。
 *   每段内容都带全局唯一编号：台词用 T 前缀、画面用 S 前缀、备注用 N 前缀 ——
 *   这样「串列」「丢字」都能被字符级抓住。
 *
 * 两条拆分链各自跑完整产品链路（util.splitScripts），逐条核对不变量：
 *   IW1 集数守恒       表格数 == 拆出的集数
 *   IW2 非空行零丢失   源里每一段非空台词都在结果里，且顺序完全一致（逐项相等）
 *   IW3 字段纯净       画面 / 备注 / 镜头号的内容绝不混进台词结果
 *   IW4 摘要行不入结果 集信息行（人物｜场景｜道具）不得出现
 *   IW5 占位行保留     源里的占位行必须在结果里（悟空规则「复制≠提纯」）
 *   IW6 空行策略       结果内无相邻空行、末尾无空行；首部空行与源一致
 *   IW7 集名正确       每集集名 == 源表格集信息行
 *   IW8 双模式同源     多模态非空行 == 悟空非空行剔除占位行，且顺序一致
 */
const util = require('./miniprogram/utils/util.js')

// ---------------------------------------------------------------- 随机源
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]
const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1))

const ROLES = ['王建华', '杨凤', '婆婆', '儿子', '李阿姨', '张阿姨', '王阿姨', '爸爸', '儿媳', '公公', '兄弟A', 'Tom']
const HEADER_NAMES = ['台词', '对白', '内容', '独白', '口播', '话术']
const SCENE_NAMES = ['镜头', '景别', '画面', '画面 / 动作', '画面场景', '场次']
const REMARK_NAMES = ['备注', '说明', '卖点/备注', '拍摄提示']
const PLACEHOLDERS = ['（无台词）', '（无对白）', '—', '-', '无台词']
const TAIL_TEXT = ['今天就到这儿。', '你先坐会儿。', '我忙着呢。', '饭在锅里。', '别急，慢慢来。', '知道了。']

let UID = 1
const nextUid = () => UID++

/**
 * 生成一篇随机文档。
 * @returns {{blocks:Array, truth:Object}} truth 是生成时记下的标准答案
 */
function makeDoc(rng, epCount, rowsPerEp) {
  const blocks = []
  const truth = []
  for (let ep = 1; ep <= epCount; ep++) {
    const epName = '测试剧' + (100 + ep)
    const roleCount = int(rng, 2, 5)
    const roles = []
    let guard = 0
    while (roles.length < roleCount && guard++ < 50) {
      const r = pick(rng, ROLES)
      if (roles.indexOf(r) < 0) roles.push(r)
    }
    const colCount = int(rng, 3, 5)
    const dlgCol = int(rng, 0, colCount - 1)
    // 台词列之外的其他列：场景列 / 备注列（刻意避开「角色|人物|说话人|演员」，
    // 否则产品会走「角色列合并成 角色：台词」的规则，那是另一条路径）
    const otherNames = []
    for (let c = 0; c < colCount; c++) {
      if (c === dlgCol) otherNames.push(pick(rng, HEADER_NAMES))
      else otherNames.push(rng() < 0.5 ? pick(rng, SCENE_NAMES) : pick(rng, REMARK_NAMES))
    }
    const rows = []
    rows.push([epName])
    const hasSummary = rng() < 0.75
    if (hasSummary) rows.push(['人物：' + roles.join('、') + '　｜　场景：家、厨房　｜　道具：桌、椅'])
    rows.push(otherNames)

    const dlgAll = [] // 该集所有非空台词行（源顺序）
    const dlgPlaceholders = [] // 该集占位行
    const otherUids = [] // 其他列的 uid（绝不能出现在结果里）
    let firstCellBlank = null

    const dataCount = Math.max(1, int(rng, 1, rowsPerEp))
    for (let r = 0; r < dataCount; r++) {
      const cells = []
      for (let c = 0; c < colCount; c++) {
        if (c === dlgCol) {
          // 台词格：混用「格内软换行 / 空 / 连续空 / 占位行」
          const kind = rng()
          if (kind < 0.10) { cells.push(''); continue } // 整格空
          const parts = []
          const segCount = int(rng, 1, 3)
          for (let k = 0; k < segCount; k++) {
            const t = rng()
            if (t < 0.12) { const p = pick(rng, PLACEHOLDERS); parts.push(p); dlgPlaceholders.push(p) }
            else if (t < 0.18) parts.push('') // 格内空行
            else {
              const role = pick(rng, roles)
              const uid = nextUid()
              const line = role + '：第' + (r + 1) + '行第' + (k + 1) + '句，编号T' + uid + '，' + pick(rng, TAIL_TEXT)
              parts.push(line)
              dlgAll.push(line)
            }
          }
          // 随机给整格加首尾空格（验证「只清行尾、保留行内与行首」）
          let cellText = parts.join('\n')
          if (rng() < 0.2) cellText = cellText + '   '
          if (rng() < 0.15) cellText = '  ' + cellText
          cells.push(cellText)
          if (firstCellBlank === null) firstCellBlank = !cellText.trim()
        } else {
          const uid = nextUid()
          const isScene = otherUids.length % 2 === 0
          const v = (isScene ? '【中景】第' + (r + 1) + '行画面标记S' : '备注：第' + (r + 1) + '行备注标记N') + uid
          otherUids.push((isScene ? 'S' : 'N') + uid)
          cells.push(v)
        }
      }
      rows.push(cells)
    }

    blocks.push({ type: 'paragraph', text: epName })
    blocks.push({ type: 'table', rows: rows })
    truth.push({
      name: epName,
      dlgCol: dlgCol,
      dlgAll: dlgAll,
      placeholders: dlgPlaceholders,
      otherUids: otherUids,
      otherHeaderNames: otherNames.filter((_, c) => c !== dlgCol),
      firstCellBlank: !!firstCellBlank
    })
  }
  return { blocks, truth }
}

// ---------------------------------------------------------------- 断言
let asserts = 0
const bucket = {}
function bad(kind, detail) {
  bucket[kind] = (bucket[kind] || 0) + 1
  if (bucket[kind] <= 2) console.log('  ✗ [' + kind + '] ' + detail)
}
function chk(kind, cond, detail) {
  asserts++
  if (!cond) bad(kind, detail)
  return cond
}

const isPlaceholderLine = (l) => {
  const t = String(l || '').trim()
  if (!t) return false // 空行不是占位行（占位行是「有内容的无台词标记」）
  return /^[（(]无(台词|对白)[）)]$/.test(t) || /^无(台词|对白)$/.test(t) || /^[-—－–·•]+$/.test(t)
}

function verify(blocks, truth, mode) {
  const res = util.splitScripts(blocks, mode === 'wukong' ? { mode: 'wukong' } : undefined)
  chk('IW1 集数守恒', res.segments.length === truth.length,
    '期望 ' + truth.length + ' 集，实际 ' + res.segments.length)

  res.segments.forEach((seg, i) => {
    const T = truth[i]
    if (!T) return
    const tag = mode + '/第' + (i + 1) + '集'

    // IW7 集名
    chk('IW7 集名正确', seg.name === T.name, tag + ' 期望「' + T.name + '」实际「' + seg.name + '」')

    const lines = seg.lines || []
    const nonEmpty = lines.filter((l) => l.trim())

    if (mode === 'wukong') {
      // IW2 非空行零丢失 + 顺序完全一致。
      // 悟空规则原样保留占位行，所以比对前要先把占位行摘掉，只比「真台词行」。
      const realLines = nonEmpty.filter((l) => !isPlaceholderLine(l))
      let sameAsTruth = realLines.length === T.dlgAll.length
      let firstDiff = -1
      if (sameAsTruth) {
        for (let k = 0; k < realLines.length; k++) {
          if (realLines[k].trim() !== T.dlgAll[k].trim()) { sameAsTruth = false; firstDiff = k; break }
        }
      } else {
        firstDiff = Math.min(realLines.length, T.dlgAll.length)
      }
      chk('IW2 非空行零丢失/顺序一致', sameAsTruth,
        tag + ' 源 ' + T.dlgAll.length + ' 行 / 结果真台词 ' + realLines.length + ' 行；首个差异@' + firstDiff)

      // IW5 占位行保留（复制 ≠ 提纯：源里有几行占位，结果里就该有几行）
      const gotPh = lines.filter((l) => isPlaceholderLine(l)).length
      chk('IW5 占位行保留', gotPh === T.placeholders.length,
        tag + ' 源占位 ' + T.placeholders.length + ' / 结果占位 ' + gotPh)
    } else {
      // 多模态：非空行零丢失（顺序一致）
      chk('IM2(多模态) 非空行零丢失/顺序一致', nonEmpty.length === T.dlgAll.length &&
        nonEmpty.every((l, k) => l.trim() === T.dlgAll[k].trim()),
        tag + ' 源 ' + T.dlgAll.length + ' / 结果 ' + nonEmpty.length)
    }

    // IW3 字段纯净：其他列的 uid 一个都不许出现
    const body = lines.join('\n')
    const leaked = T.otherUids.filter((u) => body.indexOf(u) >= 0)
    chk('IW3 字段纯净（画面/备注不串列）', leaked.length === 0, tag + ' 泄漏 ' + leaked.slice(0, 3).join(','))

    // IW4 摘要行不入结果
    chk('IW4 摘要行不入结果', !/人物：|道具：|场景：家/.test(body), tag)

    // IW6 空行策略
    if (mode === 'wukong') {
      chk('IW6a 无相邻空行', !lines.some((l, k) => !l.trim() && k > 0 && !lines[k - 1].trim()), tag)
      chk('IW6b 末尾无空行', !lines.length || !!lines[lines.length - 1].trim(), tag)
      if (T.firstCellBlank && T.dlgAll.length) {
        chk('IW6c 首部空行保留', !lines[0].trim(), tag + ' 首行应为空')
      }
    }
  })

  return res
}

function run(count, rowsPerEp, seed) {
  UID = 1
  const rng = mulberry32(seed >>> 0)
  for (let n = 0; n < count; n++) {
    const epCount = int(rng, 1, 4)
    const { blocks, truth } = makeDoc(rng, epCount, rowsPerEp)
    const wuk = verify(blocks, truth, 'wukong')
    const mul = verify(blocks, truth, 'multimodal')

    // IW8 双模式同源：多模态非空行 == 悟空非空行剔除占位行，顺序一致
    if (wuk.segments.length === mul.segments.length) {
      for (let i = 0; i < wuk.segments.length; i++) {
        const a = (wuk.segments[i].lines || []).filter((l) => l.trim() && !isPlaceholderLine(l)).map((l) => l.trim())
        const b = (mul.segments[i].lines || []).map((l) => l.trim())
        chk('IW8 双模式同源', a.length === b.length && a.every((x, k) => x === b[k]),
          '文档#' + n + ' 第' + (i + 1) + '集 悟空(去占位)' + a.length + ' vs 多模态' + b.length)
      }
    }
  }
}

// ---------------------------------------------------------------- 入口
if (require.main === module) {
  const count = Number(process.argv[2] || 500)
  const rows = Number(process.argv[3] || 6)
  const seed = Number(process.argv[4] || 20260919)
  console.log('=== fuzz_wukong 篇数=' + count + ' 每集行数=' + rows + ' 种子=' + seed + ' ===')
  const t0 = Date.now()
  run(count, rows, seed)
  const ms = Date.now() - t0
  const kinds = Object.keys(bucket)
  console.log('\n断言次数：' + asserts.toLocaleString() + '   耗时 ' + ms + 'ms')
  if (!kinds.length) console.log('✅ 全部通过：0 类失败')
  else {
    console.log('❌ 失败类别 ' + kinds.length + ' 种：')
    kinds.forEach((k) => console.log('   ' + k + ' × ' + bucket[k]))
    process.exit(1)
  }
}

module.exports = { makeDoc, verify, run, mulberry32 }
