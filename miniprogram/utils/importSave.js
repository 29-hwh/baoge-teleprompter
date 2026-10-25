/**
 * 导入落盘（单一事实来源）
 * ---------------------------------------------------------------
 * index 页面与「文档预览页」共用这里的落盘逻辑，避免两边各写一份、
 * 改一处漏一处。
 *
 * 设计约定：
 *   - 本模块只负责「store 落盘 + 返回结果」，**不负责导航、不负责 toast**；
 *     导航与提示交给调用方（页面）处理，这样单篇/拆分两种页面都能复用。
 *   - 返回结构统一为 { script? } / { count, folderId? } / { error }，
 *     便于页面据此决定 redirectTo(单篇) 还是 navigateBack(拆分)。
 *
 * 三种导入模式（对应预览页三个按钮）：
 *   - commitSingle            → 作为一篇导入（不拆分）
 *   - commitSplitOriginal     → 智能拆分（纯文字档）：原版 smartSplitScripts，无字数兜底
 *   - commitSplitFromSegments → 智能多模态拆分（表格）：最新规则_v1（表格稿/段落稿）
 *   - commitSplitSmart        → 兼容旧入口（smartSplitScripts + 字数兜底，属新规则体系）
 */
const store = require('../engine/store.js')
const util = require('./util.js')

/** 不重名的文件夹名（同一天多次拆分导入时加序号） */
function uniqueFolderName(base) {
  const names = new Set((store.listFolders() || []).map((f) => f.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * 保存为单篇台本。
 * @returns {{script: object}|{error: string}}
 */
function commitSingle(name, content) {
  let title = (name || '导入的台本').replace(/\.(docx|doc|txt|md|text)$/i, '').trim()
  if (!title || title === '导入的台本') title = util.autoName(content)
  const script = store.create(title.slice(0, 30), content)
  const r = store.save(script)
  if (!r.ok) return { error: (r && r.msg) || '保存失败' }
  return { script }
}

/**
 * 把若干「部分 / 集」逐篇落盘到同一文件夹（一篇=一部分/一集）。
 * parts 元素既可以是智能拆分结果 { title, content }，也可以是
 * 规则_v1 的 segments { name, lines }，这里统一兼容。
 * @returns {{count:number, folderId:string}|{count:0, error:string}}
 */
function _savePartsAsFolder(parts) {
  const now = new Date()
  const p = (x) => (x < 10 ? '0' + x : '' + x)
  const folder = store.createFolder(uniqueFolderName(`${p(now.getMonth() + 1)}-${p(now.getDate())}`))
  let ok = 0
  const failed = []
  for (const part of parts) {
    const content = part.content != null ? String(part.content) : (part.lines || []).join('\n')
    if (!content.trim()) continue
    const title = ((part.title != null ? part.title : part.name) || util.autoName(content)).slice(0, 30)
    const script = store.create(title, content)
    script.folderId = folder.id
    const r = store.save(script)
    if (r.ok) {
      ok++
    } else {
      // 零遗漏红线：落盘失败**绝不能静默跳过**。
      // 否则用户只会看到「导入 7 集」，却不知道另外 3 集的内容根本没存下来。
      failed.push({ title: title, reason: (r && r.msg) || '保存失败' })
    }
  }
  if (ok === 0) {
    store.removeFolder(folder.id)
    return { count: 0, error: '导入失败，本地存储可能已满', failed: failed }
  }
  const res = { count: ok, folderId: folder.id }
  if (failed.length) {
    res.failed = failed
    res.warn = `有 ${failed.length} 集未保存（${failed[0].reason}），请清理存储后重新导入`
  }
  return res
}

/**
 * 按「拆分规则_v1」产出的 segments 逐集落盘到同一文件夹（一集=一篇）。
 * 仅 1 集时退化为单篇（返回 {script}），由调用方决定是否跳转编辑页。
 * @returns {{count:number, folderId?:string}|{script:object}|{error:string}}
 */
function commitSplitFromSegments(segments, name) {
  if (!segments || !segments.length) return { error: '没有可拆分的集', count: 0 }
  if (segments.length === 1) {
    const r = commitSingle(name, (segments[0].lines || []).join('\n'))
    return r.script ? { count: 1, script: r.script } : { count: 0, error: r.error }
  }
  return _savePartsAsFolder(segments)
}

/**
 * 文本智能拆分（含字数兜底）：按集/场/章标题 → 空行 → 字数分批。
 * 仅拆出 1 篇时退化为单篇（返回 {script}）。
 * @returns {{count:number, folderId?:string}|{script:object}|{error:string}}
 */
function commitSplitSmart(content, mode) {
  let parts = mode === 'smart' ? util.smartSplitScripts(content) : util.splitImportBlocks(content, mode)
  // 兜底：标题/空行都没识别出可拆点时，自动改用「按字数分批」（用户点了拆分就是要多篇）
  if (parts.length <= 1 && mode !== 'size') {
    parts = util.splitImportBlocks(content, 'size')
  }
  if (parts.length <= 1) {
    const r = commitSingle('', content)
    return r.script ? { count: 1, script: r.script } : { count: 0, error: r.error }
  }
  return _savePartsAsFolder(parts)
}

/**
 * 智能拆分（纯文字档）—— 运行「未加入新拆分规则」的原版逻辑。
 * 仅使用 util.smartSplitScripts（按集/场/章标题 → 空行切分），不做字数兜底，
 * 忠实还原旧版行为；拆出 1 篇时退化为单篇（返回 {script}）。
 * @returns {{count:number, folderId?:string}|{script:object}|{error:string}}
 */
function commitSplitOriginal(content) {
  const parts = util.smartSplitScripts(content)
  if (parts.length <= 1) {
    const r = commitSingle('', content)
    return r.script ? { count: 1, script: r.script } : { count: 0, error: r.error }
  }
  return _savePartsAsFolder(parts)
}

module.exports = {
  uniqueFolderName,
  commitSingle,
  commitSplitFromSegments,
  commitSplitSmart,
  commitSplitOriginal
}
