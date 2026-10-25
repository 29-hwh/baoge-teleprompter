/**
 * 粘连修复验证：真实脚本文档经产品解析链路（extractDocxBlocks）后，
 * ① 不再有「同一行里挤两个说话人」的粘连
 * ② 文案零丢字（与修复前逐字一致，仅差 4 处补的句号）
 * 用法：node glue_fix_verify.js <after.docx> <before.docx>
 */
const fs = require('fs')
const { execFileSync } = require('child_process')
const util = require('./miniprogram/utils/util.js')

const PY = '/Users/huweihua/.workbuddy/binaries/python/versions/3.13.12/bin/python3'

function readDocXml(p) {
  return execFileSync(PY, ['-c',
    'import zipfile,sys;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))',
    p], { maxBuffer: 64 * 1024 * 1024 }).toString()
}

const NAMES = ['王建华', '杨凤', '婆婆', '爸爸', '妈妈', '建华', '小凤', '王阿姨', '李阿姨', '张阿姨',
  '兄弟A', '兄弟B', '兄弟C', '公公', '女儿', '儿子', '女婿', '邻居']
const PREFIX = new RegExp('(' + NAMES.join('|') + ')(（[^）]{0,24}）)?[：:]')

/** 取某文档所有表格单元格文本（走产品 extractDocxBlocks，与小程序导入链路同一函数） */
function cellsOf(docxPath) {
  const blocks = util.extractDocxBlocks(readDocXml(docxPath))
  const out = []
  blocks.forEach((b) => {
    if (b.type !== 'table') return
    ;(b.rows || []).forEach((row, ri) => {
      ;(row || []).forEach((c, ci) => {
        if (String(c || '').trim()) out.push({ ri: ri + 1, ci: ci + 1, text: c })
      })
    })
  })
  return out
}

const [after, before] = process.argv.slice(2)
if (!after || !before) {
  console.error('用法：node glue_fix_verify.js <after.docx> <before.docx>')
  process.exit(1)
}

const A = cellsOf(after)
const B = cellsOf(before)
console.log('单元格数（非空）：修复后 %d / 修复前 %d', A.length, B.length)

// ---------- ① 粘连扫描 ----------
let glue = 0
const glueCases = []
A.forEach((c) => {
  const lines = String(c.text).split('\n')
  lines.forEach((ln) => {
    if (!ln.trim()) return
    // 必须先 trim：行首的缩进空格不算「句中又冒出一个人名」
    const body = ln.trim()
    const mid = []
    const re = new RegExp(PREFIX.source, 'g')
    let x
    while ((x = re.exec(body)) !== null) if (x.index > 0) mid.push(x[0])
    if (mid.length) {
      glue++
      glueCases.push('R' + c.ri + 'C' + c.ci + ' : ' + body.slice(0, 60) + '  ← ' + mid.join(','))
    }
  })
})
console.log('\n=== ① 粘连扫描（修复后）===')
console.log('同一行内出现多个说话人的行数：%d', glue)
glueCases.slice(0, 10).forEach((s) => console.log('   ', s))

const multiCells = A.filter((c) => String(c.text).split('\n').filter((l) => l.trim()).length > 1)
console.log('含多行的单元格数：%d（修复前同一批单元格是 1 行）', multiCells.length)

// ---------- ② 零丢字 ----------
console.log('\n=== ② 零丢字校验（压平后逐字比对）===')
let bad = 0
let added = 0
const FIX = ['怪不得你一有空就看。', '看来是我想多了。', '饭好了，吃完饭再去看。', '记得洗点葡萄啊。']
for (let i = 0; i < Math.min(A.length, B.length); i++) {
  const a = String(A[i].text).replace(/\n/g, '')
  const b = String(B[i].text).replace(/\n/g, '')
  if (a === b) continue
  const norm = (s) => FIX.reduce((acc, f) => acc.replace(f, f.slice(0, -1)), s)
  if (norm(a) === norm(b)) { added++; continue }
  bad++
  if (bad <= 5) console.log('   ✗ R%dC%d\n     修复后=%s\n     修复前=%s', A[i].ri, A[i].ci, a.slice(0, 90), b.slice(0, 90))
}
console.log('压平后与修复前不一致的单元格：%d（应为 0）', bad)
console.log('仅因补句末标点而变化的单元格：%d（应为 4）', added)

// ---------- ③ 行数 ----------
// 同一份文档跑两种解析行为：压平（= 老的 extractWtText，换行被吞）vs 还原（= 修复后）
const count = (arr, flat) => arr.reduce((n, c) => {
  const t = flat ? String(c.text).replace(/\n/g, '') : String(c.text)
  return n + t.split('\n').filter((l) => l.trim()).length
}, 0)
const linesBefore = count(A, true)
const linesAfter = count(A, false)
console.log('\n=== ③ 台词行数（同一份文档，两种解析行为）===')
console.log('旧行为（<w:br/> 被吞 → 一格一行）：%d 行', linesBefore)
console.log('新行为（<w:br/> 还原为换行）：%d 行', linesAfter)
console.log('多还原出来的台词行：%d 行', linesAfter - linesBefore)

const pass = glue === 0 && bad === 0 && added === 4 && linesAfter > linesBefore
console.log('\n%s', pass ? '✅ 三项全部通过' : '❌ 存在未通过项')
process.exit(pass ? 0 : 1)
