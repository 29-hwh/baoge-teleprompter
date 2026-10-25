const prefs = require('./engine/prefs.js')

App({
  globalData: {
    // 页面间传递台本对象（可能很大），不走 url 参数
    currentScript: null,
    prefs: null
  },

  onLaunch() {
    this.globalData.prefs = prefs.load()
  },

  onShow() {
    // 从后台回到前台时刷新偏好，避免设置页改动未生效
    if (!this.globalData.prefs) {
      this.globalData.prefs = prefs.load()
    }
  },

  onHide() {},

  onError(msg) {
    console.error('[宝哥提词器] 全局错误:', msg)
  },

  /**
   * 统一更新偏好：合并补丁、写本地存储、同步内存
   * @param {Object} patch 局部偏好
   * @returns {Object} 合并后的完整偏好
   */
  updatePrefs(patch) {
    this.globalData.prefs = prefs.patch(patch)
    return this.globalData.prefs
  }
})
