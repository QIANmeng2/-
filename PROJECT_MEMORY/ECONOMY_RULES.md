# ECONOMY_RULES.md — 梦币 / 身价 / MVP / 结算规则

> 更新时间：2026-05-25
> 所有结算相关开发前必读。

---

## 一、身价计算公式（官方）

### 新公式（2026-05-24 重构）
```
新身价 = 旧身价 × (1 + 总百分比)

总百分比 = (本方胜局 - 对方胜局) × 2%  +  MVP次数 × 2%
```

**示例（BO3，红方 2:1 胜）：**
- 红方选手 A：胜 2 局，负 1 局，MVP×1
  - `(2-1) × 2% + 1 × 2% = 1×2% + 2% = 4%`
  - 新身价 = 旧身价 × 1.04
- 红方选手 B：胜 2 局，负 1 局，无 MVP
  - `(2-1) × 2% = 2%`
  - 新身价 = 旧身价 × 1.02
- 蓝方选手 C：胜 1 局，负 2 局，无 MVP
  - `(1-2) × 2% = -2%`
  - 新身价 = 旧身价 × 0.98

### 保底规则
- 身价 ≥ 1（不会降到 0 或负数）
- 低身价时（`oldValue < 50`），用 `Math.ceil` 保证至少 ±1
- 身价 = 0 的玩家：**跳过结算**，不调整

### 当前实现状态（server.js）
| 路由 | 公式 | 状态 |
|------|------|------|
| `preview-result` | ✅ 已实现（L2571） | 待验证 |
| `confirm-result` | ✅ 已实现（L2645） | 待验证 |
| 简化版（±2%） | ❌ 已废弃 | 被新公式替代 |

---

## 二、梦币系统

### 获取途径
| 途径 | 数量 | 限制 |
|------|------|------|
| 每日签到 | +100 | 每 24 小时 1 次 |
| 卜卦奖励 | +88（大吉）/ +50（中吉）/ +20（小吉） | 每日 1 次 |
| 赛事奖励（胜方分配） | 按入场费比例分配 | 仅胜方 |
| 管理员发放 | 任意 | 无限制 |

### 消耗途径
| 途径 | 数量 | 说明 |
|------|------|------|
| 赛事入场费 | 可变 | 报名时冻结 |
| 转会费 | 可变 | 俱乐部转会 |

### _transaction 类型
```sql
SELECT DISTINCT type FROM coin_transactions;
-- 结果：
-- 'initial_grant'  -- 初始发放
-- 'checkin'         -- 签到
-- 'fortune'         -- 卜卦奖励
-- 'reward'          -- 赛事奖励
-- 'award'           -- 管理员发放
-- 'deduct'          -- 支出/入场费
-- 'refund'          -- 退款
```

---

## 三、MVP 规则

### MVP 产生方式
- 每小局结束后，管理员手动指定 MVP 玩家
- 存储在 `matches.results[index].mvp_player_id` 或 `games[*].mvp_player_id`

### MVP 加成
- 每次 MVP：身价 **额外 +2%**
- 可叠加（BO5 拿 3 次 MVP → +6%）

---

## 四、结算流程

### 完整流程（管理员视角）
```
1. 比赛结束 → 管理员点「提交结果」
2. 填写每小局胜方 + MVP
3. 点「预览结算」→ 查看身价变化（干跑，不写库）
4. 确认无误 → 点「确认结算」
5. 后端执行：
   a. 开启事务
   b. 更新 players.market_value
   c. 写入 competition_player_stats
   d. 分配梦币奖池
   e. 更新 competition_results.confirmed_by / confirmed_at
   f. 更新 competitions.comp_status = 'finished'
   g. 提交事务
6. 事务提交后 → 更新排行榜（updatePlayerScore）
```

### 防重复结算
```js
// server.js L2714
if (pl.rows[0].last_match_id === compResultId) continue;
```
- `players.last_match_id` 记录最近一次结算的 `competition_results.id`
- 重复调用 `confirm-result` 会被跳过

---

## 五、入场费与奖池

### 报名时
```js
// 入场费冻结（pending）
INSERT INTO coin_transactions (user_id, amount, type, note)
VALUES ($1, $2, 'deduct', '赛事入场费');
```

### 结算时
- **胜方分配**：按胜方玩家入场费占胜方总入场费的比例分配总奖池
- **公式**：`share = totalPool × (playerFee / winnerTotalFee)`
- **手动奖励**：管理员可在 `coin_rewards` JSONB 里手动设置每个玩家的奖励（覆盖自动分配）

---

## 六、相关数据库表

### `players`
| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | TEXT | 外键（用户 ID） |
| `market_value` | INTEGER | 身价 |
| `last_match_result` | TEXT | 最近比赛结果（`win`/`lose`） |
| `last_match_mvp` | BOOLEAN | 最近比赛是否 MVP |
| `last_change_percentage` | DECIMAL(5,2) | 最近身价变化百分比 |
| `last_match_id` | INTEGER | 最近结算的 competition_results.id |

### `competition_results`
| 字段 | 类型 | 说明 |
|------|------|------|
| `competition_id` | TEXT | 赛事 ID |
| `winner` | TEXT | 胜方（`red`/`blue`/`draw`） |
| `player_data` | JSONB | 选手数据（含 `_games` 元数据） |
| `mvp_player_id` | TEXT | MVP 玩家 ID |
| `coin_rewards` | JSONB | 手动设置的梦币奖励 |
| `confirmed_by` | TEXT | 确认结算的管理员 ID |
| `confirmed_at` | TIMESTAMP | 结算时间 |

### `coin_transactions`
| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | TEXT | 用户 ID |
| `amount` | INTEGER | 数量（正=收入，负=支出） |
| `type` | TEXT | 类型（见上文） |
| `note` | TEXT | 备注 |

---

## 七、禁止事项

- ❌ 禁止修改身价计算公式（除非用户明确要求）
- ❌ 禁止在 `confirm-result` 之外直接修改 `players.market_value`
- ❌ 禁止使用 `UPDATE players SET market_value = ...` 硬编码数值
- ✅ 必须用 `calculateMatchSettlement()` 函数（或等效逻辑）

---

*最后更新：2026-05-25*
