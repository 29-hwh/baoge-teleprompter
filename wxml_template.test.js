/**
 * WXML 模板契约测试
 * ============================================================================
 * 背景（2026-10-28）：提词页整页没有台词，根因是
 *   <view wx:for="{{lines}}" wx:for-index="li"> … {{line.body}} …
 * 少了 `wx:for-item="line"`。WXML 不报错，只把 `line` 求值成 undefined，
 * 于是每行都渲染成空标签 —— 数据层、单元测试、手写 HTML 预览全都发现不了。
 *
 * 这组断言把「模板变量必须声明」钉死，避免同类问题再次漏到真机：
 *   1) tools/wxml_lint.js 对全部 wxml 零告警（含「循环变量未声明」检查）
 *   2) 提词页两处台词循环都必须显式声明 wx:for-item="line"
 *   3) 台词文本节点必须真的绑定在 line 上（防止有人改回 item 却忘了改引用）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname)
const TP = path.join(ROOT, 'miniprogram/pages/teleprompter/teleprompter.wxml')

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name)
  } else {
    fail++
    console.log('  ❌ ' + name + (detail ? '\n      ' + detail : ''))
  }
}

console.log('\n══════ 1. 全量 WXML 静态体检：循环变量必须声明 ══════')
{
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tools/wxml_lint.js')], {
      encoding: 'utf8'
    })
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '')
    code = e.status === undefined ? 1 : e.status
  }
  ok('tools/wxml_lint.js 零告警（无「循环变量未声明」）', code === 0, out.trim())
  ok('确实扫到了全部页面（wxml 数 ≥ 5）', /扫描 (\d+) 个 wxml/.test(out) && Number(RegExp.$1) >= 5, out.trim())
}

console.log('\n══════ 2. 提词页台词循环：必须声明 line 为循环项 ══════')
const wxml = fs.readFileSync(TP, 'utf8')
{
  // 2026-10-28 恢复逐帧内核后，台词循环由「全量 lines」改为「虚拟列表 visibleLines」，
  // 角色名由独立胶囊改为内联 rolePrefix。断言同步跟进。
  const loops = wxml.match(/wx:for="\{\{visibleLines\}\}"[^>]*>/g) || []
  ok('提词页有台词循环（≥1 处）', loops.length >= 1, `实际 ${loops.length} 处`)
  ok(
    '每处台词循环都声明了 wx:for-item="line"',
    loops.length > 0 && loops.every((t) => /wx:for-item="line"/.test(t)),
    loops.filter((t) => !/wx:for-item="line"/.test(t)).join('\n')
  )
  ok(
    '台词正文绑定在 line.body 上（内联渲染）',
    /\{\{\s*line\.body\s*\}\}/.test(wxml)
  )
  ok(
    '角色名绑定在 line.rolePrefix 上（内联彩色，缺它则角色名消失）',
    /\{\{\s*line\.rolePrefix\s*\}\}/.test(wxml)
  )
}

console.log('\n══════ 3. 反向自检：检查器真的能抓到该 bug ══════')
{
  // 把正确写法改回错误写法，喂给检查器的判定函数（复制一份到临时目录跑）
  const os = require('os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wxml-lint-'))
  try {
    fs.mkdirSync(path.join(tmp, 'miniprogram/pages/t'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'miniprogram/pages/t/t.wxml'),
      '<view wx:for="{{lines}}" wx:key="_i" wx:for-index="li"><view>{{line.body}}</view></view>\n'
    )
    fs.copyFileSync(path.join(ROOT, 'tools/wxml_lint.js'), path.join(tmp, 'tools/wxml_lint.js'))
    let out = ''
    let code = 0
    try {
      out = execFileSync(process.execPath, [path.join(tmp, 'tools/wxml_lint.js')], { encoding: 'utf8' })
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '')
      code = e.status === undefined ? 1 : e.status
    }
    ok('错误写法（缺 wx:for-item）被判为可疑并 exit 1', code === 1, `exit=${code}`)
    ok('报告点名了未声明的变量 line', /用到：line|line/.test(out), out.trim())
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n══════ page_lint：变量 / 绑定 / 注释解析 三道静态体检 ══════')
{
  // 1) 真实页面必须全绿
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tools/page_lint.js'), '--verbose'], { encoding: 'utf8' })
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '')
    code = e.status === undefined ? 1 : e.status
  }
  ok('现有 5 个页面模板全部通过', code === 0, out.trim().split('\n').slice(-6).join('\n'))

  // 提词页 data 字段数必须解析出来（曾因正则漏匹配，返回 0 个导致「全部已声明」的假通过）
  const m = /teleprompter\.wxml\s+干净（data (\d+) 字段/.exec(out)
  ok('提词页 data 字段被正确解析（≥ 60，不是 0）', !!m && Number(m[1]) >= 60,
    m ? `解析到 ${m[1]} 个字段` : '未匹配到数据统计行')

  // 2) 反向自检：注释后的字段不能被吞掉
  const os = require('os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-lint-'))
  try {
    fs.mkdirSync(path.join(tmp, 'miniprogram/pages/t'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tools'), { recursive: true })
    // data 里有注释、有模板字符串、有数组；模板用了注释后面的字段 + 一个不存在的变量 + 一个不存在的方法
    fs.writeFileSync(
      path.join(tmp, 'miniprogram/pages/t/t.js'),
      [
        'Page({',
        '  data: {',
        '    list: [],',
        '    // 这一行注释不能把下面的字段吞掉',
        "    version: 'v' + '1.0.0',",
        '    // 页脚',
        '    copyright: `© ${2026} 宝哥`',
        '  },',
        '  onTapOk() {}',
        '})'
      ].join('\n')
    )
    fs.writeFileSync(
      path.join(tmp, 'miniprogram/pages/t/t.wxml'),
      [
        '<view bindtap="onTapOk">{{version}}{{copyright}}</view>',
        '<view bindtap="onTapMissing">x</view>',
        '<view>{{noSuchField}}</view>'
      ].join('\n')
    )
    fs.copyFileSync(path.join(ROOT, 'tools/page_lint.js'), path.join(tmp, 'tools/page_lint.js'))
    let o2 = ''
    let c2 = 0
    try {
      o2 = execFileSync(process.execPath, [path.join(tmp, 'tools/page_lint.js')], { encoding: 'utf8' })
    } catch (e) {
      o2 = (e.stdout || '') + (e.stderr || '')
      c2 = e.status === undefined ? 1 : e.status
    }
    ok('注释后的 version / copyright 不被误报', c2 === 1 && !/version|copyright/.test(o2.split('\n').filter((l) => /模板变量/.test(l)).join('')),
      o2.trim())
    ok('拼错的模板变量被点名', /noSuchField/.test(o2), o2.trim())
    ok('不存在的事件方法被点名', /onTapMissing/.test(o2), o2.trim())
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n' + '─'.repeat(56))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
