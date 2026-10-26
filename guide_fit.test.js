// 锁定「首次使用引导」在各屏幕尺寸下都完整可见（不溢出视口、步骤不被裁切）
//
// 背景：原实现把引导尺寸写成 rpx，而 rpx 是按**屏宽**换算的 ——
// 提词页 pageOrientation 是 auto，横屏 844px 宽时 1rpx≈1.125px，
// 标题/内边距/行距整体放大 2.25 倍，可用高度却只剩 390px，
// 「开始提词」按钮被挤出屏幕、步骤区被迫内部滚动（用户看不到全部步骤）。
//
// 这套测试做两层检查：
//   A. 静态：引导样式必须带 vmin 基准（rpx 只能当兜底），且布局三件套齐全；
//   B. 动态：用 tools/guide_fit/measure.js 在无头 Chrome 里按真实视口渲染并测量。
//      本机没有 Chrome 时只跑 A，并明确打印「跳过」而不是假装通过。
//
// 单独跑：node guide_fit.test.js
// 看细节：node tools/guide_fit/measure.js

const fs = require('fs')
const path = require('path')
const { run, TARGETS, DEVICES, CHROME, MP } = require('./tools/guide_fit/measure')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? `  → ${extra}` : ''))
  }
}

// ---------- A. 静态检查 ----------
console.log('\n=== A. 引导样式基准（vmin 覆盖 rpx）===')

const GUIDES = [
  { key: 'teleprompter', wxss: 'pages/teleprompter/teleprompter.wxss', wxml: 'pages/teleprompter/teleprompter.wxml', mask: 'tp-guide-mask' },
  { key: 'edit', wxss: 'pages/edit/edit.wxss', wxml: 'pages/edit/edit.wxml', mask: 'ed-guide-mask' },
]

for (const g of GUIDES) {
  const css = fs.readFileSync(path.join(MP, g.wxss), 'utf8')
  const wxml = fs.readFileSync(path.join(MP, g.wxml), 'utf8')
  const p = g.key === 'edit' ? 'ed-guide' : 'tp-guide'

  // 字号类规则必须写成「rpx 兜底 + vmin 覆盖」两行
  const fontRules = ['title', 'sub', 'b', 'd', 'btn']
  const missingVmin = fontRules.filter((suffix) => {
    const re = new RegExp(`\\.${p}-${suffix}\\s*\\{([^}]*)\\}`, 'm')
    const m = css.match(re)
    if (!m) return true
    const body = m[1]
    const hasRpx = /font-size:\s*[\d.]+rpx/.test(body)
    const hasVmin = /font-size:\s*[\d.]+vmin/.test(body)
    return !(hasRpx && hasVmin)
  })
  ok(`${g.key}：5 处字号均为「rpx 兜底 + vmin 覆盖」`, missingVmin.length === 0,
    missingVmin.length ? `缺 vmin 或 rpx 兜底：${missingVmin.join(', ')}` : '')

  // 页面内**每一个** vmin 声明，其前面紧邻的那条声明必须是同属性兜底（rpx/px/vh），
  // 否则低版本 WebView 不认 vmin 时会连兜底一起没有，样式直接塌掉。
  // 判定方式：回到所在声明块的 { 之后，取 m.index 之前的最后一条非空声明比属性名。
  // （不能只看上一行 —— 声明可能和兜底同行，也可能兜底在上一行、vmin 在新行。）
  const noFallback = []
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([\w-]+):\s*[\d.]+vmin;/g
  let m
  while ((m = re.exec(cssNoComment))) {
    const blockStart = Math.max(cssNoComment.lastIndexOf('{', m.index), cssNoComment.lastIndexOf('}', m.index))
    const prevDecls = cssNoComment.slice(blockStart + 1, m.index).split(';')
    const prev = prevDecls
      .map((s) => s.trim())
      .filter(Boolean)
      .pop()
    const line = cssNoComment.slice(0, m.index).split('\n').length
    if (!prev || !prev.startsWith(`${m[1]}:`)) noFallback.push(`${m[1]}@L${line}`)
  }
  ok(`${g.key}：每个 vmin 前面都有同属性兜底`, noFallback.length === 0,
    noFallback.length ? `缺兜底：${noFallback.slice(0, 5).join(' / ')}` : '')

  // 卡片必须有宽度上限 + 高度上限，否则宽屏摊大 / 矮屏溢出
  const cardRule = css.match(new RegExp(`\\.${p}-card\\s*\\{([^}]*)\\}`, 'm'))
  const cardBody = cardRule ? cardRule[1] : ''
  ok(`${g.key}：卡片有 80vmin 宽度上限`, /max-width:\s*[\d.]+vmin/.test(cardBody))
  ok(`${g.key}：卡片有 88vh 高度上限`, /max-height:\s*88vh/.test(cardBody))

  // 三段式：标题不滚 / 步骤区可滚 / 按钮不滚
  ok(`${g.key}：标题区固定不滚`, new RegExp(`\\.${p}-head\\s*\\{[^}]*flex-shrink:\\s*0`).test(css))
  ok(`${g.key}：步骤区可滚且 min-height:0`, new RegExp(`\\.${p}-body\\s*\\{[^}]*min-height:\\s*0`).test(css)
    && new RegExp(`\\.${p}-body\\s*\\{[^}]*overflow-y:\\s*auto`).test(css))
  ok(`${g.key}：主按钮吸底不滚`, new RegExp(`\\.${p}-btn\\s*\\{[^}]*flex-shrink:\\s*0`).test(css))

  // 序号徽标必须显式染色，不能靠继承（否则会和卡片里其它元素串色）。
  // 2026-10-27：图标位（-ico）改成圆形序号徽标（-num），断言跟着改口径。
  ok(`${g.key}：序号徽标有显式 color`, new RegExp(`\\.${p}-num\\s*\\{[^}]*color:`).test(css))

  // 序号必须是纯数字 1..N（不能换成 ①②③ 这类带圈字符 —— 部分安卓字体把它渲染成
  // 彩色 emoji 或方框，也不受 font-size 控制大小），且徽标数量与步骤数一致。
  const nums = (wxml.match(new RegExp(`class="${p}-num"[^>]*>([^<]*)<`, 'g')) || [])
    .map((s) => s.replace(/^[^>]*>/, '').replace(/<$/, ''))
  const expectNums = nums.map((_, i) => String(i + 1))
  ok(`${g.key}：序号是连续的纯数字 1…N`, nums.length >= 2 && nums.join(',') === expectNums.join(','),
    `实际 [${nums.join(',')}]`)

  // U+23E9(U+23F0 系列) 是强制彩色 emoji，不跟随 color，禁止出现在图标/徽标位
  ok(`${g.key}：徽标位没有强制彩色 emoji`, !new RegExp(`class="${p}-num"[^>]*>[⏩⏰⏳]`).test(wxml))

  // 引导块结构：标题 / 副标 / 步骤 / 按钮齐备
  const items = (wxml.match(new RegExp(`class="${p}-item"`, 'g')) || []).length
  ok(`${g.key}：步骤数 ${items} 条（≥2）`, items >= 2, `实际 ${items}`)
  ok(`${g.key}：有导出回调 bindtap`, new RegExp(`class="${p}-btn"\\s+bindtap="`).test(wxml))
  ok(`${g.key}：入口受开关注解`, wxml.includes('wx:if="{{') && wxml.includes(g.mask))
}

// ---------- A2. 编辑页分色示例：颜色必须等于真实调色板 ----------
// 示例是「照我这样写就能看到这个效果」的承诺。如果示例写死两个颜色、而 role.js 的调色板
// 后来改了，用户照着写却看到另一种颜色 —— 示例就从帮助变成了误导。所以这里把
// 「示例颜色 ⊆ PALETTE_DARK 前两位」钉死，调色板一动测试就会红。
console.log('\n=== A2. 引导示例与真实调色板一致 ===')
{
  const ROLE_JS = fs.readFileSync(path.join(MP, 'engine/role.js'), 'utf8')
  const paletteBlock = (ROLE_JS.match(/const PALETTE_DARK = \[([\s\S]*?)\]/) || [, ''])[1]
  const palette = (paletteBlock.match(/#[0-9A-Fa-f]{6}/g) || []).map((c) => c.toUpperCase())
  const ED_WXML = fs.readFileSync(path.join(MP, 'pages/edit/edit.wxml'), 'utf8')
  const demoColors = (ED_WXML.match(/class="ed-guide-demo-name"[^>]*color:\s*(#[0-9A-Fa-f]{6})/g) || [])
    .map((s) => (s.match(/#[0-9A-Fa-f]{6}/) || [''])[0].toUpperCase())

  ok('编辑页引导带分色示例，且给了两个角色名', demoColors.length === 2, `实际 ${demoColors.length} 个`)
  ok('示例颜色全部取自 PALETTE_DARK（照引导写 = 看到同款颜色）',
    demoColors.length > 0 && demoColors.every((c) => palette.includes(c)),
    `示例 [${demoColors.join(',')}] 调色板 [${palette.slice(0, 3).join(',')}…]`)
  ok('两个角色名用了不同颜色（同色就看不出"分色"）',
    new Set(demoColors).size === demoColors.length)

  // 同一页的 textarea placeholder 里本来就有一套示例（林晚 / 顾辞）。
  // 引导若另起一套名字，等于让用户先后学两遍不同样例 —— 必须收敛成同一套。
  const ph = (ED_WXML.match(/placeholder="粘贴台词[\s\S]*?"/) || [''])[0]
  const demoNames = [...ED_WXML.matchAll(/class="ed-guide-demo-name"[^>]*>([^<]+)</g)].map((m) => m[1])
  ok('示例角色名与输入框 placeholder 是同一套（不让人学两遍）',
    demoNames.length > 0 && ph !== '' && demoNames.every((n) => ph.includes(n)),
    `示例 [${demoNames.join(',')}] / placeholder ${ph.slice(0, 40)}`)
}

// ---------- B. 动态渲染测量 ----------
;(async () => {
  console.log('\n=== B. 真视口渲染测量 ===')
  if (!fs.existsSync(CHROME)) {
    console.log(`  ⚠ 跳过：本机没有 Chrome（${CHROME}）`)
    console.log('    静态检查通过，但「各尺寸是否真的装得下」未验证。')
  } else {
    const { rows, bad } = await run(DEVICES, { quiet: true })
    for (const r of rows) {
      ok(
        `${r.target} @ ${r.device} ${r.vw}x${r.vh}`,
        !r.fail,
        `卡片 ${r.card.w}x${r.card.h}，步骤区溢出 ${r.bodyOverflow}px，按钮底 ${r.btn.bottom}`
      )
    }
    // 汇总一条，便于一眼看出规模
    ok(`共 ${rows.length} 组视口全部完整可见`, bad === 0, `${bad} 组不达标`)
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
})()
