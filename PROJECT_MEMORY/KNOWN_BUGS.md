# KNOWN_BUGS.md — 已知未修复问题

> 更新时间：2026-05-25
> **每次开发前必读**，避免重复审计同一问题。

---

## 一、身价结算相关

### BUG-001：`preview-result` 身价计算精度低
- **现象**：身价 35 → 35 (+0%)，40 → 40 (+0%)
- **根因**：`Math.floor(oldValue * 1.02)` 当 oldValue < 50 时增幅 < 1，floor 后不变
- **修复状态**：✅ 已修复（改用 `Math.ceil` + 保底 ±1）
- **验证**：待 Railway 部署后验证
- **提交**：`de1bf18`（qianmeng-train）

### BUG-002：`competition_registrations.side` 脏数据导致胜负判断错误
- **现象**：红方选手在预览结算中被判定为「负」，身价 -2%（应为 +2%）
- **根因**：`preview-result` 用 `regs.rows.filter(r => r.team === winner)` 判断胜负，但部分报名记录的 `side` 字段不是 `'red'` / `'blue'`（可能为空或默认值）
- **修复状态**：🔄 进行中（需要查 DB 确认 `side` 实际值）
- **临时方案**：修改 `preview-result` 不依赖 `side`，改为从 `games` 小局数据反推每个选手的胜负
- **优先级**：P0

### BUG-003：`confirm-result` 身价计算精度（同 BUG-001）
- **现象**：同 BUG-001，`Math.floor` 导致低身价无变化
- **根因**：同 BUG-001
- **修复状态**：✅ 已修复（同 `de1bf18` 提交）
- **验证**：待 Railway 部署

---

## 二、身份系统相关

### BUG-004：`app.js` 中 `id` 与 `user_id` 混用
- **现象**：部分查询用 `WHERE id = $1`（users 表），部分用 `WHERE user_id = $1`（players 表），导致查不到数据
- **根因**：历史代码混用 `id`（users 表 SERIAL）和 `user_id`（外键字符串）
- **修复状态**：🔄 部分修复（审计已完成，但 `app.js` 仍有残留）
- **审计文件**：`身份系统依赖审计完整报告.md`、`身份主键统一审计完整报告.md`
- **优先级**：P1

### BUG-005：`game_id` 被误用作查询条件
- **现象**：用 `game_id`（游戏 ID，如 `梦游`）查 `players` 表，查不到（正确应该用 `user_id`）
- **根因**：`game_id` 只应做展示，不应参与查询
- **修复状态**：✅ 已修复（审计后清理）
- **优先级**：已修复

---

## 三、前端相关

### BUG-006：`fortuneApi.js` token key 错误
- **现象**：卜卦页面 401，无法获取/抽取卦象
- **根因**：`fortuneApi.js` 用 `localStorage.getItem('token')`，但项目实际用 `localStorage.getItem('local_current_user')`
- **修复状态**：✅ 已修复（改为 `localStorage.getItem('local_current_user') || localStorage.getItem('token') || ''`）
- **提交**：`18e3592`、`4daffda`
- **优先级**：已修复

### BUG-007：移动端无法返回主页
- **现象**：移动端切换到非主页 tab 后，tab 栏没有「主页」按钮，无法返回
- **根因**：`index.html` 的 tab 导航栏未包含「主页」按钮
- **修复状态**：✅ 已修复（L92 新增按钮 + `app.js` `updateUI()` 始终显示）
- **提交**：`7ec36cb`
- **优先级**：已修复

### BUG-008：图片解析失败（`400 input length too long`）
- **现象**：用户发截图后，AI 收到 `400 input length too long`，无法看到图片内容
- **根因**：截图太大（可能是全屏截图），超过模型输入长度限制
- **修复状态**：❌ 未修复（建议用户用 F12 Console 截图，或压缩后再发）
- **临时方案**：用户用文字描述问题代替截图
- **优先级**：P2（影响沟通效率，但不阻塞功能）

---

## 四、部署相关

### BUG-009：Railway 部署需要手动操作
- **现象**：`git push` 后 Railway 不会自动部署，需要去控制台手动点 Redeploy
- **根因**：Railway Workspace Token 权限不足，无法触发 `redeploy mutation`
- **修复状态**：❌ 未修复（需要用户手动操作，或配置 GitHub Actions 自动部署）
- **临时方案**：每次 `git push` 后提醒用户去 Railway 控制台点 Redeploy
- **优先级**：P2（影响部署效率）

### BUG-010：Cloudflare 缓存导致前端更新不生效
- **现象**：前端文件已推送，但浏览器访问仍是旧版本
- **根因**：Cloudflare CDN 缓存未清除
- **修复状态**：✅ 已有方案（Cloudflare Dashboard → Caching → Purge Everything，或前端加 cache-busting 参数 `?v=时间戳`）
- **优先级**：已有方案

---

## 五、数据库相关

### BUG-011：`competition_registrations` UNIQUE 约束导致红蓝侧冲突
- **现象**：同一比赛，红方和蓝方各 5 人报名，但 DB 报错 `duplicate key value violates unique constraint`
- **根因**：旧版 UNIQUE 约束是 `(competition_id, side, lane)`，红蓝侧 `side` 不同本应不冲突，但实际约束设计有误
- **修复状态**：✅ 已修复（改为 `(competition_id, player_user_id)`）
- **优先级**：已修复

### BUG-012：PostgreSQL 列名大小写陷阱
- **现象**：JS 里用 `row.gameId`，但 DB 里列名是 `gameid`（全小写），导致 `undefined`
- **根因**：`CREATE TABLE` 无引号 → 列名自动转小写
- **修复状态**：✅ 已记录到 `PROJECT_RULES.md`，新代码全部用小写列名
- **优先级**：已修复（预防）

---

## 六、待确认问题

### BUG-013：`preview-result` 路由 404
- **现象**：前端调用 `POST /api/competitions/:id/preview-result` 返回 404
- **根因**：后端缺少该路由（已修复，但需要 Railway 部署）
- **修复状态**：✅ 已修复（L2571 新增路由），待部署验证
- **优先级**：已修复（待验证）

---

## 修复优先级总结

| 优先级 | BUG 编号 | 描述 | 状态 |
|----------|----------|------|------|
| **P0** | BUG-002 | `side` 脏数据导致胜负判断错误 | 🔄 进行中 |
| **P0** | BUG-001 / 003 | 身价计算精度 | ✅ 已修复，待验证 |
| **P1** | BUG-004 | `id` 与 `user_id` 混用 | 🔄 部分修复 |
| **P2** | BUG-008 | 图片解析失败 | ❌ 未修复 |
| **P2** | BUG-009 | Railway 手动部署 | ❌ 未修复 |

---

*最后更新：2026-05-25*
