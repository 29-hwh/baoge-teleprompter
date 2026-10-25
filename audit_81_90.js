'use strict'
/**
 * 基于真实文档《建华&小凤的生活81-90.docx》的端到端拆分审查。
 * 目的：用「探测性问题清单」找还有没有问题，而不是只验已经修好的那条。
 * 运行：node audit_81_90.js
 */
const fs = require('fs')
const util = require('./miniprogram/utils/util.js')

/**
 * 通用审查工具：node audit_81_90.js <document.xml 路径>
 * 文档本体是 zip，先用 python 解出 word/document.xml 再喂进来：
 *   python3 -c "import zipfile;z=zipfile.ZipFile('xx.docx');open('/tmp/x.xml','w').write(z.read('word/document.xml').decode())"
 */
const XML_PATH = process.argv[2] || '/tmp/jh81_90.xml'
const xml = fs.readFileSync(XML_PATH, 'utf8')
const blocks = util.extractDocxBlocks(xml)
const res = util.splitScripts(blocks)

let warn = 0
function W(tag, msg) {
  warn++
  console.log('  ⚠ [' + tag + '] ' + msg)
}

console.log('===== 1. 整体拆分结果 =====')
console.log('ok=' + res.ok + '  message=' + (res.message || '(无)') + '  集数=' + (res.segments ? res.segments.length : 0))

const segs = res.segments || []
segs.forEach((s, i) => {
  console.log(`  #${i + 1} ep=${s.ep} epNo=${s.epNo} name="${s.name}" lineCount=${s.lineCount} source=${s.source || '-'}`)
})

// ---- 2. 集号连续性：期望 81..90 ----
console.log('\n===== 2. 集号连续性 =====')
const nos = segs.map((s) => Number(s.epNo)).filter((n) => !isNaN(n))
console.log('  实际 epNo 列表：' + nos.join(', '))
if (!nos.length) {
  W('集号', '全部集都缺 epNo')
} else {
  for (let i = 1; i < nos.length; i++) {
    if (nos[i] !== nos[i - 1] + 1) W('集号不连续', `${nos[i - 1]} 之后是 ${nos[i]}`)
  }
  const dup = nos.filter((n, i) => nos.indexOf(n) !== i)
  if (dup.length) W('集号重复', dup.join(','))
  if (nos.length === nos[nos.length - 1] - nos[0] + 1) console.log('  ✓ 集号连续无缺')
}

// ---- 3. 逐行异常扫描 ----
console.log('\n===== 3. 逐行异常扫描 =====')
// 3a 疑似被截断的短句：长度<=5 且含标点，且不是纯说话人行（不以「：」结尾）
//    典型形如上次 bug 的「好吧,」——前句尾巴被切出来单独成行
const SPEAKER_TAIL = /([\u4e00-\u9fa5A-Za-z·]{1,5}(?:（[^）]*）)?)[：:]\s*$/
segs.forEach((s) => {
  ;(s.lines || []).forEach((ln, idx) => {
    const t = String(ln).trim()
    if (!t) return
    if (t.length <= 5 && /[，,、。！？；;]/.test(t) && !SPEAKER_TAIL.test(t)) {
      W('疑似截断短行', `${s.name} 第${idx + 1}行: "${t}"`)
    }
  })
})

// 3b 一行里出现多个「说话人：」→ 多轮没拆开（除非是粘连句，粘连应整行保留）
segs.forEach((s) => {
  ;(s.lines || []).forEach((ln, idx) => {
    const t = String(ln)
    const matches = t.match(/[\u4e00-\u9fa5A-Za-z·]{1,5}(?:（[^）]*）)?[：:]/g) || []
    if (matches.length >= 2) {
      // 只有「除了第一个之外的候选，其前一个字是非中文」才算真的漏拆
      const re = /[\u4e00-\u9fa5A-Za-z·]{1,5}(?:（[^）]*）)?[：:]/g
      let m
      let realSpeaker = 0
      while ((m = re.exec(t)) !== null) {
        const before = m.index > 0 ? t[m.index - 1] : ''
        if (!before || /[^\u4e00-\u9fa5·]/.test(before)) realSpeaker++
      }
      // 第一个通常在行首，必然算 speaker
      if (realSpeaker >= 2) {
        W('疑似多轮未拆', `${s.name} 第${idx + 1}行(${t.length}字): "${t.slice(0, 60)}..."`)
      }
    }
  })
})

// 3c 台词里残留 XML/乱码
segs.forEach((s) => {
  ;(s.lines || []).forEach((ln, idx) => {
    if (/<w:|&#|\x00|<\?xml/.test(String(ln))) {
      W('残留XML entities', `${s.name} 第${idx + 1}行: "${String(ln).slice(0, 50)}"`)
    }
  })
})

// ---- 4. splitDialogueCell 无损性：拆出来的各段拼接必须还原原文 ----
console.log('\n===== 4. splitDialogueCell 无损性（检查是否丢字） =====')
try {
  const fn = util.splitDialogueCell
  // 从 xml 里抓出所有表格单元格文本作为样本
  const cells = []
  const cellRe = /<w:tc>([\s\S]*?)<\/w:tc>/g
  let c
  while ((c = cellRe.exec(xml)) !== null) {
    const txt = (c[1].match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map((x) => x.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()
    if (txt && txt.indexOf('：') >= 0) cells.push(txt)
  }
  console.log('  含冒号的台词单元格数：' + cells.length)
  let lossCount = 0
  cells.forEach((txt) => {
    const parts = fn(txt)
    if (!Array.isArray(parts)) return
    const joined = parts.join('').replace(/\s/g, '')
    const orig = txt.replace(/\s/g, '')
    if (joined !== orig) {
      lossCount++
      if (lossCount <= 5) {
        console.log('    原文: ' + orig.slice(0, 80))
        console.log('    拼接: ' + joined.slice(0, 80))
      }
    }
  })
  if (lossCount === 0) console.log('  ✓ 全部无损（无丢字）')
  else W('丢字', lossCount + ' 个单元格拆分后拼接不等于原文')
} catch (e) {
  console.log('  (跳过无损性检查：' + e.message + ')')
}

// ---- 5. 重点复核：上次修过的 bug 点 ----
console.log('\n===== 5. 重点复核（上次报的 bug 点） =====')
const target = segs.find((s) => Number(s.epNo) === 84)
if (target) {
  const lines = target.lines || []
  const idx = lines.findIndex((l) => String(l).indexOf('杨凤（嘟囔）') >= 0)
  console.log('  第84集 命中行下标=' + idx)
  if (idx >= 0) {
    for (let i = idx; i < Math.min(idx + 4, lines.length); i++) {
      console.log('    [' + i + '] ' + lines[i])
    }
  } else {
    console.log('    未找到「杨凤（嘟囔）」行')
  }
  const hasStick = lines.some((l) => String(l).indexOf('好吧，看来是我想多了') >= 0 && String(l).indexOf('王建华') >= 0)
  console.log(hasStick ? '  ✓ 粘连句已合并为一整行（不被拆两段）' : '  ⚠ 未在单行内找到完整粘连句')
} else {
  console.log('  （本文档没有第 84 集，跳过该项复核）')
}

const t90 = segs.find((s) => Number(s.epNo) === 90)
if (t90) {
  const maxLen = Math.max(...(t90.lines || []).map((l) => String(l).length))
  console.log('  第90集 行数=' + (t90.lines || []).length + ' 最长行 ' + maxLen + ' 字')
}

console.log('\n===== 汇总：异常 ' + warn + ' 条 =====')
