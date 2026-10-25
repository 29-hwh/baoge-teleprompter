/**
 * 提词复盘统计收集器（纯逻辑，可在 Node 下用注入时钟做单元测试）
 *
 * 用途：每次「一遍提词」采集关键指标，用于结束后的复盘弹窗与历史统计页。
 * 指标：
 *  - totalLines    台本总行数
 *  - rolledLines   本次实际滚到的最大行数（= maxProgress * totalLines）
 *  - activeMs      实际滚动时间（不含暂停/段末停顿，用真实时钟累加）
 *  - durationMs    从开始到结束的挂钟时长（含停顿）
 *  - pausedCount   主动暂停次数（视为「卡顿点」）
 *  - loopCount     循环次数
 *  - maxProgress   最大进度 0-1
 *  - completed     是否自然读完（滚到底触发 onEnd，非中途退出）
 *  - speed         pxPerSecond，折算字/分钟用
 */
class StatsCollector {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.totalLines]
   * @param {number} [opts.pxPerSecond]
   * @param {number} [opts.lineHeightPx]
   * @param {Function} [opts.now] 注入时钟，默认 Date.now（便于测试）
   */
  constructor(opts) {
    const o = opts || {}
    this.totalLines = o.totalLines || 0
    this.pxPerSecond = o.pxPerSecond || 0
    this.lineHeightPx = o.lineHeightPx || 1
    this._now = o.now || Date.now
    this.reset()
  }

  reset() {
    this.startTs = 0
    this.endTs = 0
    this.activeMs = 0
    this.lastTickTs = 0
    this._hasLast = false
    this.pausedCount = 0
    this.maxProgress = 0
    this.loopCount = 0
    this.completed = false
    this.running = false
  }

  /** 开始新的一遍提词 */
  onStart() {
    if (this.running) return
    this.running = true
    this.startTs = this._now()
    this.lastTickTs = this.startTs
    this._hasLast = true
  }

  /** 主动暂停（视为一次卡顿/停顿） */
  onPause() {
    if (!this.running) return
    this._accumActive()
    this.pausedCount++
    this.running = false
  }

  /** 从暂停恢复 */
  onResume() {
    if (this.running) return
    this.running = true
    this.lastTickTs = this._now()
  }

  /** 每帧上报当前进度 0-1 */
  onTick(progress) {
    if (this.running) this._accumActive()
    if (typeof progress === 'number' && progress > this.maxProgress) {
      this.maxProgress = progress
    }
  }

  /** 触发一次循环回到开头 */
  onLoop() {
    this.loopCount++
    this._accumActive()
  }

  /** 自然读完（滚到底触发 onEnd） */
  onEnd() {
    this._accumActive()
    this.endTs = this._now()
    this.running = false
    this.completed = true
  }

  _accumActive() {
    const now = this._now()
    if (this._hasLast) {
      this.activeMs += Math.max(0, now - this.lastTickTs)
    }
    this.lastTickTs = now
    this._hasLast = true
  }

  /** 产出一条可持久化的复盘记录 */
  snapshot() {
    const durationMs = this.endTs != null && this.startTs != null ? this.endTs - this.startTs : 0
    return {
      ts: this.endTs || this._now(),
      totalLines: this.totalLines,
      rolledLines: Math.round(this.maxProgress * this.totalLines),
      activeMs: Math.round(this.activeMs),
      durationMs: Math.round(durationMs),
      pausedCount: this.pausedCount,
      maxProgress: Math.round(this.maxProgress * 100) / 100,
      loopCount: this.loopCount,
      completed: this.completed,
      speed: this.pxPerSecond
    }
  }
}

module.exports = StatsCollector
