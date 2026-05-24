# 身价计算链路审计报告
# 审计时间：2026-05-25
# 审计范围：competition_registrations → players → preview-result → confirm-result 全链路

---

## 一、表结构审计

### 1.1 competitions 表（真实字段）
```
id, name, qr_code_url, created_by, status, created_at,
tier, start_time, bo, comp_status, description, end_time
```
✅ 无 `mode` 字段（前端用 `type` 字段判断）
✅ 无 `title` 字段（用 `name`）

### 1.2 competition_registrations 表（真实字段）
```
id, competition_id, team_id, player_user_id, lane,
entry_fee, status, created_at, club_id, side
```
⚠️ **无 `user_id` 字段**（只有 `player_user_id` 和 `side`）
⚠️ `side` 字段值来自前端，需验证是否为 `'red'` / `'blue'`

### 1.3 users 表（真实字段）
```
id, username, password, teamname, coachname,
wechat, level, disableddates, bio,
gameid,       ← 注意：无下划线！
gameserver, gamerank, peakscore, lanestats, heropool,
created_at, dream_coins, muted_until, mute_reason, tags
```
🚨 **关键错误：`gameid` 无下划线！**
- 之前代码用 `users.game_id` → 所有关联查询都失败
- 正确字段名：`users.gameid`

### 1.4 players 表（真实字段）
```
id, user_id, game_id, positions, peak_score, game_rank,
screenshot_url, status, market_value, club_id,
reviewed_by, reviewed_at, created_at, screenshot_url2,
grade, buyout_fee, custom_salary, trade_status,
player_score, last_match_result, last_match_mvp,
last_change_percentage, last_match_id
```
✅ `user_id` (text) 是外键，指向 `users.id`
✅ `game_id` (text) 是展示用游戏 ID
✅ `market_value` (integer) 身价

### 1.5 competition_results 表（真实字段）
```
id, competition_id, winner, screenshot_urls (jsonb),
player_data (jsonb), confirmed_by, confirmed_at,
created_at, mvp_player_id, coin_rewards (jsonb)
```

---

## 二、数据链路审计

### 2.1 报名层 → player_user_id
**比赛 ID：** `comp_1779640219096`（状态：review）

| side | lane | player_user_id | status |
|------|------|----------------|--------|
| blue | 中路 | mp7rnmpfxrzlxe | reserved |
| blue | 发育路 | mp7xw22lhgreys | reserved |
| blue | 对抗路 | mp4j072uuayz7a | confirmed |
| blue | 打野 | mpgtscxhbbnpls | reserved |
| blue | 游走 | mp9ac5aerf0ilr | reserved |
| red | 中路 | mp6dog42bxkcj9 | reserved |
| red | 发育路 | mp87zo1qsi5vi7 | confirmed |
| red | 对抗路 | mp6p6du7m2knc3 | reserved |
| red | 打野 | mp6hnl0chgq1r3 | reserved |
| red | 游走 | mp6ybzlvykou1k | confirmed |

✅ `player_user_id` 全部有值
✅ `side` 字段红蓝分布正确（5红 5蓝）

### 2.2 players 表匹配审计

| player_user_id | game_id (展示名) | market_value | 是否有 players 记录 |
|----------------|-------------------|---------------|--|
| mp6dog42bxkcj9 | 系上爱洋的结 | 40 | ✅ |
| mp6hnl0chgq1r3 | 鸽鸽 | 35 | ✅ |
| mp4j072uuayz7a | 雨瑶以梦～ | 35 | ✅ |
| mp6ybzlvykou1k | 喵咕噜不咕噜 | 45 | ✅ |
| mp7xw22lhgreys | yy | 50 | ✅ |
| mp9ac5aerf0ilr | 自信可抵万物 | 50 | ✅ |
| mp6p6du7m2knc3 | 剑不指赴南春 | 35 | ✅ |
| **mp7rnmpfxrzlxe** | 喜宝 | — | ❌ **无 players 记录** |
| **mpgtscxhbbnpls** | 晚风 | — | ❌ **无 players 记录** |
| **mp87zo1qsi5vi7** | Jyunsi | — | ❌ **无 players 记录** |

🚨 **3 个选手有报名但无 players 记录 → 身价 = 0，不调整**

### 2.3 users 表匹配审计
✅ 10/10 个 `player_user_id` 在 `users.id` 中均有匹配
✅ `users.username` 可正常获取
⚠️ `users.gameid`（无下划线）之前被误写为 `users.game_id`

---

## 三、身价计算逻辑审计

### 3.1 preview-result 路由（server.js L2571）

**当前逻辑：**
```js
// 从 competition_registrations 读选手
const regs = await pool.query(
  'SELECT player_user_id, side AS team FROM competition_registrations WHERE competition_id = $1',
  [req.params.id]
);

// 计算 winnerIds
const winnerIds = new Set(
  winner !== 'draw'
    ? regs.rows.filter(r => r.team === winner).map(r => r.player_user_id)
    : []
);

// 对每个选手计算 newValue
const isWin = winnerIds.has(uid);
const isMvp = mvpId && String(uid) === String(mvpId);
const winDiff = isWin ? 1 : -1;
const mvpBonus = isMvp ? 1 : 0;
const totalPercent = (winDiff + mvpBonus) * 2;
let newValue = Math.ceil(oldValue * (1 + totalPercent / 100));
```

**问题：**
1. ⚠️ **`totalPercent` 计算错误**：当前是 `(±1 + mvpBonus) * 2` = 胜方 +4%，负方 -2%，MVP +2%
   - 应该是：**每局胜负差 × 2%**，不是简单 `±1`
   - BO3 2:0 → 胜方 +4%，负方 -4%（正确）
   - BO3 2:1 → 胜方 +2%，负方 -2%（需要按局数计算，当前做不到）
2. ⚠️ **MVP 加成**：当前 `mvpBonus = isMvp ? 1 : 0`，然后 `(winDiff + mvpBonus) * 2`
   - 如果胜方 MVP：`(1+1)*2 = 4%`（正确）
   - 如果负方 MVP：`(-1+1)*2 = 0%`（❌ 负方 MVP 应该还是 -2% + 2% = 0%，这个结果碰巧对，但逻辑不清晰）

### 3.2 confirm-result 路由（server.js L2711）

**当前逻辑：** 与 preview-result 相同（已同步修复）

### 3.3 前端 Bridge 调用审计

**前端 `competitionLegacyBridge.js` L723：**
```js
const res = await fetch('/api/competitions/' + compId + '/preview-result', {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ games: gamesData })
});
```

✅ 前端传 `games` 数组
⚠️ **但 preview-result 路由现在不从 `games` 读选手数据**（已从 `competition_registrations` 读）
⚠️ **`games` 只用来算 `redWins` / `blueWins`** — 如果前端传的 `games` 格式不对，胜负判断会错误

---

## 四、根本问题总结

### 🚨 问题 1：3 个选手无 players 记录
- **现象：** 身价显示为 0，不调整
- **根因：** `mp7rnmpfxrzlxe`（喜宝）、`mpgtscxhbbnpls`（晚风）、`mp87zo1qsi5vi7`（Jyunsi）有 `users` 记录，但 `players` 表无对应行
- **修复：** 为这 3 个用户创建 `players` 记录（需确认 `market_value` 初始值）

### 🚨 问题 2：身价百分比计算不符合规则
- **规则要求：**
  - BO3 2:0 → 胜方 +4%，负方 -4%
  - BO3 2:1 → 胜方 +2%，负方 -2%
  - 每局 MVP 额外 +2%
- **当前代码：** `(winDiff + mvpBonus) * 2` — 只适用于 BO3 2:0 场景
- **修复：** 需要根据 `games` 数组计算**实际胜局数差**，而不是简单 `±1`

### ⚠️ 问题 3：users.gameid 字段名
- **之前代码可能用 `users.game_id`** — 查不到（正确字段名是 `gameid` 无下划线）
- **影响范围：** 需搜索代码中所有 `users.game_id` 并修正为 `users.gameid`

### ⚠️ 问题 4：preview-result 的 winner 判断依赖 side 字段
- **当前逻辑：** `regs.rows.filter(r => r.team === winner)`
- **风险：** 如果 `competition_registrations.side` 的值不是 `'red'` / `'blue'`（例如 `'红方'`），判断失败
- **验证：** 需检查 DB 中 `side` 字段的实际值

---

## 五、修复方案

### 5.1 立即修复（P0）

**A. 为 3 个缺失选手创建 players 记录**
```sql
INSERT INTO players (user_id, game_id, market_value, status)
SELECT u.id, u.gameid, 35, 'available'
FROM users u
WHERE u.id IN ('mp7rnmpfxrzlxe','mpgtscxhbbnpls','mp87zo1qsi5vi7')
ON CONFLICT DO NOTHING;
```

**B. 修复身价计算公式（按实际胜局数差）**
```js
// 根据 games 计算每人的胜局数
const playerWins = {};
for (const g of games) {
  const winnerSide = g.winner; // 'red' or 'blue'
  const mvpId = g.mvp_player_id;
  // 累计胜局数...
}
// 身价公式：(胜局数 - 负局数) × 2% + MVP次数 × 2%
```

**C. 搜索并修复 `users.game_id` → `users.gameid`**
```bash
grep -rn "users\.game_id\|users\.gameid" server.js app.js modules/
```

### 5.2 验证方案

1. **修复后手动验证：**
   - 用 `mp7rnmpfxrzlxe` 账号登录，查看身价是否为 35（初始值）
   - 提交比赛结果，查看身价变化是否正确

2. **自动化验证：**
   - 在 `preview-result` 路由中加日志：输入 `games`、输出 `results`
   - 对比前端展示 vs 后端计算结果

---

## 六、附录：字段名速查表

| 表 | 错误字段名 | 正确字段名 | 备注 |
|---|---|---|---|
| users | `game_id` | `gameid` | 无下划线！ |
| competition_registrations | `user_id` | `player_user_id` | 无 `user_id` 字段 |
| players | `user_id` | `user_id` | ✅ 正确 |
| players | `game_id` | `game_id` | ✅ 正确（这是 players 表的展示字段） |

---

*本报告由审计脚本 `audit_settlement.js` 生成，所有数据来自 Railway PostgreSQL 生产数据库。*
