const app = getApp()
const store = require('../../engine/store.js')
const parser = require('../../engine/parser.js')
const roleEngine = require('../../engine/role.js')
const prefsEngine = require('../../engine/prefs.js')
const util = require('../../utils/util.js')

Page({
  data: {
    id: '',
    isNew: true,
    title: '',
    content: '',
    stats: { chars: 0, sentences: 0, sections: 0, roleCount: 0 },
    roles: [],
    manualRoles: [],
    roleBlacklist: [],
    roleAlias: {},
    aliasRules: [],
    autoAliasRules: [],
    roleColorOverride: {},
    // 角色显示选择：null = 显示全文（默认，不选中任何角色）；数组 = 仅显示数组内角色。存角色标准名数组
    roleDisplayNames: null,
    // 角色显示选择的可视列表（roles 每项叠加 selected 标记），供 wxml 直接绑定布尔，避免 class 插值里写 indexOf 方法调用
    roleDisplayItems: [],
    // 角色显示选择 UI 状态：显示全文按钮高亮 / 全选切换键是否处于「已全选」态
    showFullText: true,
    allRoleSelected: false,
    // 角色显示选择是次级入口：默认折叠，避免与主线编辑流程抢注意力（弱化视觉权重与层级）
    rolePanelOpen: false,
    // 折叠态也能一眼看出当前状态：「全文」或「仅 N 个角色」
    roleDisplaySummary: '全文',
    // 一键关闭智能功能（全局 prefs）：开启后提词页停用角色过滤与高亮，台词 100% 完整显示
    smartOff: false,
    // 角色高亮与高亮方式：与设置页同源（prefs.roleHighlight / roleHighlightMode）。
    // 「名字高亮 / 名字+台词高亮」原先只在显示设置里，现已移到本页的角色显示选择面板内。
    roleHighlight: true,
    highlightMode: 'name', // 与 prefs.DEFAULTS.roleHighlightMode 保持一致
    roleModeOptions: [
      { label: '名字高亮', value: 'name' },
      { label: '名字+台词高亮', value: 'full' }
    ],
    roleTooMany: false,
    minutesText: '',
    editGuideVisible: false,
    // 退出确认弹窗
    exitModalVisible: false,
    // 自定义导航栏的状态栏高度（刘海屏适配）
    statusBarHeight: 20,
    // 导航栏总高度 px = 状态栏 + 标题行(88rpx)。.page 顶部留白必须精确等于它，
    // 否则在较宽机型上 88rpx>44px，首张卡片（标题输入框）会被导航栏压住一部分（标题栏被遮挡）。
    navHeight: 64,
    // 导航栏标题：展示当前台本的标题（新建时为「新建台本」），随标题输入实时同步。
    // 由 CSS 约束宽度并允许折行，确保不同屏宽下都完整显示、不与返回键重叠。
    navTitle: '新建台本'
  },

  /** 同步导航栏标题：有标题则显示标题，新建且未命名时回落「新建台本」 */
  _syncNavTitle() {
    const t = (this.data.title || '').trim()
    this.setData({ navTitle: t || (this.data.isNew ? '新建台本' : '编辑台本') })
  },

  onLoad(options) {
    // 自定义导航栏需要自己预留状态栏高度；并据屏幕宽度算出导航栏真实总高，
    // 让正文留出精确间距，避免标题栏被导航栏遮挡。
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const sb = (win && win.statusBarHeight) || 20
      const ww = (win && win.windowWidth) || 375
      /*
       * 标题行固定 88rpx；rpx 换算：88 * 屏宽 / 750。
       * 这里必须「精确等于」导航栏真实高度：多了会在导航栏与首张卡片间留下空隙，
       * 少了则首张卡片（标题输入框）会被固定导航栏压住。
       * 不再额外 +2 缓冲：导航栏标题已限制为最多 2 行 × line-height 40rpx = 80rpx，
       * 恒小于标题行的 88rpx，导航栏高度恒定，不会因标题换行而撑高遮挡内容。
       */
      const navH = Math.round(sb + (88 * ww) / 750)
      this.setData({ statusBarHeight: sb, navHeight: navH })
    } catch (e) {}
    // 智能开关与高亮状态存于全局 prefs（提词页读同一份），进页时同步到本地 data 供开关显示
    try {
      this._syncSmartAndHighlight(app.globalData.prefs || prefsEngine.load())
    } catch (e) {}
    if (options.id) {
      const s = store.get(options.id)
      if (s) {
        this.setData({
          id: s.id,
          isNew: false,
          title: s.title,
          content: s.content || '',
          manualRoles: s.manualRoles || [],
          roleBlacklist: s.roleBlacklist || [],
          roleAlias: s.roleAlias || {},
          roleColorOverride: s.roleColorOverride || {},
          roleDisplayNames: Array.isArray(s.roleDisplay) ? s.roleDisplay.slice() : null,
          roles: s.roles || []
        })
        this._syncNavTitle()
        this._recalc()
        this._initGuide()
        this._markSaved()
        return
      }
    }
    // 新建：预分配 id，保存时才真正写入存储
    this.setData({ id: store.create().id, isNew: true })
    this._syncNavTitle()
    this._initGuide()
    this._markSaved()
  },

  /**
   * 记录「已保存基线」，用于判断用户是否改过内容。
   * 之后任意时刻对比当前 data 与基线，不同即视为有未保存修改。
   */
  _markSaved() {
    this._savedSnapshot = JSON.stringify({
      title: this.data.title,
      content: this.data.content,
      manualRoles: this.data.manualRoles,
      roleBlacklist: this.data.roleBlacklist,
      roleAlias: this.data.roleAlias,
      roleColorOverride: this.data.roleColorOverride,
      roleDisplayNames: this.data.roleDisplayNames
    })
  },

  /** 是否有未保存的修改 */
  _isDirty() {
    if (!this._savedSnapshot) return false
    return (
      JSON.stringify({
        title: this.data.title,
        content: this.data.content,
        manualRoles: this.data.manualRoles,
        roleBlacklist: this.data.roleBlacklist,
        roleAlias: this.data.roleAlias,
        roleColorOverride: this.data.roleColorOverride,
        roleDisplayNames: this.data.roleDisplayNames
      }) !== this._savedSnapshot
    )
  },

  /**
   * 返回按钮（自定义导航栏）。有未保存修改时弹三选一确认；
   * 没有修改直接返回。
   */
  onTapBack() {
    if (!this._isDirty()) {
      this._leave()
      return
    }
    this.setData({ exitModalVisible: true })
  },

  /** 退出确认：保存并返回 */
  onExitSave() {
    this.setData({ exitModalVisible: false })
    const s = this._save()
    if (s) {
      util.toast('已保存')
      this._leave()
    } else {
      // 内容为空保存失败：留在本页，让用户决定删掉还是继续写
      this.setData({ exitModalVisible: true })
    }
  },

  /** 退出确认：不保存，直接返回 */
  onExitDiscard() {
    this.setData({ exitModalVisible: false })
    // 标记主动放弃，跳过 onUnload 的自动保存兜底
    this._discarded = true
    this._leave()
  },

  /** 退出确认：继续编辑 */
  onExitStay() {
    this.setData({ exitModalVisible: false })
  },

  _leave() {
    this._leaving = true
    wx.navigateBack({
      fail: () => {
        // 没有上一页可退（如直接从分享卡片进入）时回首页
        wx.reLaunch({ url: '/pages/index/index' })
      }
    })
  },

  /**
   * 兜底：侧滑手势返回原生无法拦截，页面卸载时若还有未保存修改
   * 且正文非空，自动静默保存，避免内容凭空丢失。
   * （用户新建但没写正文的场景不保存，避免产生垃圾空台本。）
   */
  /** 回到本页时刷新智能开关状态：用户可能刚在设置页改过总闸或角色高亮 */
  onShow() {
    try {
      this._syncSmartAndHighlight(app.globalData.prefs || prefsEngine.load())
    } catch (e) {}
  },

  onUnload() {
    if (this._debouncedRecalc && this._debouncedRecalc.cancel) {
      this._debouncedRecalc.cancel()
    }
    if (!this._discarded && !this._leaving && this._isDirty()) {
      const content = (this.data.content || '').trim()
      if (content) {
        try {
          const existing = store.get(this.data.id)
          // 同 _save：先算 contentChanged 再覆盖，避免同引用自污染比较
          const contentChanged = !!existing && existing.content !== this.data.content
          const script = existing || store.create()
          script.id = this.data.id
          // D3：标题统一截断到 TITLE_MAX_LEN。autoName 内部已截，但用户手动改的标题
          // 没经过 autoName（且 input 的 maxlength 在某些客户端可被绕过），所以这里再做一次硬截断。
          const rawTitle = this._titleIsPlaceholder()
            ? util.autoName(this.data.content) || util.PLACEHOLDER_TITLE
            : (this.data.title || util.PLACEHOLDER_TITLE).trim()
          script.title = (rawTitle || util.PLACEHOLDER_TITLE).slice(0, util.TITLE_MAX_LEN) || util.PLACEHOLDER_TITLE
          script.content = this.data.content
          if (contentChanged) {
            script.lastPosition = 0
          }
          script.roles = this.data.roles
          script.manualRoles = this.data.manualRoles
          script.roleBlacklist = this.data.roleBlacklist
          script.roleAlias = this.data.roleAlias
          script.roleColorOverride = this.data.roleColorOverride
          // 角色显示选择：显示全文(null)不落角色数组；仅用户已勾选具体角色时落库数组
          if (this.data.roleDisplayNames && this.data.roleDisplayNames.length) {
            script.roleDisplay = this.data.roleDisplayNames.slice()
          } else {
            script.roleDisplay = null
          }
          store.save(script)
        } catch (e) {
          /* 兜底保存失败也无法再交互，尽力而为 */
        }
      }
    }
  },

  /** 首次使用编辑页引导：只看一次 */
  _initGuide() {
    try {
      this.setData({ editGuideVisible: !wx.getStorageSync('baoge_guide_edit') })
    } catch (e) {
      this.setData({ editGuideVisible: false })
    }
  },

  onCloseEditGuide() {
    try {
      wx.setStorageSync('baoge_guide_edit', 1)
    } catch (e) {}
    this.setData({ editGuideVisible: false })
  },

  /** 占位：弹窗内部点击不冒泡到遮罩（避免误关） */
  noop() {},

  onInputTitle(e) {
    this.setData({ title: e.detail.value })
    this._syncNavTitle()
  },

  /**
   * 标题输入框获得焦点：滚回页面顶部，保证标题框完整露出、不被固定顶部导航遮挡。
   * 长内容台本往下滚动后点标题编辑时，这是「标题被导航遮住、看不见改不了」的关键修复。
   */
  onTitleFocus() {
    try {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    } catch (e) {
      /* 滚动失败不影响编辑 */
    }
  },

  onInputContent(e) {
    this.setData({ content: e.detail.value })
    // 边写边自动起名：标题为空时取正文开头，用户手动改过就不再覆盖
    this._autoTitleIfNeeded()
    this._debouncedRecalc()
  },

  _debouncedRecalc: util.debounce(function () {
    this._recalc()
  }, 400),

  /**
   * 重新统计并识别角色。
   * 5 万字量级在 JS 里遍历一遍约几十毫秒，配合 400ms 防抖足够。
   */
  _recalc() {
    // 用 DEFAULTS 兜底合并，防止 app.globalData.prefs 为局部对象时缺字段；
    // 并用 effectiveColors 判定深浅背景，让角色配色跟随「自定义背景」走正确色板
    // （否则在白底/浅色自定义背景下，角色点仍用深色背景的浅色盘 → 看不见）。
    const prefs = Object.assign({}, prefsEngine.DEFAULTS, app.globalData.prefs || prefsEngine.load())
    const isDark = prefsEngine.effectiveColors(prefs).isDark
    const parsed = parser.parseScript(this.data.content, {
      charsPerLine: prefs.charsPerLine || 26,
      manualRoles: this.data.manualRoles,
      roleBlacklist: this.data.roleBlacklist,
      roleAlias: this.data.roleAlias,
      roleHighlight: prefs.roleHighlight !== false,
      isDark: isDark,
      roleColorOverride: this.data.roleColorOverride
    })
    const minutes = parser.estimateMinutes(parsed.stats.chars, prefs.speed || 50)
    const aliasRules = Object.keys(this.data.roleAlias).map((src) => ({
      src: src,
      tgt: this.data.roleAlias[src]
    }))
    // 自动归并产生的规则（王二（笑着）→ 王二）：变体已折叠，不在 roles 里，单独列出便于拆分
    const roleNames = {}
    parsed.roles.forEach((r) => {
      roleNames[r.name] = true
    })
    const autoAliasRules = []
    const aliasMap = parsed.alias || {}
    Object.keys(aliasMap).forEach((src) => {
      const tgt = aliasMap[src]
      if (!roleNames[src] && src !== tgt) autoAliasRules.push({ src: src, tgt: tgt })
    })
    // 角色显示选择随识别结果收缩：角色被隐藏/合并后，勾选集合只保留仍存在的角色名
    const liveRoleNames = parsed.roles.map((r) => r.name)
    // 角色显示选择随识别结果收缩：null/空 = 显示全文（不选中任何角色）；数组则只保留仍存在的角色名
    const base = this.data.roleDisplayNames
    let keepDisplay
    if (base == null || (Array.isArray(base) && base.length === 0)) {
      keepDisplay = null
    } else {
      keepDisplay = base.filter((n) => liveRoleNames.indexOf(n) >= 0)
      if (keepDisplay.length === 0) keepDisplay = null
    }
    this.setData({
      stats: parsed.stats,
      roles: parsed.roles,
      roleAlias: this.data.roleAlias,
      aliasRules: aliasRules,
      autoAliasRules: autoAliasRules,
      roleDisplayNames: keepDisplay,
      roleTooMany: parsed.roles.length > 8,
      minutesText: minutes > 0 ? `约 ${minutes.toFixed(1)} 分钟读完` : ''
    })
    this._syncRoleDisplayItems()
  },

  /** 手动指定角色名：正则不可能覆盖所有中文剧本格式，这是兜底手段 */
  onTapAddRole() {
    wx.showModal({
      title: '手动指定角色名',
      placeholderText: '例如：林晚',
      editable: true,
      confirmText: '添加',
      success: (r) => {
        if (!r.confirm || !r.content) return
        const name = roleEngine.normalizeName(r.content)
        if (!name) return
        if (this.data.manualRoles.indexOf(name) >= 0) {
          util.toast('已存在')
          return
        }
        this.setData({ manualRoles: this.data.manualRoles.concat([name]) })
        this._recalc()
        util.toast(`已标注「${name}」`)
      }
    })
  },

  onTapRemoveRole(e) {
    const name = e.currentTarget.dataset.name
    this.setData({
      manualRoles: this.data.manualRoles.filter((n) => n !== name)
    })
    this._recalc()
  },

  /**
   * 手动删除一个自动识别出的角色：加入黑名单，让它不再被高亮。
   * 同时若它在白名单里也一并移除。
   */
  onTapHideRole(e) {
    const name = e.currentTarget.dataset.name
    if (this.data.roleBlacklist.indexOf(name) >= 0) return
    this.setData({
      roleBlacklist: this.data.roleBlacklist.concat([name]),
      manualRoles: this.data.manualRoles.filter((n) => n !== name)
    })
    this._recalc()
    util.toast(`已隐藏「${name}」`)
  },

  /** 从黑名单恢复（把误删的角色重新显示出来） */
  onTapRestoreRole(e) {
    const name = e.currentTarget.dataset.name
    this.setData({
      roleBlacklist: this.data.roleBlacklist.filter((n) => n !== name)
    })
    this._recalc()
  },

  /**
   * 角色显示选择：勾选/取消一个角色。
   * - 显示全文(null) 或未选中任何角色时点击某角色 → 仅选中该角色（提词页只显示该角色台词 + 标题/说明）。
   * - 已选中该角色 → 取消它；取消后若无一选中 → 回到显示全文（roleDisplayNames=null）。
   * _markSaved/_isDirty 已含 roleDisplayNames，改动即进入未保存态。
   */
  onToggleRoleDisplay(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    const cur = (this.data.roleDisplayNames && this.data.roleDisplayNames.length)
      ? this.data.roleDisplayNames.slice()
      : []
    const idx = cur.indexOf(name)
    const next = idx >= 0 ? cur.filter((n) => n !== name) : cur.concat([name])
    // 取消后为空 → 回到显示全文（无角色数组）
    this.setData({ roleDisplayNames: next.length ? next : null })
    this._syncRoleDisplayItems()
  },

  /** 显示全文：默认选项。点击恢复显示全部原文（不选中任何角色）。 */
  onShowFullText() {
    this.setData({ roleDisplayNames: null })
    this._syncRoleDisplayItems()
  },

  /**
   * 合并的「全选 / 取消全选」切换键：
   * - 当前未全选 → 标签「全选」，点击选中全部角色（roleDisplayNames = 全部角色名）。
   * - 当前已全选 → 标签「取消全选」，点击清空 → 回到显示全文（null）。
   */
  onToggleAllRoleDisplay() {
    const allNames = (this.data.roles || []).map((r) => r.name)
    const sel = this.data.roleDisplayNames
    const allSelected = sel != null && sel.length === allNames.length && allNames.length > 0 &&
      allNames.every((n) => sel.indexOf(n) >= 0)
    this.setData({ roleDisplayNames: allSelected ? null : allNames.slice() })
    this._syncRoleDisplayItems()
  },

  /** 折叠/展开「角色显示选择」面板（次级入口，默认折叠以降低视觉权重） */
  onToggleRoleDisplayPanel() {
    this.setData({ rolePanelOpen: !this.data.rolePanelOpen })
  },

  /**
   * 一键关闭智能功能（漏词兜底）：开启后提词页完全停用角色过滤与角色高亮，
   * 任何情况下都完整显示全部台词。存于全局 prefs.smartOff（与设置页同源），
   * 提词页在 _parseAndLayout / _applyRoleFilter 读取；关闭则恢复原有行为。
   * 本项属全局设置，不计入台本 dirty 快照。
   */
  onToggleSmartOff() {
    const next = !this.data.smartOff
    const cur = (app.globalData && app.globalData.prefs) || prefsEngine.load()
    const p = app.updatePrefs(prefsEngine.smartPatch(cur, 'smartOff', next))
    this._syncSmartAndHighlight(p)
    util.toast(next ? '已关闭智能功能：台词将完整显示' : '已恢复智能功能')
  },

  /**
   * 一键关闭 / 重新打开角色高亮（名单与台词是否分色）。
   * 总闸开着时手动打开高亮 → 自动关掉总闸（不能出现「总闸开 + 高亮开」的矛盾状态）。
   */
  onToggleRoleHighlight() {
    const next = !this.data.roleHighlight
    const cur = (app.globalData && app.globalData.prefs) || prefsEngine.load()
    const p = app.updatePrefs(prefsEngine.smartPatch(cur, 'roleHighlight', next))
    this._syncSmartAndHighlight(p)
    util.toast(next ? '角色高亮已开' : '角色高亮已关：台词不再分色')
  },

  /** 高亮方式：只给名字上色 / 名字和台词一起上色 */
  onTapRoleMode(e) {
    const next = app.updatePrefs({ roleHighlightMode: e.currentTarget.dataset.value })
    this._syncSmartAndHighlight(next)
  },

  /**
   * 把 prefs 里的智能开关与高亮状态同步到页面 data。
   * 总闸与高亮是一个联动的整体，共用一个出口，避免只更新其中一个导致开关显示不一致。
   */
  _syncSmartAndHighlight(p) {
    const q = p || {}
    this.setData({
      smartOff: !!q.smartOff,
      roleHighlight: q.roleHighlight !== false,
      highlightMode: q.roleHighlightMode === 'name' ? 'name' : 'full'
    })
  },

  /**
   * 把「已勾选集合 roleDisplayNames」投影成可视列表 roleDisplayItems（每项带 selected 布尔）。
   * wxml 直接绑定 item.selected，不再在 class/文本插值里调用 indexOf（部分基础库对属性插值里的数组方法调用求值不稳，
   * 会导致 .on 类永不生效、视觉上「点击无反应」）。roles 变化（_recalc）后也重算，保持勾选与识别结果一致。
   * 同时投影 UI 状态：showFullText（是否显示全文态）、allRoleSelected（全选切换键是否处于「已全选」态）。
   */
  _syncRoleDisplayItems() {
    // null / 空数组 = 显示全文态：所有角色 selected=false、showFullText=true
    const sel = this.data.roleDisplayNames
    const set = {}
    if (sel) (sel || []).forEach((n) => { set[n] = true })
    const showFull = sel == null || (Array.isArray(sel) && sel.length === 0)
    const allNames = (this.data.roles || []).map((r) => r.name)
    const allSelected = sel != null && sel.length === allNames.length && allNames.length > 0 &&
      allNames.every((n) => set[n])
    // 折叠态摘要：不展开也能看出当前是「全文」还是「仅 N 个角色」（避免配置了过滤却看不见）
    const picked = Array.isArray(sel) ? sel.length : 0
    this.setData({
      roleDisplayItems: (this.data.roles || []).map((r) => ({
        name: r.name,
        count: r.count,
        selected: !!set[r.name]
      })),
      showFullText: showFull,
      allRoleSelected: allSelected,
      roleDisplaySummary: showFull || !picked ? '全文' : '仅 ' + picked + ' 个角色'
    })
  },

  /**
   * 手动合并：把某个角色合并到另一个角色（如把识别错分的两个名字合成一个）。
   * 其他角色超过 6 个时用弹窗输入目标名，否则用 action sheet 选择。
   */
  onTapMergeRole(e) {
    const src = e.currentTarget.dataset.name
    const others = this.data.roles.filter((r) => r.name !== src).map((r) => r.name)
    if (!others.length) {
      util.toast('暂无可合并的其他角色')
      return
    }
    if (others.length > 6) {
      wx.showModal({
        title: '合并到哪个角色？',
        editable: true,
        placeholderText: '输入目标角色名',
        success: (r) => {
          if (r.confirm && r.content) this._mergeRole(src, roleEngine.normalizeName(r.content))
        }
      })
      return
    }
    wx.showActionSheet({
      itemList: others,
      success: (res) => {
        this._mergeRole(src, others[res.tapIndex])
      }
    })
  },

  _mergeRole(src, tgt) {
    if (!src || !tgt || src === tgt) return
    const alias = Object.assign({}, this.data.roleAlias)
    alias[src] = tgt
    this.setData({ roleAlias: alias })
    this._recalc()
    util.toast(`已将「${src}」合并到「${tgt}」`)
  },

  /** 拆分：删除一条手动合并规则，让该角色恢复独立 */
  onTapSplitRule(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    const alias = Object.assign({}, this.data.roleAlias)
    delete alias[src]
    this.setData({ roleAlias: alias })
    this._recalc()
    util.toast(`已拆分「${src}」`)
  },

  /**
   * 拆分自动归并的变体：把「王二（笑着）」从「王二」中拆出，
   * 让它作为独立角色存在。实现方式是在手动规则里把变体指回自己（覆盖自动归并）。
   */
  onTapSplitAutoRole(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    const alias = Object.assign({}, this.data.roleAlias)
    alias[src] = src
    this.setData({ roleAlias: alias })
    this._recalc()
    util.toast(`已拆分「${src}」`)
  },

  /** 标题还是占位/空：这类标题可以随时被正文开头自动替换 */
  _titleIsPlaceholder() {
    const t = (this.data.title || '').trim()
    return !t || t === util.PLACEHOLDER_TITLE
  },

  /**
   * 标题为空时，按命名规则用正文自动命名（需求：不用手动起名）。
   * 用户一旦自己改过标题就不再自动覆盖，避免把用户起的名字冲掉。
   */
  _autoTitleIfNeeded() {
    if (!this._titleIsPlaceholder()) return
    const auto = util.autoName(this.data.content)
    if (auto) {
      this.setData({ title: auto })
      // 标题被内容自动命名后，顶部导航标题也要同步，避免仍显示「新建台本」
      this._syncNavTitle()
    }
  },

  onTapClear() {
    if (!this.data.content) return
    wx.showModal({
      title: '清空内容',
      content: '确定清空当前台本内容吗？',
      confirmText: '清空',
      confirmColor: '#FF6B6B',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ content: '' })
        this._recalc()
      }
    })
  },

  /** 保存，返回台本对象；失败返回 null */
  _save() {
    if (!this.data.content.trim()) {
      util.toast('内容不能为空')
      return null
    }
    const existing = store.get(this.data.id)
    // 注意：script 与 existing 是同一引用，必须在覆盖 content 前先算好是否变化，
    // 否则比较的永远是刚写入的新值 → lastPosition 永不重置
    const contentChanged = !!existing && existing.content !== this.data.content
    const script = existing || store.create()
    script.id = this.data.id
    // D3：标题统一截断到 TITLE_MAX_LEN（autoName 内部已截，用户输入再保一次）。
    // 兜底：到保存这一步标题还是占位，就用正文开头自动命名
    const rawTitle = this._titleIsPlaceholder()
      ? util.autoName(this.data.content) || util.PLACEHOLDER_TITLE
      : (this.data.title || util.PLACEHOLDER_TITLE).trim()
    const title = (rawTitle || util.PLACEHOLDER_TITLE).slice(0, util.TITLE_MAX_LEN) || util.PLACEHOLDER_TITLE
    script.title = title
    script.content = this.data.content
    // 内容变化后重置续播位置，避免恢复到超出新内容的偏移。
    // 进度已独立成键（P3-2），需同步清掉独立进度，否则 store.getPosition 会读到旧值。
    if (contentChanged) {
      script.lastPosition = 0
      store.updatePosition(this.data.id, 0)
    }
    script.roles = this.data.roles
    script.manualRoles = this.data.manualRoles
    script.roleBlacklist = this.data.roleBlacklist
    script.roleAlias = this.data.roleAlias
    script.roleColorOverride = this.data.roleColorOverride
    // 角色显示选择：显示全文(null)不落角色数组；仅用户已勾选具体角色时落库数组
    if (this.data.roleDisplayNames && this.data.roleDisplayNames.length) {
      script.roleDisplay = this.data.roleDisplayNames.slice()
    } else {
      script.roleDisplay = null
    }

    const r = store.save(script)
    if (!r.ok) {
      util.toast(r.msg)
      return null
    }
    this.setData({ isNew: false, title: script.title })
    this._syncNavTitle()
    this._markSaved()
    return script
  },

  onTapSave() {
    const s = this._save()
    if (s) util.toast('已保存')
  },

  onTapStart() {
    const s = this._save()
    if (!s) return
    wx.navigateTo({ url: '/pages/teleprompter/teleprompter?id=' + s.id })
  },

  onShareAppMessage() {
    return {
      title: this.data.title || '宝哥提词器',
      path: '/pages/index/index'
    }
  }
})
