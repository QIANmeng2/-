# PROJECT_MEMORY — 项目长期记忆系统

> **每次开始新开发前，必须先读取本目录下的核心文件。**
> 这能防止上下文压缩导致重复 Bug、重复重构、重新污染 app.js。

---

## 一、文件索引（按读取优先级排序）

| 优先级 | 文件名 | 内容 | 何时读 |
|--------|--------|------|----------|
| **P0** | `PROJECT_RULES.md` | 最高规则（禁止事项 + 架构原则） | **每次开发前必读** |
| **P0** | `CURRENT_STATE.md` | 当前完成状态 + 进行中任务 | **每次开发前必读** |
| **P0** | `KNOWN_BUGS.md` | 已知未修复 Bug 清单 | **每次开发前必读** |
| P1 | `ARCHITECTURE.md` | 目录结构 + 模块关系图 | 新功能开发前 |
| P1 | `NEXT_TASK.md` | 下一阶段任务优先级 | 每日开始工作时 |
| P1 | `ECONOMY_RULES.md` | 梦币 / 身价 / MVP / 结算规则 | 涉及经济系统修改前 |
| P2 | `IDENTITY_SYSTEM.md` | user_id / game_id / 字段语义 | 涉及用户查询前 |
| P2 | `CACHE_RULES.md` | 部署链路 + 缓存清除规则 | 每次部署前 |
| P2 | `DEVLOG.md` | 按日期记录的开发历史 | 排查历史问题时 |

---

## 二、标准开发流程

```
1. 读取 PROJECT_MEMORY/PROJECT_RULES.md   ← 必读（防犯禁）
2. 读取 PROJECT_MEMORY/CURRENT_STATE.md  ← 必读（知进展）
3. 读取 PROJECT_MEMORY/KNOWN_BUGS.md   ← 必读（避旧坑）
4. 确认当前任务不在「禁止」列表里
5. 开始开发
6. 完成后更新：
   - CURRENT_STATE.md（状态变更）
   - DEVLOG.md（记录本次修改）
   - NEXT_TASK.md（如需调整优先级）
   - KNOWN_BUGS.md（如引入新 Bug）
```

---

## 三、文件更新触发条件

| 文件 | 何时必须更新 |
|------|----------------|
| `CURRENT_STATE.md` | 完成一个功能 / 开始新任务 / 功能被阻塞 |
| `DEVLOG.md` | 每次完成一个有实质修改的 commit |
| `NEXT_TASK.md` | 任务优先级变化 / 完成 P0 任务 |
| `KNOWN_BUGS.md` | 发现新 Bug / 修复旧 Bug / Bug 状态变更 |
| `PROJECT_RULES.md` | 新增架构规则 / 发现新禁止事项 |
| `ARCHITECTURE.md` | 新增 / 删除 / 重命名模块 |
| `ECONOMY_RULES.md` | 身价公式 / 梦币规则变更 |
| `IDENTITY_SYSTEM.md` | 身份字段语义变更 / 发现新坑点 |
| `CACHE_RULES.md` | 部署链路变更 / 新增缓存层 |

---

## 四、禁止事项（摘要）

完整规则见 `PROJECT_RULES.md`。

- ❌ **禁止** 新逻辑写回 `app.js`（>30 行必须抽模块）
- ❌ **禁止** `window.xxx` 污染（用 CustomEvent / Store）
- ❌ **禁止** 重写已有系统（只修 Bug，不重构）
- ❌ **禁止** 用 `game_id` 做查询条件（只展示）
- ❌ **禁止** 假设「推送 = 线上已更新」（必须按验证流程）

---

## 五、当前项目关键信息（速查）

| 项目 | 值 |
|------|-----|
| 后端仓库 | `qianmeng-train/`（本地）→ GitHub `QIANmeng2/-` main |
| 前端仓库 | `qianmeng-clone/`（本地）→ GitHub `QIANmeng2/-` main |
| 部署平台 | Railway（后端 API）+ GitHub Pages（前端静态） |
| 数据库 | Railway PostgreSQL（`postgres://postgres:...@yamabiko.proxy.rlwy.net:35510/railway`） |
| 管理员 ID | `mp4hmya7ad15v6` |
| Token key | `localStorage.getItem('local_current_user')` |
| Railway API Token | `e53be99f-1358-4930-bcf1-9d93fae7fdeb`（Workspace 级别，无权触发 redeploy） |

---

## 六、记忆系统维护规则**

- 每次**完成大阶段**（>3 个文件修改）→ 更新 `CURRENT_STATE.md` + `DEVLOG.md`
- 每次**发现新 Bug** → 追加到 `KNOWN_BUGS.md`
- 每次**架构调整**（增删模块）→ 更新 `ARCHITECTURE.md`
- **每月 1 次** 整理 `DEVLOG.md`，把 >30 天的条目归档到 `ARCHIVE/DEVLOG-YYYY-MM.md`
- **禁止** 写空文档 / 敷衍总结 / 自动生成无意义内容

---

*创建时间：2026-05-25*
*创建原因：上下文压缩导致重复 Bug、重复重构、重新污染 app.js*
*维护者：浅梦 + 小梦*
