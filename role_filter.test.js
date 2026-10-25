/**
 * 按角色筛选显示 —— 纯函数层验证（resolveRoleFilter + filterLinesByRole）
 * 直接 import miniprogram/engine/role.js，不依赖微信运行时。
 *
 * 覆盖：
 *  1. 不过滤（null / 空）→ 原样返回，无角色行保留
 *  2. 按角色名称筛选 → 该角色台词 + 无角色行(标题/说明)保留，其它角色台词隐藏
 *  3. 按角色 ID（序号）筛选 → 命中对应角色
 *  4. 多角色并集筛选
 *  5. 带括号修饰的原始名归并（「王二（笑着）」→「王二」）
 *  6. 别名表归并（manualAlias 命中）
 *  7. 无效角色名 → 解析为空 → 不过滤（避免误触清空整屏）
 *  8. 选中角色无台词 → 空数组（页面层会回退显示全部）
 */
const role = require('./miniprogram/engine/role.js')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✅ ' + name)
  } else {
    fail++
    console.log('  ❌ ' + name + (extra != null ? '  → ' + JSON.stringify(extra) : ''))
  }
}

// ---- 角色列表（标准名 + 序号 ID + 颜色 + 频次） ----
const roleList = [
  { name: '林晚', index: 0, color: '#FFD166', count: 5 },
  { name: '建华', index: 1, color: '#4CC9F0', count: 3 },
  { name: '王二', index: 2, color: '#7BE0AD', count: 2 }
]

// ---- 完整台词行（含 1 条无角色舞台提示） ----
const lines = [
  { role: '林晚', body: '林晚：你来了。' },
  { role: '林晚', body: '林晚：坐。' },
  { role: '建华', body: '建华：久等了。' },
  { role: null, body: '（舞台灯光渐暗）' },
  { role: '王二', body: '王二：走吧。' }
]

console.log('\n══════ 1. 不过滤（null / 空集合）══════')
{
  check('null → 原样返回全部 5 行', role.filterLinesByRole(lines, null).length === 5)
  check('空 Set → 返回空数组（取消全选=无显示）', role.filterLinesByRole(lines, new Set()).length === 0)
  check('不过滤时保留无角色行', role.filterLinesByRole(lines, null).some((l) => l.role === null))
  check('resolveRoleFilter(null) → null', role.resolveRoleFilter(null, roleList) === null)
  check('resolveRoleFilter([]) → null', role.resolveRoleFilter([], roleList) === null)
}

console.log('\n══════ 2. 按角色名称筛选 ══════')
{
  const f = role.resolveRoleFilter(['林晚'], roleList)
  check('解析出标准名集合 {林晚}', f instanceof Set && f.size === 1 && f.has('林晚'), Array.from(f || []))
  const out = role.filterLinesByRole(lines, f)
  // 修复后：选中林晚 → 保留林晚 2 行 + 无角色行(舞台提示)，其它角色台词(建华/王二)被隐藏
  check('结果含林晚的 2 行台词', out.filter((l) => l.role === '林晚').length === 2, out.length)
  check('筛选时保留无角色行(标题/舞台提示)，不再丢失', out.some((l) => l.role === null), out.map((l) => l.role))
  check('其它角色(建华/王二)台词被隐藏', !out.some((l) => l.role && l.role !== '林晚'))
}

console.log('\n══════ 3. 按角色 ID（序号）筛选 ══════')
{
  const f = role.resolveRoleFilter({ ids: [1] }, roleList)
  check('ids:[1] → {建华}', f instanceof Set && f.has('建华'), Array.from(f || []))
  const out = role.filterLinesByRole(lines, f)
  check('保留建华 1 行 + 无角色行(共 2 行)', out.length === 2 && out[0].role === '建华' && out.some((l) => l.role === null), out.length)
}

console.log('\n══════ 4. 多角色并集筛选 ══════')
{
  const f = role.resolveRoleFilter({ names: ['林晚', '建华'] }, roleList)
  check('{林晚, 建华}', f.size === 2 && f.has('林晚') && f.has('建华'), Array.from(f))
  const out = role.filterLinesByRole(lines, f)
  check('并集 4 行（2 林晚 + 1 建华 + 1 无角色行）', out.length === 4, out.length)
}

console.log('\n══════ 5. 带括号修饰的原始名归并 ══════')
{
  // 无别名表时，靠 stripModifier 把「王二（笑着）」归并到标准名「王二」
  const f = role.resolveRoleFilter(['王二（笑着）'], roleList)
  check('「王二（笑着）」→ 命中标准名「王二」', f instanceof Set && f.has('王二'), Array.from(f || []))
  // 有别名表：手动合并规则
  const f2 = role.resolveRoleFilter(['王二（笑着）'], roleList, { '王二（笑着）': '王二' })
  check('别名表也命中「王二」', f2 instanceof Set && f2.has('王二'), Array.from(f2 || []))
}

console.log('\n══════ 6. 无效角色名 → 不过滤 ══════')
{
  const f = role.resolveRoleFilter(['不存在的人'], roleList)
  check('无效名解析为空 → null（不过滤）', f === null)
  // 有效 + 无效混填：仅保留有效
  const f2 = role.resolveRoleFilter(['林晚', '路人甲'], roleList)
  check('有效+无效混填 → 仅保留有效 {林晚}', f2 instanceof Set && f2.size === 1 && f2.has('林晚'), Array.from(f2 || []))
}

console.log('\n══════ 7. 选中角色无台词（空结果，页面层回退）══════')
{
  const f = role.resolveRoleFilter(['王二'], roleList)
  const onlyLin = [{ role: '林晚', body: '林晚：只有我。' }]
  const out = role.filterLinesByRole(onlyLin, f)
  check('筛选角色不存在于行 → 空数组', out.length === 0)
}

console.log('\n──────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ────────')
process.exit(fail ? 1 : 0)
