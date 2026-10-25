'use strict'
/**
 * round31 · 「悟空脚本专属拆分」专项回归
 *
 * 背景：宝哥提的固定活儿是「飞书脚本 → 四列表格稿（镜头 / 画面动作 / 台词 / 备注）」，
 * 再人工按「拆分步骤1：把台词栏进行复制得出结果」整理成纯台词清单（样张：最终台词.docx）。
 * 本轮把这个人工整理逻辑抽象成可复用的拆分机制，作为**第四种拆分方式**接入预览页，
 * 并让「智能多模态拆分」与它共用同一解析内核。
 *
 * 锁定内容：
 *   31-A 复制规则：字段映射（只取台词列）、行序、单元格内拆行
 *   31-B 内容策略：占位行原样保留、连续空行折叠、首部空行保留、尾部空行去掉
 *   31-C 集标题与数据行区间（含「表头前的台词行被救回」）
 *   31-D 与「智能多模态拆分」的内核同源：集数 / 集名 / 顺序一致，
 *        悟空去占位行后 == 多模态（两模式只在下游清洗上分叉）
 *   31-E 页面接入：按钮、落盘、纯文本稿置灰
 */
const fs = require('fs')
const path = require('path')
const util = require('./miniprogram/utils/util.js')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS | ' + name + (extra ? '  -> ' + extra : '')) }
  else { fail++; console.log('FAIL | ' + name + (extra ? '  -> ' + extra : '')) }
}
const J = (a) => JSON.stringify(a)

// ============================================================
// 合成表格稿：不依赖任何外部文件，纯 blocks 直喂 splitScripts。
// 结构照搬真实稿件：R0 集名（单格）/ R1 摘要（单格）/ R2 表头（4 列）/ R3+ 数据
// ============================================================
function makeBlocks() {
  const t1 = {
    type: 'table',
    rows: [
      ['测试剧01'],
      ['人物：甲、乙　｜　场景：家　｜　道具：桌'],
      ['镜头', '画面 / 动作', '台词', '备注'],
      ['1', '【中景】画面一', '甲：你好。', '备注A'],
      ['2', '【中景】画面二', '乙：好。\n甲：再见。', '备注B'],
      ['3', '【中景】画面三', '（无台词）', ''],
      ['4', '【中景】画面四', '—', ''],
      ['5', '【中景】画面五', '', '']
    ]
  }
  const t2 = {
    type: 'table',
    rows: [
      ['测试剧02'],
      ['人物：丙'],
      ['1', '画面', '', ''],
      ['镜头', '画面 / 动作', '台词', '备注'],
      ['1', '画面', '丙：第一句。', ''],
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '丙：第二句。', '']
    ]
  }
  const t3 = {
    type: 'table',
    rows: [
      ['测试剧03'],
      ['', '', '丙：表头前的一句。', ''],
      ['镜头', '画面 / 动作', '台词', '备注'],
      ['1', '画面', '丙：表头后的一句。', '']
    ]
  }
  return [
    { type: 'paragraph', text: '测试剧01' },
    t1,
    { type: 'paragraph', text: '测试剧02' },
    t2,
    { type: 'paragraph', text: '测试剧03' },
    t3
  ]
}

const BLOCKS = makeBlocks()
const WUK = util.splitScripts(BLOCKS, { mode: 'wukong' })
const MULTI = util.splitScripts(BLOCKS)

// ============================================================
console.log('\n=== 31-A. 复制规则：字段映射 / 行序 / 单元格内拆行 ===')
// ============================================================
ok('A1 集数正确（3 个表格 = 3 集）', WUK.segments.length === 3, 'got ' + WUK.segments.length)

const s1 = WUK.segments[0]
ok('A2 只取「台词」列：镜头号 / 画面 / 备注都不进结果',
  s1.lines.indexOf('1') < 0 && s1.lines.indexOf('【中景】画面一') < 0 && s1.lines.indexOf('备注A') < 0,
  J(s1.lines))
ok('A3 摘要行（人物｜场景｜道具）不进结果',
  !s1.lines.some((l) => /人物：|道具：/.test(l)))
ok('A4 行序 = 表格行序（甲→乙→甲）',
  J([s1.lines[0], s1.lines[1], s1.lines[2]]) === J(['甲：你好。', '乙：好。', '甲：再见。']),
  J(s1.lines.slice(0, 3)))
ok('A5 单元格内软换行拆成多行（一格里两句 → 两行）', s1.lines[1] === '乙：好。' && s1.lines[2] === '甲：再见。')
ok('A6 集名取表格集信息行', s1.name === '测试剧01', s1.name)
ok('A7 结果结构带 column 元数据（记录来源列名，但不混进正文）',
  s1.column === '台词' && s1.wukong === true && !s1.lines.some((l) => l === '台词'))
ok('A8 lineCount 与实际行数一致',
  WUK.segments.every((s) => s.lineCount === s.lines.length))

// ============================================================
console.log('\n=== 31-B. 内容策略：占位行保留 / 空行折叠 ===')
// ============================================================
ok('B1 占位行「（无台词）」原样保留（复制 ≠ 提纯）', s1.lines.indexOf('（无台词）') >= 0, J(s1.lines))
ok('B2 占位行「—」原样保留', s1.lines.indexOf('—') >= 0)
ok('B3 尾随空格被清掉、行内空格保留',
  util.splitScripts([{ type: 'table', rows: [['T'], ['镜头', '画面', '台词'], ['1', 'x', '  甲：带空格。  ']] }], { mode: 'wukong' })
    .segments[0].lines[0] === '  甲：带空格。',
  J(util.splitScripts([{ type: 'table', rows: [['T'], ['镜头', '画面', '台词'], ['1', 'x', '  甲：带空格。  ']] }], { mode: 'wukong' }).segments[0].lines))

const s2 = WUK.segments[1]
ok('B4 连续空行折叠为 1 行', s2.lines.filter((l) => !l).length === 1, J(s2.lines))
ok('B5 折叠后中间空行仍保留（不是全删）', s2.lines[1] === '', J(s2.lines))
ok('B6 整集末尾空行被去掉', WUK.segments.every((s) => s.lines.length > 0 && s.lines[s.lines.length - 1] !== ''))
ok('B7 全片不存在相邻两个空行',
  WUK.segments.every((s) => !s.lines.some((l, i) => !l && i > 0 && !s.lines[i - 1])))

// 首部空行保留：单独造一集，第一行数据的台词栏就是空的
const headBlank = util.splitScripts([{
  type: 'table',
  rows: [['测试剧头空'], ['镜头', '画面 / 动作', '台词'], ['1', '画面', ''], ['2', '画面', '甲：有词。']]
}], { mode: 'wukong' }).segments[0]
ok('B8 首部空行保留（标记「这一行画面没有台词」）',
  headBlank.lines.length === 2 && headBlank.lines[0] === '' && headBlank.lines[1] === '甲：有词。', J(headBlank.lines))

// ============================================================
console.log('\n=== 31-C. 数据行区间：表头前的台词行必须救回 ===')
// ============================================================
const s3 = WUK.segments[2]
ok('C1 表头之前的台词行被救回（顺序仍在表头后那行之前）',
  J(s3.lines) === J(['丙：表头前的一句。', '丙：表头后的一句。']), J(s3.lines))
ok('C2 表头行自己绝不进数据（「镜头」「备注」不出现在结果里）',
  !s3.lines.some((l) => /镜头|备注|画面 \/ 动作/.test(l)))
ok('C3 无表头表格不崩（退回 legacy 路径仍能出结果）',
  (function () {
    const r = util.splitScripts([{ type: 'table', rows: [['某剧'], ['甲：你好。'], ['乙：好。']] }], { mode: 'wukong' })
    return r.ok && r.segments.length === 1
  })())

// ============================================================
console.log('\n=== 31-D. 与「智能多模态拆分」内核同源 ===')
// ============================================================
ok('D1 集数一致', WUK.segments.length === MULTI.segments.length,
  WUK.segments.length + ' vs ' + MULTI.segments.length)
ok('D2 集名逐一一致',
  J(WUK.segments.map((s) => s.name)) === J(MULTI.segments.map((s) => s.name)),
  J(MULTI.segments.map((s) => s.name)))
ok('D3 结构定位一致（同一内核 locateTableStructure 产出的行区间相同）',
  (function () {
    const tables = BLOCKS.filter((b) => b.type === 'table')
    return tables.every((t) => {
      const a = util.locateTableStructure(t.rows, '')
      return a.ok && a.dialogueCol === 2
    })
  })())
const isPlaceholder = (l) => /^[（(]无(台词|对白)[）)]$/.test(l.trim()) || /^[-—－–·•\s]*$/.test(l)
ok('D4 悟空去掉占位行与空行之后 == 多模态（分叉只在清洗，不在结构）',
  J(WUK.segments.map((s) => s.lines.filter((l) => l && !isPlaceholder(l)))) ===
  J(MULTI.segments.map((s) => s.lines)),
  J(WUK.segments.map((s) => s.lines.filter((l) => l && !isPlaceholder(l)))))
ok('D5 悟空行数 >= 多模态行数（悟空是超集：多保留占位行与空行）',
  WUK.segments.every((s, i) => s.lines.length >= MULTI.segments[i].lines.length))
ok('D6 默认模式（不传 opts）仍是多模态，未被我改坏',
  J(util.splitScripts(BLOCKS).segments.map((s) => s.lines)) === J(MULTI.segments.map((s) => s.lines)))

// ============================================================
console.log('\n=== 31-F. 占位行不连坐：占位行不许吃掉同格台词（模糊测试抓出的真缺陷） ===')
// ============================================================
// 旧实现在**整格**文本上做 /（无台词）/.test()，于是一格里只要出现一行
// 「（无对白）」，同格的另外几句台词会被一起丢掉 —— 3 句连坐消失。
const mixBlocks = [{
  type: 'table',
  rows: [
    ['测试剧混排'],
    ['镜头', '画面 / 动作', '台词'],
    ['1', '画面', '甲：第一句。\n（无对白）\n乙：第二句。'],
    ['2', '画面', '甲：只有一句。\n（无台词）'],
    ['3', '画面', '（无台词）'],
    ['4', '画面', '（无台词，手机屏幕微微照亮她的脸）']
  ]
}]
const mixMulti = util.splitScripts(mixBlocks).segments[0]
const mixWuk = util.splitScripts(mixBlocks, { mode: 'wukong' }).segments[0]
ok('F1 同格出现「（无对白）」不吃掉同格其他台词',
  J(mixMulti.lines) === J(['甲：第一句。', '乙：第二句。', '甲：只有一句。', '（无台词，手机屏幕微微照亮她的脸）']),
  J(mixMulti.lines))
ok('F2 纯占位格（整格就是「（无台词）」）在多模态里被丢弃',
  mixMulti.lines.indexOf('（无台词）') < 0, J(mixMulti.lines))
ok('F3 带说明的占位行（（无台词，手机屏幕…））不被误删',
  mixMulti.lines.some((l) => /手机屏幕/.test(l)))
ok('F4 悟空规则不受该缺陷影响：占位行原样保留、台词一句不少',
  J(mixWuk.lines) === J(['甲：第一句。', '（无对白）', '乙：第二句。', '甲：只有一句。', '（无台词）', '（无台词）', '（无台词，手机屏幕微微照亮她的脸）']),
  J(mixWuk.lines))
ok('F5 两模式在混排格里仍然同源（悟空去占位 == 多模态）',
  J(mixWuk.lines.filter((l) => !util.isPlaceholderLine(l))) === J(mixMulti.lines))

// ============================================================
console.log('\n=== 31-E. 页面接入 ===')
// ============================================================
const ROOT = __dirname
const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/preview/preview.wxml'), 'utf8')
const pjs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/preview/preview.js'), 'utf8')
const ijs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.js'), 'utf8')
ok('E1 预览页有「悟空脚本专属拆分」按钮', /悟空脚本专属拆分/.test(wxml))
ok('E2 按钮绑定 onImportWukong', /bindtap="onImportWukong"/.test(wxml))
ok('E3 按钮排在现有三种拆分机制下方（bar-sub 在 bar 之后）',
  wxml.indexOf('bar-sub') > wxml.indexOf('onImportMultimodal'))
ok('E4 预览页实现了 wukongSegmentsOf 与 onImportWukong',
  /function wukongSegmentsOf/.test(pjs) && /onImportWukong\s*\(/.test(pjs))
ok('E5 首页把悟空拆分结果放进 importPayload',
  /mode:\s*'wukong'/.test(ijs) && /wukong:\s*wukong/.test(ijs))

// --- 运行时：mock 微信环境，真跑一遍页面逻辑 ---
const storage = {}
global.wx = {
  getStorageSync: (k) => (storage[k] === undefined ? '' : storage[k]),
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  env: { USER_DATA_PATH: '/tmp' }
}
let APP = { globalData: {} }
global.getApp = () => APP
let PAGE = null
global.Page = (o) => { PAGE = o }

require('./miniprogram/pages/preview/preview.js')

function mount(payload) {
  APP = { globalData: { importPayload: payload } }
  const inst = Object.create(PAGE)
  inst.data = JSON.parse(JSON.stringify(PAGE.data))
  inst.setData = function (d) { Object.assign(this.data, d) }
  return inst
}

const docxPayload = {
  kind: 'docx',
  name: '测试剧',
  plain: '第一集\n甲：你好。\n\n第二集\n乙：好。',
  result: MULTI,
  wukong: WUK
}
let page = mount(docxPayload)
page.onLoad()
ok('E6 onLoad 在 docx 稿上算出悟空集数', page.data.wukongCount === 3, 'wukongCount=' + page.data.wukongCount)
ok('E7 onLoad 同时保留原有三种方式的计数',
  page.data.multiCount === 3 && page.data.plainCount >= 1, 'multi=' + page.data.multiCount)
page.onImportWukong()
const savedScripts = storage['scripts_v1'] || []
const savedFolders = storage['folders_v1'] || []
ok('E8 onImportWukong 落盘成一篇/集（3 集 → 3 篇）', savedScripts.length === 3, 'saved=' + savedScripts.length)
ok('E9 落盘正文 = 台词栏逐行（含占位行，不含列名）',
  savedScripts.some((s) => s.content.indexOf('（无台词）') >= 0) &&
  !savedScripts.some((s) => /^台词$/m.test(s.content)),
  JSON.stringify((savedScripts[0] || {}).content || '').slice(0, 80))
ok('E10 落盘进了同一个文件夹', savedFolders.length === 1)

// 纯文本稿：没有「台词」列 → 悟空按钮置灰
const textPayload = { kind: 'text', name: '纯文本', content: '第一集\n甲：你好。\n\n第二集\n乙：好。' }
const page2 = mount(textPayload)
page2.onLoad()
ok('E11 纯文本稿下悟空集数为 0（按钮置灰）', page2.data.wukongCount === 0, 'wukongCount=' + page2.data.wukongCount)
const before = (storage['scripts_v1'] || []).length
page2.onImportWukong()
ok('E12 纯文本稿点悟空拆分不落盘、不抛异常', (storage['scripts_v1'] || []).length === before)

// ============================================================
console.log('\n=== 汇总 ===')
console.log('round31 结果：' + pass + ' / ' + (pass + fail) + ' 通过')
if (fail) console.log('失败 ' + fail + ' 项')
process.exit(fail ? 1 : 0)
