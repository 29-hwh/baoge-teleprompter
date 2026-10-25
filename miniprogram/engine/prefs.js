/**
 * 偏好中心：显示参数、滚动参数、角色高亮等
 * v1.0 全部存本地 Storage，游客模式下也能用
 */

const KEY = 'prefs_v1'

/**
 * 默认偏好。改这里等于改产品默认值。
 * 默认值按「短视频口播博主 + 提词板场景」调优，见架构文档 8.5
 */
const DEFAULTS = {
  fontSize: 3, // 1-5 档，对应下面的 FONT_LEVELS
  lineHeight: 1.8, // 行高倍数
  letterSpacing: 2, // 字间距 px
  // 滚动速度档位（40–400，见 SPEED_MIN/MAX；**不是**「字/分钟」，
  // 实际滚动速度由 pxPerSecondOf 换算：px/s = speed × 0.6）。
  // 默认 50（≈30px/s，@行高 60px 约 2 秒一行）—— 2026-09-29 由 200 改为 50：
  // 提词场景「先慢后快」更好念，默认给偏慢的档位，用户可在提词台滑块 / 设置页随时调。
  // 50 同时是 SPEED_PRESETS 里的「极慢」档 —— 默认值与预设按钮对得上，
  // 用户点「慢速 110」不再出现「比默认还快」的矛盾（defaults_check.js 会钉住这层关系）。
  speed: 50,
  colorScheme: 'white-on-black', // white-on-black | yellow-on-gray | black-on-white | custom
  // 自定义配色：colorScheme==='custom' 时优先使用下面两个字段，否则回落到 COLOR_SCHEMES
  bgColor: null, // 自定义背景色（hex），null 表示跟随 colorScheme
  textColor: null, // 自定义文字色（hex），null 表示跟随 colorScheme
  fontFamily: 'system', // system | kaiti | heiti | song，见 FONT_FAMILIES
  orientation: 'landscape', // landscape | portrait | auto
  scrollMode: 'auto', // auto 匀速自动滚动 | voice 声控跟读（保留字段，兼容老版本）
  // 滚动方式（两种，可在提词台菜单里一键切换）：
  //   smooth = 匀速自动滚动（默认）：像小说/字幕机一样连续匀速上滚，无缝无限循环
  //   voice  = 声控跟读：检测到说话才滚，停下就不滚（零成本本地 VAD）
  scrollStyle: 'smooth',
  mirror: false, // 镜像翻转，分光镜场景开启
  showGuide: true, // 视线参考线
  keepScreenOn: true, // 屏幕常亮
  roleHighlight: true, // 角色多色高亮
  // full=名字+台词整行高亮；name=仅名字高亮，台词用默认色。
  // 默认 'name'（2026-09-29 由 'full' 改）：整行染色会让满屏都是颜色、反而看不清谁在说，
  // 只给名字上色既能区分角色又保持台词可读。用户可在提词台菜单 / 编辑页随时切回 'full'。
  roleHighlightMode: 'name',
  voiceControl: false, // 声控跟读
  // 智能分段已下线：实测对提词阅读没有可感知收益，反而把用户原本的换行打乱。
  // 保留字段仅为兼容老版本的本地存储，代码里不再读取。
  smartSegment: false,
  countdown: 3, // 开场倒计时秒数，0 表示不倒计时
  fillLight: false, // 画面补光灯
  /**
   * 一键关闭智能功能（兜底开关，全局生效）。
   * 开启后：角色过滤、角色高亮等一切智能处理全部停用，
   * 台词按原文 100% 完整显示，绝不因角色识别/过滤漏掉任何一行。
   * 默认关闭（保留智能能力）。用户在编辑页「角色显示选择」区内可切换。
   */
  smartOff: false,
  /**
   * 打开总闸之前的高亮配置快照（{ roleHighlight, roleHighlightMode }）。
   * 关闭总闸时据此把高亮恢复成开闸之前的样子；null = 当前没有待恢复的快照。
   * 只由 smartPatch() 维护，其他代码不要直接读写。
   */
  smartOffSaved: null,
  // 无缝无限滚动（循环播放）：匀速滚动到文末后无缝接回开头继续滚，
  // 渲染层对行号取模拼接，观众看不出循环点。
  // 默认【关闭】：提词稿是一次性念完的，念到末行就该停住。默认无限循环会让
  // 「已读完」的信号消失、末尾台词反复出现，反而干扰判断是否念完了。
  // 需要的用户在设置页开关 / 提词台菜单「循环」按钮里自行打开。
  loop: false,
  charsPerLine: 26, // 横屏每行字数，竖屏会自动减半
  // 左右留白 px（文字与屏幕左右边缘的间距）。竖屏屏幕窄，40px 会留下过宽的黑边，
  // 实测 24px 更贴边又不挤；用户可在「设置-外观-左右留白」滑块里 0~80 自由调。
  marginHorizontal: 24
}

/** 字号档位（px），对应 fontSize 1-5 */
const FONT_LEVELS = [22, 28, 34, 42, 52]

/**
 * 滚动速度区间。speed 不是「字/分钟」，而是滚动档位（见 pxPerSecondOf）。
 * 上限 400（约 4 行/秒 @ 行高 60px）：过高的飞滚在手机屏上字幕会糊成一片、看不清，
 * 400 已能覆盖「快节奏口播」需求，再快反而影响可读性，故回落到 400。
 */
const SPEED_MIN = 40
const SPEED_MAX = 400
const SPEED_STEP = 20

/** 配色方案：背景、默认文字色 */
const COLOR_SCHEMES = {
  'white-on-black': { bg: '#000000', text: '#FFFFFF', name: '黑底白字' },
  'yellow-on-gray': { bg: '#2B2B2B', text: '#FFD166', name: '深灰底黄字' },
  'black-on-white': { bg: '#FFFFFF', text: '#1C1C1E', name: '白底黑字' }
}

/**
 * 两种滚动方式（提词台菜单可切换）
 * smooth：匀速自动滚动（默认）——连续匀速上滚 + 无缝无限循环
 * voice ：声控跟读——本地 VAD 检测，说话才滚，停下即停
 */
const SCROLL_STYLES = [
  { key: 'smooth', label: '匀速' },
  { key: 'voice', label: '声控' }
]

/**
 * 滚动速度预设档位（speed 档位值，**非**「字/分钟」；实际 px/s = speed × 0.6）。
 * 数组顺序 = 设置页按钮的展示顺序（.seg 为 flex-wrap，从左到右、从上到下），
 * 必须保持 value 升序，否则界面上的快慢顺序会与实际相反。
 *
 * 【极慢 = 50】（2026-09-29 新增）
 *   取值  ：50，与 DEFAULTS.speed 相同 —— 它就是默认档。
 *   排序  ：数组首位（value 最小），位于原最慢档「慢速 110」之下。
 *   合法性：SPEED_MIN(40) ≤ 50 ≤ SPEED_MAX(400)，滑块与 ±20 步进都能到达。
 *   为什么：原默认 50 在预设里没有对应按钮，用户点最慢的「慢速 110」反而比默认快，
 *          档位与默认值自相矛盾。补上这一档后默认值有了名字，也给了「再慢一点」的出口。
 *
 * ⚠️ 本次**只新增选项**，既没改 DEFAULTS.speed，也没有任何数据迁移：
 * load() 是 Object.assign({}, DEFAULTS, saved)，已保存的偏好永远优先于默认值，
 * 所以老用户升级后仍是自己原来那一档（200 / 140 / 110 …），不会被自动改成「极慢」。
 * 谁要是想「顺手把老用户也迁过去」——不要做，那是本次需求明令禁止的。
 */
const SPEED_PRESETS = [
  { label: '极慢', value: 50 },
  { label: '慢速', value: 110 },
  { label: '稳重', value: 140 },
  { label: '标准', value: 200 },
  { label: '快节奏', value: 240 }
]

/**
 * 一键主题（外观预设）：三个常用搭配，点一下即套用背景+文字色。
 * 与 COLOR_SCHEMES 的三个内置方案一致，作为「常用预设」单独暴露给设置页。
 */
const PRESET_THEMES = [
  { key: 'white-on-black', name: '经典黑底白字', bg: '#000000', text: '#FFFFFF' },
  { key: 'yellow-on-gray', name: '护眼灰底黄字', bg: '#2B2B2B', text: '#FFD166' },
  { key: 'black-on-white', name: '白底黑字', bg: '#FFFFFF', text: '#1C1C1E' }
]

/**
 * 字体族：iOS 自带字体，离线可用，无需网络字体文件。
 * system=系统默认(PingFang SC)；kaiti=楷体；heiti=黑体；song=宋体。
 */
const FONT_FAMILIES = {
  system: { label: '系统默认', css: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif" },
  kaiti: { label: '楷体', css: "'Kaiti SC', STKaiti, KaiTi, '楷体', serif" },
  heiti: { label: '黑体', css: "'Heiti SC', '黑体', 'PingFang SC', sans-serif" },
  song: { label: '宋体', css: "'Songti SC', STSong, SimSun, '宋体', serif" }
}

/** 字体族选择顺序（用于设置页遍历） */
const FONT_FAMILY_KEYS = ['system', 'kaiti', 'heiti', 'song']

/**
 * 历史存储搬家：老版本可能存过已下架的滚动方式 page（逐段推进）。
 * 这里在读取侧统一归一化成 smooth/auto，避免用户卡在一个不再存在的选项上。
 * @param {Object} p 已与 DEFAULTS 合并的偏好
 * @returns {Object} 归一化后的偏好
 */
function normalize(p) {
  if (p.scrollStyle === 'page') p.scrollStyle = 'smooth'
  if (p.scrollMode === 'page') p.scrollMode = 'auto'
  /*
   * 不变式：智能总闸开着 ⇒ 角色高亮必须是关的（否则两个开关状态自相矛盾）。
   * 读写两侧都走这里（patch() 保存前也会再归一化一次），所以无论从哪个入口写
   * smartOff，界面上的总闸与高亮都不会打架。
   * 用户的高亮设置不会丢：关掉高亮之前先把原值存进 smartOffSaved，
   * 总闸一关就按快照恢复回去（含绕过 smartPatch 的写入）。
   */
  if (p.smartOff) {
    if (p.roleHighlight !== false) {
      p.smartOffSaved = p.smartOffSaved || {
        roleHighlight: true,
        roleHighlightMode: p.roleHighlightMode === 'name' ? 'name' : 'full'
      }
      p.roleHighlight = false
    }
  } else if (p.smartOffSaved) {
    p.roleHighlight = p.smartOffSaved.roleHighlight !== false
    p.roleHighlightMode = p.smartOffSaved.roleHighlightMode === 'name' ? 'name' : 'full'
    p.smartOffSaved = null
  }
  return p
}

/**
 * 智能功能开关的联动补丁。编辑页「角色显示选择」与设置页「高亮与辅助」
 * 两处入口共用这一份逻辑，保证两边开关状态永远一致。
 *
 * 规则：
 *  1) 打开总闸 smartOff  → 顺手把角色高亮一并关掉（总闸的语义就是「别再智能处理」），
 *     并把开闸前的高亮配置存进 smartOffSaved。
 *  2) 关闭总闸 → 按快照把高亮配置恢复成开闸之前的样子。
 *  3) 总闸开着时用户手动打开角色高亮 → 说明他要恢复智能功能，于是自动关掉总闸，
 *     绝不出现「总闸开 + 高亮开」这种矛盾组合。
 *
 * @param {Object} cur 当前偏好
 * @param {string} key 'smartOff' | 'roleHighlight'
 * @param {boolean} on 目标状态
 * @returns {Object|null} 给 patch()/updatePrefs() 用的补丁；key 不相关时返回 null
 */
function smartPatch(cur, key, on) {
  const p = cur || {}
  if (key === 'smartOff') {
    if (on) {
      // 已经开着就沿用旧快照，别把「开闸前的高亮状态」覆盖成已关闭
      const saved = p.smartOff ? p.smartOffSaved : {
        roleHighlight: p.roleHighlight !== false,
        roleHighlightMode: p.roleHighlightMode === 'name' ? 'name' : 'full'
      }
      return { smartOff: true, roleHighlight: false, smartOffSaved: saved }
    }
    const s = p.smartOffSaved
    return {
      smartOff: false,
      roleHighlight: s ? s.roleHighlight !== false : true,
      roleHighlightMode: s && s.roleHighlightMode === 'name' ? 'name' : 'full',
      smartOffSaved: null
    }
  }
  if (key === 'roleHighlight') {
    if (on && p.smartOff) {
      const off = smartPatch(p, 'smartOff', false)
      off.roleHighlight = true
      return off
    }
    return { roleHighlight: !!on }
  }
  return null
}

/**
 * 读取偏好。
 *
 * ⚠️ 不变式（勿改）：`Object.assign({}, DEFAULTS, saved)` —— **saved 在后、覆盖在前**。
 * 这一行决定了「默认值改了，老用户也不受影响」：
 *   - 老用户：storage 里有存档 ⇒ 用他自己的档位，DEFAULTS 只是补齐他没存过的字段；
 *   - 新用户：没有存档 ⇒ 完整落到 DEFAULTS（speed 50 = 「极慢」档）。
 * 因此**不需要、也不允许**为新增档位写任何数据迁移 —— 写了反而会把老用户
 * 已经调好的速度改成新档，那是本次需求明令禁止的行为。
 */
function load() {
  try {
    const saved = wx.getStorageSync(KEY)
    if (saved && typeof saved === 'object') {
      return normalize(Object.assign({}, DEFAULTS, saved))
    }
  } catch (e) {
    console.error('[prefs] 读取失败，回落到默认值', e)
  }
  return Object.assign({}, DEFAULTS)
}

/**
 * 合并局部偏好并持久化
 * @param {Object} patch
 * @returns {Object} 合并后的完整偏好
 */
function patch(patchObj) {
  // 保存前再归一化一次：即使有人直接写 smartOff（绕过 smartPatch），
  // 落盘的也会是「总闸与高亮状态一致」的结果。
  const next = normalize(Object.assign({}, load(), patchObj))
  try {
    wx.setStorageSync(KEY, next)
  } catch (e) {
    console.error('[prefs] 写入失败', e)
  }
  return next
}

function reset() {
  try {
    wx.setStorageSync(KEY, Object.assign({}, DEFAULTS))
  } catch (e) {
    console.error('[prefs] 重置失败', e)
  }
  return Object.assign({}, DEFAULTS)
}

/**
 * 取当前配色方案对象
 */
function scheme(prefs) {
  return COLOR_SCHEMES[prefs.colorScheme] || COLOR_SCHEMES['white-on-black']
}

/**
 * 字号档位转 px
 */
function fontSizePx(level) {
  const i = Math.max(1, Math.min(FONT_LEVELS.length, level || 3))
  return FONT_LEVELS[i - 1]
}

/**
 * 判断一个颜色是否为「深色背景」（用于决定角色高亮色板与默认文字对比）。
 * 用 sRGB 相对亮度近似：亮度 < 0.5 视为深色。
 * @param {string} hex 形如 #RGB / #RRGGBB
 * @returns {boolean}
 */
function isDarkColor(hex) {
  if (!hex || typeof hex !== 'string') return true
  const m = hex.replace('#', '')
  let r, g, b
  if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16)
    g = parseInt(m[1] + m[1], 16)
    b = parseInt(m[2] + m[2], 16)
  } else if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16)
    g = parseInt(m.slice(2, 4), 16)
    b = parseInt(m.slice(4, 6), 16)
  } else {
    return true
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return true
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum < 0.5
}

/**
 * 计算实际生效的背景色与文字色。
 * 自定义模式（colorScheme==='custom' 且两个色都给了）优先；否则回落到内置方案。
 * @param {Object} prefs
 * @returns {{bg:string, text:string, isDark:boolean}}
 */
function effectiveColors(prefs) {
  const p = prefs || {}
  let bg, text
  if (p.colorScheme === 'custom' && p.bgColor && p.textColor) {
    bg = p.bgColor
    text = p.textColor
  } else {
    const s = scheme(p)
    bg = s.bg
    text = s.text
  }
  return { bg: bg, text: text, isDark: isDarkColor(bg) }
}

/**
 * 取字体族对应的 CSS font-family 字符串。
 * @param {string} key FONT_FAMILIES 的 key
 * @returns {string}
 */
function fontFamilyCss(key) {
  const f = FONT_FAMILIES[key]
  return (f && f.css) || FONT_FAMILIES.system.css
}

module.exports = {
  DEFAULTS,
  FONT_LEVELS,
  SPEED_MIN,
  SPEED_MAX,
  SPEED_STEP,
  COLOR_SCHEMES,
  PRESET_THEMES,
  FONT_FAMILIES,
  FONT_FAMILY_KEYS,
  SPEED_PRESETS,
  SCROLL_STYLES,
  smartPatch,
  load,
  patch,
  reset,
  scheme,
  fontSizePx,
  isDarkColor,
  effectiveColors,
  fontFamilyCss
}
