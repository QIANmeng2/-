# IDENTITY_SYSTEM.md — 身份系统与主键规则

> 更新时间：2026-05-25
> 所有涉及用户查询、ID 传递的开发前必读。

---

## 一、核心原则

### ✅ user_id 才是真主键
- **所有数据库外键、API 参数、前后端传递，统一用 `user_id`（字符串）**
- `id`（users 表 SERIAL）只用于 users 表内部，不作为外键使用
- `game_id` 只做展示用途（玩家游戏 ID），**不参与任何查询逻辑**

### ❌ 禁止混用
```js
// ❌ 错误：用 game_id 查 players 表
SELECT * FROM players WHERE user_id = '梦游';  // 查不到！

// ✅ 正确：用 user_id（字符串 UUID）
SELECT * FROM players WHERE user_id = 'mp4hmya7ad15v6';
```

---

## 二、字段语义表

| 字段名 | 所在表 | 类型 | 含义 | 用途 |
|--------|--------|------|------|------|
| `id` | `users` | SERIAL | 内部自增 ID | 仅 users 表内部 |
| `user_id` | 多表 | TEXT | 用户唯一 ID（字符串） | **所有外键** |
| `game_id` | `players` | TEXT | 玩家游戏 ID | **只展示** |
| `username` | `users` | TEXT | 登录用户名 | 登录 |
| `coachname` | `users` | TEXT | 显示名 | 展示 |
| `club_id` | `clubs` / `players` | TEXT | 俱乐部 ID | 俱乐部关联 |
| `team_id` | `teams` / `competition_registrations` | TEXT | 队伍 ID | 旧系统，逐步废弃 |
| `player_user_id` | `competition_registrations` | TEXT | 报名选手的 user_id | 赛事报名 |

---

## 三、常见坑点

### 坑 1：PostgreSQL 列名小写陷阱
```sql
-- ❌ 错误：无引号标识符会被转成小写
CREATE TABLE players (
  gameId TEXT  -- 实际列名 = gameid（全小写）
);

-- ✅ 正确：永远用小写 + 下划线
CREATE TABLE players (
  game_id TEXT  -- 实际列名 = game_id
);
```

**JS 访问 pg rows 始终用小写列名**：
```js
// ❌ 错误
row.gameId;  // undefined（实际列名是 gameid）

// ✅ 正确
row.gameid;    // 全小写
row.game_id;   // 如果 CREATE TABLE 用的是 game_id
```

### 坑 2：app.js 中 id 与 user_id 混用
- 历史代码有些地方用 `WHERE id = $1`（users 表）
- 新代码统一用 `WHERE user_id = $1`（外键表）
- **审计结果**：`身份系统依赖审计完整报告.md` 已记录所有混用位置

### 坑 3：前端 localStorage key 不统一
```js
// ✅ 正确（项目实际使用的 key）
const token = localStorage.getItem('local_current_user');

// ❌ 错误（某些旧模块可能用这个）
const token = localStorage.getItem('token');
```

**修复状态**：`fortuneApi.js` 已修复（L12-L13）

---

## 四、各表主外键关系**

```
users
  ├── id (SERIAL, 内部)
  └── (无外键)

players
  ├── user_id TEXT → users.id (注意：这里是 users.id，不是 user_id！)
  └── club_id TEXT → clubs.id

clubs
  └── owner_id TEXT → users.id

competition_registrations
  ├── competition_id TEXT
  ├── player_user_id TEXT → players.user_id
  └── club_id TEXT → clubs.id

competition_results
  ├── competition_id TEXT
  └── player_data JSONB (内含 player_user_id)

coin_transactions
  └── user_id TEXT → users.id

fortune_records
  └── user_id TEXT → users.id
```

**注意**：`players.user_id` 实际指向 `users.id`（SERIAL），不是 `users.user_id`。
这是历史遗留设计，查询时要注意！

---

## 五、查询速查表**

### 根据用户 ID 查玩家信息
```sql
SELECT p.*, u.coachname, u.username
FROM players p
JOIN users u ON p.user_id = u.id  -- 注意：是 u.id，不是 u.user_id！
WHERE p.user_id = $1;
```

### 根据游戏 ID 查玩家信息（只展示用）
```sql
SELECT p.*, u.coachname
FROM players p
JOIN users u ON p.user_id = u.id
WHERE p.game_id = $1;  -- 只用于展示，不用于逻辑
```

### 查某赛事的报名选手
```sql
SELECT cr.player_user_id, u.coachname, p.game_id, p.market_value
FROM competition_registrations cr
JOIN players p ON cr.player_user_id = p.user_id
JOIN users u ON p.user_id = u.id
WHERE cr.competition_id = $1 AND cr.status != 'cancelled';
```

---

## 六、修复历史**

| 日期 | 文件 | 修复内容 |
|------|------|----------|
| 2026-05-18 | `fortuneApi.js` | `localStorage.getItem('token')` → `localStorage.getItem('local_current_user')` |
| 2026-05-18 | `server.js` 多处 | `WHERE id = $1` → `WHERE user_id = $1`（部分） |
| 2026-05-20 | `competitionLegacyBridge.js` | `window.competition` 污染 → 改用 CustomEvent |
| 2026-05-22 | 全项目 | PostgreSQL 列名小写陷阱审计（已完成） |

---

## 七、禁止事项**

- ❌ 禁止用 `game_id` 做查询条件（只展示）
- ❌ 禁止在新建查询中用 `users.id` 作为外键（应该用 `users.user_id`——如果有的话。实际上 users 表没有 user_id 字段，这是设计缺陷）
- ❌ 禁止 `window.xxx` 挂载用户身份信息
- ✅ 新代码统一：`user_id`（字符串）+ `game_id`（展示用）

---

*最后更新：2026-05-25*
