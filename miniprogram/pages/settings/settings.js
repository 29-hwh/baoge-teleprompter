const app = getApp()
const prefsEngine = require('../../engine/prefs.js')
const util = require('../../utils/util.js')

const LINE_HEIGHT_OPTIONS = [1.4, 1.6, 1.8, 2.0, 2.2]
const LETTER_SPACING_OPTIONS = [0, 1, 2, 3]
const COUNTDOWN_OPTIONS = [0, 3, 5, 10]
const ORIENTATION_OPTIONS = [
  { label: '竖屏', value: 'portrait' },
  { label: '横屏', value: 'landscape' },
  { label: '自动', value: 'auto' }
]
const SCROLL_MODE_OPTIONS = [
  { label: '匀速自动', value: 'auto' },
  { label: '声控跟读', value: 'voice' }
]

/** 自定义配色色板 */
const BG_SWATCHES = ['#000000', '#1C1C1E', '#2B2B2B', '#3A3A3C', '#0A2540', '#1A1A2E', '#F2F2F7', '#FFFFFF']
const TEXT_SWATCHES = ['#FFFFFF', '#FFD166', '#7BE0AD', '#4CC9F0', '#FF9FB2', '#C9A7FF', '#FF6B6B', '#1C1C1E']

Page({
  data: {
    prefs: {},
    fontLevels: [1, 2, 3, 4, 5],
    fontLabels: ['小', '较小', '标准', '大', '特大'],
    speedPresets: prefsEngine.SPEED_PRESETS,
    schemes: [],
    presets: prefsEngine.PRESET_THEMES,
    bgSwatches: BG_SWATCHES,
    textSwatches: TEXT_SWATCHES,
    fontFamilyKeys: prefsEngine.FONT_FAMILY_KEYS,
    fontFamilies: prefsEngine.FONT_FAMILIES,
    // 「高亮方式」选项已移到编辑页「角色显示选择」面板，本页不再提供
    lineHeightOptions: LINE_HEIGHT_OPTIONS,
    letterSpacingOptions: LETTER_SPACING_OPTIONS,
    countdownOptions: COUNTDOWN_OPTIONS,
    orientationOptions: ORIENTATION_OPTIONS,
    scrollModeOptions: SCROLL_MODE_OPTIONS
  },

  onLoad() {
    const list = Object.keys(prefsEngine.COLOR_SCHEMES).map((key) => {
      return Object.assign({ key: key }, prefsEngine.COLOR_SCHEMES[key])
    })
    this.setData({ schemes: list })
  },

  onShow() {
    this.setData({ prefs: app.globalData.prefs || prefsEngine.load() })
  },

  _set(patch) {
    const next = app.updatePrefs(patch)
    this.setData({ prefs: next })
  },

  onTapFont(e) {
    this._set({ fontSize: Number(e.currentTarget.dataset.value) })
  },

  /** 左右留白（文字距屏幕边缘的间距）：0~80px 连续可调，0 即贴边 */
  onSlideMargin(e) {
    this._set({ marginHorizontal: Number(e.detail.value) })
  },

  onTapSpeedPreset(e) {
    this._set({ speed: Number(e.currentTarget.dataset.value) })
  },

  onTapSpeedStep(e) {
    const delta = Number(e.currentTarget.dataset.delta)
    // 边界统一引用引擎常量：40-400（与提词台菜单滑块一致，勿硬编码旧值）
    // 兜底也走 DEFAULTS.speed（50，即「极慢」档），不要再写死 200 —— 那会把
    // 一次「值缺失」的异常变成「突然回到旧默认」的诡异体验。
    this._set({ speed: util.clamp((this.data.prefs.speed || prefsEngine.DEFAULTS.speed) + delta, prefsEngine.SPEED_MIN, prefsEngine.SPEED_MAX) })
  },

  onTapScheme(e) {
    this._set({ colorScheme: e.currentTarget.dataset.value })
  },

  /** 一键主题：套用预设的背景+文字色，并清除自定义色 */
  onTapPreset(e) {
    const next = app.updatePrefs({
      colorScheme: e.currentTarget.dataset.value,
      bgColor: null,
      textColor: null
    })
    this.setData({ prefs: next })
  },

  /** 自定义背景色：写入 bgColor 并切到 custom 模式 */
  onTapBgColor(e) {
    const next = app.updatePrefs({
      bgColor: e.currentTarget.dataset.value,
      colorScheme: 'custom'
    })
    this.setData({ prefs: next })
  },

  /** 自定义文字色：写入 textColor 并切到 custom 模式 */
  onTapTextColor(e) {
    const next = app.updatePrefs({
      textColor: e.currentTarget.dataset.value,
      colorScheme: 'custom'
    })
    this.setData({ prefs: next })
  },

  /** 字体族 */
  onTapFontFamily(e) {
    const next = app.updatePrefs({ fontFamily: e.currentTarget.dataset.value })
    this.setData({ prefs: next })
  },

  /* 注：「角色高亮方式（名字 / 名字+台词）」这个二选一设置已整体下线
     （2026-10-27，只剩「仅名字高亮」一种方式），本页与编辑页都不再提供入口；
     高亮的开与关走 prefs.roleHighlight，三处入口共用同一个开关。 */

  onTapLineHeight(e) {
    this._set({ lineHeight: Number(e.currentTarget.dataset.value) })
  },

  onTapLetterSpacing(e) {
    this._set({ letterSpacing: Number(e.currentTarget.dataset.value) })
  },

  onTapCountdown(e) {
    this._set({ countdown: Number(e.currentTarget.dataset.value) })
  },

  onTapOrientation(e) {
    this._set({ orientation: e.currentTarget.dataset.value })
  },

  onTapScrollMode(e) {
    const v = e.currentTarget.dataset.value
    // 统一口径：scrollStyle 为唯一真值（smooth/voice），scrollMode 仅作兼容读。
    // 旧逻辑只写 scrollMode，而提词台 _loadScript 取 scrollStyle 优先，
    // 导致从设置切「声控跟读」进提词台仍是匀速。这里一并写 scrollStyle，确保 100% 生效。
    this._set({
      scrollMode: v,
      scrollStyle: v === 'voice' ? 'voice' : 'smooth'
    })
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key
    const cur = this.data.prefs || {}
    // 智能功能相关开关（总闸 smartOff / 角色高亮 roleHighlight）走 smartPatch 联动：
    // 开总闸会一并关掉高亮并存快照，关总闸则恢复快照。
    // 抽到 engine/prefs.js 是为了让本页与编辑页两处入口状态永远一致。
    const linked = prefsEngine.smartPatch(cur, key, !cur[key])
    this._set(linked || (() => {
      const patch = {}
      patch[key] = !cur[key]
      return patch
    })())
  },

  /**
   * 重新查看新手引导。
   * 引导是「只看一次」的（看过后写 baoge_guide_tp / baoge_guide_edit 标记），
   * 一旦关掉就再也调不出来 —— 忘了怎么用只能翻帮助。这里把两个标记清掉，
   * 下次进入编辑页 / 提词页就会重新显示，等于把引导变成「可随时回看」。
   * 不动任何显示文案与关闭逻辑，只是把「已看过」状态重置回首次。
   */
  onTapReplayGuide() {
    try {
      wx.removeStorageSync('baoge_guide_tp')
      wx.removeStorageSync('baoge_guide_edit')
    } catch (e) {}
    util.toast('下次进入编辑页 / 提词页会重新显示引导')
  },

  onTapReset() {
    wx.showModal({
      title: '恢复默认设置',
      content: '所有显示参数将回到默认值，台本内容不受影响。',
      confirmText: '恢复',
      success: (r) => {
        if (!r.confirm) return
        const next = prefsEngine.reset()
        app.globalData.prefs = next
        this.setData({ prefs: next })
        util.toast('已恢复默认')
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '宝哥提词器 - 免费、台本不限条数、支持角色多色高亮',
      path: '/pages/index/index'
    }
  }
})
