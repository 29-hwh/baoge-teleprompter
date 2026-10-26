# 恢复说明（2026-10-26）

本目录是 **2026-10-26 从 WorkBuddy 本地文件历史快照精确还原**的源码，
不是反编译产物——原始缩进、中文注释、变量名全部保留。

## 一、恢复来源

| 项 | 值 |
| --- | --- |
| 恢复方式 | `~/.workbuddy/file-history/` 逐版本文件快照 |
| 索引来源 | `~/.workbuddy/projects/**/*.jsonl` 里的 `file-history-snapshot` 事件 |
| 快照截止 | 2026-09-29 18:27（= 最后一次 git 提交时间） |
| 文件数 | 120 个（其中 `miniprogram/` 34 个，10,342 行） |
| 对应版本 | 界面版本 v1.1.0，最后一次提交 `99920b7` |

## 二、已确认还原到位的关键改动

- `engine/prefs.js` → `DEFAULTS.speed = 50`（原 200），`roleHighlightTheme: 'name'`（原 `'full'`）
- `engine/prefs.js` → `SPEED_PRESETS` 共 5 档，首位为「极慢 / 50」
- `pages/settings/settings.js` → 兜底不再写死 `|| 200`，改走 `DEFAULTS.speed`
- 上述改动均带 2026-09-29 的原始中文注释

## 三、验证结果

- 22 个 JS 全部 `node --check` 通过
- 全部 JSON 可 `json.loads`
- 5 个 WXML 标签闭合平衡（edit 230 行 / index 111 / preview 40 / settings 283 / teleprompter 225）
- `require` 相对路径 **0 缺失**
- `app.json` 声明的 5 个页面 × 4 个文件全部存在

## 四、没有找回来的东西

1. **`.git` 目录**（全部历史提交）——无法恢复，APFS/TRIM 已回收。
   本目录已重新 `git init` 并做了一次「恢复」基线提交，历史从此刻重新开始。
2. **26 个文件没有快照实体**，多为临时脚本与早期废弃页面：
   - `miniprogram/pages/review/*`（4 个）——已废弃页面，`app.json` 未引用，可不理
   - `_tmp_*.py`、`_harness*.js`、`_e2e_real*.js`、`perf_probe.js` 等一次性调试脚本
   - `smart_split_lines.test.js`、`edit_import.test.js`（测试文件，非运行时代码）
3. 可能还有少数从未被工具写过的文件（纯手写/`git clone` 进来的）不在历史里，
   但当前 `miniprogram/` 全量文件齐备，不影响运行。

## 五、当前位置与下一步建议

工程已于 2026-10-26 迁至 `/Users/huweihua/WorkBuddy/宝哥提词器/baoge-teleprompter/`
（恢复过程产生的中间产物在同级 `../恢复档案/`）。

```bash
cd "/Users/huweihua/WorkBuddy/宝哥提词器/baoge-teleprompter"
# 立刻加远程仓库，别再只留本地
git remote add origin <你的私有仓库地址>
git push -u origin main
```

并把 `~/.workbuddy/file-history/`、`~/.workbuddy/projects/` 一并纳入备份范围。
