# PROJECT_RULES.md — 项目最高规则

> ⚠️ 所有 AI 开发前必须读取此文件。
> 违反以下规则会导致重复 Bug、上下文污染、模块回退。

---

## 一、禁止事项（硬性）

### ❌ 禁止 1：新逻辑写回 app.js
- `app.js` 是**路由入口 + UI 调度器**，不是业务容器
- 新功能必须写在 `modules/` 对应模块内
- 只允许：路由守卫、tab 切换、全局错误处理、低成本 helper
- **判断标准**：超过 30 行业务逻辑 → 必须抽到模块

### ❌ 禁止 2：window.xxx 污染
- 禁止在 `app.js` 或 HTML 中挂载 `window.competition = ...` 等全局变量
- 模块通信必须通过：
  - `CustomEvent`（事件总线）
  - 或模块 Store（如 `CompetitionStore`）
- 例外：`window.Components` 是官方组件命名空间，允许

### ❌ 禁止 3：重写已有系统
- 结算系统、报名系统、聊天系统，**只修 Bug，不重写**
- 需要新功能 → 在现有函数内**最小侵入式修改**
- 重写前必须先问用户

---

## 二、架构原则

### ✅ 原则 1：competition / chat 独立模块化
- `modules/competition/` 完全独立，不依赖 `app.js` 内部状态
- `modules/chat/` 完全独立
- Bridge 文件（`competitionLegacyBridge.js`）是唯一允许连接 app.js 的胶水层

### ✅ 原则 2：user_id 才是真主键
- **所有数据库外键、API 参数、前后端传递，统一用 `user_id`（字符串）**
- `game_id` 只做展示用途（玩家游戏 ID），不参与逻辑
- `id`（users 表）在某些 old 表里存在，新代码统一用 `user_id`
- **PostgreSQL 坑**：无引号列名会被转成小写（`gameId` → `gameid`），SQL 中永不使用双引号

### ✅ 原则 3：优先 Bridge，优先最小侵入式修复
- 修改已有功能 → 先读 Bridge 文件和对应模块
- 修复 Bug → 改最小范围，不重构
- 新功能 → 新建模块文件，Bridge 只做挂载

---

## 三、数据库规则

### PostgreSQL 列名大小写陷阱
```sql
-- ❌ 错误：JS 里用 gameId，实际存在 DB 里是 gameid（全小写）
CREATE TABLE players (gameId TEXT);  -- 实际列名 = gameid

-- ✅ 正确：SQL 永远用小写列名
CREATE TABLE players (game_id TEXT);
```
**JS 访问 pg rows 始终用小写列名**：`row.gameid`（不是 `row.gameId`）

### 常用 ID 字段语义
| 字段名 | 含义 | 用途 |
|--------|------|------|
| `user_id` | 用户唯一 ID（字符串） | 所有外键 |
| `game_id` | 玩家游戏 ID | 只展示 |
| `username` | 登录用户名 | 登录 |
| `coachname` | 显示名 | 展示 |
| `club_id` | 俱乐部 ID | 俱乐部关联 |
| `team_id` | 队伍 ID | 旧系统，逐步废弃 |

---

## 四、部署规则

### 修改 server.js
1. 修改 `qianmeng-train/server.js`（本地工作副本）
2. `git commit` + `git push origin main`
3. **必须手动去 Railway 控制台 Redeploy**（Workspace Token 无权自动触发）
4. 验证：`curl -s https://neondream.cn/api/xxx -H "Authorization: Bearer test"` 返回 401（路由存在）而非 404

### 修改前端文件（HTML/JS/CSS）
1. 修改 `qianmeng-train/` 对应文件
2. 同步到 `qianmeng-clone/`（`cp` 或 `git pull --rebase`）
3. 推送到 GitHub `QIANmeng2/-` main 分支
4. GitHub Pages Action 自动部署（约 1-2 分钟）
5. 验证：打开 `https://qianmeng2.github.io/-` 并硬刷新（Ctrl+Shift+R）

### Cloudflare 缓存
- 静态资源更新后，需要在 Cloudflare Dashboard → Caching → Configuration → **Purge Everything**
- 或前端添加 cache-busting 参数：`?v=时间戳`

---

## 五、读取顺序（每次开发前）

```
1. PROJECT_MEMORY/PROJECT_RULES.md   ← 本文件（必读）
2. PROJECT_MEMORY/ARCHITECTURE.md   ← 当前架构状态
3. PROJECT_MEMORY/CURRENT_STATE.md  ← 已完成 / 进行中
4. PROJECT_MEMORY/KNOWN_BUGS.md   ← 已知未修复 Bug
```

---

*最后更新：2026-05-25*
