/**
 * 提词页（恢复宝哥原有逐帧滚动内核 + 对齐「浅纸提词器」菜单/设置）
 * ============================================================================
 * 滚动方式（2026-10-28 恢复原有实现）：
 *   旧版曾用「setInterval(16ms) 逐帧推进 + 虚拟列表裁剪」，中途被改成
 *   「this.animate() 一条动画跑到底 + 全量渲染」，真机出现卡顿、横竖屏切换
 *   失效。本轮恢复原有 ScrollEngine 逐帧内核，同时保留浅纸的菜单/设置体系。
 *
 * 渲染哲学（恢复后）：
 *   - 单一 transform 容器，transform: translate3d(0, -offset, 0)
 *   - ScrollEngine（engine/scroll.js）setInterval(16ms) 逐帧推进，
 *     每帧只 setData offset 数字 + 百分比节流 + 每 8 帧裁剪一次可见区
 *   - 虚拟列表：只渲染视口附近的行，长稿不卡
 *   - 角色名内联渲染（rolePrefix + body 同一行），行高等高，裁剪干净
 *
 * 速度体系：
 *   cpm（字/分钟，默认 200）与 px（旧标尺 0–50）双单位，统一折算成 msPerPx，
 *   再由 msPerPx 折算 pxPerSecond 喂给 ScrollEngine。
 */
const app = getApp()
const store = require('../../engine/store.js')
const parser = require('../../engine/parser.js')
const roleEngine = require('../../engine/role.js')
const settingsEngine = require('../../engine/settings.js')
const timeline = require('../../engine/timeline.js')
const prefsEngine = require('../../engine/prefs.js')
const ScrollEngine = require('../../engine/scroll.js')
const StatsCollector = require('../../engine/stats.js')
const vad = require('../../engine/vad.js')
const util = require('../../utils/util.js')

/** 菜单里滑块的几何缓存键 */
const SLIDER_KEYS = ['vs-speed', 'vs-fontSize', 'vs-lineHeight', 'vs-letterSpacing', 'vs-cuePosition']
const HSLIDER_KEYS = ['hs-contentWidth', 'hs-countdown']

/** 布局节流：拖动字号时不必每 16ms 重新分词排版 */
const LAYOUT_THROTTLE_MS = 90

/**
 * 全量渲染阈值（行）。
 *
 * 2026-10-29：彻底去掉虚拟列表的「边滚边换批」。
 * 换批那一帧要销毁/新建几十个节点，必然掉一帧 —— 观感就是宝哥说的
 * 「滚动过程中间歇性跳一下」。改成一屏台词一次性渲染完，滚动期间
 * **只有 transform 在变**，一个节点都不重建，这才可能真正连续。
 *
 * 超过这个行数才降级成「一整块纯文本」（1 个节点，内容一字不丢），
 * 避免 800+ 行时首屏 setData 过大。
 */
const BLOB_LINES = 1200

function pct(v, min, max) {
  if (!(max > min)) return 0
  const n = (Number(v) - min) / (max - min)
  return Math.max(0, Math.min(100, n * 100))
}

function hexToRgba(hex, alpha) {
  const rgb = settingsEngine.colorToRgb(hex)
  if (!rgb) return 'rgba(255,255,255,0.18)'
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
}

Page({
  data: {
    title: '',
    scriptPosText: '',
    hasPrevScript: false,
    hasNextScript: false,

    // ── 排版 ──
    lines: [], // 全量台词（渲染用它，也是唯一一份）
    visibleLines: [], // 已废弃：全量渲染后不再下发，字段保留避免旧调用方报错
    visibleStart: 0, // 兼容字段（全量渲染后恒为 0）
    visibleTop: 0, // 兼容字段（全量渲染后恒为 0）
    fontSizePx: 45,
    lineHeightPx: 81,
    letterSpacing: 0,
    contentWidth: 100,
    textAlign: 'left',
    fontFamily: '',
    fontFamilyLabel: '系统',
    fontBold: false,
    marginHorizontal: 0,
    bg: '#000000',
    textColor: '#FFFFFF',
    isDark: true,
    mirror: false,
    showGuide: true,
    showCue: true,
    cuePosition: 50,

    // ── 播放 ──
    status: 'stopped', // stopped | playing | paused
    playing: false,
    autoTop: 0, // 兼容别名 = 当前滚动像素（与 offset 同步）
    offset: 0, // 渲染用的滚动像素（ScrollEngine.current 的镜像）
    freeTop: 0,
    progress: 0,
    progressValue: 0,
    progressText: '0%',
    resumePosition: 0,
    totalScroll: 0,
    contentHeight: 0,
    textHeight: 0,
    // 引擎当前真正在跑的速度（px/s）。菜单里显示出来，用于自证「调速有没有传到引擎」
    speedPxPerSec: 0,
    // 安全区（刘海/挖孔/圆角/Home 条）：WXML 用 CSS 变量消费
    safeTop: 0,
    safeBottom: 0,
    safeLeft: 0,
    safeRight: 0,
    viewportHeight: 600,
    startPad: 0,
    endPad: 0,
    finished: false,
    focusIndex: 0,

    // ── 设置 ──
    settings: Object.assign({}, settingsEngine.DEFAULTS),
    orientation: 'portrait',
    roleFontSize: 28,
    roleLineHeight: 46,
    focus: false,
    alignOptions: [],
    textColors: [],
    bgColors: [],
    colorPicker: '',
    colorWarning: false,
    pctSpeed: 0,
    pctFontSize: 0,
    pctLineHeight: 0,
    pctLetterSpacing: 0,
    pctCue: 0,
    pctWidth: 0,
    pctCountdown: 0,
    speedText: '200',
    speedUnitText: '字/分',
    speed: 200,
    speedMin: 10,
    speedMax: 1500, // 与 timeline.CPM_MAX 同步（真实值由 _parseAndLayout/_setSetting 覆盖）
    loop: false,
    countdown: 0,
    showClocks: true,
    clockText: '',

    // ── 菜单 ──
    showMenu: false,
    showControls: false, // 旧字段别名（部分测试按它判断菜单）
    menuHeight: 480,

    // ── 其他 ──
    roleHighlight: true,
    smartOff: false,
    keepScreenOn: true,
    fillLight: false,
    voiceEnabled: false,
    voiceLevel: 0,
    voiceCalibrating: false,
    voiceTip: '',
    finishHint: '',
    guideVisible: false,
    themePresets: [],
    scrollStyle: 'smooth',
    scrollMode: 'auto',
    blobMode: false,
    blobLineCount: 0
  },

  /* ======================================================================
   * 生命周期
   * ==================================================================== */

  onLoad(options) {
    this.allLines = []
    this.allRoles = []
    this.allAliases = {}
    this.displayLines = []
    this.roleFilter = null
    this.scriptId = ''
    this.script = null
    this._launched = false
    this._switching = false
    this._menuSource = ''
    this._sliderRects = {}
    this._sliderToken = 0
    this._activeSlider = ''
    this._activeHSlider = ''
    this._progressTimer = null
    this._countdownTimer = null
    this._clockTimer = null
    this._layoutTimer = null
    this._contentH = 0
    this._statSaved = false
    this._seeking = false
    this._resumeAfterSeek = false
    this._wasPlayingBeforeMenu = false
    // 滚动内核：逐帧推进的真值，见 engine/scroll.js
    this._frameCount = 0
    // 上一帧真正发出去的 offset（亚像素过滤用）。跳转/重播时置 -1 强制重绘一次。
    this._lastOffsetSent = -1
    this._lastPct = -1
    this._wrapped = false
    this._lastSection = -1
    this._blobToasted = false
    this._blobVisualLines = 0
    this._blobLineCount = 0
    this._freeTop = 0

    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.winWidth = win.windowWidth || 375
    this.winHeight = win.windowHeight || 667
    this._safeLeft = undefined
    this._safeRight = undefined
    const inset = this._readSafeArea()

    const orientation = settingsEngine.orientationOf(win)
    const settings = settingsEngine.load(orientation, this.winWidth)
    this.setData({
      orientation: orientation,
      settings: settings,
      viewportHeight: this.winHeight,
      safeTop: inset.top,
      safeBottom: inset.bottom,
      safeLeft: inset.left,
      safeRight: inset.right,
      alignOptions: settingsEngine.TEXT_ALIGNS,
      textColors: settingsEngine.TEXT_COLORS,
      bgColors: settingsEngine.BG_COLORS,
      themePresets: settingsEngine.THEME_PRESETS,
      keepScreenOn: settings.keepScreenOn !== false
    })

    this.engine = new ScrollEngine({
      onUpdate: this._onUpdate.bind(this),
      onEnd: this._onEnd.bind(this),
      onLoop: this._onLoop.bind(this)
    })
    this.stats = new StatsCollector({})
    this.voice = new vad.VoiceController()
    this._applyScreenPrefs(settings)

    try {
      this.setData({ guideVisible: !wx.getStorageSync('baoge_guide_tp') })
    } catch (e) {
      this.setData({ guideVisible: false })
    }

    if (!options || !options.id) {
      util.toast('台本不存在')
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    // 设置页「打开提词页设置菜单」带 menu=1 进来：加载完直接把菜单拉开
    this._openMenuOnReady = !!(options && options.menu)
    this._loadScript(options.id)
  },

  onReady() {
    this._launched = true
    this._tickClock()
    if (this._clockTimer) clearInterval(this._clockTimer)
    this._clockTimer = setInterval(() => this._tickClock(), 10000)
    if (this._openMenuOnReady) {
      this._openMenuOnReady = false
      // 等首屏排版落定再开菜单：否则选择器量到的是空布局
      setTimeout(() => {
        if (!this.data.showMenu) this.onOpenMenu()
      }, 160)
    }
  },

  onShow() {
    if (!this._launched) return
    this._updateScriptPos()
    this._applyScreenPrefs(this.data.settings)
  },

  onHide() {
    // 切后台：停表但保留 current（位置不丢），落盘进度。
    // 必须同步 status='paused'，否则回前台再点播放会被 onTapPlay 误判成「正在播→暂停」。
    if (this.engine) this.engine.pause()
    if (this.data.playing) this.setData({ playing: false, status: 'paused' })
    if (this.voice && this.voice.running) this.voice.stop()
    this._clearCountdown()
    this._savePosition()
  },

  onUnload() {
    // 退出前先落盘（engine.current 是逐帧实时位置，无需反算）
    this._savePosition()
    if (this.engine) this.engine.stop()
    if (this.voice) this.voice.stop()
    this._clearCountdown()
    if (this._progressTimer) clearInterval(this._progressTimer)
    if (this._clockTimer) clearInterval(this._clockTimer)
    if (this._layoutTimer) clearTimeout(this._layoutTimer)
    this._restoreScreen()
    this._finalizeStats(false)
  },

  onResize(res) {
    const size = (res && res.size) || {}
    const w = size.windowWidth || this.winWidth
    const h = size.windowHeight || this.winHeight
    if (!w || !h) return
    this.winWidth = w
    this.winHeight = h
    // 安全区随方向变（横屏刘海在左右，竖屏在上下），转屏后必须重新读并同步给视图
    this._safeLeft = undefined
    this._safeRight = undefined
    const inset = this._syncSafeInsets()
    const orientation = settingsEngine.orientationOf({ windowWidth: w, windowHeight: h })
    // 横竖屏各存一套设置：换向就换一套参数，互不污染
    const settings = settingsEngine.load(orientation, w)
    this.setData({
      orientation: orientation,
      settings: settings,
      viewportHeight: h,
      safeTop: inset.top,
      safeBottom: inset.bottom,
      safeLeft: inset.left,
      safeRight: inset.right
    })
    this._parseAndLayout({ keepProgress: true })
  },

  /* ======================================================================
   * 台本加载
   * ==================================================================== */

  _loadScript(id, opts) {
    const fresh = !!(opts && opts.fresh)
    const script = store.get(id)
    if (!script) {
      this._switching = false
      util.toast('台本不存在')
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.script = script
    this.scriptId = id
    this.setData({ title: script.title })
    this._updateScriptPos()

    // 切台本时引擎位置还停在上一篇，先归零
    if (this.engine) this.engine.reset(0)
    this._wrapped = false
    this._lastSection = -1
    this._seekPx(0)
    this._parseAndLayout()

    if (fresh) {
      this._switching = false
      return
    }

    const pos = store.getPosition(this.scriptId)
    if (pos > 0.01 && pos < 0.99) {
      wx.showModal({
        title: '继续上次进度',
        content: `上次读到 ${Math.round(pos * 100)}%，要接着读吗？`,
        confirmText: '接着读',
        cancelText: '从头开始',
        success: (r) => {
          if (r.confirm) this._seekTo(pos)
        }
      })
    }
    this._switching = false
  },

  _scriptOrder() {
    try {
      return util.sortByEpisode(store.list())
    } catch (e) {
      return []
    }
  },

  _updateScriptPos() {
    let text = ''
    let hasPrev = false
    let hasNext = false
    try {
      const all = this._scriptOrder()
      const idx = all.findIndex((s) => s.id === this.scriptId)
      if (idx >= 0) {
        if (all.length > 1) text = `${idx + 1} / ${all.length}`
        hasPrev = idx - 1 >= 0
        hasNext = idx + 1 < all.length
      }
    } catch (e) {
      text = ''
    }
    this.setData({ scriptPosText: text, hasPrevScript: hasPrev, hasNextScript: hasNext })
  },

  onTapPrevScript() {
    this._switchScript(-1)
  },

  onTapNextScript() {
    this._switchScript(1)
  },

  _switchScript(dir) {
    if (this._switching) return
    const all = this._scriptOrder()
    if (!all.length) {
      util.toast('还没有台本，先回首页新建')
      return
    }
    if (all.length === 1) {
      util.toast('只有一个台本')
      return
    }
    let idx = all.findIndex((s) => s.id === this.scriptId)
    if (idx < 0) idx = dir > 0 ? -1 : all.length
    const nextIdx = idx + dir
    if (nextIdx < 0 || nextIdx >= all.length) {
      this._updateScriptPos()
      util.toast(dir > 0 ? '已经是最后一个台本' : '已经是第一个台本')
      return
    }
    const target = all[nextIdx]
    this._switching = true
    try {
      this._prepareSwitch()
      this._loadScript(target.id, { fresh: true })
      util.toast(target.title)
    } catch (e) {
      this._switching = false
      util.toast('切换失败，请重试')
    }
  },

  _prepareSwitch() {
    this._pause()
    this._finalizeStats(false)
    this._savePosition()
    this._clearCountdown()
    this._seekPx(0)
    this.setData({
      finished: false,
      progress: 0,
      progressValue: 0,
      progressText: '0%',
      resumePosition: 0,
      showMenu: false,
      showControls: false
    })
    if (this.stats) this.stats.reset()
    this._statSaved = false
  },

  /* ======================================================================
   * 排版
   * ==================================================================== */

  /**
   * 重新解析 + 虚拟列表渲染。
   * @param {object} [opts] keepProgress=true 时保留当前进度
   */
  _parseAndLayout(opts) {
    const keep = !!(opts && opts.keepProgress)
    if (!this.script) return

    const s = this.data.settings || settingsEngine.DEFAULTS
    const fontSize = s.fontSize
    const lineHeightPx = settingsEngine.lineHeightPxOf(s)
    const letterSpacing = s.letterSpacing

    // 可用宽度 = 屏宽 × 台词区宽% − 左右 16px 内边距 − 安全区（横屏刘海/圆角会吃掉几十 px）
    // 之前没扣安全区：横屏每行多算 2 个字 → CSS 折成两行 → 行高又是写死的 → 台词重叠。
    const padL = this._safePadLeft()
    const padR = this._safePadRight()
    const usable = Math.max(
      80,
      (this.winWidth * s.contentWidth) / 100 - settingsEngine.TEXT_PADDING_X * 2 - padL - padR
    )
    // 4px 余量：给字体度量的亚像素误差留点空间（只在「刚好塞满一行」的临界值上生效，
    // 不影响常规字号的行宽）。行盒本身用 min-height，所以真折行也不会叠字。
    const charsPerLine = Math.max(6, Math.floor((usable - 4) / (fontSize + letterSpacing)))
    // 供速度换算用：每字纵向像素 = 行高 / 每行字数（纯几何，与稿件长度无关）
    this._charsPerLine = charsPerLine

    const legacy = prefsEngine.load()
    const smartOff = !!legacy.smartOff
    // 角色高亮「开没开」以 prefs 为准（编辑页角色面板改的就是它），再叠加菜单里的
    // 每方向设置与智能总闸 —— 三处任意一处关掉都不出颜色，避免"开关关着却满屏颜色"。
    const wantRole = s.roleHighlight !== false && legacy.roleHighlight !== false && !smartOff

    const parsed = parser.parseScript(this.script.content, {
      charsPerLine: charsPerLine,
      manualRoles: this.script.manualRoles || [],
      roleBlacklist: this.script.roleBlacklist || [],
      roleAlias: this.script.roleAlias || {},
      roleHighlight: wantRole,
      isDark: !this._isLightBg(s.backgroundColor),
      roleColorOverride: this.script.roleColorOverride || {}
    })
    this.allAliases = parsed.alias || {}

    const textColor = s.textColor
    const lines = parsed.lines.map((line, i) => {
      const roleColor = line.role ? roleEngine.colorOf(parsed.roles, line.role) : null
      const role = wantRole && line.role ? line.role : null
      return {
        _i: i,
        role: role,
        // 段首行才带角色名前缀（内联渲染）；续行只显示正文
        showRole: !!(role && line.isSectionStart !== false),
        rolePrefix: role && line.rolePrefix ? line.rolePrefix : '',
        text: line.text,
        body: line.body !== undefined ? line.body : line.text,
        color: role && roleColor ? roleColor : textColor,
        prefixColor: role && roleColor ? roleColor : textColor,
        bodyColor: textColor,
        roleBg: role && roleColor ? hexToRgba(roleColor, 0.2) : 'rgba(255,255,255,0.12)',
        sectionIndex: line.sectionIndex
      }
    })

    this.allLines = lines
    this.allRoles = parsed.roles
    this.roleFilter = smartOff ? null : this._roleDisplayFilter()
    this.displayLines = smartOff
      ? lines
      : roleEngine.filterLinesByRole(lines, this.roleFilter)

    // ── 超长稿守卫 ────────────────────────────────────────────────────
    // 全量渲染的代价是整篇行对象在一次 setData 里过桥，微信单次 setData
    // 上限 1024KB，5000 行 ≈ 1.6MB 会直接白屏。超过 BLOB_LINES 就降级成
    // 「一整块纯文本」（内容一字不丢，DOM 只剩 1 个节点，setData 只有几 KB）。
    const blobMode = this.displayLines.length > BLOB_LINES
    if (blobMode) {
      const blobText = String(this.script.content || '').replace(/\r\n?/g, '\n')
      let visualLines = 0
      for (const seg of blobText.split('\n')) {
        visualLines += Math.max(1, Math.ceil(seg.length / charsPerLine))
      }
      this._blobVisualLines = visualLines
      // text 留空，全文只放 body 一份，避免 setData 体积翻倍
      this.displayLines = [
        {
          _i: 0,
          blob: true,
          role: null,
          showRole: false,
          rolePrefix: '',
          text: '',
          body: blobText,
          color: textColor,
          prefixColor: textColor,
          bodyColor: textColor,
          roleBg: 'rgba(255,255,255,0.12)',
          sectionIndex: 0
        }
      ]
      this._blobLineCount = lines.length
    } else {
      this._blobVisualLines = 0
      this._blobLineCount = 0
    }

    // 行高地形图：每行按「估算的视觉行数」记高度，供虚拟列表定位。
    // 绝大多数行是 1 行高；角色名特别长的行会被 CSS 折成 2 行，
    // 渲染层已经用 min-height（不写死 height）让盒子自己撑开 —— 不会压到下一行。
    let estTextHeight
    if (blobMode) {
      // 纯文本块只有 1 个节点，不做行高地形图（定位由 .tp-blob-line 自己撑高）
      this._lineTops = []
      this._lineHs = []
      estTextHeight = this._blobVisualLines * lineHeightPx
    } else {
      estTextHeight = this._buildLineMetrics(lineHeightPx, charsPerLine)
    }
    const textHeight = estTextHeight
    this.contentHeight = textHeight
    const startPad = this._startPadOf(s.startPosition)
    const endPad = Math.round(this.winHeight * 0.75)
    const totalScroll = Math.max(0, startPad + textHeight + endPad - this.winHeight)

    // 全量渲染：台词一次给全，滚动期间不再换批（见 BLOB_LINES 注释）。
    // 只发一份 lines —— 以前 lines + visibleLines 各发一次，setData 体积翻倍，
    // 长稿光过桥就要几十毫秒。量高度时 .tp-lines 就是全文，
    // _measureContent 的标定比例自然等于 1，每字像素也就准了。
    this._estSliceH = textHeight

    const patch = {
      lines: this.displayLines,
      fontSizePx: fontSize,
      lineHeightPx: lineHeightPx,
      roleFontSize: Math.max(10, Math.round(fontSize * 0.62)),
      roleLineHeight: Math.max(16, Math.round(fontSize * 0.62 * 1.7)),
      letterSpacing: letterSpacing,
      contentWidth: s.contentWidth,
      textAlign: s.textAlign,
      fontFamily: settingsEngine.FONT_FAMILIES[s.fontFamily] || settingsEngine.FONT_FAMILIES.system,
      fontFamilyLabel: settingsEngine.fontFamilyLabel(s.fontFamily),
      fontBold: !!s.fontBold,
      marginHorizontal: Math.round(((100 - s.contentWidth) / 100) * this.winWidth / 2),
      bg: s.backgroundColor,
      textColor: textColor,
      isDark: !this._isLightBg(s.backgroundColor),
      mirror: !!s.mirror,
      showGuide: s.showCue !== false,
      showCue: s.showCue !== false,
      cuePosition: s.cuePosition,
      focus: !!s.focus,
      loop: !!s.loop,
      showClocks: s.showClocks !== false,
      roleHighlight: wantRole,
      smartOff: smartOff,
      keepScreenOn: s.keepScreenOn !== false,
      fillLight: !!s.fillLight,
      contentHeight: textHeight,
      textHeight: textHeight,
      startPad: startPad,
      endPad: endPad,
      totalScroll: totalScroll,
      viewportHeight: this.winHeight,
      pctSpeed: this._pctOfSpeed(s),
      pctFontSize: pct(s.fontSize, settingsEngine.FONT_SIZE_MIN, settingsEngine.FONT_SIZE_MAX),
      pctLineHeight: pct(s.lineHeight, settingsEngine.LINE_HEIGHT_MIN, settingsEngine.LINE_HEIGHT_MAX),
      pctLetterSpacing: pct(s.letterSpacing, settingsEngine.LETTER_SPACING_MIN, settingsEngine.LETTER_SPACING_MAX),
      pctCue: pct(s.cuePosition, settingsEngine.CUE_MIN, settingsEngine.CUE_MAX),
      pctWidth: pct(s.contentWidth, settingsEngine.CONTENT_WIDTH_MIN, settingsEngine.CONTENT_WIDTH_MAX),
      pctCountdown: pct(s.countdown, 0, settingsEngine.COUNTDOWN_MAX),
      speedText: settingsEngine.speedLabel(s),
      speedUnitText: settingsEngine.speedUnitLabel(s),
      speed: s.speedUnit === 'px' ? s.speed : s.speedCpm,
      speedMin: s.speedUnit === 'px' ? timeline.LEGACY_SPEED_MIN : timeline.CPM_MIN,
      speedMax: s.speedUnit === 'px' ? timeline.LEGACY_SPEED_MAX : timeline.CPM_MAX,
      colorWarning: settingsEngine.isColorTooClose(s.textColor, s.backgroundColor),
      scrollStyle: s.voiceControl ? 'voice' : 'smooth',
      scrollMode: s.voiceControl ? 'voice' : 'auto',
      voiceEnabled: !!s.voiceControl,
      blobMode: blobMode,
      blobLineCount: this._blobLineCount
    }
    this.setData(patch)

    // 用估算高度先配一遍引擎（真实高度由 _measureContent 量出后 _finishLayout 再配一次）
    this._configureEngine()

    if (blobMode && !this._blobToasted) {
      this._blobToasted = true
      util.toast(`稿件共 ${this._blobLineCount} 行，已切换纯文本模式（暂不支持角色高亮）`)
    }

    // 量真实文本高度后重配引擎 + 落定 totalScroll
    this._measureContent(keep)
  },

  _isLightBg(hex) {
    const rgb = settingsEngine.colorToRgb(hex)
    if (!rgb) return false
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
    return lum > 0.6
  },

  /** 文本高度（内联角色名，等行高）：blob 模式按视觉行数，其余按行数 */
  _estimateHeight(lines, lineHeightPx) {
    if (lines.length === 1 && lines[0] && lines[0].blob) {
      return (this._blobVisualLines || 1) * lineHeightPx
    }
    return lines.length * lineHeightPx
  },

  /** 起播留白：浅纸 placeholder.upper —— middle = 50vh、bottom = 92vh */
  _startPadOf(pos) {
    if (pos === 'bottom') return Math.round(this.winHeight * 0.92)
    return Math.round(this.winHeight * 0.5)
  },

  /* ── 安全区（刘海 / 挖孔 / 圆角 / Home 指示条）─────────────────────
   * 两个用途，必须共用同一份数据，否则会互相打架：
   *   1) 排版：CSS 里台词行要留 padding，JS 估算每行字数也要扣掉同一份，
   *      两边不一致 → 每行多算 2 个字 → 真机折行 → 叠字。
   *   2) 悬浮元素：时钟、进度条、菜单钮要避开刘海与底部横条。
   *
   * ⚠️ 不能只靠 CSS 的 env(safe-area-inset-*)：
   *   小程序里该变量在部分安卓机型恒为 0（有些 iOS 场景也是），
   *   而 wx.getWindowInfo().safeArea 是稳定可用的。所以以 JS 为准，env() 只当兜底。 */
  _readSafeArea() {
    let info = null
    try {
      info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    } catch (e) {
      info = null
    }
    const w = (info && info.windowWidth) || this.winWidth || 375
    const h = (info && info.windowHeight) || this.winHeight || 667
    const sa = (info && info.safeArea) || null
    const statusBar = (info && info.statusBarHeight) || 0

    this._safeLeft = sa && sa.left > 0 ? Math.round(sa.left) : 0
    this._safeRight = sa && sa.right > 0 && sa.right < w ? Math.round(w - sa.right) : 0
    // 顶部：safeArea.top 已经把刘海/挖孔/状态栏都算进去了；
    // 拿不到 safeArea 时退而求其次，至少让出状态栏高度（否则时钟会压在状态栏下面）。
    this._safeTop = sa && sa.top > 0 ? Math.round(sa.top) : Math.round(statusBar)
    // 底部：iPhone 的 Home 指示条 / 安卓手势条
    this._safeBottom =
      sa && sa.bottom > 0 && sa.bottom <= h ? Math.max(0, Math.round(h - sa.bottom)) : 0
    return {
      top: this._safeTop,
      bottom: this._safeBottom,
      left: this._safeLeft,
      right: this._safeRight
    }
  },

  /** 把安全区同步到 data（WXML 用 CSS 变量消费，改一次全页面生效） */
  _syncSafeInsets() {
    const s = this._readSafeArea()
    if (
      this.data.safeTop === s.top &&
      this.data.safeBottom === s.bottom &&
      this.data.safeLeft === s.left &&
      this.data.safeRight === s.right
    ) return s
    this.setData({
      safeTop: s.top,
      safeBottom: s.bottom,
      safeLeft: s.left,
      safeRight: s.right
    })
    return s
  },

  _safePadLeft() {
    if (this._safeLeft === undefined) this._readSafeArea()
    return this._safeLeft || 0
  },

  _safePadRight() {
    if (this._safeRight === undefined) this._readSafeArea()
    return this._safeRight || 0
  },

  /**
   * 估算一行会占几个视觉行（1–4）。
   * 用 parser.visualWidth —— 和切行用的是同一个度量，两边才不会打架。
   * CSS 侧只给 min-height，所以这里估多了只是多点空白，估少了也不会叠字。
   */
  _rowsOfLine(line, charsPerLine) {
    if (!line || line.blob || !(charsPerLine > 0)) return 1
    const w = parser.visualWidth((line.rolePrefix || '') + (line.body || ''))
    if (!(w > 0)) return 1
    return Math.max(1, Math.min(4, Math.ceil(w / charsPerLine)))
  },

  /** 生成 _lineTops（每行顶部 y）/ _lineHs（每行高），返回估算文本总高 */
  _buildLineMetrics(lineHeightPx, charsPerLine) {
    const list = this.displayLines || []
    const tops = new Array(list.length)
    const hs = new Array(list.length)
    let y = 0
    for (let i = 0; i < list.length; i++) {
      const h = this._rowsOfLine(list[i], charsPerLine) * lineHeightPx
      tops[i] = y
      hs[i] = h
      y += h
    }
    this._lineTops = tops
    this._lineHs = hs
    return y
  },

  /** 估算 [start, start+count) 这段渲染切片的高度 */
  _sliceHeight(start, count) {
    const hs = this._lineHs
    if (!hs || !hs.length) return 0
    const from = Math.max(0, Math.min(hs.length, start || 0))
    const to = Math.max(from, Math.min(hs.length, from + (count || 0)))
    let sum = 0
    for (let i = from; i < to; i++) sum += hs[i]
    return sum
  },

  /** 二分：给定内容区 y，返回它落在第几行（越界自行钳制） */
  _indexAtOffset(y) {
    const tops = this._lineTops
    if (!tops || !tops.length) return 0
    let lo = 0
    let hi = tops.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (tops[mid] <= y) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  },

  /** 用当前 textHeight/startPad/endPad 配置滚动引擎 */
  _configureEngine() {
    if (!this.engine) return
    const lineH = this.data.lineHeightPx || 1
    const totalH = (this.data.startPad || 0) + (this.data.textHeight || 0) + (this.data.endPad || 0)
    const msPerPx = this._msPerPx()
    const pxPerSecond = msPerPx > 0 ? 1000 / msPerPx : 0
    // 结束线 = 一屏高：endOffset = totalH - winHeight = startPad+textH+endPad-winHeight
    this.engine.configure(lineH, totalH, this.winHeight, pxPerSecond, this.winHeight)
    // 双保险：configure 内部已写 pxPerSecond，这里再显式推一次。
    // 万一将来 configure 因为尺寸异常提前返回，速度也不会停留在旧值上。
    this.engine.setSpeed(pxPerSecond)
    this.engine.loop = false // loop 重播由页面层处理，不启用引擎无缝回绕

    // 把「引擎实际在用的速度」暴露到视图：菜单里显示成 xx px/s。
    // 这一项的用途是自证——数字调了以后 px/s 有没有跟着变，一眼就能看出来，
    // 不用再靠「盯着屏幕猜快慢」。
    const px = Math.round(pxPerSecond * 10) / 10
    if (this.data.speedPxPerSec !== px) this.setData({ speedPxPerSec: px })
  },

  _measureContent(keep) {
    if (typeof wx.createSelectorQuery !== 'function') {
      this._finishLayout(this.data.textHeight, keep)
      return
    }
    const self = this
    // 注意：Page 里不能调 .in(this)（那是自定义组件专用），否则永远拿不到高度
    // → 文字高度只能靠估算 → 滚动距离与「字/分钟」全部失真。
    //
    // 现在列表是全量渲染，量到的就是全文高度，标定比例基本等于 1；
    // 仍保留「实测 / 估算」的比例换算是为了兼容降级成纯文本块（blob）的路径，
    // 以及老基础库上第一次测不到高度的场景。
    //
    // 这也顺带让「每字纵向像素 = 全文高 ÷ 字数」变成实测值 —— 速度换算的最后
    // 一层估算误差就此消掉：设定多少字/分，就真的走多少字/分。
    wx.createSelectorQuery()
      .select('.tp-lines')
      .boundingClientRect((rect) => {
        const measured = rect && rect.height ? Math.round(rect.height) : 0
        const estSlice = self._estSliceH || 0
        const estTotal = self.data.textHeight || 0
        let h = measured || estTotal
        if (measured > 0 && estSlice > 0 && estTotal > 0) {
          h = Math.max(1, Math.round((estTotal * measured) / estSlice))
        }
        self._finishLayout(h, keep)
      })
      .exec()
  },

  _finishLayout(textH, keep) {
    const prevRatio = this.engine ? this.engine.progress : 0
    const wasPlaying = this.data.status === 'playing'
    const total = Math.max(0, this.data.startPad + textH + this.data.endPad - this.winHeight)

    this.setData({ textHeight: textH, totalScroll: total })
    // 用真实高度重配引擎（configure 会 clamp current 到新范围，不会跳）
    this._configureEngine()

    if (keep || wasPlaying) {
      this._seekTo(prevRatio)
      if (wasPlaying) this.engine.start()
    } else {
      this._seekPx(Math.min(this.engine ? this.engine.current : 0, total))
    }
    this._updateProgress()
  },

  /** 兼容旧调用：只做一次排版并保留进度 */
  _relayoutKeepProgress() {
    const p = this.engine ? this.engine.progress : 0
    const wasPlaying = this.data.status === 'playing'
    this._parseAndLayout({ keepProgress: true })
    if (wasPlaying && !this.data.voiceEnabled) {
      this.engine.start()
      this.setData({ playing: true, status: 'playing' })
    }
  },

  /**
   * 渲染列表守护。
   *
   * 2026-10-29 起不再做「边滚边换批」的虚拟列表 —— 换批那一帧要重建几十个节点，
   * 必掉一帧，观感就是「间歇性跳一下」。台词一次性渲染完，滚动期间只有 transform 变。
   * 这里只剩一个职责：过滤角色导致 displayLines 变短/变长时，把新列表推给视图。
   */
  _updateVisible(force) {
    if (this.data.blobMode) return
    if (this.data.lines === this.displayLines && !force) return
    this.setData({ lines: this.displayLines })
  },

  /** 把引擎位置同步回视图（seek/reset 后调用） */
  _syncOffsetFromEngine() {
    const offset = this.engine ? this.engine.current : 0
    const p = this.engine ? this.engine.progress : 0
    this.setData({
      offset: offset,
      autoTop: offset,
      progressText: Math.round(p * 100) + '%',
      progressValue: Math.round(p * 100)
    })
  },

  /* ======================================================================
   * 速度
   * ==================================================================== */

  _speedContext() {
    let charCount = 0
    for (let i = 0; i < this.displayLines.length; i++) {
      charCount += timeline.countWeightedChars(this.displayLines[i].body || this.displayLines[i].text)
    }
    this._charCount = charCount

    // 每字纵向像素 —— 「字/分钟 → 像素/秒」唯一稳定的桥梁。
    //
    // 两个口径，优先用实测：
    //   理论值 geo  = 行高 ÷ 每行最多能放几个字
    //   实测值 real = 文字总高 ÷ 加权字数
    //
    // 为什么实测更准：提词稿大量是短句（对白一句一行），一行往往只放 4–6 个字，
    // 而 geo 假设每行都塞满（7 个字）。用 geo 会把每字像素算小 → 同样 600 字/分，
    // 实际只跑出约 470 字/分，用户看到的就是「拉到 600 还是慢」。
    // 实测值把「短句不占满一行」这层损耗算了进去，设定的字/分钟才和观感对得上。
    //
    // 但 textHeight 可能被高度标定算歪（切片比例失真），所以加护栏：
    // 超出 geo 的 [0.8, 2.5] 倍就判定为测量异常，退回几何值。
    // 注意 textHeight 只含文字，不含 startPad/endPad，所以不会重蹈「留白摊进分母」的老路。
    const lineH = Number(this.data.lineHeightPx) || 0
    const cpl = Number(this._charsPerLine) || 0
    const geo = lineH > 0 && cpl > 0 ? lineH / cpl : 0
    const textH = Number(this.data.textHeight) || 0
    const real = charCount > 0 && textH > 0 ? textH / charCount : 0

    let pxPerChar = geo
    if (real > 0 && (geo <= 0 || (real >= geo * 0.8 && real <= geo * 2.5))) {
      pxPerChar = real
    }
    if (!(pxPerChar > 0) && real > 0) pxPerChar = real

    return {
      charCount: charCount,
      scrollDistance: this.data.totalScroll,
      pxPerChar: pxPerChar,
      windowWidth: this.winWidth
    }
  },

  /** 每像素毫秒数：整篇播放时长的唯一来源 */
  _msPerPx() {
    const s = this.data.settings || settingsEngine.DEFAULTS
    const r = timeline.resolveSpeed(s, this._speedContext())
    if (!isFinite(r.msPerPx) || r.msPerPx <= 0) return 0
    return r.msPerPx
  },

  _pctOfSpeed(s) {
    if (s.speedUnit === 'px') {
      return pct(s.speed, timeline.LEGACY_SPEED_MIN, timeline.LEGACY_SPEED_MAX)
    }
    // 对数刻度：滑块位置与「速度的倍数」成正比（详见 timeline.cpmRatio 注释），
    // 否则 20–1200 的线性映射会把 200 挤在 15% 处，200→300 只占 4% 行程。
    return Math.round(timeline.cpmRatio(s.speedCpm) * 1000) / 10
  },

  /* ======================================================================
   * 播放控制（ScrollEngine 逐帧）
   * ==================================================================== */

  _play() {
    if (!this.displayLines.length) return
    if (this.data.status === 'playing') return
    const total = this.data.totalScroll
    if (total <= 0) return

    const s = this.data.settings
    const from = this.engine ? this.engine.current : 0

    // 已到末尾：从头开始
    if (from >= total - 1) {
      this.engine.seekProgress(0)
      this._syncOffsetFromEngine()
    }

    // 从静止起播、且设置了倒计时 → 先倒数
    if (s.countdown > 0 && from <= 0 && this.data.status === 'stopped' && !this._countdownDone) {
      this._startCountdown()
      return
    }
    this._countdownDone = false

    // 播放前按最新设置重配速度（兜底：即使速度经非 _setSetting 路径写入，也不会拿旧速滚）
    this._configureEngine()
    this.engine.start()
    this.setData({
      status: 'playing',
      playing: true,
      finished: false,
      autoTop: this.engine.current,
      offset: this.engine.current,
      finishHint: ''
    })
    if (this.stats && this.stats.onStart) this.stats.onStart()
  },

  _pause(silent) {
    if (this.data.status !== 'playing') {
      this.setData({ playing: false })
      return
    }
    if (this.engine) this.engine.pause()
    this.setData({ status: 'paused', playing: false })
    this._syncOffsetFromEngine()
    this._updateProgress()
    if (!silent) {
      if (this.stats && this.stats.onPause) this.stats.onPause()
      this._savePosition()
    }
  },

  _stopAnimation() {
    // 兼容旧调用：引擎停表统一走 engine.pause/stop
    if (this.engine) this.engine.pause()
  },

  /** 引擎逐帧回调：offset 每帧给，百分比整数变化才给，每 8 帧裁剪一次 */
  _onUpdate(offset, progress, lineIndex) {
    if (!isFinite(offset)) return
    if (this.stats) this.stats.onTick(progress)

    // 亚像素过滤：位移不到 0.35px 时这一帧不需要重绘。
    // 慢速档（20 字/分 ≈ 4px/s）下每帧只走 0.07px，若照样 setData，
    // 渲染层会收到大量「几乎相同」的 transform —— 白耗一次渲染预算，
    // 反而更容易在别的帧上掉帧。攒到肉眼能分辨再发。
    const delta = Math.abs(offset - (this._lastOffsetSent || 0))
    const pctVal = Math.round(progress * 100)
    const needPct = pctVal !== this._lastPct
    if (delta < 0.35 && !needPct) return
    this._lastOffsetSent = offset

    // 两位小数足够（0.01px 远小于一个物理像素），同时让 setData 的字符串更短
    const shown = Math.round(offset * 100) / 100
    const patch = { offset: shown, autoTop: shown }
    if (needPct) {
      this._lastPct = pctVal
      patch.progressText = pctVal + '%'
      patch.progressValue = pctVal
    }
    if (this.data.focus) {
      const fi = this._focusIndexOf(offset)
      if (fi !== this.data.focusIndex) patch.focusIndex = fi
    }

    // 只发一次 setData：以前这里还每 8 帧塞一次 visibleLines，
    // 那一帧要重建几十个节点 → 掉帧 → 「隔一会儿顿一下」。现在列表恒定，不再重建。
    this.setData(patch)
  },

  _onEnd() {
    if (this.stats) this.stats.onEnd()
    this._finalizeStats(true)
    this._freeTop = this.data.totalScroll
    this.setData({
      status: 'stopped',
      playing: false,
      autoTop: this.data.totalScroll,
      offset: this.data.totalScroll,
      progressValue: 100,
      progressText: '100%',
      finished: true
    })
    this._savePosition()

    if (this.data.settings.loop) {
      setTimeout(() => {
        this._seekPx(0)
        setTimeout(() => this._play(), 700)
      }, 700)
    }
  },

  _onLoop() {
    if (this.stats) this.stats.onLoop()
    this._lastSection = -1
  },

  /** 跳转到指定进度 0–1 */
  _seekTo(p) {
    const ratio = Math.max(0, Math.min(1, Number(p) || 0))
    if (this.engine) this.engine.seekProgress(ratio)
    this._syncOffsetFromEngine()
    this._updateVisible(true)
  },

  /** 跳转到指定像素位置 */
  _seekPx(px) {
    const total = this.data.totalScroll
    const target = Math.max(0, Math.min(total, Math.round(px || 0)))
    if (this.engine) this.engine.syncTo(target)
    this._freeTop = target
    this._lastOffsetSent = -1
    this.setData({
      autoTop: target,
      offset: target,
      freeTop: target,
      finished: false
    })
    this._updateVisible(true)
    this._updateProgress()
  },

  /**
   * 手动滚动（兼容旧 scroll-view 入口 + 测试直调）。
   * 滚动真值已由 ScrollEngine.current 承载，这里只做同步落位。
   */
  onFreeScroll(e) {
    const top = e && e.detail && e.detail.scrollTop
    if (typeof top !== 'number') return
    this._freeTop = top
    if (this.engine) this.engine.syncTo(top)
    this.setData({ autoTop: top, offset: top })
    this._updateProgress()
    this._savePositionThrottled()
  },

  _startProgressTimer() {
    // 进度已由 _onUpdate 逐帧节流更新，这里不再单开定时器（保留方法兼容）
  },

  _stopProgressTimer() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer)
      this._progressTimer = null
    }
  },

  _paintProgress(top) {
    const total = this.data.totalScroll
    const p = total > 0 ? Math.max(0, Math.min(1, top / total)) : 0
    const val = Math.round(p * 100)
    const patch = {}
    if (val !== this.data.progressValue) {
      patch.progress = p
      patch.progressValue = val
      patch.progressText = val + '%'
    }
    if (this.data.focus) {
      const fi = this._focusIndexOf(top)
      if (fi !== this.data.focusIndex) patch.focusIndex = fi
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  _focusIndexOf(top) {
    const s = this.data.settings || {}
    const vh = this.winHeight || this.data.viewportHeight || 0
    const cueY = vh * ((s.cuePosition === undefined ? 50 : s.cuePosition) / 100)
    // 折行会让「行号 = offset / 行高」失真，这里改走行高地形图
    const idx = this._indexAtOffset(top + cueY - (this.data.startPad || 0))
    return Math.max(0, Math.min(Math.max(0, this.displayLines.length - 1), idx))
  },

  _updateProgress() {
    this._paintProgress(this.engine ? this.engine.current : this.data.autoTop)
  },

  /* ======================================================================
   * 点击 / 手势
   * ==================================================================== */

  /** 单击屏幕 = 播放 / 暂停（浅纸一致，即时响应） */
  onTapScreen() {
    if (this.data.showMenu) {
      this.onCloseMenu()
      return
    }
    this.onTapPlay()
  },

  onTapPlay() {
    this._clearCountdown()
    if (this.data.status === 'playing') {
      this._pause()
    } else {
      this._play()
    }
    this._savePosition()
  },

  onTapRestart() {
    this._lastSection = -1
    this._wrapped = false
    this._seekPx(0)
    this.setData({ finished: false })
    this._play()
  },

  /* ── 手势翻页：按下暂停、拖动调位、松手续播 ── */
  onTouchStart(e) {
    this._touchWasPlaying = this.data.status === 'playing'
    if (this._touchWasPlaying) this._pause(true)
    this._touching = true
    this._dragged = false
    this._touchStartY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    this._touchStartOffset = this.engine ? this.engine.current : this.data.autoTop
  },

  onTouchMove(e) {
    if (!this._touching) return
    const y = e.touches && e.touches[0] ? e.touches[0].clientY : this._touchStartY
    const dy = y - this._touchStartY
    if (Math.abs(dy) > 6) this._dragged = true
    this._seekPx(this._touchStartOffset - dy)
  },

  onTouchEnd() {
    if (!this._touching) return
    this._touching = false
    // 只有「本来在播 + 确实拖动过」才续播；轻点不唤醒，避免误触
    if (this._touchWasPlaying && this._dragged) this._play()
    this._touchWasPlaying = false
    this._dragged = false
    this._savePosition()
  },

  onTouchCancel() {
    this.onTouchEnd()
  },

  /* ── 右侧进度条拖动 ── */
  onProgressTouchStart(e) {
    this._seeking = true
    this._resumeAfterSeek = this.data.status === 'playing'
    if (this._resumeAfterSeek) this._pause(true)
    this.onProgressTouchMove(e)
  },

  onProgressTouchMove(e) {
    if (!this._seeking) return
    const y = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    const ratio = this.winHeight > 0 ? Math.max(0, Math.min(1, y / this.winHeight)) : 0
    const px = Math.round(ratio * this.data.totalScroll)
    if (this.engine) this.engine.syncTo(px)
    this.setData({ autoTop: px, offset: px })
    this._paintProgress(px)
  },

  onProgressTouchEnd() {
    if (!this._seeking) return
    this._seeking = false
    this._updateVisible(true)
    if (this._resumeAfterSeek) this._play()
    this._resumeAfterSeek = false
    this._savePosition()
  },

  /* ======================================================================
   * 菜单
   * ==================================================================== */

  onOpenMenu() {
    this._wasPlayingBeforeMenu = this.data.status === 'playing'
    if (this._wasPlayingBeforeMenu) this._pause(true)
    this.setData({ showMenu: true, showControls: true, menuHeight: this.winHeight * 0.84 })
    // 每次开菜单都重新量：上一次可能滚过菜单、或换过横竖屏，旧坐标一定不准
    this._sliderRects = {}
    this._cacheSliderRects()
  },

  onCloseMenu() {
    if (!this.data.showMenu) return
    this.setData({ showMenu: false, showControls: false, colorPicker: '' })
    this._sliderRects = {}
    if (this._wasPlayingBeforeMenu) {
      this._wasPlayingBeforeMenu = false
      this._play()
    }
  },

  noop() {},

  /**
   * 预取全部滑块几何。
   * 菜单是 260ms 的 translate 动画：动画途中测到的 rect 在屏幕外，
   * 拿它算 ratio 会把数值瞬间甩到极值。所以量两次 —— 打开当拍 + 动画结束之后，
   * 后者才是可信坐标（_rectUsableV/H 会再校验一次）。
   */
  _cacheSliderRects() {
    this._rectsDirty = false
    const ids = SLIDER_KEYS.concat(HSLIDER_KEYS)
    ids.forEach((id) => this._querySlider(id))
    if (this._rectTimer) clearTimeout(this._rectTimer)
    this._rectTimer = setTimeout(() => {
      this._rectTimer = null
      if (!this.data.showMenu) return
      SLIDER_KEYS.concat(HSLIDER_KEYS).forEach((id) => this._querySlider(id))
    }, 320)
  },

  /**
   * 菜单（scroll-view）滚动 → 之前缓存的坐标全废。
   * 不清掉的话，用户滚动后再拖滑块会按旧坐标算 ratio，数值直接跳到别处。
   */
  onSheetScroll() {
    if (this._rectsDirty) return
    this._rectsDirty = true
    this._sliderRects = {}
  },

  /**
   * 测量单个滑块的轨道几何。
   *
   * 两个坑，都会让滑块「点了完全没反应」：
   * 1. 页面里不能写 `createSelectorQuery().in(this)` —— in() 只对自定义组件有效，
   *    Page 上调用会拿不到任何结果（旧实现这么写，导致 rect 永远为空）。
   * 2. 不能只在开菜单时缓存一次 —— 菜单是可滚动的 scroll-view，滚动后坐标全变了。
   * 所以这里做成「按需实时量」，触摸时补一次。
   */
  _querySlider(id, cb) {
    const done = (rect) => {
      if (rect) this._sliderRects[id] = rect
      if (typeof cb === 'function') cb(rect || null)
    }
    if (typeof wx.createSelectorQuery !== 'function') return done(null)
    try {
      const q = wx.createSelectorQuery()
      q.select('#' + id + ' .tp-vtrack').boundingClientRect()
      q.select('#' + id + ' .tp-htrack').boundingClientRect()
      q.select('#' + id).boundingClientRect()
      q.exec((res) => {
        const r = res || []
        const vTrack = r[0]
        const hTrack = r[1]
        const cell = r[2]
        const track =
          vTrack && vTrack.height > 0
            ? vTrack
            : hTrack && hTrack.width > 0
              ? hTrack
              : cell
        done(track || null)
      })
    } catch (e) {
      done(null)
    }
  },

  /* ── 竖滑块 ── */

  /**
   * 取滑块 id。**这是 2026-10-28「速度锁死」的第一个真因**：
   * 触摸事件挂在 .tp-vhit 上（为了不抢数值区的点击），而 e.currentTarget 指向
   * 「绑定事件的那个节点」＝ .tp-vhit，不是外面带 id 的 .tp-cell。
   * .tp-vhit 没有 id → e.currentTarget.id === ''，后面 _applySliderRatio('') 直接 return，
   * 于是所有竖滑块（速度/字号/行距/字距/指示线）在真机上点了完全没反应，
   * 而测试里手工喂了 currentTarget.id 所以一直"通过"（假绿）。
   * 现在 WXML 给 .tp-vhit 和横滑块格子都加了 data-slider，这里按 dataset → id → target 三级取。
   */
  _sliderIdOf(e) {
    const ct = (e && e.currentTarget) || {}
    const ds = ct.dataset || {}
    if (ds.slider) return ds.slider
    if (ct.id) return ct.id
    const tg = (e && e.target) || {}
    const tds = tg.dataset || {}
    return tds.slider || tg.id || ''
  },

  /**
   * 滑块量纲表：ratio ↔ 真实值只走这一份定义。
   * 之前「ratio 换算」和「值校验」分散在 _applySliderRatio 与各 handler 里，
   * 加一条相对拖动就要复制一遍区间常量 —— 迟早写歪，所以收成一张表。
   */
  _sliderSpec(id) {
    const s = this.data.settings || {}
    switch (id) {
      case 'vs-speed':
        return s.speedUnit === 'px'
          ? { key: 'speed', min: timeline.LEGACY_SPEED_MIN, max: timeline.LEGACY_SPEED_MAX, step: 0.1, mode: 'quick' }
          : {
              key: 'speedCpm',
              min: timeline.CPM_MIN,
              max: timeline.CPM_MAX,
              step: timeline.CPM_STEP,
              mode: 'quick',
              // 对数刻度：滑块行程按「倍数」分配，而不是按绝对差值
              log: true
            }
      case 'vs-fontSize':
        return { key: 'fontSize', min: settingsEngine.FONT_SIZE_MIN, max: settingsEngine.FONT_SIZE_MAX, step: 1, mode: 'layout' }
      case 'vs-lineHeight':
        return { key: 'lineHeight', min: settingsEngine.LINE_HEIGHT_MIN, max: settingsEngine.LINE_HEIGHT_MAX, step: 0.1, mode: 'layout' }
      case 'vs-letterSpacing':
        return { key: 'letterSpacing', min: settingsEngine.LETTER_SPACING_MIN, max: settingsEngine.LETTER_SPACING_MAX, step: 1, mode: 'layout' }
      case 'vs-cuePosition':
        return { key: 'cuePosition', min: settingsEngine.CUE_MIN, max: settingsEngine.CUE_MAX, step: 1, mode: 'quick' }
      case 'hs-contentWidth':
        return { key: 'contentWidth', min: settingsEngine.CONTENT_WIDTH_MIN, max: settingsEngine.CONTENT_WIDTH_MAX, step: 1, mode: 'layout' }
      case 'hs-countdown':
        return { key: 'countdown', min: 0, max: settingsEngine.COUNTDOWN_MAX, step: 1, mode: 'quick' }
      default:
        return null
    }
  },

  /**
   * 取触摸点坐标。
   *
   * ⚠️ 必须判断 `touches.length` 而不是 `e.touches || e.changedTouches`：
   * 手指抬起后 `e.touches` 是**空数组**（truthy），旧写法会拿空数组，
   * 于是 `undefined.clientY` → null → 滑块静默失效。
   * 而 selectorQuery 的回调是下一帧才执行，那时 `touches` 往往已经空了 ——
   * 「点一下就抬手」在真机上正好走这条路径，表现就是「点了完全没反应」。
   */
  _touchY(e) {
    if (!e) return null
    const t = e.touches && e.touches.length ? e.touches : (e.changedTouches || [])
    return t[0] && typeof t[0].clientY === 'number' ? t[0].clientY : null
  },

  _touchX(e) {
    if (!e) return null
    const t = e.touches && e.touches.length ? e.touches : (e.changedTouches || [])
    return t[0] && typeof t[0].clientX === 'number' ? t[0].clientX : null
  },

  /**
   * 几何可信度校验。
   * 菜单是 translateY / translateX 动画打开的，动画期间测到的 rect 在屏幕外，
   * 拿它算 ratio 会把速度瞬间甩到最大/最小 —— 用户看到的就是"数字乱跳、拖不动"。
   * 所以只认「落在视口内、且有长度」的 rect，其余一律当没量到。
   */
  _rectUsableV(rect) {
    if (!rect || !(rect.height > 20)) return false
    const top = typeof rect.top === 'number' ? rect.top : NaN
    if (!isFinite(top)) return false
    return top > -40 && top < (this.winHeight || 812) + 40
  },

  _rectUsableH(rect) {
    if (!rect || !(rect.width > 20)) return false
    const left = typeof rect.left === 'number' ? rect.left : NaN
    if (!isFinite(left)) return false
    return left > -40 && left < (this.winWidth || 375) + 40
  },

  /**
   * 触摸开始。
   *
   * 2026-10-28 第三次重构（宝哥反馈「速度调节仍无效」）：
   *   ① 事件从 `.tp-vhit` 上移到**整格 `.tp-cell`** —— 命中区由 94px 变成整格 132px，
   *      不再受「内层绝对定位算错 / 被子元素盖住 / height 为 0」影响；
   *   ② 起点只做一次「点哪到哪」，之后全程走相对位移，**不依赖任何几何测量**；
   *   ③ 异步补量只更新灵敏度（travel），不再拿已经失效的事件对象重算位置。
   */
  onVSliderStart(e) {
    const id = this._sliderIdOf(e)
    if (!id) return
    const spec = this._sliderSpec(id)
    if (!spec) return
    this._activeSlider = id

    const cur = Number(this.data.settings[spec.key])
    const y0 = this._touchY(e)
    const cached = this._sliderRects[id]
    const travel = this._rectUsableV(cached) ? cached.height : 0
    this._vDrag = {
      id: id,
      y0: y0,
      value0: isFinite(cur) ? cur : spec.min,
      travel: travel,
      placed: false
    }

    // 点哪到哪：只在按下这一刻用一次绝对坐标。
    // ⚠️ 必须限定「按在轨道范围内」—— 事件现在挂在整格上，格子下部还有标签区，
    // 按在轨道外时如果也做绝对定位，一点就掉到最慢（或跳到最快）。
    // 轨道外只记起点，交给后面的相对位移。
    const inTrack =
      cached && typeof y0 === 'number' && typeof cached.top === 'number' &&
      typeof cached.bottom === 'number' && y0 >= cached.top - 8 && y0 <= cached.bottom + 8
    if (this._rectUsableV(cached) && inTrack) {
      this._applyVSliderAtY(id, cached, y0)
      // 绝对定位后把起点同步成「刚落到的新值」，否则相对位移会从旧值算起，一拖就跳
      const now = Number(this.data.settings[spec.key])
      this._vDrag.value0 = isFinite(now) ? now : this._vDrag.value0
      this._vDrag.y0 = y0
      this._vDrag.placed = true
    }

    const token = (this._sliderToken = (this._sliderToken || 0) + 1)
    this._querySlider(id, (fresh) => {
      if (!fresh || token !== this._sliderToken) return
      if (!this._rectUsableV(fresh)) return
      this._sliderRects[id] = fresh
      const d = this._vDrag
      if (!d || d.id !== id) return
      if (!(d.travel > 20)) d.travel = fresh.height
      // 缓存原本是空的（首帧 / 刚打开菜单）→ 这一刻才第一次拿到几何：
      // 用**记下来的 y0** 补做一次绝对定位。不能再用事件对象 e ——
      // selectorQuery 的回调是下一帧执行，那时 e.touches 已经空了。
      const fy = d.y0
      const fBottom = typeof fresh.bottom === 'number' ? fresh.bottom : fresh.top + fresh.height
      const fIn = typeof fy === 'number' && fy >= fresh.top - 8 && fy <= fBottom + 8
      if (!d.placed && fIn) {
        this._applyVSliderAtY(id, fresh, fy)
        const now = Number(this.data.settings[spec.key])
        d.value0 = isFinite(now) ? now : d.value0
        d.placed = true
      }
    })
  },

  onVSliderMove(e) {
    const id = this._activeSlider || this._sliderIdOf(e)
    if (!id) return
    const d = this._vDrag
    const y = this._touchY(e)
    if (d && d.id === id && typeof d.y0 === 'number' && typeof y === 'number') {
      // 主路径：纯相对位移。与菜单滚到哪、几何准不准全都无关。
      const spec = this._sliderSpec(id)
      if (!spec) return
      const rectH = this._sliderRects[id] && this._sliderRects[id].height
      const travel = d.travel > 20 ? d.travel : rectH > 20 ? rectH : 46
      const dy = (y - d.y0) / travel
      if (spec.log) {
        // 对数刻度：手指位移换算成「比例行程」，而不是「绝对差值」。
        // 否则在 20–1200 的区间里，轻轻一拖就从 200 冲到 700，快段根本没法微调。
        this._applySliderValue(id, timeline.cpmFromRatio(timeline.cpmRatio(d.value0) - dy))
      } else {
        this._applySliderValue(id, d.value0 - dy * (spec.max - spec.min))
      }
      return
    }
    // 兜底（touchstart 丢了）：退回绝对定位
    const rect = this._sliderRects[id]
    if (this._rectUsableV(rect)) this._applyVSliderAt(id, rect, e)
  },

  onVSliderEnd() {
    const id = this._activeSlider
    this._activeSlider = ''
    this._vDrag = null
    // 收手时按当前真实位置重测一次，下次抬手就是准的
    if (id) this._querySlider(id)
    this._saveSettingsNow()
  },

  _applyVSliderAt(id, rect, e) {
    this._applyVSliderAtY(id, rect, this._touchY(e))
  },

  /** 用显式 y 定位（异步回调里事件对象已失效，只能靠记下来的 y0） */
  _applyVSliderAtY(id, rect, y) {
    if (!this._rectUsableV(rect)) return
    if (typeof y !== 'number') return
    const bottom = typeof rect.bottom === 'number' ? rect.bottom : rect.top + rect.height
    const ratio = Math.max(0, Math.min(1, (bottom - y) / rect.height))
    this._applySliderRatio(id, ratio)
  },

  /* ── 横向滑块 ── */

  onHSliderStart(e) {
    const id = this._sliderIdOf(e)
    if (!id) return
    const spec = this._sliderSpec(id)
    if (!spec) return
    this._activeHSlider = id

    const cur = Number(this.data.settings[spec.key])
    const x0 = this._touchX(e)
    const cached = this._sliderRects[id]
    this._hDrag = { id: id, x0: x0, value0: isFinite(cur) ? cur : spec.min, travel: 0 }
    if (this._rectUsableH(cached)) {
      this._hDrag.travel = cached.width
      this._applyHSliderAt(id, cached, e)
      const now = Number(this.data.settings[spec.key])
      this._hDrag.value0 = isFinite(now) ? now : this._hDrag.value0
      this._hDrag.x0 = x0
    }

    const token = (this._sliderToken = (this._sliderToken || 0) + 1)
    this._querySlider(id, (fresh) => {
      if (!fresh || token !== this._sliderToken) return
      if (!this._rectUsableH(fresh)) return
      this._sliderRects[id] = fresh
      if (this._hDrag && this._hDrag.id === id && !(this._hDrag.travel > 20)) {
        this._hDrag.travel = fresh.width
      }
    })
  },

  onHSliderMove(e) {
    const id = this._activeHSlider || this._sliderIdOf(e)
    if (!id) return
    const d = this._hDrag
    const x = this._touchX(e)
    if (d && d.id === id && typeof d.x0 === 'number' && typeof x === 'number') {
      const spec = this._sliderSpec(id)
      if (!spec) return
      const rectW = this._sliderRects[id] && this._sliderRects[id].width
      const travel = d.travel > 20 ? d.travel : rectW > 20 ? rectW : 200
      this._applySliderValue(id, d.value0 + ((x - d.x0) / travel) * (spec.max - spec.min))
      return
    }
    const rect = this._sliderRects[id]
    if (this._rectUsableH(rect)) this._applyHSliderAt(id, rect, e)
  },

  onHSliderEnd() {
    const id = this._activeHSlider
    this._activeHSlider = ''
    this._hDrag = null
    if (id) this._querySlider(id)
    this._saveSettingsNow()
  },

  _applyHSliderAt(id, rect, e) {
    if (!this._rectUsableH(rect)) return
    const x = this._touchX(e)
    if (typeof x !== 'number') return
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
    this._applySliderRatio(id, ratio)
  },

  /** ratio（0–1）→ 真实值。点击定位与「点哪到哪」都走这里 */
  _applySliderRatio(id, ratio) {
    const spec = this._sliderSpec(id)
    if (!spec) return
    const r = Math.max(0, Math.min(1, Number(ratio) || 0))
    // 对数刻度（速度）：ratio 直接映射成「倍数行程」
    if (spec.log) this._applySliderValue(id, timeline.cpmFromRatio(r))
    else this._applySliderValue(id, spec.min + r * (spec.max - spec.min))
  },

  /**
   * 真实值写入（唯一出口）。
   * 相对拖动直接给值，所以速度不依赖任何几何测量 —— 只要手指动了就一定有变化。
   */
  _applySliderValue(id, value) {
    const spec = this._sliderSpec(id)
    if (!spec) return
    const v = this._clampSliderValue(spec, value)
    if (v === null) return
    const cur = Number(this.data.settings[spec.key])
    if (isFinite(cur) && Math.abs(cur - v) < 1e-6) return
    const patch = {}
    patch[spec.key] = v
    this._setSetting(patch, spec.mode)
    // 速度类：除了 _setSetting 里的重配，再把新速度直推引擎一次。
    // 目的：哪怕 configure 因为「内容高度还没量出来」被跳过，速度也不会停留在旧值。
    if (spec.key === 'speedCpm' || spec.key === 'speed') {
      const ms = this._msPerPx()
      if (this.engine && ms > 0) this.engine.setSpeed(1000 / ms)
    }
  },

  _clampSliderValue(spec, value) {
    if (!isFinite(value)) return null
    const clamped = Math.max(spec.min, Math.min(spec.max, Number(value)))
    if (spec.key === 'speedCpm') return timeline.clampCpm(clamped)
    if (spec.key === 'speed') return timeline.clampLegacySpeed(clamped)
    const step = spec.step > 0 ? spec.step : 1
    const snapped = Math.round(clamped / step) * step
    return Math.round(snapped * 1000) / 1000
  },

  /**
   * 写入设置。
   * @param {object} patch
   * @param {'layout'|'quick'|'none'} mode
   */
  _setSetting(patch, mode) {
    const orientation = this.data.orientation
    const next = settingsEngine.patch(orientation, patch)
    const view = {
      settings: next,
      fontSizePx: next.fontSize,
      lineHeightPx: settingsEngine.lineHeightPxOf(next),
      letterSpacing: next.letterSpacing,
      contentWidth: next.contentWidth,
      marginHorizontal: Math.round(((100 - next.contentWidth) / 100) * this.winWidth / 2),
      textAlign: next.textAlign,
      fontFamily: settingsEngine.FONT_FAMILIES[next.fontFamily] || settingsEngine.FONT_FAMILIES.system,
      fontFamilyLabel: settingsEngine.fontFamilyLabel(next.fontFamily),
      fontBold: !!next.fontBold,
      bg: next.backgroundColor,
      textColor: next.textColor,
      showCue: next.showCue !== false,
      cuePosition: next.cuePosition,
      pctSpeed: this._pctOfSpeed(next),
      pctFontSize: pct(next.fontSize, settingsEngine.FONT_SIZE_MIN, settingsEngine.FONT_SIZE_MAX),
      pctLineHeight: pct(next.lineHeight, settingsEngine.LINE_HEIGHT_MIN, settingsEngine.LINE_HEIGHT_MAX),
      pctLetterSpacing: pct(next.letterSpacing, settingsEngine.LETTER_SPACING_MIN, settingsEngine.LETTER_SPACING_MAX),
      pctCue: pct(next.cuePosition, settingsEngine.CUE_MIN, settingsEngine.CUE_MAX),
      pctWidth: pct(next.contentWidth, settingsEngine.CONTENT_WIDTH_MIN, settingsEngine.CONTENT_WIDTH_MAX),
      pctCountdown: pct(next.countdown, 0, settingsEngine.COUNTDOWN_MAX),
      speedText: settingsEngine.speedLabel(next),
      speedUnitText: settingsEngine.speedUnitLabel(next),
      speed: next.speedUnit === 'px' ? next.speed : next.speedCpm,
      speedMin: next.speedUnit === 'px' ? timeline.LEGACY_SPEED_MIN : timeline.CPM_MIN,
      speedMax: next.speedUnit === 'px' ? timeline.LEGACY_SPEED_MAX : timeline.CPM_MAX,
      colorWarning: settingsEngine.isColorTooClose(next.textColor, next.backgroundColor),
      loop: !!next.loop,
      showClocks: next.showClocks !== false,
      focus: !!next.focus,
      roleHighlight: next.roleHighlight !== false,
      keepScreenOn: next.keepScreenOn !== false,
      mirror: !!next.mirror,
      colorPicker: ''
    }
    this.setData(view)

    if (mode === 'layout') this._scheduleLayout()
    else if (mode === 'quick') {
      // 速度变了：无论是否在播都重配引擎。configure 幂等，只更新 pxPerSecond 并
      // clamp current 到合法区间，不会跳位；否则「停着改速度再点播放」会用旧速度。
      this._configureEngine()
    }
    if (mode !== 'none') this._saveSettingsNow()
  },

  _scheduleLayout() {
    if (this._layoutTimer) clearTimeout(this._layoutTimer)
    this._layoutTimer = setTimeout(() => {
      this._layoutTimer = null
      this._parseAndLayout({ keepProgress: true })
    }, LAYOUT_THROTTLE_MS)
  },

  _restartFromCurrent() {
    this._pause(true)
    this._play()
  },

  _saveSettingsNow() {
    // settingsEngine.patch 已经落盘，这里只做语义占位（保留调用点便于将来加云同步）
  },

  /* ── 菜单开关项 ── */
  onToggleStartPosition() {
    const next = this.data.settings.startPosition === 'bottom' ? 'middle' : 'bottom'
    this._setSetting({ startPosition: next }, 'layout')
  },

  onToggleBold() {
    this._setSetting({ fontBold: !this.data.settings.fontBold }, 'layout')
  },

  onToggleFontFamily() {
    const next = settingsEngine.nextFontFamily(this.data.settings.fontFamily)
    this._setSetting({ fontFamily: next }, 'layout')
  },

  onToggleMirror() {
    const next = !this.data.settings.mirror
    this.setData({ mirror: next })
    this._setSetting({ mirror: next }, 'none')
  },

  onToggleLoop() {
    const next = !this.data.settings.loop
    this.setData({ loop: next })
    this._setSetting({ loop: next }, 'none')
  },

  onToggleFocus() {
    const next = !this.data.settings.focus
    this.setData({ focus: next })
    this._setSetting({ focus: next }, 'none')
  },

  onToggleClocks() {
    this._setSetting({ showClocks: !this.data.settings.showClocks }, 'none')
    this._tickClock()
  },

  onToggleFillLight() {
    const next = !this.data.settings.fillLight
    this._setSetting({ fillLight: next }, 'none')
    this.setData({ fillLight: next })
    try {
      if (next) {
        if (typeof this._sysBrightness !== 'number') {
          wx.getScreenBrightness({
            success: (r) => {
              this._sysBrightness = r.value
            }
          })
        }
        wx.setScreenBrightness({ value: 1 })
      } else {
        wx.setScreenBrightness({
          value: typeof this._sysBrightness === 'number' ? this._sysBrightness : 0.6
        })
      }
    } catch (e) {
      /* 模拟器/无权限时忽略 */
    }
  },

  /**
   * 角色多色高亮开关。
   * 2026-10-28 去重后这里是「角色色」的唯一常规入口（设置页那份已删），
   * 所以必须和 prefs 的智能总闸打通：
   *   - 总闸开着时手动开高亮 → 自动解除总闸（否则出现「开关是开的、画面却没颜色」的幽灵态）
   *   - 关高亮 → prefs.roleHighlight 同步关，避免下次从编辑页进来又变回开
   */
  onToggleRoleHighlight() {
    // 以「画面上真的有没有颜色」为准（data.roleHighlight 就是渲染用的那个布尔）：
    // 总闸开着、或编辑页把它关掉时，这里显示的是关；点一下 = 我要颜色 → 一并解除总闸。
    const base =
      this.data.roleHighlight !== undefined
        ? !!this.data.roleHighlight
        : this.data.settings.roleHighlight !== false
    const effectiveOn = base && !this.data.smartOff
    const next = !effectiveOn
    const cur = (app.globalData && app.globalData.prefs) || prefsEngine.load()
    let p = cur
    try {
      p = app.updatePrefs(prefsEngine.smartPatch(cur, 'roleHighlight', next))
    } catch (e) {
      p = cur
    }
    this.setData({ smartOff: !!p.smartOff, roleHighlight: next })
    this._setSetting({ roleHighlight: next }, 'layout')
  },

  /** 速度单位切换：px ↔ cpm，切换前后实际速度不跳变（走 timeline.switchSpeedUnit） */
  onToggleSpeedUnit() {
    const s = this.data.settings
    const target = s.speedUnit === 'px' ? 'cpm' : 'px'
    const patchObj = timeline.switchSpeedUnit(s, this._speedContext(), target)
    this._setSetting(patchObj, 'quick')
  },

  /** 一键主题：套用预设背景+文字色（与设置页预设主题同源） */
  onTapTheme(e) {
    const bg = e.currentTarget.dataset.bg
    const text = e.currentTarget.dataset.text
    this._setSetting({ backgroundColor: bg, textColor: text }, 'layout')
  },

  /** 一键关闭智能功能（漏词兜底）：与编辑页/设置页同源，存全局 prefs.smartOff */
  onToggleSmartOff() {
    const cur = (app.globalData && app.globalData.prefs) || prefsEngine.load()
    const next = !cur.smartOff
    const p = app.updatePrefs(prefsEngine.smartPatch(cur, 'smartOff', next))
    this.setData({ smartOff: !!p.smartOff })
    this._parseAndLayout({ keepProgress: true })
    util.toast(next ? '已关闭智能功能：台词将完整显示' : '已恢复智能功能')
  },

  /** 视线参考线开关（渲染用 settings.showCue） */
  onToggleCue() {
    const next = this.data.settings.showCue === false
    this._setSetting({ showCue: next }, 'none')
  },

  /** 屏幕常亮开关：立即生效（关掉时也要主动 setKeepScreenOn(false)） */
  onToggleKeepScreenOn() {
    const next = this.data.settings.keepScreenOn === false
    this._setSetting({ keepScreenOn: next }, 'none')
    try {
      wx.setKeepScreenOn({ keepScreenOn: next })
    } catch (e) {
      /* 模拟器/无权限忽略 */
    }
  },

  /** 重新查看新手引导：清掉「已看过」标记并重显引导 */
  onReplayGuide() {
    try {
      wx.removeStorageSync('baoge_guide_tp')
    } catch (e) {
      /* 忽略 */
    }
    this.setData({ guideVisible: true, showMenu: false, showControls: false })
  },

  onSetAlign(e) {
    const key = e.currentTarget.dataset.key
    if (settingsEngine.TEXT_ALIGN_KEYS.indexOf(key) < 0) return
    this._setSetting({ textAlign: key }, 'layout')
  },

  /** 打开配色托盘（文字色 + 背景色 + 主题预设都在里面） */
  onOpenColor() {
    this.setData({ colorPicker: this.data.colorPicker ? '' : 'all' })
  },

  onPickColor(e) {
    const color = e.currentTarget.dataset.color
    const kind = e.currentTarget.dataset.kind || 'text'
    if (kind === 'bg') {
      this._setSetting({ backgroundColor: color }, 'layout')
    } else {
      this._setSetting({ textColor: color }, 'layout')
    }
  },

  onResetSettings() {
    const next = settingsEngine.reset(this.data.orientation)
    this.setData({ settings: next, colorPicker: '' })
    this._parseAndLayout({ keepProgress: true })
    util.toast('已恢复默认')
  },

  /* ======================================================================
   * 横竖屏切换（2026-10-28 恢复：菜单里加回切换入口）
   * ==================================================================== */

  onToggleOrientation() {
    const next = this.data.orientation === 'landscape' ? 'portrait' : 'landscape'
    this._applyOrientation(next)
    util.toast(next === 'landscape' ? '已切换横屏' : '已切换竖屏')
    // 部分机型 setPageOrientation 不触发 onResize，兜底重排一次
    setTimeout(() => {
      if (this._launched && this.allLines && this.allLines.length) {
        this._relayoutKeepProgress()
      }
    }, 400)
  },

  _applyOrientation(orient) {
    if (typeof wx.setPageOrientation !== 'function') return
    if (!orient) return
    try {
      setTimeout(() => {
        try {
          wx.setPageOrientation({ orientation: orient, fail: () => {}, success: () => {} })
        } catch (e) {
          console.error('[tp] setPageOrientation 失败（已忽略）', e)
        }
      }, 0)
    } catch (e) {
      console.error('[tp] setPageOrientation 调度失败（已忽略）', e)
    }
  },

  /* ── 声控 ── */
  async onToggleVoice() {
    if (this.data.settings.voiceControl) {
      this._stopVoice()
      this._setSetting({ voiceControl: false }, 'none')
      this.setData({ voiceEnabled: false, voiceLevel: 0, voiceTip: '' })
      return
    }
    const ok = await vad.requestAuth()
    if (!ok) {
      wx.showModal({
        title: '声控跟读不可用',
        content: '需要麦克风权限。模拟器无法使用麦克风，请用手机真机预览。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    this._setSetting({ voiceControl: true }, 'none')
    this.setData({ voiceEnabled: true, voiceCalibrating: true, voiceTip: '正在采集环境噪声' })
    // 进声控先停掉自动滚动，交给 VAD 驱动
    if (this.engine) this.engine.pause()
    this.setData({ playing: false })
    this._startVoice()
  },

  _startVoice() {
    if (!this.voice) return
    const started = this.voice.start({
      onVoice: () => {
        // 检测到声音就开播（匀速逐帧），静音就停
        if (this.engine) this.engine.resume()
        this.setData({ playing: true, status: 'playing', voiceCalibrating: false, voiceTip: '' })
      },
      onSilence: () => {
        if (this.engine) this.engine.pause()
        this.setData({ playing: false, status: 'paused', voiceCalibrating: false, voiceTip: '' })
      },
      onLevel: (level, calibrating) => {
        if (calibrating) return
        const now = Date.now()
        if (now - (this._lastLevelAt || 0) < 66) return
        this._lastLevelAt = now
        this.setData({ voiceLevel: Math.round(level * 100) })
      },
      onCalibrated: () => this.setData({ voiceCalibrating: false, voiceTip: '' }),
      onError: () => {
        this.setData({ voiceEnabled: false, voiceCalibrating: false, voiceTip: '录音异常' })
        util.toast('录音异常，已关闭声控')
      }
    })
    if (!started) {
      this.setData({ voiceEnabled: false, voiceCalibrating: false })
      util.toast('录音启动失败')
    }
  },

  _stopVoice() {
    if (this.voice && this.voice.running) this.voice.stop()
    this._stopAnimation()
  },

  /* ======================================================================
   * 倒计时 / 时钟 / 屏幕
   * ==================================================================== */

  _startCountdown() {
    const n = this.data.settings.countdown || 0
    if (n <= 0) {
      this._play()
      return
    }
    this._clearCountdown()
    this.setData({ countdown: n, status: 'stopped', playing: false })
    this._countdownTimer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) {
        this._clearCountdown()
        this._countdownDone = true
        this._play()
      } else {
        this.setData({ countdown: next })
      }
    }, 1000)
  },

  _clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    if (this.data.countdown > 0) this.setData({ countdown: 0 })
  },

  _tickClock() {
    const d = new Date()
    const pad = (x) => (x < 10 ? '0' + x : '' + x)
    const text = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    // 10 秒一跳，但只有跨分钟才真的变。不判等的话，每分钟会白写 5 次 setData ——
    // 每次都是一次「逻辑层→渲染层」，正好落在滚动中就是一次掉帧。
    if (text === this._clockText) return
    this._clockText = text
    this.setData({ clockText: text })
  },

  _applyScreenPrefs(s) {
    const settings = s || settingsEngine.DEFAULTS
    try {
      if (settings.keepScreenOn !== false) {
        wx.setKeepScreenOn({ keepScreenOn: true })
      }
      if (settings.fillLight) wx.setScreenBrightness({ value: 1 })
    } catch (e) {
      /* 模拟器/测试环境可能没有这些 API，忽略即可 */
    }
  },

  _restoreScreen() {
    try {
      wx.setKeepScreenOn({ keepScreenOn: false })
      if (this.data.fillLight) {
        wx.setScreenBrightness({
          value: typeof this._sysBrightness === 'number' ? this._sysBrightness : 0.6
        })
      }
    } catch (e) {}
  },

  /* ======================================================================
   * 角色过滤（宝哥独有，保留）
   * ==================================================================== */

  _roleDisplayFilter() {
    const rd = this.script && this.script.roleDisplay
    if (rd === undefined || rd === null) return null
    if (!Array.isArray(rd) || !rd.length) return new Set()
    const set = roleEngine.resolveRoleFilter(rd, this.allRoles || [], this.allAliases || {})
    return set && set.size ? set : null
  },

  onSetRoleFilter(def) {
    if (def === null) this.roleFilter = null
    else if (!def || !def.length) this.roleFilter = new Set()
    else this.roleFilter = roleEngine.resolveRoleFilter(def, this.allRoles || [], this.allAliases || {})
    this._applyRoleFilter()
  },

  _applyRoleFilter() {
    const legacy = prefsEngine.load()
    if (legacy.smartOff) this.roleFilter = null
    this.displayLines = roleEngine.filterLinesByRole(this.allLines, this.roleFilter)
    if (this.roleFilter && this.roleFilter.size > 0 && this.displayLines.length === 0) {
      this.roleFilter = null
      this.displayLines = this.allLines
      util.toast('所选角色无台词，已显示全部')
    }
    const lineH = this.data.lineHeightPx || 1
    this.contentHeight = this.displayLines.length * lineH
    this.setData({
      lines: this.displayLines,
      visibleLines: this.displayLines,
      contentHeight: this.displayLines.length * lineH,
      textHeight: this.displayLines.length * lineH
    })
    this._configureEngine()
    this._updateVisible(true)
    this._measureContent(false)
  },

  /* ======================================================================
   * 进度 / 统计 / 引导
   * ==================================================================== */

  _savePosition() {
    if (!this.scriptId || !this.engine) return
    // 引擎逐帧推进，current 就是实时位置，直接按进度落盘
    store.updatePosition(this.scriptId, this.engine.progress)
  },

  _savePositionThrottled() {
    const now = Date.now()
    if (now - (this._lastSaveAt || 0) < 1000) return
    this._lastSaveAt = now
    this._savePosition()
  },

  _finalizeStats(completed) {
    if (!this.stats || !this.scriptId || this._statSaved) return
    const snap = this.stats.snapshot()
    if (!completed && snap.activeMs < 800 && !snap.completed) return
    store.appendStat(this.scriptId, snap)
    this._statSaved = true
  },

  onCloseGuide() {
    try {
      wx.setStorageSync('baoge_guide_tp', 1)
    } catch (e) {}
    this.setData({ guideVisible: false })
  },

  /* ======================================================================
   * 兼容旧入口
   * ==================================================================== */

  onTapBack() {
    this._savePosition()
    wx.navigateBack()
  },

  onTapSettings() {
    this.onOpenMenu()
  },

  onToggleGuide() {
    this._setSetting({ showCue: !this.data.settings.showCue }, 'none')
  },

  onTapThemePreset() {
    util.toast('配色请用菜单里的字体/背景颜色')
  },

  /** 旧速度接口：按当前单位写入 */
  onTapSpeed(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0
    const s = this.data.settings
    if (s.speedUnit === 'px') this._applySpeed(s.speed + delta)
    else this._applySpeed(s.speedCpm + delta)
  },

  onSlideSpeed(e) {
    this._applySpeed(Number(e.detail.value))
  },

  _applySpeed(v) {
    const s = this.data.settings
    if (s.speedUnit === 'px') {
      const next = timeline.clampLegacySpeed(
        util.clamp(v, timeline.LEGACY_SPEED_MIN, timeline.LEGACY_SPEED_MAX)
      )
      this._setSetting({ speed: next }, 'quick')
    } else {
      const next = timeline.clampCpm(
        util.clamp(v, timeline.CPM_MIN, timeline.CPM_MAX)
      )
      this._setSetting({ speedCpm: next }, 'quick')
    }
  },

  onTapFontSize(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0
    const next = util.clamp(
      this.data.settings.fontSize + delta,
      settingsEngine.FONT_SIZE_MIN,
      settingsEngine.FONT_SIZE_MAX
    )
    this._setSetting({ fontSize: next }, 'layout')
  },

  /** 旧「滚动方式」内部入口（不弹权限框，仅供已授权路径/测试调用） */
  _applyScrollStyle(key) {
    const on = key === 'voice'
    this._setSetting({ voiceControl: on }, 'none')
    this.setData({
      voiceEnabled: on,
      scrollStyle: on ? 'voice' : 'smooth',
      scrollMode: on ? 'voice' : 'auto'
    })
    if (on) {
      this._pause(true)
      this._startVoice()
    } else {
      this._stopVoice()
    }
  },

  /** 旧「滚动方式」入口：映射到声控开关 */
  onSetScrollStyle(e) {
    const key = e.currentTarget.dataset.key
    if ((key === 'voice') !== !!this.data.settings.voiceControl) this.onToggleVoice()
  },

  _startCountdownCompat() {
    this._startCountdown()
  },

  _startScroll() {
    this._play()
  }
})
