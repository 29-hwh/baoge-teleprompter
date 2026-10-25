/**
 * 文档预览页
 * ---------------------------------------------------------------
 * 在执行导入之前，先让用户查看文档解析内容与分集预览，
 * 再在顶部固定操作栏选择四种导入方式之一：
 *   1) 作为一篇导入           —— 整篇整体导入，不拆分
 *   2) 智能拆分（纯文字档）   —— 原版 smartSplitScripts 逻辑，仅处理纯文本
 *   3) 智能多模态拆分（表格） —— 最新规则_v1，保留表格结构处理多模态内容
 *   4) 悟空脚本专属拆分       —— 表格稿只抽「台词」栏原样复制（归纳自人工「拆分步骤1」）
 *
 * 数据来源：首页解析完成后把结果写入 getApp().globalData.importPayload，
 * 本页仅读取并展示，落盘委托 importSave（与首页共用，单一事实来源）。
 *
 * 布局：顶部固定操作栏（不随滚动消失）+ 滚动区「分集预览在上、原文在下」。
 */
const util = require('../../utils/util.js')
const importSave = require('../../utils/importSave.js')

/** 计算「智能多模态拆分（表格）」的 segments（最新规则_v1） */
function multiSegmentsOf(p) {
  if (p.kind === 'docx') {
    return (p.result && p.result.segments) || []
  }
  // 纯文本：包成单段落块，走 splitScripts 的段落稿规则（最新规则，无表格则按标题切分）
  const res = util.splitScripts([{ type: 'paragraph', text: p.content || '' }])
  return res.segments || []
}

/**
 * 计算「悟空脚本专属拆分」的 segments。
 * 只对 docx 表格稿有意义（正文 = 台词栏逐行原样复制），
 * 纯文本稿没有「台词」列可抽 —— 返回空数组，按钮保持置灰。
 */
function wukongSegmentsOf(p) {
  if (p && p.kind === 'docx' && p.wukong) return (p.wukong.segments || [])
  return []
}

Page({
  data: {
    name: '',
    kind: '', // 'docx' | 'text'
    text: '', // 原文（预览用）
    charCount: 0,
    plainCount: 0, // 选项②：原版纯文字拆分的篇数
    multiCount: 0, // 选项③：最新多模态（表格）拆分的集数
    wukongCount: 0, // 选项④：悟空脚本专属拆分的集数
    segments: [], // 分集预览（展示最新多模态拆分结果，置顶）
    canSplit: false,
    loading: false
  },

  onLoad() {
    const app = getApp()
    const p = (app && app.globalData && app.globalData.importPayload) || null
    if (!p) {
      wx.navigateBack()
      return
    }
    const plainText = p.kind === 'docx' ? (p.plain || '') : (p.content || '')
    const plainParts = util.smartSplitScripts(plainText)
    const multiSegments = multiSegmentsOf(p)
    const wukongSegments = wukongSegmentsOf(p)
    const segs = (multiSegments || []).map((s) => ({
      name: s.name || '',
      lineCount: s.lines ? s.lines.length : 0,
      preview: (s.lines && s.lines.slice(0, 2).join('   /   ')) || ''
    }))
    this.setData({
      name: p.name || '导入的文档',
      kind: p.kind || 'text',
      text: plainText,
      charCount: plainText.length,
      plainCount: plainParts.length,
      multiCount: multiSegments.length,
      wukongCount: wukongSegments.length,
      segments: segs,
      canSplit: multiSegments.length >= 2,
      loading: false
    })
  },

  onUnload() {
    const app = getApp()
    if (app && app.globalData) app.globalData.importPayload = null
  },

  onCancel() {
    if (this.data.loading) return
    wx.navigateBack()
  },

  // ① 作为一篇导入：整篇整体导入，不拆分
  onImportSingle() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const app = getApp()
    const p = (app.globalData && app.globalData.importPayload) || {}
    const r = importSave.commitSingle(p.name, this.data.text)
    if (r.error) {
      util.toast(r.error)
      this.setData({ loading: false })
      return
    }
    wx.redirectTo({ url: '/pages/edit/edit?id=' + r.script.id })
  },

  // ② 智能拆分（纯文字档）：原版 smartSplitScripts 逻辑，仅处理纯文本
  onImportPlain() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const app = getApp()
    const p = (app.globalData && app.globalData.importPayload) || {}
    const plainText = p.kind === 'docx' ? (p.plain || '') : (p.content || '')
    const r = importSave.commitSplitOriginal(plainText)
    if (r.error && !r.count) {
      util.toast(r.error)
      this.setData({ loading: false })
      return
    }
    util.toast(r.count > 1 ? `智能拆分导入 ${r.count} 篇` : '已导入 1 篇台本')
    if (r.warn) setTimeout(() => util.toast(r.warn), 1600)
    wx.navigateBack()
  },

  // ③ 智能多模态拆分（表格）：最新规则_v1，保留表格结构处理多模态内容
  onImportMultimodal() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const app = getApp()
    const p = (app.globalData && app.globalData.importPayload) || {}
    let r
    if (p.kind === 'docx') {
      r = importSave.commitSplitFromSegments((p.result && p.result.segments) || [], p.name)
    } else {
      r = importSave.commitSplitFromSegments(multiSegmentsOf(p), p.name)
    }
    if (r.error && !r.count) {
      util.toast(r.error)
      this.setData({ loading: false })
      return
    }
    util.toast(r.count > 1 ? `多模态拆分导入 ${r.count} 集` : '已导入 1 篇台本')
    if (r.warn) setTimeout(() => util.toast(r.warn), 1600)
    wx.navigateBack()
  },

  // ④ 悟空脚本专属拆分：表格稿只抽「台词」栏、按原表格行序原样复制成每集一篇台本。
  //    与上面两种拆分共用同一解析内核（util.splitScripts 的 mode='wukong'），
  //    落盘同样走 importSave.commitSplitFromSegments（单一事实来源）。
  onImportWukong() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const app = getApp()
    const p = (app.globalData && app.globalData.importPayload) || {}
    const segments = wukongSegmentsOf(p)
    if (!segments.length) {
      util.toast('未检出脚本表（含「台词」列的表格）')
      this.setData({ loading: false })
      return
    }
    const r = importSave.commitSplitFromSegments(segments, p.name)
    if (r.error && !r.count) {
      util.toast(r.error)
      this.setData({ loading: false })
      return
    }
    util.toast(r.count > 1 ? `悟空脚本拆分导入 ${r.count} 集` : '已导入 1 篇台本')
    if (r.warn) setTimeout(() => util.toast(r.warn), 1600)
    wx.navigateBack()
  }
})
