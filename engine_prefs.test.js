/**
 * prefs 引擎扩展测试：自定义配色生效、深色判定、字体族映射、一键主题。
 * 运行：node engine_prefs.test.js
 */
'use strict'

const prefs = require('./miniprogram/engine/prefs.js')

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '  -> ' + extra : ''))
  }
}

console.log('=== 1. effectiveColors 默认回落内置方案 ===')
const effDef = prefs.effectiveColors(prefs.DEFAULTS)
ok('默认黑底', effDef.bg === '#000000', effDef.bg)
ok('默认白字', effDef.text === '#FFFFFF', effDef.text)
ok('默认判为深色背景', effDef.isDark === true)

console.log('\n=== 2. 自定义颜色（colorScheme=custom）优先 ===')
const effCustom = prefs.effectiveColors({ colorScheme: 'custom', bgColor: '#FFFFFF', textColor: '#1C1C1E' })
ok('使用自定义背景', effCustom.bg === '#FFFFFF')
ok('使用自定义文字', effCustom.text === '#1C1C1E')
ok('白底判为浅色', effCustom.isDark === false)

console.log('\n=== 3. 自定义色缺失时回落方案 ===')
const effPartial = prefs.effectiveColors({ colorScheme: 'custom', bgColor: null, textColor: null })
ok('custom 但无自定义色时回落', effPartial.bg === '#000000' && effPartial.text === '#FFFFFF')

console.log('\n=== 4. isDarkColor 亮度判定 ===')
ok('#000000 是深色', prefs.isDarkColor('#000000') === true)
ok('#FFFFFF 是浅色', prefs.isDarkColor('#FFFFFF') === false)
ok('#2B2B2B 是深色', prefs.isDarkColor('#2B2B2B') === true)
ok('非法值回落深色', prefs.isDarkColor('not-a-color') === true)
ok('3 位简写可解析', prefs.isDarkColor('#FFF') === false)

console.log('\n=== 5. fontFamilyCss 映射 ===')
ok('system 返回系统字体栈', prefs.fontFamilyCss('system').indexOf('PingFang SC') >= 0)
ok('kaiti 返回楷体栈', prefs.fontFamilyCss('kaiti').indexOf('Kaiti') >= 0)
ok('未知 key 回落 system', prefs.fontFamilyCss('xxx').indexOf('PingFang') >= 0)

console.log('\n=== 6. 一键主题预设 ===')
ok('预设含 3 个常用主题', prefs.PRESET_THEMES.length === 3)
ok('预设键与内置方案一致', prefs.PRESET_THEMES.every((p) => !!prefs.COLOR_SCHEMES[p.key]))

console.log('\n=== 7. 新字段有默认值 ===')
const d = prefs.DEFAULTS
ok('roleHighlightMode 默认 full', d.roleHighlightMode === 'full')
ok('fontFamily 默认 system', d.fontFamily === 'system')
ok('smartSegment 默认 false（智能分段已下线，仅兼容老存储）', d.smartSegment === false)
ok('bgColor/textColor 默认 null', d.bgColor === null && d.textColor === null)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
