/**
 * 声控跟读（VAD）
 *
 * 零成本方案：本地分析录音音量，判断用户在不在说话，音频不上传、不联网、无延迟。
 * 这是 v1.0 的核心卖点，也是验证「跟读」需求真伪的最便宜方式。
 * AI 精确跟读（ASR）是 v1.5 的事，见架构文档 8.4。
 *
 * 参数依据（架构文档 8.3）：
 * - 阈值自适应：开启后采样环境噪声，阈值 = 噪声基线 × 2.5
 * - 平滑系数 0.7 / 0.3，防止单个字的气口误触发暂停
 * - 静音 800ms 才停，避免正常换气被误判
 */

const SAMPLE_RATE = 16000
const FRAME_SIZE_KB = 2 // 约 64ms 一帧
const FRAME_MS = (FRAME_SIZE_KB * 1024) / (SAMPLE_RATE * 2 / 1000) // ≈ 64
const CALIBRATE_MS = 2000 // 环境噪声采样时长
const SMOOTH_A = 0.7 // 历史权重
const SMOOTH_B = 0.3 // 当前帧权重
const SILENCE_STOP_MS = 800 // 静音多久判定为停止
const MIN_THRESHOLD = 0.008 // 阈值下限，防止极度安静环境下灵敏度爆表

/**
 * 隐私授权闸门：2023 年起，调用录音等涉及用户信息的接口前必须先取得隐私协议同意。
 * 若 mini-program 未配置《隐私保护指引》或基础库较旧，wx.requirePrivacyAuthorize 不存在，
 * 此时直接放行（由后端隐私配置决定能否调用），避免老环境/游客模式直接崩。
 * @returns {Promise<boolean>} true=已同意可继续，false=用户拒绝
 */
function ensurePrivacy() {
  return new Promise((resolve) => {
    if (typeof wx.requirePrivacyAuthorize !== 'function') return resolve(true)
    wx.requirePrivacyAuthorize({
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/**
 * 申请录音权限
 * @returns {Promise<boolean>}
 */
async function requestAuth() {
  const agreed = await ensurePrivacy()
  if (!agreed) {
    return false
  }
  return new Promise((resolve) => {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.record'] === true) return resolve(true)
        if (res.authSetting['scope.record'] === false) {
          // 已拒绝过，引导去设置页开启
          wx.showModal({
            title: '需要麦克风权限',
            content: '声控跟读需要麦克风来检测您是否在说话。音频仅在本地分析，不会上传。',
            confirmText: '去开启',
            success: (r) => {
              if (r.confirm) {
                wx.openSetting({
                  success: (s) => resolve(!!s.authSetting['scope.record'])
                })
              } else {
                resolve(false)
              }
            }
          })
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve(true),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

class VoiceController {
  constructor() {
    this.recorder = null
    this.running = false
    this.speaking = false
    this.smoothed = 0
    this.noiseBase = 0
    this.calibSamples = []
    this.calibEndAt = 0
    this.silenceMs = 0
    this.threshold = MIN_THRESHOLD

    this.onVoice = function () {}
    this.onSilence = function () {}
    this.onLevel = function () {}
    this.onError = function () {}
    this.onCalibrated = function () {}

    this._bindFrame = this._bindFrame.bind(this)
    this._bindStop = this._bindStop.bind(this)
    this._bindError = this._bindError.bind(this)
  }

  _ensureRecorder() {
    if (!this.recorder) {
      this.recorder = wx.getRecorderManager()
      this.recorder.onFrameRecorded(this._bindFrame)
      this.recorder.onStop(this._bindStop)
      this.recorder.onError(this._bindError)
    }
    return this.recorder
  }

  /**
   * 启动声控
   * @param {Object} handlers { onVoice, onSilence, onLevel, onError, onCalibrated }
   */
  start(handlers) {
    const h = handlers || {}
    this.onVoice = h.onVoice || function () {}
    this.onSilence = h.onSilence || function () {}
    this.onLevel = h.onLevel || function () {}
    this.onError = h.onError || function () {}
    this.onCalibrated = h.onCalibrated || function () {}

    this.speaking = false
    this.smoothed = 0
    this.silenceMs = 0
    this.noiseBase = 0
    this.calibSamples = []
    this.calibEndAt = Date.now() + CALIBRATE_MS
    this.threshold = MIN_THRESHOLD

    const recorder = this._ensureRecorder()
    try {
      recorder.start({
        duration: 600000, // 10 分钟上限，到点自动停止
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'PCM',
        frameSize: FRAME_SIZE_KB
      })
      this.running = true
    } catch (e) {
      this.running = false
      this.onError('start-failed')
    }
    return this.running
  }

  stop() {
    this.running = false
    this.speaking = false
    if (this.recorder) {
      try {
        this.recorder.stop()
      } catch (e) {
        // 未在录音状态，忽略
      }
    }
  }

  /** 手动重设噪声基线（用户在嘈杂环境切换时可用） */
  recalibrate() {
    this.calibSamples = []
    this.calibEndAt = Date.now() + CALIBRATE_MS
    this.noiseBase = 0
    this.threshold = MIN_THRESHOLD
  }

  _bindFrame(res) {
    if (!this.running) return
    const buf = res && res.frameBuffer
    if (!buf) return

    // PCM 16bit，长度必须是偶数
    const len = buf.byteLength || 0
    if (len < 2) return
    const usable = len - (len % 2)
    let pcm
    try {
      pcm = new Int16Array(buf, 0, usable / 2)
    } catch (e) {
      return
    }

    // 计算 RMS 能量
    let sum = 0
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i] / 32768
      sum += v * v
    }
    const rms = Math.sqrt(sum / pcm.length)
    this.smoothed = this.smoothed * SMOOTH_A + rms * SMOOTH_B

    // 校准阶段：采集环境噪声基线
    if (Date.now() < this.calibEndAt) {
      this.calibSamples.push(rms)
      if (this.onLevel) this.onLevel(0, true)
      return
    }
    if (this.calibSamples.length) {
      let s = 0
      for (let i = 0; i < this.calibSamples.length; i++) s += this.calibSamples[i]
      this.noiseBase = s / this.calibSamples.length
      this.threshold = Math.max(MIN_THRESHOLD, this.noiseBase * 2.5)
      this.calibSamples = []
      this.onCalibrated(this.threshold)
    }

    const level = Math.min(1, this.smoothed / Math.max(0.08, this.threshold * 4))
    this.onLevel(level, false)

    const isVoice = this.smoothed > this.threshold
    if (isVoice) {
      this.silenceMs = 0
      if (!this.speaking) {
        this.speaking = true
        this.onVoice()
      }
    } else {
      if (this.speaking) {
        this.silenceMs += FRAME_MS
        if (this.silenceMs >= SILENCE_STOP_MS) {
          this.speaking = false
          this.onSilence()
        }
      }
    }
  }

  _bindStop(res) {
    // 非主动停止（到 10 分钟上限或被系统打断）时自动续录
    if (this.running) {
      try {
        this.recorder.start({
          duration: 600000,
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'PCM',
          frameSize: FRAME_SIZE_KB
        })
      } catch (e) {
        this.running = false
        this.onError('restart-failed')
      }
    }
  }

  _bindError(err) {
    this.running = false
    this.onError((err && err.errMsg) || 'record-error')
  }
}

module.exports = {
  VoiceController,
  requestAuth,
  FRAME_MS,
  SILENCE_STOP_MS
}
