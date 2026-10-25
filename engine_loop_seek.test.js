/**
 * 循环播放 + 进度拖动 单元测试（纯引擎，不依赖微信运行时）
 * 用受控伪时钟直接驱动 _tick，验证循环回绕与 seek 定位逻辑。
 */
'use strict'

const ScrollEngine = require('./miniprogram/engine/scroll.js')

// 受控时钟
let T = 0
global.Date.now = () => T
function tick(engine, ms) {
  T += (ms || 16)
  engine._tick()
}

const results = []
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' })
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${extra ? '  -> ' + extra : ''}`)
}

console.log('=== A. 不循环：滚到底触发 onEnd 并停止 ===')
{
  const e = new ScrollEngine({ onEnd: function () {}, onUpdate: function () {} })
  e.configure(40, 400, 100, 100, 100) // guideOffset=100 -> endOffset=内容高(400)-100=300（与原 maxOffset 一致，语义正确） // maxOffset = 400-100 = 300
  e.loop = false
  e.playing = true
  e._lastTs = 0
  let endFired = false
  const endCalls = []
  e.onEnd = () => { endFired = true }
  let guard = 0
  while (e.playing && guard < 1000) { tick(e, 16); guard++ }
  // onEnd 触发后引擎仍会让 current 平滑吸附到 target(底部)，再停定时器；
  // 多跑几帧让其收敛（真实定时器行为一致）。
  for (let i = 0; i < 30; i++) tick(e, 16)
  ok('滚到底触发 onEnd', endFired === true)
  ok('结束后 playing=false', e.playing === false)
  ok('结束后平滑吸附到底部(=maxOffset)', Math.abs(e.current - 300) < 1, `current=${e.current.toFixed(1)}`)
}

console.log('\n=== B. 循环：滚到底回到开头继续播放 ===')
{
  const e = new ScrollEngine({ onEnd: function () {}, onUpdate: function () {} })
  e.configure(40, 400, 100, 100, 100) // guideOffset=100 -> endOffset=内容高(400)-100=300（与原 maxOffset 一致，语义正确）
  e.loop = true
  e.playing = true
  e._lastTs = 0
  let loops = 0
  e.onLoop = () => { loops++ }
  for (let i = 0; i < 400; i++) tick(e, 16) // 约 6.4s，足够跑过结尾一圈以上
  ok('滚到底触发循环(onLoop)至少 1 次', loops >= 1, `loops=${loops}`)
  ok('循环后仍在播放', e.playing === true, `playing=${e.playing}`)
  ok('循环后进度在合法区间（无缝回绕，进度条 0→1 往复）', e.progress >= 0 && e.progress <= 1, `progress=${(e.progress * 100).toFixed(1)}% loops=${loops}`)
  // 行号索引在整圈循环里始终合法（渲染层对行号取模拼接，越界会空白/崩溃）
  const totalLines = e.totalLines
  let idxOk = true
  for (let i = 0; i < 400; i++) { tick(e, 16); if (e.currentLineIndex < 0 || e.currentLineIndex >= totalLines) { idxOk = false; break } }
  ok('无缝循环整圈内行号索引始终在 [0,总行数) 范围', idxOk, `totalLines=${totalLines}`)
}

console.log('\n=== C. seekProgress 定位 ===')
{
  const e = new ScrollEngine({ onUpdate: function () {} })
  e.configure(40, 400, 100, 100, 100) // guideOffset=100 -> endOffset=内容高(400)-100=300（与原 maxOffset 一致，语义正确）
  e.seekProgress(0.5)
  ok('seek 50% 定位到中点', Math.abs(e.current - 150) < 0.5 && Math.abs(e.progress - 0.5) < 0.01,
     `current=${e.current.toFixed(1)} progress=${e.progress.toFixed(2)}`)
  e.seekProgress(2)
  ok('seek >1 被限制到底部', e.current === 300, `current=${e.current}`)
  e.seekProgress(-1)
  ok('seek <0 被限制到顶部', e.current === 0, `current=${e.current}`)
}

console.log('\n=== D. syncTo 手动拖动定位（不做插值）===')
{
  const e = new ScrollEngine({ onUpdate: function () {} })
  e.configure(40, 400, 100, 100, 100) // guideOffset=100 -> endOffset=内容高(400)-100=300（与原 maxOffset 一致，语义正确）
  e.syncTo(210)
  ok('syncTo 立即定位到指定像素', Math.abs(e.current - 210) < 0.5 && Math.abs(e.target - 210) < 0.5,
     `current=${e.current.toFixed(1)} target=${e.target.toFixed(1)}`)
  e.syncTo(99999)
  ok('syncTo 超出范围被 clamp', e.current === 300, `current=${e.current}`)
}

// 汇总
const passed = results.filter(r => r.pass).length
console.log(`\n================ 结果：${passed}/${results.length} 通过 ================`)
const fails = results.filter(r => !r.pass)
if (fails.length) {
  console.log('失败项：')
  fails.forEach(f => console.log('  - ' + f.name + (f.extra ? '  (' + f.extra + ')' : '')))
  process.exitCode = 1
} else {
  console.log('全部通过 ✅')
}
