# NEXT_TASK.md — 下一阶段任务

> 更新时间：2026-05-25
> 每次开始新开发前读取此文件。
> **避免方向漂移**。

---

## 当前优先级（按顺序）

### P0 — 立即处理

#### 1. 验证 preview-result 身价计算修复
- **状态**：代码已改（`qianmeng-train/server.js` L2571-L2641）
- **等待**：Railway 手动 Redeploy
- **验证步骤**：
  1. 去 Railway 控制台点 Redeploy
  2. 等待 1-2 分钟部署完成
  3. 前端重新打开「预览结算」
  4. 确认低身价选手（35/40）也能看到 ±1 变化
  5. 确认 MVP +2% 生效

#### 2. 修复 competition_registrations.side 脏数据
- **问题**：`preview-result` 依赖 `side` 字段判断红蓝方，但部分报名记录的 `side` 可能为空或默认值
- **排查**：直接查 DB `SELECT player_user_id, side FROM competition_registrations WHERE competition_id = 'xxx'`
- **修复**：如果 `side` 缺失，需要从 `team_id` 或 `club_id` 反推，或修改 `preview-result` 逻辑不依赖 `side`

---

### P1 — 近期处理

#### 3. 结算系统：BO 多局数差计算
- **当前**：胜方所有人 +2%，负方所有人 -2%（简化版）
- **目标**：按 `(胜局 - 负局) × 2% + MVP×2%` 精确计算
- **参考**：MEMORY.md 「结算系统（2026-05-24 重构）」章节
- **注意**：需要前端传每个小局的 `winner` + `mvp_player_id`

#### 4. 以俱乐部为单位报名（前端完善）
- **后端**：已支持（`club_id` 字段已加）
- **前端**：`competitionView.js` 报名弹窗需要改为「选择俱乐部 → 自动填入成员」
- **参考**：`MEMORY.md` 「赛事系统」章节

#### 5. 排行榜实时更新优化
- **当前**：`updatePlayerScore()` 在 `confirm-result` 事务提交后调用
- **问题**：可能延迟
- **优化方向**：Socket.io 推送更新事件，前端主动刷新排行榜

---

### P2 — 后续规划

#### 6. app.js 继续拆分
- **当前**：5838 行
- **目标**：拆分到 2000 行以内
- **策略**：把剩余业务逻辑抽到 `modules/` 对应模块

#### 7. server.js 路由拆分
- **当前**：单文件 4100+ 行
- **目标**：拆分到 `routes/` 目录（auth/、competition/、club/、admin/）
- **注意**：拆分前必须先做 **Routes 审计**（哪些路由在用、哪些已废弃）

#### 8. 腾讯会议自动创建 + 预约集成
- **CLI**：`tmeet` 已配置 OAuth
- **功能**：预约比赛时自动创建腾讯会议，把 `meetingCode` 写入 `matches` 表

---

## 禁止在当前阶段做的事

- ❌ 不要重写结算系统（只修 Bug，不重构）
- ❌ 不要修改 `server.js` 数据库结构（加表/改列名）
- ❌ 不要在新功能里写 `window.xxx = ...`
- ❌ 不要直接往 `app.js` 里加新功能代码

---

## 开发前的标准流程

```
1. 读取 PROJECT_MEMORY/PROJECT_RULES.md   ← 必读
2. 读取 PROJECT_MEMORY/CURRENT_STATE.md  ← 必读
3. 读取 PROJECT_MEMORY/KNOWN_BUGS.md   ← 必读
4. 确认当前任务不在「禁止」列表里
5. 开始开发
6. 完成后更新 CURRENT_STATE.md + DEVLOG.md
```

---

*最后更新：2026-05-25*
