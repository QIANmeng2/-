# CURRENT_STATE.md — 当前项目完成状态

> 更新时间：2026-05-25
> 每次完成大阶段后更新此文件。

---

## 一、已完成功能

### ✅ 认证系统
- [x] JWT 登录/注册
- [x] `localStorage.getItem('local_current_user')` 作为 token key
- [x] auth 模块独立化（`modules/auth/`）

### ✅ 聊天系统
- [x] 聊天模块化完成（`modules/chat/` 5 个文件）
- [x] 消息撤回
- [x] @提及
- [x] 身份配色（BOSS/认证/未认证）
- [x] 禁言功能
- [x] 滚动到底

### ✅ 赛事系统
- [x] 三种模式：arena / training / regular
- [x] 赛事 API（GET/POST /api/competitions）
- [x] Match 新模型（/api/matches）
- [x] 状态手动推进（OPEN → LIVE → REVIEW → FINISHED）
- [x] 前端组件系统（Phase 2 重构，9 个组件）
- [x] competition 独立页（competition.html + competition-detail.html）
- [x] Bridge 文件（`competitionLegacyBridge.js`）最小化

### ✅ 梦币系统
- [x] `dream_coins` 字段 + `coin_transactions` 表
- [x] 签到领币（每日 100 梦币）
- [x] 管理员发放
- [x] 赛事奖励自动分配

### ✅ 每日卜卦（V1）
- [x] `fortune_records` 表
- [x] 后端路由（GET + POST /api/me/daily-fortune）
- [x] 前端模块（`modules/fortune/` 4 个文件）
- [x] 加权随机算法（5 种卦象）
- [x] 梦币奖励（大吉 + 88，中吉 + 50，小吉 + 20）
- [x] 移动端主页按钮修复

### ✅ 俱乐部大名单 UI
- [x] 自由名单上下分区
- [x] 身价 ±20% 区间限制
- [x] 7 天冷却期（`price_adjust_logs`）
- [x] 顶级/次级联赛简化 UI

### ✅ 统一响应格式
- [x] `ok()`, `created()`, `badRequest()`, `notFound()`, `forbidden()`, `unauthorized()`, `serverError()`
- [x] 23 个 Jest 集成测试通过

### ✅ 组件系统（Phase 2）
- [x] 9 个核心组件（components/ 目录）
- [x] `components.js` 统一命名空间
- [x] 事件委托 + autoMount + convenience APIs
- [x] 旧 rendering 删除

---

## 二、进行中

### 🔄 结算系统优化
- [x] `preview-result` 路由（干跑模式）
- [x] `confirm-result` 结算逻辑
- [~] **身价计算精度修复（当前进行中）**
  - 问题：低身价（35/40）±2% 计算后不变（+0%）
  - 修复：改用 `Math.ceil` + 保底 ±1
  - 状态：已改 `preview-result` + `confirm-result`，待 Railway 部署验证

### 🔄 身份系统审计
- [x] 身份主键统一审计（user_id vs id vs game_id）
- [x] 身份系统依赖审计
- [ ] 前端 `app.js` 身份读取统一（部分完成）

---

## 三、待开发（NEXT_TASK.md 详细）

1. 结算系统：BO 多局数差计算（当前只算 ±1 局）
2. 赛事报名：以俱乐部为单位报名（后端已支持，前端待完善）
3. 排行榜：实时更新优化
4. 腾讯会议：自动创建 + 预约集成
5. 移动端体验优化（已部分完成）

---

## 四、技术债务

- [ ] `app.js` 仍有 5838 行，需继续拆分
- [ ] `server.js` 路由过多，建议拆分到 `routes/` 目录
- [ ] `competition_registrations.side` 字段值统一（目前可能有脏数据）
- [ ] PostgreSQL `CREATE TABLE` 无引号导致列名小写问题（需全项目审计）

---

*最后更新：2026-05-25*
