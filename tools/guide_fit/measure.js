#!/usr/bin/env node
/**
 * 引导卡片「装不装得下」测量器（CDP 精确视口版）
 * ------------------------------------------------------------------
 * 拿 pages/* 里真实的 WXSS + WXML，在 headless Chrome 里按各机型视口渲染，
 * 用 Emulation.setDeviceMetricsOverride 精确控制视口——不用 --window-size，
 * 因为它会被浏览器外框吃掉约 87px，量出来的比例全是错的。
 *
 * 用法：
 *   node tools/guide_fit/measure.js                 # 默认机型矩阵
 *   node tools/guide_fit/measure.js 844x390         # 只量指定视口
 *   node tools/guide_fit/measure.js --json          # 输出原始 JSON
 *   node tools/guide_fit/measure.js --shot out.png  # 顺带截图（可配合 844x390）
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const MP = path.join(ROOT, 'miniprogram')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const TARGETS = [
  {
    key: 'teleprompter',
    wxml: 'pages/teleprompter/teleprompter.wxml',
    wxss: 'pages/teleprompter/teleprompter.wxss',
    marker: 'tp-guide-mask',
    prefix: 'tp-guide-',
    excludeSelector: '.tp-guide',
  },
  {
    key: 'edit',
    wxml: 'pages/edit/edit.wxml',
    wxss: 'pages/edit/edit.wxss',
    marker: 'ed-guide-mask',
    prefix: 'ed-guide-',
    excludeSelector: '.ed-guide',
  },
]

const DEVICES = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 12 mini', w: 375, h: 812 },
  { name: 'iPhone 14', w: 390, h: 844 },
  { name: 'iPhone SE 横屏(真实)', w: 667, h: 375 },
  { name: 'iPhone 14 横屏', w: 844, h: 390 },
  { name: '安卓小屏 360x640', w: 360, h: 640 },
  { name: '安卓小屏横屏 640x360', w: 640, h: 360 },
  { name: '安卓主流 412x915', w: 412, h: 915 },
  { name: '安卓主流横屏 915x412', w: 915, h: 412 },
  { name: '极端矮视口 568x320', w: 568, h: 320 },
  { name: 'iPad mini', w: 768, h: 1024 },
]

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 抽出选择器含 prefix 的全部规则（保留 @media 包裹），顺序不变 */
function pickRules(css, prefix, excludeSelector) {
  const src = stripComments(css)
  const out = []
  let i = 0
  while (i < src.length) {
    const brace = src.indexOf('{', i)
    if (brace < 0) break
    const atIdx = src.indexOf('@media', i)
    const isAt = atIdx >= 0 && atIdx < brace
    let depth = 0
    let j = brace
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (isAt) {
      const cond = src.slice(atIdx, brace).trim()
      const kept = pickRules(src.slice(brace + 1, j), prefix, excludeSelector)
      if (kept.trim()) out.push(`${cond}{\n${kept}\n}`)
    } else {
      const sel = src.slice(i, brace).trim()
      if (sel.includes(prefix) && sel.replace(/\s+/g, ' ') !== excludeSelector) {
        out.push(`${sel}{${src.slice(brace + 1, j)}}`)
      }
    }
    i = j + 1
  }
  return out.join('\n')
}

/** 从 wxml 抠出引导块，去掉指令、标签改名 */
function pickMarkup(wxml, marker) {
  const lines = wxml.split('\n')
  const hit = lines.findIndex((l) => l.includes(marker))
  if (hit < 0) throw new Error(`wxml 里找不到 ${marker}`)
  let s = hit
  while (s > 0 && !lines[s].includes('wx:if')) s--
  let depth = 0
  let e = s
  for (; e < lines.length; e++) {
    depth += (lines[e].match(/<view\b/g) || []).length
    depth -= (lines[e].match(/<\/view>/g) || []).length
    if (depth === 0) break
  }
  return lines
    .slice(s, e + 1)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\swx:if="[^"]*"/g, '')
    .replace(/\swx:else[^\s>]*/g, '')
    .replace(/\s(?:bind|catch)[\w:]*="[^"]*"/g, '')
    .replace(/<view\b/g, '<div')
    .replace(/<\/view>/g, '</div>')
    .replace(/<text\b/g, '<span')
    .replace(/<\/text>/g, '</span>')
    .replace(/<image\b([^>]*?)\/>/g, '<img$1>')
}

function buildHtml(css, markup) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;}
*{box-sizing:border-box}</style>
<style id="fw">${css}</style>
</head><body><div id="page" style="position:absolute;inset:0">
${markup}
</div>
<script>
// 小程序约定：750rpx = 窗口宽度
const K = window.innerWidth / 750
const fw = document.getElementById('fw')
fw.textContent = fw.textContent.replace(/(-?[\\d.]+)rpx/g, (_, n) => (parseFloat(n) * K).toFixed(4) + 'px')

const px = (el, prop) => (el ? Math.round(parseFloat(getComputedStyle(el)[prop]) * 10) / 10 : null)
const box = (el) => {
  const r = el && el.getBoundingClientRect()
  return r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null
}

window.__measure = function () {
  const q = (s) => document.querySelector(s)
  const card  = q('.tp-guide-card, .ed-guide-card')
  const body  = q('.tp-guide-body, .ed-guide-body')
  const btn   = q('.tp-guide-btn, .ed-guide-btn')
  const head  = q('.tp-guide-head, .ed-guide-head')
  const title = q('.tp-guide-title, .ed-guide-title')
  const sub   = q('.tp-guide-sub, .ed-guide-sub')
  const bTxt  = q('.tp-guide-b, .ed-guide-b')
  const dTxt  = q('.tp-guide-d, .ed-guide-d')
  const ico   = q('.tp-guide-ico, .ed-guide-ico')
  const mask  = q('.tp-guide-mask, .ed-guide-mask')
  const cb = box(card), bb = box(body), tb = box(btn), hb = box(head), mb = box(mask)
  const cs = card ? getComputedStyle(card) : null
  const bs = body ? getComputedStyle(body) : null
  const items = [...document.querySelectorAll('.tp-guide-item, .ed-guide-item')]
    .map((el) => Math.round(el.getBoundingClientRect().height))
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    card: cb, head: hb, body: bb, btn: tb,
    maskH: mb ? mb.h : null,
    bodyContentH: body ? body.scrollHeight : null,
    bodyOverflow: body ? Math.max(0, body.scrollHeight - bb.h) : null,
    // 「理想高度」= 头 + 步骤全文 + 按钮 + 内外边距，判断是否被迫内部滚动
    needH: card ? Math.round(
      hb.h + body.scrollHeight + tb.h +
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
      parseFloat(bs.marginTop) + parseFloat(getComputedStyle(btn).marginTop)
    ) : null,
    scrolls: body ? body.scrollHeight > bb.h + 1 : false,
    fits: cb ? cb.top >= -1 && cb.bottom <= window.innerHeight + 1 : false,
    itemHeights: items,
    font: {
      title: px(title, 'fontSize'), sub: px(sub, 'fontSize'),
      stepTitle: px(bTxt, 'fontSize'), stepDesc: px(dTxt, 'fontSize'),
      icon: px(ico, 'fontSize'), btn: px(btn, 'fontSize'),
    },
    pad: cs ? cs.padding : null,
    radius: cs ? cs.borderRadius : null,
    vhUsedPct: cb ? Math.round((cb.h / window.innerHeight) * 1000) / 10 : null,
  }
}
</script></body></html>`
}

// ---------------- CDP ----------------
function launchChrome() {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'guidefit-'))
  const proc = spawn(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--remote-debugging-port=0', `--user-data-dir=${udd}`, 'about:blank',
    ],
    { stdio: 'ignore' }
  )
  const portFile = path.join(udd, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  while (!fs.existsSync(portFile) || fs.readFileSync(portFile, 'utf8').trim().split('\n').length < 2) {
    if (Date.now() > deadline) throw new Error('Chrome 启动超时')
    // 忙等但不睡死：用 atomics 做一个 20ms 的短暂停顿
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  const port = fs.readFileSync(portFile, 'utf8').trim().split('\n')[0]
  return { proc, port: +port, udd }
}

async function getPageWs(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('拿不到 page target')
}

function makeClient(ws) {
  let id = 0
  const pending = new Map()
  const opened = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error('WS 错误: ' + (e.message || ''))))
  })
  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    } catch {
      return
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  return {
    opened,
    send(method, params = {}) {
      const mid = ++id
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject })
        ws.send(JSON.stringify({ id: mid, method, params }))
        setTimeout(() => {
          if (pending.has(mid)) {
            pending.delete(mid)
            reject(new Error(`${method} 超时`))
          }
        }, 20000)
      })
    },
  }
}

/**
 * 跑一遍测量。返回 { all, bad, rows }，供 CLI 与测试复用。
 * @param {Array<{name:string,w:number,h:number}>} plan
 * @param {{shotPath?:string, quiet?:boolean}} opts
 */
async function run(plan, opts = {}) {
  const { shotPath = null, quiet = false } = opts
  const { proc, port, udd } = launchChrome()
  const wsUrl = await getPageWs(port)
  const ws = new WebSocket(wsUrl)
  const cdp = makeClient(ws)
  await cdp.opened
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const all = {}
  const rows = []
  const tmpHtml = path.join(udd, 'page.html')
  try {
    for (const t of TARGETS) {
      const css = pickRules(fs.readFileSync(path.join(MP, t.wxss), 'utf8'), t.prefix, t.excludeSelector)
      const markup = pickMarkup(fs.readFileSync(path.join(MP, t.wxml), 'utf8'), t.marker)
      fs.writeFileSync(tmpHtml, buildHtml(css, markup), 'utf8')
      all[t.key] = []
      if (!quiet) {
        console.log(`\n=== ${t.key} 引导 ===`)
        console.log(
          '机型'.padEnd(22) + '视口'.padEnd(10) + '卡片WxH'.padEnd(12) +
          '理想H'.padEnd(7) + '占屏'.padEnd(7) + '步骤溢'.padEnd(7) + '按钮底'.padEnd(8) + '结论'
        )
      }
      for (const dv of plan) {
        // mobile:false —— 小程序布局宽度＝设备宽度，若开 mobile 模拟，
        // 缺少 viewport meta 时 Chrome 会把布局宽度钉成 980px，量出来全是错的。
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: dv.w, height: dv.h, deviceScaleFactor: 1, mobile: false,
        })
        await cdp.send('Page.navigate', { url: 'file://' + tmpHtml })
        // 等一次「事件循环 + 布局」
        await new Promise((r) => setTimeout(r, 260))
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: 'JSON.stringify(window.__measure ? window.__measure() : null)',
          returnByValue: true,
        })
        const r = JSON.parse(result.value)
        if (!r) throw new Error(`${dv.name} 测量返回空`)
        const fail = !r.fits || r.scrolls
        all[t.key].push({ device: dv.name, ...r })
        rows.push({ target: t.key, device: dv.name, fail, ...r })
        if (!quiet) {
          console.log(
            dv.name.padEnd(22) +
            `${r.vw}x${r.vh}`.padEnd(10) +
            `${r.card.w}x${r.card.h}`.padEnd(12) +
            String(r.needH).padEnd(7) +
            `${r.vhUsedPct}%`.padEnd(7) +
            String(r.bodyOverflow).padEnd(7) +
            String(r.btn.bottom).padEnd(8) +
            (fail ? (r.scrolls ? '❌ 步骤被裁(内部滚动)' : '❌ 溢出视口') : '✅ 完整可见')
          )
        }
        if (shotPath) {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
          const out = shotPath.includes('%s') ? shotPath.replace('%s', t.key) : shotPath
          fs.writeFileSync(out, Buffer.from(data, 'base64'))
          if (!quiet) console.log('  截图 →', out)
        }
      }
    }
  } finally {
    try { ws.close() } catch {}
    try { proc.kill() } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }) } catch {}
  }
  return { all, rows, bad: rows.filter((r) => r.fail).length }
}

async function main() {
  const argv = process.argv.slice(2)
  const only = argv.find((a) => /^\d+x\d+$/.test(a))
  const asJson = argv.includes('--json')
  const shotIdx = argv.indexOf('--shot')
  const shotPath = shotIdx >= 0 ? argv[shotIdx + 1] : null
  if (!fs.existsSync(CHROME)) {
    console.error('找不到 Chrome：' + CHROME)
    process.exit(1)
  }
  const plan = only ? [{ name: '自定义', w: +only.split('x')[0], h: +only.split('x')[1] }] : DEVICES
  const { all, bad } = await run(plan, { shotPath, quiet: asJson })
  if (asJson) console.log(JSON.stringify(all, null, 1))
  else console.log(`\n合计不达标 ${bad} 项`)
  process.exitCode = bad ? 1 : 0
}

module.exports = { run, pickRules, pickMarkup, TARGETS, DEVICES, CHROME, MP }

if (require.main === module) {
  main().catch((e) => {
    console.error('测量失败:', e.message)
    process.exit(1)
  })
}
