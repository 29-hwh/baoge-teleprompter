/**
 * 按集顺序获取下一个/上一个台本 —— 纯函数验证（宝哥需求：第N集 → 第N+1集 连续推进）。
 * 聚焦 util.parseEpisodeNo / sortByEpisode / getNextEpisodeScript / getPrevEpisodeScript。
 * 直接构造 {id,title} 数组，不依赖 store，隔离验证集号解析与排序逻辑。
 */
'use strict'

const util = require('./miniprogram/utils/util.js')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}\n      ${detail || ''}`) }
}

// ── 1. 集号解析 parseEpisodeNo ─────────────────────────────────────────────
console.log('\n══════ 1. 集号解析 parseEpisodeNo ═══════')
const noCases = [
  ['第2集', 2],
  ['第10集', 10],
  ['第二十一集', 21],
  ['第一百集', 100],
  ['【第3集】', 3],
  ['第3话', 3],
  ['建华&小凤的生活71', 71],
  ['婆婆·年夜饭 第3', 3],
  ['3集', 3],
  ['序章', null],
  ['未命名台本', null],
  ['', null],
  [null, null]
]
for (const [title, expect] of noCases) {
  const got = util.parseEpisodeNo(title)
  check(`parseEpisodeNo(${JSON.stringify(title)}) === ${expect}`, got === expect, `got ${got}`)
}

// ── 2. 排序 sortByEpisode（严格按集号递增） ────────────────────────────────
console.log('\n══════ 2. 排序 sortByEpisode ═══════')
{
  const scripts = [
    { id: 'c', title: '第3集' },
    { id: 'a', title: '第1集' },
    { id: 'b', title: '第2集' },
    { id: 'x', title: '未命名台本（无集号）' }
  ]
  const ordered = util.sortByEpisode(scripts).map((s) => s.id)
  check('有集号按 1→2→3 升序，无集号排末尾', ordered.join(',') === 'a,b,c,x', ordered.join(','))
}

// ── 3. 核心：给定当前集编号，返回按集数递增的下一集 ─────────────────────────
console.log('\n══════ 3. getNextEpisodeScript（第N集 → 第N+1集）══════')
{
  const scripts = [
    { id: 'a', title: '第1集' },
    { id: 'b', title: '第2集' },
    { id: 'c', title: '第3集' }
  ]
  const next = util.getNextEpisodeScript(scripts, 'b') // 当前第2集
  check('当前=第2集 → 下一集=第3集', next && next.id === 'c', next && next.id)
  const next2 = util.getNextEpisodeScript(scripts, 'a') // 当前第1集
  check('当前=第1集 → 下一集=第2集', next2 && next2.id === 'b', next2 && next2.id)
  const last = util.getNextEpisodeScript(scripts, 'c') // 当前第3集（末集）
  check('当前=第3集（末集）→ 返回 null（不绕回）', last === null, String(last))
}

// ── 4. 上一集 getPrevEpisodeScript ────────────────────────────────────────
console.log('\n══════ 4. getPrevEpisodeScript ═══════')
{
  const scripts = [
    { id: 'a', title: '第1集' },
    { id: 'b', title: '第2集' },
    { id: 'c', title: '第3集' }
  ]
  const prev = util.getPrevEpisodeScript(scripts, 'b')
  check('当前=第2集 → 上一集=第1集', prev && prev.id === 'a', prev && prev.id)
  const first = util.getPrevEpisodeScript(scripts, 'a')
  check('当前=第1集（首集）→ 返回 null（不绕回）', first === null, String(first))
}

// ── 5. 缺集号的连续衔接（第1集、第3集，缺第2集）─────────────────────────────
console.log('\n══════ 5. 集号不连续时按「大于当前的最小集号」推进 ═══════')
{
  const scripts = [
    { id: 'a', title: '第1集' },
    { id: 'c', title: '第3集' }
  ]
  const next = util.getNextEpisodeScript(scripts, 'a')
  check('第1集的下一个=第3集（跳过缺失的第2集）', next && next.id === 'c', next && next.id)
}

// ── 6. 全集无集号时退化为入参顺序（兼容纯随笔）─────────────────────────────
console.log('\n══════ 6. 无集号列表退化为原顺序（不强行重排）══════')
{
  const scripts = [
    { id: 'x', title: '随笔甲' },
    { id: 'y', title: '随笔乙' },
    { id: 'z', title: '随笔丙' }
  ]
  const ordered = util.sortByEpisode(scripts).map((s) => s.id)
  check('无集号 → 保持入参顺序', ordered.join(',') === 'x,y,z', ordered.join(','))
  const next = util.getNextEpisodeScript(scripts, 'x')
  check('无集号列表仍可顺序取下一个', next && next.id === 'y', next && next.id)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
