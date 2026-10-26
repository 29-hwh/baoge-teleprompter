# 宝哥提词器 · 项目上下文（压缩速查）

> 本文件是后续修改的单一事实来源，替代冗长对话记录。最后更新：2026-09-06
> 状态：v1.0 已提交微信审核（2026-09-03）。技术栈：原生小程序 + 纯本地存储，零后端、零云开发。

## 一、技术形态
- 4 个页面：`index`(我的台本) / `edit`(编辑) / `teleprompter`(提词台) / `settings`(设置)
- 7 个引擎模块（engine/）：`parser` `role` `scroll` `vad` `prefs` `store` `stats`
- 工具：`utils/util.js`（智能拆分 + docx 解析 + 命名）
- 存储：`wx.setStorageSync`，无服务器、无 `wx.cloud` 调用 → 零运行成本
- 已开启 `lazyCodeLoading: requiredComponents`（app.json）

## 二、文件地图（含关键函数，便于定位改哪）
| 文件 | 作用 | 关键入口 |
|---|---|---|
| `utils/util.js` | 智能拆分 + docx 解析 | `smartSplitScripts`(L356) `splitImportBlocks`(L296) `extractDocxText`(L131) `extractWtText`(L547) `extractDocxBlocks`(L~) `splitScripts`(L~) `autoName`(L235) `sliceByBoundaries`(L431) `buildSeriesRegex`(L445) |
| `utils/importSave.js` | 导入落盘**单一事实来源**（首页/预览页共用） | `uniqueFolderName` / `commitSingle`(返回`{script}`) / `commitSplitFromSegments`(多集建文件夹，仅1集退化`{count:1,script}`) / `commitSplitSmart`(标题/空行未识别→字数分批兜底，仅1篇返回`{script}`) / `commitSplitOriginal`(**原版 smartSplitScripts 纯文字逻辑，无兜底**) / `_savePartsAsFolder`(兼容`{title,content}`与`{name,lines}`两种 part) |
| `pages/preview/` | 文档预览页（拆分前查看全文+分集预览，单篇/拆分导入） | `onLoad`(读`globalData.importPayload`) `onCancel`(navigateBack) `onImportSingle`(commitSingle) `onImportPlain`(commitSplitOriginal) `onImportMultimodal`(commitSplitFromSegments) `onUnload`(清空payload) |
| `engine/scroll.js` | 滚动引擎（setInterval 60fps 驱动） | `ScrollEngine`(L30) `configure(lineHeight,totalHeight,viewportHeight,pxPerSecond,guideOffset)`(L71) `endOffset`/`guideOffset`(L43-46) `maxOffset` getter(L91，非循环返回 endOffset=内容高-参考线偏移；循环返回 loopHeight) `start/pause/resume`(L124-146) `_tick`(L223，非循环末行滚过参考线→onEnd) `seekProgress`(L177) `syncTo`(L197) |
| `engine/prefs.js` | 偏好中心（全局） | `DEFAULTS`(L12) `load/patch/reset`(L122-156) `effectiveColors`(L205) `FONT_LEVELS`(L53) `SCROLL_STYLES`(L77) `SPEED_PRESETS`(L91) `PRESET_THEMES`(L102) |
| `engine/parser.js` | 台词解析/断行/分段 | `parseScript`(L256) `splitSections`(L103) `splitBySpeakers`(L194) `mergeShortSegments`(L218) `estimateMinutes`(L416) |
| `engine/role.js` | 角色识别 + 8 色配色 + 按角色筛选 | `matchRole`(L106) `assignColors`(L182) `colorOf`(L196) `computeAliases`(L226) `summarize`(L163) `resolveRoleFilter`(L264) `filterLinesByRole`(L313) |
| `engine/store.js` | 台本/文件夹/进度/统计 CRUD | `list`(L59) `get`(L131) `create`(L142) `save`(L165) `remove`(L179) `createFolder`(L90) `updatePosition`(L188) `appendStat`(L222) `getStats`(L240) |
| `engine/stats.js` | 复盘统计采集 | `StatsCollector`(L16) `onStart/onTick/onEnd/onLoop` `snapshot` |
| `engine/vad.js` | 本地声控(VAD) + 隐私闸门 | `requestAuth`(L43) `VoiceController`(L81) `ensurePrivacy`(L29) → `wx.requirePrivacyAuthorize` |
| `pages/teleprompter/teleprompter.js` | 提词台总控制器（核心，1390 行） | 见第三节 |
| `pages/index/index.js` | 台本列表/新建/导入 | `onShow`(L26) `onTapNew`(L126) `onTapImport`(L131) `onTapItem`(L285) `onTapFolder`(L291) `onTapSettings`(L355) |
| `pages/edit/edit.js` | 编辑器/角色管理（导入入口已收敛到首页「导入 txt / word」，编辑页不再内嵌导入） | `onLoad`(L43) `onTapAddRole`(L292) `onTapSplitAutoRole`(L399) `onTapSave`(L616) `onTapStart`(L621) |
| `pages/settings/settings.js` | 设置 UI | `onLoad`(L45) `onTapFont`(L61) `onTapSpeedPreset`(L70) `onTapScheme`(L80) `onTapPreset`(L85) `onTapCountdown`(L132) `onTapOrientation`(L136) `onTapScrollMode`(L140) |

## 三、teleprompter.js 核心方法速查
- 生命周期：`onLoad`(L93) `onReady`(L179) `onResize`(L191) `onHide`(L232) `onShow`(L249) `onUnload`(L307)
- 加载布局：`_loadScript`(L322) `_parseAndLayout`(L404) `_relayoutKeepProgress`(L389) `_updateVisible`(L638) `_seekTo`(L688)
- 滚动控制：`_startScroll`(L546) `_startCountdown`(L517) `_clearCountdown`(L509) `_onUpdate`(L569) `_onEnd`(L591) `_onLoop`(L599) `onTapPlay`(L896) `onTapRestart`(L937)
- 交互：`onTapScreen`(L714 单击→onTapPlay / 双击→菜单) `_openControls`(L804) `_closeControls`(L827) `_scheduleAutoHide`(L862) `onToggleOrientation`(L971) `onSetRoleMode`(L987) `onTapThemePreset`(L1000) `onTapFontSize`(L1012) `onToggleMirror`(L1024) `onToggleGuide`(L1030) `onToggleLoop`(L1057)
- 进度/手势：`onSeekChanging`(L1128) `onSeekChange`(L1151) `onTouchStart`(L1170) `onTouchMove`(L1195) `onTouchEnd`(L1205)
- 声控：`onToggleVoice`(L1316) `_startVoice`(L1352)
- 切台本：`onTapPrevScript` `onTapNextScript` `_switchScript`(重入锁) `_prepareSwitch`(状态归零) `_scriptOrder`(切换/角标唯一顺序源 = util.sortByEpisode(store.list()) 按集号递增 第N集→第N+1集) `_updateScriptPos`(角标+hasPrev/hasNext 置灰态) `_loadScript(id, {fresh})`

## 四、v1.0 已落地功能（勿重复做）
- 滚动：smooth 匀速 + voice 声控；单击暂停/双击菜单/手动调位续播/段末不停
- 导入：Word(txt/md/docx) + 智能拆分（系列名 / 第N集 / 空行 / 字数兜底）
- 显示：镜像翻转✅、开场倒计时✅、角色多色高亮(name/full)✅、三套配色预设✅、语速档位✅、参考线/横竖屏/屏幕常亮/补光/无缝无限滚动/首圈开篇留空
- 隐私接口仅 2 个：`chooseMessageFile`(导入) + `RecorderManager`/麦克风(声控)；已内置 `requirePrivacyAuthorize` 闸门

## 五、四轮已修复（勿回退）
1. 竖屏末尾缺字 → `_parseAndLayout` 引入 `effVp = winH*(1-0.4-0.08)` 作视口(L455-483)
2. 手动调位误暂停 → `onTouchEnd` 去掉 `scrollMode==='auto'` 冗余判断(L1218)
3. 横屏设置键过大 → `.tp-float-settings.tp-land` 字号 22→18rpx(wxsl)
4. 智能拆分丢末句 → 与①同根（effVp 修复一并解决），拆分函数本身 0 丢失

## 六、已删除项（勿恢复）
- `pages/review/` 复盘页（第四轮删除）；`teleprompter.js` 仍保留 `stats` 采集与 `_finalizeStats` 写入（v1.1 计划恢复复盘时复用，存储每篇 ≤30 条）

## 七、1.1 筹备（详见 `1.1版本筹备建议.md`）
- P0：每篇独立滚动参数 / 长稿虚拟滚动 / setData 基线 / 升级兼容(存储迁移+基础库降级)
- P1：台词导出长图(需补【相册仅写入】隐私声明) / 提词模板 / 手势调参 / 参考线可调 / 首次引导 / 横屏控制收敛 / 声控延迟初始化 / 灰度发布
- P2：云端同步 / 蓝牙遥控 / AI 断句 / 视频对照 / 朋友圈分享 / 悬浮窗(需做独立 App)
- **边界**：小程序无法做真悬浮窗（压相机提词是 App 能力）；声控仅前台有效

## 八、测试命令（改动后跑一遍防回归）
```
cd baoge-teleprompter
node _regression_fixes_test.js   # 4 项修复回归 32/32
node _e2e_test.js                # 端到端 40/40
node bug_audit.test.js           # 健康态 0 bug
node round23.test.js             # 第 23 轮 71/71（含编辑页 navHeight 与标题断言）
node edit_title_display.test.js  # 编辑页标题完整显示 27/0
node episode_order.test.js       # 按集号取下一集/上一集纯函数 22/0
node script_switch.test.js        # 台本切换（上/下一个）42/0
node role_filter.test.js          # 按角色筛选纯函数 17/0
node role_filter_page.test.js     # 角色显示选择(编辑页配置→台词页生效) 页面集成 23/0
node edit_roledisplay.test.js      # 编辑页角色显示选择(默认显示全文/显示全文键/合并切换键/单选多选/抗recalc/持久化+静态护栏) 29/0
node docx_split.test.js            # Word 导入按「拆分规则_v1」(规则A表格稿/规则B段落稿) 20/0
node docx_split_real.test.js        # 真实样本综合(28类:表格/段落/话剧/情景喜剧/口播/分镜) 26/26
node full_module_e2e.test.js        # 全模块贯通(导入→存储→角色显示→台词页→按集切换+边界) 17/17
node role_highlight_select.test.js # 已废弃占位(SKIP)，勿运行
node docx_garble_fix.test.js       # 乱码修复回归 7/7（<w:t\b 正则避免误吞 <w:tr>/<w:tc>）
node importSave.test.js             # 落盘共享模块 13/13（commitSingle/commitSplitFromSegments/commitSplitSmart）
node preview.test.js                # 文档预览页 18/18（三选项 onImportSingle/onImportPlain/onImportMultimodal + 固定顶栏布局数据 + 无payload退出）
node index_text_import_preview.test.js # 首页 txt/md 导入分流回归 8/8（多段→预览页 / 单段→编辑页，防 _askSplitImport 悬空调用回归）
# 其余：engine_*/util_split/edit_import/folder_gap 等
```

## 九、近期 UI 改动（2026-09-06，宝哥三条需求）
1. **编辑页标题显示不全/被遮挡** — ①`edit.wxss` `.ed-nav-title` 加 `word-break:break-all;overflow-wrap:anywhere`；`.ed-nav-inner` `height`→`min-height:88rpx`。②**彻底修复（见第十一节）**：标题由 `input` 改 `textarea+auto-height` 自动换行。⚠️ 期间曾加过 `edit.js` navHeight `+2` 缓冲，**已移除**（破坏"精确覆盖导航栏"语义并使 round23 2 项转红），现 navHeight 精确 = 状态栏 + 88rpx，靠 `.ed-nav-title` 行高降到 40rpx（2 行=80rpx≤88rpx）保证不撑高遮挡。
2. **首页新建/导入移到顶部吸顶** — `index.wxml` `action-bar` 由页底移到 header 下、filter-bar 前；`index.wxss` `.action-bar` 改 `position:sticky;top:0`（滚动常驻顶部），删掉底部旧按钮块。
3. **文件夹展开/收起** — `index.js`：`COLLAPSED_KEY='baoge_folder_collapsed'`（本地存收起 id 集合，刷新保持）、`onShow` 读进 `this._collapsed`、`loadList` 收起时只渲染组头不渲染组内台本、`onToggleFolder` 切换并落库；`index.wxml` 文件夹卡加箭头 `▾/▸`（`catchtap` 不触发改名）；`index.wxss` 加 `.folder-arrow/.folder-right/.is-collapsed`。交互：点箭头=展开/收起，点卡体=改名（原），长按=删组（原）。

## 十、滚动结束判定修复（2026-09-06，宝哥需求）
- **根因**：`_onEnd`(`teleprompter.js` L591-597) 里 `setData({...showControls:true})` 会在滚完瞬间自动弹控制菜单覆盖层；且旧结束判定用 `maxOffset=totalHeight-effVp`（末行停在屏幕底部≈92% 处就收场），比「末行滚过参考线(50%)」早约 42% 屏。
- **改动1（结束判定）**：`scroll.js` `configure` 增第 5 参 `guideOffset`（参考线相对内容首行基线偏移 px）；新增 `endOffset=max(0,totalHeight-guideOffset)`；`maxOffset` getter 非循环模式返回 `endOffset`（循环模式仍返回 `loopHeight`，不变）。控制器 `_parseAndLayout` 按布局实测 `guideOffsetPx=round(winH*(0.5-0.4))` 传入（`.tp-content` padding-top:40vh → 首行基线在 40%；`.tp-guide` top:50%）。→ 结束唯一定义为「末行滚过参考线」，不再是滚到底/计时/行数索引。
- **改动2（结束行为）**：`_onEnd` 移除 `showControls:true` → 非循环滚完直接冻结当前画面（playing=false, finished=true），不弹菜单、不跳转、不重置、不清空，等用户手动操作（双击/返回/设置按钮/手势才显示菜单）。
- **兼容性**：循环（无限滚动）走 `loopHeight` 回绕，从不触发 onEnd，行为完全不变（T8 验证）。
- **测试**：`engine_scroll.test.js` 新增 T5/T7/T8（19/0）；`engine_loop_seek.test.js` 补 `guideOffset` 还原断言（12/12）。`grep showControls:true` 全仓仅 `_openControls`(手势触发) 与测试桩，无其它自动弹菜单点。

## 十一、编辑页「台本标题显示不全」彻底修复（2026-09-06）
- **根因**：标题用 `<input>`——**单行**原生组件，超出框宽即硬裁切（无省略号、不可换行）。`maxlength=30`，可用宽 = 屏宽−176rpx，375px 屏仅 **574rpx**，30 个中文字需 900rpx → 尾部直接被切掉。次因：导航栏 `.ed-nav-title` 原 32rpx/行，窄屏(320px)2 行仅约 28 字 < 30 字上限，末尾被 line-clamp 省略。
- **改动1（主）** `edit.wxml`：标题 `input` → `textarea` + `auto-height="{{true}}"` + `show-confirm-bar="{{false}}"`。数据绑定与编辑逻辑**零改动**（`value="{{title}}"` / `bindinput="onInputTitle"` / `bindfocus="onTitleFocus"` / `maxlength="30"` / `placeholder` 全保留）。
- **改动2** `edit.wxss` `.ed-title-input`：补齐完整盒模型（不再依赖全局 `.input`）——`min-height:88rpx`（空/短标题与原子输入框等高不跳动）、`max-height:264rpx`（兜底不撑爆卡片挤压下方按钮）、`word-break:break-word` + `overflow-wrap:anywhere`（中英混排/无空格长串可断行）。无 `text-overflow:ellipsis`、无 `white-space:nowrap`。
- **改动3** `edit.wxss` `.ed-nav-title`：字号 32→30rpx（窄屏每行约 15 字，2 行可容满额 30 字标题）、line-height 42→40rpx（2 行=80rpx ≤ 导航标题行 88rpx，导航栏高度恒定，不撑高、不遮挡首张卡片）。
- **改动4** `edit.js`：移除 navHeight 的 `+2` 缓冲（它破坏"精确覆盖导航栏"语义并致 round23 两断言转红）。现 navHeight 精确 = 状态栏 + 88rpx；安全性由改动3 的 80rpx≤88rpx 保证。
- **测试**：新增 `edit_title_display.test.js`（27/0）——静态校验组件为 textarea+auto-height、无省略/单行锁死、有断行与高度上下限、导航栏两行≤88rpx；数据层用 30 字中文/中英混排/无空格长英文/数字标点混排验证 title 与 navTitle 一字不丢。

## 十二、台本切换（菜单上/下一个台本）逻辑修复（2026-09-06，宝哥需求）
- **根因**：
  1. 边界无置灰：到头时按钮仍亮着，点只弹一句提示、不切换 → 假可点。
  2. 当前台本不在列表（首页删了）时 `idx<0` 直接 `return` → 按钮"可点却毫无反应"。
  3. 切换顺序用 `_scriptOrder()`（= util.sortByEpisode(store.list()) 按集号递增）与角标同源，已统一到单源（避免顺序打架）。
  4. 快速连点/重入：`_startCountdown` 未清旧定时器 → 旧 interval 引用丢失后无法 clear，多个倒计时叠加、各触发一次 `_startScroll`，表现"切换后立刻自己开跑""倒计时一次跳两格"。
  5. 状态未归零：切换后 progress/finished/续播/统计/触摸中间态未清，新台本可能带着旧态。
  6. 切换弹"继续上次进度" modal 与 title toast 叠加、连点堆多个 modal。
- **改动（teleprompter.js）**：
  - 新增 `_scriptOrder()` 单一顺序源（= util.sortByEpisode(store.list()) 按集号递增），`_updateScriptPos` 与 `_switchScript` 共用；同时算出 `hasPrevScript/hasNextScript` 置灰态。
  - 重写 `_switchScript(dir)`：重入锁 `this._switching`；空列表→提示并清置灰；单台本→提示；`idx<0` 时按方向归位到首/末再切（不再静默 return）；越界→刷新角标+提示，不切换。
  - 新增 `_prepareSwitch()`：暂停引擎+落盘旧台本进度/复盘，`clearInterval(_countdownTimer)`，`setData` 归零 progress/finished/resumePosition/countdown/播放态，`stats.reset()` + 清 _lastSection/_wrapped/触摸拖动中间态。
  - `_loadScript(id, {fresh})`：`fresh:true`（主动切换）跳过续播 modal 直接从头倒计时、并解锁 `_switching`；加载失败也解锁，避免按钮永久失效。
  - `_startCountdown` 开头 `clearInterval(this._countdownTimer)` 修定时器泄漏。
  - `onShow` 末尾补 `_updateScriptPos()`：从首页删台本返回后刷新角标/置灰态。
  - `data` 增 `hasPrevScript/hasNextScript`；`onLoad` 增 `this._switching=false`。
- **wxml/wxss**：两个按钮绑 `{{hasPrevScript?'':'is-disabled'}}`，`.tp-btn.is-disabled` 灰显 + `pointer-events:none`。
- **边界策略**：到头**禁用置灰（不循环）**——拍摄现场误触绕回第 1 集会打乱节奏；置灰外 JS 仍校验越界。
- **状态保留**：字号/行高/速度/配色/镜像/参考线/补光/横竖屏/声控/无限滚动由 `_loadScript` 从 prefs 重读，保留。
- **测试**：新增 `script_switch.test.js`（42/0），覆盖需求1-5 全部边界；`bug_audit` 切换段 0 bug、全套回归绿。

## 十三、角色显示选择（编辑页配置 → 台词页生效，2026-09-06 重构）
- **需求（2026-09-06 重新设计）**：在编辑页与「角色高亮」**同区**新增「角色显示选择」。**默认不选中任何角色＝显示完整原文（所有角色台词 + 标题/说明全显）**，并设「显示全文」键为默认选项；用户选中某角色 → 仅保留该角色台词及其对应标题/说明、隐藏其余角色台词；「全选」与「取消全选」合并为**一个可切换键**（未全选态点=全选，已全选态点=取消全选=回到显示全文）。配置存入台本；台词滚动页按配置生效；菜单内原有角色选择板块已移除。与「角色高亮」深度协同（高亮只作用于显示出的行）。两侧读同一份存储，行为一致。
- **设计（`roleDisplay` 三态语义）**：台本字段 `script.roleDisplay`（角色标准名数组）。
  - `undefined` / `null`（老台本/新建未保存/默认/点「显示全文」）＝**全部显示（显示全文态，不选中任何角色 chip）**。
  - `[]`（显式「取消全选」历史值）＝**无显示**（空画面）。
  - 非空数组（如 `['A']` / `['A','B']`）＝**仅显示数组内角色**。
  - 编辑页勾选 → 存 `roleDisplay`；台词页 `_loadScript`→`_parseAndLayout` 经 `this._roleDisplayFilter()` 读 `script.roleDisplay` → `resolveRoleFilter` → 设 `this.roleFilter` → `displayLines = filterLinesByRole(allLines, roleFilter)`。**不改动台词数据本身，仅存显示配置**。
  - 边界：`filterLinesByRole(lines, filterSet)` 中 `null`→原样返回全部、空 Set→返回 `[]`（无显示）；`_roleDisplayFilter()` 中 `[]`→`new Set()`（无显示），非空数组但全是失效名（角色被合并/删除）→回退 `null`（全显，不误清空整屏）。`onSetRoleFilter(def)` 同样：`null`=全显、`[]`=无显示、非空=仅显指定。
- **改动（engine/role.js，纯函数，沿用）**：
  - `resolveRoleFilter(input, knownRoles, aliases)`：解析名称/ID→标准名小写键集合，空/无效→null。
  - `filterLinesByRole(lines, filterSet)`：null→全显；空 Set→`[]`（无显示）；否则仅保留命中角色行。改为：**非空集合→保留「命中角色行 + 非角色行（role===null：标题、舞台提示、旁白、非台词说明）」，仅隐藏其它角色台词**（修复「选角后标题/非台词文字消失」缺陷，详见下方修复记录）。
- **改动（pages/edit/edit.js + edit.wxml + edit.wxss）**：
  - `data` 增 `roleDisplayNames`(当前勾选角色名数组，与 roles 同源，默认 null=显示全文态)、`roleDisplayItems`(预计算渲染数组，每项 `selected` 布尔)、`showFullText`(默认 true)、`allRoleSelected`(默认 false)；`onLoad` 读 `s.roleDisplay`(缺省 null→显示全文)。
  - 第3张卡片「角色高亮」区内新增「角色显示选择」子区：**「显示全文」键 `onShowFullText`**（默认高亮，点击恢复显示全部原文＝`roleDisplayNames=null`/`showFullText=true`）+ **合并切换键 `onToggleAllRoleDisplay`**（未全选→全选(选中全部)、已全选→取消全选(回到显示全文)）；列出识别到的角色（liveRoleNames）每项 ☑/☐ 勾选、`onToggleRoleDisplay` 单/多切换；取消最后一个角色→自动回到显示全文。
  - 角色集变化时 `_recalc` 用 `keepDisplay` 收缩 `roleDisplayNames`（仅留仍存在角色），避免陈旧引用；`_syncRoleDisplayItems()` 在勾选切换/显示全文/合并切换/`_recalc` 末均重算 `roleDisplayItems`。
  - 持久化：`_save`(L640) 与 `onUnload` 兜底(L201) 写 `script.roleDisplay`（null=不落库以兼容老台本全显；非空数组原样存）；`_markSaved`/`_isDirty` 纳入该字段（未保存检测不误报）。
- **改动（pages/teleprompter/teleprompter.js）**：
  - 移除菜单「按角色筛选」板块及 `onToggleRoleFilter`/`onClearRoleFilter`/`data` 三 UI 字段（菜单不再有角色选择）。
  - `_parseAndLayout`：`this.roleFilter = this._roleDisplayFilter()`（读 `this.script.roleDisplay`）；`displayLines = filterLinesByRole(allLines, roleFilter)`；`contentHeight` 用 displayLines 长度。
  - `_roleDisplayFilter()`(L1128)：读 `script.roleDisplay`→`undefined/null`→null(全显)；`[]`→`new Set()`(无显示)；非空→`resolveRoleFilter`→集合，全失效→null(回退全显，不误清空)。
  - 保留 `onSetRoleFilter(def)` 程序化入口（内部能力，可被代码/未来扩展调用）：null=全显、`[]`=无显示、非空=仅显指定，经 `_applyRoleFilter` 重排。
- **协同（与角色高亮）**：角色高亮着色作用于 `displayLines`（显示出的行）；隐藏的角色即使高亮也不显示。编辑页决定"显示谁"，高亮决定"显示的怎么着色"，两侧一致。
- **兼容性/边界**：`_relayoutKeepProgress`→`_parseAndLayout` 重读配置→字号/横竖屏切换后显示恒定一致；`_switchScript` 每篇新台本按各自 `roleDisplay` 生效（不串台本）；空配置=全显；某勾选角色不在本台本→该角色 0 行。
- **修复（点击无响应根因，2026-09-06）**：原 wxml 在 `class`/文本插值里写 `roleDisplayNames.indexOf(item.name) >= 0` 决定 `.on` 类——部分微信基础库对**属性插值里的数组方法调用求值不稳**，导致 `.on` 类永不生效、视觉上"点了不变绿=无反应"。改为预计算 `roleDisplayItems`（roles 每项叠加 `selected` 布尔），wxml 只绑定 `item.selected` 简单布尔；新增 `_syncRoleDisplayItems()`（`onToggleRoleDisplay`/`onShowFullText`/`onToggleAllRoleDisplay`/`_recalc` 末均调用）；并加 `hover-class` 点击反馈。JS 逻辑（直接调 handler）单测原本就过，故该 bug 仅真机渲染层暴露。
  - **修复（选角后标题/非台词文字消失，2026-09-06）**：原 `filterLinesByRole` 非空集分支 `lines.filter(l => l.role && filterSet.has(l.role))` **只保留命中角色行**，把 `role===null` 的标题/舞台提示/旁白/非台词说明整类过滤掉——用户选中某角色后这些文本凭空消失。改为 `lines.filter(l => !l.role || filterSet.has(l.role))`：非角色行（`role===null`）**始终保留**，仅隐藏其它角色台词。空集合（`[]`=取消全选=无显示）语义不变。回归测试 `role_filter.test.js`(18/0)、`role_filter_page.test.js`(23/0) 已锁新行为（保留标题/说明、仅隐藏其它角色）。
- **测试**：`edit_roledisplay.test.js`(29/0) 锁编辑页默认显示全文/显示全文键/合并切换键/单选多选/抗_recalc/持久化 + 静态护栏(wxml 无 indexOf 插值、无 onSelectAllRoleDisplay/onClearRoleDisplay)；`role_filter_page.test.js`(23/0) 台本级 roleDisplay 驱动（含 `[]`=无显示、失效名回退全显）；`role_filter.test.js`(18/0) 纯函数。`role_highlight_select.test.js` 已废弃占位（对应功能已回滚重构，勿运行）。

## 十四、Word 导入遵循「提词器拆分规则_v1.md」（2026-09-06，宝哥需求）
- **规则来源**：`/Users/huweihua/WorkBuddy/W o r k Bu d d y/建华小凤提词拆分测试/提词器拆分规则_v1.md`。核心两条：
  - **规则A（表格稿）**：一个表格 = 一集；表格首行是列头（镜头/画面/台词…），台词取**第 3 列**（索引 2）；集名取表格外紧邻的上一个**有效标题行**（含"系列名+数字"或纯数字编号）。
  - **规则B（段落稿）**：按"系列名 + 数字"标题行切分（如 `建华&小凤的生活 71`）；无系列名时按纯数字编号行切分；标题行以下直到下一个标题行为该集正文。
- **改动（engine/role.js 之上，util.js 新增，表格感知）**：
  - `extractDocxBlocks(xml)`：保留表格结构，返回 `blocks` 数组——`{type:'table', rows:[[cell,cell,...],...]}` 或 `{type:'paragraph', text}`。表格单元按 `<w:p>` 分段提取 `<w:t>` 文本（修复：`parseTableBlock` 原用单段 `<w:t>` 正则会吞进 `<w:tc><w:p>` 前缀，改为按段落切分再提取；`extractWtText` 辅助函数）。
  - `splitScripts(blocks)`：先检测是否有表格→走 `splitTableScript`（规则A）；否则 `splitParagraphScript`（规则B）。返回 `{segments:[{name, lines:[]}], scripts:[]}`。
    - `splitTableScript`：每个表格 = 一集；取首行外每行的第 3 列（容错：列数<3 时取末列）；集名 = 表格前最近的标题行文本（回退 `第N集`/自动名）。
    - `splitParagraphScript`：用 `SERIES_RE` 匹配"系列名+数字"标题行作为切分点；无系列名用纯数字编号；标题行归属下一集。
  - 导出：`extractDocxBlocks`、`splitScripts`（module.exports 已加）。
- **改动（pages/index/index.js 导入入口）**：
  - `_importDocx`：解压 docx 后读 `word/document.xml`，改调 `util.extractDocxBlocks(xml)` + `util.splitScripts(blocks)`（原 `extractDocxText` 只提段落、丢失表格，已弃用此路径）。
  - `_askDocxSplitImport(name, plain, result)`：弹 ActionSheet「作为一篇导入 / 按拆分规则导入（N 集）」。
  - `_saveSplitImportFromSegments(segments, name)`：多集时建文件夹（日期命名）逐集落盘 `script.folderId=folder.id`，复用现有拆分导入逻辑。
- **兼容性**：纯段落 docx（无表格）走规则B，行为等同旧 `smartSplitScripts`；旧 txt 导入不受影响（`_saveSingleImport`/`_saveSplitImport` 保留）。
- **测试**：`docx_split.test.js`(20/0) 锁规则A（表格→多集、第3列台词、集名取标题行、混合表格+段落）与规则B（系列名+数字切分、纯数字编号、无标题则单篇）；`docx_shooting_script.test.js`(14/0) 锁新「拍摄脚本表」结构（集标题在表内合并单格、多轮对白拆行、口播纯旁白保留、裸无台词跳过、meta 留存、标题不被时间段段落劫持）；含 `extractWtText` 剥离标签的单元校验。
- ⚠️ **重要更正**：本节描述的导入流程（`_askDocxSplitImport` ActionSheet + `_saveSplitImportFromSegments`）**已被第十五节「预览页」取代**。现导入不再弹 ActionSheet，而是 `index.js` 写 `globalData.importPayload` → `navigateTo` 预览页 → 预览页调用 `importSave` 落盘。请勿照本节旧 ActionSheet 逻辑实现新功能。

## 十五、文档预览页 + 乱码修复 + 回退版本（2026-09-06，宝哥三条需求）
- **1. 文件预览功能（拆分前先看全文）**：
  - 新增 `miniprogram/pages/preview/`（preview.js/wxml/wxss/json），`app.json` pages 已加 `"pages/preview/preview"`。
  - 新增 `miniprogram/utils/importSave.js`（落盘**单一事实来源**，首页与预览页共用，避免导航/测试破坏）：只负责 store 落盘、不负责导航/toast，返回 `{script}`/`{count,folderId}`/`{error}`。`commitSplitFromSegments` 仅 1 集退化返回 `{count:1, script}`；多集建文件夹逐集挂入。`commitSplitSmart` 标题/空行未识别自动退化为字数分批（size），仅 1 篇返回 `{script}`。
  - 首页 `index.js`：`_importDocx` 解析后不再调 `_askDocxSplitImport`，改为写 `getApp().globalData.importPayload={kind:'docx',name,plain,result}` + `navigateTo preview`；txt/md 导入 `util.smartSplitScripts(content).length>=2` 分支改为写 payload `{kind:'text',name:title,content}` 并跳预览页；删除 `_askSplitImport`/`_askDocxSplitImport` 两个弹窗方法；`_saveSplitImportFromSegments`/`_saveSingleImport`/`_saveSplitImport` 改为委托 importSave。
  - 预览页 `onLoad` 读 importPayload：docx 用 `result.segments` 映射分集卡片，text 用 `util.smartSplitScripts` 预览；填 `name/kind/text/charCount/segments/splitCount/canSplit`。`onUnload` 清空 payload。`onCancel`→`navigateBack`；`onImportSingle`→`commitSingle`→`redirectTo` 编辑页；`onImportSplit`→docx 走 `commitSplitFromSegments`、text 走 `commitSplitSmart`→toast+`navigateBack`（首页 `onShow` 自动 `loadList` 刷新）。
  - 测试：`preview.test.js`(11/11) 锁 onLoad/onImportSplit/onImportSingle/无 payload 退出；`importSave.test.js`(13/13) 锁 4 个落盘函数。
- **2. 回退版本（无新拆分规则）**：
  - git 分支 `backup/pre-split-rules` 指向 `e248a56`（校验一致，该提交不含 `extractDocxBlocks`）。
  - 两份文件夹快照（同父目录 `2026-09-02-10-33-02/`）：`baoge-teleprompter.pre-split-rules/`（无新拆分规则版本，`git archive e248a56 | tar -x` 导出）；`baoge-teleprompter.pre-fix/`（含规则但未修乱码版，`cp -R` 排除 .git）。
- **3. docx 拆分乱码修复（根因 100% 定位）**：
  - 根因：`util.js` `extractWtText`(≈L547) 与 `extractDocxText`(≈L140) 的正则 `/<w:t[^>]*>([\s\S]*?)<\/w:t>/g` 误匹配 `<w:tr>/<w:tc>/<w:tblPr>`（`<w:t` 是这些元素名前缀），把含 `<w:rPr>` 的排版 XML 当文本吞入 → 拆分后全乱码。
  - 修复：改为 `<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g`（`\b` 单词边界，避免误匹配 `<w:tr>/<w:tc>/<w:tblPr>`）。真实《建华9.1.docx》《建华9.1台词.docx》均验证输出干净中文（10 集、无 `<w:` 残留）；`blocksToText`（预览全文）亦干净。
  - 测试：`docx_garble_fix.test.js`(7/7) 用含 `<w:pPr>/<w:rPr>/<w:tblPr>/<w:tr>/<w:tc>` 的两列表头表格稿 XML，断言标题/台词干净中文、无 `<w:` 残留。
- **4. 全量回归**：27 套件 0 失败（`docx_garble_fix` 7/7、`importSave` 13/13、`preview` 11/11、`index_text_import_preview` 8/8 为首轮新增；`docx_split_real` 26/26 覆盖真实样本）。⚠️ 改动后跑全部 27 套件，单跑某文件易漏回归。

## 十六、导入预览页三选项改造 + 顶栏固定（2026-09-06，宝哥需求）
- **需求1：三个文档拆分选项**（原预览页只有「作为一篇导入 / 按拆分规则导入」二选一）：
  1. **作为一篇导入**：整篇整体导入，不拆分 → `importSave.commitSingle`。
  2. **智能拆分（纯文字档）**：运行**未加入新拆分规则的原版逻辑** `util.smartSplitScripts`（仅处理纯文本，无字数兜底）→ `importSave.commitSplitOriginal`（新增；与带字数兜底的 `commitSplitSmart` 区分开，后者属新规则体系）。docx 先 `blocksToText` 压平为纯文本再走原版逻辑。
  3. **智能多模态拆分（表格）**：采用**最新拆分规则_v1**（保留表格结构）→ docx 直接取 `p.result.segments`；text 包成单段落块 `[{type:'paragraph',text}]` 走 `util.splitScripts` 段落规则 → `importSave.commitSplitFromSegments`。
  - `importSave.js` 抽出 `_savePartsAsFolder`（兼容 `{title,content}` 与 `{name,lines}` 两种 part 形态），`commitSplitSmart`/`commitSplitOriginal`/`commitSplitFromSegments` 多集时共用，消除重复落盘代码。
- **需求2：预览页布局**：
  - 顶部固定操作栏（`.topbar` 作为 `.prev` 的 flex 兄弟节点、**不在 scroll-view 内**，故始终可见、不随滚动消失），含「取消 + 三个导入按钮」；拆分按钮在可拆篇数 `<2` 时 `disabled` 置灰（仅「作为一篇导入」恒可用）。
  - 滚动区顺序：**分集预览（最新多模态规则）在上 → 原文在下**（`segments` 卡片在前，`doc-text` 原文在后）。
  - 预览页 `onLoad` 同时计算 `plainCount`（原版纯文字篇数）与 `multiCount`（最新多模态集数）；分集预览展示 `multiCount` 对应的 segments。
- **测试**：`preview.test.js` 重写为 18/18（docx/text 双路径、三入口 `onImportSingle`/`onImportPlain`/`onImportMultimodal`、无 payload 退出）；`importSave.test.js` 13/13 仍锁 4 个落盘函数（含新 `commitSplitOriginal`）。全量 27 套件 0 失败。

## 十七、导入预览页「测试拆分」按钮（已撤销，2026-09-06）
- **状态**：该「测试拆分」按钮及其关联的 `util.smartSplitLines` 新台词拆分规则、`onTestSplit` 事件处理函数、`testLines`/`testCount` 状态变量、wxml 预览区块、wxss 样式（`.test-btn`/`.line-card`/`.line-speaker`）、以及 `smart_split_lines.test.js` 单元测试，**已于 2026-09-06 经宝哥要求完整移除**，无残留无效引用或死代码。预览页恢复为三选项导入（作为一篇 / 智能拆分纯文字档 / 智能多模态拆分表格）+ 固定顶栏状态。

## 十八、拍摄脚本表新规则（2026-09-14，宝哥需求）
- **触发样本**：桌面《好运袁甘哥81-90.docx》（10 表 / 229 行，81–90 集，含 85/90 两篇「口播」）。用此真实文档对「智能多模态拆分」做台本拆分功能测试，暴露出旧规则在该结构下完全失效，据此补全新规则。
- **旧规则在此文档上的失败表现**（已实测）：① 集标题被错取为表格前「【时间段：0907–0913】」段落（10 集同名）；② 台词抽成「场景：…/镜头/1/2/3」镜头号——因旧逻辑假定「首行=标题、次行=表头」，而本表真实表头在第 4 行，表头前的 3 个合并单格（集标题/人物·场景·道具/场景）被当数据。
- **新规则（已加入 `splitTableScript`，零回归）**：
  1. **全表扫描定位真实表头行**：首个含 台词/对白/内容/独白/口播/话术 列名且≥2列的行即表头；表头前的合并单格一律视为「集信息行」，**不再当数据**。
  2. **集标题**优先取集信息行里「像集标题」的单格（`isEpisodeTitleRow`：含集/期/话/卷 或 中文+数字结尾，且不含冒号与人物/场景/道具等关键词，排除 时间段/【】 分组标记）；其次才取表格前段落（已过滤分组标记）。故 81–90 全正确命名，含「（口播）」后缀。
  3. **台词列**按表头「台词」列定位（默认第3列/索引2）；无表头时按列数推断（两列取末列/三列取第3列/四列+取末列），兼容旧表。
  4. **多轮对白拆行**：一个台词单元格形如「婆婆：…儿媳妇：…」经 `splitDialogueCell` 按说话人（允许带括号动作 `婆婆（喊）：`）拆成多行，便于提词器逐句滚动；单行无冒号（口播纯旁白）原样保留。
  5. **裸「无台词/无对白」行跳过**（旧规则仅拦 `（无台词）`），导演标注不进台词。
  6. **meta 留存**：集信息行（人物·场景·道具、场景）存为 `segment.meta`，供导入预览参考，不进滚动台词、不污染落盘内容。
  7. **兜底兼容**：找不到可识别表头（无 台词 列表名）的旧表格，退回 `splitTableLegacy`（即原逻辑），保证建华/网恋等旧样本行为不变。
- **兼容性与回归**：全量 27 套件 0 失败（docx_split.test.js 20/0 旧规则锁、docx_shooting_script.test.js 14/0 新规则锁）。真实文档端到端 `splitScripts→commitSplitFromSegments`：拆 10 集、落盘 10 篇、台词总行数 203、每篇内容==该集台词拼接（零丢失/零错位）、meta 全留存。

## 十九、splitDialogueCell 多轮对白粘连修复（2026-09-18，宝哥需求）
- **触发样本**：桌面《建华&小凤的生活81-90.docx》。宝哥发现两处拆分错误：① 第84集结尾「好吧，是我想多了」被拆成两段；② 某大段（粘连）被拆两段、台词高亮后面半截失效。
- **复现**：`extractDocxBlocks`→`splitScripts` 实跑，定位到第84集 R15/R16、第85集 R9、第87集 R9 等多处「同一台词单元格内多轮对白的后一句说话人名字与前一句内容直接粘连（无标点/空格）」的单元格，被 `splitDialogueCell` 错误拆断。
- **旧规则失败根因**：`splitDialogueCell` 把「任意 1–10 中文字 + 冒号」都当说话人，content 用负向前瞻「遇到说话人模式即停」。两个缺陷叠加：① 粘连时（如「我想多了王建华：」）把「前句内容+真实说话人名字」误判成新说话人，并把前句在内容中截断（「怪不」+「得你一有空就看」），污染说话人、高亮后半截失效；② 说话人候选贪婪 `{1,10}`：在「看来是我想多了王建华：」里从「看」贪到「华」成 10 字候选，其前恰是逗号（非中文）→ 误判成有效切分点，把「好吧，」切断。
- **新规则（util.js `splitDialogueCell`，零回归）**：① 说话人候选长度 `{1,10}`→`{1,5}`：真实说话人括号外均 ≤5 字（王建华/杨凤/婆婆/李阿姨），贪婪长候选不再成立；② **左边界断言**：说话人候选前一字符必须是「非中文/非间隔号」（标点/空格/行首）才当切分点，粘连（前一字是中文）不当切分点，整句保留为完整台词（不截断、不污染、高亮正常）；③ 段切片 = 从本切分点到下一切分点（含自带「说话人：」前缀），避免行首说话人冒号被当纯边界丢弃。
- **效果**：全文档扫描 163 个台词单元格，45 个正常多轮对白仍正确拆行、0 个高亮失效残留；粘连实例（第84/85/87集）全部修复为完整一行。第90集广告词口播实测无冒号、本就未被拆（宝哥所述「第90条」粘连实例实际落在第84/85/87集）。
- **测试**：新增 `dialogue_cell_sticking.test.js`（18/0）锁粘连不拆+正常多轮仍拆+长广告词不拆+贪婪候选不拆；全量 27 套件 0 失败（含 `docx_shooting_script.test.js` 14/0、`docx_split.test.js` 20/0 旧规则仍锁）。

## 二十、横屏沉浸 / 无缝衔接默认关闭 / 设置返回半屏修复（2026-09-18，宝哥需求）
- **① 从设置页返回只有半屏（部分机型）**
  - **根因**：本页所有排版都基于 `this.winHeight`（`_parseAndLayout` 里 `effVp = winHeight * 0.52`），而该值原本只在 `onLoad` / `onResize` 里更新。设置页默认竖屏，`navigateTo` 进去后屏幕已被转回竖屏，`navigateBack` 回到提词台要再转回原方向 —— **部分机型这一下不派发 `onResize`**，于是 `winHeight` 停在竖屏旧值，而 CSS 容器是 `100vh` 的真实大小，两者不一致 → 表现为「只有半屏 / 排版错位」。
  - **修复**：新增 `_syncWindowMetrics()`（读 `wx.getWindowInfo()` 强制刷新 `winWidth/winHeight` 与 `navSafeTop/statusBarHeight`），在 `onShow` 的 `_fromSettings` 分支、`_applyOrientation` 之后立即调用；新增 `_scheduleWindowResync()` 延时 400ms 再取一次并按最新尺寸重排，覆盖「`setPageOrientation` 异步未生效」与「压根不派发 `onResize`」两类机型差异。`onUnload` 里掐掉该定时器，避免在已卸载实例上 setData。
- **② 无缝衔接（循环）默认改为关闭**
  - `prefs.js` `DEFAULTS.loop` `true → false`。理由：提词稿是一次性念完的，念到末行就该停住；默认无限循环会让「已读完」的信号消失、末尾台词反复滚回来，反而干扰判断。
  - ⚠️ **迁移注意（重要）**：`load()` 是 `Object.assign(DEFAULTS, saved)`，**已有本地存储（`prefs_v1`）的设备不受默认值改动影响** —— 需点一次「恢复默认设置」，或在设置页 / 提词台菜单「循环」手动关闭。未擅自做一次性迁移，以免覆盖用户主动打开过的开关；是否迁移待宝哥定夺。
  - 同步更新 `bug_fixes.test.js` 中写死旧期望的用例（`prefs.DEFAULTS.loop 默认为 true`）为 `false`。
- **③ 横屏沉浸全屏**
  - 横屏下隐藏：顶栏 `tp-topbar`（含左上「返回」）、常驻浮动「设置」钮、底部整条进度条 → 字幕真正占满屏幕。竖屏行为完全不变。
  - ⚠️ **隐藏后必须保留出口**：若三处全隐，用户既改不了参数也退不出这一页。故菜单内新增一行（仅横屏显示）「设置 / 退出」，抵达方式 = 双击屏幕呼出菜单（菜单本身在横屏仍常驻可用）。
  - 右上角系统胶囊按钮是**原生控件，受框架限制无法隐藏**（这也是 `navSafeTop` 存在的原因）。
- **④ 真实文档复查（又查出并修复 1 个 bug）**
  - 新增通用审查工具 `audit_81_90.js`：`node audit_81_90.js <document.xml 路径>`（docx 需先用 python 解出 `word/document.xml`）。检查项：集数与集号连续性、疑似截断短行、疑似多轮未拆、XML/实体残留、**拆分后重新拼接能否还原原文（丢字检测）**。
  - **新查出的问题**：`splitDialogueCell` 每段都从 `cuts[i]`（说话人起点）开始，导致**第一个切分点之前的文本从未被任何段覆盖，被静默丢弃**。真实样本：环境提示单元格「（环境音：窗外鸟叫、远处邻居家炒菜声）」被输出成「环境音：窗外鸟叫、远处邻居家炒菜声）」，左括号丢失、括号不配对。
  - **修复**：第一段起点改为 `0`（`const start = i === 0 ? 0 : cuts[i]`）—— 切点之前的内容同属单元格文本，必须归属第一段。
  - **两份真实文档复查结果（均 0 异常、全部无损）**：建华&小凤 81-90（163 个含冒号单元格）、好运袁甘哥 81-90（198 个）；两者均拆 10 集、集号 81–90 连续无缺。
  - **测试**：`dialogue_cell_sticking.test.js` 增至 21/0（新增「括号提示左右都保留」与「拆分后拼接可还原原文」两条总闸）；全量 27 套件 0 失败。

## 二十一、超长台词分段后丢失角色（名字+台词高亮中途掉色）修复（2026-09-19，宝哥需求）
- **触发样本**：《建华&小凤的生活81-90.docx》第84集 王建华（画外音）的 **128 字**广告词（「悟空浏览器」那段）。
- **现象**：「名字+台词高亮」模式下，同一句话念到「而且现在大家伙都在追的爆款」起忽然掉色、后半截归类为无角色；而**同集另一句 98 字**的广告词（「全都是免费的」那段）完全正常。
- **根因**：`splitSections` 对 **>120 字**的行会调 `splitLongSentence` 按句末标点切成多段；切出来的**第 2 段起天然不再带「角色名：」前缀**（前缀只在首段）。而 `parseScript` 是**逐段**跑 `role.matchRole` 的 → 后半截匹配失败 → `role=null`。98 字那句没超阈值、整段保留前缀，故不受影响。**字数差 30 字决定了有没有 bug**，这也是「只有个别句子出问题」的原因。
- **修复（engine/parser.js）**：新增 `splitSectionsEx(text)`，返回 `[{text, continued}]`，标出哪些段是「被切出来的延续段」；`parseScript` 改用它，在 `matchRole` 失败且 `item.continued` 时继承上一轮说话人（`lastRole`）。**仅限延续段继承**——普通独立行自身无前缀时行为与修复前完全一致，不会因为挨着一句台词就被凭空染色。`splitSections` 改为委托 Ex 并 map 回纯字符串数组，**对外签名/行为零变更**（它被导出且 `bug_fixes.test.js` 依赖字符串数组）。
- **踩坑记录（务必记住）**：把内部 `sections` 改成对象数组后，`stats` 里两处 `s !== ''` 判空**恒为真** → 空行呼吸点被计入 `sections`，`bug_fixes` 的「stats.sections 不把空行计入段数」挂了。对象元素的判空必须取 `s.text`。注意 `quickStats` 用的是字符串版 `splitSections`，它那里的 `s !== ''` 是对的，**不要一并改成 s.text**（字符串没有 .text，会得到全部 undefined 反而全被过滤）。
- **验证**：第84集该句 6 个显示行全部 `role=王建华`（修复前倒数第 2、3 行为无角色）；两份文档全量扫描后，剩余无角色行均为「（无台词，…）」类**舞台提示**与**纯口播稿**（本就不该有角色），非本次病症。
- **新增工具**：`scan_role_loss.js`（`node scan_role_loss.js <document.xml>`）扫描任意文档「同一句台词中途丢角色」的行数。
- **测试**：新增 `parser_role_continuation.test.js` 13/0 —— 含核心用例（超长句全行同角色、仅首行有前缀）、**防误伤用例**（独立舞台提示行不得被染色）、以及 stats/splitSections 口径回归保护；全量 **29 套件 0 失败**。
- **遗留（未处理，待宝哥定夺）**：**多人齐说**写法「婆婆、儿媳妇：…」`matchRole` 识别不了 → 无角色、不高亮。好运袁甘哥第87集有 1 处。要不要支持「A、B：」这种写法待定。
# 宝哥提词器 · 项目上下文（压缩速查）

> 本文件是后续修改的单一事实来源，替代冗长对话记录。最后更新：2026-09-06
> 状态：v1.0 已提交微信审核（2026-09-03）。技术栈：原生小程序 + 纯本地存储，零后端、零云开发。

## 一、技术形态
- 4 个页面：`index`(我的台本) / `edit`(编辑) / `teleprompter`(提词台) / `settings`(设置)
- 7 个引擎模块（engine/）：`parser` `role` `scroll` `vad` `prefs` `store` `stats`
- 工具：`utils/util.js`（智能拆分 + docx 解析 + 命名）
- 存储：`wx.setStorageSync`，无服务器、无 `wx.cloud` 调用 → 零运行成本
- 已开启 `lazyCodeLoading: requiredComponents`（app.json）

## 二、文件地图（含关键函数，便于定位改哪）
| 文件 | 作用 | 关键入口 |
|---|---|---|
| `utils/util.js` | 智能拆分 + docx 解析 | `smartSplitScripts`(L356) `splitImportBlocks`(L296) `extractDocxText`(L131) `extractWtText`(L547) `extractDocxBlocks`(L~) `splitScripts`(L~) `autoName`(L235) `sliceByBoundaries`(L431) `buildSeriesRegex`(L445) |
| `utils/importSave.js` | 导入落盘**单一事实来源**（首页/预览页共用） | `uniqueFolderName` / `commitSingle`(返回`{script}`) / `commitSplitFromSegments`(多集建文件夹，仅1集退化`{count:1,script}`) / `commitSplitSmart`(标题/空行未识别→字数分批兜底，仅1篇返回`{script}`) / `commitSplitOriginal`(**原版 smartSplitScripts 纯文字逻辑，无兜底**) / `_savePartsAsFolder`(兼容`{title,content}`与`{name,lines}`两种 part) |
| `pages/preview/` | 文档预览页（拆分前查看全文+分集预览，单篇/拆分导入） | `onLoad`(读`globalData.importPayload`) `onCancel`(navigateBack) `onImportSingle`(commitSingle) `onImportPlain`(commitSplitOriginal) `onImportMultimodal`(commitSplitFromSegments) `onUnload`(清空payload) |
| `engine/scroll.js` | 滚动引擎（setInterval 60fps 驱动） | `ScrollEngine`(L30) `configure(lineHeight,totalHeight,viewportHeight,pxPerSecond,guideOffset)`(L71) `endOffset`/`guideOffset`(L43-46) `maxOffset` getter(L91，非循环返回 endOffset=内容高-参考线偏移；循环返回 loopHeight) `start/pause/resume`(L124-146) `_tick`(L223，非循环末行滚过参考线→onEnd) `seekProgress`(L177) `syncTo`(L197) |
| `engine/prefs.js` | 偏好中心（全局） | `DEFAULTS`(L12) `load/patch/reset`(L122-156) `effectiveColors`(L205) `FONT_LEVELS`(L53) `SCROLL_STYLES`(L77) `SPEED_PRESETS`(L91) `PRESET_THEMES`(L102) |
| `engine/parser.js` | 台词解析/断行/分段 | `parseScript`(L256) `splitSections`(L103) `splitBySpeakers`(L194) `mergeShortSegments`(L218) `estimateMinutes`(L416) |
| `engine/role.js` | 角色识别 + 8 色配色 + 按角色筛选 | `matchRole`(L106) `assignColors`(L182) `colorOf`(L196) `computeAliases`(L226) `summarize`(L163) `resolveRoleFilter`(L264) `filterLinesByRole`(L313) |
| `engine/store.js` | 台本/文件夹/进度/统计 CRUD | `list`(L59) `get`(L131) `create`(L142) `save`(L165) `remove`(L179) `createFolder`(L90) `updatePosition`(L188) `appendStat`(L222) `getStats`(L240) |
| `engine/stats.js` | 复盘统计采集 | `StatsCollector`(L16) `onStart/onTick/onEnd/onLoop` `snapshot` |
| `engine/vad.js` | 本地声控(VAD) + 隐私闸门 | `requestAuth`(L43) `VoiceController`(L81) `ensurePrivacy`(L29) → `wx.requirePrivacyAuthorize` |
| `pages/teleprompter/teleprompter.js` | 提词台总控制器（核心，1390 行） | 见第三节 |
| `pages/index/index.js` | 台本列表/新建/导入 | `onShow`(L26) `onTapNew`(L126) `onTapImport`(L131) `onTapItem`(L285) `onTapFolder`(L291) `onTapSettings`(L355) |
| `pages/edit/edit.js` | 编辑器/角色管理（导入入口已收敛到首页「导入 txt / word」，编辑页不再内嵌导入） | `onLoad`(L43) `onTapAddRole`(L292) `onTapSplitAutoRole`(L399) `onTapSave`(L616) `onTapStart`(L621) |
| `pages/settings/settings.js` | 设置 UI | `onLoad`(L45) `onTapFont`(L61) `onTapSpeedPreset`(L70) `onTapScheme`(L80) `onTapPreset`(L85) `onTapCountdown`(L132) `onTapOrientation`(L136) `onTapScrollMode`(L140) |

## 三、teleprompter.js 核心方法速查
- 生命周期：`onLoad`(L93) `onReady`(L179) `onResize`(L191) `onHide`(L232) `onShow`(L249) `onUnload`(L307)
- 加载布局：`_loadScript`(L322) `_parseAndLayout`(L404) `_relayoutKeepProgress`(L389) `_updateVisible`(L638) `_seekTo`(L688)
- 滚动控制：`_startScroll`(L546) `_startCountdown`(L517) `_clearCountdown`(L509) `_onUpdate`(L569) `_onEnd`(L591) `_onLoop`(L599) `onTapPlay`(L896) `onTapRestart`(L937)
- 交互：`onTapScreen`(L714 单击→onTapPlay / 双击→菜单) `_openControls`(L804) `_closeControls`(L827) `_scheduleAutoHide`(L862) `onToggleOrientation`(L971) `onSetRoleMode`(L987) `onTapThemePreset`(L1000) `onTapFontSize`(L1012) `onToggleMirror`(L1024) `onToggleGuide`(L1030) `onToggleLoop`(L1057)
- 进度/手势：`onSeekChanging`(L1128) `onSeekChange`(L1151) `onTouchStart`(L1170) `onTouchMove`(L1195) `onTouchEnd`(L1205)
- 声控：`onToggleVoice`(L1316) `_startVoice`(L1352)
- 切台本：`onTapPrevScript` `onTapNextScript` `_switchScript`(重入锁) `_prepareSwitch`(状态归零) `_scriptOrder`(切换/角标唯一顺序源 = util.sortByEpisode(store.list()) 按集号递增 第N集→第N+1集) `_updateScriptPos`(角标+hasPrev/hasNext 置灰态) `_loadScript(id, {fresh})`

## 四、v1.0 已落地功能（勿重复做）
- 滚动：smooth 匀速 + voice 声控；单击暂停/双击菜单/手动调位续播/段末不停
- 导入：Word(txt/md/docx) + 智能拆分（系列名 / 第N集 / 空行 / 字数兜底）
- 显示：镜像翻转✅、开场倒计时✅、角色多色高亮(name/full)✅、三套配色预设✅、语速档位✅、参考线/横竖屏/屏幕常亮/补光/无缝无限滚动/首圈开篇留空
- 隐私接口仅 2 个：`chooseMessageFile`(导入) + `RecorderManager`/麦克风(声控)；已内置 `requirePrivacyAuthorize` 闸门

## 五、四轮已修复（勿回退）
1. 竖屏末尾缺字 → `_parseAndLayout` 引入 `effVp = winH*(1-0.4-0.08)` 作视口(L455-483)
2. 手动调位误暂停 → `onTouchEnd` 去掉 `scrollMode==='auto'` 冗余判断(L1218)
3. 横屏设置键过大 → `.tp-float-settings.tp-land` 字号 22→18rpx(wxsl)
4. 智能拆分丢末句 → 与①同根（effVp 修复一并解决），拆分函数本身 0 丢失

## 六、已删除项（勿恢复）
- `pages/review/` 复盘页（第四轮删除）；`teleprompter.js` 仍保留 `stats` 采集与 `_finalizeStats` 写入（v1.1 计划恢复复盘时复用，存储每篇 ≤30 条）

## 七、1.1 筹备（详见 `1.1版本筹备建议.md`）
- P0：每篇独立滚动参数 / 长稿虚拟滚动 / setData 基线 / 升级兼容(存储迁移+基础库降级)
- P1：台词导出长图(需补【相册仅写入】隐私声明) / 提词模板 / 手势调参 / 参考线可调 / 首次引导 / 横屏控制收敛 / 声控延迟初始化 / 灰度发布
- P2：云端同步 / 蓝牙遥控 / AI 断句 / 视频对照 / 朋友圈分享 / 悬浮窗(需做独立 App)
- **边界**：小程序无法做真悬浮窗（压相机提词是 App 能力）；声控仅前台有效

## 八、测试命令（改动后跑一遍防回归）
```
cd baoge-teleprompter
node _regression_fixes_test.js   # 4 项修复回归 32/32
node _e2e_test.js                # 端到端 40/40
node bug_audit.test.js           # 健康态 0 bug
node round23.test.js             # 第 23 轮 71/71（含编辑页 navHeight 与标题断言）
node edit_title_display.test.js  # 编辑页标题完整显示 27/0
node episode_order.test.js       # 按集号取下一集/上一集纯函数 22/0
node script_switch.test.js        # 台本切换（上/下一个）42/0
node role_filter.test.js          # 按角色筛选纯函数 17/0
node role_filter_page.test.js     # 角色显示选择(编辑页配置→台词页生效) 页面集成 23/0
node edit_roledisplay.test.js      # 编辑页角色显示选择(默认显示全文/显示全文键/合并切换键/单选多选/抗recalc/持久化+静态护栏) 29/0
node docx_split.test.js            # Word 导入按「拆分规则_v1」(规则A表格稿/规则B段落稿) 20/0
node docx_split_real.test.js        # 真实样本综合(28类:表格/段落/话剧/情景喜剧/口播/分镜) 26/26
node full_module_e2e.test.js        # 全模块贯通(导入→存储→角色显示→台词页→按集切换+边界) 17/17
node role_highlight_select.test.js # 已废弃占位(SKIP)，勿运行
node docx_garble_fix.test.js       # 乱码修复回归 7/7（<w:t\b 正则避免误吞 <w:tr>/<w:tc>）
node importSave.test.js             # 落盘共享模块 13/13（commitSingle/commitSplitFromSegments/commitSplitSmart）
node preview.test.js                # 文档预览页 18/18（三选项 onImportSingle/onImportPlain/onImportMultimodal + 固定顶栏布局数据 + 无payload退出）
node index_text_import_preview.test.js # 首页 txt/md 导入分流回归 8/8（多段→预览页 / 单段→编辑页，防 _askSplitImport 悬空调用回归）
# 其余：engine_*/util_split/edit_import/folder_gap 等
```

## 九、近期 UI 改动（2026-09-06，宝哥三条需求）
1. **编辑页标题显示不全/被遮挡** — ①`edit.wxss` `.ed-nav-title` 加 `word-break:break-all;overflow-wrap:anywhere`；`.ed-nav-inner` `height`→`min-height:88rpx`。②**彻底修复（见第十一节）**：标题由 `input` 改 `textarea+auto-height` 自动换行。⚠️ 期间曾加过 `edit.js` navHeight `+2` 缓冲，**已移除**（破坏"精确覆盖导航栏"语义并使 round23 2 项转红），现 navHeight 精确 = 状态栏 + 88rpx，靠 `.ed-nav-title` 行高降到 40rpx（2 行=80rpx≤88rpx）保证不撑高遮挡。
2. **首页新建/导入移到顶部吸顶** — `index.wxml` `action-bar` 由页底移到 header 下、filter-bar 前；`index.wxss` `.action-bar` 改 `position:sticky;top:0`（滚动常驻顶部），删掉底部旧按钮块。
3. **文件夹展开/收起** — `index.js`：`COLLAPSED_KEY='baoge_folder_collapsed'`（本地存收起 id 集合，刷新保持）、`onShow` 读进 `this._collapsed`、`loadList` 收起时只渲染组头不渲染组内台本、`onToggleFolder` 切换并落库；`index.wxml` 文件夹卡加箭头 `▾/▸`（`catchtap` 不触发改名）；`index.wxss` 加 `.folder-arrow/.folder-right/.is-collapsed`。交互：点箭头=展开/收起，点卡体=改名（原），长按=删组（原）。

## 十、滚动结束判定修复（2026-09-06，宝哥需求）
- **根因**：`_onEnd`(`teleprompter.js` L591-597) 里 `setData({...showControls:true})` 会在滚完瞬间自动弹控制菜单覆盖层；且旧结束判定用 `maxOffset=totalHeight-effVp`（末行停在屏幕底部≈92% 处就收场），比「末行滚过参考线(50%)」早约 42% 屏。
- **改动1（结束判定）**：`scroll.js` `configure` 增第 5 参 `guideOffset`（参考线相对内容首行基线偏移 px）；新增 `endOffset=max(0,totalHeight-guideOffset)`；`maxOffset` getter 非循环模式返回 `endOffset`（循环模式仍返回 `loopHeight`，不变）。控制器 `_parseAndLayout` 按布局实测 `guideOffsetPx=round(winH*(0.5-0.4))` 传入（`.tp-content` padding-top:40vh → 首行基线在 40%；`.tp-guide` top:50%）。→ 结束唯一定义为「末行滚过参考线」，不再是滚到底/计时/行数索引。
- **改动2（结束行为）**：`_onEnd` 移除 `showControls:true` → 非循环滚完直接冻结当前画面（playing=false, finished=true），不弹菜单、不跳转、不重置、不清空，等用户手动操作（双击/返回/设置按钮/手势才显示菜单）。
- **兼容性**：循环（无限滚动）走 `loopHeight` 回绕，从不触发 onEnd，行为完全不变（T8 验证）。
- **测试**：`engine_scroll.test.js` 新增 T5/T7/T8（19/0）；`engine_loop_seek.test.js` 补 `guideOffset` 还原断言（12/12）。`grep showControls:true` 全仓仅 `_openControls`(手势触发) 与测试桩，无其它自动弹菜单点。

## 十一、编辑页「台本标题显示不全」彻底修复（2026-09-06）
- **根因**：标题用 `<input>`——**单行**原生组件，超出框宽即硬裁切（无省略号、不可换行）。`maxlength=30`，可用宽 = 屏宽−176rpx，375px 屏仅 **574rpx**，30 个中文字需 900rpx → 尾部直接被切掉。次因：导航栏 `.ed-nav-title` 原 32rpx/行，窄屏(320px)2 行仅约 28 字 < 30 字上限，末尾被 line-clamp 省略。
- **改动1（主）** `edit.wxml`：标题 `input` → `textarea` + `auto-height="{{true}}"` + `show-confirm-bar="{{false}}"`。数据绑定与编辑逻辑**零改动**（`value="{{title}}"` / `bindinput="onInputTitle"` / `bindfocus="onTitleFocus"` / `maxlength="30"` / `placeholder` 全保留）。
- **改动2** `edit.wxss` `.ed-title-input`：补齐完整盒模型（不再依赖全局 `.input`）——`min-height:88rpx`（空/短标题与原子输入框等高不跳动）、`max-height:264rpx`（兜底不撑爆卡片挤压下方按钮）、`word-break:break-word` + `overflow-wrap:anywhere`（中英混排/无空格长串可断行）。无 `text-overflow:ellipsis`、无 `white-space:nowrap`。
- **改动3** `edit.wxss` `.ed-nav-title`：字号 32→30rpx（窄屏每行约 15 字，2 行可容满额 30 字标题）、line-height 42→40rpx（2 行=80rpx ≤ 导航标题行 88rpx，导航栏高度恒定，不撑高、不遮挡首张卡片）。
- **改动4** `edit.js`：移除 navHeight 的 `+2` 缓冲（它破坏"精确覆盖导航栏"语义并致 round23 两断言转红）。现 navHeight 精确 = 状态栏 + 88rpx；安全性由改动3 的 80rpx≤88rpx 保证。
- **测试**：新增 `edit_title_display.test.js`（27/0）——静态校验组件为 textarea+auto-height、无省略/单行锁死、有断行与高度上下限、导航栏两行≤88rpx；数据层用 30 字中文/中英混排/无空格长英文/数字标点混排验证 title 与 navTitle 一字不丢。

## 十二、台本切换（菜单上/下一个台本）逻辑修复（2026-09-06，宝哥需求）
- **根因**：
  1. 边界无置灰：到头时按钮仍亮着，点只弹一句提示、不切换 → 假可点。
  2. 当前台本不在列表（首页删了）时 `idx<0` 直接 `return` → 按钮"可点却毫无反应"。
  3. 切换顺序用 `_scriptOrder()`（= util.sortByEpisode(store.list()) 按集号递增）与角标同源，已统一到单源（避免顺序打架）。
  4. 快速连点/重入：`_startCountdown` 未清旧定时器 → 旧 interval 引用丢失后无法 clear，多个倒计时叠加、各触发一次 `_startScroll`，表现"切换后立刻自己开跑""倒计时一次跳两格"。
  5. 状态未归零：切换后 progress/finished/续播/统计/触摸中间态未清，新台本可能带着旧态。
  6. 切换弹"继续上次进度" modal 与 title toast 叠加、连点堆多个 modal。
- **改动（teleprompter.js）**：
  - 新增 `_scriptOrder()` 单一顺序源（= util.sortByEpisode(store.list()) 按集号递增），`_updateScriptPos` 与 `_switchScript` 共用；同时算出 `hasPrevScript/hasNextScript` 置灰态。
  - 重写 `_switchScript(dir)`：重入锁 `this._switching`；空列表→提示并清置灰；单台本→提示；`idx<0` 时按方向归位到首/末再切（不再静默 return）；越界→刷新角标+提示，不切换。
  - 新增 `_prepareSwitch()`：暂停引擎+落盘旧台本进度/复盘，`clearInterval(_countdownTimer)`，`setData` 归零 progress/finished/resumePosition/countdown/播放态，`stats.reset()` + 清 _lastSection/_wrapped/触摸拖动中间态。
  - `_loadScript(id, {fresh})`：`fresh:true`（主动切换）跳过续播 modal 直接从头倒计时、并解锁 `_switching`；加载失败也解锁，避免按钮永久失效。
  - `_startCountdown` 开头 `clearInterval(this._countdownTimer)` 修定时器泄漏。
  - `onShow` 末尾补 `_updateScriptPos()`：从首页删台本返回后刷新角标/置灰态。
  - `data` 增 `hasPrevScript/hasNextScript`；`onLoad` 增 `this._switching=false`。
- **wxml/wxss**：两个按钮绑 `{{hasPrevScript?'':'is-disabled'}}`，`.tp-btn.is-disabled` 灰显 + `pointer-events:none`。
- **边界策略**：到头**禁用置灰（不循环）**——拍摄现场误触绕回第 1 集会打乱节奏；置灰外 JS 仍校验越界。
- **状态保留**：字号/行高/速度/配色/镜像/参考线/补光/横竖屏/声控/无限滚动由 `_loadScript` 从 prefs 重读，保留。
- **测试**：新增 `script_switch.test.js`（42/0），覆盖需求1-5 全部边界；`bug_audit` 切换段 0 bug、全套回归绿。

## 十三、角色显示选择（编辑页配置 → 台词页生效，2026-09-06 重构）
- **需求（2026-09-06 重新设计）**：在编辑页与「角色高亮」**同区**新增「角色显示选择」。**默认不选中任何角色＝显示完整原文（所有角色台词 + 标题/说明全显）**，并设「显示全文」键为默认选项；用户选中某角色 → 仅保留该角色台词及其对应标题/说明、隐藏其余角色台词；「全选」与「取消全选」合并为**一个可切换键**（未全选态点=全选，已全选态点=取消全选=回到显示全文）。配置存入台本；台词滚动页按配置生效；菜单内原有角色选择板块已移除。与「角色高亮」深度协同（高亮只作用于显示出的行）。两侧读同一份存储，行为一致。
- **设计（`roleDisplay` 三态语义）**：台本字段 `script.roleDisplay`（角色标准名数组）。
  - `undefined` / `null`（老台本/新建未保存/默认/点「显示全文」）＝**全部显示（显示全文态，不选中任何角色 chip）**。
  - `[]`（显式「取消全选」历史值）＝**无显示**（空画面）。
  - 非空数组（如 `['A']` / `['A','B']`）＝**仅显示数组内角色**。
  - 编辑页勾选 → 存 `roleDisplay`；台词页 `_loadScript`→`_parseAndLayout` 经 `this._roleDisplayFilter()` 读 `script.roleDisplay` → `resolveRoleFilter` → 设 `this.roleFilter` → `displayLines = filterLinesByRole(allLines, roleFilter)`。**不改动台词数据本身，仅存显示配置**。
  - 边界：`filterLinesByRole(lines, filterSet)` 中 `null`→原样返回全部、空 Set→返回 `[]`（无显示）；`_roleDisplayFilter()` 中 `[]`→`new Set()`（无显示），非空数组但全是失效名（角色被合并/删除）→回退 `null`（全显，不误清空整屏）。`onSetRoleFilter(def)` 同样：`null`=全显、`[]`=无显示、非空=仅显指定。
- **改动（engine/role.js，纯函数，沿用）**：
  - `resolveRoleFilter(input, knownRoles, aliases)`：解析名称/ID→标准名小写键集合，空/无效→null。
  - `filterLinesByRole(lines, filterSet)`：null→全显；空 Set→`[]`（无显示）；否则仅保留命中角色行。改为：**非空集合→保留「命中角色行 + 非角色行（role===null：标题、舞台提示、旁白、非台词说明）」，仅隐藏其它角色台词**（修复「选角后标题/非台词文字消失」缺陷，详见下方修复记录）。
- **改动（pages/edit/edit.js + edit.wxml + edit.wxss）**：
  - `data` 增 `roleDisplayNames`(当前勾选角色名数组，与 roles 同源，默认 null=显示全文态)、`roleDisplayItems`(预计算渲染数组，每项 `selected` 布尔)、`showFullText`(默认 true)、`allRoleSelected`(默认 false)；`onLoad` 读 `s.roleDisplay`(缺省 null→显示全文)。
  - 第3张卡片「角色高亮」区内新增「角色显示选择」子区：**「显示全文」键 `onShowFullText`**（默认高亮，点击恢复显示全部原文＝`roleDisplayNames=null`/`showFullText=true`）+ **合并切换键 `onToggleAllRoleDisplay`**（未全选→全选(选中全部)、已全选→取消全选(回到显示全文)）；列出识别到的角色（liveRoleNames）每项 ☑/☐ 勾选、`onToggleRoleDisplay` 单/多切换；取消最后一个角色→自动回到显示全文。
  - 角色集变化时 `_recalc` 用 `keepDisplay` 收缩 `roleDisplayNames`（仅留仍存在角色），避免陈旧引用；`_syncRoleDisplayItems()` 在勾选切换/显示全文/合并切换/`_recalc` 末均重算 `roleDisplayItems`。
  - 持久化：`_save`(L640) 与 `onUnload` 兜底(L201) 写 `script.roleDisplay`（null=不落库以兼容老台本全显；非空数组原样存）；`_markSaved`/`_isDirty` 纳入该字段（未保存检测不误报）。
- **改动（pages/teleprompter/teleprompter.js）**：
  - 移除菜单「按角色筛选」板块及 `onToggleRoleFilter`/`onClearRoleFilter`/`data` 三 UI 字段（菜单不再有角色选择）。
  - `_parseAndLayout`：`this.roleFilter = this._roleDisplayFilter()`（读 `this.script.roleDisplay`）；`displayLines = filterLinesByRole(allLines, roleFilter)`；`contentHeight` 用 displayLines 长度。
  - `_roleDisplayFilter()`(L1128)：读 `script.roleDisplay`→`undefined/null`→null(全显)；`[]`→`new Set()`(无显示)；非空→`resolveRoleFilter`→集合，全失效→null(回退全显，不误清空)。
  - 保留 `onSetRoleFilter(def)` 程序化入口（内部能力，可被代码/未来扩展调用）：null=全显、`[]`=无显示、非空=仅显指定，经 `_applyRoleFilter` 重排。
- **协同（与角色高亮）**：角色高亮着色作用于 `displayLines`（显示出的行）；隐藏的角色即使高亮也不显示。编辑页决定"显示谁"，高亮决定"显示的怎么着色"，两侧一致。
- **兼容性/边界**：`_relayoutKeepProgress`→`_parseAndLayout` 重读配置→字号/横竖屏切换后显示恒定一致；`_switchScript` 每篇新台本按各自 `roleDisplay` 生效（不串台本）；空配置=全显；某勾选角色不在本台本→该角色 0 行。
- **修复（点击无响应根因，2026-09-06）**：原 wxml 在 `class`/文本插值里写 `roleDisplayNames.indexOf(item.name) >= 0` 决定 `.on` 类——部分微信基础库对**属性插值里的数组方法调用求值不稳**，导致 `.on` 类永不生效、视觉上"点了不变绿=无反应"。改为预计算 `roleDisplayItems`（roles 每项叠加 `selected` 布尔），wxml 只绑定 `item.selected` 简单布尔；新增 `_syncRoleDisplayItems()`（`onToggleRoleDisplay`/`onShowFullText`/`onToggleAllRoleDisplay`/`_recalc` 末均调用）；并加 `hover-class` 点击反馈。JS 逻辑（直接调 handler）单测原本就过，故该 bug 仅真机渲染层暴露。
  - **修复（选角后标题/非台词文字消失，2026-09-06）**：原 `filterLinesByRole` 非空集分支 `lines.filter(l => l.role && filterSet.has(l.role))` **只保留命中角色行**，把 `role===null` 的标题/舞台提示/旁白/非台词说明整类过滤掉——用户选中某角色后这些文本凭空消失。改为 `lines.filter(l => !l.role || filterSet.has(l.role))`：非角色行（`role===null`）**始终保留**，仅隐藏其它角色台词。空集合（`[]`=取消全选=无显示）语义不变。回归测试 `role_filter.test.js`(18/0)、`role_filter_page.test.js`(23/0) 已锁新行为（保留标题/说明、仅隐藏其它角色）。
- **测试**：`edit_roledisplay.test.js`(29/0) 锁编辑页默认显示全文/显示全文键/合并切换键/单选多选/抗_recalc/持久化 + 静态护栏(wxml 无 indexOf 插值、无 onSelectAllRoleDisplay/onClearRoleDisplay)；`role_filter_page.test.js`(23/0) 台本级 roleDisplay 驱动（含 `[]`=无显示、失效名回退全显）；`role_filter.test.js`(18/0) 纯函数。`role_highlight_select.test.js` 已废弃占位（对应功能已回滚重构，勿运行）。

## 十四、Word 导入遵循「提词器拆分规则_v1.md」（2026-09-06，宝哥需求）
- **规则来源**：`/Users/huweihua/WorkBuddy/W o r k Bu d d y/建华小凤提词拆分测试/提词器拆分规则_v1.md`。核心两条：
  - **规则A（表格稿）**：一个表格 = 一集；表格首行是列头（镜头/画面/台词…），台词取**第 3 列**（索引 2）；集名取表格外紧邻的上一个**有效标题行**（含"系列名+数字"或纯数字编号）。
  - **规则B（段落稿）**：按"系列名 + 数字"标题行切分（如 `建华&小凤的生活 71`）；无系列名时按纯数字编号行切分；标题行以下直到下一个标题行为该集正文。
- **改动（engine/role.js 之上，util.js 新增，表格感知）**：
  - `extractDocxBlocks(xml)`：保留表格结构，返回 `blocks` 数组——`{type:'table', rows:[[cell,cell,...],...]}` 或 `{type:'paragraph', text}`。表格单元按 `<w:p>` 分段提取 `<w:t>` 文本（修复：`parseTableBlock` 原用单段 `<w:t>` 正则会吞进 `<w:tc><w:p>` 前缀，改为按段落切分再提取；`extractWtText` 辅助函数）。
  - `splitScripts(blocks)`：先检测是否有表格→走 `splitTableScript`（规则A）；否则 `splitParagraphScript`（规则B）。返回 `{segments:[{name, lines:[]}], scripts:[]}`。
    - `splitTableScript`：每个表格 = 一集；取首行外每行的第 3 列（容错：列数<3 时取末列）；集名 = 表格前最近的标题行文本（回退 `第N集`/自动名）。
    - `splitParagraphScript`：用 `SERIES_RE` 匹配"系列名+数字"标题行作为切分点；无系列名用纯数字编号；标题行归属下一集。
  - 导出：`extractDocxBlocks`、`splitScripts`（module.exports 已加）。
- **改动（pages/index/index.js 导入入口）**：
  - `_importDocx`：解压 docx 后读 `word/document.xml`，改调 `util.extractDocxBlocks(xml)` + `util.splitScripts(blocks)`（原 `extractDocxText` 只提段落、丢失表格，已弃用此路径）。
  - `_askDocxSplitImport(name, plain, result)`：弹 ActionSheet「作为一篇导入 / 按拆分规则导入（N 集）」。
  - `_saveSplitImportFromSegments(segments, name)`：多集时建文件夹（日期命名）逐集落盘 `script.folderId=folder.id`，复用现有拆分导入逻辑。
- **兼容性**：纯段落 docx（无表格）走规则B，行为等同旧 `smartSplitScripts`；旧 txt 导入不受影响（`_saveSingleImport`/`_saveSplitImport` 保留）。
- **测试**：`docx_split.test.js`(20/0) 锁规则A（表格→多集、第3列台词、集名取标题行、混合表格+段落）与规则B（系列名+数字切分、纯数字编号、无标题则单篇）；`docx_shooting_script.test.js`(14/0) 锁新「拍摄脚本表」结构（集标题在表内合并单格、多轮对白拆行、口播纯旁白保留、裸无台词跳过、meta 留存、标题不被时间段段落劫持）；含 `extractWtText` 剥离标签的单元校验。
- ⚠️ **重要更正**：本节描述的导入流程（`_askDocxSplitImport` ActionSheet + `_saveSplitImportFromSegments`）**已被第十五节「预览页」取代**。现导入不再弹 ActionSheet，而是 `index.js` 写 `globalData.importPayload` → `navigateTo` 预览页 → 预览页调用 `importSave` 落盘。请勿照本节旧 ActionSheet 逻辑实现新功能。

## 十五、文档预览页 + 乱码修复 + 回退版本（2026-09-06，宝哥三条需求）
- **1. 文件预览功能（拆分前先看全文）**：
  - 新增 `miniprogram/pages/preview/`（preview.js/wxml/wxss/json），`app.json` pages 已加 `"pages/preview/preview"`。
  - 新增 `miniprogram/utils/importSave.js`（落盘**单一事实来源**，首页与预览页共用，避免导航/测试破坏）：只负责 store 落盘、不负责导航/toast，返回 `{script}`/`{count,folderId}`/`{error}`。`commitSplitFromSegments` 仅 1 集退化返回 `{count:1, script}`；多集建文件夹逐集挂入。`commitSplitSmart` 标题/空行未识别自动退化为字数分批（size），仅 1 篇返回 `{script}`。
  - 首页 `index.js`：`_importDocx` 解析后不再调 `_askDocxSplitImport`，改为写 `getApp().globalData.importPayload={kind:'docx',name,plain,result}` + `navigateTo preview`；txt/md 导入 `util.smartSplitScripts(content).length>=2` 分支改为写 payload `{kind:'text',name:title,content}` 并跳预览页；删除 `_askSplitImport`/`_askDocxSplitImport` 两个弹窗方法；`_saveSplitImportFromSegments`/`_saveSingleImport`/`_saveSplitImport` 改为委托 importSave。
  - 预览页 `onLoad` 读 importPayload：docx 用 `result.segments` 映射分集卡片，text 用 `util.smartSplitScripts` 预览；填 `name/kind/text/charCount/segments/splitCount/canSplit`。`onUnload` 清空 payload。`onCancel`→`navigateBack`；`onImportSingle`→`commitSingle`→`redirectTo` 编辑页；`onImportSplit`→docx 走 `commitSplitFromSegments`、text 走 `commitSplitSmart`→toast+`navigateBack`（首页 `onShow` 自动 `loadList` 刷新）。
  - 测试：`preview.test.js`(11/11) 锁 onLoad/onImportSplit/onImportSingle/无 payload 退出；`importSave.test.js`(13/13) 锁 4 个落盘函数。
- **2. 回退版本（无新拆分规则）**：
  - git 分支 `backup/pre-split-rules` 指向 `e248a56`（校验一致，该提交不含 `extractDocxBlocks`）。
  - 两份文件夹快照（同父目录 `2026-09-02-10-33-02/`）：`baoge-teleprompter.pre-split-rules/`（无新拆分规则版本，`git archive e248a56 | tar -x` 导出）；`baoge-teleprompter.pre-fix/`（含规则但未修乱码版，`cp -R` 排除 .git）。
- **3. docx 拆分乱码修复（根因 100% 定位）**：
  - 根因：`util.js` `extractWtText`(≈L547) 与 `extractDocxText`(≈L140) 的正则 `/<w:t[^>]*>([\s\S]*?)<\/w:t>/g` 误匹配 `<w:tr>/<w:tc>/<w:tblPr>`（`<w:t` 是这些元素名前缀），把含 `<w:rPr>` 的排版 XML 当文本吞入 → 拆分后全乱码。
  - 修复：改为 `<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g`（`\b` 单词边界，避免误匹配 `<w:tr>/<w:tc>/<w:tblPr>`）。真实《建华9.1.docx》《建华9.1台词.docx》均验证输出干净中文（10 集、无 `<w:` 残留）；`blocksToText`（预览全文）亦干净。
  - 测试：`docx_garble_fix.test.js`(7/7) 用含 `<w:pPr>/<w:rPr>/<w:tblPr>/<w:tr>/<w:tc>` 的两列表头表格稿 XML，断言标题/台词干净中文、无 `<w:` 残留。
- **4. 全量回归**：27 套件 0 失败（`docx_garble_fix` 7/7、`importSave` 13/13、`preview` 11/11、`index_text_import_preview` 8/8 为首轮新增；`docx_split_real` 26/26 覆盖真实样本）。⚠️ 改动后跑全部 27 套件，单跑某文件易漏回归。

## 十六、导入预览页三选项改造 + 顶栏固定（2026-09-06，宝哥需求）
- **需求1：三个文档拆分选项**（原预览页只有「作为一篇导入 / 按拆分规则导入」二选一）：
  1. **作为一篇导入**：整篇整体导入，不拆分 → `importSave.commitSingle`。
  2. **智能拆分（纯文字档）**：运行**未加入新拆分规则的原版逻辑** `util.smartSplitScripts`（仅处理纯文本，无字数兜底）→ `importSave.commitSplitOriginal`（新增；与带字数兜底的 `commitSplitSmart` 区分开，后者属新规则体系）。docx 先 `blocksToText` 压平为纯文本再走原版逻辑。
  3. **智能多模态拆分（表格）**：采用**最新拆分规则_v1**（保留表格结构）→ docx 直接取 `p.result.segments`；text 包成单段落块 `[{type:'paragraph',text}]` 走 `util.splitScripts` 段落规则 → `importSave.commitSplitFromSegments`。
  - `importSave.js` 抽出 `_savePartsAsFolder`（兼容 `{title,content}` 与 `{name,lines}` 两种 part 形态），`commitSplitSmart`/`commitSplitOriginal`/`commitSplitFromSegments` 多集时共用，消除重复落盘代码。
- **需求2：预览页布局**：
  - 顶部固定操作栏（`.topbar` 作为 `.prev` 的 flex 兄弟节点、**不在 scroll-view 内**，故始终可见、不随滚动消失），含「取消 + 三个导入按钮」；拆分按钮在可拆篇数 `<2` 时 `disabled` 置灰（仅「作为一篇导入」恒可用）。
  - 滚动区顺序：**分集预览（最新多模态规则）在上 → 原文在下**（`segments` 卡片在前，`doc-text` 原文在后）。
  - 预览页 `onLoad` 同时计算 `plainCount`（原版纯文字篇数）与 `multiCount`（最新多模态集数）；分集预览展示 `multiCount` 对应的 segments。
- **测试**：`preview.test.js` 重写为 18/18（docx/text 双路径、三入口 `onImportSingle`/`onImportPlain`/`onImportMultimodal`、无 payload 退出）；`importSave.test.js` 13/13 仍锁 4 个落盘函数（含新 `commitSplitOriginal`）。全量 27 套件 0 失败。

## 十七、导入预览页「测试拆分」按钮（已撤销，2026-09-06）
- **状态**：该「测试拆分」按钮及其关联的 `util.smartSplitLines` 新台词拆分规则、`onTestSplit` 事件处理函数、`testLines`/`testCount` 状态变量、wxml 预览区块、wxss 样式（`.test-btn`/`.line-card`/`.line-speaker`）、以及 `smart_split_lines.test.js` 单元测试，**已于 2026-09-06 经宝哥要求完整移除**，无残留无效引用或死代码。预览页恢复为三选项导入（作为一篇 / 智能拆分纯文字档 / 智能多模态拆分表格）+ 固定顶栏状态。

## 十八、拍摄脚本表新规则（2026-09-14，宝哥需求）
- **触发样本**：桌面《好运袁甘哥81-90.docx》（10 表 / 229 行，81–90 集，含 85/90 两篇「口播」）。用此真实文档对「智能多模态拆分」做台本拆分功能测试，暴露出旧规则在该结构下完全失效，据此补全新规则。
- **旧规则在此文档上的失败表现**（已实测）：① 集标题被错取为表格前「【时间段：0907–0913】」段落（10 集同名）；② 台词抽成「场景：…/镜头/1/2/3」镜头号——因旧逻辑假定「首行=标题、次行=表头」，而本表真实表头在第 4 行，表头前的 3 个合并单格（集标题/人物·场景·道具/场景）被当数据。
- **新规则（已加入 `splitTableScript`，零回归）**：
  1. **全表扫描定位真实表头行**：首个含 台词/对白/内容/独白/口播/话术 列名且≥2列的行即表头；表头前的合并单格一律视为「集信息行」，**不再当数据**。
  2. **集标题**优先取集信息行里「像集标题」的单格（`isEpisodeTitleRow`：含集/期/话/卷 或 中文+数字结尾，且不含冒号与人物/场景/道具等关键词，排除 时间段/【】 分组标记）；其次才取表格前段落（已过滤分组标记）。故 81–90 全正确命名，含「（口播）」后缀。
  3. **台词列**按表头「台词」列定位（默认第3列/索引2）；无表头时按列数推断（两列取末列/三列取第3列/四列+取末列），兼容旧表。
  4. **多轮对白拆行**：一个台词单元格形如「婆婆：…儿媳妇：…」经 `splitDialogueCell` 按说话人（允许带括号动作 `婆婆（喊）：`）拆成多行，便于提词器逐句滚动；单行无冒号（口播纯旁白）原样保留。
  5. **裸「无台词/无对白」行跳过**（旧规则仅拦 `（无台词）`），导演标注不进台词。
  6. **meta 留存**：集信息行（人物·场景·道具、场景）存为 `segment.meta`，供导入预览参考，不进滚动台词、不污染落盘内容。
  7. **兜底兼容**：找不到可识别表头（无 台词 列表名）的旧表格，退回 `splitTableLegacy`（即原逻辑），保证建华/网恋等旧样本行为不变。
- **兼容性与回归**：全量 27 套件 0 失败（docx_split.test.js 20/0 旧规则锁、docx_shooting_script.test.js 14/0 新规则锁）。真实文档端到端 `splitScripts→commitSplitFromSegments`：拆 10 集、落盘 10 篇、台词总行数 203、每篇内容==该集台词拼接（零丢失/零错位）、meta 全留存。

## 十九、splitDialogueCell 多轮对白粘连修复（2026-09-18，宝哥需求）
- **触发样本**：桌面《建华&小凤的生活81-90.docx》。宝哥发现两处拆分错误：① 第84集结尾「好吧，是我想多了」被拆成两段；② 某大段（粘连）被拆两段、台词高亮后面半截失效。
- **复现**：`extractDocxBlocks`→`splitScripts` 实跑，定位到第84集 R15/R16、第85集 R9、第87集 R9 等多处「同一台词单元格内多轮对白的后一句说话人名字与前一句内容直接粘连（无标点/空格）」的单元格，被 `splitDialogueCell` 错误拆断。
- **旧规则失败根因**：`splitDialogueCell` 把「任意 1–10 中文字 + 冒号」都当说话人，content 用负向前瞻「遇到说话人模式即停」。两个缺陷叠加：① 粘连时（如「我想多了王建华：」）把「前句内容+真实说话人名字」误判成新说话人，并把前句在内容中截断（「怪不」+「得你一有空就看」），污染说话人、高亮后半截失效；② 说话人候选贪婪 `{1,10}`：在「看来是我想多了王建华：」里从「看」贪到「华」成 10 字候选，其前恰是逗号（非中文）→ 误判成有效切分点，把「好吧，」切断。
- **新规则（util.js `splitDialogueCell`，零回归）**：① 说话人候选长度 `{1,10}`→`{1,5}`：真实说话人括号外均 ≤5 字（王建华/杨凤/婆婆/李阿姨），贪婪长候选不再成立；② **左边界断言**：说话人候选前一字符必须是「非中文/非间隔号」（标点/空格/行首）才当切分点，粘连（前一字是中文）不当切分点，整句保留为完整台词（不截断、不污染、高亮正常）；③ 段切片 = 从本切分点到下一切分点（含自带「说话人：」前缀），避免行首说话人冒号被当纯边界丢弃。
- **效果**：全文档扫描 163 个台词单元格，45 个正常多轮对白仍正确拆行、0 个高亮失效残留；粘连实例（第84/85/87集）全部修复为完整一行。第90集广告词口播实测无冒号、本就未被拆（宝哥所述「第90条」粘连实例实际落在第84/85/87集）。
- **测试**：新增 `dialogue_cell_sticking.test.js`（18/0）锁粘连不拆+正常多轮仍拆+长广告词不拆+贪婪候选不拆；全量 27 套件 0 失败（含 `docx_shooting_script.test.js` 14/0、`docx_split.test.js` 20/0 旧规则仍锁）。

## 二十、横屏沉浸 / 无缝衔接默认关闭 / 设置返回半屏修复（2026-09-18，宝哥需求）
- **① 从设置页返回只有半屏（部分机型）**
  - **根因**：本页所有排版都基于 `this.winHeight`（`_parseAndLayout` 里 `effVp = winHeight * 0.52`），而该值原本只在 `onLoad` / `onResize` 里更新。设置页默认竖屏，`navigateTo` 进去后屏幕已被转回竖屏，`navigateBack` 回到提词台要再转回原方向 —— **部分机型这一下不派发 `onResize`**，于是 `winHeight` 停在竖屏旧值，而 CSS 容器是 `100vh` 的真实大小，两者不一致 → 表现为「只有半屏 / 排版错位」。
  - **修复**：新增 `_syncWindowMetrics()`（读 `wx.getWindowInfo()` 强制刷新 `winWidth/winHeight` 与 `navSafeTop/statusBarHeight`），在 `onShow` 的 `_fromSettings` 分支、`_applyOrientation` 之后立即调用；新增 `_scheduleWindowResync()` 延时 400ms 再取一次并按最新尺寸重排，覆盖「`setPageOrientation` 异步未生效」与「压根不派发 `onResize`」两类机型差异。`onUnload` 里掐掉该定时器，避免在已卸载实例上 setData。
- **② 无缝衔接（循环）默认改为关闭**
  - `prefs.js` `DEFAULTS.loop` `true → false`。理由：提词稿是一次性念完的，念到末行就该停住；默认无限循环会让「已读完」的信号消失、末尾台词反复滚回来，反而干扰判断。
  - ⚠️ **迁移注意（重要）**：`load()` 是 `Object.assign(DEFAULTS, saved)`，**已有本地存储（`prefs_v1`）的设备不受默认值改动影响** —— 需点一次「恢复默认设置」，或在设置页 / 提词台菜单「循环」手动关闭。未擅自做一次性迁移，以免覆盖用户主动打开过的开关；是否迁移待宝哥定夺。
  - 同步更新 `bug_fixes.test.js` 中写死旧期望的用例（`prefs.DEFAULTS.loop 默认为 true`）为 `false`。
- **③ 横屏沉浸全屏**
  - 横屏下隐藏：顶栏 `tp-topbar`（含左上「返回」）、常驻浮动「设置」钮、底部整条进度条 → 字幕真正占满屏幕。竖屏行为完全不变。
  - ⚠️ **隐藏后必须保留出口**：若三处全隐，用户既改不了参数也退不出这一页。故菜单内新增一行（仅横屏显示）「设置 / 退出」，抵达方式 = 双击屏幕呼出菜单（菜单本身在横屏仍常驻可用）。
  - 右上角系统胶囊按钮是**原生控件，受框架限制无法隐藏**（这也是 `navSafeTop` 存在的原因）。
- **④ 真实文档复查（又查出并修复 1 个 bug）**
  - 新增通用审查工具 `audit_81_90.js`：`node audit_81_90.js <document.xml 路径>`（docx 需先用 python 解出 `word/document.xml`）。检查项：集数与集号连续性、疑似截断短行、疑似多轮未拆、XML/实体残留、**拆分后重新拼接能否还原原文（丢字检测）**。
  - **新查出的问题**：`splitDialogueCell` 每段都从 `cuts[i]`（说话人起点）开始，导致**第一个切分点之前的文本从未被任何段覆盖，被静默丢弃**。真实样本：环境提示单元格「（环境音：窗外鸟叫、远处邻居家炒菜声）」被输出成「环境音：窗外鸟叫、远处邻居家炒菜声）」，左括号丢失、括号不配对。
  - **修复**：第一段起点改为 `0`（`const start = i === 0 ? 0 : cuts[i]`）—— 切点之前的内容同属单元格文本，必须归属第一段。
  - **两份真实文档复查结果（均 0 异常、全部无损）**：建华&小凤 81-90（163 个含冒号单元格）、好运袁甘哥 81-90（198 个）；两者均拆 10 集、集号 81–90 连续无缺。
  - **测试**：`dialogue_cell_sticking.test.js` 增至 21/0（新增「括号提示左右都保留」与「拆分后拼接可还原原文」两条总闸）；全量 27 套件 0 失败。

## 二十一、超长台词分段后丢失角色（名字+台词高亮中途掉色）修复（2026-09-19，宝哥需求）
- **触发样本**：《建华&小凤的生活81-90.docx》第84集 王建华（画外音）的 **128 字**广告词（「悟空浏览器」那段）。
- **现象**：「名字+台词高亮」模式下，同一句话念到「而且现在大家伙都在追的爆款」起忽然掉色、后半截归类为无角色；而**同集另一句 98 字**的广告词（「全都是免费的」那段）完全正常。
- **根因**：`splitSections` 对 **>120 字**的行会调 `splitLongSentence` 按句末标点切成多段；切出来的**第 2 段起天然不再带「角色名：」前缀**（前缀只在首段）。而 `parseScript` 是**逐段**跑 `role.matchRole` 的 → 后半截匹配失败 → `role=null`。98 字那句没超阈值、整段保留前缀，故不受影响。**字数差 30 字决定了有没有 bug**，这也是「只有个别句子出问题」的原因。
- **修复（engine/parser.js）**：新增 `splitSectionsEx(text)`，返回 `[{text, continued}]`，标出哪些段是「被切出来的延续段」；`parseScript` 改用它，在 `matchRole` 失败且 `item.continued` 时继承上一轮说话人（`lastRole`）。**仅限延续段继承**——普通独立行自身无前缀时行为与修复前完全一致，不会因为挨着一句台词就被凭空染色。`splitSections` 改为委托 Ex 并 map 回纯字符串数组，**对外签名/行为零变更**（它被导出且 `bug_fixes.test.js` 依赖字符串数组）。
- **踩坑记录（务必记住）**：把内部 `sections` 改成对象数组后，`stats` 里两处 `s !== ''` 判空**恒为真** → 空行呼吸点被计入 `sections`，`bug_fixes` 的「stats.sections 不把空行计入段数」挂了。对象元素的判空必须取 `s.text`。注意 `quickStats` 用的是字符串版 `splitSections`，它那里的 `s !== ''` 是对的，**不要一并改成 s.text**（字符串没有 .text，会得到全部 undefined 反而全被过滤）。
- **验证**：第84集该句 6 个显示行全部 `role=王建华`（修复前倒数第 2、3 行为无角色）；两份文档全量扫描后，剩余无角色行均为「（无台词，…）」类**舞台提示**与**纯口播稿**（本就不该有角色），非本次病症。
- **新增工具**：`scan_role_loss.js`（`node scan_role_loss.js <document.xml>`）扫描任意文档「同一句台词中途丢角色」的行数。
- **测试**：新增 `parser_role_continuation.test.js` 13/0 —— 含核心用例（超长句全行同角色、仅首行有前缀）、**防误伤用例**（独立舞台提示行不得被染色）、以及 stats/splitSections 口径回归保护；全量 **29 套件 0 失败**。
- **遗留（未处理，待宝哥定夺）**：**多人齐说**写法「婆婆、儿媳妇：…」`matchRole` 识别不了 → 无角色、不高亮。好运袁甘哥第87集有 1 处。要不要支持「A、B：」这种写法待定。


## 二十、台词零遗漏硬约束与全链路核查（2026-09-19）

**硬约束（宝哥定）**：台词必须完整保留并全部呈现，不得因长度限制、界面空间、
截断、排版或性能被丢弃/省略/合并/摘要。空间不足只能靠**换行、滚动、分页**容纳。

### 已确认并修复的 5 处丢弃/污染（全部有回归锁定 `zero_loss.test.js` 21/0）
1. **「无台词」被误判成表头行** → 它之前的整篇台词被判定为「表头之前」而全丢。
   修：新增 `isDialogueHeaderCell()`，排除否定式「无台词/无对白」、**排除含冒号**、
   长度 ≤8；表头扫描另加「之后必须还剩数据行」约束。
   典型现场：末行是「无台词」时，整表拆出 **0 行**。
2. **列数用前两行长度推断** → 前两行常是单列合并行（集标题/人物行）→ cols=1
   → 台词列定位到第 0 列，拆出来全是镜头号，台词整篇丢失。
   修：新增 `tableColCount()` 取**列数众数**（单列行不参与统计）。
3. **`/人物/` 子串匹配把「人物：杨凤…」当成角色列** → 每行变成「推镜：台词」。
   修：新增 `isRoleHeaderCell()`，要求列名本身（不含冒号、≤6 字）。
4. **无表头表格无条件 `slice(2)`** → 开头两行台词被静默吃掉。
   修：新增 `legacyDataStart()`，逐行判断，**只有确认不像台词才跳过**（最多 2 行）。
5. **落盘失败静默跳过**（`_savePartsAsFolder` 只 `if (r.ok) ok++`）
   → 10 集存 7 集，用户只看到「导入 7 集」。
   修：收集 `failed` 明细并返回 `warn`，调用方（index/preview）补一条提示 toast。

### 已核查确认「不是丢弃」的行为（有意过滤，保留现状）
- 源数据显式标注「无台词 / 无对白 / —」的占位行不进台本（不是台词）。
- 舞台/音效提示「（环境音：…）」「（静场三秒）」按内容保留（不是丢弃）。
- 标题截断 `TITLE_MAX_LEN=30`、列表预览 `slice(0,40)`、复盘统计保留 30 条 —— 均非台词正文。
- 渲染层 `visibleLines = displayLines.slice(start, start+count)` 是**虚拟滚动窗口**，
  数据层 `allLines` 全量、`contentHeight` 覆盖全部行，滚动可呈现每一句 → 合规。

### 验证工具与结果
- `zero_loss_audit.js <document.xml> …`：真实文档端到端（ZL1 源台词全覆盖 /
  ZL2 Legacy 跳行 / ZL3 落库→解析字符级全等 / ZL4 顺序一致 / ZL5 段落稿）。
  两份真实文档：建华 81-90（159 条）、好运袁甘哥 81-90（186 条）**全部零遗漏**。
- `fuzz_zero_loss.js [轮次] [表格数] [种子]`：随机对拍，源台词列用**生成时的
  ground truth**，不复用被测代码的推断。累计 7 轮、约 1.2 万表格、
  **5 万+ 条源台词零遗漏 / 零污染 / 零丢字**。
- 全量 **30 套件 0 失败**。

### 方法论教训（跨项目复用）
- **检测器的判定本身会错，而且常常错得和被测代码一模一样**。第一版审计器复现了
  被测代码的列推断（`(rows[1]||rows[0]).length`），于是自己也算错列，报出 47% 假阳性。
  修法：**源集合必须用生成时的 ground truth，绝不复现被测代码的推断逻辑**。
- 随机测试的价值在补真实数据覆盖不到的分支：本次 5 个缺陷里 4 个（表头误判、
  列数推断、角色列、前导跳行）**在真实文档上一次都没触发**——真实文档都走有表头路径。
- 区分「丢弃」与「有意过滤」：零遗漏管的是台词，不是所有单元格。
  不先把「无台词/舞台提示/标题」排除，审计结果全是噪音。


## 二十二、大规模随机表格数据端到端验证 + B1/B2 两处真缺陷修复（2026-09-19）

宝哥需求：基于两份真实脚本（建华&小凤 81-90、好运袁甘哥 81-90）生成**大规模随机
台词表格样本**（≥50 组），做端到端验证，四项按优先级：V1 台词零遗漏 / V2 智能拆分 /
V3 人物识别 / V4 显示正确；并要求「实机」验证而非静态分析。

### 交付脚本（均在项目根目录，可复现）
| 脚本 | 作用 |
|---|---|
| `gen_table_cases.js [组数=64] [种子=20260919]` | 随机台词表格样本生成器（mulberry32 可复现），8 大场景均分：S1 多人物交错 / S2 单人连续 / S3 超长 / S4 特殊标点换行 / S5 空行空单元格 / S6 缺列 / S7 异常格式 / S8 混合 → `testcases/cases.json`（含 Ground Truth） |
| `build_case_docx.py` | 逐组构建**真实 .docx**（OOXML 表格、`<w:br/>` 软换行、缺列、空单元格）→ `testcases/docx/CXXX.docx` |
| `e2e_table_verify.js` | 端到端验证：真实 docx → `extractDocxBlocks` → `splitScripts` → store 落库 → **真实页面模块** `teleprompter.js` 的 `onLoad/onReady` + 伪时钟 → 四项判定 |
| `real_docs_verify.js <a.docx> [b.docx]` | 两份真实脚本送同一套四项判定 |
| `table_split_e2e.test.js`（新增回归，17/0） | 锁定 B1 / B2 两个修复 |

### 本轮查出并修复的 2 个真实产品缺陷（`miniprogram/utils/util.js`）
- **B1 表头之前的台词行被整体丢弃**。原逻辑 `dataRows = rows.slice(headerIdx+1)`，
  表头不在首行时，表头上方所有台词全丢。证据 C053：表头在第 4 行，第 3 行 102 字台词消失。
  修：新增 `headerPreDataStart(rows, dialogueCol, headerIdx)`，取表头之前**确认为台词**的
  起始行，拼成 `rows.slice(fromRow, headerIdx).concat(rows.slice(headerIdx+1))`
  ——注意**必须排除表头行本身**，否则表头文字会被当成台词（第一版修复的副作用）。
- **B2 无表头（Legacy）路径不按说话人拆分单元格**。有表头时会 `splitDialogueCell()` 拆成
  多行，无表头时整格塞一行，导致同一格里两人的台词**全部归给第一个人**。
  最小复现：同一份数据，有表头拆 2 行、无表头拆 1 行；7 个样本共 200 条错配。
  修：Legacy 路径同样走 `splitDialogueCell` + 逐行 trim 入栈。

### 验证结果
- 随机数据：**5 个种子 × 80 组 = 400 组**，Ground Truth 台词合计 **5424 条**
  （各种子 GT 条数 1049 / 1109 / 993 / 1130 / 1143，确认种子真实生效），
  **V1/V2/V3/V4 四类问题全部 0**。
- 真实文档：建华 81-90（10 集 / 159 条）、好运袁甘哥 81-90（10 集 / 186 条），
  **四项全部通过**（缺失 0，真错配 0；「粘连」5/2 属第十九节已知行为，非错配）。
- 全量回归 **31 套件 0 失败**；新增 `table_split_e2e.test.js` 17/0。

### 关于「实机测试」的限制（必须如实记录）
`/Applications/wechatwebdevtools.app` 安装不完整（`app.asar` 缺失、
`package.nw/consistency.dat` 缺失），CLI 需 IDE 内手动开启端口，且授权要求 TTY，
`script -c` / `printf y` 管道均无效 → **无法真机/模拟器启动**。
替代方案（已做到最接近真机）：真实 .docx 走完整数据链路 + 真实页面模块
（require `teleprompter.js` + mock `wx`/`getApp` + 生命周期 + 伪时钟 `stepFrames`）
+ 真实 WXSS 渲染数据逐项核对。**UI 真机观感仍需宝哥本人在开发者工具/手机上看一眼。**

### 方法论教训（延续第二十节）
- **纸面通过的验证可能是假的**：`e2e_table_verify.js` 里 `seed` 变量读自 `argv[2]`
  却从未使用（只读已有 `cases.json`），导致「5 种子 × 80 组」实际是同一批数据跑 5 遍。
  教训：**跑「多轮/多种子」时必须先确认每一轮的输入真的变了**——用输出里的
  GT 条数/样本指纹是否变化来反证，不能只看命令行参数传了没有。已删掉该失效参数并改写用法注释。
- **生成器自己也会造假阳性**（连续 4 轮才收敛）：正文含「：」与说话人前缀混淆；
  缺列时把台词列删没了；表头含「人物」列时该列填噪音「2」造出「2：小姑子：台词」；
  表头前数据行列数与表头不一致（C055）。教训：**随机样本的合法性要由生成器保证，
  一旦生成器产出的输入本身不合法，报出来的问题全是噪音**。
- **验证器的断言同样要审**：V1 重复判定曾硬编码「出现 1 次」（语料天然重复 → 假阳性）；
  V3 用全局 `indexOf` 映射会把重复语料映射错单元（改顺序游标）；
  V4 首屏首行比对用 `body` 孤匹配（不含角色前缀，改用 `rolePrefix+body`）。


## 二十三、Git 基线提交 v1.0.0（2026-09-19）

### 1. Git 基线
- 仓库此前只有 1 个 `Initial Commit`、**0 个标签、无远端**，故以 `v1.0.0` 起版
  （与 `miniprogram/config.js` 的 `APP_VERSION='1.0.0'` 对齐）。
- 提交 `2038843`：「fix(台本拆分): 修复表头前台词丢弃与无表头不拆多说话人，补齐大规模随机数据端到端验证」
  （73 文件，+9749/-681）。附注标签 `v1.0.0` 指向该提交。
- `.gitignore` 新增 `testcases/`（1.2MB cases.json + 162 个 docx/xml，可由
  `gen_table_cases.js` + `build_case_docx.py` 重新生成，不入库）。
- **推送未完成**：仓库无 remote（`git remote -v` 为空）。需要远端时先 `git remote add`，再
  `git push origin master && git push origin v1.0.0`。
- 排障：`.git` 里有 2026-09-06 崩溃残留的陈旧 `index.lock` / `refs/tags/*.lock`，
  备份到 `/tmp/gitlock_bak/` 后清除。注意**备份文件不要放进 `.git/refs/tags/`**——
  会被 git 当成标签引用（`v1.0.0.lock.stale.bak` 曾变成一个「标签」）。

### 2. 粘连问题：本轮明确不修
已知「同一单元格内多人台词未拆行」保持现状，未改 `splitDialogueCell` 及任何相关逻辑。

### 3. 「逐段」滚动方式：已彻底下架（本节第 3 条的「新增」已被后续撤销）

设置页曾在 2026-09-19 短暂加过第三档「逐段」（`page`），同日决定彻底下架。
**当前状态：滚动方式只有 smooth（匀速自动）/ voice（声控跟读）两种。**

删除范围（详见第二十四节）：常量枚举 `SCROLL_STYLES` 的 page 项、配置项 `paragraphPause`、
常量与导出 `PAGE_PAUSE_DEFAULT`、设置页 `SCROLL_MODE_OPTIONS` 的「逐段」档与映射分支、
提词台的 page 分支与相关注释、专项测试 `scroll_mode_page.test.js`。

数据兼容：历史本地存储里的 `scrollStyle:'page'` / `scrollMode:'page'` 由
`prefs.load()` 的 `normalize()` 统一回落为 `smooth` / `auto`，老用户不会卡在已下架状态。


## 二十四、「逐段」(page) 滚动方式彻底下架（2026-09-19）

宝哥决定彻底下架，删除全部相关内容。**当前滚动方式只有两种：smooth 匀速自动 / voice 声控跟读。**

### 删除清单
- `miniprogram/engine/prefs.js`
  - `SCROLL_STYLES` 删除 `{ key: 'page', label: '逐段' }`（剩 smooth / voice 两项）
  - `DEFAULTS` 删除 `paragraphPause`
  - 删除常量 `PAGE_PAUSE_DEFAULT`（含注释）及其 `module.exports` 导出
  - 相关「三种滚动方式」注释改为两种
- `miniprogram/pages/settings/settings.js`：`SCROLL_MODE_OPTIONS` 删「逐段」档；
  `onTapScrollMode` 映射改回 `v === 'voice' ? 'voice' : 'smooth'`
- `miniprogram/pages/teleprompter/teleprompter.js`：
  `scrollStyleOptions` 去掉 `filter((s) => s.key !== 'page')`（现已是死代码）；
  `_applyScrollStyle` 改回 `key === 'voice' ? key : 'smooth'`；
  toast 三元去掉 page 分支；清理 5 处「三种滚动方式 / 逐段」注释
- `miniprogram/pages/teleprompter/teleprompter.wxml`：菜单注释去掉「逐段推进已移除」字样
- `scroll_mode_page.test.js`：**整个文件删除**（专为逐段写的 15 项测试）
- `round23.test.js`：`SCROLL_STYLES 含 3 种` → `含 2 种`；删除「切到逐段」用例与头部说明

### 数据兼容（重要）
历史本地存储可能存着 `scrollStyle:'page'` / `scrollMode:'page'`。
`prefs.js` 新增 `normalize()`，在 `load()` 读取侧统一回落为 `smooth` / `auto`，
**一处解决所有读取路径**，老用户不会卡在已下架状态。
提词台 `onLoad` 不再需要本地 `if (style === 'page') style = 'smooth'` 兜底（已删）。

### 新增回归
`scroll_mode_no_page.test.js`（20/0）：锁枚举不含 page、`paragraphPause` 与
`PAGE_PAUSE_DEFAULT` 已清除、设置页仅两档、交互不产生 page、历史 page 被归一化、
提词台菜单两档且强行传 page 会回落 smooth。

### ⚠️ 搜索时的语义陷阱（下次注意）
「逐段」在本项目有**两种毫不相干的含义**，全局搜会混在一起：
1. **滚动方式** `page`（本次删除对象）
2. **角色推导的「逐段」**：`parseScript` 逐段跑 `role.matchRole`、
   `splitLongSentence` 切出的「第 2 段」等——分布在 `parser.js`、`audit_context_loss.js`、
   `parser_role_continuation.test.js`、`同类问题全量排查报告.md`。**这些一律不动。**

另有两个形近但无关的、不能删：
- `engine/scroll.js` 的 `pauseFor(ms)`：引擎通用暂停能力，`engine_scroll.test.js` T4 有独立覆盖
- `teleprompter.js` 的 `_pauseForStats()`：统计相关，与滚动方式无关
- `edit.wxml` 的 `class="page"`、`sitemap.json` 的 `"page": "*"`：与滚动方式无关


## 二十五、台词展示 5 项调整：纯净显示模式 + 角色显示选择降级 + 智能总闸（2026-09-19）

宝哥需求 5 条，核心矛盾是「观看时屏幕要干净」与「智能过滤可能漏词」。
方案：**把智能功能从主线上挪开，并给它一个总闸**。

### 需求 1 · 纯净显示模式（横屏与竖屏一致）
**屏幕上只留「台词文本 + 底部进度条」**，其余控件一律跟随 `showControls` 显隐。

改动落点：
- `teleprompter.wxml`
  - 顶栏 `wx:if="{{showControls}}"`——**去掉原先的 `&& orientation !== 'landscape'`**，
    这是「横竖屏表现不一致」的根源（横屏曾把顶栏整条藏掉，竖屏常驻）。
  - **删除常驻浮动「设置」浮钮**（`tp-float-settings`）。它原本是播放时顶栏隐藏后的备用出口。
  - 进度条 `<view class="tp-progress-wrap">` **去掉 `wx:if="{{orientation !== 'landscape'}}"`**，
    改为横竖屏常驻（横屏仍保留 `tp-land` 小尺寸 + 50% 透明）。拖动定位逻辑一个字未改。
  - 声控条 `wx:if="{{voiceEnabled && showControls}}"`，与其它浮层同进退。
  - 菜单底部「设置 / 退出」那一行**去掉 `wx:if="{{orientation === 'landscape'}}"`**，
    成为横竖屏统一的出口；引导文案里「右上浮钮」的说法同步改掉。
- `teleprompter.wxss`：删除 `.tp-float-settings`（含 `.tp-land` 变体与 `.tp-dim` 组合选择器）
  与 `.tp-voice--low`；清理早期遗留的 `.tp-role-filter-row / .tp-role-chips / .tp-role-chip`
  死代码（菜单角色筛选板块早已下架，样式一直没删）。

**未动**（严格保持原有逻辑）：`onTapScreen` 单击=暂停/继续、双击=呼出/收起菜单的语义，
滚动引擎 `engine/scroll.js`，进度条 `onSeekChanging/onSeekChange`，以及 6 秒自动隐藏
`MENU_AUTO_HIDE_MS` + `_scheduleAutoHide`。
→ 「控件可通过点击屏幕短暂唤出、停止操作自动隐藏」由**双击呼出 + 6 秒无操作自动收起**承担。

### 需求 2/3/4 · 角色显示选择降级为次级入口 + 精简 + 风险说明
- 入口改为**默认折叠**的一行（`rolePanelOpen`，默认 `false`）：小字、次级色、无粗体标题，
  不再与「角色高亮」并列为一级区块。折叠行右侧常显状态（`roleDisplaySummary`：
  「全文」或「仅 N 个角色」），**避免配置了过滤却看不见自己的配置**。
- 展开后面板精简为四块：漏词风险说明 → 一键关闭智能功能 → 快捷操作（显示全文 / 全选）
  → 紧凑角色列表。删除原「role-display-hint」那段冗长说明与 `.role-display-title` 一级标题样式。
- 新增 `.role-risk` 暖色警示块：**「⚠️ 可能漏词——开启后只显示勾选的角色，其余台词不会出现」**。

### 需求 5 · 一键关闭智能功能（漏词兜底）
- 配置：`prefs.js` 新增 `smartOff: false`（全局）。编辑页「角色显示选择」与设置页
  「高亮与辅助」两处入口**同源**（后者复用通用 `onToggle` 的 `data-key`，零 JS 改动），
  不会出现两处状态矛盾。
- 生效点（提词页两处，**缺一不可**）：
  1. `_parseAndLayout()`：`roleHighlight: smartOff ? false : ...`，且
     `this.roleFilter = smartOff ? null : this._roleDisplayFilter()`、
     `displayLines = smartOff ? allLines : filterLinesByRole(...)`。
  2. `_applyRoleFilter()`：开头补 `if (prefs.smartOff) this.roleFilter = null`。
     **这是容易漏的一条**——`onSetRoleFilter` 会直接改 `roleFilter` 并重算 `displayLines`，
     只兜底 `_parseAndLayout` 的话，程序化设过滤仍能把台词滤掉、绕过总闸。
- 关闭后恢复原有一切行为（过滤、高亮按原配置生效），**不破坏任何已有配置**。
- 智能关闭时编辑页面板隐藏过滤操作区（改为提示「已关闭，提词页将完整显示全部台词」），
  避免「点了却不生效」的困惑；`roleDisplayNames` 仍照常保存，关掉开关即恢复。

### 验证
- 新增 `round27.test.js`（**31/0**）：纯净模式的 DOM/样式静态断言（顶栏/浮钮/进度条/声控条/
  菜单出口/引导文案）+ smartOff 行为断言（displayLines 恒等 allLines、无角色染色、
  **`onSetRoleFilter` 也被兜底**、关闭后恢复过滤）+ 编辑页折叠/展开/摘要/开关读写。
- 全量回归 **33 套件 0 失败**。

### ⚠️ 本轮踩到的工具坑（重要，写下来）
**同一条消息里并发多个 Edit 改同一个文件，只有最后一个真正落盘**——前面几个会「假成功」
（返回 Successfully edited，但文件内容没变）。本轮 `edit.js` 的两处（data 字段、
`_syncRoleDisplayItems` 摘要）与 `teleprompter.wxss` 的两处（删死代码、改注释）都因此静默丢失，
是回归测试把它们抓出来的。**对策：同一文件的多处修改串行发，或直接用一个
Python 读-替换-写脚本 + `assert s.count(old)==1` 一次做完。**

## 二十六、解析器「台词粘连」根因修复 + 高亮设置迁移 + 智能总闸联动（2026-09-19，宝哥需求）

### 一、结论先说：「粘连」不在文档里，在解析器里
宝哥点名「第84条 + 第11/12段」人物与台词粘成一行。**导出 docx 底层 XML、核对 10 张表的 736 个单元格**后查明：
- 原文档**本来就带 `<w:br/>` 软换行**——同一格里的两人台词正是靠软换行分行的
  （例：第84集 R15「杨凤：…看 `<w:br/>` 王建华：我这几天…」）。
- `utils/util.js` 的 `extractWtText()` 只 `match <w:t>`，把 `<w:br/>` 与单元格内多 `<w:p>` 边界**一并吞掉**，
  于是同一格的两句被拼成一行 —— **这才是「粘连」的真相**。
- ⇒ 正确修法是**修解析器，不是改文档**。真去拆格会毁掉 10 集台词与版式（错误示范见「走过的弯路」）。

### 修法（`extractWtText`）
`<w:t>` 取文本 + `<w:br/>`（成对或自闭合）还原为 `\n` + 单元格内多个 `<w:p>` 之间补 `\n`：

```js
const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/?>/g
let t
while ((t = re.exec(paras[i])) !== null) {
  out.push(t[1] === undefined ? '\n' : t[1])   // <w:br/> 落成换行
}
```

### 二、文档只补了 4 处真缺的句末标点
还原到原始备份后逐字比对，**只有 4 处**句末缺标点（与粘连无关）：
第84集 R15「…看」→「…看。」· R16「…我想多了」→「…我想多了。」·
第85集 R9「…再去看」→「…再去看。」· 第89集 R20「…洗点葡萄啊」→「…洗点葡萄啊。」
用 `doc_find_and_replace` 精确替换，**净增 4 个字符**；736 单元格 / 74 个 `<w:br/>` / 10 表 199 行结构**零改动**。
备份：`…/_修复前备份_20260919/建华&小凤的生活81-90.原始.docx`

### 三、高亮设置迁移 + 智能总闸联动
- 设置页**移除**「高亮方式」区块（wxml + js 的 `roleModeOptions` / `onTapRoleMode` 一并清理，无悬空引用）。
- 编辑页「角色显示选择」面板内**新增**「角色高亮」一键关闭开关 + 「高亮方式」二选一
  （名字高亮 / 名字+台词高亮）。
- 联动（核心不变式：**总闸开 ⇒ 高亮必关**）：
  - `prefs.js` 新增 `smartOffSaved`（开闸前的高亮配置快照）。
  - `normalize()` 读取侧兜底：总闸开则关高亮并存快照；总闸关且有快照则**按快照恢复**高亮并清快照。
  - 新增 `smartPatch(cur,key,on)`：统一处理 smartOff 开/关，以及「总闸开着时手动开高亮 ⇒ 自动解除总闸」。
  - `patch()` 写入前也 `normalize()` —— 防绕过 `smartPatch` 的写入把状态卡住（这是 round27 那 1 条失败的真因）。
- 两个开关（总闸 / 角色高亮）+ 高亮方式，在设置页与编辑页**两处入口状态始终一致**。

### 四、验证
- `glue_fix_verify.js <after.docx> <before.docx>` 三项全通过：
  ① 粘连扫描 0 处 ② 压平后 0 丢字（仅 4 处补标点）③ 同文档两种解析行为 556 行 → 626 行（多还原 70 行）。
- `round28.test.js` **32/0**：28-A 解析器换行还原（8）· 28-B 高亮迁移（7）· 28-C 联动（17）。
- 全量回归 **34 套件 0 失败**。

### 五、走过的弯路（勿重犯）
1. 起初用 `doc_set_table_cells` + `\u000b` 把 49 个「粘连格」拆成 117 行写回文档 —— 验证发现
   「压平后与原文字面差 52 处」，才反查出**文档本没粘、根因在解析器**。
   **先定位根因再动手，否则会改坏不可再生的数据。**
2. 编辑器「保存即规范化」：`<w:sz>` 893→701、空 `<w:r/>` 被清 —— 实测「原样保存」也会发生，
   属编辑器固有行为，非改动副作用，别误判成自己改坏的。

## 二十七、表格剧本「解析准确性」四项修复（2026-09-19，宝哥需求）

宝哥口径：**「文档不需要你动，我的目的是让小程序分析这类数据准确一点。」**
→ 子文档已还原为原稿（撤销上一轮那 4 处句末标点），本轮**只改小程序**。

### 方法（可复用）：拿真实文档走完整链路对账
新增两个诊断脚本（项目根，只读、不写任何文件）：

| 脚本 | 作用 |
|---|---|
| `diag_accuracy.js <document.xml>` | 逐格对账「源台词列 → 解析输出行」：粘连扫描 / 内嵌换行 / 压平零丢字 / 非台词混入 |
| `diag_parse.js <document.xml>` | 走完整链路 `splitScripts → parseScript`：角色分布 / 无角色行 / 可疑角色名 |

用法：Python `zipfile` 解出 `word/document.xml` 到 /tmp，再 `node diag_xxx.js /tmp/x.xml`。

### 实测出的 4 处缺陷

| # | 缺陷 | 真实证据 | 修法 |
|---|---|---|---|
| P1 | 单元格内**软换行第二句没拆** | 第87集「婆婆把汤往杨凤面前推了推：先喝口热的。」与上句粘成一段 | `splitDialogueCell` 改为**先按 `\n` 拆段**，再在段内按说话人拆（抽出 `splitDialogueCellSingle`） |
| P2 | **垃圾角色名**混进角色列表 | 角色表里出现 `无 ×1`、`（环境音 ×1`（名字带左括号！） | `isValidRoleName` 的标点判定**补上括号**；`FILTER_WORDS` 补「无/空/略/环境音/背景音…」 |
| P3 | **「名字+动作描述+冒号」丢角色** | 同上那句 → `role=null`：不高亮，且因无角色行「恒保留」而**躲过角色过滤**（漏词隐形来源） | 新增 `backfillRoleByKnownName()`：只用已识别角色名在段首回填，限「名字后 ≤15 字到冒号、中间无句末标点」，单行段落顺带切出 rolePrefix |
| P4 | **全称/简称被算成两个人** | `王建华×128` + `建华×7` | `computeAliases(names, manualAlias, counts)` 增「简称归并」：短名是长名**前缀/后缀**、长度差 ≤2、且长名出现次数不少于短名 → 归并（`建华→王建华`）；`小凤/杨凤` 非前后缀，不会误并；手动 `roleAlias` 仍优先 |

P3 放在**别名归并之后**执行，用到的就是归并后的标准名，回填结果与角色列表天然一致。

### 修后对照（真实文档《建华&小凤的生活》81-90，10 表 736 格）

| 指标 | 修前 | 修后 |
|---|---|---|
| 全片角色总数 | 13（含 `无`、`（环境音`） | **11**（垃圾角色归零） |
| 可疑角色名 | `无`×1、`（环境音`×1 | **无** |
| 行内残留换行 | 1 行 | **0** |
| 无角色行 | 6 | 7（多出那 1 行是拆出来的动作描述句，已回填角色） |
| 压平零丢字 | ✅ | ✅（159 源格 → 228 行） |

剩 7 行无角色**全部是舞台说明**（「（无台词，手机屏幕微微照亮她的脸）」「（环境音：窗外鸟叫…）」「（无）」等）——
`role=null` 是**正确**行为：它们既不该染色，也不该被角色过滤吃掉（零遗漏红线）。

### 验证
- 新增 `round29.test.js`：**38/0**（29-A 软换行拆段 10 · 29-B 角色名卫生 9 · 29-C 行首回填 10 · 29-D 简称归并 9）。
- 全量回归 **35 套件 0 失败**。

## 二十八、表格剧本「多人同格」专项检测与随机模糊测试（2026-09-19，宝哥需求）

宝哥口径原文：
> 「重点检查同一对话中出现两个或多个人物同时说话的情况，覆盖多种可能的场景与边界条件，进行反复验证。
> 随后基于检测结果，随机生成结构类似的对话数据，开展多轮测试，以确认该场景下程序处理的正确性与稳定性。」

→ 仍是**只改小程序**（文档已还原为原稿，MD5 `a390285d0de36da2da5fae94f1f8f7a2`）。

### 一、检测：真实文档的多人同格普查（新增 `diag_multi.js`，只读）

`node diag_multi.js /tmp/jsxf_doc.xml`（xml 用 Python `zipfile` 从 docx 解出）。

真实文档《建华&小凤的生活》81-90：10 表 / 736 格 / 74 个 `<w:br/>`；**台词列 174 格，其中多人同格 49 格**
（2 人 ×35 · 3 人 ×9 · 4 人 ×5）。**四项检查 332 条断言 0 失败**：

| 检查 | 含义 | 结果 |
|---|---|---|
| M1 行数守恒 | 解析行数 ≥ 文档行结构（不许丢行） | 失败 0 格 |
| M2 零丢字 | 各段拼接压平 == 原文压平 | 失败 0 格 |
| M3 无粘连 | 任一段内不得再出现第二个真说话人 | 失败 0 段 |
| M4 归属正确 | 每段要么能识别角色，要么是舞台说明 | 失败 0 段 |

**结论：真实稿件的多人同格全部靠 `<w:br/>` 软换行分隔，处理完全正确。** 49 格 / 174 格全部过关。

### 二、边界写法：查出 1 条真缺陷（本文档没出现、但现实中会有）

末节列 25 条边界写法逐条验证。查出：

> **联合说话人被切碎**：`王建华、杨凤：我们一起回来了。` → 切成 `王建华、` + `杨凤：我们一起回来了。`

一行两人齐声的台词，被当成「杨凤单独说话」，前一行只剩半句残词。
根因：说话人左边界规则只要求「前一字符**非中文**」，而顿号 `、` 与连接词 `和/与/及/跟/同` 恰好满足这一条。

### 三、修复：三轮迭代才收敛（`miniprogram/utils/util.js`）

| 轮次 | 做法 | 结果 |
|---|---|---|
| 第 1 轮 | 看切点左侧是并列连接 → **一律不切** | 残句没了，但**漏切**：`…追剧还儿子、王建华：明天还得早起。`（真粘连 + 联合）两行粘成一行，模糊测试 IM1 抓到 |
| 第 2 轮 | **切点左移**到联合组最前面（`resolveJointCut`） | 段首组左移到 0 仍是一行；真粘连组左移到「儿」前正好断开。**但三人联合只移了一级** |
| 第 3 轮 | 左移改成**循环**（最多 8 级） | `王建华、杨凤、婆婆：` 连移两级到位 ✅ |

最终规则是三态，不是「切 / 不切」两态：

| 切点左侧 | 语义 | 处置 |
|---|---|---|
| 不是并列连接 | 普通切点 | 照旧 |
| 是并列连接，且连接词左侧**是**白名单名字 | 联合说话人组（A、B：） | **切点左移到组的最前面** |
| 是并列连接，且连接词左侧**不是**名字 | 正文里的并列标点 | **切点作废**（整格不切） |

第三态的意义：`杨凤：他买了菜、王建华：我不去。` 里「了菜」不是名字，那个顿号属正文 →
不切，保持一句完整（切了才会留下「…了菜、」残句）。

### 四、随机模糊测试台（新增 `fuzz_multi.js`）

`node fuzz_multi.js [文档数] [每集行数] [种子]`

- 生成**高保真 OOXML** 表格稿（真 tblPr/tcPr/rPr、随机 run 切分、`<w:br/>` 自闭合与 `textWrapping`、段落边界、XML 实体），跑完整链路 `extractDocxBlocks → splitScripts → parseScript`。
- **8 种分隔策略**随机混用：`br1 / br2 / brAlt / para / punct / space / glueWl(真粘连) / glueFk(假说话人)`。
- 另有一类**行形式** `joint`（联合说话人），与分隔策略正交。
- 每行都带「标准答案」（谁说的、应是第几行），逐行回验。
- **7 条不变量**：IM1 行数守恒 · IM2 零丢字 · IM3 无粘连 · IM4 归属正确 · IM5 角色名卫生 · IM6 分隔方式等价 · IM7 白名单覆盖。
  （IM4 对联合行单独放宽为「不许凭空造出含并列标点的怪角色名」——归属由角色识别层决定，不属拆分器职责。）

**结果矩阵（全部 0 类失败）**：

| 文档数 × 每集行数 | 种子 | 断言次数 | 结果 |
|---|---|---|---|
| 1000 × 6 | 20260919 | 118129 | ✅ |
| 500 × 4 | 1001 | 59738 | ✅ |
| 500 × 8 | 2002 | 59738 | ✅ |
| 500 × 12 | 3003 | 59738 | ✅ |
| 500 × 10 | 5005 | 59738 | ✅ |
| 200 × 20 | 6006 | 24598 | ✅ |
| 300 × 4 / 8 / 12 | 1001 / 2002 / 3003 | 36 万级 | ✅ |
| 200 × 3 | 7007 | 24598 | ✅ |

合计 **3300+ 篇随机文档、40 万+ 断言，0 失败**。

⚠️ **这套测试台的价值已经被证明**：第 1 轮的「一律不切」在真实文档的 49 格上全过，
是模糊测试台**在复合场景里抓出了漏切**。真人手写的边界用例想不到「真粘连 + 联合说话人」这种组合。

### 五、回归锁定

新增 `round30.test.js`（**35/0**）：
30-A 联合说话人整组不切开（10）· 30-B 切点左移（6）· 30-C 连接词左侧不是名字 → 作废（4）·
30-D 与引号引用/普通多人互不干扰（7）· 30-E 白名单「优先≠越权」（3）· 30-F docx 端到端（5）。

全量回归 **34 套件 0 失败**（`bug_audit.test.js` 是审计型脚本、`role_highlight_select.test.js` 已废弃跳过）。

### 六、三个坑（勿重犯）

1. **联合行的名字必须已在「物理行首」露过面才进得了白名单。**
   `collectSpeakerNames` 只认「行首 ≤5 字 + 冒号」，而「王建华、杨凤：」不以「王建华：」起头 →
   联合行自己贡献不了白名单。模糊测试台里必须从「已 heads 登记过」的名字池里挑 joint 成员，
   否则「已进白名单也不许切开」这条守门断言形同虚设。
2. **中文连接词（`和`/`还有`）在 `role.js` 层会被整体识别成一个角色名**（「张阿姨和儿媳妇」），
   与顿号的处理不一致（顿号含标点，被判非法角色名 → 回退成第一个名字）。
   这是角色识别层的既有行为，**不属拆分器**。真实文档实测 0 处，暂不处理；
   拆分测试台里 joint 只生成顿号形式，避免把两层混在一起。
3. **诊断/测试的判定函数必须与产品同源。** `diag_multi.js` 初版自己写了一套「左边界非中文就切」
   的简化规则，结果把产品**故意不切**的两处（引号内引用、并列连接后的联合说话人）误报成「粘连」。
   现已直接调用产品的 `insideQuote` / `jointSpeakerBefore` / `resolveJointCut`，并同样带白名单。

### 七、副产物：诊断脚本升级

`diag_multi.js` 边界写法由 18 条扩到 **25 条全通过**，并改为**在真实上下文（带白名单）下跑**
 —— 真实链路 `collectSpeakerNames` 就是从全稿预扫，测试条件必须一致。
M1 的判据也从「严格相等」放宽为「**实际行数 ≥ 文档行结构**」：
文档把两人写在同一物理行（真粘连）时，产品按白名单拆成两行正是我们想要的行为，不该算失败。

---

## 二十九、悟空脚本专属拆分：把「台词栏复制」做成第四种拆分方式（2026-09-19，宝哥需求）

**任务原话**：分析原始文档中「拆分步骤1：把台词栏进行复制得出结果」的整理逻辑，抽象归纳成明确可复用的
拆分机制（复制规则 / 字段映射 / 结果结构），作为第四种拆分方式接入台词拆分页（按钮排在现有三种下方，
命名「悟空脚本专属拆分」），并把同一逻辑融入智能多模态拆分、保证两者行为一致；随后用原始文档验证，
再随机生成台词数据做多轮拆分与功能测试。

### 一、机制是从哪三个文件反推出来的

宝哥给的三份文件恰好是同一条流水线的三个断面：

| 文件 | 是什么 | 在链条里的位置 |
|---|---|---|
| `建华&小凤的生活81-90.docx` | 10 个表格、每表一集：R1 集名（单格）／R2「人物｜场景｜道具」摘要（单格）／R3 表头 **镜头 · 画面/动作 · 台词 · 备注**／R4+ 数据 | **源稿** |
| `转表格拆分.xlsx` | 同内容的工作表版：A 镜头号、B 画面、C 台词、D 备注；集名 / 摘要各占一行 | 源稿的另一种载体 |
| `最终台词.docx` | 283 段：集名行 →（「台词」列名行）→ **台词栏逐行**，10 集，集间空段 | **「拆分步骤1」的产物** |

「拆分步骤1」这几个字在三份文件里都搜不到 → 它是宝哥对**人工操作动作**的口头命名。
所以机制是**从产物反推规则**，而不是抄某处说明。

### 二、归纳出的拆分机制

**复制规则**

1. 一集 = 一个表格。逐表独立处理，表格顺序 = 集顺序。
2. **字段映射：只取「台词」列**。`镜头`／`画面 / 动作`／`备注` 三列与「人物｜场景｜道具」摘要行
   一律不进结果（它们不是台词）。
3. **行序**：严格按表格行序自上而下；**单元格内部**若含多个软换行（`<w:br/>`）或多个段落（`<w:p>`），
   按出现顺序拆成多行。
4. **内容原样**：不做语义清洗 —— 占位行（`（无台词）`／`（无对白）`／`—`）与空行**忠实保留**。
   这是「复制」不是「提纯」。只做两件事：清掉**行尾**空白（不把源文档的尾随空格带进提词器）、
   **折叠连续空行**为 1 行；整集**末尾**空行去掉、**首部**空行保留
   （首部空行标记「这一行画面没有台词」，是有意义的位置信息）。

**结果结构**

```
segment = {
  ep, epNo,               // 第几集 / 从集名解析出的集号
  name,                   // 集名（取表格 R1 集信息行）
  column: '台词',          // 来源列名（**只作元数据**，不混进正文）
  wukong: true,           // 标记来自悟空规则
  source, lineRange,      // 溯源：表N R起~R止
  lineCount, lines: [...]  // 台词栏逐行
}
```

渲染 / 落盘时正文 = `lines.join('\n')`，**不含**「台词」列名 —— 样张把「台词」两字写进了正文
（81 集独立成一行、82–84 集缀在集名后），规范化时统一剥掉：提词器会把「台词」念出来。

**两条归一化决策**（样张是人工粘贴、带手工痕迹，故不逐字复刻）：列名不进正文；空行按
「折叠连续 + 去尾留首」规范化，不拟合样张的随手空行。

### 三、接入方式（第四种拆分方式）

| 位置 | 改动 |
|---|---|
| `miniprogram/utils/util.js` | 新增 `splitTableScriptWukong(tables, headings)`；`splitScripts(blocks, opts)` 支持 `opts.mode === 'wukong'`；新增共用内核 `locateTableStructure`；新增行级占位判定 `isPlaceholderLine` |
| `pages/preview/preview.wxml` | `.bar` 之后新增 `.bar-sub` 一行按钮「悟空脚本专属拆分（N 集）」；未检出脚本表时置灰 + 提示 |
| `pages/preview/preview.js` | `wukongSegmentsOf()` + `onImportWukong()`；落盘复用 `importSave.commitSplitFromSegments`（单一事实来源） |
| `pages/index/index.js` | 解析 docx 时同时算两份：`result`（多模态）与 `wukong`，一起放进 `importPayload` |

### 四、与「智能多模态拆分」的关系：同一内核，只在清洗上分叉

抽出 `locateTableStructure(rows, headingBefore)` 作为**共用内核**：表头行定位、台词列 / 角色列映射、
集标题解析、数据行区间（含「表头前的台词行被救回」）。两种拆分都调它 —— 结构识别永远一致，
行为分叉只有一处：

| | 悟空脚本专属 | 智能多模态 |
|---|---|---|
| 结构定位 | `locateTableStructure` | 同一函数 |
| 占位行（（无台词）/—） | **原样保留** | 过滤 |
| 空行 | 保留（折叠连续、去尾留首） | 丢弃 |
| 说话人拆分 | 只按软换行 / 段落拆 | 额外按「名字：」拆行 |
| 真实稿件实测 | 238 行 | 228 行 |

口径由宝哥拍板为「**内核同源 + 各自微调**」：多模态保持清洗（提词器更干净），悟空专属严格复刻
「复制」语义。

### 五、原始文档验证

新增可复跑脚本 `verify_wukong_sample.js`：源稿 → 悟空拆分 → 与样张逐集逐行比。

```
第1集 建华&小凤的生活81  悟空 28 行 / 样张 28 行   逐行完全一致 ✅
第2集 …82 28/28 ✅   第3集 …83 26/26 ✅   第4集 …84 21/21 ✅   第5集 …85 10/10 ✅
第6集 …86 39/39 ✅   第7集 …87 32/30 非空台词行一致 ✅   第8集 …88 19/19 ✅
第9集 …89 28/29 非空台词行一致 ✅   第10集 …90 7/7 ✅
汇总：10 集 ｜ 逐行完全一致 8 集 ｜ 非空台词行一致 10 集
```

两集（87、89）的差异**全部是空行数量**，非空台词行 100% 逐行一致 —— 手工粘贴的空行分布无从机械
复刻，也不该复刻。

### 六、模糊测试抓出一个真缺陷（本轮最有价值的产出）

新增 `fuzz_wukong.js`：随机表格稿（列数 3~5 随机、台词列位置随机、列名六选一、分隔方式混用、
内容带全局唯一编号 T/S/N 前缀），8 条不变量 —— IW1 集数守恒 · IW2 非空行零丢失且顺序一致 ·
IW3 字段纯净（画面/备注不串列）· IW4 摘要行不入结果 · IW5 占位行保留 · IW6 空行策略 ·
IW7 集名正确 · IW8 双模式同源。

**抓到的缺陷**：

```
一格内容 = 「甲：第一句。\n（无对白）\n乙：第二句。」
多模态修复前 → 整格被丢弃，同格 3 句台词一起消失（零遗漏红线）
```

根因：占位行过滤拿**整格文本**去 `test()` —— `if (/（无台词）/.test(t2)) return`，
一格里只要出现一行占位行，同格其他台词连坐消失。

修法：改成**逐行**过滤，新增 `isPlaceholderLine(s)`（认「（无台词）」「（无对白）」「无台词」
「—」「-」「·」，**不认**「（无台词，手机屏幕微微照亮她的脸）」这类带说明的）；
有表头路径与 legacy 路径一起改。

真实稿件 228 行**未变** → 这份稿没踩到该边界（占位行都是独占一格），但边界写法必须对。

### 七、回归锁定与验证矩阵

新增 `round31.test.js`（**42/42**）：31-A 复制规则（8）· 31-B 内容策略（8）· 31-C 数据行区间（3）·
31-D 内核同源（6）· 31-E 页面接入（12，含 mock 微信环境真跑 `onLoad` / `onImportWukong` 与落盘）·
31-F 占位行不连坐（5）。

| 项 | 结果 |
|---|---|
| 全量回归 | **35 套件 0 失败** |
| 悟空 × 多模态 模糊测试 | 3500 篇 / **112,376 断言** / 0 类失败 |
| 多人同格专项（上一轮） | 332 断言 0 失败 + 边界 25/25 |
| 真实文档对账 | 10 集非空台词行 100% 一致 |

### 八、两个坑（勿重犯）

1. **`zsh` 不对未加引号的参数做分词**：`set -- ${cfg}` 会把整串 `"1000 6 2026"` 当成**一个**
   位置参数 → `$1` 是整串、`$2/$3` 空 → 脚本静默跑 0 次（表现为「断言次数：0 耗时 0ms」）。
   要么 `set -- ${=cfg}`，要么用函数收参。叠加老坑「**变量后紧跟中文会被当作变量名的一部分**」：
   `printf "[$1篇×$2行]"` 同样是错的，必须写 `${1}`。
2. **诊断脚本的判定函数自己也会长出缺陷**：本轮 fuzz 首跑报的 4 类失败里 3 类是判定错
   （`isPlaceholderLine` 把**空行**也当占位行、IW2 拿「含占位行的结果」去比「不含占位行的源」）。
   **先怀疑判定、再怀疑产品** —— 但不能就此收手，剩下那 1 类正是真缺陷。

---

## 三十、台词拆分 P1–P5 修复（2026-09-24）

承接第二十九节（8 类真实样本分类测试）跑出的 5 条缺陷。本轮全部修复。
**硬约束（宝哥指定）：规则修改只改智能多模态，悟空专属拆分规则不得变动。**

### 一、五条修复与落点

| 编号 | 问题 | 改动位置 | 悟空是否经过 |
|---|---|---|---|
| P1 | 智能拆分丢弃首个边界**之前**的内容 | `sliceByBoundaries` 补 0~idxs[0] 前言块 | 否 |
| P2 | 无表头+台词非末列 → **整篇丢失**（红线级） | 新增 `pickDialogueColByContent`，按内容评分选列 | **是** → 参数隔离 |
| P3 | 幕/场在两条文本路径口径不一致 | `findHeadingBoundaries` 改两级 + 新增 `SUB_HEAD_RE` | 否 |
| P4 | 「名｢台词｣」角色归属 0/6 | 新增 `normalizeCornerQuote`（段首/句末才认） | 否 |
| P5 | `无`/`N/A`/`/`/`（无）` 占位未识别 | `isPlaceholderLine` 补形态 + 长度闸 ≤6 字 | 否 |

### 二、悟空零变化是怎么保证的（关键）

五处里四处天然落在悟空不经过的路径；**只有 `splitTableLegacy` 是共用的**。
处理方式：给 legacy 加第 4 个参数 `opts`，`{contentPick:true}` 才启用内容评分。
- 多模态（`splitTableScript`）传 → 生效；
- 悟空（`splitTableScriptWukong`）不传 → 原几何推断，并在调用点写死「⚠️ 悟空规则锁定：不要传」注释。

验证用 `compare_before_after.js`：**从 git HEAD 取旧 util.js 与新版同时加载**，跑同一批输入逐条比 `name+lines` 完整内容（不只看行数）。14 个样本（含真实稿件 91-100）→ **悟空侧变化 0**。

### 三、P3 是一次口径变更（不是纯 bug 修复）

纯话剧（全篇无「第N集」）过去整篇 1 集，现按幕/场拆多篇 —— 由宝哥拍板选定。
为此更新了 `docx_split_real.test.js` 里 4 条记录旧口径的断言，用例内写明了作废原因与日期；
并新增「幕内容不串篇」零遗漏断言。该套件现 27/27。

**两级回退是关键**：一级（集/期/话/卷/部）命中就只用它；二级（幕/场/回/章）仅在全稿无一级边界时
才启用。若一律认幕，混合稿「第1集→第二幕→第2集」会被幕拆碎 —— 这点由 case 12 锁着，必须保住。

> 教训：改动前先确认「老行为是不是**有意设计**」。本次第一版直接把 幕/场 塞进 `EP_HEAD_RE`，
> 立刻被两个回归套件打回 —— 它们记录的正是刻意的设计意图，不是过期断言。

### 四、验证结果

| 项 | 结果 |
|---|---|
| 37 个既有回归套件 | **0 失败** |
| 分类测试台 | **183 通过 / 0 失败**（表格 8/8、文本 9/9、边界 7/7） |
| P1–P5 专项验证 `fixture_findings_repro.js` | **28/0**（升级为带断言的回归） |
| 悟空零变化 `compare_before_after.js` | **14/14，变化 0** |
| 悟空 / 多人同格 模糊测试 | 25,536 + 86,772 断言，0 失败 |
| 真实稿件 91-100 对账 | 悟空 284→284 逐字节一致 |

### 五、遗留

1. **T5b 在悟空侧仍输出 0 行** —— P2 根因同时存在于悟空的 legacy 兜底，按指令未启用。
   将来要放开：在 `splitTableScriptWukong` 那一行的 `splitTableLegacy` 补 `{contentPick:true}` 即可。
2. **91-100 的人工样张没有占位行**，而悟空规则是「忠实保留占位行」——两者存在出入，待定。
3. 源文档已推进到 `建华&小凤的生活91-100.docx`（81-90 那批不在了），
   `verify_wukong_sample.js` 支持传参指定新路径。

### 六、坑（勿重犯）

1. **注释块里千万别写 `** x **`**：`*/` 会提前闭合注释** → 整个文件 SyntaxError。
   本轮在「镜号/画面/**台词**/备注」这个注释里踩了。
2. 用 Edit 替换「函数前的注释块 + 函数签名」时，若 old_string 从 `function xxx(` 起、
   new_string 以 ` * …` 开头，会把 `/**` 吃掉 → 悬空 `*`。改注释务必整块替换。
3. **多模态做了规范化，判定脚本的期望值必须同源处理**：P4 把「名｢台词｣」变成「名：台词」后，
   测试台 Q3 零丢字立刻误报。解法是**源侧也跑同一个 `normalizeCornerQuote`** 再比，
   而不是在 squash 里豁免 `｢｣` —— 后者会掩盖真丢字。
4. 判断「某条老断言是否该改」，先问它锁的是不是**有意设计**。是 → 改的另一方式应是回退；不是 → 才更新。

---

## 三十一、新人引导（Onboarding）尺寸与内容优化（2026-09-28）

项目里**没有独立 onboarding 页**。两处「首次使用引导」内嵌在页面里，都是「只看一次」的
遮罩卡片 + 3 步结构：

| 页面 | 前缀 | storage key | 关闭方法 |
|---|---|---|---|
| `pages/teleprompter` | `tp-guide-*` | `baoge_guide_tp` | `onCloseGuide` |
| `pages/edit` | `ed-guide-*` | `baoge_guide_edit` | `onCloseEditGuide` |

### 一、真问题：提词页横屏会裁掉主按钮

提词页是**横屏**使用的（视口 375px = 750rpx），而原卡片约 **800rpx** 高 →
底部「开始提词」按钮被直接裁掉，用户点不到。缩小的目的就是这个，不是审美。

### 二、改法

1. **等比缩小 0.85**，并把两个引导统一到同一套字号层级：
   标题 34 ｜ 副标 22 ｜ 步骤标题 26 ｜ 说明 21 ｜ 按钮 28（原 40/25/29/23/31 与 40/24/28/22/30 两套）。
   卡片 `max-width` 500→440rpx。
2. **三段式防裁切**（重点）：`max-height:84vh` + `.xx-guide-head` 固定 +
   `.xx-guide-body` 可滚 + `.xx-guide-btn` `flex-shrink:0` 吸底。
   → 任何视口下主按钮永远在最下方可见，位置明确。
3. **文案压缩**：提词页副标「3 步上手：台本自动滚动，你只管念」→「3 步上手，你只管念」；
   第 3 步删掉「纯净模式：屏幕上只有台词和底部进度条…」这整句冗余解释；
   编辑页第 2 步说明砍半。步骤顺序保持「开始 → 控制 → 设置」递进不变。

### 三、易踩的认知（记牢）

**横屏时 rpx 是按屏幕「宽度」换算的**：屏越宽，同样 rpx 的卡片被放得越大，
而横屏视口高反而只有 375px。所以横屏下卡片**必然高于视口**，
靠缩字号是做不到「不滚动」的 —— 正确解法是「缩小 + 内容区可滚 + 按钮吸底」，
而不是一味缩字号。校验脚本 `guide_size_check.js` 就是按这个模型算的。

### 四、验证

新增 `guide_size_check.js`：**从 wxss 真实读取** padding / font-size / line-height /
max-height（不手抄常量，改了 CSS 校验会跟着变），按 11 种机型算实际高度。
结果 **22 个机型组合 0 溢出**：竖屏一屏完整可见；横屏步骤区可滚，标题与主按钮固定可见。

回归：37 套件 0 失败 ｜ 分类测试台 183/0 ｜ P1–P5 28/0 ｜ 悟空零变化 0；
另做了 wxml/wxss 类名对齐检查（无缺失、无死样式）与 view 标签闭合平衡检查。

---

## 三十二、默认值与引导流程调整（2026-09-29）

三项：默认滚动速度 200→50 ｜ 默认高亮 'full'→'name' ｜ 引导流程清晰化。

### 一、⚠️ 最重要的认知：默认值散落在多处，改一处必挂

同一个默认值在项目里**硬编码了三到四处**，只改 `prefs.DEFAULTS` 是不够的：

| 字段 | 落点 |
|---|---|
| `speed` | `prefs.DEFAULTS.speed` ｜ `teleprompter.js` data.speed ｜ `pxPerSecondOf` 的 `|| 200` ｜ `onTapSpeed` 的 `|| 200` ｜ `edit.js` 预估分钟 `|| 200` |
| `roleHighlightMode` | `prefs.DEFAULTS` ｜ `teleprompter.js` data ｜ `edit.js` data.highlightMode |

漏改页面 data → 首帧渲染用旧值、等 `onShow` 同步才跳成新值（闪一下）。
漏改 `|| 200` 兜底 → 值缺失时突然用回旧默认。
为此新增 `defaults_check.js` 把一致性钉死（9 条断言）。

### 二、各项改动

1. **speed 默认 50**（≈30 px/s，@行高 60px 约 2 秒一行）。速度滑块**没有 step**（默认 1），
   所以 50 能精显示、不会被吸附到 40/60。
   ⚠️ 遗留不一致：`SPEED_PRESETS` 是 110/140/200/240，**最小档 110 都比默认 50 快** ——
   用户点「慢速」反而变快。要不要把「慢速」调成 50（或新增「极慢」档）待定。
2. **roleHighlightMode 默认 'name'**（仅名字上色，台词回落正文色）。
   整行染色满屏是颜色、反而看不清谁在说。用户仍可在提词台菜单 / 编辑页切回 'full'。
3. **引导流程**：编辑页把「写台词 / 导入」从并列的两步合并为**一步「准备台词（二选一）」**
   （原来编号 1、2 会让人以为两步都得做），3 步→2 步；提词页副标改成行动指引
   「先点「播放」，其余随时可调」，第 1 步标题改为「点「播放」就开始」。
   另在设置页加 **「重新查看新手引导」** 按钮 —— 引导只看一次、关掉就再也调不出来，
   该按钮清掉 `baoge_guide_tp` / `baoge_guide_edit` 两个标记即可重新显示。

### 三、口径变更动了 3 处老断言（已更新并注明原因）

`engine_prefs.test.js`（默认 full→name）、`round28.test.js` B6（编辑页 data.highlightMode）、
`role_filter_page.test.js`（默认整行着色）。
后者改为：**默认状态下验 name（台词回落正文色）+ 显式切 full 验整行着色** ——
两种模式都仍有覆盖，不会因改默认而丢掉 full 的回归。

### 四、影响范围 · 必须知道的限制

**默认值只对新装 / 清缓存 / 点过「恢复默认设置」的用户生效。**
已经在用、本地存了 `prefs_v1` 的用户（含宝哥自己）读的是**存储里的旧值**，
改完代码他们手机上仍是 200 / full —— 不做强制迁移是为了不覆盖用户手动调过的设置。
要生效：设置页 → 恢复默认设置；或后续加一次性迁移（待宝哥定）。

### 五、验证

37 套件 0 失败 ｜ `defaults_check.js` 9/9 ｜ `guide_size_check.js` 22 机型 0 溢出
（编辑页改 2 步后自然高 450rpx，比原来更矮）｜ 分类测试台 183/0 ｜ P1–P5 28/0 ｜ 悟空零变化 0。 才更新。

### 六、补充（2026-09-29 晚）新增「极慢」速度档

- **定义位置**：`miniprogram/engine/prefs.js` 的 `SPEED_PRESETS`（唯一来源）。
  设置页 `settings.js:27` 把它挂到 `data.speedPresets`，`settings.wxml` 的 `.seg` 用
  `wx:for` 渲染 —— **加/减档只改这一个数组即可**，页面不用动。
- **取值 50** = `DEFAULTS.speed`，排数组首位（在原最慢档「慢速 110」之下），即默认档。
- ⚠️ **「老用户不改档」靠的是 `load()` 里 `Object.assign({}, DEFAULTS, saved)` 的参数顺序**
  （saved 在后、覆盖在前），不是靠迁移逻辑 —— 项目里**没有任何迁移代码，也不要加**。
  谁要是"顺手把老用户迁到新默认"，就会静默破坏这条约束（界面上看不出来）。
- ⚠️ **边界**：存档只在用户**真的改过设置**时才产生（`onLaunch` 只调 `prefs.load()`，只读不写；
  所有 `updatePrefs` 都在点击处理里）。所以"从没进过设置页"的老用户没有存档 → 走默认值。
  这是**上一轮**默认 200→50 带来的，不是本次加档造成的。
- 新增 `speed_preset.test.js`（45 断言）钉死：新用户默认 50 / 老用户 8 种原档位都不变且
  storage 未被改写 / 手选极慢后落盘且重进生效 / ±20 步进与值缺失兜底不再回到旧默认 200。
- 顺手修：`settings.js` 的 `|| 200` → `prefsEngine.DEFAULTS.speed`（上一轮漏改的第 4 处）。
  根因是 `defaults_check.js` 只扫了 teleprompter.js / edit.js，**没扫 settings.js**。
  **教训：「有没有漏改」类检查，范围要按引用点枚举，不要凭记忆列文件。**

---

## 三十二、新人引导：推翻上一轮结论，改用 vmin 基准（2026-10-27）

### 一、上一轮（三十一节）的结论是错的

原话：「**横屏下卡片必然高于视口，靠缩字号是做不到「不滚动」的 —— 正确解法是缩小 + 内容区可滚 + 按钮吸底**」。

**不是必然。** 之所以"必然"，是因为量纲选错了：`rpx` 按**屏宽**换算，
横屏 844px 宽时 1rpx≈1.125px，字号/内边距/行距整体放大 **2.25 倍**，
而可用高度只剩 390px —— 于是结论被写成"物理上装不下"。

实测（改前，无头 Chrome 按真实视口渲染，非估算）：

| 视口 | 卡片 | 占屏 | 步骤区溢出 | 结论 |
|---|---|---|---|---|
| 375x667 竖 | 220x270 | 40.5% | 0 | ✅ |
| 844x390 横 | 495x328 | 84.1% | **276px** | ❌ 步骤被裁 |
| 640x360 横 | 375x302 | 83.9% | **155px** | ❌ |
| 915x412 横 | 537x346 | 84.0% | **308px** | ❌ |
| 568x320 横 | 333x269 | 84.1% | **137px** | ❌ |

`max-height: 84vh` + `body{overflow-y:auto}` 只是**把溢出藏起来**（变成内部滚动），
没有解决"用户看不到全部步骤"，而 `pageOrientation: "auto"` 让横屏是提词页的**主场景**。

### 二、正确解法：把竖向尺寸的量纲从「屏宽」换成「短边」

`vmin` = 短边/100。竖屏时短边＝屏宽，所以 **1rpx 恰好 = 0.13333vmin**，
竖屏观感与原实现**逐像素一致**；横屏时短边＝屏高，尺寸不再随宽屏放大。
这就是"等比缩放"的严格解，不需要 media query、不需要改 JS、不需要 setData。

换算表（k = 0.133333）：`22rpx→2.93vmin` `26rpx→3.47vmin` `28rpx→3.73vmin`
`30rpx→4vmin` `34rpx→4.53vmin` `46rpx→6.13vmin`

写法是**同属性两行**：`rpx` 先兜底，`vmin` 后覆盖。
低版本 WebView 若不认 vmin，第一行仍生效，不会退化成默认值。

**只换字号/内边距/行距/图标列宽，宽度不换**：
卡片宽度改用 `max-width: 80vmin`（+ 600rpx 兜底）与 `width: 84%`。
若宽度也按 rpx 放大，横屏会变成 675px 的横条。

### 三、改完的实测（同一套量法）

| 视口 | 卡片 | 占屏 | 溢出 | |
|---|---|---|---|---|
| 375x667 竖 | 300x234 | 35.1% | 0 | ✅ |
| 844x390 横 | 312x243 | 62.3% | 0 | ✅ |
| 667x375 真实横屏 | 300x234 | 62.4% | 0 | ✅ |
| 568x320 极端矮 | 256x200 | 62.5% | 0 | ✅ |
| 768x1024 iPad | 614x479 | 46.8% | 0 | ✅ |

编辑页（2 步）：375x667 → 300x196（原 220x225），844x390 → 312x203（原 495x328 / 溢 175）。
**竖屏反而矮了 13%**：卡片放宽到 300px 后换行减少，行数比字号更影响高度。

### 四、内容层同时做的四件事

1. **字号层级统一为四级**：标题 34 ｜ 副标 22 ｜ 步骤主标 26 ｜ 说明 **22**（原 21）。
   说明提到 22 是因为 21rpx@375 = 10.5px，低于微信 12px 可读下限。
2. **压缩冗余文案**（主副两处说同一件事最典型）：
   - 原第 2 步「拖进度条跳位 / 上下滑翻页」+「想跳到哪就拖到哪，也能手动翻」→ 前后重复
   - 改：主标「拖进度条跳位」说明「上下滑也能翻页」，信息量不变、字数减 40%
   - 副标「先点「播放」，其余随时可调」→「3 步上手，随时可调」（加结构预告，去掉与第 1 步重复的"播放"）
   - 编辑页删「（二选一）」（与"或"重复）
   - 原则写进 wxml 注释：**主标 ≤8 字讲「做什么」，说明 ≤15 字讲「怎么用」**
3. **间距收一档**：卡片 padding 28/26/24→26/24/22，步骤间距 20→14，步骤区上间距 22→16，按钮上间距 18→16。
4. **主按钮位置明确**：三段式不变，`flex-shrink:0` 吸底，按钮占满卡片内容宽、`#FFD166` 高对比，任何视口都在最下方。

### 五、两个视觉不统一的修复

- **`⏩`（U+23E9）是 Emoji_Presentation=Yes 的强制彩色 emoji**，不跟随 `color` 染色：
  同一条卡片里它渲染成蓝色方块，旁边的 `▶` `⚙` 是绿色文本符号 → 换 `»`（U+00BB，纯文本，跟色）。
  **判据：图标位只能用默认文本呈现的码位；带 Emoji_Presentation 的一律不用。**
- **`.ed-guide-ico` 原来没写 `color`**，图标继承默认色 → `✎` 发白、`▶` 发绿，同卡片两个图标不同色。
  补 `color: #FFD166`（本页强调色，与标题/按钮同色；图标体积小，不抢标题重心）。

### 六、验证（这次的校验脚本进仓库了）

`guide_size_check.js` **在本项目里根本不存在** —— 三十一节写的「22 机型 0 溢出」没有可复现的依据
（一次性脚本没入库）。同一节的「横屏必然滚动」结论也因此没被任何东西挑战过。

本轮改为**入库 + 纳入全量测试**：

- `tools/guide_fit/measure.js`：从 wxss/wxml 真实读取规则，在无头 Chrome 里按真实视口渲染测量。
  - ⚠️ 必须用 CDP `Emulation.setDeviceMetricsOverride`，不能 `--window-size`（会被浏览器外框吃掉 87px）
  - ⚠️ 必须 `mobile: false`：小程序布局宽度＝设备宽度；开 mobile 模拟又缺 viewport meta 时，
    Chrome 把布局宽度钉成 **980px**，量出来全错（本次踩过）
  - 用法：`node tools/guide_fit/measure.js [844x390] [--json] [--shot out_%s.png]`
- `guide_fit.test.js`：静态 21 条（字号必须双写 vmin/rpx、80vmin 宽上限、88vh 高上限、
  三段式、图标显式染色、禁 Emoji_Presentation 码位、步骤数、回调存在）
  + 动态 22 组视口 + 汇总 1 条 = **45 断言**。本机无 Chrome 时动态部分**明确打印跳过**，不假装通过。

全量：**37 套件 0 失败**。
