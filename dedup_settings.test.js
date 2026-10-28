'use strict'
/**
 * 菜单页 / 设置页 功能去重回归（2026-10-28）
 *
 * 需求：两页功能列表不许重复，每个功能只保留一处，以**菜单页现有功能为准**。
 * 背景（这是真问题，不是洁癖）：
 *   设置页写 prefs_v1，提词页菜单写 tp_settings_v1 —— 同一件事两个真源。
 *   用户在设置页把字号调大，进提词页纹丝不动；回头再在菜单里改一次，
 *   设置页又显示旧值。两边各改一套，比没有入口更伤人。
 * 所以设置页现在只留「说明 + 去哪改 + 版本」，一个设置控件都不许有。
 *
 * 运行：node dedup_settings.test.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}

const SET_WXML = read('miniprogram/pages/settings/settings.wxml')
const SET_JS = read('miniprogram/pages/settings/settings.js')
const TP_WXML = read('miniprogram/pages/teleprompter/teleprompter.wxml')
const TP_JS = read('miniprogram/pages/teleprompter/teleprompter.js')
const INDEX_WXML = read('miniprogram/pages/index/index.wxml')
const APP_JSON = read('miniprogram/app.json')

/* ── 1. 菜单页功能清单（唯一真源） ── */
console.log('══════ 1. 菜单页功能清单 ══════')
// 以菜单里的「格子标题」为准：一个 label 就是一项功能
const MENU_LABELS = [
  '速度', '字号', '行距', '字距', '对齐', '台词区宽度',
  '文字加粗', '配色', '指示线', '底部开始', '镜像', '循环',
  '聚焦', '时间', '补光', '角色色', '声控', '倒计时',
  '智能总闸', '屏幕常亮'
]
{
  const hit = MENU_LABELS.filter((l) => TP_WXML.indexOf('>' + l) >= 0 || TP_WXML.indexOf(l + '<') >= 0)
  ok('菜单页 20 项功能都在模板里', hit.length === MENU_LABELS.length, `缺：${MENU_LABELS.filter((l) => hit.indexOf(l) < 0).join('/')}`)
  ok('菜单页仍是唯一设置面板', /class="tp-sheet/.test(TP_WXML) && /tp-grid/.test(TP_WXML))
}

/* ── 2. 设置页不得再出现这些功能 ── */
console.log('══════ 2. 设置页已无任何重复功能项 ══════')
{
  // 控件级关键词：只要还留着这些绑定，就说明功能没搬干净
  const BANNED_HANDLERS = [
    'onTapFont', 'onTapSpeedPreset', 'onTapSpeedStep', 'onSlideMargin',
    'onTapScheme', 'onTapPreset', 'onTapBgColor', 'onTapTextColor',
    'onTapFontFamily', 'onTapLineHeight', 'onTapLetterSpacing', 'onTapCountdown',
    'onTapOrientation', 'onTapScrollMode', 'onToggle', 'onToggleSmartOff',
    'onToggleRoleHighlight', 'onTapReset', 'onTapReplayGuide'
  ]
  const left = BANNED_HANDLERS.filter((h) => new RegExp('bind\\w+="' + h + '"|catch\\w+="' + h + '"').test(SET_WXML))
  ok('设置页没有任何设置类事件绑定', left.length === 0, '残留：' + left.join(','))

  const BANNED_TAGS = ['<slider', 'switch-row', 'seg-item', 'swatch', 'preset-card']
  const leftTags = BANNED_TAGS.filter((t) => SET_WXML.indexOf(t) >= 0)
  ok('设置页没有滑块/开关/色板/预设卡控件', leftTags.length === 0, '残留：' + leftTags.join(','))

  const BANNED_FIELDS = ['prefs.speed', 'prefs.fontSize', 'prefs.marginHorizontal', 'prefs.colorScheme', 'prefs.mirror']
  const leftFields = BANNED_FIELDS.filter((f) => SET_WXML.indexOf(f) >= 0)
  ok('设置页不再展示任何 prefs 设置值', leftFields.length === 0, '残留：' + leftFields.join(','))

  ok('设置页逻辑里也没有写入偏好的方法',
    !/updatePrefs\s*\(/.test(SET_JS) && !/prefsEngine\.patch/.test(SET_JS))
}

/* ── 3. 设置页仍然可用（不是白屏/死链） ── */
console.log('══════ 3. 设置页保留下来的职责 ══════')
{
  ok('页面仍在 app.json 注册', APP_JSON.indexOf('pages/settings/settings') >= 0)
  ok('首页 ⚙ 入口仍可点', INDEX_WXML.indexOf('onTapSettings') >= 0)
  ok('设置页给出「去哪改」的指引', SET_WXML.indexOf('去哪改') >= 0 && SET_WXML.indexOf('菜单') >= 0)
  ok('设置页有直达菜单的按钮', SET_WXML.indexOf('onTapOpenMenu') >= 0)
  ok('直达按钮带 menu=1（进提词页自动开菜单）', /menu=1/.test(SET_JS))
  ok('设置页只剩说明/关于两组，没有第三组设置卡',
    (SET_WXML.match(/class="group-title"/g) || []).length === 2,
    String((SET_WXML.match(/class="group-title"/g) || []).length))
}

/* ── 4. 提词页要认 menu=1 ── */
console.log('══════ 4. menu=1 直达链路 ══════')
{
  ok('onLoad 读取 options.menu', /_openMenuOnReady/.test(TP_JS) && /options\.menu/.test(TP_JS))
  ok('onReady 里补开菜单（等首屏排版落定）', /_openMenuOnReady[\s\S]{0,240}onOpenMenu/.test(TP_JS))
}

/* ── 5. 同一功能在别处不能有第二份可操作入口 ── */
console.log('══════ 5. 关键功能的唯一入口 ══════')
{
  // 智能总闸：prefs.smartOff 只有菜单页「智能总闸」+ 编辑页角色面板（就地兜底，同一份 prefs）
  ok('智能总闸唯一常规入口在菜单', TP_WXML.indexOf('onToggleSmartOff') >= 0)
  ok('设置页没有第二份智能总闸', SET_WXML.indexOf('smartOff') < 0)
  // 角色高亮：菜单「角色色」是常规入口，且与 prefs 打通（总闸开着时点它 = 解除总闸）
  ok('角色色在菜单里与 prefs.smartPatch 联动', /onToggleRoleHighlight[\s\S]{0,700}smartPatch/.test(TP_JS))
  ok('角色色指示灯反映「画面上真的有没有颜色」', /tp-dot \{\{roleHighlight \? 'is-on'/.test(TP_WXML))
  ok('渲染时三处任一关掉都不出颜色（菜单/编辑页/总闸）',
    /s\.roleHighlight !== false && legacy\.roleHighlight !== false && !smartOff/.test(TP_JS))
}

console.log('\n' + '─'.repeat(52))
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
