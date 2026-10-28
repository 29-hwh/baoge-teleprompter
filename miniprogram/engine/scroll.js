/**
 * 滚动引擎
 *
 * 设计要点（见架构文档 8.2）：
 * - 不用 scroll-view，页面层用 transform: translateY 移动整块内容
 * - 每帧做插值，跟读跳变时平滑过渡而不是硬切
 * - 限速：单次位移不超过 3 行，防止误跳导致视觉失控
 * - dt 上限 100ms，避免从后台切回时一帧跳过整篇稿件
 *
 * 调度说明（关键）：
 * 旧版用 requestAnimationFrame 驱动。但微信小程序真机/部分基础库下，
 * 页面内全局 requestAnimationFrame 并不保证持续回调（依赖屏幕刷新，
 * 某些机型/场景前台也不触发），导致「点击播放后完全不滚动、调速也没用」。
 * 改为 setInterval(16ms ≈ 60fps) 主驱动 —— 在小程序中稳定可靠，
 * 退后台被冻结是已知限制（已由 onHide 暂停 + 双设备方案兜底）。
 */

const SMOOTH_FACTOR = 0.12
const MAX_LINES_PER_FRAME = 3
const MAX_DT = 100
const FRAME_MS = 16 // 帧间隔，约 60fps

/**
 * 两次「回到开头」之间的最小间隔。
 * 稿件很短（可滚动距离只有几十 px）时，一帧就能滚完，
 * 若不加下限，onLoop 会每 16ms 触发一次 → 每帧 setData → 页面卡死、耗电飙升。
 */
const MIN_LOOP_MS = 400

class ScrollEngine {
  constructor(options) {
    const opts = options || {}
    this.onUpdate = opts.onUpdate || function () {}
    this.onEnd = opts.onEnd || function () {}
    this.onLoop = opts.onLoop || function () {}

    this.lineHeight = 40 // px
    this.totalHeight = 0 // px
    this.viewportHeight = 0 // px
    this.pxPerSecond = 30
    // 无缝无限滚动：循环时按「一份内容的完整高度」回绕，
    // 行号与渲染位置都对 totalLines 取模，滚到底直接接上开头，观感无跳变。
    this.loopHeight = 0 // 一份内容的完整高度（= totalHeight）
    this.totalLines = 0 // 总行数，用于行号取模

    // 参考线相对「内容首行基线」的偏移(px)；「非循环结束位置」见 configure()。
    // 默认 0（退化成滚到底），configure 时由控制器按真实布局写入。
    this.guideOffset = 0
    this.endOffset = 0

    this.current = 0
    this.target = 0
    this.playing = false
    this.loop = false // 是否循环播放（滚到底回到顶部继续）
    this._timer = null
    this._lastTs = 0
    this.pauseTimer = null
    // 循环节流与「内容不足一屏」保护，见 _tick
    this._lastLoopTs = 0
    this._shortEnded = false
    // 是否处于「跟读平滑过渡」：只有外部 setTarget 指定目标时才插值追赶。
    // 匀速滚动必须直给（current = target），否则 current 会滞后 target 约 8 帧，
    // 再叠加 setInterval 的抖动 → 观感就是一顿一顿的「卡顿」。
    this._follow = false

    this._tick = this._tick.bind(this)
  }

  /**
   * 配置内容尺寸与速度
   * @param {number} lineHeight 行高 px
   * @param {number} totalHeight 内容总高 px
   * @param {number} viewportHeight 视口高 px
   * @param {number} pxPerSecond 匀速滚动速度
   */
  configure(lineHeight, totalHeight, viewportHeight, pxPerSecond, guideOffset) {
    this.lineHeight = lineHeight || 40
    this.totalHeight = totalHeight || 0
    this.viewportHeight = viewportHeight || 0
    // 速度 0 是合法值（滑块拖到最慢 = 停住），不能被 `|| 30` 兜成 30 悄悄跑起来
    this.pxPerSecond =
      typeof pxPerSecond === 'number' && pxPerSecond >= 0 ? pxPerSecond : 30
    // 视线参考线相对「内容首行基线」的偏移(px)：台本结束的唯一定义是
    // 「最后一行文字滚过此线」。由控制器按布局实测传入
    // （.tp-content padding-top:40vh → 首行基线在 40% 屏高；.tp-guide 在 50%，
    // 故偏移 = 10% 屏高）。仅影响非循环模式的结束判定与进度映射，循环模式忽略它。
    this.guideOffset =
      typeof guideOffset === 'number' && guideOffset > 0 ? guideOffset : 0
    // 无缝无限滚动：一份内容的完整高度与行数（configure 时更新）
    this.loopHeight = this.totalHeight
    this.totalLines = this.lineHeight > 0 ? Math.round(this.totalHeight / this.lineHeight) : 0
    // 非循环结束位置：最后一行底部对齐参考线（offset = 内容高 − 参考线偏移）。
    // 与循环无关——循环用 loopHeight 回绕；结束定义恒定是「滚过参考线」而非「滚到底」。
    this.endOffset = Math.max(0, this.totalHeight - this.guideOffset)
    // 尺寸变了（换字号/转屏）后可能重新可滚动，清掉「不足一屏」的结束标记
    this._shortEnded = false
    this._clampTarget()
  }

  setSpeed(pxPerSecond) {
    this.pxPerSecond = typeof pxPerSecond === 'number' && pxPerSecond >= 0 ? pxPerSecond : 0
  }

  /** 可滚动的最大距离。
   *  循环（无缝无限滚动）时返回一整份内容的高度，使进度与拖动覆盖完整一圈；
   *  非循环时返回「最后一行滚过参考线」的位置（= 内容高 − 参考线偏移），
   *  而非「内容高度 - 视口高度」。旧实现用后者会在最后一行还停在屏幕底部
   *  （约 92% 屏高）时就提前收场，与「最后一行滚过参考线（50% 屏高）」相差约 42% 屏，
   *  导致台本末尾几句看不见、进度 100% 不等于「读完」。 */
  get maxOffset() {
    return this.loop ? Math.max(0, this.loopHeight) : this.endOffset
  }

  /** 当前进度 0-1 */
  get progress() {
    const max = this.maxOffset
    return max > 0 ? Math.min(1, this.current / max) : 0
  }

  /** 当前处于第几行（循环时对总行数取模，避免越界） */
  get currentLineIndex() {
    const li = Math.floor(this.current / this.lineHeight)
    const t = this.totalLines || 1
    return ((li % t) + t) % t
  }

  /** 启动 / 恢复滚动主循环 */
  _schedule() {
    if (this._timer) return
    this._lastTs = 0
    this._timer = setInterval(this._tick, FRAME_MS)
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  start() {
    // 关键修复：暂停后的「残存循环」(zombie loop) 还在跑(rafId 未清空)时，
    // 若此时再点播放，旧逻辑会 if (this.rafId) return 直接返回，导致
    // engine.playing 始终是 false —— 页面显示「播放中」但引擎根本不推进，
    // 表现就是「点击播放后台词完全不动」。这里无论 _timer 是否存在，都先置 playing=true，
    // 已存活的循环下一帧即会正常推进；循环已停(_timer=null)时才重新调度。
    this.playing = true
    if (this._timer) return
    this._schedule()
  }

  pause() {
    this.playing = false
    // 暂停即彻底停掉定时器循环，省电且语义清晰；
    // resume/start 时若发现 _timer 为 null 会重新调度。
    this._stopTimer()
  }

  resume() {
    if (this.current >= this.maxOffset) return
    this.playing = true
    if (!this._timer) this._schedule()
  }

  /**
   * 暂停指定毫秒后自动恢复，用于段末智能停顿
   */
  pauseFor(ms) {
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    this.playing = false
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      this.resume()
    }, ms)
  }

  stop() {
    this.playing = false
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
    this._stopTimer()
  }

  reset(offset) {
    this.current = offset || 0
    this.target = this.current
    this._shortEnded = false
    this._emit()
  }

  /** 跳转到指定进度（0-1），立即生效不做插值 */
  seekProgress(p) {
    const max = this.maxOffset
    const v = Math.max(0, Math.min(1, p || 0)) * max
    this.current = v
    this.target = v
    this._shortEnded = false
    this._follow = false
    this._emit()
  }

  /**
   * 设置目标位置（跟读模式下由对齐算法调用）。
   * 置 _follow=true 后 current 会以 SMOOTH_FACTOR 平滑追过去，避免硬跳。
   */
  setTarget(offsetPx) {
    this.target = this._clamp(offsetPx)
    this._follow = true
  }

  /** 用户手动拖动后立即重新定位，不做插值追赶 */
  syncTo(offsetPx) {
    const v = this._clamp(offsetPx)
    this.current = v
    this.target = v
    this._shortEnded = false
    this._follow = false
    if (!this._timer) this._emit()
  }

  destroy() {
    this.stop()
    this.onUpdate = function () {}
    this.onEnd = function () {}
    this.onLoop = function () {}
  }

  _clamp(v) {
    if (typeof v !== 'number') return this.target
    return Math.max(0, Math.min(this.maxOffset, v))
  }

  _clampTarget() {
    this.target = this._clamp(this.target)
    this.current = this._clamp(this.current)
  }

  _tick() {
    // 用 Date.now() 计帧间隔：稳定且必然有值，不依赖任何调度器的回调时间戳。
    const now = Date.now()
    if (!this._lastTs) this._lastTs = now
    let dt = now - this._lastTs
    this._lastTs = now
    if (!(dt > 0)) dt = FRAME_MS // 首帧或异常时间戳，给一个合理的默认间隔
    if (dt > MAX_DT) dt = MAX_DT

    if (this.playing) {
      this.target += (this.pxPerSecond * dt) / 1000
      const max = this.maxOffset

      if (max <= 0) {
        // 内容不足一屏：根本没有可滚动距离。此时「滚到底」这个条件每帧都成立，
        // 若按下面的逻辑走循环，onLoop 会每 16ms 触发一次（setData 风暴）。
        // 这里只结束一次并停表，语义上也正确——没东西可滚，等于读完了。
        this.target = 0
        this.current = 0
        this.playing = false
        this._stopTimer()
        if (!this._shortEnded) {
          this._shortEnded = true
          this.onEnd()
        }
      } else if (this.loop && this.loopHeight <= this.viewportHeight) {
        // 循环模式下内容不足一屏：取模渲染会让同一小段在视口内重复出现两次，
        // 既无意义也显得「在空转」。按「读完一遍」处理并停表
        // （修复：短稿+循环不触发 onEnd、引擎空转不收场，详见审查报告 P2-4）。
        this.playing = false
        this._stopTimer()
        if (!this._shortEnded) {
          this._shortEnded = true
          this.onEnd()
        }
      } else if (this.target >= max) {
        if (this.loop) {
          // 无缝无限滚动：不做「归零回顶」的跳变，而是减去一整份内容的高度继续上滚。
          // 因为渲染层对行号取模拼接（见 teleprompter._updateVisible），
          // 减完之后画面正好接上开头，观众看不出循环点，像小说一样一直滚。
          this.current -= this.loopHeight
          this.target -= this.loopHeight
          // 两次 onLoop（统计收尾/段标记重置）之间强制 MIN_LOOP_MS 间隔：
          // 极短稿件一帧就能滚完一圈，不设下限 onLoop/setData 会每帧触发。
          const nowMs = Date.now()
          if (nowMs - this._lastLoopTs >= MIN_LOOP_MS) {
            this._lastLoopTs = nowMs
            if (this.onLoop) this.onLoop()
          }
        } else {
          this.target = max
          this.playing = false
          this.onEnd()
        }
      }
    }

    const diff = this.target - this.current
    if (this._follow) {
      // 跟读跳变：限幅插值，一次最多跨 3 行，避免画面失控
      const maxStep = (this.lineHeight * MAX_LINES_PER_FRAME * dt) / 16.7
      let step = diff * SMOOTH_FACTOR
      if (step > maxStep) step = maxStep
      if (step < -maxStep) step = -maxStep
      if (Math.abs(diff) < 0.5) {
        this.current = this.target
        this._follow = false
      } else {
        this.current += step
      }
    } else {
      // 匀速滚动：直接给到目标位置。
      // 旧实现在这里做指数插值（current 每帧只追 target 的 12%），
      // 稳态下 current 恒定滞后 target 约 8 帧位移；配上 setInterval 的抖动，
      // 位移就会忽大忽小 —— 这正是「滚动卡顿」的观感来源。匀速必须直给。
      this.current = this.target
    }

    this._emit()

    // 到达底部且已停止推进、或暂停后已收敛时，停止定时器省电；否则继续由 setInterval 驱动
    if (!this.playing && Math.abs(this.target - this.current) < 0.5) {
      this._stopTimer()
      this._lastTs = 0
      return
    }
  }

  _emit() {
    this.onUpdate(this.current, this.progress, this.currentLineIndex)
  }
}

module.exports = ScrollEngine
