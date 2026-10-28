/**
 * 时间轴速度体系（对齐「浅纸提词器」）
 *
 * 设计要点：
 * - 速度不再用「档位 × 系数」糊，而是统一折算成 **msPerPx（每移动 1px 需要多少毫秒）**。
 *   一旦有了 msPerPx，整篇稿件的播放时长 = 滚动距离 × msPerPx，
 *   播放就变成「一条时长已知的动画」，不需要每帧推进。
 * - 支持两种单位，用户可切：
 *     cpm（字/分钟，默认 200）—— 可感知，稿子念多久心里有数
 *     px （像素/250ms 标尺 0–900）—— 老用户/精细调速
 * - 字数统计是**加权**的：中日韩字符 1.0，其余（英文/数字/标点/空白外）0.5。
 *   不这么做的话，一段英文稿按「字数」算会把语速估快一倍。
 * - 本模块是纯函数，不碰 wx API、不碰页面状态，便于 node 直跑测试。
 */

/** 字/分钟：下限、上限、步进、默认 */
const CPM_MIN = 20
const CPM_MAX = 600
const CPM_STEP = 10
const CPM_DEFAULT = 200

/** 旧版速度标尺（0–50，1 单位 ≈ 4px/s），仅用于兼容老存档 */
const LEGACY_SPEED_MIN = 0
const LEGACY_SPEED_MAX = 50
const LEGACY_SPEED_DEFAULT = 8
const LEGACY_PX_PER_SEC = 4

/** 台词区左右内边距（px），用于估算每行能放几个字 */
const TEXT_PADDING_X = 16

/**
 * 行高系数：真实行高 = fontSize × lineHeight × 1.2。
 * 与浅纸 text-container 里写死的 line-height 一致，改它等于改所有稿件的密度。
 */
const LINE_HEIGHT_FACTOR = 1.2

/** msPerPx 的安全区间：0.001ms/px（极快）~ 100000ms/px（龟速/静止） */
const MS_PER_PX_MIN = 0.001
const MS_PER_PX_MAX = 100000

/** 中日韩字符判定（与浅纸同一套 Unicode 区间） */
const CJK_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/g
/** 统计字数时剔除的空白/控制字符 */
const BLANK_RE = /[\t\n\r\f\v]/g

/** 中文权重：1 个字算 1；英文 2 个字母算 1 个字 */
const WEIGHT_NON_CJK = 0.5

/* ------------------------------ 基础工具 ------------------------------ */

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clampMsPerPx(v) {
  if (!Number.isFinite(v) || v <= 0) return MS_PER_PX_MAX
  return Math.min(MS_PER_PX_MAX, Math.max(MS_PER_PX_MIN, v))
}

function clampCpm(v) {
  if (!Number.isFinite(v) || v <= 0) return 0
  const snapped = Math.round(v / CPM_STEP) * CPM_STEP
  return Math.min(CPM_MAX, Math.max(CPM_MIN, snapped))
}

function clampLegacySpeed(v) {
  if (!Number.isFinite(v) || v <= 0) return 0
  const rounded = Math.round(v * 10) / 10
  return Math.min(LEGACY_SPEED_MAX, Math.max(LEGACY_SPEED_MIN, rounded))
}

/**
 * 加权字数：中日韩 1.0 / 其他 0.5。
 * @param {string} text
 * @returns {number}
 */
function countWeightedChars(text) {
  if (!text) return 0
  const s = String(text).replace(BLANK_RE, '')
  const cjk = (s.match(CJK_RE) || []).length
  return cjk + (s.length - cjk) * WEIGHT_NON_CJK
}

/** 原始字符数（不加权，仅调试/展示用） */
function countScriptChars(text) {
  return text ? String(text).replace(/\s/g, '').length : 0
}

/**
 * 估「每个字占多少纵向像素」。
 * 用法：不知道真实滚动距离时（首帧、换字号后重排前），用它把「字/分钟」折成 msPerPx。
 *
 * @param {object} settings {fontSize, lineHeight, letterSpacing, contentWidth}
 * @param {number} windowWidth 屏幕逻辑宽（px）
 * @returns {number} pxPerChar
 */
function estimatePxPerChar(settings, windowWidth) {
  const s = settings || {}
  const fontSize = Math.max(1, num(s.fontSize, 45))
  const lineHeightRatio = Math.max(0.1, num(s.lineHeight, 1.5)) * LINE_HEIGHT_FACTOR
  const letterSpacing = Math.max(0, num(s.letterSpacing, 0))
  const widthRatio = Math.min(100, Math.max(10, num(s.contentWidth, 100))) / 100

  const lineBoxH = fontSize * lineHeightRatio
  const usableW = Math.max(1, num(windowWidth, 0) * widthRatio - 2 * TEXT_PADDING_X)
  const charW = Math.max(1, fontSize + letterSpacing)
  const perLine = Math.max(1, Math.floor(usableW / charW))
  return lineBoxH / perLine
}

/* ------------------------------ 换算主链 ------------------------------ */

/**
 * 已知字数与滚动距离时，由「字/分钟」直接得出 msPerPx。
 *
 *   总时长(ms) = 60000 × 字数 / cpm
 *   msPerPx    = 总时长 / 滚动距离
 *
 * @returns {number|null} 任一参数不合法则 null
 */
function msPerPxFromDuration(charCount, cpm, scrollDistance) {
  if (!(cpm > 0) || !(charCount > 0) || !(scrollDistance > 0)) return null
  return clampMsPerPx((60000 * charCount) / cpm / scrollDistance)
}

/**
 * 距离未知时用「每字像素」估算：cpm/60 字每秒 × pxPerChar = px/s → 取倒数。
 * @returns {number|null}
 */
function msPerPxFromEstimate(settings, windowWidth, cpm) {
  if (!(cpm > 0)) return null
  const pxPerChar = estimatePxPerChar(settings, windowWidth)
  if (!(pxPerChar > 0)) return null
  const pxPerSec = (cpm / 60) * pxPerChar
  return pxPerSec > 0 ? clampMsPerPx(1000 / pxPerSec) : null
}

/** 当前生效的速度单位：显式 speedUnit 优先，否则有 speedCpm 就当 cpm，再否则 px */
function activeSpeedUnit(settings) {
  if (!settings || typeof settings !== 'object') return 'px'
  if (settings.speedUnit === 'px' || settings.speedUnit === 'cpm') return settings.speedUnit
  return typeof settings.speedCpm === 'number' ? 'cpm' : 'px'
}

/** 读旧版 speed（容忍字符串数字） */
function readLegacySpeed(settings) {
  if (!settings || typeof settings !== 'object') return null
  const v = settings.speed
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function readCpm(settings) {
  if (!settings || typeof settings !== 'object') return null
  const v = settings.speedCpm
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 速度解析：设置 + 上下文 → { msPerPx, source }
 * source 便于排查「为什么不动」：px / duration / estimate / zero
 *
 * @param {object} settings
 * @param {object} ctx {charCount, scrollDistance, windowWidth}
 */
function resolveSpeed(settings, ctx) {
  const c = ctx || {}

  if (activeSpeedUnit(settings) === 'px') {
    const speed = readLegacySpeed(settings)
    if (speed != null && speed > 0) {
      return { msPerPx: clampMsPerPx(250 / speed), source: 'px' }
    }
    return { msPerPx: Infinity, source: 'zero' }
  }

  const cpm = num(readCpm(settings), CPM_DEFAULT)
  if (!(cpm > 0)) return { msPerPx: Infinity, source: 'zero' }

  // ① 优先：**每字纵向像素**口径。
  //    px/s = (cpm / 60) × 每字像素高。
  //    为什么优先用它：字/分钟本来描述的是「一秒钟念几个字」，
  //    跟稿子有多长、上下留白多少没有半点关系。
  //    旧口径用「整篇时长 ÷ 可滚动距离」，分母里混进了 startPad + endPad
  //    （中间起播 0.5 屏 + 结束留白 0.75 屏 ≈ 1.25 屏），短稿时留白占比极大，
  //    算出来的每字像素被严重高估 → 整篇慢得几乎不动，而且不同长度稿子速度不一致。
  const pxPerChar = num(c.pxPerChar, 0)
  if (pxPerChar > 0) {
    const pxPerSec = (cpm / 60) * pxPerChar
    if (pxPerSec > 0) return { msPerPx: clampMsPerPx(1000 / pxPerSec), source: 'char' }
  }

  const byDuration = msPerPxFromDuration(
    num(c.charCount, 0), cpm, num(c.scrollDistance, 0)
  )
  if (byDuration != null) return { msPerPx: byDuration, source: 'duration' }

  const byEstimate = msPerPxFromEstimate(settings, num(c.windowWidth, 0), cpm)
  if (byEstimate != null) return { msPerPx: byEstimate, source: 'estimate' }

  return { msPerPx: Infinity, source: 'zero' }
}

/* ------------------------------ 单位迁移 ------------------------------ */

/**
 * 旧速度 → 字/分钟。
 * 旧标尺 1 单位 = 4px/s，故 px/s = speed × 4，cpm = 60 × px/s ÷ 每字像素。
 */
function cpmFromLegacySpeed(settings, ctx) {
  const c = ctx || {}
  const speed = readLegacySpeed(settings)
  if (speed == null || !(speed > 0)) return 0

  const pxPerSec = speed * LEGACY_PX_PER_SEC
  // 与 resolveSpeed 的 'char' 分支同源：否则切单位时正算/反算各用一套口径，
  // 会造成「切一下单位速度跳 20%」。
  const pxPerChar0 = num(c.pxPerChar, 0)
  if (pxPerChar0 > 0) return clampCpm((60 * pxPerSec) / pxPerChar0)

  const charCount = num(c.charCount, 0)
  const scrollDistance = num(c.scrollDistance, 0)

  if (charCount > 0 && scrollDistance > 0) {
    return clampCpm((60 * charCount * pxPerSec) / scrollDistance)
  }
  const pxPerChar = estimatePxPerChar(settings, num(c.windowWidth, 0))
  return pxPerChar > 0 ? clampCpm((60 * pxPerSec) / pxPerChar) : CPM_DEFAULT
}

/** 字/分钟 → 旧速度（反向换算，切单位时保持实际速度不变） */
function legacySpeedFromCpm(settings, ctx) {
  const c = ctx || {}
  const cpm = num(readCpm(settings), CPM_DEFAULT)
  if (!(cpm > 0)) return 0

  let pxPerSec
  const pxPerChar0 = num(c.pxPerChar, 0)
  const charCount = num(c.charCount, 0)
  const scrollDistance = num(c.scrollDistance, 0)

  if (pxPerChar0 > 0) {
    pxPerSec = (cpm / 60) * pxPerChar0
  } else if (charCount > 0 && scrollDistance > 0) {
    const msPerPx = (60000 * charCount) / (cpm * scrollDistance)
    if (!(msPerPx > 0)) return LEGACY_SPEED_DEFAULT
    pxPerSec = 1000 / msPerPx
  } else {
    const pxPerChar = estimatePxPerChar(settings, num(c.windowWidth, 0))
    if (!(pxPerChar > 0)) return LEGACY_SPEED_DEFAULT
    pxPerSec = (cpm / 60) * pxPerChar
  }
  return clampLegacySpeed(pxPerSec / LEGACY_PX_PER_SEC)
}

/** 老存档是否需要迁移：没有明确 speedUnit，但有任一速度字段 */
function needsSpeedMigration(settings) {
  if (!settings || typeof settings !== 'object') return false
  const hasUnit = settings.speedUnit === 'cpm' || settings.speedUnit === 'px'
  if (hasUnit) return false
  return readCpm(settings) != null || readLegacySpeed(settings) != null
}

/**
 * 迁移：把没写单位的存档补上 speedUnit（优先 cpm，并把旧 speed 折成 speedCpm）。
 * 已是新格式的存档原样返回（返回新对象，不改入参）。
 */
function migrateSpeedSettings(settings, ctx) {
  if (!settings || typeof settings !== 'object') return settings
  if (!needsSpeedMigration(settings)) return settings
  if (readCpm(settings) != null) {
    return Object.assign({}, settings, { speedUnit: 'cpm' })
  }
  return Object.assign({}, settings, {
    speedUnit: 'cpm',
    speedCpm: cpmFromLegacySpeed(settings, ctx)
  })
}

/**
 * 切换速度单位。返回**需要合并进 settings 的补丁**（不是完整对象）。
 * 原则：切换前后「实际速度」尽量不变，只换读数。
 */
function switchSpeedUnit(settings, ctx, target) {
  const s = settings || {}
  if (target === 'px') {
    if (activeSpeedUnit(s) === 'px' && readLegacySpeed(s) != null) {
      return { speedUnit: 'px' }
    }
    return { speedUnit: 'px', speed: legacySpeedFromCpm(s, ctx) }
  }
  // 目标 cpm
  if (activeSpeedUnit(s) === 'cpm' && readCpm(s) != null) {
    return { speedUnit: 'cpm' }
  }
  if (readLegacySpeed(s) == null) {
    return { speedUnit: 'cpm', speedCpm: CPM_DEFAULT }
  }
  return { speedUnit: 'cpm', speedCpm: cpmFromLegacySpeed(s, ctx) }
}

module.exports = {
  CPM_MIN,
  CPM_MAX,
  CPM_STEP,
  CPM_DEFAULT,
  LEGACY_SPEED_MIN,
  LEGACY_SPEED_MAX,
  LEGACY_SPEED_DEFAULT,
  LEGACY_PX_PER_SEC,
  TEXT_PADDING_X,
  LINE_HEIGHT_FACTOR,
  MS_PER_PX_MIN,
  MS_PER_PX_MAX,

  countWeightedChars,
  countScriptChars,
  estimatePxPerChar,
  msPerPxFromDuration,
  msPerPxFromEstimate,
  activeSpeedUnit,
  resolveSpeed,
  cpmFromLegacySpeed,
  legacySpeedFromCpm,
  needsSpeedMigration,
  migrateSpeedSettings,
  switchSpeedUnit,
  clampCpm,
  clampLegacySpeed
}
