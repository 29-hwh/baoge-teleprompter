/**
 * 「极慢」速度档位专项测试
 * ---------------------------------------------------------------------------
 * 需求（2026-09-29）：
 *   1. 新增「极慢」档，位于原最慢档「慢速 110」之下；
 *   2. 该档设为默认值；
 *   3. **不得**通过数据迁移 / 默认值调整 / 配置变更，把老用户的当前档位改成新档；
 *   4. 老用户登录后保持升级前已保存的速度；新用户沿用原有默认值；
 *   5. 手动选择「极慢」后要能正确持久化，并为后续会话生效。
 *
 * 为什么单独立一个文件：这五条里有四条是**回归性质**的 —— 只要将来有人手痒
 * 加一句「顺手把老用户迁到新默认」，第 3/4 条就会静默失效（界面上完全看不出来，
 * 只有老用户会发现"我的速度怎么变了"）。所以必须自动化测试钉住。
 *
 * 运行：node speed_preset.test.js    退出码：全过 = 0
 */
'use strict'

// ---------- mock 微信环境（复用 role_filter_page 的范式） ----------
const memStorage = {}
global.wx = {
  getWindowInfo: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ windowWidth: 667, windowHeight: 375, statusBarHeight: 20, pixelRatio: 2 }),
  getStorageSync: (k) => memStorage[k],
  setStorageSync: (k, v) => { memStorage[k] = v },
  removeStorageSync: (k) => { delete memStorage[k] },
  setKeepScreenOn: () => {}, setScreenBrightness: () => {}, setPageOrientation: () => {},
  navigateTo: () => {}, navigateBack: () => {}, redirectTo: () => {}, reLaunch: () => {},
  showModal: () => {}, showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  setNavigationBarTitle: () => {},
  requirePrivacyAuthorize: (o) => { if (o && o.success) o.success() },
  getSetting: (o) => { if (o && o.success) o.success({ authSetting: { 'scope.record': true } }) },
  getRecorderManager: () => ({ start: () => {}, stop: () => {}, onStart: () => {}, onStop: () => {}, onError: () => {}, onFrameRecorded: () => {} })
}

const prefsEngine = require('./miniprogram/engine/prefs.js')
const appMock = {
  globalData: { prefs: prefsEngine.load(), currentScript: null },
  updatePrefs(patchObj) { this.globalData.prefs = prefsEngine.patch(patchObj); return this.globalData.prefs }
}
global.getApp = () => appMock

let pageDef = null
global.Page = (def) => { pageDef = def }
require('./miniprogram/pages/settings/settings.js')
if (!pageDef) { console.error('设置页未注册'); process.exit(1) }

function makePage() {
  const inst = Object.create(pageDef)
  inst.data = JSON.parse(JSON.stringify(pageDef.data))
  inst.setData = function (patch) { if (patch && typeof patch === 'object') Object.assign(this.data, patch) }
  return inst
}

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n      ' + detail : '')) }
}
const KEY = 'prefs_v1'
function clearStore() { for (const k of Object.keys(memStorage)) delete memStorage[k] }
/** 模拟「老用户已有存档」：直接写一份只含 speed 的历史偏好（老版本真实形态） */
function seedOldUser(speed) { clearStore(); memStorage[KEY] = { speed } }

const PRESETS = prefsEngine.SPEED_PRESETS
const SLOWEST = PRESETS[0]

console.log('=== [1] 档位定义：取值 / 文案 / 排序 ===')
check('预设共 5 档（4 档 + 新增极慢）', PRESETS.length === 5, '实际 ' + PRESETS.length)
check('首档文案是「极慢」', SLOWEST.label === '极慢', SLOWEST.label)
check('「极慢」取值 50', SLOWEST.value === 50, String(SLOWEST.value))
check('「极慢」排在原最慢档「慢速 110」之前', PRESETS[1].label === '慢速' && SLOWEST.value < PRESETS[1].value,
  SLOWEST.value + ' vs ' + PRESETS[1].value)
check('数组按 value 升序（界面快慢顺序与实际一致）',
  PRESETS.every((p, i) => i === 0 || p.value > PRESETS[i - 1].value),
  PRESETS.map((p) => p.label + ':' + p.value).join(' | '))
check('所有档位落在 [' + prefsEngine.SPEED_MIN + ', ' + prefsEngine.SPEED_MAX + ']',
  PRESETS.every((p) => p.value >= prefsEngine.SPEED_MIN && p.value <= prefsEngine.SPEED_MAX))
check('取值互不重复（选中态不会串档）', new Set(PRESETS.map((p) => p.value)).size === PRESETS.length)
check('「极慢」=== 默认值（默认档有对应按钮）', SLOWEST.value === prefsEngine.DEFAULTS.speed,
  '极慢 ' + SLOWEST.value + ' / 默认 ' + prefsEngine.DEFAULTS.speed)

console.log('\n=== [2] 新用户：无存档 → 沿用原有默认值 ===')
clearStore()
const fresh = prefsEngine.load()
check('新用户 speed === 50（原有默认值未变）', fresh.speed === 50, String(fresh.speed))
check('新用户默认值命中「极慢」档', fresh.speed === SLOWEST.value, String(fresh.speed))
const pFresh = makePage()
if (pFresh.onShow) pFresh.onShow()
pFresh.data.prefs = prefsEngine.load()
check('设置页展示 5 个档位按钮（UI 会出现「极慢」）',
  (pFresh.data.speedPresets || []).length === 5 && pFresh.data.speedPresets[0].label === '极慢',
  JSON.stringify((pFresh.data.speedPresets || []).map((x) => x.label)))
check('设置页选中态落在「极慢」',
  pFresh.data.prefs.speed === pFresh.data.speedPresets[0].value)

console.log('\n=== [3] 老用户：升级后档位与升级前一致（无迁移） ===')
;[200, 140, 110, 240, 50, 333, 40, 400].forEach((old) => {
  seedOldUser(old)
  const before = JSON.stringify(memStorage[KEY])
  const after = prefsEngine.load()
  check('老用户原档 ' + old + ' → 升级后仍是 ' + old, after.speed === old, '实际 ' + after.speed)
  check('  且 storage 未被改写（确实没有迁移动作）', JSON.stringify(memStorage[KEY]) === before,
    '存档变成 ' + JSON.stringify(memStorage[KEY]))
})
// 只存了部分字段的老存档：speed 有值就不许被 DEFAULTS 覆盖
seedOldUser(200)
const partial = prefsEngine.load()
check('含 speed 的老存档：DEFAULTS 只补缺字段、不覆盖 speed', partial.speed === 200, String(partial.speed))
check('  缺失字段仍由 DEFAULTS 补齐（如 roleHighlightMode）', partial.roleHighlightMode === 'name',
  String(partial.roleHighlightMode))

console.log('\n=== [4] 反复读取幂等（读操作不产生副作用） ===')
seedOldUser(140)
const r1 = prefsEngine.load().speed
const r2 = prefsEngine.load().speed
const r3 = prefsEngine.load().speed
check('连续 3 次 load 结果恒为原档 140', r1 === 140 && r2 === 140 && r3 === 140, [r1, r2, r3].join(','))

console.log('\n=== [5] 手动选择「极慢」→ 持久化 + 后续会话生效 ===')
seedOldUser(200) // 老用户原本是 200（旧默认）
const page = makePage()
if (page.onShow) page.onShow()
page.data.prefs = prefsEngine.load()
check('切换前是老档 200', page.data.prefs.speed === 200, String(page.data.prefs.speed))
// 点「极慢」按钮（走真实处理器：_set → app.updatePrefs → prefs.patch）
page.onTapSpeedPreset({ currentTarget: { dataset: { value: SLOWEST.value } } })
check('点击后页面数据变为 50', page.data.prefs.speed === 50, String(page.data.prefs.speed))
check('已落盘（storage 里就是 50）', memStorage[KEY] && memStorage[KEY].speed === 50,
  JSON.stringify(memStorage[KEY] && memStorage[KEY].speed))
check('内存态（app.globalData，本次会话后续页面直接读它）同步为 50',
  appMock.globalData.prefs.speed === 50, String(appMock.globalData.prefs.speed))
// 模拟「下次打开小程序」：重新从 storage 读
const reloaded = prefsEngine.load()
check('重新进入（后续会话）读到 50 —— 生效', reloaded.speed === 50, String(reloaded.speed))
check('生效换算：50 → 30 px/s（@行高 60px 约 2 秒一行）',
  Math.max(24, reloaded.speed * 0.6) === 30, String(Math.max(24, reloaded.speed * 0.6)))
check('选中态命中「极慢」而非其他档', reloaded.speed === SLOWEST.value)

console.log('\n=== [6] 手动切回其他档仍正常（新档没把老路堵死） ===')
page.onTapSpeedPreset({ currentTarget: { dataset: { value: 200 } } })
check('切回「标准 200」落盘生效', prefsEngine.load().speed === 200, String(prefsEngine.load().speed))
page.onTapSpeedPreset({ currentTarget: { dataset: { value: 110 } } })
check('切到「慢速 110」落盘生效', prefsEngine.load().speed === 110, String(prefsEngine.load().speed))

console.log('\n=== [7] ±20 步进：兜底不再回到旧默认 200 ===')
seedOldUser(50)
const pStep = makePage()
if (pStep.onShow) pStep.onShow()
pStep.data.prefs = prefsEngine.load()
pStep.onTapSpeedStep({ currentTarget: { dataset: { delta: 20 } } })
check('50 + 20 = 70', prefsEngine.load().speed === 70, String(prefsEngine.load().speed))
pStep.onTapSpeedStep({ currentTarget: { dataset: { delta: -20 } } })
check('70 − 20 = 50（回到极慢档）', prefsEngine.load().speed === 50, String(prefsEngine.load().speed))
// 值缺失时的兜底：旧代码是 || 200（会莫名其妙跳到 220），现在应是 DEFAULTS.speed=50
seedOldUser(50)
const pFallback = makePage()
if (pFallback.onShow) pFallback.onShow()
pFallback.data.prefs = Object.assign({}, prefsEngine.load())
delete pFallback.data.prefs.speed
pFallback.onTapSpeedStep({ currentTarget: { dataset: { delta: 20 } } })
check('speed 缺失时按默认 50 起步（不是旧默认 200 → 220）',
  prefsEngine.load().speed === 70, String(prefsEngine.load().speed))

console.log('\n=== [8] 恢复默认设置 → 回到默认档（= 极慢） ===')
seedOldUser(240)
prefsEngine.reset()
check('reset 后为 50（即「极慢」档）', prefsEngine.load().speed === 50, String(prefsEngine.load().speed))
check('reset 后的值命中「极慢」按钮', prefsEngine.load().speed === SLOWEST.value)

console.log('\n==================== 汇总 ====================')
console.log('断言：通过 ' + pass + ' / 失败 ' + fail)
if (fail === 0) console.log('✅ 新增「极慢」档：默认值不变、老用户不改档、手选可保存并生效')
else console.log('❌ 存在失败项，见上方明细')
process.exit(fail === 0 ? 0 : 1)
