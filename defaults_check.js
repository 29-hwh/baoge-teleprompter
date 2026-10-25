'use strict'
/**
 * defaults_check.js —— 默认值一致性校验
 * ---------------------------------------------------------------------------
 * 为什么需要：产品默认值**散落在好几个地方**，各自硬编码一份：
 *   - prefs.DEFAULTS            （真正落盘/新用户用的默认值）
 *   - teleprompter.js 的 data   （页面首帧渲染值，onShow 同步前先用它）
 *   - edit.js 的 data           （同上）
 *   - 各处 `(x || 旧默认)` 兜底
 * 2026-09-29 改默认（speed 200→50、roleHighlightMode full→name）时就是三处都要改；
 * 漏一处就会出现「设置里是 A、首帧显示 B」的诡异现象。这个脚本把一致性钉死。
 *
 * 用法：node defaults_check.js
 * 退出码：一致 = 0；不一致 = 1
 */
const fs = require('fs')
const path = require('path')
const ROOT = __dirname
const prefs = require(path.join(ROOT, 'miniprogram/engine/prefs.js'))

let PASS = 0
let FAIL = 0
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS | ' + name + (detail ? '  -> ' + detail : '')) }
  else { FAIL++; console.log('  FAIL | ' + name + (detail ? '  -> ' + detail : '')) }
}

/** 从页面源码的 data 块里抽某个字段的字面量初值 */
function dataFieldOf(file, field) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  // 只取 Page({ data: { ... } }) 里的第一个匹配，避免命中方法体内的同名赋值
  const head = src.slice(0, src.indexOf('\n  onLoad') > 0 ? src.indexOf('\n  onLoad') : src.length)
  const m = head.match(new RegExp('\\b' + field + '\\s*:\\s*([\'"]?[-\\w]+[\'"]?)'))
  return m ? m[1].replace(/['"]/g, '') : null
}

console.log('=== 默认值一致性校验 ===\n')

console.log('[1] 滚动速度 speed')
const dSpeed = prefs.DEFAULTS.speed
const tpSpeed = dataFieldOf('miniprogram/pages/teleprompter/teleprompter.js', 'speed')
ok(dSpeed === 50, 'prefs.DEFAULTS.speed === 50', '实际 ' + dSpeed)
ok(String(tpSpeed) === String(dSpeed), '提词页 data.speed 与 DEFAULTS 一致', '页面 ' + tpSpeed + ' / DEFAULTS ' + dSpeed)
ok(dSpeed >= prefs.SPEED_MIN && dSpeed <= prefs.SPEED_MAX,
  '默认值落在合法区间 [' + prefs.SPEED_MIN + ', ' + prefs.SPEED_MAX + ']', 'speed=' + dSpeed)
// 换算后的实际滚动速度
const px = Math.max(24, dSpeed * 0.6)
console.log('       换算：speed ' + dSpeed + ' → ' + px + ' px/s（@行高 60px 约 ' +
  (60 / px).toFixed(1) + ' 秒一行）')

console.log('\n[2] 角色高亮方式 roleHighlightMode')
const dMode = prefs.DEFAULTS.roleHighlightMode
const tpMode = dataFieldOf('miniprogram/pages/teleprompter/teleprompter.js', 'roleHighlightMode')
const edMode = dataFieldOf('miniprogram/pages/edit/edit.js', 'highlightMode')
ok(dMode === 'name', 'prefs.DEFAULTS.roleHighlightMode === name（仅名字高亮）', '实际 ' + dMode)
ok(tpMode === dMode, '提词页 data.roleHighlightMode 与 DEFAULTS 一致', '页面 ' + tpMode)
ok(edMode === dMode, '编辑页 data.highlightMode 与 DEFAULTS 一致', '页面 ' + edMode)

console.log('\n[3] 兜底值不能停留在旧默认')
// 2026-09-29 补记：初版只扫了 teleprompter.js / edit.js，漏掉 settings.js，
// 于是 settings.js 里的 `|| 200` 一直潜伏到这次加「极慢」档才被发现。
// 教训：扫「有没有漏改」这类检查，范围要按**引用点**枚举，不要凭记忆列文件。
const srcTp = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/teleprompter/teleprompter.js'), 'utf8')
const srcEd = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/edit/edit.js'), 'utf8')
const srcSet = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.js'), 'utf8')
const stale = []
;[[srcTp, 'teleprompter.js'], [srcEd, 'edit.js'], [srcSet, 'settings.js']].forEach(([src, name]) => {
  ;(src.match(/\|\|\s*200\b/g) || []).forEach(() => stale.push(name + ' 仍有 `|| 200`'))
})
ok(stale.length === 0, '没有残留 `|| 200` 的旧速度兜底（含 settings.js）', stale.join('; ') || '无')

console.log('\n[3b] 速度预设档位与默认值的关系')
const PRESETS = prefs.SPEED_PRESETS || []
const slowest = PRESETS[0]
ok(PRESETS.length === 5, '预设共 5 档（含新增「极慢」）', '实际 ' + PRESETS.length)
ok(!!slowest && slowest.label === '极慢', '数组首位是「极慢」（排在原最慢档「慢速」之下）',
  slowest ? slowest.label : '空')
ok(PRESETS.every((p, i) => i === 0 || p.value > PRESETS[i - 1].value),
  '档位按 value 升序（界面快慢顺序与实际一致）', PRESETS.map((p) => p.label + ':' + p.value).join(' < '))
ok(!!slowest && slowest.value === dSpeed, '「极慢」的取值 === 默认值（默认档有对应按钮）',
  '极慢 ' + (slowest && slowest.value) + ' / 默认 ' + dSpeed)
ok(PRESETS.every((p) => p.value >= prefs.SPEED_MIN && p.value <= prefs.SPEED_MAX),
  '所有档位都落在合法区间 [' + prefs.SPEED_MIN + ', ' + prefs.SPEED_MAX + ']',
  PRESETS.map((p) => p.value).join(','))
ok(new Set(PRESETS.map((p) => p.value)).size === PRESETS.length, '档位取值不重复（界面选中态不会串档）')

console.log('\n[4] 顺带核对：默认仍是「高亮开 + 仅名字」')
ok(prefs.DEFAULTS.roleHighlight === true, 'roleHighlight 默认开启', String(prefs.DEFAULTS.roleHighlight))
ok(prefs.DEFAULTS.smartOff === false, '智能总闸默认关闭（不冲突）', String(prefs.DEFAULTS.smartOff))

console.log('\n==================== 汇总 ====================')
console.log('断言：通过 ' + PASS + ' / 失败 ' + FAIL)
if (FAIL === 0) console.log('✅ 默认值在三处保持一致')
else console.log('❌ 默认值不一致，检查是否漏改了某一处')
process.exit(FAIL === 0 ? 0 : 1)
