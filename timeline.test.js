/**
 * 时间轴速度体系测试（对齐「浅纸提词器」）
 * ---------------------------------------------------------------------------
 * 钉住四件事：
 *   1. 加权字数（中文 1.0 / 其他 0.5）——决定「200 字/分」准不准；
 *   2. 每字像素估算——决定首帧没有真实距离时速度会不会跑飞；
 *   3. msPerPx 换算——决定了播放时长，公式错一点，整篇就快/慢一截；
 *   4. 单位切换往返不跳速——切一次单位速度翻三倍，是提词器最招骂的 bug。
 *
 * 运行：node timeline.test.js    退出码：全过 = 0
 */
'use strict'

const T = require('./miniprogram/engine/timeline.js')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  OK  ' + name)
  } else {
    fail++
    console.log('  FAIL ' + name + (detail === undefined ? '' : '  → ' + detail))
  }
}
function near(a, b, eps) {
  return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps)
}

console.log('=== [1] 常量与浅纸一致 ===')
check('CPM 20/1500/10/200', T.CPM_MIN === 20 && T.CPM_MAX === 1500 && T.CPM_STEP === 10 && T.CPM_DEFAULT === 200)
check('旧标尺 0/125/8/4（与 cpm 上限 1500 对齐）', T.LEGACY_SPEED_MIN === 0 && T.LEGACY_SPEED_MAX === 125 && T.LEGACY_SPEED_DEFAULT === 8 && T.LEGACY_PX_PER_SEC === 4)
check('行高系数 1.2', T.LINE_HEIGHT_FACTOR === 1.2)
check('左右内边距 16', T.TEXT_PADDING_X === 16)

console.log('\n=== [2] 加权字数 ===')
check('纯中文 10 字 = 10', T.countWeightedChars('一二三四五六七八九十') === 10, T.countWeightedChars('一二三四五六七八九十'))
check('英文 10 字母 = 5', T.countWeightedChars('abcdefghij') === 5, T.countWeightedChars('abcdefghij'))
check('中英混排 4 中 + 4 英 = 6', T.countWeightedChars('中文测试abcd') === 6, T.countWeightedChars('中文测试abcd'))
check('换行/制表符不计，空格算半个字', T.countWeightedChars('中文 测试\nabc') === 6, T.countWeightedChars('中文 测试\nabc'))
check('空串 = 0', T.countWeightedChars('') === 0)
check('null 不炸 = 0', T.countWeightedChars(null) === 0)

console.log('\n=== [3] 每字像素估算 ===')
{
  // fontSize 45 / lineHeight 1.5 / letterSpacing 0 / contentWidth 100 / 宽 375
  // 行高盒 = 45 × 1.5 × 1.2 = 81；每行字数 = floor((375−32)/45) = 7 → 81/7
  const v = T.estimatePxPerChar({ fontSize: 45, lineHeight: 1.5, letterSpacing: 0, contentWidth: 100 }, 375)
  check('默认参数 375 宽 ≈ 11.57 px/字', near(v, 81 / 7, 1e-9), v)
}
{
  const wide = T.estimatePxPerChar({ fontSize: 45, lineHeight: 1.5, contentWidth: 100 }, 667)
  const narrow = T.estimatePxPerChar({ fontSize: 45, lineHeight: 1.5, contentWidth: 100 }, 375)
  check('横屏比竖屏每字占更少像素', wide < narrow, wide + ' vs ' + narrow)
}
{
  const a = T.estimatePxPerChar({ fontSize: 45, lineHeight: 1.5, contentWidth: 100 }, 375)
  const b = T.estimatePxPerChar({ fontSize: 45, lineHeight: 1.5, contentWidth: 50 }, 375)
  check('台词区宽度减半 → 每字占位变大', b > a, a + ' → ' + b)
}
{
  const v = T.estimatePxPerChar({}, 375)
  check('缺字段回落 fontSize 45 / lineHeight 1.5', near(v, 81 / 7, 1e-9), v)
}

console.log('\n=== [4] 时长换算 msPerPx ===')
{
  // 1000 字 @200 字/分 → 300000ms；走 5000px → 60ms/px
  const v = T.msPerPxFromDuration(1000, 200, 5000)
  check('1000 字 / 200cpm / 5000px = 60ms 每 px', near(v, 60), v)
  check('参数缺失返回 null', T.msPerPxFromDuration(0, 200, 5000) === null && T.msPerPxFromDuration(1000, 0, 5000) === null)
}
{
  // 距离未知：200cpm → 3.33 字/s × 11.571px = 38.57px/s → 25.93ms/px
  const v = T.msPerPxFromEstimate({ fontSize: 45, lineHeight: 1.5, contentWidth: 100 }, 375, 200)
  check('估算分支 ≈ 25.93ms/px', near(v, 1000 / ((200 / 60) * (81 / 7)), 1e-6), v)
}

console.log('\n=== [5] resolveSpeed 四条分支 ===')
{
  const r = T.resolveSpeed({ speedUnit: 'cpm', speedCpm: 200 }, { charCount: 1000, scrollDistance: 5000 })
  check('cpm + 已知距离 → duration', r.source === 'duration' && near(r.msPerPx, 60), r.source + ' ' + r.msPerPx)
}
{
  const r = T.resolveSpeed({ speedUnit: 'cpm', speedCpm: 200 }, { charCount: 0, scrollDistance: 0, windowWidth: 375 })
  check('cpm + 未知距离 → estimate', r.source === 'estimate' && r.msPerPx > 0, r.source + ' ' + r.msPerPx)
}
{
  const r = T.resolveSpeed({ speedUnit: 'px', speed: 8 }, {})
  check('px 模式 speed 8 = 31.25ms/px', r.source === 'px' && near(r.msPerPx, 31.25), r.source + ' ' + r.msPerPx)
}
{
  const r = T.resolveSpeed({ speedUnit: 'px', speed: 0 }, {})
  check('速度 0 → Infinity/zero（不动）', r.source === 'zero' && r.msPerPx === Infinity)
}
{
  const r = T.resolveSpeed({ speedCpm: 0, speedUnit: 'cpm' }, { charCount: 100, scrollDistance: 100 })
  check('cpm 0 → zero', r.source === 'zero')
}

console.log('\n=== [6] 单位切换往返不跳速 ===')
{
  const ctx = { charCount: 1000, scrollDistance: 5000, windowWidth: 375 }
  const px = T.cpmFromLegacySpeed({ speed: 8 }, ctx)
  // 精确值 384，但 clampCpm 会吸附到 CPM_STEP=10 的整数倍 → 380
  check('旧 speed 8（32px/s）→ 380 字/分（吸附到 10 的倍数）', px === 380, px)

  const back = T.legacySpeedFromCpm({ speedCpm: px }, ctx)
  // 380 反算得 7.9 —— 吸附带来的 1.25% 漂移，属于可接受范围
  check('380 字/分 → 回到 speed 7.9（往返误差 <2%）', near(back, 7.9, 1e-9), back)
  check('往返相对误差 <2%', Math.abs(back - 8) / 8 < 0.02, Math.abs(back - 8) / 8)
}
{
  const ctx = { charCount: 1000, scrollDistance: 5000, windowWidth: 375 }
  const patch = T.switchSpeedUnit({ speedUnit: 'cpm', speedCpm: 300 }, ctx, 'px')
  check('切到 px 只带 speedUnit + speed', patch.speedUnit === 'px' && typeof patch.speed === 'number', JSON.stringify(patch))
  const before = T.resolveSpeed({ speedUnit: 'cpm', speedCpm: 300 }, ctx).msPerPx
  const after = T.resolveSpeed(Object.assign({ speedUnit: 'cpm', speedCpm: 300 }, patch), ctx).msPerPx
  check('切换后 msPerPx 变化 < 2%（不跳速）', Math.abs(after - before) / before < 0.02, before + ' → ' + after)
}
{
  const patch = T.switchSpeedUnit({ speed: 8 }, { charCount: 0, scrollDistance: 0, windowWidth: 375 }, 'cpm')
  check('px → cpm 得到 speedCpm', patch.speedUnit === 'cpm' && patch.speedCpm > 0, JSON.stringify(patch))
}

console.log('\n=== [7] 老存档迁移 ===')
{
  const m = T.migrateSpeedSettings({ speed: 8 })
  check('只有 speed → 补 speedUnit=cpm 且折出 speedCpm', m.speedUnit === 'cpm' && m.speedCpm > 0, JSON.stringify(m))
}
{
  const m = T.migrateSpeedSettings({ speedCpm: 200 })
  check('有 speedCpm 无 unit → 认定为 cpm', m.speedUnit === 'cpm' && m.speedCpm === 200)
}
{
  const src = { speedUnit: 'px', speed: 8 }
  const m = T.migrateSpeedSettings(src)
  check('已是新格式 → 原样返回', m === src)
}
{
  check('无速度字段 → 不需要迁移', T.needsSpeedMigration({ fontSize: 45 }) === false)
  check('非对象 → 不迁移', T.migrateSpeedSettings(null) === null)
}

console.log('\n=== [8] 边界钳制 ===')
check('cpm 吸附到 10 的整数倍', T.clampCpm(203) === 200, T.clampCpm(203))
check('cpm 下限 20', T.clampCpm(1) === 20)
check('cpm 上限 1500', T.clampCpm(9999) === 1500)
check('旧速度上限 125', T.clampLegacySpeed(999) === 125)
check('旧速度保留一位小数', T.clampLegacySpeed(8.34) === 8.3)

console.log('\n==================== 汇总 ====================')
console.log('断言：通过 ' + pass + ' / 失败 ' + fail)
if (fail === 0) console.log('✅ 速度体系与浅纸口径一致：加权字数、每字像素、msPerPx、双单位往返')
else console.log('❌ 存在失败项，见上方明细')
process.exit(fail === 0 ? 0 : 1)
