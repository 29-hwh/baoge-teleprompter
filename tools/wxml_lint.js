/**
 * WXML 循环变量体检
 * ============================================================================
 * 为什么需要它：
 *   WXML 的 `wx:for` 默认把循环项命名为 `item`。若模板里写的是 `{{line.body}}`
 *   却没有 `wx:for-item="line"`，WXML 不会报错，只会求值成 undefined ——
 *   页面上表现为「循环渲染出一堆空标签」，是最难用肉眼发现的一类 bug
 *   （2026-10-28 提词页整页无台词即由此引起）。
 *
 * 判定规则（宁可少报，不要误报）：
 *   1) 找到每个带 wx:for 的标签，取它的 item/index 变量名（默认 item / index）；
 *   2) 取该标签内的模板表达式 {{...}}；
 *   3) 表达式里出现 `标识符.` 或纯标识符时，若该标识符既不是 item/index，
 *      也不是页面 data 里的字段名、不是 wx: 内置名，就判为可疑。
 *
 * 用法：node tools/wxml_lint.js
 * 退出码：有问题 1，全通过 0
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'miniprogram')

/* ---------------------------- 工具 ---------------------------- */

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxml')) out.push(p)
  }
  return out
}

/** 从同名 .js 里粗取 data 的顶层字段名（不执行代码，只扫文本） */
function dataKeysOf(wxmlPath) {
  const jsPath = wxmlPath.replace(/\.wxml$/, '.js')
  const keys = new Set()
  if (!fs.existsSync(jsPath)) return keys
  const src = fs.readFileSync(jsPath, 'utf8')
  const m = src.match(/\n\s{2}data:\s*\{/)
  if (!m) return keys
  // 从 data:{ 开始做花括号配平，取出对象原文
  let i = src.indexOf('{', m.index + m[0].length - 1)
  let depth = 0
  let end = i
  for (; end < src.length; end++) {
    const c = src[end]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  const body = src.slice(i + 1, end)
  // 只取第 0 层（对象/数组内部的不算）
  let d = 0
  let line = ''
  for (const ch of body) {
    if (ch === '{' || ch === '[') d++
    if (ch === '}' || ch === ']') d--
    if (ch === '\n' && d === 0) {
      line = ''
      continue
    }
    line += ch
    if (d === 0) {
      const k = line.match(/([A-Za-z_$][\w$]*)\s*:/)
      if (k) keys.add(k[1])
    }
  }
  // 行内对象（data: { a: 1, b: 2 } 单行）兜底
  const inline = body.match(/[A-Za-z_$][\w$]*\s*:/g) || []
  if (d === 0 && !body.includes('\n')) inline.forEach((s) => keys.add(s.replace(/\s*:$/, '')))
  return keys
}

/** 找到标签的结束位置（同名标签配平），返回结束标签的起始下标 */
function findClose(src, from, tag) {
  const re = new RegExp(`<(/?)${tag}\\b`, 'g')
  re.lastIndex = from
  let depth = 0
  let m
  while ((m = re.exec(src))) {
    if (m[1] === '/') {
      depth--
      if (depth === 0) return m.index
    } else {
      // 自闭合忽略
      const gt = src.indexOf('>', m.index)
      if (src[gt - 1] !== '/') depth++
    }
  }
  return -1
}

/** 表达式里出现的根标识符 */
function rootIdents(expr) {
  const out = new Set()
  // 去掉字符串字面量，避免把中文/引号内容当标识符
  const clean = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)/g
  let m
  while ((m = re.exec(clean))) {
    const id = m[2]
    out.add(id)
  }
  return out
}

const WX_BUILTIN = new Set([
  'true', 'false', 'null', 'undefined', 'typeof', 'in', 'of', 'new', 'void',
  'item', 'index', 'length', 'Math', 'Number', 'String', 'Boolean', 'Object',
  'Array', 'JSON', 'Date', 'parseInt', 'parseFloat', 'isNaN'
])

/* ---------------------------- 主流程 ---------------------------- */

const files = walk(ROOT, [])
let problems = 0
let checked = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const noComment = src.replace(/<!--[\s\S]*?-->/g, (s) => ' '.repeat(s.length))
  const dataKeys = dataKeysOf(file)
  const rel = path.relative(path.join(__dirname, '..'), file)

  const re = /<([a-zA-Z][\w-]*)\b([^>]*?wx:for[^>]*?)>/g
  let m
  while ((m = re.exec(noComment))) {
    checked++
    const tag = m[1]
    const attrs = m[2]
    const tagEnd = m.index + m[0].length
    const itemAttr = attrs.match(/wx:for-item="([^"]*)"/)
    const idxAttr = attrs.match(/wx:for-index="([^"]*)"/)
    const itemName = itemAttr ? itemAttr[1] : 'item'
    const idxName = idxAttr ? idxAttr[1] : 'index'
    const line = noComment.slice(0, m.index).split('\n').length

    // 作用域 = 该标签的整段内容（含自身属性里的表达式）
    const closeAt = findClose(noComment, tagEnd, tag)
    const scope = closeAt >= 0 ? noComment.slice(tagEnd, closeAt) : noComment.slice(tagEnd)
    const exprs = scope.match(/\{\{[\s\S]*?\}\}/g) || []

    const bad = new Set()
    for (const raw of exprs) {
      const body = raw.slice(2, -2)
      for (const id of rootIdents(body)) {
        if (id === itemName || id === idxName) continue
        if (WX_BUILTIN.has(id)) continue
        if (dataKeys.has(id)) continue
        // 嵌套 wx:for 的 item 名也算可用
        const nested = scope.match(/wx:for-item="([^"]*)"/g) || []
        if (nested.some((n) => n.includes(`"${id}"`))) continue
        bad.add(id)
      }
    }

    if (bad.size) {
      problems++
      console.log(`\n❌ ${rel}:${line}  <${tag} wx:for> 循环变量未声明`)
      console.log(`   已声明：item="${itemName}"  index="${idxName}"`)
      console.log(`   却在模板里用到：${Array.from(bad).join(', ')}`)
      if (!itemAttr) {
        console.log(`   修法：加 wx:for-item="${Array.from(bad)[0]}"（当前是默认的 item）`)
      }
    }
  }
}

console.log(`\n${'─'.repeat(56)}`)
console.log(`扫描 ${files.length} 个 wxml、${checked} 处 wx:for —— ${problems ? `${problems} 处可疑` : '全部通过 ✅'}`)
process.exit(problems ? 1 : 0)
