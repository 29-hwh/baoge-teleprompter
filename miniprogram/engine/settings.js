/**
 * 提词设置中心（对齐「浅纸提词器」）
 *
 * 与旧 engine/prefs.js 的分工：
 *   - prefs.js      编辑页 / 首页仍在用（字号档位、配色方案等老字段）
 *   - settings.js   只服务提词台，量纲、默认值、取值范围全部照抄浅纸
 *
 * 三个关键设计（都是从浅纸源码里抄的，不是拍脑袋）：
 *   1) 横竖屏各存一套：key = tp_settings_v1__portrait / __landscape
 *      横屏调的字号不会污染竖屏，这是浅纸 settings 组件的既定行为。
 *   2) 速度双单位：cpm（字/分钟，默认 200）+ px（旧标尺 0–50）。
 *      换算统一走 timeline.js，切单位时实际速度不跳变。
 *   3) 行高 = fontSize × lineHeight × 1.2（1.2 焊死，与浅纸 LINE_HEIGHT_FACTOR 一致）。
 */

const timeline = require('./timeline.js')
const legacyPrefs = require('./prefs.js')

const KEY_BASE = 'tp_settings_v1'

/* ------------------------------ 取值范围（浅纸真值） ------------------------------ */

const FONT_SIZE_MIN = 11
const FONT_SIZE_MAX = 150
const FONT_SIZE_DEFAULT = 45

const LINE_HEIGHT_MIN = 0.9
const LINE_HEIGHT_MAX = 3
const LINE_HEIGHT_STEP = 0.1
const LINE_HEIGHT_DEFAULT = 1.5

const LETTER_SPACING_MIN = 0
const LETTER_SPACING_MAX = 20
const LETTER_SPACING_DEFAULT = 0

const CONTENT_WIDTH_MIN = 10
const CONTENT_WIDTH_MAX = 100
const CONTENT_WIDTH_DEFAULT = 100

const CUE_MIN = 0
const CUE_MAX = 90
const CUE_DEFAULT = 50

const COUNTDOWN_MAX = 10

/** 台词区左右内边距（px），与浅纸 TEXT_PADDING_X 一致 */
const TEXT_PADDING_X = 16

/** 行高系数，焊死 */
const LINE_HEIGHT_FACTOR = timeline.LINE_HEIGHT_FACTOR

/** 浅纸预设文字色 */
const TEXT_COLORS = ['#FFFFFF', '#888888', '#000000', '#FF0000', '#FFA500', '#0000FF', '#008000', '#800080']

/** 浅纸预设背景色 */
const BG_COLORS = ['#EEEEEE', '#666666', '#111111', '#000000']

/** 对齐方式：只保留两档（居中 / 左）。
 *  2026-10-28 按宝哥要求精简：四档挤在一个两列宽的格子里，字号被压到 9px 还被截断，
 *  而「两端 / 右」在提词场景里几乎没人用（中文断行靠字符切分，两端对齐也拉不开字距）。
 *  顺序按宝哥说法「居中、左」排列。 */
const TEXT_ALIGNS = [
  { key: 'center', label: '居中' },
  { key: 'left', label: '左对齐' }
]

/** 对齐白名单：老存档里的 justify / right 一律折到 left（视觉上最接近，不会突然跳版） */
const TEXT_ALIGN_KEYS = TEXT_ALIGNS.map((o) => o.key)

/** 起播位置：浅纸只有「中间开始 / 底部开始」两档 */
const START_POSITIONS = [
  { key: 'middle', label: '中间开始' },
  { key: 'bottom', label: '底部开始' }
]

/** 字体：系统 / 宋体 / 楷体 / 等宽（浅纸只有 system/mono 两态，这里补了中文衬线体） */
const FONT_FAMILIES = {
  system: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
  serif: "'Songti SC', 'SimSun', 'Noto Serif CJK SC', 'Source Han Serif SC', serif",
  kai: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Baoli SC', serif",
  mono: "'SF Mono', Menlo, Consolas, 'Courier New', monospace"
}

/** 字体格的循环顺序与显示名（顺序即点击顺序：系统 → 宋体 → 楷体 → 等宽 → 系统） */
const FONT_FAMILY_OPTIONS = [
  { key: 'system', label: '系统' },
  { key: 'serif', label: '宋体' },
  { key: 'kai', label: '楷体' },
  { key: 'mono', label: '等宽' }
]

const FONT_FAMILY_KEYS = FONT_FAMILY_OPTIONS.map((o) => o.key)

/** 一键主题（外观预设）：三套常用搭配，点一下即套用背景+文字色（与 prefs.PRESET_THEMES 对应） */
const THEME_PRESETS = [
  { key: 'classic', short: '经典', bg: '#000000', text: '#FFFFFF' },
  { key: 'eye', short: '护眼', bg: '#2B2B2B', text: '#FFD166' },
  { key: 'paper', short: '白底', bg: '#FFFFFF', text: '#1C1C1E' }
]

/** 语速预设（字/分钟，cpm 口径，与 speedUnit==='cpm' 时同量纲） */
const SPEED_PRESETS = [
  { label: '慢', value: 80 },
  { label: '舒缓', value: 140 },
  { label: '标准', value: 200 },
  { label: '快', value: 280 },
  { label: '极快', value: 400 }
]

/** 取某个字体键的显示名；未知值回落到第一个 */
function fontFamilyLabel(key) {
  const hit = FONT_FAMILY_OPTIONS.find((o) => o.key === key)
  return (hit || FONT_FAMILY_OPTIONS[0]).label
}

/** 下一个字体键（循环） */
function nextFontFamily(key) {
  const i = FONT_FAMILY_KEYS.indexOf(key)
  return FONT_FAMILY_KEYS[(i + 1) % FONT_FAMILY_KEYS.length]
}

/* ------------------------------ 默认设置 ------------------------------ */

const DEFAULTS = {
  fontSize: FONT_SIZE_DEFAULT,
  lineHeight: LINE_HEIGHT_DEFAULT,
  letterSpacing: LETTER_SPACING_DEFAULT,
  textAlign: 'left', // center | left（2026-10-28 精简为两档，默认左对齐＝原「两端」的视觉）
  contentWidth: CONTENT_WIDTH_DEFAULT,
  speedUnit: 'cpm', // cpm | px
  speedCpm: timeline.CPM_DEFAULT,
  speed: timeline.LEGACY_SPEED_DEFAULT,
  startPosition: 'middle', // middle | bottom
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  mirror: false,
  showCue: true,
  cuePosition: CUE_DEFAULT,
  focus: false,
  loop: false,
  countdown: 0,
  showClocks: true,
  fontBold: false,
  fontFamily: 'system',
  // 以下三项是宝哥独有能力，浅纸菜单里没有；保留但放在网格末尾
  fillLight: false,
  roleHighlight: true,
  voiceControl: false,
  keepScreenOn: true
}

/* ------------------------------ 工具 ------------------------------ */

function clamp(v, min, max) {
  const n = Number(v)
  if (!isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function snap(v, step) {
  const n = Number(v)
  if (!isFinite(n)) return 0
  return Math.round(n / step) * step
}

function isPortrait(orientation) {
  return orientation !== 'landscape'
}

/** 存储键：横竖屏各一套 */
function keyOf(orientation) {
  return KEY_BASE + (isPortrait(orientation) ? '__portrait' : '__landscape')
}

/**
 * 归一化：所有字段都过一遍区间，保证脏存档不会算出 NaN。
 */
function normalize(s) {
  const src = s || {}
  const out = Object.assign({}, DEFAULTS, src)

  out.fontSize = Math.round(clamp(out.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX))
  out.lineHeight = Math.round(clamp(out.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX) * 10) / 10
  out.letterSpacing = Math.round(clamp(out.letterSpacing, LETTER_SPACING_MIN, LETTER_SPACING_MAX))
  out.contentWidth = Math.round(clamp(out.contentWidth, CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX))
  out.cuePosition = Math.round(clamp(out.cuePosition, CUE_MIN, CUE_MAX))
  out.countdown = Math.round(clamp(out.countdown, 0, COUNTDOWN_MAX))

  out.speedUnit = out.speedUnit === 'px' ? 'px' : 'cpm'
  out.speedCpm = timeline.clampCpm(clamp(out.speedCpm, timeline.CPM_MIN, timeline.CPM_MAX)) ||
    timeline.CPM_DEFAULT
  out.speed = timeline.clampLegacySpeed(clamp(out.speed, timeline.LEGACY_SPEED_MIN, timeline.LEGACY_SPEED_MAX))

  out.startPosition = out.startPosition === 'bottom' ? 'bottom' : 'middle'
  // 对齐白名单只剩 center / left；justify、right 等老值折到 left
  out.textAlign = TEXT_ALIGN_KEYS.indexOf(out.textAlign) >= 0 ? out.textAlign : 'left'
  // 字体按 FONT_FAMILY_KEYS 白名单校验（曾写死「只认 mono」，导致新增的宋体/楷体
  // 被 normalize 悄悄改回 system —— 表现为「字体格点了没反应」）
  out.fontFamily = FONT_FAMILY_KEYS.indexOf(out.fontFamily) >= 0 ? out.fontFamily : 'system'

  out.textColor = out.textColor || DEFAULTS.textColor
  out.backgroundColor = out.backgroundColor || DEFAULTS.backgroundColor

  out.mirror = !!out.mirror
  out.showCue = out.showCue !== false
  out.focus = !!out.focus
  out.loop = !!out.loop
  out.showClocks = out.showClocks !== false
  out.fontBold = !!out.fontBold
  out.fillLight = !!out.fillLight
  out.roleHighlight = out.roleHighlight !== false
  out.voiceControl = !!out.voiceControl
  out.keepScreenOn = out.keepScreenOn !== false
  return out
}

/* ------------------------------ 老存档迁移 ------------------------------ */

/**
 * 把旧 prefs_v1 折算成新设置（只在首次使用、且本方向还没有存档时执行一次）。
 *
 * 速度换算是这里唯一容易做错的地方：
 *   旧口径 pxPerSecond = speed × 0.6（40–400 档）
 *   新口径 cpm        = 60 × pxPerSecond ÷ 每字纵向像素
 * 不能直接套 timeline.cpmFromLegacySpeed —— 那是浅纸 0–50 的老标尺（×4px/s），
 * 量纲不同，直接套会把速度放大六七倍。
 */
function seedFromLegacy(orientation, winWidth) {
  // 只有「确实存过旧偏好」的用户才迁移。
  // 没存过的人应当拿到浅纸那套默认值（45px / 200 字每分 / 中间起播），
  // 不能拿 prefs.js 的 DEFAULTS 当"用户设置"，否则新用户一进来就是旧的 34px。
  let raw = null
  try {
    raw = wx.getStorageSync('prefs_v1')
  } catch (e) {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  let p
  try {
    p = legacyPrefs.load()
  } catch (e) {
    return null
  }
  if (!p) return null

  const width = Number(winWidth) > 0 ? Number(winWidth) : 375
  const fontSize = legacyPrefs.fontSizePx(p.fontSize)
  const lineHeight = clamp(p.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
  const letterSpacing = clamp(p.letterSpacing, LETTER_SPACING_MIN, LETTER_SPACING_MAX)
  const contentWidth = CONTENT_WIDTH_DEFAULT

  const pxPerChar = timeline.estimatePxPerChar(
    { fontSize: fontSize, lineHeight: lineHeight, letterSpacing: letterSpacing, contentWidth: contentWidth },
    width
  )
  const pxPerSecond = Math.max(24, (p.speed || 50) * 0.6)
  const cpm = pxPerChar > 0 ? (60 * pxPerSecond) / pxPerChar : timeline.CPM_DEFAULT

  let bg = '#000000'
  let text = '#FFFFFF'
  try {
    const eff = legacyPrefs.effectiveColors(p)
    bg = eff.bg
    text = eff.text
  } catch (e) {
    /* 用默认黑白 */
  }

  return normalize({
    fontSize: fontSize,
    lineHeight: lineHeight,
    letterSpacing: letterSpacing,
    contentWidth: contentWidth,
    speedUnit: 'cpm',
    speedCpm: timeline.clampCpm(cpm),
    startPosition: 'middle',
    textColor: text,
    backgroundColor: bg,
    mirror: !!p.mirror,
    showCue: p.showGuide !== false,
    loop: !!p.loop,
    countdown: p.countdown || 0,
    fillLight: !!p.fillLight,
    roleHighlight: p.roleHighlight !== false && !p.smartOff,
    voiceControl: p.scrollStyle === 'voice' || p.scrollMode === 'voice',
    keepScreenOn: p.keepScreenOn !== false
  })
}

/* ------------------------------ 读写 ------------------------------ */

function readRaw(orientation) {
  try {
    const v = wx.getStorageSync(keyOf(orientation))
    return v && typeof v === 'object' ? v : null
  } catch (e) {
    return null
  }
}

/**
 * 读取某方向的设置。
 * @param {'portrait'|'landscape'} orientation
 * @param {number} [winWidth] 迁移时估算每字像素用
 */
function load(orientation, winWidth) {
  const saved = readRaw(orientation)
  if (saved) return normalize(saved)

  // 首次：从旧偏好折算，并立刻落盘，避免每次进页面都重算
  const seeded = seedFromLegacy(orientation, winWidth)
  if (seeded) {
    try {
      wx.setStorageSync(keyOf(orientation), seeded)
    } catch (e) {
      /* 忽略：内存里仍可用 */
    }
    return seeded
  }
  return Object.assign({}, DEFAULTS)
}

/**
 * 合并补丁并持久化。
 * @returns {Object} 归一化后的完整设置
 */
function patch(orientation, patchObj) {
  const next = normalize(Object.assign({}, load(orientation), patchObj || {}))
  try {
    wx.setStorageSync(keyOf(orientation), next)
  } catch (e) {
    console.error('[settings] 写入失败', e)
  }
  return next
}

function reset(orientation) {
  const next = Object.assign({}, DEFAULTS)
  try {
    wx.setStorageSync(keyOf(orientation), next)
  } catch (e) {
    console.error('[settings] 重置失败', e)
  }
  return next
}

/* ------------------------------ 颜色 ------------------------------ */

const NAMED_COLORS = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  orange: '#FFA500',
  blue: '#0000FF',
  green: '#008000',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080'
}

/** 颜色字符串 → [r,g,b]，失败返回 null */
function colorToRgb(c) {
  if (!c) return null
  let t = NAMED_COLORS[String(c).toLowerCase()] || c
  if (typeof t !== 'string' || t.charAt(0) !== '#') return null
  t = t.slice(1)
  if (t.length === 3) t = t.split('').map((x) => x + x).join('')
  if (t.length !== 6) return null
  const r = parseInt(t.slice(0, 2), 16)
  const g = parseInt(t.slice(2, 4), 16)
  const b = parseInt(t.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null
  return [r, g, b]
}

/**
 * 文字与背景是否过于接近（浅纸同一套判据）：
 * 亮度差 < 40 且 RGB 欧氏距离 < 120 → 判为「看不清」。
 */
function isColorTooClose(textColor, backgroundColor) {
  const n = colorToRgb(textColor)
  const o = colorToRgb(backgroundColor)
  if (!n || !o) return false
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const dist = Math.sqrt(n.reduce((sum, v, i) => sum + Math.pow(v - o[i], 2), 0))
  return Math.abs(lum(n) - lum(o)) < 40 && dist < 120
}

/* ------------------------------ 展示辅助 ------------------------------ */

/** 字号 + 行距 + 1.2 → 真实行高 px */
function lineHeightPxOf(settings) {
  const s = settings || DEFAULTS
  return Math.max(1, Math.round(s.fontSize * s.lineHeight * LINE_HEIGHT_FACTOR))
}

/** 当前方向的字号基准（横竖屏不同，需要方向） */
function orientationOf(win) {
  const w = (win && win.windowWidth) || 375
  const h = (win && win.windowHeight) || 667
  return h >= w ? 'portrait' : 'landscape'
}

/** 供 UI 显示的速度读数 */
function speedLabel(settings) {
  const s = settings || DEFAULTS
  return s.speedUnit === 'px' ? String(s.speed) : String(s.speedCpm)
}

/** 供 UI 显示的速度单位 */
function speedUnitLabel(settings) {
  return (settings || DEFAULTS).speedUnit === 'px' ? '像素' : '字/分'
}

module.exports = {
  KEY_BASE,
  DEFAULTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_STEP,
  LETTER_SPACING_MIN,
  LETTER_SPACING_MAX,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_MAX,
  CUE_MIN,
  CUE_MAX,
  COUNTDOWN_MAX,
  TEXT_PADDING_X,
  LINE_HEIGHT_FACTOR,
  TEXT_COLORS,
  BG_COLORS,
  TEXT_ALIGNS,
  TEXT_ALIGN_KEYS,
  START_POSITIONS,
  FONT_FAMILIES,
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_KEYS,
  THEME_PRESETS,
  SPEED_PRESETS,
  fontFamilyLabel,
  nextFontFamily,

  keyOf,
  load,
  patch,
  reset,
  normalize,
  seedFromLegacy,
  colorToRgb,
  isColorTooClose,
  lineHeightPxOf,
  orientationOf,
  speedLabel,
  speedUnitLabel
}
