const app = getApp()
const store = require('../../engine/store.js')
const parser = require('../../engine/parser.js')
const roleEngine = require('../../engine/role.js')
const prefsEngine = require('../../engine/prefs.js')
const ScrollEngine = require('../../engine/scroll.js')
const StatsCollector = require('../../engine/stats.js')
const vad = require('../../engine/vad.js')
const util = require('../../utils/util.js')

/**
 * 速度换算：speed(40-400) -> px/s。
 * 上限 400（约 4 行/秒 @ 行高 60px），过快字幕会糊成一片影响可读。
 */
function pxPerSecondOf(speed) {
  return Math.max(24, (speed || 50) * 0.6)
}

/** 双击判定窗口：单击暂停要等这个窗口确认没有第二下 */
const DOUBLE_TAP_MS = 260
/** 菜单自动收起时间：避免横屏下菜单长期遮挡台词（需求 1） */
const MENU_AUTO_HIDE_MS = 6000

Page({
  data: {
    title: '',
    statusBarHeight: 20,
    // 右上角胶囊（关闭/更多）下方的安全起始 y。自定义导航栏下胶囊依然存在且无法隐藏，
    // 顶栏与浮层必须从它下面开始排，否则竖屏会跟「退出小程序」按钮叠在一起（需求 1）。
    navSafeTop: 64,

    // 渲染
    visibleLines: [],
    visibleStart: 0,
    offset: 0,
    lineHeightPx: 60,
    fontSizePx: 34,
    letterSpacing: 2,
    contentHeight: 0,
    viewportHeight: 600,
    bg: '#000000',
    textColor: '#FFFFFF',
    isDark: true,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
    // 角色高亮开关（只给名字上色，台词保持正文色）。
    // 2026-10-27 起「名字+台词」整行高亮已下线，页面不再需要 roleHighlightMode。
    roleHighlight: true,
    mirror: false,
    showGuide: true,
    marginHorizontal: 40,

    // 横竖屏与滚动模式
    orientation: 'landscape',
    scrollMode: 'auto',
    // 两种滚动方式：smooth 匀速自动滚动(默认) / voice 声控跟读
    scrollStyle: 'smooth',
    scrollStyleOptions: [],
    // 控制菜单内容区高度(px)：打开菜单后按自然高与可用高实测写入，
    // 内容超高时可上下滑动看全；横屏最多占屏幕 1/5
    menuHeight: 620,

    // 状态
    playing: false,
    showControls: false,
    settingsOpen: false,
    speed: 50, // 与 prefs.DEFAULTS.speed 保持一致
    progress: 0,
    progressText: '0%',
    progressValue: 0,
    loop: false,
    countdown: 0,
    finished: false,

    // 控制菜单里的快捷设置（需求 5 / 11）
    speedMin: 40,
    speedMax: 400,
    themePresets: [],
    colorScheme: 'white-on-black',
    // 当前台本在全部台本中的位置，如「3 / 12」（需求 10）
    scriptPosText: '',
    // 「上一个 / 下一个台本」是否可点：false 时按钮置灰，
    // 避免「按钮亮着但点了只弹一句提示」的假可点状态
    hasPrevScript: false,
    hasNextScript: false,

    // 声控
    voiceEnabled: false,
    voiceLevel: 0,
    voiceCalibrating: false,
    voiceTip: '',

    fillLight: false,
    resumePosition: 0,

    // 新手引导
    guideVisible: false
  },

  onLoad(options) {
    this.allLines = []
    this.allRoles = []
    this.allAliases = {}
    this.displayLines = []
    this.roleFilter = null
    this.scriptId = ''
    this._launched = false
    this._lastSection = -1
    this._frameCount = 0
    // 无缝无限滚动「是否已回绕过一圈」：首圈（false）开篇时，视口起点之前的
    // 负行号用空白占位，绝不回绕去显示稿子结尾的文字；一旦回绕过（true）就恢复
    // 行号取模的无缝拼接，让「结尾 → 开头」连续滚。切换台本/从头开始会重置。
    this._wrapped = false
    this._countdownTimer = null
    this._touching = false
    this._dragged = false
    this._suppressTap = false
    this._touchStartY = 0
    this._touchStartOffset = 0
    this._seeking = false
    this._resumeAfterSeek = false
    // 切换台本的重入锁：true 表示正在切，期间忽略新的切换点击
    this._switching = false
    // 菜单呼出前是否在滚动：用于「退出菜单后恢复滚动」（需求 2）
    this._wasPlayingBeforeMenu = false
    // 菜单内容自然高度缓存：菜单常驻 DOM，可在 onReady 时预先量好，
    // 双击打开时直接以「最终高度」一次性渲染，避开「先以 avail 高度出现、再缩到自然高」的中央闪现
    this._menuNaturalH = 0

    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.winWidth = win.windowWidth || 375
    this.winHeight = win.windowHeight || 667
    this.setData({
      statusBarHeight: win.statusBarHeight || 20,
      navSafeTop: this._calcNavSafeTop(win),
      viewportHeight: this.winHeight,
      speedMin: prefsEngine.SPEED_MIN,
      speedMax: prefsEngine.SPEED_MAX,
      themePresets: prefsEngine.PRESET_THEMES,
      scrollStyleOptions: prefsEngine.SCROLL_STYLES
    })

    this.engine = new ScrollEngine({
      onUpdate: this._onUpdate.bind(this),
      onEnd: this._onEnd.bind(this),
      onLoop: this._onLoop.bind(this)
    })
    this.voice = new vad.VoiceController()
    this.stats = new StatsCollector({})
    this._statSaved = false
    // 首次使用引导：只在没看过时显示一次
    try {
      this.setData({ guideVisible: !wx.getStorageSync('baoge_guide_tp') })
    } catch (e) {
      this.setData({ guideVisible: false })
    }

    if (!options.id) {
      util.toast('台本不存在')
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this._loadScript(options.id)
  },

  /**
   * 计算自定义导航栏的安全起始 y：取「状态栏底部」与「右上角胶囊底部」的较大值，再加间距。
   *
   * 关键点：navigationStyle=custom 只是隐藏了原生标题栏，右上角那颗
   * 「关闭/更多」胶囊依然存在且无法隐藏、无法移动。所以自定义顶栏的
   * 「返回 / 设置」必须排在胶囊下方，否则竖屏下会直接叠在退出按钮上（需求 1）。
   */
  _calcNavSafeTop(win) {
    const statusBar = (win && win.statusBarHeight) || 20
    let menuBottom = 0
    try {
      if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
        const m = wx.getMenuButtonBoundingClientRect()
        if (m && m.bottom) menuBottom = m.bottom
      }
    } catch (e) {
      menuBottom = 0
    }
    if (!menuBottom) menuBottom = statusBar + 32 // 兜底：胶囊高约 32px
    return Math.round(Math.max(statusBar, menuBottom) + 6)
  },

  /**
   * 重新读取窗口真实尺寸，同步到 this.winWidth/winHeight 与 data 的安全区。
   *
   * 为什么必须存在：本页所有排版都基于 this.winHeight（_parseAndLayout 里
   * effVp = winHeight * 0.52），而这个值原本只在 onLoad / onResize 里更新。
   * 从设置页 navigateBack 回来时，onLoad 不会重跑、onResize 又不保证派发
   * （设置页默认是竖屏，进去时屏幕已被转回竖屏，回到本页要再转回原方向），
   * 于是 winHeight 停留在上一次的竖屏值，CSS 容器却是 100vh 的真实大小 ——
   * 两者不一致就表现为「从设置回来只有半屏 / 台词整体错位」。
   *
   * @returns {boolean} 本次读取到的尺寸是否与此前不同
   */
  _syncWindowMetrics() {
    let changed = false
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const w = win.windowWidth || 375
      const h = win.windowHeight || 667
      if (w !== this.winWidth || h !== this.winHeight) changed = true
      this.winWidth = w
      this.winHeight = h
      const navSafeTop = this._calcNavSafeTop(win)
      const patch = { statusBarHeight: win.statusBarHeight || 20 }
      // 只在真的变了才 setData：横竖来回进设置页时避免无谓的视图层重绘
      if (navSafeTop !== this.data.navSafeTop) patch.navSafeTop = navSafeTop
      this.setData(patch)
    } catch (e) {
      console.error('[tp] 读取窗口信息失败（已忽略）', e)
    }
    return changed
  },

  /**
   * 延时兜底刷新尺寸并按需重排。
   *
   * 覆盖两类机型差异：
   *   1) setPageOrientation 是异步生效的 —— onShow 里同步读到的可能还是切换前的旧值；
   *   2) 部分机型干脆不派发 onResize —— 除了这里没人会再告诉本页「尺寸变了」。
   * 所以延时一拍再取一次，只有真的变了才重排，避免无谓重写导致滚动位置跳动。
   */
  _scheduleWindowResync() {
    if (this._resyncTimer) clearTimeout(this._resyncTimer)
    this._resyncTimer = setTimeout(() => {
      this._resyncTimer = null
      if (!this._launched || !this.allLines.length) return
      this._syncWindowMetrics()
      // 兜底重排：无论尺寸是否变化，都按当前最新尺寸重算一次可视区，
      // 确保「排版用的高度」与「CSS 实际容器高度(100vh)」严格一致。
      const p = this.engine ? this.engine.progress : 0
      const wasPlaying = this.data.playing
      this._parseAndLayout()
      this._seekTo(p)
      if (wasPlaying && !this.data.voiceEnabled) this.engine.resume()
      if (this.data.showControls) this._fitMenuToScreen()
    }, 400)
  },

  onReady() {
    this._launched = true
    // 进入即按设置锁定方向（竖屏/横屏/自动），之后由 onResize 接管旋转重排
    this._applyOrientation(this.data.orientation)
    // 菜单常驻 DOM，提前量好自然高并缓存：双击打开时即可直接落在最终高度（issue 1 防闪现）
    this._measureMenuNatural()
  },

  /**
   * 屏幕方向变化（手机旋转或 setPageOrientation 生效）时，
   * 重新读取窗口尺寸并重排，否则横竖切换后每行字数/布局还是旧的。
   */
  onResize(res) {
    const size = (res && res.size) || {}
    if (size.windowWidth) this.winWidth = size.windowWidth
    if (size.windowHeight) this.winHeight = size.windowHeight
    // 转屏后胶囊位置会变，安全区要跟着重算，否则竖屏下顶栏又会压住胶囊
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ navSafeTop: this._calcNavSafeTop(win) })
    } catch (e) {}
    if (this._launched && this.allLines.length) {
      const p = this.engine ? this.engine.progress : 0
      this._parseAndLayout()
      this._seekTo(p)
    }
  },

  /**
   * 应用屏幕方向设置。竖屏/横屏用 API 强制锁定；自动则释放锁定，随设备旋转。
   */
  _applyOrientation(orient) {
    if (typeof wx.setPageOrientation !== 'function') return
    if (!orient) return
    // 部分真机/模拟器在 onReady 阶段强制切方向会白屏或卡死页面，
    // 用 try/catch 兜底，并在下一拍执行，避免阻塞首帧渲染。
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

  /**
   * 后台保护：小程序退到后台后定时器会被降频甚至冻结，
   * 回前台时不能直接续播（稿子可能已经停在中途），先暂停再询问用户。
   */
  onHide() {
    this._wasPlaying = this.data.playing
    this.engine.pause()
    if (this.data.playing) this._pauseForStats()
    this.setData({ playing: false })
    if (this.voice.running) this.voice.stop()
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    this._savePosition()
    // 注意：这里刻意【不】调用 _finalizeStats。
    // 之前在这里收尾会把 _statSaved 置 true 并落一条半程记录，
    // 导致切后台回来再读完时，复盘弹窗再也不会弹（_finalizeStats 直接 return）。
    // 切后台只是暂停，会话还活着；真正收尾交给 onEnd / onUnload。
  },

  onShow() {
    if (!this._launched) return
    this._applyScreenPrefs()
    // 从首页/设置页返回时，台本列表可能已变（删了台本），刷新角标与上/下按钮的置灰态
    this._updateScriptPos()

    // 从设置页返回：参数可能变过，按新参数重新排版并保留进度与播放状态
    if (this._fromSettings) {
      this._fromSettings = false
      const prefs = app.globalData.prefs || prefsEngine.load()
      // 方向可能改了，重新锁定
      this.setData({ orientation: prefs.orientation || 'landscape' })
      this._applyOrientation(this.data.orientation)
      // 必须重新拉一次真实窗口尺寸：设置页默认竖屏，返回时屏幕才刚转回来，
      // 部分机型此时不派发 onResize，winHeight 会停在竖屏旧值 → 排版算出的
      // 可视区与实际视口不符，表现为「从设置回来看只有半屏」。
      this._syncWindowMetrics()
      // 同步滚动模式，并据此决定声控开关
      const wantVoice = prefs.scrollMode === 'voice'
      // 同步滚动方式真值 scrollStyle（P1-1 修复：设置页改了 scrollStyle，返回时 data 必须跟上，
      // 否则菜单"滚动"高亮、onToggleVoice、播放键都会按旧的 smooth 走，出现矛盾态）
      const style = prefs.scrollStyle || (wantVoice ? 'voice' : 'smooth')
      this.setData({ scrollStyle: style, loop: !!prefs.loop })
      this.engine.loop = !!prefs.loop
      if (!wantVoice && this.data.voiceEnabled) {
        if (this.voice.running) this.voice.stop()
        this.setData({ voiceEnabled: false, voiceLevel: 0, voiceTip: '' })
        if (!this.data.playing) this.engine.resume()
      } else if (wantVoice && !this.data.voiceEnabled) {
        this.setData({ voiceEnabled: true })
      }
      if (this.allLines.length) {
        const progress = this.engine.progress
        const wasPlaying = this.data.playing
        this._parseAndLayout()
        this._seekTo(progress)
        if (wasPlaying && !this.data.voiceEnabled) this.engine.resume()
      }
      // setPageOrientation 是异步的，上面同步读到的可能还是切换前的旧尺寸；
      // 延时一拍再取一次并按最新尺寸重排，覆盖「异步未生效」与「不派发 onResize」两类机型。
      this._scheduleWindowResync()
      return
    }

    // 从后台切回：定时器在后台会被冻结，不能直接续播，先暂停再询问
    if (this._wasPlaying) {
      this._wasPlaying = false
      wx.showModal({
        title: '继续提词吗',
        content: '刚刚切到后台，提词已暂停。要从当前位置继续吗？',
        confirmText: '继续',
        cancelText: '从头开始',
        success: (r) => {
          if (r.confirm) {
            // 恢复计时（onHide 里调过 onPause），否则本遍的「实际滚动时长」会漏算
            if (this.stats) this._resumeForStats()
            this._startScroll()
          } else {
            // 「从头开始」必须真的从头播，之前只 seek 到 0 就停住了，用户会以为坏了
            this._seekTo(0)
            this._startScroll(true)
          }
        }
      })
    }
  },

  onUnload() {
    this.engine.destroy()
    if (this.voice) this.voice.stop()
    if (this._countdownTimer) clearInterval(this._countdownTimer)
    // 尺寸兜底刷新定时器：不掐掉的话会在已卸载的实例上跑 setData（从设置返回后立刻退出时必现）
    if (this._resyncTimer) clearTimeout(this._resyncTimer)
    // 单击延迟与菜单自动收起都是延时任务，页面销毁时必须清掉，
    // 否则会在已卸载的实例上触发 setData
    if (this._tapTimer) clearTimeout(this._tapTimer)
    if (this._autoHideTimer) clearTimeout(this._autoHideTimer)
    this._restoreScreen()
    this._savePosition()
    this._finalizeStats(false)
  },

  // ---------- 加载与布局 ----------

  /**
   * 载入台本。
   * @param {string} id 台本 id
   * @param {object} [opts] opts.fresh=true 表示「主动切换过来的新台本」：
   *   不弹「继续上次进度」询问，直接从头开始，保证点了下一个就立刻生效。
   *   首次进入页面（onLoad）时保持原行为，询问是否续播。
   */
  _loadScript(id, opts) {
    const fresh = !!(opts && opts.fresh)
    const script = store.get(id)
    if (!script) {
      // 加载失败也要解锁，否则「上/下一个台本」会一直处于锁定态
      this._switching = false
      util.toast('台本不存在')
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.script = script
    this.scriptId = id
    this._updateScriptPos()
    const prefs = app.globalData.prefs || prefsEngine.load()
    // 两种滚动方式：smooth 匀速自动滚动(默认) / voice 声控跟读。
    // 老版本可能只存 scrollMode:'voice'（迁移保留声控），故 scrollStyle 缺失时按它回落。
    // 已下架的 page（逐段）由 prefs.load() 在读取侧归一化成 smooth，此处无需再处理。
    let style =
      prefs.scrollStyle || (prefs.scrollMode === 'voice' ? 'voice' : 'smooth')
    // 滚动模式决定进入后是匀速自动滚动还是声控跟读；loop 默认开（Req 1：无缝无限滚动）
    this.setData({
      title: script.title,
      orientation: prefs.orientation || 'landscape',
      scrollMode: style === 'voice' ? 'voice' : 'auto',
      scrollStyle: style,
      voiceEnabled: style === 'voice',
      loop: !!prefs.loop
    })
    // 切换到另一个台本时，引擎位置还停在上一篇的偏移量上，必须先归零，
    // 否则新台本会直接从中途开始滚。
    if (this.engine) this.engine.reset(0)
    this._lastSection = -1
    this._wrapped = false // 新台本重新回到「首圈开篇留空」语义
    this._parseAndLayout()

    if (fresh) {
      // 主动切换台本：跳过续播询问（旧台本的进度已在 _prepareSwitch 里落盘保存）。
      // 不跳的话，切换弹的 toast 会和 showModal 叠在一起，且新台本被对话框挡住不算「立即生效」，
      // 连点还会堆出多个 modal。
      this._startCountdown()
      this._switching = false
      return
    }

    const pos = store.getPosition(this.scriptId)
    if (pos > 0.01 && pos < 0.99) {
      this.setData({ resumePosition: pos })
      wx.showModal({
        title: '继续上次进度',
        content: `上次读到 ${Math.round(pos * 100)}%，要接着读吗？`,
        confirmText: '接着读',
        cancelText: '从头开始',
        success: (r) => {
          if (r.confirm) this._seekTo(pos)
          this._startCountdown()
        }
      })
    } else {
      this._startCountdown()
    }
    this._switching = false
  },

  /**
   * 台本切换序列（切换与角标的唯一顺序来源）。
   * 复用 store.list() 的既有排序，保证与首页列表、角标「N / M」顺序一致，
   * 避免「切换顺序」和「角标顺序」两套顺序打架导致「角标 2/5 但点下一个没反应」。
   * 集中到这一处：将来若想改成「按创建时间 / 按集号」正序，只改这一行。
   */
  _scriptOrder() {
    try {
      // 按集号递增排序：菜单「上/下一个台本」与角标同源，严格遵循 第N集→第N+1集 连续推进。
      // 列表无任何可解析集号时，sortByEpisode 退化回 store.list 原序（更新时间降序），兼容纯随笔。
      return util.sortByEpisode(store.list())
    } catch (e) {
      return []
    }
  },

  /** 更新「第 N / 共 M 个台本」角标 + 上/下按钮可用性（需求 10）。
   *  角标和按钮必须共用 _scriptOrder()，否则会出现「角标 2/5 但点下一个没反应」的状态不一致。 */
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

  /**
   * 重排并保留当前进度与播放状态。
   * 改字号 / 转屏 / 换配色 / 换高亮模式后都要走这里，否则画面会跳回开头。
   */
  _relayoutKeepProgress() {
    const p = this.engine ? this.engine.progress : 0
    const wasPlaying = this.data.playing
    this._parseAndLayout()
    this._seekTo(p)
    if (wasPlaying && !this.data.voiceEnabled) {
      this.engine.resume()
      this.setData({ playing: true })
    }
  },

  /**
   * 解析并按屏幕尺寸重排。
   * 每行字数按屏宽与字号实时计算，横屏竖屏切换都要重新走这里。
   */
  _parseAndLayout() {
    // 用 DEFAULTS 兜底合并，防止 app.globalData.prefs 万一为局部对象
    // （缺 lineHeight/fontSize 等字段）时 lineHeightPx 算出 NaN，
    // 进而 maxOffset=0、引擎首帧即结束、台词完全不滚动的静默死机。
    const prefs = Object.assign({}, prefsEngine.DEFAULTS, app.globalData.prefs || prefsEngine.load())
    const fontSizePx = prefsEngine.fontSizePx(prefs.fontSize)
    const lineHeightPx = Math.round(fontSizePx * prefs.lineHeight)
    // 留白（左右边缘间距 px）：允许自定义为 0（贴边）。不能用 `|| 40`，
    // 否则用户在设置里把留白调成 0 时会被当成「未设置」回落成 40，黑边调不下去。
    const margin = typeof prefs.marginHorizontal === 'number' ? prefs.marginHorizontal : 40
    const available = Math.max(120, this.winWidth - margin * 2)
    const charsPerLine = Math.max(
      8,
      Math.floor(available / (fontSizePx + (prefs.letterSpacing || 0)))
    )

    const eff = prefsEngine.effectiveColors(prefs)
    // 一键关闭智能功能（兜底）：开启后角色高亮一并停用，台词全部按正文色渲染。
    // 角色识别本身仍然照做（不浪费已有逻辑、也不影响行数），只是不染色、不过滤。
    const smartOff = !!prefs.smartOff
    const parsed = parser.parseScript(this.script.content, {
      charsPerLine: charsPerLine,
      manualRoles: this.script.manualRoles || [],
      roleBlacklist: this.script.roleBlacklist || [],
      roleAlias: this.script.roleAlias || {},
      roleHighlight: smartOff ? false : prefs.roleHighlight !== false,
      isDark: eff.isDark,
      roleColorOverride: this.script.roleColorOverride || {}
    })
    this.allAliases = parsed.alias || {}

    // 颜色直接在 JS 里算到行上（需求 4）：
    // 之前由 WXML 用 `roleHighlightMode === 'name' && line.color ? textColor : ...`
    // 现场判断，两种模式的差异非常依赖这个表达式正确求值，实际很容易失效；
    // 现在改成在排版期就把「名字色 / 台词色」落到每个字段上，渲染层只做直读。
    // 2026-10-27：高亮方式收敛为只有「名字高亮」，full 整行高亮已下线 ——
    //   角色名：用角色色
    //   台词  ：恒用正文色（不再有按模式二选一的分支，少一个能失效的判据）
    parsed.lines.forEach((line, i) => {
      line._i = i
      const roleColor = line.role ? roleEngine.colorOf(parsed.roles, line.role) : null
      line.color = roleColor
      line.prefixColor = roleColor || eff.text
      line.bodyColor = eff.text
    })

    this.allLines = parsed.lines
    this.allRoles = parsed.roles
    // 角色显示过滤：编辑页「角色显示选择」配置（script.roleDisplay）→ 只显示勾选角色；
    // 空配置 = 显示全部（null）。_relayoutKeepProgress 重排也会重读该配置，显示行为恒与编辑页一致。
    // 兜底：smartOff 打开时一律不过滤，displayLines 恒等于 allLines，保证台词 100% 完整。
    this.roleFilter = smartOff ? null : this._roleDisplayFilter()
    this.displayLines = smartOff
      ? this.allLines
      : roleEngine.filterLinesByRole(this.allLines, this.roleFilter)
    this.contentHeight = this.displayLines.length * lineHeightPx

    // 台词可视区 = 屏幕减去顶部 40vh 留白（台词从参考线开始）再减底部进度条/安全区。
    // 旧实现把整屏 winHeight 当作视口传给引擎，导致 maxOffset 偏小，
    // 长稿末尾一截永远滚不到可视区——竖屏(高屏)顶留白绝对像素大，缺得尤其多，
    // 表现就是「文字显示不全 / 最后几句台词看不见」。
    const TOP_PAD_RATIO = 0.4
    const BOTTOM_RESERVE_RATIO = 0.08
    const effVp = Math.max(
      lineHeightPx,
      Math.round(this.winHeight * (1 - TOP_PAD_RATIO - BOTTOM_RESERVE_RATIO))
    )

    // 视线参考线(.tp-guide 在视口 50% 处)相对「内容首行基线」(.tp-content padding-top:40vh)
    // 的偏移。台本结束的唯一定义 = 最后一行文字滚过此线。
    // 旧判定用「滚到底」(totalHeight - effVp)会在末行停在屏幕底部约 92% 处就提前收场；
    // 改为「末行滚过参考线(50%)」后，结束时机延后约 42% 屏，末尾几句才真正读完、看得见。
    const GUIDE_LINE_RATIO = 0.5 // 与 wxss 中 .tp-guide { top: 50% } 保持一致
    const guideOffsetPx = Math.max(
      0,
      Math.round(this.winHeight * (GUIDE_LINE_RATIO - TOP_PAD_RATIO))
    )

    const pxPerSecond = pxPerSecondOf(prefs.speed)

    this.setData({
      lineHeightPx: lineHeightPx,
      fontSizePx: fontSizePx,
      letterSpacing: prefs.letterSpacing || 0,
      marginHorizontal: margin,
      contentHeight: this.contentHeight,
      viewportHeight: effVp,
      bg: eff.bg,
      textColor: eff.text,
      isDark: eff.isDark,
      fontFamily: prefsEngine.fontFamilyCss(prefs.fontFamily),
      // 高亮开关的真实状态：总闸开着时高亮必然是关的（与 prefs.normalize 的不变式一致）
      roleHighlight: smartOff ? false : prefs.roleHighlight !== false,
      colorScheme: prefs.colorScheme || 'white-on-black',
      mirror: !!prefs.mirror,
      showGuide: prefs.showGuide !== false,
      speed: prefs.speed,
      fillLight: !!prefs.fillLight
    })

    this.engine.configure(lineHeightPx, this.contentHeight, effVp, pxPerSecond, guideOffsetPx)
    this.engine.loop = !!prefs.loop
    this._updateVisible(true)
    this._applyScreenPrefs()
  },

  /** 屏幕常亮与补光灯 */
  _applyScreenPrefs() {
    const prefs = app.globalData.prefs || prefsEngine.load()
    wx.setKeepScreenOn({ keepScreenOn: prefs.keepScreenOn !== false })
    if (prefs.fillLight) {
      wx.setScreenBrightness({ value: 1 })
    }
  },

  _restoreScreen() {
    wx.setKeepScreenOn({ keepScreenOn: false })
    if (this.data.fillLight) {
      wx.setScreenBrightness({ value: -1 }) // -1 表示恢复系统亮度
    }
  },

  // ---------- 滚动 ----------

  /** 取消开场倒计时。点「暂停」时必须同步取消，否则倒计时结束后会自动开播，
   *  表现就是「暂停键按了没反应，过两秒自己又滚起来」。 */
  _clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    if (this.data.countdown > 0) this.setData({ countdown: 0 })
  },

  _startCountdown() {
    const prefs = app.globalData.prefs || prefsEngine.load()
    const n = prefs.countdown || 0
    if (n <= 0) {
      // 关掉倒计时时也必须传 isNew=true：否则统计收集器不会 onStart()，
      // startTs 停留在 0，最后算出的「用时」= 当前时间戳 - 0 ≈ 几万天。
      this._startScroll(true)
      return
    }
    // 重复进入（连续切换台本 / 点重来）时必须先掐掉上一轮定时器：
    // 旧 interval 的引用一旦被覆盖就再也 clear 不掉，两个倒计时会同时跑，
    // 并各触发一次 _startScroll，表现为「倒计时一次跳两格」「切完立刻自己开跑」。
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    // 倒计时期间必须先收起底部控制菜单：菜单 z-index 高于倒计时遮罩，
    // 否则「3-2-1」数字会被菜单盖住（尤其竖屏菜单占屏 78%），表现就是「倒计时完全看不到」。
    this.setData({ countdown: n, showControls: false, playing: false })
    this._countdownTimer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) {
        clearInterval(this._countdownTimer)
        this._countdownTimer = null
        this.setData({ countdown: 0 })
        this._startScroll(true)
      } else {
        this.setData({ countdown: next })
      }
    }, 1000)
  },

  /**
   * 开始/恢复滚动。
   * @param {boolean} [isNew] true 表示开启「新的一遍」提词，重置并启动统计收集器
   */
  _startScroll(isNew) {
    if (isNew && this.stats) {
      this.stats.reset()
      const prefs = app.globalData.prefs || prefsEngine.load()
      this.stats.totalLines = this.allLines.length
      this.stats.pxPerSecond = pxPerSecondOf(prefs.speed)
      this.stats.lineHeightPx = this.data.lineHeightPx
      this.stats.onStart()
      this._statSaved = false
    }
    this.setData({ finished: false, showControls: false })
    // 声控跟读：绝不主动开播。引擎保持「待命暂停」，由 VAD 的 onVoice 回调驱动滚动、
    // onSilence 回调暂停。否则一进页面就自动滚动，用户没开口字幕也走——这就是
    // 「语音跟读完全没用、启动后还在自己滚」的根因。
    if (this.data.voiceEnabled) {
      if (!this.voice.running) this._startVoice()
      this.setData({ playing: false })
      return
    }
    this.engine.start()
    this.setData({ playing: true })
  },

  _onUpdate(offset, progress, lineIndex) {
    if (!isFinite(offset)) return // 防御：位置异常时跳过，避免画面卡死
    if (this.stats) this.stats.onTick(progress)
    // 匀速与声控都保持连续滚动、不分段不停顿，故此处没有段末停顿逻辑。

    // offset 每帧都要给，否则画面会卡顿；百分比只有整数变化时才有必要跨线程传一次，
    // 长稿件能省掉约 90% 的 setData 数据体积。
    const patch = { offset: offset }
    const pct = Math.round(progress * 100)
    if (pct !== this._lastPct) {
      this._lastPct = pct
      patch.progressText = pct + '%'
      patch.progressValue = pct
    }
    this.setData(patch)

    // 可见区裁剪，不必每帧都做数组切片
    this._frameCount++
    if (this._frameCount % 8 === 0) this._updateVisible(false)
  },

  _onEnd() {
    if (this.stats) this.stats.onEnd()
    this._finalizeStats(true)
    // 需求：非循环台本滚动结束（最后一行滚过参考线）时——直接冻结在当前画面，
    // 不弹菜单、不跳转、不重置、不清空，等用户手动操作。
    // 旧逻辑 setData 里带 showControls:true，会在滚完瞬间自动弹出控制菜单覆盖层，
    // 与「菜单仅在用户主动触发（双击/返回/设置按钮/手势）才显示」冲突，已移除。
    this.setData({ playing: false, finished: true })
    this._savePosition()
  },

  /** 循环播放回到开头时：重置段标记避免停顿误触发，并立即重排可见区 */
  _onLoop() {
    if (this.stats) this.stats.onLoop()
    this._lastSection = -1
    // 已回绕过一圈：从此负行号恢复取模拼接（结尾 → 开头无缝接续），
    // 只有「首圈开篇」那段才需要空白占位。
    this._wrapped = true
    this._updateVisible(true)
  },

  /**
   * 收尾并提交本次复盘记录。
   * @param {boolean} completed 是否自然读完（滚到底触发 onEnd）
   */
  /**
   * 复盘功能已下架（pages/review 已删除），但统计采集仍在进行，
   * 写入保留以兼容 v1.1「复盘回归」计划（存储占用极小：每篇 ≤30 条 × ~120B）。
   * 见审查报告 P3-1：在「v1.1 计划恢复」前提下，保留 stats 存储格式与写入路径。
   */
  _finalizeStats(completed) {
    if (!this.stats || !this.scriptId || this._statSaved) return
    const snap = this.stats.snapshot()
    // 太短的无效会话（刚点开就退出）不计入复盘
    if (!completed && snap.activeMs < 800 && !snap.completed) return
    store.appendStat(this.scriptId, snap)
    this._statSaved = true
  },

  /** 关闭首次使用引导 */
  onCloseGuide() {
    try {
      wx.setStorageSync('baoge_guide_tp', 1)
    } catch (e) {}
    this.setData({ guideVisible: false })
  },

  /**
   * 只渲染视口附近的行，长稿件也不会卡。
   * 内容整体偏移 = visibleStart * 行高 - offset，保证裁剪后位置依然正确。
   */
  _updateVisible(force) {
    const lineH = this.data.lineHeightPx
    // 用引擎的真实位置而不是 data.offset，避免 seek 后两者不同步导致算错行号
    const offset = this.engine ? this.engine.current : this.data.offset
    const total = this.displayLines.length
    // 无缝无限滚动：循环时行号对总行数取模拼接，使滚到底直接接上开头（见 scroll.js 的回绕）。
    // 非循环时按原逻辑从 0 起裁。
    const loop = this.engine && this.engine.loop && total > 1
    const rawStart = Math.floor(offset / lineH) - 10
    const start = loop ? rawStart : Math.max(0, rawStart)
    const count = Math.ceil(this.data.viewportHeight / lineH) + 24
    if (!force && start === this.data.visibleStart) return
    let visible
    if (loop) {
      visible = []
      // 首圈开篇：视口起点还没进入内容（start<0）时，超出部分渲染成空白行占位，
      // 让「文本开头留空、台词从标准线（屏中参考线）开始」，而不是取模把稿子
      // 结尾的行接上来显示在屏顶（观感：还没开始读就先看到末尾文字）。
      // 一旦回绕过一圈（_wrapped=true），负行号恢复取模拼接 —— 无缝接续只在
      // 「结尾 → 开头」那次需要，开篇那次绝不能接结尾。
      const leading = !this._wrapped ? Math.max(0, -start) : 0
      for (let i = 0; i < count; i++) {
        if (i < leading) {
          visible.push({ _i: 'gap' + i, rolePrefix: '', body: '', isGap: true })
          continue
        }
        const idx = ((start + i) % total + total) % total
        const ln = this.displayLines[idx]
        // 行对象复用：把 _i 改成「本次窗口内的位置」，wx:key 才唯一、不被重复复用串色
        visible.push(ln._i === idx ? ln : Object.assign({}, ln, { _i: idx }))
      }
    } else {
      visible = this.displayLines.slice(start, start + count)
    }
    this.setData({
      visibleStart: start,
      visibleLines: visible
    })
  },

  /** 把引擎位置同步回视图。seek/reset 之后必须调用，否则画面停在旧位置 */
  _syncOffsetFromEngine() {
    const offset = this.engine ? this.engine.current : 0
    this.setData({
      offset: offset,
      progressText: Math.round((this.engine ? this.engine.progress : 0) * 100) + '%'
    })
  },

  /** 跳转到指定进度（0-1），一次性完成：定位引擎 + 同步视图 + 重算可见区 */
  _seekTo(progress) {
    // 回到开头（进度 0 附近）：重新进入「首圈开篇留空」语义，
    // 让从头开始播放时屏顶不再闪出稿子结尾文字
    if (progress <= 0.01) this._wrapped = false
    this.engine.seekProgress(progress)
    this._syncOffsetFromEngine()
    this._updateVisible(true)
  },

  _savePosition() {
    if (!this.scriptId) return
    store.updatePosition(this.scriptId, this.engine ? this.engine.progress : 0)
  },

  // ---------- 交互 ----------

  /**
   * 点击屏幕：
   *   单击 = 什么都不做（不再触发暂停，也就不会闪出菜单）
   *   双击 = 呼出 / 收起控制菜单
   *
   * 单击必须「吞掉」：早期版本单击会切播放状态，而播放状态变化又会联动
   * 若干 UI（倒计时结束会自动收起菜单、滚到底会自动弹出菜单），
   * 观感就是「轻轻点一下屏幕，菜单闪一下又没了」。现在单击只做一个
   * DOUBLE_TAP_MS 的静默等待，确认没有第二下就直接结束，不做任何动作。
   */
  onTapScreen() {
    if (this._suppressTap) return
    const now = Date.now()
    if (this._lastTapAt && now - this._lastTapAt < DOUBLE_TAP_MS) {
      if (this._tapTimer) {
        clearTimeout(this._tapTimer)
        this._tapTimer = null
      }
      this._lastTapAt = 0
      this._toggleControls()
      return
    }
    this._lastTapAt = now
    if (this._tapTimer) clearTimeout(this._tapTimer)
    // 单击：等待双击窗口结束；若期间没有第二下，则视为单击 → 暂停 / 恢复滚动
    // （需求 2：点一下暂停，再点一下继续；与双击呼出菜单互不冲突）
    this._tapTimer = setTimeout(() => {
      this._tapTimer = null
      this._lastTapAt = 0
      this.onTapPlay()
    }, DOUBLE_TAP_MS)
  },

  /** 双击：切换控制菜单（开着就收起、关着就呼出） */
  _toggleControls() {
    if (this.data.showControls) {
      this._closeControls()
    } else {
      this._openControls()
    }
  },

  /**
   * 控制菜单高度适配：
   *  - 横屏：菜单最多占屏幕高度的 1/5（台词优先，菜单只做一条紧凑工具条），
   *    放不下的部分在 scroll-view 里上下滑动看全。
   *  - 竖屏：最多占 78% 屏高。
   *
   * 直接用缓存的「菜单内容自然高」与上限取小，一次性落到最终高度，
   * 不再经过「先按上限渲染、80ms 后再缩到自然高」的两步走——
   * 后者会让底部锚定的面板在缩小瞬间把内容从中上部「掉」到底部，正是双击菜单的中央闪现。
   * 内容变化时（换字号/转屏）再 _measureMenuNatural 重新测一次刷新缓存。
   */
  _fitMenuToScreen() {
    const land = this.data.orientation === 'landscape'
    // 横屏 20%（需求 4：菜单最多占屏幕 1/5，台词优先）、竖屏 78%。
    // 上限直接取屏幕比例高度，过低仅兜底到 72；绝不再先减内边距 floor 到 72 后提前 return，
    // 否则横屏会卡在默认 620 不更新（旧 bug）。
    let avail = Math.round((this.winHeight || 375) * (land ? 0.2 : 0.78))
    if (avail < 72) avail = 72
    if (avail <= 0) return
    const natural = this._menuNaturalH || 0
    const finalH = natural && natural < avail ? natural : avail
    this.setData({ menuHeight: finalH })
    // 菜单内容可能已变（字号/横竖），重新测一次自然高，供下次打开/适配使用
    this._measureMenuNatural()
  },

  /**
   * 测量菜单内容（.tp-menu-inner）的自然高度并缓存到 this._menuNaturalH。
   * 菜单常驻 DOM（visibility 切换），即便当前隐藏，布局仍在，可正常测量。
   */
  _measureMenuNatural() {
    if (typeof wx.createSelectorQuery !== 'function') return
    try {
      wx.createSelectorQuery()
        .in(this)
        .select('.tp-menu-inner')
        .boundingClientRect((rect) => {
          if (rect && rect.height) this._menuNaturalH = Math.ceil(rect.height)
        })
        .exec()
    } catch (e) {
      /* 测量失败保持上一次缓存即可 */
    }
  },

  /** 点击菜单外的半透明遮罩关闭菜单（需求 4） */
  onCloseControls() {
    this._closeControls()
  },

  /**
   * 双击 / 点击呼出控制菜单：先暂停滚动，让菜单后面不跟着跑（需求 2）。
   * 记住呼出前是否在播放，供退出菜单时决定要不要恢复。
   *
   * 防闪现关键：菜单常驻 DOM、用缓存自然高直接以「最终高度」一次性渲染，
   * 不经历「先 avail 高度出现在中上部、再缩到自然高落到下方」的中间态，
   * 因此双击时菜单直接出现在底部目标位置，没有中央一闪。
   */
  _openControls() {
    this._wasPlayingBeforeMenu = this.data.playing
    if (this.data.playing) {
      this._clearCountdown()
      this.engine.pause()
      this._pauseForStats()
    }
    const land = this.data.orientation === 'landscape'
    let avail = Math.round((this.winHeight || 375) * (land ? 0.2 : 0.78))
    if (avail < 72) avail = 72
    if (avail <= 0) avail = 72
    const natural = this._menuNaturalH || 0
    const finalH = natural && natural < avail ? natural : avail
    // 一次性把高度与可见性同时写好：菜单首帧即落在最终高度，无中央闪现
    this.setData({ menuHeight: finalH, showControls: true, playing: false })
    this._scheduleAutoHide()
  },

  /**
   * 退出控制菜单：按需恢复滚动（需求 2）。
   * 仅当「呼出前正在滚动」且非声控、未读完时才自动续播；
   * 否则（本来就是暂停 / 声控跟读 / 已读完）保持原状，避免误启动。
   */
  _closeControls() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer)
      this._autoHideTimer = null
    }
    this.setData({ showControls: false })
    if (this._wasPlayingBeforeMenu && this.data.scrollStyle !== 'voice' && !this.data.finished) {
      if (this.engine && this.engine.current < this.engine.maxOffset) {
        this.engine.resume()
        this._resumeForStats()
        this.setData({ playing: true, finished: false })
      }
    }
    this._wasPlayingBeforeMenu = false
  },

  /** 面板内点击吸收冒泡，避免误触关闭菜单 */
  noop() {},

  /**
   * 统一定义「暂停/恢复」时对 stats 的成对调用（P2-2）。
   * stats.onPause/onResume 自身已对 running 状态幂等保护，这里集中收口，
   * 避免菜单/手势/拖动/进度条各处的暂停与恢复漏配对，导致复盘口径失真。
   */
  _pauseForStats() {
    if (this.stats) this.stats.onPause()
  },
  _resumeForStats() {
    if (this.stats) this.stats.onResume()
  },

  /**
   * 菜单自动收起：横屏时底部菜单会盖掉两三行台词，
   * 播放中 6 秒无操作就自己收起来（需求 1）。
   */
  _scheduleAutoHide() {
    if (this._autoHideTimer) {
      clearTimeout(this._autoHideTimer)
      this._autoHideTimer = null
    }
    if (!this.data.showControls) return
    this._autoHideTimer = setTimeout(() => {
      this._autoHideTimer = null
      // 呼出菜单会先暂停（_openControls），故 playing 恒为 false。
      // 自动收起以「呼出前是否在播放」为准：原本在滚 → 6s 无操作自动收起并按
      // _closeControls 恢复滚动（需求 1：播放中呼出菜单不挡台词）；
      // 原本就暂停 → 仅收起菜单，不擅自恢复。
      if (this._wasPlayingBeforeMenu) {
        this._closeControls()
      } else {
        this.setData({ showControls: false })
      }
    }, MENU_AUTO_HIDE_MS)
  },

  /** 菜单里任何一次操作都顺延自动收起倒计时 */
  _pokeMenu() {
    if (this.data.showControls) this._scheduleAutoHide()
  },

  /**
   * 播放 / 暂停。菜单里的按钮与这里共用同一套逻辑，保证按钮态与实际一致。
   * 关键：暂停时必须同时取消倒计时，否则倒计时结束会重新 _startScroll，
   * 表现就是「点了暂停没反应（甚至菜单被关掉），过两秒又自己滚起来」。
   *
   * 需求 2 修复：菜单呼出时会先暂停（见 _openControls），所以菜单打开时 playing 恒为 false，
   * 按钮始终表现为「播放/继续」且状态可控，不再出现「点了失效」的错觉；
   * 在菜单内点「播放」会直接收起菜单，让用户看清滚动。
   */
  onTapPlay() {
    this._clearCountdown()
    if (this.data.playing) {
      // 暂停（匀速 / 声控通用）
      this.engine.pause()
      this._pauseForStats()
      this.setData({ playing: false })
      // 声控模式下手动暂停要同步停掉录音监听，否则 VAD 检测到声音又会把字幕带起来
      if (this.data.scrollStyle === 'voice' && this.voice.running) {
        this.voice.stop()
      }
    } else {
      if (this.data.scrollStyle === 'voice') {
        // 声控跟读：重新唤起监听，由 VAD 决定何时滚动；引擎保持暂停，绝不主动开播。
        // 滚到底后再点播放：先归零回到开头，再起监听。
        if (this.engine.progress >= 0.999) {
          this._wrapped = false
          this.engine.seekProgress(0)
        }
        if (!this.voice.running) this._startVoice()
        this.setData({ playing: false, finished: false })
      } else {
        if (this.engine.progress >= 0.999) {
          this._wrapped = false // 从头再来：回到「首圈开篇留空」语义
          this.engine.seekProgress(0)
          this._startScroll(true)
        } else {
          this.engine.start()
          this._resumeForStats()
          this.setData({ playing: true, finished: false })
        }
      }
      // 在菜单里点播放就收起菜单，避免按钮被遮罩盖住造成「点了没反应」的错觉
      if (this.data.showControls) {
        this.setData({ showControls: false })
        this._wasPlayingBeforeMenu = false
      }
    }
    this._pokeMenu()
  },

  onTapRestart() {
    this._lastSection = -1
    this._seekTo(0)
    this.setData({ finished: false })
    this._startScroll(true)
  },

  /** 速度 +/- 步进（上限 400，见 prefs.SPEED_MAX） */
  onTapSpeed(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0
    this._applySpeed((this.data.speed || 50) + delta)
  },

  /** 速度滑块拖动（需求 5：在提词台直接选速度） */
  onSlideSpeed(e) {
    const v = Number(e.detail.value)
    if (!isFinite(v)) return
    this._applySpeed(v)
  },

  _applySpeed(v) {
    const next = Math.round(
      util.clamp(v, prefsEngine.SPEED_MIN, prefsEngine.SPEED_MAX)
    )
    const px = pxPerSecondOf(next)
    app.updatePrefs({ speed: next })
    this.engine.setSpeed(px)
    // 统计里的语速反推用的是 px/s，不跟着更新会让复盘里的字速停在旧值
    if (this.stats) this.stats.pxPerSecond = px
    this.setData({ speed: next })
    this._pokeMenu()
  },

  /** 横屏 / 竖屏切换（需求 5） */
  onToggleOrientation() {
    const next = this.data.orientation === 'landscape' ? 'portrait' : 'landscape'
    app.updatePrefs({ orientation: next })
    this.setData({ orientation: next })
    this._applyOrientation(next)
    util.toast(next === 'landscape' ? '已切换横屏' : '已切换竖屏')
    // 部分机型 setPageOrientation 不触发 onResize，兜底重排一次
    setTimeout(() => {
      if (this._launched && this.allLines.length) this._relayoutKeepProgress()
      // 横屏下菜单仍在开，就按新可视区高度重新适配
      if (this.data.showControls) this._fitMenuToScreen()
    }, 400)
    this._pokeMenu()
  },

  /**
   * 角色高亮开关（只给名字上色，台词保持正文色）。
   * 2026-10-27：「名字+台词」整行高亮已下线，原来两个互斥按钮合并成这一个开关。
   * 与编辑页 / 设置页同源（prefs.roleHighlight），且统一走 smartPatch ——
   * 总闸开着时手动开高亮会自动解除总闸，绝不出现「总闸开 + 高亮开」的矛盾状态。
   */
  onToggleRoleHighlight() {
    const next = !this.data.roleHighlight
    const cur = (app.globalData && app.globalData.prefs) || prefsEngine.load()
    const p = app.updatePrefs(prefsEngine.smartPatch(cur, 'roleHighlight', next))
    this.setData({ roleHighlight: p.roleHighlight !== false })
    this._relayoutKeepProgress()
    this._pokeMenu()
  },

  /**
   * 程序化设定「角色显示过滤」（滚动页无角色选择 UI，配置源在编辑页）：
   * def 为角色名数组/Set/{names}/{ids}；空/无效 → 显示全部。
   * 编辑页保存的 script.roleDisplay 会在 _parseAndLayout 经 _roleDisplayFilter 自动应用。
   */
  onSetRoleFilter(def) {
    // [] / null 语义统一：null = 全显；[] = 显式无显示；非空 = 仅显示指定角色
    if (def === null) this.roleFilter = null
    else if (!def || !def.length) this.roleFilter = new Set()
    else this.roleFilter = roleEngine.resolveRoleFilter(def, this.allRoles || [], this.allAliases || {})
    this._applyRoleFilter()
  },

  _applyRoleFilter() {
    // 兜底：一键关闭智能功能时角色过滤整体失效——不论外部传入何种过滤集合，
    // 一律清空为「显示全部」，保证台词 100% 完整（与 _parseAndLayout 口径一致）。
    const prefs = Object.assign({}, prefsEngine.DEFAULTS, app.globalData.prefs || prefsEngine.load())
    if (prefs.smartOff) this.roleFilter = null
    const wasPlaying = this.data.playing
    if (this.engine) this.engine.pause()
    this.displayLines = roleEngine.filterLinesByRole(this.allLines, this.roleFilter)
    if (this.roleFilter && this.roleFilter.size > 0 && this.displayLines.length === 0) {
      this.roleFilter = null
      this.displayLines = this.allLines
      util.toast('所选角色无台词，已显示全部')
    }
    const lh = this.data.lineHeightPx || 60
    this.contentHeight = this.displayLines.length * lh
    this.setData({
      contentHeight: this.contentHeight,
      playing: false,
      finished: false
    })
    if (this.engine) {
      this.engine.configure(
        lh,
        this.contentHeight,
        this.data.viewportHeight || 600,
        this.engine.pxPerSecond,
        this.engine.guideOffset
      )
      this.engine.loop = !!this.data.loop
      this.engine.seekProgress(0)
      this._syncOffsetFromEngine()
    }
    this._updateVisible(true)
    if (this.roleFilter && this.roleFilter.size) {
      util.toast('仅显示：' + Array.from(this.roleFilter).join('、'))
    } else if (wasPlaying) {
      util.toast('已显示全部台词')
    }
  },

  /**
   * 编辑页「角色显示选择」配置 → 显示过滤集合。
   * 读台本 script.roleDisplay（角色标准名数组，空/缺省=显示全部），
   * 经 resolveRoleFilter 解析成与 line.role 精确匹配的标准名集合。
   */
  _roleDisplayFilter() {
    const rd = this.script && this.script.roleDisplay
    // 未配置（老台本 / 新建未保存）：兼容全显
    if (rd === undefined || rd === null) return null
    // 已配置但为空数组：用户显式「取消全选」→ 无角色可显示
    if (!Array.isArray(rd) || !rd.length) return new Set()
    const set = roleEngine.resolveRoleFilter(rd, this.allRoles || [], this.allAliases || {})
    // 非空数组含有效角色 → 仅显示这些；全是失效名（角色被合并/删除）→ 回退全显，不误清空整屏
    return set && set.size ? set : null
  },

  /** 菜单里的三套一键文字/背景预设（需求 11） */
  onTapThemePreset(e) {
    const key = e.currentTarget.dataset.key
    const preset = (prefsEngine.PRESET_THEMES || []).filter((t) => t.key === key)[0]
    if (!preset) return
    // 预设整体接管配色：清掉自定义色，避免两者打架
    app.updatePrefs({ colorScheme: key, bgColor: null, textColor: null })
    this.setData({ colorScheme: key })
    this._relayoutKeepProgress()
    util.toast(preset.name)
    this._pokeMenu()
  },

  onTapFontSize(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    const prefs = app.globalData.prefs || prefsEngine.load()
    const next = util.clamp((prefs.fontSize || 3) + delta, 1, 5)
    app.updatePrefs({ fontSize: next })
    const progress = this.engine.progress
    this._parseAndLayout()
    this._seekTo(progress)
    // 字号变了菜单可能更高，重新按可视区适配（可上下滚动看全）
    if (this.data.showControls) this._fitMenuToScreen()
  },

  onToggleMirror() {
    const next = !this.data.mirror
    app.updatePrefs({ mirror: next })
    this.setData({ mirror: next })
  },

  onToggleGuide() {
    const next = !this.data.showGuide
    app.updatePrefs({ showGuide: next })
    this.setData({ showGuide: next })
  },

  onToggleFillLight() {
    const next = !this.data.fillLight
    app.updatePrefs({ fillLight: next })
    this.setData({ fillLight: next })
    if (next) {
      wx.setScreenBrightness({ value: 1 })
    } else {
      wx.setScreenBrightness({ value: -1 })
    }
  },

  onTapSettings() {
    this._fromSettings = true
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  onTapBack() {
    wx.navigateBack()
  },

  /** 循环播放开关（无缝无限滚动） */
  onToggleLoop() {
    const next = !this.data.loop
    app.updatePrefs({ loop: next })
    this.engine.loop = next
    this.setData({ loop: next })
    this._pokeMenu()
  },

  /**
   * 切换滚动方式（两种）：
   *   smooth 匀速自动滚动（默认）——连续匀速上滚，无缝无限循环
   *   voice  声控跟读——检测到说话才滚
   */
  async onSetScrollStyle(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.scrollStyle) {
      this._pokeMenu()
      return
    }
    if (key === 'voice') {
      const ok = await vad.requestAuth()
      if (!ok) {
        wx.showModal({
          title: '声控跟读不可用',
          content:
            '需要麦克风权限，且必须在微信公众平台配置《隐私保护指引》并声明「麦克风/录音」用途。模拟器无法使用麦克风，请用手机真机预览。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
    }
    this._applyScrollStyle(key)
  },

  /** 真正应用滚动方式（内部用，不弹权限框） */
  _applyScrollStyle(key) {
    const style = key === 'voice' ? key : 'smooth'
    // 离开声控：停掉录音，避免后台一直占着麦克风
    if (style !== 'voice' && this.voice && this.voice.running) this.voice.stop()
    app.updatePrefs({
      scrollStyle: style,
      scrollMode: style === 'voice' ? 'voice' : 'auto',
      voiceControl: style === 'voice'
    })
    this.setData({
      scrollStyle: style,
      voiceEnabled: style === 'voice',
      voiceLevel: style === 'voice' ? this.data.voiceLevel : 0,
      voiceTip: ''
    })

    if (style === 'voice') {
      // 声控：先停下，等 VAD 检测到说话由 onVoice 回调 resume
      this.engine.pause()
      this.setData({ playing: false })
      this._startVoice()
    } else if (this.data.playing) {
      // 匀速保持当前播放状态
      this.engine.resume()
      this.setData({ playing: true })
    }
    util.toast(style === 'smooth' ? '匀速自动滚动' : '声控跟读')
    this._pokeMenu()
  },

  /**
   * 进度条拖动中（bindchanging，连续触发）：暂停引擎、按拖动位置 seek，
   * 并记录「拖动前是否在播放」，松手后据此决定是否续播。
   */
  onSeekChanging(e) {
    const v = e.detail.value || 0
    const p = v / 100
    if (!this.engine) return
    if (!this._seeking) {
      this._seeking = true
      this._resumeAfterSeek = this.data.playing
      if (this.engine.playing) {
        this.engine.pause()
        this.setData({ playing: false })
        if (this._resumeAfterSeek) this._pauseForStats()
      }
    }
    this.engine.seekProgress(p)
    this.setData({ progressValue: v })
    this._syncOffsetFromEngine()
    this._updateVisible(true)
  },

  /**
   * 进度条拖动结束（bindchange，松手触发）：定位到最终位置，
   * 若拖动前在播放则继续匀速滚动。
   */
  onSeekChange(e) {
    const v = e.detail.value || 0
    const p = v / 100
    if (!this.engine) return
    this.engine.seekProgress(p)
    this.setData({ progressValue: v })
    this._syncOffsetFromEngine()
    this._updateVisible(true)
    this._seeking = false
    if (this._resumeAfterSeek && this.engine.current < this.engine.maxOffset) {
      this.engine.resume()
      this._resumeForStats()
      this.setData({ playing: true, finished: false })
    }
    this._savePosition()
  },

  // ---------- 手动翻页（手势拖动 + 上/下一段） ----------

  onTouchStart(e) {
    // 取消挂起中的「单击→暂停」定时器：用户若先轻点一下（单击 timer 已挂起 260ms），
    // 紧接着开始拖动调位，则本次手势应彻底接管，避免 260ms 后挂起的单击又把刚调好的
    // 字幕暂停住（审查报告 P3-5）。
    if (this._tapTimer) {
      clearTimeout(this._tapTimer)
      this._tapTimer = null
    }
    // 注意：这里【不能】清零 _lastTapAt。真机上每次点击前都会先触发 onTouchStart，
    // 若在此把它置 0，双击的第二下 onTapScreen 读到 _lastTapAt=0（falsy）会被误判成
    // 单击，导致双击永远打不开菜单、或双击打开的菜单被随后 260ms 的挂起单击 onTapPlay
    // 误隐藏（审查发现的回归缺陷）。取消挂起的单击定时器即可防止「拖动后被暂停」，
    // 而保留 _lastTapAt 才能让第二下仍落在双击窗口内、被正确识别为双击。
    // 记下触摸前的播放状态：松手时只有「本来就在播」才自动续播。
    // 否则已暂停时想轻点屏幕唤出控制栏，会被 onTouchEnd 误判成「继续播放」。
    this._touchWasPlaying = !!this.data.playing
    if (this.engine) this.engine.pause()
    // 仅当本来在播时才记入统计暂停，避免「已暂停时轻点」误增 pausedCount（P2-2）
    if (this._touchWasPlaying) this._pauseForStats()
    this._touching = true
    this._dragged = false
    this._touchStartY = e.touches[0].clientY
    this._touchStartOffset = this.engine ? this.engine.current : 0
  },

  onTouchMove(e) {
    if (!this._touching || !this.engine) return
    const dy = e.touches[0].clientY - this._touchStartY
    if (Math.abs(dy) > 6) this._dragged = true
    // 手指上滑 dy<0 -> offset 增大（内容上移）；下滑 dy>0 -> offset 减小
    this.engine.syncTo(this._touchStartOffset - dy)
    this._syncOffsetFromEngine()
    this._updateVisible(true)
  },

  onTouchEnd() {
    if (!this._touching) return
    this._touching = false
    if (this._dragged) {
      this._dragged = false
      this._suppressTap = true
      setTimeout(() => {
        this._suppressTap = false
      }, 350)
    }
    // 自动滚动时手动拖动定位：松手后继续滚动（需求：手动调位不要停）。
    // 去掉 scrollMode==='auto' 的冗余判断（playing 已隐含），仅排除声控与已滚到末尾。
    // 配合「有效视口」修复后 maxOffset 正确，拖动不会再误触「已到末尾」而停在半路。
    if (this._touchWasPlaying && !this.data.voiceEnabled) {
      if (this.engine.current < this.engine.maxOffset) {
        this.engine.resume()
        this._resumeForStats()
        this.setData({ playing: true, finished: false })
      }
    }
    this._savePosition()
  },

  /**
   * 需求 10：菜单里的「上一个 / 下一个」不再跳段落，改为切换台本。
   * 实测在提词现场跳段落几乎用不上（台词是连着念的），而换台本是高频动作。
   */
  onTapPrevScript() {
    this._switchScript(-1)
  },

  onTapNextScript() {
    this._switchScript(1)
  },

  /**
   * 边界策略（明确「不循环」）：到头就把按钮置灰，而不是绕回另一端。
   * 拍摄现场误触绕回第 1 集会直接打乱节奏，所以禁用优于循环。
   * 置灰之外 JS 侧仍再校验一次，防止角标未刷新等异常情况下越界。
   */
  _switchScript(dir) {
    // 切换锁：连点或上一次还没加载完时，直接忽略后到的点击。
    // 否则会叠加多个倒计时定时器、重复落盘、甚至并发 _parseAndLayout。
    if (this._switching) return

    const all = this._scriptOrder()
    if (!all.length) {
      this.setData({ hasPrevScript: false, hasNextScript: false, scriptPosText: '' })
      util.toast('还没有台本，先回首页新建')
      return
    }
    if (all.length === 1) {
      // 只有一篇时两个方向都无处可去：按钮本就置灰，被代码直接调用时给一次明确反馈，
      // 不做「静默 return」那种点了没反应的处理
      this.setData({ hasPrevScript: false, hasNextScript: false })
      util.toast('只有一个台本')
      return
    }

    let idx = all.findIndex((s) => s.id === this.scriptId)
    if (idx < 0) {
      // 当前台本已不在列表（例如在首页被删掉了）：先归位到对应端点，
      // 而不是直接 return 让按钮「可点却毫无反应」（原实现就是这个坑）
      idx = dir > 0 ? -1 : all.length
    }

    const nextIdx = idx + dir
    if (nextIdx < 0 || nextIdx >= all.length) {
      // 边界：刷新一次角标与按钮态（列表可能刚变过），再给明确提示，不切换
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
      // 加载失败也必须解锁，否则两个按钮会永久失效
      this._switching = false
      util.toast('切换失败，请重试')
    }
  },

  /**
   * 切换前的状态归零：明确「重置什么 / 保留什么」。
   *
   * 重置（与具体台本绑定的运行态）：引擎偏移、进度条、结束标记、续播进度、
   *   统计收集器、段落游标、无限滚动回绕标记、倒计时、触摸/拖动中间态。
   * 保留（用户偏好，_loadScript 会重新从 prefs 读回来）：字号、行高、速度、
   *   配色、镜像、参考线、补光、横竖屏、声控开关、无限滚动。
   */
  _prepareSwitch() {
    // 先把当前台本的进度与复盘落盘，再切走，否则这一遍就白读了
    if (this.engine) this.engine.pause()
    this.setData({ playing: false })
    this._finalizeStats(false)
    this._savePosition()

    // 倒计时必须先掐掉：上一轮 interval 若还活着，会在新台本加载后继续触发
    // _startScroll，表现为「切完立刻自己开跑」或「倒计时一次跳两格」
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }

    this.setData({
      showControls: false,
      finished: false,
      resumePosition: 0,
      progress: 0,
      progressValue: 0,
      progressText: '0%',
      countdown: 0
    })
    this.stats.reset()
    this._statSaved = false
    this._lastSection = -1
    this._wrapped = false
    this._touching = false
    this._dragged = false
    this._suppressTap = false
    this._touchWasPlaying = false
    this._seeking = false
    this._resumeAfterSeek = false
  },

  /** 段落跳转：当前版本菜单里已改为切换台本，这里保留给「跳转到指定段」内部使用 */
  _jumpSection(dir) {
    const lines = this.displayLines
    if (!lines || !lines.length) return
    const curLine = this.engine ? this.engine.currentLineIndex : 0
    const cur = lines[Math.min(Math.max(curLine, 0), lines.length - 1)]
    const curSec = cur ? cur.sectionIndex : 0
    let target = dir > 0 ? -1 : 0
    if (dir > 0) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].sectionIndex > curSec) {
          target = i
          break
        }
      }
      if (target < 0) target = lines.length - 1
    } else {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].sectionIndex < curSec) {
          target = i
          break
        }
      }
      // 上面扫到的是「上一段的最后一行」。要继续往前回溯到该段的第一行，
      // 否则点「上一段」会落在上一段末尾，观感像是跳过了整段（下一段是对的，两个方向不对称）。
      if (target > 0) {
        const sec = lines[target].sectionIndex
        while (target > 0 && lines[target - 1].sectionIndex === sec) target--
      }
      if (target < 0) target = 0
    }
    const offset = Math.max(0, Math.min(this.engine.maxOffset, target * this.data.lineHeightPx))
    this.engine.syncTo(offset)
    this._syncOffsetFromEngine()
    this._updateVisible(true)
    this._lastSection = lines[target] ? lines[target].sectionIndex : -1
    if (this.data.scrollMode === 'auto' && !this.data.voiceEnabled) {
      if (this.engine.current < this.engine.maxOffset) {
        this.engine.resume()
        this.setData({ playing: true, finished: false })
      }
    }
    this._savePosition()
  },

  // ---------- 声控 ----------

  async onToggleVoice() {
    if (this.data.voiceEnabled) {
      this.voice.stop()
      this.setData({ voiceEnabled: false, voiceLevel: 0, voiceTip: '' })
      // 关掉声控后恢复匀速，否则会一直停着
      app.updatePrefs({ scrollStyle: 'smooth', scrollMode: 'auto', voiceControl: false })
      this.setData({ scrollStyle: 'smooth' })
      if (!this.data.playing) this.engine.resume()
      this.setData({ playing: true })
      return
    }

    const ok = await vad.requestAuth()
    if (!ok) {
      wx.showModal({
        title: '声控跟读不可用',
        content:
          '需要麦克风权限，且必须在微信公众平台配置《隐私保护指引》并声明「麦克风/录音」用途。\n\n如果你正在电脑模拟器里点这个按钮，请改用手机微信扫码真机预览——模拟器无法使用麦克风，属正常现象。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    this.setData({
      voiceEnabled: true,
      voiceCalibrating: true,
      voiceTip: '正在采集环境噪声',
      scrollStyle: 'voice'
    })
    app.updatePrefs({ scrollStyle: 'voice', scrollMode: 'voice', voiceControl: true })
    // 进声控先停掉自动滚动，交给 VAD 驱动；否则会出现「边校准边自己滚」
    this.engine.pause()
    this.setData({ playing: false })
    this._startVoice()
  },

  _startVoice() {
    const started = this.voice.start({
      onVoice: () => {
        this.engine.resume()
        this.setData({ playing: true, voiceCalibrating: false, voiceTip: '' })
      },
      onSilence: () => {
        this.engine.pause()
        this.setData({ playing: false })
      },
      onLevel: (level, calibrating) => {
        if (calibrating) return
        // 音量条没必要每帧刷新，节流到约 15fps
        const now = Date.now()
        if (now - (this._lastLevelAt || 0) < 66) return
        this._lastLevelAt = now
        this.setData({ voiceLevel: Math.round(level * 100) })
      },
      onCalibrated: () => {
        this.setData({ voiceCalibrating: false, voiceTip: '' })
      },
      onError: (msg) => {
        this.setData({ voiceEnabled: false, voiceCalibrating: false, voiceTip: '录音异常' })
        util.toast('录音异常，已关闭声控')
      }
    })
    if (!started) {
      this.setData({ voiceEnabled: false, voiceCalibrating: false, voiceTip: '' })
      util.toast('录音启动失败')
    }
  },

  /** 环境变了就重新采一次噪声基线 */
  onTapRecalibrate() {
    if (!this.voice || !this.voice.running) return
    this.voice.recalibrate()
    this.setData({ voiceCalibrating: true, voiceTip: '正在采集环境噪声' })
  }
})
