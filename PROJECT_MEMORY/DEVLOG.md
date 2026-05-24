# DEVLOG.md — 开发日志

> 每次完成修改后追加记录。
> 格式：日期 → 修改内容 → 原因 → 是否验证

---

## 2026-05-25

### fix：preview-result 身价计算精度修复

- **修改内容**：
  - `preview-result` 路由：`Math.floor` → `Math.ceil` + 保底 ±1
  - `confirm-result` 路由：同步修复
  - 公式：`(胜局-负局)×2% + MVP×2%`，最低 ±1
- **原因**：身价 35/40 时 ±2% 不足 1，floor 后 +0%，玩家无感知
- **提交**：`de1bf18`（qianmeng-train）
- **验证状态**：🔄 待 Railway 部署后验证

---

### feat：PROJECT_MEMORY 项目记忆系统建立

- **修改内容**：
  - 创建 `/PROJECT_MEMORY/` 目录
  - 创建 9 个记忆文件（PROJECT_RULES / ARCHITECTURE / CURRENT_STATE / NEXT_TASK / KNOWN_BUGS / ECONOMY_RULES / IDENTITY_SYSTEM / CACHE_RULES / DEVLOG）
- **原因**：防止上下文压缩导致重复 Bug、重复重构、重新污染 app.js
- **验证状态**：✅ 文件已创建，下次开发前读取验证

---

## 2026-05-24

### fix：preview-result 路由 404 修复

- **修改内容**：server.js L2571 新增 `POST /api/competitions/:id/preview-result` 路由
- **原因**：前端 Bridge 调用该路由返回 404（后端未实现）
- **提交**：`c32e93f`
- **验证状态**：✅ Railway 部署后验证通过

### fix：preview-result 格式不匹配

- **修改内容**：
  - 返回字段从 `{ previews }` 改为 `{ results }`
  - 字段名对齐前端：`percent_change` / `player_name` / `mvp_count`
  - 优先接受前端传的 `{ games }` 参数（不从 DB 读）
- **原因**：后端返回字段名和前端期望不一致，导致前端渲染失败
- **提交**：`c32e93f`（同一 commit）
- **验证状态**：✅ 部署后验证通过

---

## 2026-05-23

### fix：开赛失败 404 错误

- **修改内容**：server.js 新增 `POST /api/admin/competitions/:id/start` 路由（15 行），更新 `comp_status` 为 `'live'`
- **原因**：前端调用开赛接口返回 404（后端没有对应路由）
- **提交**：`465b555`
- **验证状态**：✅ Railway 部署后验证通过

### fix：移动端无法返回主页

- **修改内容**：
  - `index.html` L92：新增「主页」按钮 `<button class="tab-btn" data-tab="square" id="tabSquare">主页</button>`
  - `app.js` `updateUI()` L500-501：加 `safeStyle('tabSquare', 'display', '');` 确保始终可见
  - `index.html` L5：viewport meta 修正（`maximum-scale=5.0, user-scalable=yes`）
- **原因**：移动端切换到其他 tab 后，tab 导航栏没有「主页」按钮，无法返回首页
- **提交**：`7ec36cb`
- **验证状态**：✅ 部署后移动端验证通过

---

## 2026-05-22

### feat：前端组件系统 Phase 2 重构

- **修改内容**：
  - 新建 `components/` 目录，9 个核心组件（IIFE + `window.Components`）
  - 新建 `components.js`：统一命名空间 + 事件委托 + autoMount
  - 重写数据流：`switchTab('competition')` → `loadMatches()` → `MatchCard.renderList`
  - 删除旧 rendering（`renderCompetitionPanel` / `switchCompTier` / 旧 `loadCompetitionList` ~80 行）
- **原因**：旧渲染逻辑散落在 `app.js`，难以维护；组件化后易复用、易测试
- **提交**：`7467da9`（组件化重构 commit）
- **验证状态**：✅ 前端验证通过

### fix：PostgreSQL 驼峰列名大小写 bug

- **修改内容**：全项目审计 `gameId` → `gameid`（PostgreSQL 无引号标识符自动转小写）
- **原因**：`CREATE TABLE` 无引号 → 列名存储为全小写，`row.gameId` 返回 `undefined`
- **提交**：`93828f8`
- **验证状态**：✅ 验证通过

---

## 2026-05-21

### feat：身价调整 ±20% 区间限制

- **修改内容**：
  - `server.js` L2674-2680：`POST /api/club/:id/player/:userId/update` 加 ±20% 校验
  - `app.js` `openPlayerDetailModal()` 显示动态范围提示
  - `price_adjust_logs` 表：7 天冷却期，身价=0 时不限制
- **原因**：防止身价恶意炒作，保持经济系统平衡
- **提交**：`7467da9`（同一 commit）
- **验证状态**：✅ 验证通过

### feat：俱乐部大名单 UI 重构

- **修改内容**：
  - 自由名单：上半部「已确定名单」（按队伍分组卡片）+ 下半部「成员分配」（checkbox + 下拉，默认「1队」）
  - 顶级/次级联赛：仅选人 + 保存，无队伍名输入
  - `saveClubRoster`：elite/secondary 发空 `teamId`
- **原因**：旧 UI 混淆「队伍名」和「成员分配」，用户体验差
- **提交**：`7467da9`
- **验证状态**：✅ 验证通过

---

## 2026-05-18

### feat：统一响应格式重构

- **修改内容**：新增 `ok()` / `created()` / `badRequest()` / `notFound()` / `forbidden()` / `unauthorized()` / `serverError()` 助手函数；全项目路由统一返回 `{ success: true/false, data?, message? }`
- **原因**：之前各路由返回格式不一致，前端处理混乱
- **提交**：`fecdb8c`
- **验证状态**：✅ 23 个 Jest 集成测试通过

### fix：fortuneApi.js token key 错误（401 修复）

- **修改内容**：`fortuneApi.js` 两处 `localStorage.getItem('token')` → `localStorage.getItem('local_current_user') || localStorage.getItem('token') || ''`
- **原因**：项目实际用 `localStorage.getItem('local_current_user')` 存 token，`fortuneApi.js` 用了错误的 key，导致卜卦接口 401
- **提交**：`18e3592` + `4daffda`
- **验证状态**：✅ 部署后验证通过

---

## 2026-05-17

### feat：每日卜卦（日循环 V1）完整实现

- **修改内容**：
  - 后端：`fortune_records` 表 + `GET/POST /api/me/daily-fortune` 路由 + `FORTUNE_POOL` 加权随机算法
  - 前端：`modules/fortune/` 4 个文件（fortuneApi / fortuneStore / fortuneView / fortuneAnim）
  - 加权：大吉×1 / 中吉×3 / 小吉×5 / 凶×2 / 大凶×1
  - 奖励：大吉 +88 / 中吉 +50 / 小吉 +20 / 凶 0 / 大凶 0
  - `UNIQUE(user_id, fortune_date)` 防一日多卜
- **原因**：增加用户粘性，提供情绪价值
- **提交**：多个 commit 累积
- **验证状态**：🔄 部分验证（卜卦流程通，身价计算待验证）

---

## 格式说明

```
## YYYY-MM-DD

### type：简短标题

- **修改内容**：（列出了什么文件 / 什么逻辑）
- **原因**：（为什么改）
- **提交**：（commit hash）
- **验证状态**：✅ 已验证 / 🔄 待验证 / ❌ 验证失败
```
