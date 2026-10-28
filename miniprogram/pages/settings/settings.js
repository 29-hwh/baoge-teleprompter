/**
 * 设置页（2026-10-28 去重后）
 * ============================================================================
 * 本页**不再持有任何设置项**，只做两件事：
 *   1. 告诉用户「字号/速度/配色/行距/…」都已经在提词页 ☰ 菜单里；
 *   2. 提供直达最近一篇台本提词页（并自动展开菜单）的入口。
 *
 * 为什么必须删：两页原本各改一套存档 —— 本页写 prefs_v1，提词页菜单写
 * tp_settings_v1，同一件事两个真源。用户在设置页改完字号，提词页纹丝不动，
 * 比"没有这个入口"更伤。现在唯一真源是 tp_settings_v1（菜单页）。
 * 仍然保留在 prefs_v1 的「智能总闸 / 角色高亮」由菜单页读写同一份 prefs，不存在双份。
 */
const store = require('../../engine/store.js')
const util = require('../../utils/util.js')

/** 「去哪改」静态指引：只读文案，不是控件，避免又长成第二个开关面板 */
const GROUPS = [
  { title: '速度 / 字号 / 行距 / 字距', where: '菜单 · 第一排' },
  { title: '对齐 / 台词区宽度', where: '菜单 · 第二排' },
  { title: '加粗 / 字体 / 配色', where: '菜单 · 三四排' },
  { title: '指示线 / 镜像 / 循环 / 聚焦', where: '菜单 · 中段' },
  { title: '倒计时 / 声控 / 智能总闸 / 常亮', where: '菜单 · 后段' },
  { title: '横竖屏切换', where: '菜单 · 顶部' }
]

Page({
  data: {
    version: '',
    total: 0,
    groups: GROUPS
  },

  onLoad() {
    this.setData({ version: this._version() })
  },

  onShow() {
    let total = 0
    try {
      total = store.list().length
    } catch (e) {
      total = 0
    }
    this.setData({ total: total })
  },

  _version() {
    try {
      const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
      const v = info && info.miniProgram && info.miniProgram.version
      return v || '开发版'
    } catch (e) {
      return '开发版'
    }
  },

  /**
   * 直接打开最近一篇台本的提词页并展开菜单。
   * 没有台本时不硬跳（提词页会 toast「台本不存在」再退回来，体验更差），
   * 直接提示去首页新建。
   */
  onTapOpenMenu() {
    let list = []
    try {
      list = util.sortByEpisode(store.list())
    } catch (e) {
      list = []
    }
    if (!list.length) {
      util.toast('还没有台本，先回首页新建一篇')
      return
    }
    const id = list[0].id
    wx.navigateTo({
      url: '/pages/teleprompter/teleprompter?id=' + id + '&menu=1',
      fail: () => util.toast('打开失败，请回首页点台本进入')
    })
  }
})
