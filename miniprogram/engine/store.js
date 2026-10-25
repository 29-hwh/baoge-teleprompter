/**
 * 台本本地存储
 *
 * 差异化点：不限制条数（竞品只给 10 条）。
 * 但微信本地存储总上限约 10MB，写满时要给用户明确提示而不是静默失败。
 */

const KEY = 'scripts_v1'
const FOLDER_KEY = 'folders_v1'
// 进度（lastPosition）独立成键：切后台/拖动频繁保存时只写一小块 map，
// 不再重写整个 scripts_v1 大表（审查报告 P3-2）。
const POS_KEY = 'tp_positions_v1'
const { genId } = require('../utils/util.js')

function _readAll() {
  try {
    const data = wx.getStorageSync(KEY)
    if (Array.isArray(data)) return data
  } catch (e) {
    console.error('[store] 读取失败', e)
  }
  return []
}

function _writeAll(list) {
  try {
    wx.setStorageSync(KEY, list)
    return true
  } catch (e) {
    console.error('[store] 写入失败', e)
    return false
  }
}

// ---------- 进度独立存储（避免整表重写） ----------
function _readPositions() {
  try {
    const data = wx.getStorageSync(POS_KEY)
    if (data && typeof data === 'object') return data
  } catch (e) {
    console.error('[store] 进度读取失败', e)
  }
  return {}
}

function _writePositions(map) {
  try {
    wx.setStorageSync(POS_KEY, map)
    return true
  } catch (e) {
    console.error('[store] 进度写入失败', e)
    return false
  }
}

/**
 * 台本列表，按更新时间降序
 */
function list() {
  return _readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

// ---------- 文件夹 ----------
// 文件夹独立成表；台本通过可选字段 folderId 归属文件夹。
// 拆分导入的 Word 会先生成一个文件夹，再把拆分出的多篇台本全部挂进去。

function _readFolders() {
  try {
    const data = wx.getStorageSync(FOLDER_KEY)
    if (Array.isArray(data)) return data
  } catch (e) {
    console.error('[store] 文件夹读取失败', e)
  }
  return []
}

function _writeFolders(list) {
  try {
    wx.setStorageSync(FOLDER_KEY, list)
    return true
  } catch (e) {
    console.error('[store] 文件夹写入失败', e)
    return false
  }
}

/**
 * 新建文件夹（返回带 id 的对象，失败返回 null）
 */
function createFolder(name) {
  const now = Date.now()
  const folder = { id: genId(), name: name || '未命名', createdAt: now }
  const all = _readFolders()
  all.push(folder)
  return _writeFolders(all) ? folder : null
}

/** 文件夹列表（新建时间升序 = 拆分顺序稳定） */
function listFolders() {
  return _readFolders().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

/** 按 id 取文件夹 */
function getFolder(id) {
  if (!id) return null
  return _readFolders().filter((f) => f.id === id)[0] || null
}

/** 文件夹改名 */
function renameFolder(id, name) {
  const all = _readFolders()
  const f = all.filter((x) => x.id === id)[0]
  if (!f) return false
  f.name = name || '未命名'
  return _writeFolders(all)
}

/** 删除文件夹记录（其下台本请用 removeByFolder 删除，或调用者自行处理） */
function removeFolder(id) {
  const all = _readFolders().filter((f) => f.id !== id)
  return _writeFolders(all)
}

/** 删除某文件夹下的全部台本（连文件夹一起删的辅助） */
function removeByFolder(folderId) {
  if (!folderId) return false
  const all = _readAll().filter((s) => s.folderId !== folderId)
  return _writeAll(all)
}

function get(id) {
  const all = _readAll()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i]
  }
  return null
}

/**
 * 新建台本对象
 */
function create(title, content) {
  const now = Date.now()
  return {
    id: genId(),
    title: title || '未命名台本',
    content: content || '',
    roles: [],
    roleColorOverride: {},
    manualRoles: [],
    roleBlacklist: [],
    roleAlias: {}, // 角色合并规则：{ 源名: 标准名 }，用于手动合并/拆分
    settings: null, // null 表示跟随全局偏好
    lastPosition: 0, // 进度 0-1，用于续播
    stats: [], // 提词复盘记录，最近 30 条，详见 engine/stats.js
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 保存台本（新增或更新）
 * @returns {{ok:boolean, msg:string}}
 */
function save(script) {
  if (!script || !script.id) return { ok: false, msg: '台本数据不完整' }
  const all = _readAll()
  const idx = all.findIndex((s) => s.id === script.id)
  script.updatedAt = Date.now()
  if (idx >= 0) {
    all[idx] = script
  } else {
    all.push(script)
  }
  const ok = _writeAll(all)
  return ok ? { ok: true, msg: '' } : { ok: false, msg: '本地存储已满，请删除一些台本后重试' }
}

function remove(id) {
  const all = _readAll().filter((s) => s.id !== id)
  return _writeAll(all)
}

/**
 * 仅更新进度，避免整篇台本反复写入存储。
 * 进度独立成键（P3-2）：只写一小块 map，不再重写 scripts_v1 大表。
 */
function updatePosition(id, position) {
  if (!id) return false
  const map = _readPositions()
  map[id] = position
  return _writePositions(map)
}

/**
 * 读取某台本续播进度（0-1）。优先取独立进度键，兼容老数据（lastPosition 内嵌在台本对象里）。
 */
function getPosition(id) {
  if (!id) return 0
  const map = _readPositions()
  if (typeof map[id] === 'number') return map[id]
  const s = get(id)
  return s && typeof s.lastPosition === 'number' ? s.lastPosition : 0
}

/**
 * 估算已占用存储（字节）
 */
function estimateSize() {
  try {
    const raw = JSON.stringify(_readAll())
    return raw.length * 2 // JS 字符串按 UTF-16 计，粗略折算
  } catch (e) {
    return 0
  }
}

/**
 * 追加一条提词复盘记录（最近 30 条，超出丢弃最旧）。
 * 见 engine/stats.js 的 snapshot() 字段定义。
 */
function appendStat(id, stat) {
  const all = _readAll()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) {
      if (!Array.isArray(all[i].stats)) all[i].stats = []
      all[i].stats.push(stat)
      if (all[i].stats.length > 30) all[i].stats = all[i].stats.slice(-30)
      // 不刷新 updatedAt，避免复盘写入把列表顺序打乱
      _writeAll(all)
      return true
    }
  }
  return false
}

/**
 * 读取某台本的全部复盘记录（可能为空数组）
 */
function getStats(id) {
  const s = get(id)
  return s && Array.isArray(s.stats) ? s.stats : []
}

module.exports = {
  KEY,
  FOLDER_KEY,
  list,
  get,
  create,
  save,
  remove,
  removeByFolder,
  createFolder,
  listFolders,
  getFolder,
  renameFolder,
  removeFolder,
  updatePosition,
  getPosition,
  estimateSize,
  appendStat,
  getStats
}
