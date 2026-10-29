const store = require('../../engine/store.js')
const parser = require('../../engine/parser.js')
const util = require('../../utils/util.js')
const config = require('../../config.js')
const importSave = require('../../utils/importSave.js')

// 文件夹展开/收起状态持久化键：收起的文件夹 id 集合，存本地，刷新后保持
const COLLAPSED_KEY = 'baoge_folder_collapsed'

Page({
  data: {
    list: [],
    empty: false,
    storageTip: '',
    // 焦点区：最近修改的一篇台本（首页「RECENT / 最近在改」卡）
    // 只做展示，不改任何存储结构；数据来自已有的 updatedAt。
    resume: null,
    // 全库字数（顶栏画像用），格式化后的文本给模板直接渲染
    totalChars: 0,
    totalCharsText: '0',
    // 分区入口：all 全部 / split 拆分台本（Word 拆分导入生成的）/ single 单篇台本
    filter: 'all',
    // totalCount = 全部台本数（不受分区影响）：顶栏概况与「全部」chip 都用它
    totalCount: 0,
    folderCount: 0,
    splitCount: 0,
    singleCount: 0,
    // 文件夹重命名弹窗
    folderRenameVisible: false,
    folderRenameId: '',
    folderRenameName: '',
    // 页脚信息（底部固定展示，单一来源见 config.js）
    version: 'v' + config.APP_VERSION,
    footerCopyright: `© ${config.COPYRIGHT_YEAR} ${config.COPYRIGHT_OWNER}`,
    footerUpdate: `更新于 ${config.BUILD_DATE}`,
    // ── 异形屏适配 ──
    // 本页是 navigationStyle:custom，页面自己从 y=0 开始画，
    // 所以必须自己躲开状态栏/刘海（顶部）与右上角微信胶囊。
    // headTop = 状态栏高度 + 46px（胶囊带 32px + 上下各 7px 呼吸），
    // 报头整体落在胶囊下方，既不钻刘海也不和「···⊙」打架。
    headTop: 92,
    // 横屏刘海机的左右安全区，交给 CSS 变量拼进内边距
    safeL: 0,
    safeR: 0
  },

  onLoad() {
    this._syncViewport()
    if (typeof wx.onWindowResize === 'function') {
      this._onWinResize = () => this._syncViewport()
      wx.onWindowResize(this._onWinResize)
    }
  },

  onUnload() {
    if (this._onWinResize && typeof wx.offWindowResize === 'function') {
      wx.offWindowResize(this._onWinResize)
    }
  },

  /**
   * 读真实窗口信息算安全区。
   * 不用 env(safe-area-inset-*)：安卓微信恒返回 0，只有 wx.getWindowInfo().safeArea 靠谱。
   */
  _syncViewport() {
    let win = {}
    try {
      win = (typeof wx.getWindowInfo === 'function' && wx.getWindowInfo()) || wx.getSystemInfoSync() || {}
    } catch (e) {
      win = {}
    }
    const statusBar = typeof win.statusBarHeight === 'number' ? win.statusBarHeight : 20
    const winW = win.windowWidth || 375
    const safe = win.safeArea || null
    const headTop = Math.round(statusBar + 46)
    const safeL = safe ? Math.max(0, Math.round(safe.left || 0)) : 0
    const safeR = safe ? Math.max(0, Math.round(winW - (safe.right || winW))) : 0
    if (this.data.headTop === headTop && this.data.safeL === safeL && this.data.safeR === safeR) return
    this.setData({ headTop: headTop, safeL: safeL, safeR: safeR })
  },

  onShow() {
    this._collapsed = new Set(wx.getStorageSync(COLLAPSED_KEY) || [])
    this._syncViewport()
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList()
    wx.stopPullDownRefresh()
  },

  /** 生成不重名的文件夹名：基础名 + 序号（同一天多次拆分导入时区分） */
  _uniqueFolderName(base) {
    const names = new Set((store.listFolders() || []).map((f) => f.name))
    if (!names.has(base)) return base
    let n = 2
    while (names.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  },

  loadList() {
    const collapsed = this._collapsed || new Set()
    const raw = store.list() // 按 updatedAt 降序
    const folders = store.listFolders() || [] // 按 createdAt 升序
    const folderIds = new Set(folders.map((f) => f.id))

    // 组块：文件夹按「组内最近活动」降序；组内台本按 createdAt 升序（保持拆分出的文档顺序）
    const groups = folders
      .map((f) => ({ folder: f, scripts: raw.filter((s) => s.folderId === f.id) }))
      .filter((g) => g.scripts.length > 0)
      .sort((a, b) => {
        const ma = Math.max.apply(null, a.scripts.map((s) => s.updatedAt || 0))
        const mb = Math.max.apply(null, b.scripts.map((s) => s.updatedAt || 0))
        return mb - ma
      })
    const singles = raw.filter((s) => !s.folderId || !folderIds.has(s.folderId))
    // 千分位：模板里不能调函数，格式化必须在 JS 侧算好（等宽数字排版才不抖）
    const fmt = (n) => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

    const cardOf = (s) => {
      const stats = parser.quickStats(s.content)
      return {
        kind: 'script',
        id: s.id,
        title: s.title,
        preview: (s.content || '').replace(/\s+/g, ' ').slice(0, 40),
        chars: stats.chars,
        charsText: fmt(stats.chars),
        roleCount: (s.roles || []).length,
        updatedText: util.fromNow(s.updatedAt)
      }
    }

    const list = []
    groups.forEach((g) => {
      const latest = Math.max.apply(null, g.scripts.map((s) => s.updatedAt || 0))
      list.push({
        kind: 'folder',
        id: 'f' + g.folder.id,
        fid: g.folder.id,
        name: g.folder.name,
        count: g.scripts.length,
        updatedText: util.fromNow(latest),
        collapsed: collapsed.has(g.folder.id)
      })
      // 文件夹收起时只保留组头，隐藏组内台本，方便快速定位
      if (!collapsed.has(g.folder.id)) {
        g.scripts
          .slice()
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
          .forEach((s) => list.push(Object.assign(cardOf(s), { inFolder: true })))
      }
    })
    // 组与组之间需要一条「分节说明」：文件夹组最后一张卡和下面的单篇卡之间
    // 原来只靠 14rpx 间距隔开，实机上会被误读成「单篇也属于上面这个文件夹」。
    if (groups.length > 0 && singles.length > 0) {
      list.push({ kind: 'section', id: 'sec-single', name: '单篇台本', count: singles.length })
    }
    singles.forEach((s) => list.push(Object.assign(cardOf(s), { inFolder: false })))

    // 分区入口：全部 / 拆分台本（文件夹里拆出来的）/ 单篇台本
    const splitParts = list.filter((i) => i.inFolder)
    const singleCards = list.filter((i) => i.kind === 'script' && !i.inFolder)
    const folderCount = list.filter((i) => i.kind === 'folder').length
    const filter = this.data.filter || 'all'
    let visible = list
    if (filter === 'split') {
      visible = list.filter((i) => i.kind === 'folder' || i.inFolder)
    } else if (filter === 'single') {
      visible = singleCards
    }

    const sizeKb = Math.round(store.estimateSize() / 1024)

    // 焦点卡：最近修改的一篇（跨文件夹、跨分区，始终指向「你上次动过的稿子」）
    const newest = raw.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
    const resume = newest ? cardOf(newest) : null

    // 全库字数：只统计台本（文件夹是虚拟分组，不占字数）
    const totalChars = list.reduce((sum, i) => sum + (i.kind === 'script' ? i.chars || 0 : 0), 0)

    this.setData({
      list: visible,
      empty: visible.length === 0,
      totalCount: raw.length,
      folderCount: folderCount,
      splitCount: splitParts.length,
      singleCount: singleCards.length,
      resume: raw.length > 0 ? resume : null,
      totalChars: totalChars,
      totalCharsText: fmt(totalChars),
      storageTip: sizeKb > 2048 ? `本地已占用约 ${sizeKb}KB，建议清理不用的台本` : ''
    })
  },

  /** 切换分区：全部 / 拆分台本 / 单篇台本 */
  onSwitchFilter(e) {
    const key = e.currentTarget.dataset.key || 'all'
    if (key === this.data.filter) return
    this.setData({ filter: key })
    this.loadList()
  },

  /**
   * 新建台本：只进编辑页，不立即落盘。
   * 用户直接返回时不留空台本，避免列表里堆一堆「未命名」。
   */
  onTapNew() {
    wx.navigateTo({ url: '/pages/edit/edit?isNew=1' })
  },

  /** 从聊天记录导入 txt / md / word 文件（合并为一个入口） */
  onTapImport() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      // 显式剔除 .doc：旧版二进制 .doc 在小程序里只能当 utf8 读，会产生不可逆乱码台本。
      // 官方路径只有 .docx + .txt/.md/.text；若用户发来 .doc，弹窗列表也不让它出现。
      extension: ['txt', 'md', 'text', 'docx'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const lower = (file.name || '').toLowerCase()
        const isDocx = /\.docx$/i.test(lower)
        // 兜底：从 .docx 后缀的发到名为 .doc 的也按 docx 走（少见，但有些客户端会丢后缀）
        const isLegacyDoc = /\.doc$/.test(lower)
        if (isLegacyDoc) {
          util.toast('不支持 .doc（老格式二进制），请另存为 .docx 后再导入')
          return
        }
        if (isDocx) {
          this._importDocx(file.path, file.name || '')
          return
        }
        wx.showLoading({ title: '读取中' })
        try {
          const fs = wx.getFileSystemManager()
          const content = fs.readFileSync(file.path, 'utf8')
          wx.hideLoading()
          // D2：拒绝空白内容（避免建出空台本并跳编辑页），同时容错「全空行/纯空白」的伪正文
          if (!content || !content.trim()) {
            util.toast('文件为空或无内容')
            return
          }
          // D1 兜底：万一用户用文件扩展名是空的非文本（如 PDF/图片），utf8 读出来会充满不可打印字符。
          // 高比例非打印字符视为二进制，拒绝导入。
          if (this._looksBinary(content)) {
            util.toast('此文件非文本格式，请导入 .txt / .md / .docx')
            return
          }
          const title = (file.name || '导入的台本').replace(/\.(txt|md|text)$/i, '')
          wx.hideLoading()
          // 长文本（含分集/空行边界，smartSplitScripts 能拆出≥2篇）与 docx 一致，
          // 先跳「文档预览页」让用户查看内容与分集预览，再决定单篇/拆分导入（P3-3：txt 与 docx 分流一致）。
          if (util.smartSplitScripts(content).length >= 2) {
            getApp().globalData.importPayload = { kind: 'text', name: title, content: content }
            wx.navigateTo({ url: '/pages/preview/preview' })
          } else {
            // D3：标题统一截断到 TITLE_MAX_LEN，避免超长后索引页/编辑页 UI 全挤乱。
            const safeTitle = (title || '').slice(0, util.TITLE_MAX_LEN) || util.PLACEHOLDER_TITLE
            const script = store.create(safeTitle, content)
            const r = store.save(script)
            if (!r.ok) {
              util.toast(r.msg)
              return
            }
            wx.navigateTo({ url: '/pages/edit/edit?id=' + script.id })
          }
        } catch (e) {
          wx.hideLoading()
          util.toast('读取失败，请确认文件编码为 UTF-8')
        }
      }
    })
  },

  /**
   * 二进制文件嗅探：D1 兜底。
   * 真实 .doc / PDF / 图片在 utf8 串入后呈现大量不可打印控制字符；
   * 可打印字符（中文 / ASCII 可见 / 空白换行）占比 < 90% 视为二进制，拒绝导入。
   * 只扫前 4KB，便宜且足够判断；扫描窗比正文被截断后看不见字符的概率要高得多。
   */
  _looksBinary(text) {
    if (!text) return false
    let printable = 0
    const len = Math.min(text.length, 4096)
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e) || c >= 0x80) printable++
    }
    return len > 0 && printable / len < 0.9
  },

  /** 解析 .docx：解压后读 word/document.xml，零第三方依赖；读完交给用户选择是否拆分 */
  _importDocx(zipPath, name) {
    wx.showLoading({ title: '解析中' })
    const fs = wx.getFileSystemManager()
    const dir = `${wx.env.USER_DATA_PATH}/docx_${Date.now()}`
    fs.unzip({
      zipFilePath: zipPath,
      targetPath: dir,
      success: () => {
        try {
          const xml = fs.readFileSync(`${dir}/word/document.xml`, 'utf8')
          // 按「拆分规则_v1」解析：保留表格结构的块数组 + splitScripts（规则A表格稿/规则B段落稿）
          const blocks = util.extractDocxBlocks(xml)
          const plain = util.blocksToText(blocks)
          const result = util.splitScripts(blocks)
          // 悟空脚本专属拆分（第四种方式）：同一份 blocks 走 mode='wukong'，
          // 与多模态共用解析内核，只在「是否清洗占位行」上分叉。
          const wukong = util.splitScripts(blocks, { mode: 'wukong' })
          wx.hideLoading()
          // 先跳「文档预览页」：让用户在执行拆分/导入前查看文档内容与分集预览
          getApp().globalData.importPayload = { kind: 'docx', name: name, plain: plain, result: result, wukong: wukong }
          wx.navigateTo({ url: '/pages/preview/preview' })
        } catch (e) {
          wx.hideLoading()
          util.toast('解析失败，请确认是 .docx 文档')
        } finally {
          try {
            fs.rmdir({ dirPath: dir, recursive: true, success: () => {}, fail: () => {} })
          } catch (e) {
            /* 清理失败不影响导入结果 */
          }
        }
      },
      fail: () => {
        wx.hideLoading()
        util.toast('解析失败，请确认是 .docx 文档')
      }
    })
  },

  // 拆分/单篇的选择已迁移到「文档预览页」(pages/preview/preview)：
  // 首页只负责解析文档、把结果放进 getApp().globalData.importPayload，再跳转预览页。
  // 下方 _save* 三个方法保留为落盘入口（委托 importSave 单一事实来源），供预览页与既有测试复用。

  /** 把「拆分规则_v1」产出的 segments 逐集落盘到同一文件夹（委托 importSave） */
  _saveSplitImportFromSegments(segments, name) {
    const r = importSave.commitSplitFromSegments(segments, name)
    if (r.error && !r.count) { util.toast(r.error); return }
    if (r.script) { // 仅 1 集：退化为单篇，跳转编辑页
      wx.navigateTo({ url: '/pages/edit/edit?id=' + r.script.id })
      return
    }
    this.loadList()
    util.toast(r.count > 1 ? `拆分导入 ${r.count} 集` : '已导入 1 篇台本')
    if (r.warn) setTimeout(() => util.toast(r.warn), 1600)
  },

  /** 保存为单篇台本并进入编辑页（委托 importSave） */
  _saveSingleImport(name, content) {
    const r = importSave.commitSingle(name, content)
    if (r.error) { util.toast(r.error); return }
    wx.navigateTo({ url: '/pages/edit/edit?id=' + r.script.id })
  },

  /**
   * 拆分导入（委托 importSave.commitSplitSmart）：
   * 先按标题/空行识别分集，识别不到自动退化为字数分批，保证长文档一定拆得开。
   */
  _saveSplitImport(mode, content) {
    const r = importSave.commitSplitSmart(content, mode)
    if (r.error && !r.count) { util.toast(r.error); return }
    if (r.script) { // 仅 1 篇：退化为单篇，跳转编辑页
      wx.navigateTo({ url: '/pages/edit/edit?id=' + r.script.id })
      return
    }
    this.loadList()
    util.toast(r.count > 1 ? `拆分导入 ${r.count} 篇` : '已导入 1 篇台本')
    if (r.warn) setTimeout(() => util.toast(r.warn), 1600)
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
  },

  /**
   * 卡片右下「提词」药丸：跳过编辑页，直接进提词台。
   * 打开提词器的真实目的多半是「马上要读了」，少一次跳转就少一次等待。
   */
  onTapPrompt(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/teleprompter/teleprompter?id=' + id })
  },

  /** 点文件夹标题：弹出重命名输入框 */
  onTapFolder(e) {
    const fid = e.currentTarget.dataset.fid
    const name = e.currentTarget.dataset.name || ''
    this.setData({ folderRenameVisible: true, folderRenameId: fid, folderRenameName: name })
  },

  /** 点文件夹箭头：展开 / 收起该文件夹内的台本列表（状态持久化到本地，刷新后保持） */
  onToggleFolder(e) {
    const fid = e.currentTarget.dataset.fid
    if (!this._collapsed) this._collapsed = new Set()
    if (this._collapsed.has(fid)) this._collapsed.delete(fid)
    else this._collapsed.add(fid)
    try {
      wx.setStorageSync(COLLAPSED_KEY, Array.from(this._collapsed))
    } catch (err) {
      /* 持久化失败不影响本次展开/收起 */
    }
    this.loadList()
  },

  onFolderNameInput(e) {
    this.setData({ folderRenameName: e.detail.value })
  },

  onFolderRenameCancel() {
    this.setData({ folderRenameVisible: false })
  },

  onFolderRenameOk() {
    const name = (this.data.folderRenameName || '').trim()
    if (!name) {
      util.toast('名字不能为空')
      return
    }
    store.renameFolder(this.data.folderRenameId, name.slice(0, 30))
    this.setData({ folderRenameVisible: false })
    this.loadList()
    util.toast('已改名')
  },

  /** 长按文件夹：删除整个文件夹（连同里面所有台本） */
  onLongPressFolder(e) {
    const fid = e.currentTarget.dataset.fid
    const name = e.currentTarget.dataset.name || ''
    const count = Number(e.currentTarget.dataset.count) || 0
    wx.showModal({
      title: '删除文件夹',
      content: `确定删除文件夹「${name}」及其中的 ${count} 篇台本吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: (r) => {
        if (!r.confirm) return
        store.removeByFolder(fid)
        store.removeFolder(fid)
        this.loadList()
        util.toast('已删除')
      }
    })
  },

  /** 长按删除单篇台本（组内删空后文件夹自动隐藏） */
  onLongPress(e) {
    const id = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title
    wx.showModal({
      title: '删除台本',
      content: `确定删除「${title}」吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: (r) => {
        if (!r.confirm) return
        store.remove(id)
        this.loadList()
        util.toast('已删除')
      }
    })
  },

  onTapSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  /** 弹窗面板内点击吸收冒泡，避免误触关闭 */
  noop() {},

  onShareAppMessage() {
    return {
      title: '宝哥提词器 - 免费、台本不限条数、支持角色多色高亮',
      path: '/pages/index/index'
    }
  }
})
