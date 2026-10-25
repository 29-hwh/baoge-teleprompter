/**
 * 台词零遗漏 · 回归锁定
 * ---------------------------------------------------------------
 * 硬约束：台词必须完整保留并全部呈现，不得因长度限制、界面空间、截断、
 * 排版或性能被丢弃、省略、合并、摘要。空间不足只能靠换行/滚动/分页解决。
 *
 * 本文件锁定「零遗漏」审计中查出的 4 处真实丢弃/污染缺陷，防止回退：
 *   Z1 「无台词」单元格被误判成表头行 → 它之前的整篇台词被丢弃
 *   Z2 单列合并行（集标题/人物行）被用来推断列数 → 台词列定位到第 0 列
 *   Z3 「人物：…」被 /人物/ 子串匹配成角色列 → 每行变成「镜头号：台词」
 *   Z4 无表头表格无条件 slice(2) → 开头两行台词被静默吃掉
 *   Z5 落盘失败静默跳过 → 用户不知道有集没存下来
 */
let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''))
  }
}

const util = require('./miniprogram/utils/util.js')
const squash = (s) => String(s || '').replace(/\s/g, '')

function linesOf(rows, heading) {
  const blocks = []
  if (heading) blocks.push({ type: 'paragraph', text: heading })
  blocks.push({ type: 'table', rows: rows })
  const res = util.splitScripts(blocks)
  const segs = (res && res.segments) || []
  const out = []
  segs.forEach((s) => (s.lines || []).forEach((l) => out.push(l)))
  return out
}

console.log('\n===== Z1 「无台词」不得被当成表头行（否则整篇台词丢光）=====')
{
  const rows = [
    ['室内', '特写', '爸爸：妈，我明天想去趟城里。'],
    ['切', '无', '儿子（小声）：不花钱，就是看看。'],
    ['日', '中景', '儿媳妇（笑）：哎，知道了。'],
    ['特写', '夜', '无台词']
  ]
  const lines = linesOf(rows)
  ok(lines.length === 3, '3 句台词全部拆出', '实际 ' + lines.length + ' 行')
  ok(squash(lines.join('')).indexOf('爸爸：妈，我明天想去趟城里。') >= 0, '首句台词保留')
  ok(squash(lines.join('')).indexOf('儿媳妇（笑）：哎，知道了。') >= 0, '末句台词保留')
  ok(!squash(lines.join('')).includes('无台词'), '「无台词」占位不进台本')
}

console.log('\n===== Z2 单列合并行不得用于推断列数（否则取到镜头号列）=====')
{
  const rows = [
    ['第81集'],
    ['人物：杨凤、王建华　｜　场景：客厅'],
    ['镜头', '画面 / 动作', '台词', '备注'],
    ['切', '室内', '杨凤：饭在锅里热着。', '无'],
    ['推镜', '日', '王建华：哎，知道了。', '无']
  ]
  const lines = linesOf(rows)
  const joined = squash(lines.join(''))
  ok(joined.indexOf('杨凤：饭在锅里热着。') >= 0, '台词列定位正确（取到台词而非镜头号）')
  ok(joined.indexOf('王建华：哎，知道了。') >= 0, '第二行台词保留')
  ok(util.tableColCount(rows) === 4, 'tableColCount 排除单列行后 = 4', '实际 ' + util.tableColCount(rows))
}

console.log('\n===== Z3 「人物：…」不得被当成角色列（否则变成「镜头号：台词」）=====')
{
  const rows = [
    ['第83集'],
    ['人物：杨凤、王建华、婆婆　｜　场景：客厅　｜　道具：手机'],
    ['切', '室内', '杨凤：饭在锅里热着。'],
    ['推镜', '日', '王建华：哎，知道了。']
  ]
  const lines = linesOf(rows)
  const joined = squash(lines.join(''))
  ok(joined.indexOf('杨凤：饭在锅里热着。') >= 0, '台词内容保留')
  ok(!/切：/.test(joined) && !/推镜：/.test(joined), '不得出现「镜头号：台词」污染', joined.slice(0, 60))
  ok(util.isRoleHeaderCell('人物：杨凤、王建华') === false, 'isRoleHeaderCell 拒绝含内容的「人物：…」')
  ok(util.isRoleHeaderCell('人物') === true, 'isRoleHeaderCell 接受列名「人物」')
}

console.log('\n===== Z4 无表头表格不得无条件吃掉开头两行 =====')
{
  const rows = [
    ['杨凤：第一句台词在这里。'],
    ['王建华：第二句台词在这里。'],
    ['婆婆：第三句台词在这里。']
  ]
  const lines = linesOf(rows)
  const joined = squash(lines.join(''))
  ok(joined.indexOf('第一句台词在这里') >= 0, '首行台词不被跳过')
  ok(joined.indexOf('第二句台词在这里') >= 0, '第二行台词不被跳过')
  ok(joined.indexOf('第三句台词在这里') >= 0, '第三行台词保留')
}

console.log('\n===== Z5 表头单元格判定 =====')
{
  ok(util.isDialogueHeaderCell('台词') === true, '「台词」是表头列名')
  ok(util.isDialogueHeaderCell('无台词') === false, '「无台词」不是表头（否定式内容）')
  ok(util.isDialogueHeaderCell('无对白') === false, '「无对白」不是表头')
  ok(util.isDialogueHeaderCell('妈，我明天想去趟城里，你看行不行呢') === false, '超长台词不是表头列名')
}

console.log('\n===== Z6 落盘失败必须可见（不得静默跳过）=====')
{
  const mem = {}
  let scriptWrites = 0
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => {
      // 只让「台本表」的第 2 次及以后写入失败（文件夹表不受影响），
      // 模拟：存下第 1 集后存储写满，第 2、3 集存不进去。
      if (k === 'scripts_v1') {
        scriptWrites++
        if (scriptWrites >= 2) throw new Error('setStorage:fail size limit')
      }
      mem[k] = v
    }
  }
  delete require.cache[require.resolve('./miniprogram/engine/store.js')]
  delete require.cache[require.resolve('./miniprogram/utils/importSave.js')]
  const importSave = require('./miniprogram/utils/importSave.js')
  const r = importSave._savePartsAsFolder
    ? importSave._savePartsAsFolder([
        { name: '第1集', lines: ['杨凤：第一集台词。'] },
        { name: '第2集', lines: ['王建华：第二集台词。'] },
        { name: '第3集', lines: ['婆婆：第三集台词。'] }
      ])
    : null
  if (!r) {
    // _savePartsAsFolder 未导出时，退而校验 commitSplitFromSegments 的对外行为
    const r2 = importSave.commitSplitFromSegments([
      { name: '第1集', lines: ['杨凤：第一集台词。'] },
      { name: '第2集', lines: ['王建华：第二集台词。'] },
      { name: '第3集', lines: ['婆婆：第三集台词。'] }
    ])
    ok(r2.count === 1, '成功 1 集（其余因存储写满失败）', '实际 ' + r2.count)
    ok(!!r2.warn, '带 warn 提示未保存的集数', JSON.stringify(r2))
    ok(Array.isArray(r2.failed) && r2.failed.length === 2, 'failed 明细记录 2 条', JSON.stringify(r2.failed))
  } else {
    ok(r.count === 1, '成功 1 集', '实际 ' + r.count)
    ok(Array.isArray(r.failed) && r.failed.length === 2, 'failed 明细记录 2 条')
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
