#!/usr/bin/env node
/**
 * 页面静态体检：三类「WXML 静默失效」，微信都不报错，只能靠静态扫。
 *
 *   1. 循环变量未声明 —— wx:for 默认项名是 item，模板却用别的名字（本轮 P0 bug）
 *   2. 模板变量不存在 —— 拼写错误 / 数据源改过名，求值成 undefined，画出来是空的
 *   3. 事件绑定没有方法 —— bindtap 指向一个不存在的方法，点了没反应
 *
 * 用法：node tools/page_lint.js [--verbose]
 * 有任何一条问题 → exit 1
 */
const fs = require('fs')
const path = require('path')

const MP = path.join(__dirname, '..', 'miniprogram')
const VERBOSE = process.argv.includes('--verbose')

const BUILTIN = new Set([
  'true', 'false', 'null', 'undefined', 'item', 'index', 'length',
  'Math', 'Number', 'String', 'Boolean', 'Object', 'Array', 'JSON',
  'Date', 'parseInt', 'parseFloat', 'isNaN', 'typeof', 'in', 'of',
  'new', 'void', 'return'
])

/** 从 JS 源码里截出 `data: { ... }` 的顶层键 */
function dataKeys(src) {
  const m = /(^|\n)\s*data\s*:\s*\{/.exec(src)
  if (!m) return { keys: new Set(), end: 0, start: 0 }
  const start = src.indexOf('{', m.index + m[0].length - 1)
  let depth = 0
  let end = start
  for (; end < src.length; end++) {
    const c = src[end]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const body = src.slice(start + 1, end)
  const keys = new Set()
  let d = 0
  let buf = ''
  // 注释行必须以整行剔除：`// xxx` 没有结尾逗号，会被并进下一个字段的 buf，
  // 使 buf 以 '/' 开头 → 正则匹配失败 → 该字段被整条丢弃（曾导致 4 个字段漏报）。
  const stripLineComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const flush = () => {
    const mm = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(stripLineComments(buf))
    if (mm) keys.add(mm[1])
    buf = ''
  }
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') d++
    if (ch === ')' || ch === ']' || ch === '}') d--
    if (ch === ',' && d === 0) { flush(); continue }
    if (d === 0) buf += ch
  }
  flush()
  return { keys, start, end }
}

/** setData({ a, b: 1 }) 里出现过的键（含嵌套路径的首段） */
function setDataKeys(src) {
  const keys = new Set()
  const re = /setData\s*\(\s*\{/g
  let m
  while ((m = re.exec(src))) {
    const start = src.indexOf('{', m.index + m[0].length - 1)
    let depth = 0
    let end = start
    for (; end < src.length; end++) {
      const c = src[end]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = src.slice(start + 1, end)
    let d = 0
    let buf = ''
    const stripLineComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    const flush = () => {
      const clean = stripLineComments(buf)
      const mm = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*:/.exec(clean)
      if (mm) keys.add(mm[1])
      // 简写 setData({ foo })
      const sh = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(clean)
      if (sh) keys.add(sh[1])
      buf = ''
    }
    for (const ch of body) {
      if (ch === '(' || ch === '[' || ch === '{') d++
      if (ch === ')' || ch === ']' || ch === '}') d--
      if (ch === ',' && d === 0) { flush(); continue }
      if (d === 0) buf += ch
    }
    flush()
  }
  return keys
}

function listPages() {
  const dir = path.join(MP, 'pages')
  return fs.readdirSync(dir).filter((p) => {
    const f = path.join(dir, p, p + '.wxml')
    return fs.existsSync(f)
  })
}

let problems = 0

for (const page of listPages().sort()) {
  const dir = path.join(MP, 'pages', page)
  const wxmlPath = path.join(dir, page + '.wxml')
  const jsPath = path.join(dir, page + '.js')
  let wxml = fs.readFileSync(wxmlPath, 'utf8')
  wxml = wxml.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '))

  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''
  const dk = dataKeys(js)
  const known = new Set([...dk.keys, ...setDataKeys(js)])

  const issues = []
  const lineOf = (i) => wxml.slice(0, i).split('\n').length

  // ── 1. 循环变量 ──
  const forRe = /wx:for\s*=\s*"\{\{([\s\S]*?)\}\}"([^>]*)>/g
  const declaredLoopVars = new Set()
  let fm
  while ((fm = forRe.exec(wxml))) {
    const attrs = fm[2]
    const itemAttr = /wx:for-item\s*=\s*"([^"]*)"/.exec(attrs)
    const idxAttr = /wx:for-index\s*=\s*"([^"]*)"/.exec(attrs)
    const itemName = itemAttr ? itemAttr[1] : 'item'
    if (idxAttr) declaredLoopVars.add(idxAttr[1])
    declaredLoopVars.add(itemName)
    if (!itemAttr) {
      // 没声明 item，但同一段里用了 <xxx>.<field> 形式且不是 item/index
      const after = wxml.slice(fm.index, fm.index + 1200)
      const used = new Set()
      const uRe = /\{\{\s*([A-Za-z_$][\w$]*)\s*\./g
      let um
      while ((um = uRe.exec(after))) used.add(um[1])
      const stray = [...used].filter(
        (v) => v !== 'item' && v !== 'index' && !BUILTIN.has(v) && !known.has(v)
      )
      if (stray.length) {
        issues.push({
          line: lineOf(fm.index),
          kind: '循环变量',
          msg: `wx:for 未声明 wx:for-item，却用了 ${stray.map((s) => s + '.*').join('、')}`
        })
      }
    }
  }

  // ── 2. 模板变量 ──
  const localVars = new Set([...declaredLoopVars, 'item', 'index'])
  const unknown = new Map()
  const exprRe = /\{\{([\s\S]*?)\}\}/g
  let em
  while ((em = exprRe.exec(wxml))) {
    let expr = em[1]
    expr = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    const idRe = /(^|[^\w$.])([A-Za-z_$][\w$]*)/g
    let im
    while ((im = idRe.exec(expr))) {
      const id = im[2]
      if (BUILTIN.has(id) || localVars.has(id) || known.has(id)) continue
      if (!unknown.has(id)) unknown.set(id, lineOf(em.index))
    }
  }
  for (const [id, ln] of unknown) {
    issues.push({ line: ln, kind: '模板变量', msg: `{{${id}}} 既不在 data 里，也没被 setData 过` })
  }

  // ── 3. 事件方法 ──
  const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:]?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g
  let bm
  const checked = new Set()
  while ((bm = bindRe.exec(wxml))) {
    const fn = bm[2].trim()
    if (!fn || checked.has(fn)) continue
    checked.add(fn)
    const pat = new RegExp('(?:^|[\\s,{])' + fn.replace(/[$]/g, '\\$') + '\\s*[:(]', 'm')
    if (!pat.test(js)) {
      issues.push({ line: lineOf(bm.index), kind: '事件方法', msg: `bind/catch="${fn}" 在 ${page}.js 里没有定义` })
    }
  }

  if (issues.length) {
    problems += issues.length
    console.log(`\n⚠️  ${page}.wxml  ${issues.length} 个问题`)
    issues
      .sort((a, b) => a.line - b.line)
      .forEach((x) => console.log(`      第${x.line}行 [${x.kind}] ${x.msg}`))
  } else if (VERBOSE) {
    console.log(`✅ ${page}.wxml  干净（data ${dk.keys.size} 字段 / 循环变量 ${declaredLoopVars.size} 个 / 绑定 ${checked.size} 个）`)
  }
}

if (problems) {
  console.log(`\n共 ${problems} 个问题`)
  process.exit(1)
}
console.log(`\n✅ 全部页面模板检查通过（${listPages().length} 个页面）`)
