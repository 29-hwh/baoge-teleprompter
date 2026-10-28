/**
 * 真模板预览：把 miniprogram 里的 .wxml + .wxss 直接渲染成 HTML 再截图。
 * ============================================================================
 * 为什么要重做（2026-10-28）：
 *   旧预览脚本是手写 HTML 片段，模板写错了它照样渲染得漂漂亮亮。
 *   结果提词页 `<view wx:for="{{lines}}">` 漏了 wx:for-item="line"、
 *   整页一个字都没有，而「截图复核」却显示一切正常。
 *
 * 本工具的铁律：不再重写任何结构，只做 WXML → HTML 的机械翻译，
 *   页面长什么样由真实模板决定，写错了就渲染不出来，立刻暴露。
 *
 * 用法：
 *   node tools/render_page.js teleprompter            # 提词页（静止态）
 *   node tools/render_page.js teleprompter --menu     # 打开设置菜单
 *   node tools/render_page.js teleprompter --playing  # 播放中
 *   node tools/render_page.js index                   # 首页（有台本）
 *   node tools/render_page.js index --empty           # 首页空态
 * 输出：/tmp/page_<name>.html（再用 tools/guide_fit/shot_page.js 截图）
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const ARGS = process.argv.slice(2)
const PAGE = ARGS[0] || 'teleprompter'
const has = (f) => ARGS.includes(f)

/* ==========================================================================
 * 一、WXML 解析
 * ======================================================================== */

function parseAttrs(s) {
  const out = {}
  const re = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g
  let m
  while ((m = re.exec(s))) {
    if (!m[1]) continue
    out[m[1]] = m[2] === undefined ? true : m[2]
  }
  return out
}

function parse(src) {
  const root = { type: 'root', name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re =
    /<!--[\s\S]*?-->|<\/([A-Za-z][\w-]*)\s*>|<([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let last = 0
  let m
  const pushText = (t) => {
    if (t) stack[stack.length - 1].children.push({ type: 'text', text: t })
  }
  while ((m = re.exec(src))) {
    if (m.index > last) pushText(src.slice(last, m.index))
    last = re.lastIndex
    if (m[0].startsWith('<!--')) continue
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[1]) {
          stack.length = i
          break
        }
      }
    } else {
      const el = {
        type: 'el',
        name: m[2],
        attrs: parseAttrs(m[3]),
        children: []
      }
      stack[stack.length - 1].children.push(el)
      if (!m[4] && !/^(input|image|img|br|hr|icon)$/.test(m[2])) stack.push(el)
    }
  }
  if (last < src.length) pushText(src.slice(last))
  return root
}

/* ==========================================================================
 * 二、表达式求值
 * ======================================================================== */

const exprCache = new Map()
function evalExpr(expr, scope) {
  let fn = exprCache.get(expr)
  if (!fn) {
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('$s', 'with($s){ return (' + expr + ') }')
    } catch (e) {
      fn = () => undefined
    }
    exprCache.set(expr, fn)
  }
  try {
    return fn(scope)
  } catch (e) {
    return undefined
  }
}

/** 把含 {{}} 的字符串求值；整串就是一个表达式时保留原始类型 */
function interp(str, scope) {
  if (typeof str !== 'string') return str
  const only = str.match(/^\s*\{\{([\s\S]*)\}\}\s*$/)
  if (only && str.indexOf('{{') === only.index) {
    const v = evalExpr(only[1], scope)
    return v === undefined || v === null ? '' : v
  }
  return str.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope)
    return v === undefined || v === null ? '' : String(v)
  })
}

/* ==========================================================================
 * 三、渲染
 * ======================================================================== */

const TAG_MAP = {
  view: 'div',
  text: 'span',
  'scroll-view': 'div',
  block: null, // 只做作用域/条件，不产出标签
  image: 'img',
  'rich-text': 'div',
  navigator: 'a',
  switch: 'div',
  slider: 'div',
  picker: 'div'
}

const DROP_ATTR = /^(wx:|bind|catch|capture-|mut-bind|data-|hover-|scroll-|enhanced$|show-scrollbar|enable-|throttle|refresher|using-stats|scroll-y$|scroll-x$)/

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function isWhitespaceText(n) {
  return n.type === 'text' && !n.text.trim()
}

function renderChildren(nodes, scope) {
  let html = ''
  let chain = null // { matched: boolean } 用于 wx:if / elif / else
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (isWhitespaceText(n)) {
      html += renderChildren([], scope) // 空白不打断条件链
      continue
    }
    if (n.type === 'text') {
      chain = null
      html += esc(interp(n.text, scope)).replace(/&lt;br\s*\/?&gt;/g, '<br>')
      continue
    }
    const a = n.attrs

    // ── wx:for 优先于 wx:if（与官方一致：先循环，再逐项判断） ──
    if (a['wx:for'] !== undefined) {
      const listExpr = String(a['wx:for']).replace(/^\{\{|\}\}$/g, '')
      const list = evalExpr(listExpr, scope) || []
      const itemName = a['wx:for-item'] || 'item'
      const idxName = a['wx:for-index'] || 'index'
      const arr = Array.isArray(list) ? list : []
      const rest = Object.assign({}, n)
      delete rest.attrs['wx:for']
      for (let k = 0; k < arr.length; k++) {
        const child = Object.create(scope)
        child[itemName] = arr[k]
        child[idxName] = k
        html += renderChildren([rest], child)
      }
      chain = null
      continue
    }

    // ── 条件链 ──
    const hasIf = a['wx:if'] !== undefined
    const hasElif = a['wx:elif'] !== undefined
    const hasElse = a['wx:else'] !== undefined
    if (hasIf) {
      const v = !!interp(a['wx:if'], scope)
      chain = { matched: v }
      if (!v) continue
    } else if (hasElif) {
      if (!chain) continue
      if (chain.matched) continue
      const v = !!interp(a['wx:elif'], scope)
      if (v) chain.matched = true
      else continue
    } else if (hasElse) {
      if (!chain) continue
      if (chain.matched) continue
      chain.matched = true
    } else {
      chain = null
    }

    html += renderEl(n, scope)
  }
  return html
}

function renderEl(el, scope) {
  const tag = TAG_MAP[el.name] === undefined ? el.name : TAG_MAP[el.name]
  const inner = () => renderChildren(el.children, scope)
  if (tag === null) return inner() // <block>

  const attrs = []
  let extraStyle = ''
  for (const k of Object.keys(el.attrs)) {
    if (k === 'wx:if' || k === 'wx:elif' || k === 'wx:else' || k === 'wx:for' || k === 'wx:key') continue
    if (k === 'wx:for-item' || k === 'wx:for-index') continue
    if (k === 'scroll-y') {
      extraStyle += 'overflow-y:auto;'
      continue
    }
    if (k === 'scroll-x') {
      extraStyle += 'overflow-x:auto;'
      continue
    }
    if (DROP_ATTR.test(k)) continue
    let v = el.attrs[k]
    if (typeof v === 'string') v = interp(v, scope)
    if (v === '' || v === false) continue
    if (k === 'class') attrs.push(`class="${esc(v)}"`)
    else if (k === 'style') attrs.push(`style="${esc(v + extraStyle)}"`)
    else if (k === 'src') attrs.push(`src="${esc(v)}"`)
    else attrs.push(`data-${k}="${esc(v)}"`)
  }
  if (extraStyle && !attrs.some((x) => x.startsWith('style='))) attrs.push(`style="${extraStyle}"`)

  if (/^(input|img|br|hr)$/.test(tag)) return `<${tag} ${attrs.join(' ')}>`
  return `<${tag} ${attrs.join(' ')}>${inner()}</${tag}>`
}

function render(wxmlSrc, data) {
  const tree = parse(wxmlSrc)
  return renderChildren(tree.children, Object.assign({}, data))
}

/* ==========================================================================
 * 四、WXSS → CSS
 * ======================================================================== */

function wxssToCss(src, baseWidth) {
  const ratio = baseWidth / 750
  return src
    .replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * ratio).toFixed(2)}px`)
    .replace(/(^|\n)\s*page\s*\{/g, '$1body{')
}

/* ==========================================================================
 * 五、页面数据：真的把页面跑起来，拿到真实 data
 * ======================================================================== */

function makeHarness(opts) {
  const o = opts || {}
  let T = 1780000000000
  const timers = []
  let seq = 1
  global.setTimeout = (fn, ms) => {
    const id = seq++
    timers.push({ id, fireAt: T + (ms || 0), fn })
    return id
  }
  global.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }
  global.setInterval = (fn, ms) => {
    const id = seq++
    timers.push({ id, fireAt: T + (ms || 0), fn })
    return id
  }
  global.clearInterval = (id) => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }
  global.requestAnimationFrame = (cb) => {
    const id = seq++
    timers.push({ id, fireAt: T + 16, fn: cb })
    return id
  }
  global.cancelAnimationFrame = () => {}
  global.Date.now = () => T

  const mem = {}
  const W = o.width || 375
  const H = o.height || 812
  const win = { windowWidth: W, windowHeight: H, statusBarHeight: 44, pixelRatio: 3 }
  const wx = {
    getWindowInfo: () => Object.assign({}, win),
    getSystemInfoSync: () => Object.assign({}, win),
    getStorageSync: (k) => mem[k],
    setStorageSync: (k, v) => {
      mem[k] = v
    },
    setKeepScreenOn() {},
    setScreenBrightness() {},
    setPageOrientation() {},
    navigateTo() {},
    navigateBack() {},
    showModal() {},
    showToast: (x) => console.log('  [toast]', (x && x.title) || x),
    requirePrivacyAuthorize: (x) => {
      if (x && x.success) x.success()
    },
    getSetting: (x) => {
      if (x && x.success) x.success({ authSetting: {} })
    },
    getRecorderManager: () => ({
      start() {},
      stop() {},
      onStart() {},
      onStop() {},
      onError() {},
      onFrameRecorded() {}
    }),
    createSelectorQuery: () => ({
      in() {
        return this
      },
      select() {
        return this
      },
      selectAll() {
        return this
      },
      boundingClientRect(cb) {
        this._cb = cb
        return this
      },
      exec() {
        if (this._cb) this._cb(null)
      }
    }),
    pageScrollTo() {},
    stopPullDownRefresh() {}
  }
  global.wx = wx
  return { wx, mem, Win: win }
}

const SAMPLE = [
  '第一场 办公室 日',
  '',
  '林晚：小陈，这份报表今天必须发出去，客户那边已经催了两遍。',
  '陈默：姐，财务还差一组数，我盯了一上午了。',
  '林晚：那就先发，缺的明天补上，别让人家等。',
  '',
  '第二场 走廊 夜',
  '陈默：她今天状态不太对，一整天没怎么说话。',
  '王二：都这样，过两天就好了。'
].join('\n')

function buildTeleprompter() {
  // --landscape 时按 iPhone 横屏尺寸跑，验证横屏抽屉（含被微信胶囊遮挡的头部）
  const h = makeHarness(has('--landscape') ? { width: 812, height: 375 } : {})
  // 首次引导会盖住台词，截图默认跳过（要看引导时加 --guide）
  if (!has('--guide')) h.wx.setStorageSync('baoge_guide_tp', 1)
  const prefsEngine = require(path.join(MP, 'engine/prefs.js'))
  const appMock = {
    globalData: { prefs: prefsEngine.load(), currentScript: null },
    updatePrefs(p) {
      this.globalData.prefs = prefsEngine.patch(p)
    }
  }
  global.getApp = () => appMock
  let def = null
  global.Page = (d) => {
    def = d
  }
  const store = require(path.join(MP, 'engine/store.js'))
  delete require.cache[require.resolve(path.join(MP, 'pages/teleprompter/teleprompter.js'))]
  require(path.join(MP, 'pages/teleprompter/teleprompter.js'))

  // --long：造一份 400 行原稿（断行后约 1600 视觉行）验证超长稿降级模式
  const SCRIPT = has('--long')
    ? Array.from({ length: 400 }, (_, i) => `林晚：这是第 ${i + 1} 句台词，用来验证超长稿的降级渲染是否正常。`).join('\n')
    : SAMPLE
  const s = store.create(has('--long') ? '整季剧本（超长稿）' : '短剧《归期》第一集', SCRIPT)
  store.save(s)

  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  inst.onLoad({ id: s.id })
  inst.onReady()
  if (has('--menu')) inst.onOpenMenu()
  if (has('--playing')) inst.onTapPlay()
  return inst
}

function buildSettings() {
  makeHarness({})
  global.getApp = () => ({ globalData: { prefs: {} }, updatePrefs: (p) => p })
  let def = null
  global.Page = (d) => {
    def = d
  }
  const store = require(path.join(MP, 'engine/store.js'))
  // 造两篇台本，让「台本数量」不是 0（截图能看出这块渲染是否正常）
  ;['第一集 归期', '第二集 旧账'].forEach((t) => store.save(store.create(t, '林晚：你好')))
  require(path.join(MP, 'pages/settings/settings.js'))
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  inst.onLoad({})
  inst.onShow()
  return inst
}

function buildIndex() {  const h = makeHarness({})
  const prefsEngine = require(path.join(MP, 'engine/prefs.js'))
  const appMock = {
    globalData: { prefs: prefsEngine.load(), currentScript: null },
    updatePrefs(p) {
      this.globalData.prefs = prefsEngine.patch(p)
    }
  }
  global.getApp = () => appMock
  let def = null
  global.Page = (d) => {
    def = d
  }
  const store = require(path.join(MP, 'engine/store.js'))
  if (!has('--empty')) {
    const f = store.createFolder('短剧《归期》拆分')
    ;['第一集 归期', '第二集 旧账', '第三集 门缝'].forEach((t, i) => {
      const s = store.create(t, SAMPLE)
      s.folderId = f.id
      s.createdAt = Date.now() + i
      store.save(s)
    })
    ;['口播 · 新品开场', '婚礼致辞（备用）'].forEach((t) => {
      const s = store.create(t, SAMPLE)
      store.save(s)
    })
  }
  delete require.cache[require.resolve(path.join(MP, 'pages/index/index.js'))]
  require(path.join(MP, 'pages/index/index.js'))
  const inst = Object.create(def)
  inst.data = JSON.parse(JSON.stringify(def.data))
  inst.setData = function (patch) {
    if (patch && typeof patch === 'object') Object.assign(this.data, patch)
  }
  if (typeof inst.onLoad === 'function') inst.onLoad({})
  inst.onShow()
  return inst
}

/* ==========================================================================
 * 六、主流程
 * ======================================================================== */

const pageDir = path.join(MP, 'pages', PAGE)
const page =
  PAGE === 'index' ? buildIndex() : PAGE === 'settings' ? buildSettings() : buildTeleprompter()
// 托盘默认是收起的，加 --palette 让它展开，方便核对配色面板
if (PAGE === 'teleprompter' && has('--palette')) page.data.colorPicker = 'all'

const wxml = fs.readFileSync(path.join(pageDir, PAGE + '.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(pageDir, PAGE + '.wxss'), 'utf8')

const W = 375
const H = 812
const appCss = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8')
const body = render(wxml, page.data)

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
${wxssToCss(appCss, W)}
${wxssToCss(wxss, W)}
html,body{margin:0;padding:0;background:${
  PAGE === 'settings' ? '#000000' : '#000'
};-webkit-font-smoothing:antialiased;}
body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;${
  PAGE === 'index' ? 'height:812px;overflow:hidden;' : ''
}}
img{max-width:100%;}
</style></head>
<body>${
  PAGE === 'index'
    ? `<div style="height:812px;overflow:hidden;position:relative">${body}</div>`
    : body
}</body></html>`

const outFile = `/tmp/page_${PAGE}${has('--menu') ? '_menu' : ''}${has('--empty') ? '_empty' : ''}${has('--playing') ? '_playing' : ''}.html`
fs.writeFileSync(outFile, html, 'utf8')

// 关键自检：模板里若一行台词都没渲染出来，这里立刻报出来
const rendered = (html.match(/class="tp-body[ "]/g) || []).length
console.log(`写出 ${outFile}`)
console.log(`data.lines = ${(page.data.lines || []).length}，模板渲染出的 .tp-body 节点 = ${rendered}`)
if (PAGE === 'teleprompter' && (page.data.lines || []).length > 0 && rendered === 0) {
  console.error('❌ 数据有台词，模板却没渲染出任何 .tp-body —— 模板绑定有问题')
  process.exit(1)
}
