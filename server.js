const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
// deploy trigger
const cors = require('cors');
const { Pool } = require('pg');

// 腾讯云混元视觉（延迟加载，避免未配置时报错）
let _hunyuanClient = null;
function getHunyuanClient() {
  if (_hunyuanClient) return _hunyuanClient;
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';
  if (!secretId || !secretKey) return null;
  const tencentcloud = require("tencentcloud-sdk-nodejs-hunyuan");
  const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;
  _hunyuanClient = new HunyuanClient({
    credential: { secretId, secretKey },
    region: "ap-guangzhou",
    profile: {
      httpProfile: { endpoint: "hunyuan.tencentcloudapi.com" },
      signMethod: "TC3-HMAC-SHA256"
    }
  });
  return _hunyuanClient;
}

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Railway 健康检查端点（无需认证，放在所有路由最前）
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('QIANmeng API Running'));

// 统一响应助手函数
function ok(res, data, message) {
  const resp = { success: true };
  if (data !== undefined) resp.data = data;
  if (message) resp.message = message;
  res.json(resp);
}
function created(res, data, message) {
  const resp = { success: true };
  if (data !== undefined) resp.data = data;
  if (message) resp.message = message;
  res.status(201).json(resp);
}
function badRequest(res, message) { res.status(400).json({ success: false, message }); }
function notFound(res, message) { res.status(404).json({ success: false, message }); }
function forbidden(res, message) { res.status(403).json({ success: false, message }); }
function unauthorized(res, message) { res.status(401).json({ success: false, message }); }
function serverError(res, message, error) {
  if (error) console.error('[SERVER ERROR]', error);
  res.status(500).json({ success: false, message });
}



// 更新选手player_score：0.5 * market_value + 0.5 * (dream_coins / 10000)
// 单位统一为"万"，即：身价(万)*0.5 + 梦币(万)*0.5
async function updatePlayerScore(userId) {
  try {
    const result = await pool.query(`
      SELECT p.market_value, u.dream_coins
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.user_id = $1
    `, [userId]);
    if (result.rows.length === 0) return;
    const { market_value, dream_coins } = result.rows[0];
    const mv = market_value || 0;
    const dc = (dream_coins || 0) / 10000; // 梦币转万单位
    const playerScore = Math.round(0.5 * mv + 0.5 * dc);
    await pool.query('UPDATE players SET player_score = $1 WHERE user_id = $2', [playerScore, userId]);
    const playerClub = await pool.query('SELECT club_id FROM players WHERE user_id = $1', [userId]);
    if (playerClub.rows.length > 0 && playerClub.rows[0].club_id) {
      await updateClubScore(playerClub.rows[0].club_id);
    }
  } catch (e) {
    console.error('[updatePlayerScore error]', e);
  }
}

// 更新俱乐部club_score：top5上场成员player_score之和
async function updateClubScore(clubId) {
  try {
    const members = await pool.query(`
      SELECT player_score
      FROM players
      WHERE club_id = $1 AND status = 'approved'
      ORDER BY player_score DESC
      LIMIT 5
    `, [clubId]);
    const clubScore = members.rows.reduce((sum, m) => sum + (m.player_score || 0), 0);
    await pool.query('UPDATE clubs SET club_score = $1 WHERE id = $2', [clubScore, clubId]);
  } catch (e) {
    console.error('[updateClubScore error]', e);
  }
}

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        teamName TEXT NOT NULL,
        coachName TEXT NOT NULL,
        wechat TEXT NOT NULL,
        level TEXT DEFAULT '大众',
        bio TEXT DEFAULT '',
        disabledDates TEXT[] DEFAULT '{}',
        gameId TEXT DEFAULT '',
        gameServer TEXT DEFAULT '手Q区',
        gameRank TEXT DEFAULT '星耀',
        peakScore INTEGER DEFAULT 0,
        laneStats TEXT DEFAULT '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}',
        heroPool TEXT DEFAULT '',
        dream_coins INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        relatedId TEXT,
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        bio TEXT DEFAULT '',
        captainId TEXT NOT NULL,
        maxMembers INTEGER DEFAULT 7,
        status TEXT DEFAULT 'open',
        createdAt TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        teamId TEXT NOT NULL,
        userId TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joinedAt TIMESTAMP DEFAULT NOW(),
        UNIQUE(teamId, userId)
      );
    `);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS disabledDates TEXT[] DEFAULT \'{}\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameId TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameServer TEXT DEFAULT \'手Q区\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameRank TEXT DEFAULT \'星耀\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS peakScore INTEGER DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS laneStats TEXT DEFAULT \'{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS heroPool TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()');
    await client.query('ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_id TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS dream_coins INTEGER DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP DEFAULT NULL');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_reason TEXT DEFAULT NULL');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{spectator}'");
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        qr_code_url TEXT,
        created_by TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        game_id TEXT NOT NULL,
        positions TEXT NOT NULL,
        peak_score INTEGER DEFAULT 0,
        game_rank TEXT DEFAULT '',
        screenshot_url TEXT,
        screenshot_url2 TEXT,
        status TEXT DEFAULT 'pending',
        market_value INTEGER DEFAULT 0,
        club_id INTEGER,
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS screenshot_url2 TEXT');
    await client.query(`
      CREATE TABLE IF NOT EXISTS clubs (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_members (
        id SERIAL PRIMARY KEY,
        club_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(club_id, user_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS transfer_records (
        id SERIAL PRIMARY KEY,
        player_user_id TEXT NOT NULL,
        from_club_id INTEGER,
        to_club_id INTEGER,
        fee INTEGER NOT NULL,
        platform_fee INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS coin_transactions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        note TEXT,
        related_match_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 每日卜卦记录
    await client.query(`
      CREATE TABLE IF NOT EXISTS fortune_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        fortune_date DATE NOT NULL DEFAULT CURRENT_DATE,
        fortune_type TEXT NOT NULL,
        fortune_text TEXT NOT NULL,
        reward INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, fortune_date)
      );
    `);
    // 选手交易记录
    await client.query(`
      CREATE TABLE IF NOT EXISTS player_trades (
        id SERIAL PRIMARY KEY,
        player_user_id TEXT NOT NULL,
        from_club_id INTEGER NOT NULL,
        to_club_id INTEGER NOT NULL,
        trade_type TEXT NOT NULL DEFAULT 'buy',
        swap_player_user_id TEXT,
        price_diff INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        initiated_by TEXT NOT NULL,
        initiated_club_id INTEGER NOT NULL,
        accepted_by TEXT,
        initiator_id TEXT NOT NULL DEFAULT '0',
        recipient_id TEXT NOT NULL DEFAULT '0',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 迁移：补充 initiator_id / recipient_id 字段（向后兼容，先加列再回填）
    await client.query(`
      ALTER TABLE player_trades
        ADD COLUMN IF NOT EXISTS initiator_id TEXT NOT NULL DEFAULT '0',
        ADD COLUMN IF NOT EXISTS recipient_id TEXT NOT NULL DEFAULT '0'
    `);
    // 回填历史数据：initiator_id = initiated_by，recipient_id = 源俱乐部老板
    await client.query(`
      UPDATE player_trades
      SET initiator_id = initiated_by,
          recipient_id = COALESCE(
            (SELECT owner_id FROM clubs WHERE id = player_trades.from_club_id LIMIT 1),
            '0'
          )
      WHERE initiator_id = '0'
    `);
    // 交易比例配置（动态比例）
    await client.query(`
      CREATE TABLE IF NOT EXISTS transaction_ratios (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL UNIQUE,
        player_ratio DECIMAL(5,2) NOT NULL DEFAULT 10,
        club_ratio DECIMAL(5,2) DEFAULT 0,
        admin_ratio DECIMAL(5,2) NOT NULL DEFAULT 50,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 初始化默认交易比例
    await client.query(`
      INSERT INTO transaction_ratios (type, player_ratio, club_ratio, admin_ratio)
      VALUES ('transfer', 10, 40, 50), ('purchase', 10, 0, 90)
      ON CONFLICT (type) DO NOTHING
    `);
    // 公告系统
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        pushed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pushed BOOLEAN DEFAULT false');
    // 赛事分级
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'regular'");
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL");
    // 选手等级 + 解约
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS grade TEXT DEFAULT NULL');
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS buyout_fee INTEGER DEFAULT NULL');
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS custom_salary INTEGER DEFAULT NULL');
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS trade_status TEXT DEFAULT NULL");
    // 比赛身价波动
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS last_match_result TEXT DEFAULT NULL");
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS last_match_mvp BOOLEAN DEFAULT false");
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS last_change_percentage DECIMAL(5,2) DEFAULT 0");
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS last_match_id INTEGER DEFAULT NULL");
    // 薪资记录
    await client.query(`
      CREATE TABLE IF NOT EXISTS salary_records (
        id SERIAL PRIMARY KEY,
        club_id INTEGER,
        player_user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        grade TEXT,
        paid_by TEXT,
        paid_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS price_adjust_logs (
        id SERIAL PRIMARY KEY,
        club_id INTEGER NOT NULL,
        player_user_id TEXT NOT NULL,
        old_value INTEGER,
        new_value INTEGER,
        adjusted_by TEXT NOT NULL,
        adjusted_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(club_id, player_user_id, adjusted_at)
      );
    `);
    // 俱乐部大名单（顶级/次级各≤5人，自由名单支持多队伍分组）
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_rosters (
        id SERIAL PRIMARY KEY,
        club_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        player_user_id TEXT NOT NULL,
        team_id TEXT DEFAULT '',
        UNIQUE(club_id, tier, player_user_id)
      );
    `);
    await client.query("ALTER TABLE club_rosters ADD COLUMN IF NOT EXISTS team_id TEXT DEFAULT ''");
    // 赛事扩展字段
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS start_time TIMESTAMP");
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS end_time TIMESTAMP");
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS bo INTEGER DEFAULT 1");
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS comp_status TEXT DEFAULT 'upcoming'");
    // 赛事报名
    await client.query(`
      CREATE TABLE IF NOT EXISTS competition_registrations (
        id SERIAL PRIMARY KEY,
        competition_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        player_user_id TEXT NOT NULL,
        entry_fee INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(competition_id, player_user_id)
      );
    `);
    await client.query(`ALTER TABLE competition_registrations ADD COLUMN IF NOT EXISTS club_id TEXT`);
    await client.query(`ALTER TABLE competition_registrations ADD COLUMN IF NOT EXISTS side TEXT DEFAULT 'red'`);
    await client.query(`ALTER TABLE competition_registrations ADD COLUMN IF NOT EXISTS lane TEXT DEFAULT ''`);
    // 榜单分数字段
    await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS player_score INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS club_score INTEGER DEFAULT 0`);
    // 赛事结果
    await client.query(`
      CREATE TABLE IF NOT EXISTS competition_results (
        id SERIAL PRIMARY KEY,
        competition_id TEXT NOT NULL,
        winner TEXT NOT NULL,
        screenshot_urls JSONB DEFAULT '[]',
        player_data JSONB DEFAULT '[]',
        mvp_player_id TEXT DEFAULT NULL,
        coin_rewards JSONB DEFAULT '{}',
        confirmed_by TEXT,
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE competition_results ADD COLUMN IF NOT EXISTS mvp_player_id TEXT DEFAULT NULL");
    await client.query("ALTER TABLE competition_results ADD COLUMN IF NOT EXISTS coin_rewards JSONB DEFAULT '{}'");
    // 赛事选手统计
    await client.query(`
      CREATE TABLE IF NOT EXISTS competition_player_stats (
        id SERIAL PRIMARY KEY,
        competition_id TEXT NOT NULL,
        player_user_id TEXT NOT NULL,
        team TEXT,
        lane TEXT,
        kda TEXT,
        win BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 在线聊天消息
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT DEFAULT NULL,
        team_id TEXT DEFAULT NULL,
        club_id INTEGER DEFAULT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_type ON chat_messages(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_team ON chat_messages(team_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_club ON chat_messages(club_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_receiver ON chat_messages(receiver_id)`);
    await client.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS recalled BOOLEAN DEFAULT false');
    await client.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions TEXT[] DEFAULT \'{}\'');
    // ===== 赛事系统重构：Match 数据模型（兼容旧 competitions 表）=====
    // 状态机：CREATED -> REGISTERING -> READY -> LIVE -> FINISHED -> ARCHIVED
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'training', -- 'training' | 'arena' | 'regular'
        status TEXT NOT NULL DEFAULT 'CREATED'
          CONSTRAINT matches_status_check CHECK (status IN ('CREATED','REGISTERING','READY','LIVE','FINISHED','ARCHIVED')),
        created_by TEXT NOT NULL,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        bo INTEGER DEFAULT 1,
        winner TEXT, -- 'red' | 'blue' | 'draw'
        score JSONB DEFAULT '{"red":0,"blue":0}',
        mvp_id TEXT,
        meeting_code TEXT,
        meeting_link TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 比赛参与者表（支持红蓝双方/自由报名）
    await client.query(`
      CREATE TABLE IF NOT EXISTS match_participants (
        id SERIAL PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        side TEXT DEFAULT 'neutral', -- 'red' | 'blue' | 'neutral'
        lane TEXT DEFAULT '',
        club_id INTEGER,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(match_id, user_id)
      );
    `);
    // ===== Match Timeline 表（为未来功能预留）=====
    // 用途：实时播报、比赛事件流、AI解说、比赛回放
    await client.query(`
      CREATE TABLE IF NOT EXISTS match_timeline (
        id SERIAL PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        -- 事件类型枚举：
        -- 'KILL'       击杀
        -- 'ASSIST'     助攻
        -- 'GOAL'       推塔/目标（原设计，保留兼容）
        -- 'DRAGON'     大龙
        -- 'BARON'      男爵
        -- 'TOWER'      推塔
        -- 'WIN'        胜利
        -- 'SCORE'      比分更新
        -- 'MVPAWARD'   MVP 公布
        -- 'STATUSCHANGE' 状态变更
        -- 'CUSTOM'     自定义事件（AI解说用）
        team TEXT DEFAULT NULL, -- 'red' | 'blue' | NULL（无队伍）
        player_id TEXT DEFAULT NULL, -- 关联用户 ID
        player_name TEXT DEFAULT NULL, -- 冗余：便于快速显示
        text TEXT NOT NULL, -- 事件描述（如 "张三击杀了李四"）
        data JSONB DEFAULT '{}', -- 扩展字段（如 { killer: 'xxx', victim: 'yyy', gold: 300 }）
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_timeline_match ON match_timeline(match_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_timeline_created ON match_timeline(created_at DESC)`);
    // ===== 结束 Timeline 表 =====
    // 索引优化
    await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_matches_created_by ON matches(created_by)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_match_participants_match ON match_participants(match_id)`);

    // ===== 预测/竞猜系统 =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('red','blue','draw')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        result TEXT DEFAULT 'pending' CHECK (result IN ('pending','win','loss','refund')),
        settled BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        settled_at TIMESTAMP,
        UNIQUE(match_id, user_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id)`);

    // ===== 第六阶段：用户行为埋点系统 =====
    // 访问会话表（计算停留时长）
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        session_id TEXT UNIQUE NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        entry_page TEXT,
        duration INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 用户行为事件表（event_type 白名单约束）
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_events (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'page_view','page_leave','tab_switch',
          'match_open','match_register',
          'onboarding_start','onboarding_step','onboarding_complete','onboarding_skip',
          'task_view','task_complete','task_claim'
        )),
        event_data JSONB DEFAULT '{}',
        page_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 新手任务完成表（持久化，替代纯 localStorage）
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        reward_claimed INTEGER DEFAULT 0,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_key)
      );
    `);
    // ===== 结束埋点系统 =====
  } finally { client.release(); }
}

// 万能跨域
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// 健康检查
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

// ===== 第六阶段：用户行为埋点接收接口 =====
// 开放接口，未登录也可发送（user_id 为 NULL）
const VALID_EVENT_TYPES = [
  'page_view','page_leave','tab_switch',
  'match_open','match_register',
  'onboarding_start','onboarding_step','onboarding_complete','onboarding_skip',
  'task_view','task_complete','task_claim'
];
app.post('/api/track', async (req, res) => {
  try {
    let { event_type, event_data, session_id, page_url } = req.body;
    if (!VALID_EVENT_TYPES.includes(event_type)) return badRequest(res, '非法事件类型：' + event_type);
    if (!session_id) return badRequest(res, '缺少 session_id');
    const userId = req.headers.authorization ? (() => {
      try { return jwt.verify(req.headers.authorization.split(' ')[1], JWT_SECRET).userId; } catch { return null; }
    })() : null;
    await pool.query(
      `INSERT INTO user_events (user_id, session_id, event_type, event_data, page_url) VALUES ($1,$2,$3,$4,$5)`,
      [userId, session_id, event_type, JSON.stringify(event_data || {}), page_url || '']
    );
    // 如果是 page_leave 且带 duration，更新 user_sessions
    if (event_type === 'page_leave' && event_data && event_data.duration) {
      await pool.query(
        `UPDATE user_sessions SET duration = $1, updated_at = NOW() WHERE session_id = $2`,
        [parseInt(event_data.duration) || null, session_id]
      );
    }
    ok(res);
  } catch (e) { console.error('/api/track error:', e); serverError(res, '埋点失败'); }
});

app.get('/health', (req, res) => res.send('OK（埋点系统已加载）'));

// ===== 注册 Match 路由（赛事系统重构）=====
const matchesRouter = require('./routes/matches');
app.use('/api/matches', matchesRouter);
// ===== 结束 Match 路由 =====

// 登录验证
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return unauthorized(res, '未登录');
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch { return unauthorized(res, '登录已过期'); }
}

function adminMiddleware(req, res, next) {
  if (req.userId !== ADMIN_USER_ID) return forbidden(res, '无权限');
  next();
}

// ===== 导入 Match 状态机工具函数 =====
const { MATCH_STATUS, isValidTransition, getNextStates } = require('./utils/matchState');

// 异步：验证并更新比赛状态（返回新状态或抛错）
async function transitionMatchStatus(matchId, fromStatus, toStatus, client = pool) {
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(`非法状态转换：${fromStatus} → ${toStatus}`);
  }
  const result = await client.query(`
    UPDATE matches
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND status = $3
    RETURNING *;
  `, [toStatus, matchId, fromStatus]);
  if (result.rows.length === 0) {
    throw new Error(`状态已变更，请刷新重试（当前：${fromStatus}）`);
  }
  return result.rows[0];
}
// ===== 结束：Match 状态机 =====

// ===== 部署验证端点：返回当前运行 commit =====
app.get('/api/build', (req, res) => {
  res.json({
    success: true,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown',
    deployTime: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development'
  });
});

// 获取交易比例配置
app.get('/api/admin/transaction-ratios', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, type, player_ratio, club_ratio, admin_ratio, updated_at FROM transaction_ratios');
    const ratios = {};
    result.rows.forEach(r => {
      ratios[r.type] = {
        player_ratio: parseFloat(r.player_ratio),
        club_ratio: parseFloat(r.club_ratio || 0),
        admin_ratio: parseFloat(r.admin_ratio)
      };
    });
    ok(res, { ratios });
  } catch(e) { serverError(res, '获取交易比例失败', e); }
});

// 更新交易比例配置
app.put('/api/admin/transaction-ratios', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, player_ratio, club_ratio, admin_ratio } = req.body;
    if (!type || !['transfer', 'purchase'].includes(type)) return badRequest(res, '无效的交易类型');
    const p = parseFloat(player_ratio) || 0;
    const c = parseFloat(club_ratio) || 0;
    const a = parseFloat(admin_ratio) || 0;
    if (Math.abs(p + c + a - 100) > 0.01) return badRequest(res, '比例总和必须为100%，当前：' + (p + c + a) + '%');
    await pool.query(
      'UPDATE transaction_ratios SET player_ratio=$1, club_ratio=$2, admin_ratio=$3, updated_at=NOW() WHERE type=$4',
      [p, c, a, type]
    );
    ok(res, null, '比例更新成功');
  } catch(e) { serverError(res, '更新交易比例失败', e); }
});

// ========== 公告管理 ==========
// 获取公告列表（管理员）
app.get('/api/admin/announcements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, content, publisher_id, pushed, created_at FROM announcements ORDER BY created_at DESC LIMIT 50'
    );
    ok(res, { announcements: result.rows });
  } catch(e) { serverError(res, '获取公告列表失败', e); }
});

// 发布公告（管理员）
app.post('/api/admin/announcements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return badRequest(res, '标题和内容不能为空');

    // 写入公告表
    const annResult = await pool.query(
      'INSERT INTO announcements (title, content, publisher_id, pushed) VALUES ($1, $2, $3, $4) RETURNING id',
      [title, content, req.userId, true]
    );
    const annId = annResult.rows[0].id;

    // 推送给所有用户
    const users = await pool.query('SELECT id FROM users');
    const notifType = 'announcement';
    const notifContent = '【公告】' + title;
    for (const user of users.rows) {
      await pool.query(
        'INSERT INTO notifications (userId, type, content, relatedId, notification_id) VALUES ($1, $2, $3, $4, $5)',
        [user.id, notifType, notifContent, annId, 'ann_' + annId + '_' + user.id]
      );
    }

    ok(res, { id: annId, pushed_count: users.rows.length }, '公告发布成功，已推送至' + users.rows.length + '名用户');
  } catch(e) { serverError(res, '发布公告失败', e); }
});

// 删除公告（管理员）
app.delete('/api/admin/announcements/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM announcements WHERE id=$1', [id]);
    ok(res, null, '公告删除成功');
  } catch(e) { serverError(res, '删除公告失败', e); }
});

// 获取公告列表（用户端 - 只返回已推送的）
app.get('/api/announcements', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, content, created_at FROM announcements WHERE pushed=true ORDER BY created_at DESC LIMIT 20'
    );
    ok(res, { announcements: result.rows });
  } catch(e) { serverError(res, '获取公告失败', e); }
});

// ====================== 在线聊天系统 ======================

// 发送消息
app.post('/api/chat/send', authMiddleware, async (req, res) => {
  try {
    const { receiver_id, team_id, club_id, type, content } = req.body;
    if (!type || !content) return badRequest(res, '缺少必要参数');
    if (!['public', 'private', 'team', 'club'].includes(type)) return badRequest(res, '无效的消息类型');
    if (!content.trim()) return badRequest(res, '消息内容不能为空');
    if (content.length > 1000) return badRequest(res, '消息内容过长（最多1000字）');

    const sender_id = req.userId;

    // 禁言检查（管理员豁免）
    if (sender_id !== ADMIN_USER_ID) {
      const muteCheck = await pool.query('SELECT muted_until, mute_reason FROM users WHERE id = $1', [sender_id]);
      if (muteCheck.rows[0]?.muted_until && new Date(muteCheck.rows[0].muted_until) > new Date()) {
        const until = new Date(muteCheck.rows[0].muted_until).toLocaleString('zh-CN');
        return forbidden(res, `你已被禁言至 ${until}，原因：${muteCheck.rows[0].mute_reason || '无'}`);
      }
    }

    // 解析@提及
    const mentionPattern = /@(\S+?)(?=\s|$)/g;
    let mentionedUsers = [];
    let match;
    while ((match = mentionPattern.exec(content)) !== null) {
      const mentionedName = match[1];
      const userResult = await pool.query('SELECT id FROM users WHERE coachname = $1 OR username = $1', [mentionedName]);
      if (userResult.rows.length > 0) mentionedUsers.push(userResult.rows[0].id);
    }

    let rv = null, tid = null, cid = null;

    if (type === 'private') {
      if (!receiver_id) return badRequest(res, '私聊需要指定接收者');
      rv = receiver_id;
      // 验证私聊权限：只能发给已存在用户
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [receiver_id]);
      if (userCheck.rows.length === 0) return badRequest(res, '接收者不存在');
    } else if (type === 'team') {
      if (!team_id) return badRequest(res, '队伍聊天需要指定队伍ID');
      tid = team_id;
      // 验证是否为队伍成员
      const memberCheck = await pool.query('SELECT 1 FROM team_members WHERE teamId=$1 AND userId=$2', [team_id, sender_id]);
      if (memberCheck.rows.length === 0) return forbidden(res, '你不是该队伍成员');
    } else if (type === 'club') {
      if (!club_id) return badRequest(res, '俱乐部聊天需要指定俱乐部ID');
      cid = club_id;
      // 验证是否为俱乐部成员
      const memberCheck = await pool.query('SELECT 1 FROM club_members WHERE club_id=$1 AND user_id=$2', [club_id, sender_id]);
      if (memberCheck.rows.length === 0) return forbidden(res, '你不是该俱乐部成员');
    }
    // public 无需额外验证

    const result = await pool.query(
      `INSERT INTO chat_messages (sender_id, receiver_id, team_id, club_id, type, content, mentions) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, sender_id, receiver_id, team_id, club_id, type, content, created_at, recalled, mentions`,
      [sender_id, rv, tid, cid, type, content.trim(), mentionedUsers]
    );

    const msg = result.rows[0];
    // 获取发送者信息
    const senderInfo = await pool.query('SELECT id, coachname, teamname FROM users WHERE id=$1', [sender_id]);
    const sender = senderInfo.rows[0];
    const messageData = {
      id: msg.id,
      sender_id: msg.sender_id,
      sender_name: sender?.coachname || sender?.username || '未知',
      sender_team: sender?.teamname || '',
      receiver_id: msg.receiver_id,
      team_id: msg.team_id,
      club_id: msg.club_id,
      type: msg.type,
      content: msg.content,
      recalled: false,
      mentions: msg.mentions || [],
      created_at: msg.created_at
    };

    // Socket.IO 推送（通过全局 io 对象）
    if (global._io) {
      if (type === 'public') {
        global._io.emit('new_message', messageData);
      } else if (type === 'private') {
        global._io.to('user_' + receiver_id).emit('new_message', messageData);
        global._io.to('user_' + sender_id).emit('new_message', messageData);
      } else if (type === 'team') {
        global._io.to('team_' + team_id).emit('new_message', messageData);
      } else if (type === 'club') {
        global._io.to('club_' + club_id).emit('new_message', messageData);
      }
      // @提及通知：单独推送给被提及用户（附带 mentioned:true）
      if (mentionedUsers.length > 0) {
        const mentionData = { ...messageData, mentioned: true };
        mentionedUsers.forEach(uid => {
          global._io.to('user_' + uid).emit('new_message', mentionData);
        });
      }
    }

    ok(res, { message: messageData });
  } catch(e) { serverError(res, '发送消息失败', e); }
});

// 撤回消息
app.put('/api/chat/:id/recall', authMiddleware, async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    if (isNaN(msgId)) return badRequest(res, '无效的消息ID');
    const userId = req.userId;
    const isAdmin = userId === ADMIN_USER_ID;

    const result = await pool.query('SELECT * FROM chat_messages WHERE id = $1', [msgId]);
    if (result.rows.length === 0) return notFound(res, '消息不存在');
    const msg = result.rows[0];

    // 权限校验：自己2分钟内可撤回，管理员随时可撤回
    if (msg.sender_id !== userId && !isAdmin) return forbidden(res, '无权撤回该消息');
    if (!isAdmin) {
      const elapsed = (new Date() - new Date(msg.created_at)) / 1000;
      if (elapsed > 120) return badRequest(res, '超过2分钟，无法撤回');
    }

    await pool.query('UPDATE chat_messages SET recalled = true WHERE id = $1', [msgId]);

    // Socket.IO 广播撤回事件
    if (global._io) {
      const recallData = { messageId: msgId, type: msg.type, team_id: msg.team_id, club_id: msg.club_id, sender_name: (await pool.query('SELECT coachname,username FROM users WHERE id=$1',[msg.sender_id])).rows[0]?.coachname || '用户' };
      if (msg.type === 'public') {
        global._io.emit('message_recalled', recallData);
      } else if (msg.type === 'team') {
        global._io.to('team_' + msg.team_id).emit('message_recalled', recallData);
      } else if (msg.type === 'club') {
        global._io.to('club_' + msg.club_id).emit('message_recalled', recallData);
      } else if (msg.type === 'private') {
        global._io.to('user_' + msg.sender_id).emit('message_recalled', recallData);
        if (msg.receiver_id) global._io.to('user_' + msg.receiver_id).emit('message_recalled', recallData);
      }
    }

    ok(res, { messageId: msgId });
  } catch(e) { serverError(res, '撤回消息失败', e); }
});

// 获取消息历史
app.get('/api/chat/fetch', authMiddleware, async (req, res) => {
  try {
    const { type, team_id, club_id, receiver_id, limit = 100 } = req.query;
    const userId = req.userId;
    const limitNum = Math.min(parseInt(limit) || 100, 200);

    let query, params;

    if (type === 'public') {
      // 公聊：所有用户可见
      query = `
        SELECT m.*, u.coachname as sender_name, u.teamname as sender_team,
          CASE WHEN m.sender_id = $2 THEN 'admin'::text
               WHEN EXISTS(SELECT 1 FROM club_members WHERE user_id=m.sender_id AND role='boss') THEN 'boss'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved' AND club_id IS NOT NULL) THEN 'signed'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved') THEN 'certified'::text
               ELSE 'uncertified'::text
          END as sender_identity
        FROM chat_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.type = 'public'
        ORDER BY m.created_at DESC LIMIT $1`;
      params = [limitNum, ADMIN_USER_ID];
    } else if (type === 'private') {
      if (!receiver_id) return badRequest(res, '获取私聊需要指定 receiver_id');
      // 私聊：只有发送者和接收者可见
      query = `
        SELECT m.*, u.coachname as sender_name, u.teamname as sender_team,
          CASE WHEN m.sender_id = $4 THEN 'admin'::text
               WHEN EXISTS(SELECT 1 FROM club_members WHERE user_id=m.sender_id AND role='boss') THEN 'boss'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved' AND club_id IS NOT NULL) THEN 'signed'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved') THEN 'certified'::text
               ELSE 'uncertified'::text
          END as sender_identity
        FROM chat_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.type = 'private' AND ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
        ORDER BY m.created_at DESC LIMIT $3`;
      params = [userId, receiver_id, limitNum, ADMIN_USER_ID];
    } else if (type === 'team') {
      if (!team_id) return badRequest(res, '获取队伍聊天需要指定 team_id');
      // 验证是否为队伍成员
      const memberCheck = await pool.query('SELECT 1 FROM team_members WHERE teamId=$1 AND userId=$2', [team_id, userId]);
      if (memberCheck.rows.length === 0) return forbidden(res, '你不是该队伍成员');
      query = `
        SELECT m.*, u.coachname as sender_name, u.teamname as sender_team,
          CASE WHEN m.sender_id = $3 THEN 'admin'::text
               WHEN EXISTS(SELECT 1 FROM club_members WHERE user_id=m.sender_id AND role='boss') THEN 'boss'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved' AND club_id IS NOT NULL) THEN 'signed'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved') THEN 'certified'::text
               ELSE 'uncertified'::text
          END as sender_identity
        FROM chat_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.type = 'team' AND m.team_id = $1
        ORDER BY m.created_at DESC LIMIT $2`;
      params = [team_id, limitNum, ADMIN_USER_ID];
    } else if (type === 'club') {
      if (!club_id) return badRequest(res, '获取俱乐部聊天需要指定 club_id');
      // 验证是否为俱乐部成员
      const memberCheck = await pool.query('SELECT 1 FROM club_members WHERE club_id=$1 AND user_id=$2', [club_id, userId]);
      if (memberCheck.rows.length === 0) return forbidden(res, '你不是该俱乐部成员');
      query = `
        SELECT m.*, u.coachname as sender_name, u.teamname as sender_team,
          CASE WHEN m.sender_id = $3 THEN 'admin'::text
               WHEN EXISTS(SELECT 1 FROM club_members WHERE user_id=m.sender_id AND role='boss') THEN 'boss'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved' AND club_id IS NOT NULL) THEN 'signed'::text
               WHEN EXISTS(SELECT 1 FROM players WHERE user_id=m.sender_id AND status='approved') THEN 'certified'::text
               ELSE 'uncertified'::text
          END as sender_identity
        FROM chat_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.type = 'club' AND m.club_id = $1
        ORDER BY m.created_at DESC LIMIT $2`;
      params = [club_id, limitNum, ADMIN_USER_ID];
    } else {
      return badRequest(res, '缺少或无效的 type 参数');
    }

    const result = await pool.query(query, params);
    const messages = result.rows.reverse().map(m => ({
      id: m.id,
      sender_id: m.sender_id,
      sender_name: m.sender_name || m.coachname || '未知',
      sender_team: m.sender_team || '',
      sender: {
        id: m.sender_id,
        identity: m.sender_identity || 'uncertified',
        identityLabel: { admin: '管理员', boss: '老板', signed: '已签约', certified: '已认证', uncertified: '未认证' }[m.sender_identity] || '未认证'
      },
      receiver_id: m.receiver_id,
      team_id: m.team_id,
      club_id: m.club_id,
      type: m.type,
      content: m.content,
      recalled: m.recalled || false,
      mentions: m.mentions || [],
      created_at: m.created_at
    }));

    ok(res, { messages });
  } catch(e) { serverError(res, '获取消息失败', e); }
});

// 获取我的队伍列表（用于聊天侧边栏）
app.get('/api/chat/my-teams', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.name, t.bio
      FROM teams t
      JOIN team_members tm ON t.id = tm.teamId
      WHERE tm.userId = $1
    `, [req.userId]);
    ok(res, { teams: result.rows });
  } catch(e) { serverError(res, '获取队伍失败', e); }
});

// 获取我的俱乐部列表（用于聊天侧边栏）
app.get('/api/chat/my-clubs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name
      FROM clubs c
      JOIN club_members cm ON c.id = cm.club_id
      WHERE cm.user_id = $1
    `, [req.userId]);
    ok(res, { clubs: result.rows });
  } catch(e) { serverError(res, '获取俱乐部失败', e); }
});

// 获取私聊联系人列表
app.get('/api/chat/contacts', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT u.id, u.coachname, u.teamname,
        (SELECT created_at FROM chat_messages WHERE type='private' AND ((sender_id=$1 AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=$1)) ORDER BY created_at DESC LIMIT 1) as last_time
      FROM users u
      WHERE u.id != $1 AND (
        EXISTS (SELECT 1 FROM chat_messages WHERE type='private' AND ((sender_id=$1 AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=$1)))
      )
      ORDER BY last_time DESC NULLS LAST
    `, [req.userId]);
    ok(res, { contacts: result.rows });
  } catch(e) { serverError(res, '获取联系人失败', e); }
});

// 搜索用户（用于私聊添加联系人）
app.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return badRequest(res, '搜索关键词不能为空');
    const keyword = '%' + q.trim() + '%';
    const result = await pool.query(
      `SELECT id, username, coachname, teamname FROM users
       WHERE id != $1 AND (coachname ILIKE $2 OR username ILIKE $2 OR teamname ILIKE $2)
       ORDER BY coachname NULLS LAST LIMIT 20`,
      [req.userId, keyword]
    );
    ok(res, { users: result.rows });
  } catch(e) { serverError(res, '搜索用户失败', e); }
});

// 获取频道内用户列表（用于@提及）
app.get('/api/chat/channel-users', authMiddleware, async (req, res) => {
  try {
    const { type, team_id, club_id } = req.query;
    const userId = req.userId;
    let users;

    if (type === 'team' && team_id) {
      users = await pool.query(`
        SELECT u.id, u.coachname, u.username, u.teamname
        FROM users u JOIN team_members tm ON u.id = tm.userId
        WHERE tm.teamId = $1 AND u.id != $2
        ORDER BY u.coachname
      `, [team_id, userId]);
    } else if (type === 'club' && club_id) {
      users = await pool.query(`
        SELECT u.id, u.coachname, u.username, u.teamname
        FROM users u JOIN club_members cm ON u.id = cm.user_id
        WHERE cm.club_id = $1 AND u.id != $2
        ORDER BY u.coachname
      `, [club_id, userId]);
    } else if (type === 'public') {
      // 公聊：返回近24小时活跃用户
      users = await pool.query(`
        SELECT DISTINCT u.id, u.coachname, u.username, u.teamname
        FROM users u
        INNER JOIN chat_messages m ON m.sender_id = u.id
        WHERE m.type = 'public' AND m.created_at > NOW() - INTERVAL '24 hours'
          AND u.id != $1
        ORDER BY u.coachname
      `, [userId]);
    } else if (type === 'private' && req.query.receiver_id) {
      // 私聊不需要@
      return ok(res, { users: [] });
    } else {
      return badRequest(res, '无效的频道类型');
    }

    ok(res, { users: users.rows });
  } catch(e) { serverError(res, '获取频道用户失败', e); }
});

async function sendNotification(userId, type, content, relatedId = null) {
  const result = await pool.query(
    'INSERT INTO notifications (userId, type, content, relatedId, notification_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [userId, type, content, relatedId, userId + '_' + Date.now()]
  );
  return result.rows[0].id;
}

// ====================== 以下为原有接口（保持不变） ======================

app.post('/api/auth/register', async (req, res) => {
  const { username, password, coachName, wechat, level, bio } = req.body;
  if (!username || !password || !coachName || !wechat) return badRequest(res, '信息不完整');
  try {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return badRequest(res, '用户名已存在');
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const hashed = bcrypt.hashSync(password, 10);
    const INITIAL_COINS = 500;
    await pool.query('INSERT INTO users (id, username, password, teamName, coachName, wechat, level, bio, tags, dream_coins) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, username, hashed, '', coachName, wechat, level || '大众', bio || '', '{spectator}', INITIAL_COINS]);
    await pool.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'initial_grant', $3)",
      [id, INITIAL_COINS, '新人礼包']
    );
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName: '', coachName, wechat, level: level || '大众', bio: bio || '', disabledDates: [], gameId: '', gameServer: '手Q区', gameRank: '星耀', peakScore: 0, laneStats: '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: '', dream_coins: INITIAL_COINS, tags: ['spectator'] } });
  } catch (e) { serverError(res, '注册失败'); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password)) return badRequest(res, '用户名或密码错误');
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamname, coachName: user.coachname, wechat: user.wechat, level: user.level, bio: user.bio, disabledDates: user.disableddates || [], gameId: user.gameid || '', gameServer: user.gameserver || '手Q区', gameRank: user.gamerank || '星耀', peakScore: user.peakscore || 0, laneStats: user.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: user.heropool || '', dream_coins: user.dream_coins || 0, tags: user.tags || ['spectator'] } });
  } catch (e) { serverError(res, '登录失败'); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return notFound(res, '用户不存在');
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, bio: u.bio, disabledDates: u.disableddates || [], gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀', peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: u.heropool || '', dream_coins: u.dream_coins || 0, tags: u.tags || ['spectator'] } });
  } catch (e) { serverError(res, '获取失败'); }
});

// ====================== 梦币系统 ======================

// 获取我的梦币余额和交易明细
app.get('/api/me/coins', authMiddleware, async (req, res) => {
  try {
    // 获取余额
    const userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
    const balance = userRes.rows[0]?.dream_coins || 0;
    
    // 获取交易明细（最近50条）
    const txRes = await pool.query(
      'SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    );
    
    const transactions = txRes.rows.map(t => ({
      id: t.id,
      amount: t.amount,
      type: t.type,
      note: t.note,
      related_match_id: t.related_match_id,
      created_at: t.created_at
    }));
    
    res.json({ balance, transactions });
  } catch (e) { console.error(e); serverError(res, '查询失败'); }
});

// 每日签到领取梦币
app.post('/api/me/daily-checkin', authMiddleware, async (req, res) => {
  try {
    var today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 检查今天是否已签到
    var checkRes = await pool.query(
      "SELECT id FROM coin_transactions WHERE user_id = $1 AND type = 'checkin' AND created_at::date = $2 LIMIT 1",
      [req.userId, today]
    );
    if (checkRes.rows.length > 0) {
      return badRequest(res, '今日已签到，明天再来吧');
    }
    
    // 签到奖励：100 梦币（后续可做连续签到递增）
    var amount = 100;
    await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins, 0) + $1 WHERE id = $2', [amount, req.userId]);
    await pool.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'checkin', $3)",
      [req.userId, amount, '每日签到']
    );
    
    var userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
    var newBalance = userRes.rows[0]?.dream_coins || 0;
    
    ok(res, { awarded: amount, newBalance: newBalance, checkinDate: today });
  } catch (e) { console.error(e); serverError(res, '签到失败'); }
});

// ==================== 每日卜卦 ====================

// 卦象池（加权随机）
const FORTUNE_POOL = [
  { type: 'great',    text: '今日连胜之势已成，适合冲击大分。',   reward: 88, weight: 10 },
  { type: 'good',     text: '稳扎稳打，今日适合双排上分。',       reward: 66, weight: 25 },
  { type: 'fair',     text: '今日宜补位，不宜乱开团。',           reward: 50, weight: 30 },
  { type: 'bad',      text: '今日忌单排，建议抱团作战。',         reward: 50, weight: 25 },
  { type: 'terrible', text: '水逆缠身，谨慎点击排位。',           reward: 66, weight: 10 },
];

function drawFortune() {
  var totalWeight = FORTUNE_POOL.reduce(function (sum, f) { return sum + f.weight; }, 0);
  var rand = Math.random() * totalWeight;
  var cumulative = 0;
  for (var i = 0; i < FORTUNE_POOL.length; i++) {
    cumulative += FORTUNE_POOL[i].weight;
    if (rand <= cumulative) return FORTUNE_POOL[i];
  }
  return FORTUNE_POOL[0];
}

// 查询今日卜卦状态
app.get('/api/me/daily-fortune', authMiddleware, async (req, res) => {
  try {
    var today = new Date().toISOString().split('T')[0];
    var row = await pool.query(
      'SELECT fortune_type, fortune_text, reward, created_at FROM fortune_records WHERE user_id = $1 AND fortune_date = $2 LIMIT 1',
      [req.userId, today]
    );
    if (row.rows.length === 0) {
      return ok(res, { claimed_today: false });
    }
    var r = row.rows[0];
    ok(res, {
      claimed_today: true,
      fortune_type: r.fortune_type,
      fortune_text: r.fortune_text,
      reward: r.reward,
      created_at: r.created_at
    });
  } catch (e) { console.error(e); serverError(res, '查询失败'); }
});

// 执行卜卦
app.post('/api/me/daily-fortune', authMiddleware, async (req, res) => {
  var client;
  try {
    var today = new Date().toISOString().split('T')[0];

    // 检查今日是否已卜
    var existing = await pool.query(
      'SELECT id FROM fortune_records WHERE user_id = $1 AND fortune_date = $2 LIMIT 1',
      [req.userId, today]
    );
    if (existing.rows.length > 0) {
      return badRequest(res, '今日已卜卦，明日再来');
    }

    var fortune = drawFortune();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO fortune_records (user_id, fortune_date, fortune_type, fortune_text, reward) VALUES ($1,$2,$3,$4,$5)',
      [req.userId, today, fortune.type, fortune.text, fortune.reward]
    );
    await client.query(
      'UPDATE users SET dream_coins = COALESCE(dream_coins, 0) + $1 WHERE id = $2',
      [fortune.reward, req.userId]
    );
    await client.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'fortune', $3)",
      [req.userId, fortune.reward, '开运卜卦·' + { great: '大吉', good: '中吉', fair: '小吉', bad: '凶', terrible: '大凶' }[fortune.type]]
    );
    await client.query('COMMIT');

    var userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
    var newBalance = userRes.rows[0]?.dream_coins || 0;

    ok(res, {
      fortune_type: fortune.type,
      fortune_text: fortune.text,
      reward: fortune.reward,
      newBalance: newBalance
    });
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch (rb) {} }
    console.error(e);
    serverError(res, '卜卦失败');
  } finally {
    if (client) client.release();
  }
});

// 管理员发放梦币
app.post('/api/admin/award-coins', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, amount, note } = req.body;
  if (!userId || !amount || amount <= 0) return badRequest(res, '参数错误');
  try {
    // 更新用户余额
    await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins, 0) + $1 WHERE id = $2', [amount, userId]);
    // 记录交易
    await pool.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'award', $3)",
      [userId, amount, note || '管理员发放']
    );
    // 获取更新后的余额
    const userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [userId]);
    const newBalance = userRes.rows[0]?.dream_coins || 0;
    // 发送通知
    await sendNotification(userId, 'coin_award', `你收到了 ${amount} 梦币奖励：${note || '管理员发放'}`, null);
    ok(res, {newBalance, awarded: amount });
  } catch (e) { console.error(e); serverError(res, '操作失败'); }
});

// 管理员获取所有交易记录
app.get('/api/admin/coin-transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, limit = 100 } = req.query;
    let query = 'SELECT ct.*, u.coachname, u.username FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id';
    const params = [];
    if (userId) {
      query += ' WHERE ct.user_id = $1';
      params.push(userId);
    }
    query += ' ORDER BY ct.created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    res.json({ transactions: result.rows.map(t => ({
      id: t.id,
      user_id: t.user_id,
      coachname: t.coachname,
      username: t.username,
      amount: t.amount,
      type: t.type,
      note: t.note,
      related_match_id: t.related_match_id,
      created_at: t.created_at
    })) });
  } catch (e) { console.error(e); serverError(res, '查询失败'); }
});

app.put('/api/users/me', authMiddleware, async (req, res) => {
  const { coachName, wechat, level, bio } = req.body;
  try {
    await pool.query('UPDATE users SET coachName = COALESCE($1, coachName), wechat = COALESCE($2, wechat), level = COALESCE($3, level), bio = COALESCE($4, bio) WHERE id = $5',
      [coachName || null, wechat || null, level || null, bio || null, req.userId]);
    ok(res);
  } catch (e) { serverError(res, '更新失败'); }
});

app.put('/api/users/me/disabled-dates', authMiddleware, async (req, res) => {
  const { date } = req.body;
  if (!date) return badRequest(res, '日期不能为空');
  try {
    const result = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    let disabled = result.rows[0].disableddates || [];
    const index = disabled.indexOf(date);
    if (index === -1) disabled.push(date); else disabled.splice(index, 1);
    await pool.query('UPDATE users SET disabledDates = $1 WHERE id = $2', [disabled, req.userId]);
    res.json({ disabledDates: disabled });
  } catch (e) { serverError(res, '操作失败'); }
});

app.get('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return notFound(res, '用户不存在');
    const u = result.rows[0];

    const playerRes = await pool.query(
      `SELECT p.*, c.name AS club_name, c.owner_id AS club_owner_id
       FROM players p LEFT JOIN clubs c ON p.club_id = c.id WHERE p.user_id = $1`,
      [req.params.id]
    );
    const p = playerRes.rows[0] || {};
    const grade = p.grade;
    const weeklySalary = p.custom_salary !== null && p.custom_salary !== undefined
      ? p.custom_salary
      : (GRADE_SALARY[grade] || 0);

    res.json({
      user: {
        id: u.id, username: u.username, teamName: u.teamname, coachName: u.coachname, level: u.level, bio: u.bio || '',
        gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀',
        peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}',
        heroPool: u.heropool || '', wechat: u.wechat || '', tags: u.tags || ['spectator']
      },
      player: {
        status: p.status || null,
        market_value: p.market_value || null,
        grade: p.grade || null,
        club_id: p.club_id || null,
        club_name: p.club_name || null,
        club_owner_id: p.club_owner_id || null,
        custom_salary: p.custom_salary,
        weekly_salary: weeklySalary,
        positions: p.positions || '[]',
        game_id: p.game_id || null
      }
    });
  } catch (e) { serverError(res, '获取失败'); }
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE userId = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json({ notifications: result.rows });
  } catch (e) { serverError(res, '获取通知失败'); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read = true WHERE userId = $1", [req.userId]);
    ok(res);
  } catch (e) { serverError(res, '标记失败'); }
});

// 管理员仪表盘统计（第六阶段强化版）
app.get('/api/admin/dashboard', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 1. 基础指标
    const totalUsersRes = await pool.query('SELECT COUNT(*) FROM users');
    const newUsersTodayRes = await pool.query(
      "SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE"
    );
    const newUsersWeekRes = await pool.query(
      "SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'"
    );
    const totalTeamsRes = await pool.query('SELECT COUNT(*) FROM teams');
    const totalClubsRes = await pool.query('SELECT COUNT(*) FROM clubs');
    const activeMatchesRes = await pool.query(
      "SELECT COUNT(*) FROM matches WHERE status IN ('READABLE','LIVE')"
    );
    const totalMatchesRes = await pool.query('SELECT COUNT(*) FROM matches');

    // 2. 在线人数（过去5分钟有事件的去重 user_id，含 NULL 时用 session_id 兜底）
    const onlineNowRes = await pool.query(`
      SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
      FROM user_events
      WHERE created_at >= NOW() - INTERVAL '5 minutes'
    `);

    // 3. 新手漏斗（最近30天注册用户）
    // step1: 进入首页（page_view, page=home）
    // step2: 打开引导（onboarding_start）
    // step3: 选择身份（onboarding_step, step=2）
    // step4: 完成引导（onboarding_complete）
    const funnelRes = await pool.query(`
      WITH recent_users AS (
        SELECT id FROM users WHERE created_at >= NOW() - INTERVAL '30 days'
      ),
      step1 AS (
        SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
        FROM user_events
        WHERE event_type = 'page_view' AND (event_data->>'page' = 'home' OR page_url LIKE '%#competition%' OR page_url LIKE '%#square%')
          AND created_at >= NOW() - INTERVAL '30 days'
      ),
      step2 AS (
        SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
        FROM user_events
        WHERE event_type = 'onboarding_start'
          AND created_at >= NOW() - INTERVAL '30 days'
      ),
      step3 AS (
        SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
        FROM user_events
        WHERE event_type = 'onboarding_step' AND (event_data->>'step' = '2' OR event_data->>'step' = '3')
          AND created_at >= NOW() - INTERVAL '30 days'
      ),
      step4 AS (
        SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
        FROM user_events
        WHERE event_type = 'onboarding_complete'
          AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT
        (SELECT cnt FROM step1) AS step1_enter,
        (SELECT cnt FROM step2) AS step2_onboard,
        (SELECT cnt FROM step3) AS step3_identity,
        (SELECT cnt FROM step4) AS step4_complete
      FROM (SELECT 1) AS dummy
    `);
    const funnelRow = funnelRes.rows[0] || {};
    const step1 = parseInt(funnelRow.step1_enter) || 0;
    const step2 = parseInt(funnelRow.step2_onboard) || 0;
    const step3 = parseInt(funnelRow.step3_identity) || 0;
    const step4 = parseInt(funnelRow.step4_complete) || 0;
    const funnelConversionRate = step1 > 0 ? Math.round(step4 / step1 * 100) : 0;

    // 4. Tab 点击排行（最近7天）
    const topTabsRes = await pool.query(`
      SELECT event_data->>'tab' AS tab_name, COUNT(*) AS cnt
      FROM user_events
      WHERE event_type = 'tab_switch'
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY tab_name
      ORDER BY cnt DESC
      LIMIT 6
    `);

    // 5. 梦币流通统计
    const totalCoinsRes = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total FROM coin_transactions');
    const todayCoinsRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM coin_transactions WHERE created_at >= CURRENT_DATE"
    );
    const avgCoinsRes = await pool.query('SELECT COALESCE(AVG(dream_coins), 0) AS avg FROM users');

    // 6. Onboarding 完成率（最近30天有过 onboarding_start 的 session 中完成的比例）
    const onboardingRateRes = await pool.query(`
      WITH started AS (
        SELECT DISTINCT COALESCE(user_id, session_id) AS sid
        FROM user_events
        WHERE event_type = 'onboarding_start'
          AND created_at >= NOW() - INTERVAL '30 days'
      ),
      completed AS (
        SELECT DISTINCT COALESCE(user_id, session_id) AS sid
        FROM user_events
        WHERE event_type = 'onboarding_complete'
          AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT
        (SELECT COUNT(*) FROM started) AS started,
        (SELECT COUNT(*) FROM completed) AS completed
      FROM (SELECT 1) AS dummy
    `);
    const obRow = onboardingRateRes.rows[0] || {};
    const obStarted = parseInt(obRow.started) || 0;
    const obCompleted = parseInt(obRow.completed) || 0;
    const onboardingRate = obStarted > 0 ? Math.round(obCompleted / obStarted * 100) : 0;

    // 7. 报名转化率（查看比赛详情 → 报名）
    const matchOpenRes = await pool.query(`
      SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
      FROM user_events
      WHERE event_type = 'match_open'
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const matchRegisterRes = await pool.query(`
      SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) AS cnt
      FROM user_events
      WHERE event_type = 'match_register'
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const matchOpeners = parseInt(matchOpenRes.rows[0]?.cnt) || 0;
    const matchRegistrars = parseInt(matchRegisterRes.rows[0]?.cnt) || 0;
    const matchRegisterRate = matchOpeners > 0 ? Math.round(matchRegistrars / matchOpeners * 100) : 0;

    ok(res, {
      totalUsers: parseInt(totalUsersRes.rows[0].count),
      newUsersToday: parseInt(newUsersTodayRes.rows[0].count),
      newUsersWeek: parseInt(newUsersWeekRes.rows[0].count),
      totalTeams: parseInt(totalTeamsRes.rows[0].count),
      totalClubs: parseInt(totalClubsRes.rows[0].count),
      activeMatches: parseInt(activeMatchesRes.rows[0].count),
      totalMatches: parseInt(totalMatchesRes.rows[0].count),
      onlineNow: parseInt(onlineNowRes.rows[0].cnt) || 0,
      funnel: {
        step1_enter: step1,
        step2_onboard: step2,
        step3_identity: step3,
        step4_complete: step4,
        conversionRate: funnelConversionRate
      },
      topTabs: topTabsRes.rows.map(r => ({ tab: r.tab_name || 'unknown', count: parseInt(r.cnt) })),
      coinStats: {
        totalCirculation: parseInt(totalCoinsRes.rows[0].total) || 0,
        todayFlow: parseInt(todayCoinsRes.rows[0].total) || 0,
        avgPerUser: Math.round(parseFloat(avgCoinsRes.rows[0].avg)) || 0
      },
      onboardingRate,
      matchRegisterRate
    });
  } catch (e) { console.error('/api/admin/dashboard error:', e); serverError(res, '加载失败'); }
});

// 管理员获取所有用户（支持筛选）
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { level, gameServer, gameRank, search, heroPool, teamId, minPeak, maxPeak, peakSort } = req.query;
    let sql = 'SELECT id, username, teamName, coachName, wechat, level, bio, gameId, gameServer, gameRank, peakScore, heroPool, dream_coins, created_at FROM users WHERE 1=1';
    const params = [];
    let idx = 1;
    if (level) { sql += ` AND level = $${idx++}`; params.push(level); }
    if (gameServer) { sql += ` AND gameServer = $${idx++}`; params.push(gameServer); }
    if (gameRank) { sql += ` AND gameRank = $${idx++}`; params.push(gameRank); }
    if (minPeak) { sql += ` AND peakScore >= $${idx++}`; params.push(parseInt(minPeak)); }
    if (maxPeak) { sql += ` AND peakScore <= $${idx++}`; params.push(parseInt(maxPeak)); }
    if (heroPool) { sql += ` AND heroPool ILIKE $${idx++}`; params.push(`%${heroPool}%`); }
    if (search) { sql += ` AND (username ILIKE $${idx} OR coachName ILIKE $${idx} OR gameId ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (peakSort === 'desc') { sql += ' ORDER BY peakScore DESC NULLS LAST'; }
    else if (peakSort === 'asc') { sql += ' ORDER BY peakScore ASC NULLS LAST'; }
    else { sql += ' ORDER BY created_at DESC'; }
    const result = await pool.query(sql, params);
    // 获取team关联（包括队伍名称和角色）
    const userIds = result.rows.map(u => u.id);
    let teamMap = {};
    if (userIds.length > 0) {
      const tmRes = await pool.query(
        'SELECT tm.userid, tm.teamid, tm.role, t.name as team_name FROM team_members tm JOIN teams t ON tm.teamid = t.id WHERE tm.userid = ANY($1)',
        [userIds]
      );
      tmRes.rows.forEach(r => {
        teamMap[r.userid] = { teamId: r.teamid, teamName: r.team_name, role: r.role };
      });
    }
    res.json({ users: result.rows.map(u => ({
      id: u.id, username: u.username, teamName: u.teamname, coachName: u.coachname,
      wechat: u.wechat, level: u.level, bio: u.bio, createdAt: u.created_at,
      gameId: u.gameid || '', gameServer: u.gameserver || '', gameRank: u.gamerank || '', peakScore: u.peakscore || 0, heroPool: u.heropool || '',
      dream_coins: u.dream_coins || 0,
      team: teamMap[u.id] || null
    })) });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 管理员获取用户筛选选项
app.get('/api/admin/users/options', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const levelsRes = await pool.query('SELECT DISTINCT level FROM users WHERE level IS NOT NULL AND level != \'\' ORDER BY level');
    const serversRes = await pool.query('SELECT DISTINCT gameServer FROM users WHERE gameServer IS NOT NULL AND gameServer != \'\' ORDER BY gameServer');
    const ranksRes = await pool.query('SELECT DISTINCT gameRank FROM users WHERE gameRank IS NOT NULL AND gameRank != \'\' ORDER BY gameRank');
    res.json({
      levels: levelsRes.rows.map(r => r.level),
      servers: serversRes.rows.map(r => r.gameserver),
      ranks: ranksRes.rows.map(r => r.gamerank)
    });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 管理员发放梦币用的用户列表（简化）
app.get('/api/admin/users/simple', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, coachName FROM users ORDER BY coachName, username');
    res.json({ users: result.rows });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 管理员删除用户
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM team_members WHERE userId = $1', [req.params.id]);
    await client.query('DELETE FROM notifications WHERE userId = $1', [req.params.id]);
    await client.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); serverError(res, '删除失败'); } finally { client.release(); }
});

// 管理员操作日志（简化版：从通知表读取）
app.get('/api/admin/logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100');
    res.json({ logs: result.rows.map(l => ({
      id: l.id, userId: l.userid, type: l.type, content: l.content,
      relatedId: l.relatedid, read: l.read, createdAt: l.created_at
    })) });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 管理员权限安全
app.get('/api/admin/security', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const adminCount = await pool.query('SELECT COUNT(*) FROM users WHERE id = $1', [ADMIN_USER_ID]);
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    res.json({
      adminUserId: ADMIN_USER_ID || '未设置',
      totalUsers: parseInt(totalUsers.rows[0].count),
      hasAdmin: parseInt(adminCount.rows[0].count) > 0,
      tips: [
        '建议定期更换JWT_SECRET环境变量',
        '建议在Railway环境变量中设置ADMIN_USER_ID',
        '数据库连接使用SSL加密',
        '所有管理员操作已记录'
      ]
    });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});


// ====================== 个人游戏资料 ======================

app.get('/api/users/me/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT gameId, gameServer, gameRank, peakScore, laneStats, heroPool FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return notFound(res, '用户不存在');
    const u = result.rows[0];
    res.json({
      profile: {
        gameId: u.gameid || '',
        gameServer: u.gameserver || '手Q区',
        gameRank: u.gamerank || '星耀',
        peakScore: u.peakscore || 0,
        laneStats: u.lanestats ? JSON.parse(u.lanestats) : { '对抗路': '0', '打野': '0', '中路': '0', '发育路': '0', '游走': '0' },
        heroPool: u.heropool || ''
      }
    });
  } catch (e) { console.error(e); serverError(res, '获取失败'); }
});

app.put('/api/users/me/profile', authMiddleware, async (req, res) => {
  const { gameId, gameServer, gameRank, peakScore, laneStats, heroPool } = req.body;
  try {
    const laneStatsJson = typeof laneStats === 'string' ? laneStats : JSON.stringify(laneStats || {});
    await pool.query(
      'UPDATE users SET gameId = COALESCE($1, gameId), gameServer = COALESCE($2, gameServer), gameRank = COALESCE($3, gameRank), peakScore = COALESCE($4, peakScore), laneStats = COALESCE($5, laneStats), heroPool = COALESCE($6, heroPool) WHERE id = $7',
      [gameId || null, gameServer || null, gameRank || null, peakScore || null, laneStatsJson || null, heroPool || null, req.userId]
    );
    ok(res);
  } catch (e) { console.error(e); serverError(res, '更新失败'); }
});

// 更新用户标签（身份切换，支持多标签并存）
app.put('/api/users/me/tags', authMiddleware, async (req, res) => {
  const { tags } = req.body;
  if (!Array.isArray(tags)) return badRequest(res, 'tags 必须是字符串数组');
  if (tags.length === 0) return badRequest(res, '至少保留一个标签');
  try {
    await pool.query('UPDATE users SET tags = $1 WHERE id = $2', [tags, req.userId]);
    ok(res, { tags });
  } catch (e) { console.error(e); serverError(res, '更新标签失败'); }
});

// ====================== 队伍系统 ======================

// 获取所有队伍（公开列表）
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await pool.query("SELECT * FROM teams ORDER BY createdAt DESC");
    if (teams.rows.length === 0) return res.json({ teams: [] });

    const teamIds = teams.rows.map(t => t.id);
    const members = await pool.query('SELECT * FROM team_members WHERE teamId = ANY($1)', [teamIds]);
    const userIds = [...new Set(members.rows.map(m => m.userid))];
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });

    const result = teams.rows.map(t => {
      const tm = members.rows.filter(m => m.teamid === t.id);
      const memberList = tm.map(m => {
        const u = userMap[m.userid] || {};
        return { userId: m.userid, role: m.role, joinedAt: m.joinedat, username: u.username, teamName: u.teamname, coachName: u.coachname, level: u.level, gameId: u.gameid };
      });
      // 根据实际人数计算真实状态（自动修复历史脏数据）
      const actualStatus = tm.length >= t.maxmembers ? 'closed' : 'open';
      if (actualStatus !== t.status) {
        pool.query("UPDATE teams SET status = $1 WHERE id = $2", [actualStatus, t.id]).catch(() => {});
      }
      return { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: actualStatus, memberCount: tm.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat };
    });
    res.json({ teams: result });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 获取我的队伍
app.get('/api/teams/mine', authMiddleware, async (req, res) => {
  try {
    const memberRes = await pool.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (memberRes.rows.length === 0) return ok(res, { team: null });

    const teamId = memberRes.rows[0].teamid;
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    if (tRes.rows.length === 0) return ok(res, { team: null });
    const t = tRes.rows[0];

    const members = await pool.query('SELECT * FROM team_members WHERE teamId = $1', [teamId]);
    const userIds = members.rows.map(m => m.userid);
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level, gameRank, peakScore, heroPool, gameId FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });
    
    const memberList = members.rows.map(m => {
      const u = userMap[m.userid] || {};
      return {
        userId: m.userid, role: m.role, joinedAt: m.joinedat,
        username: u.username, coachName: u.coachname, level: u.level,
        gameRank: u.gamerank, peakScore: u.peakscore, heroPool: u.heropool,
        gameId: u.gameid
      };
    });

    const myRole = members.rows.find(m => m.userid === req.userId)?.role || 'member';
    // 根据实际人数计算真实状态（自动修复历史脏数据）
    const actualStatus = members.rows.length >= t.maxmembers ? 'closed' : 'open';
    if (actualStatus !== t.status) {
      await pool.query("UPDATE teams SET status = $1 WHERE id = $2", [actualStatus, t.id]);
    }
    ok(res, { team: { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: actualStatus, memberCount: members.rows.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat, myRole } });
  } catch (e) { serverError(res, '加载队伍失败', e); }
});

// 获取单个队伍详情
app.get('/api/teams/:id', async (req, res) => {
  try {
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) return notFound(res, '队伍不存在');
    const t = tRes.rows[0];

    const members = await pool.query('SELECT * FROM team_members WHERE teamId = $1', [req.params.id]);
    const userIds = members.rows.map(m => m.userid);
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level, gameRank, peakScore, heroPool, gameId FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });
    
    const memberList = members.rows.map(m => {
      const u = userMap[m.userid] || {};
      return { userId: m.userid, role: m.role, joinedAt: m.joinedat, username: u.username, coachName: u.coachname, level: u.level, gameRank: u.gamerank, peakScore: u.peakscore, heroPool: u.heropool, gameId: u.gameid };
    });
    res.json({ team: { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: t.status, memberCount: members.rows.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat } });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

// 创建队伍
app.post('/api/teams', authMiddleware, async (req, res) => {
  const { name, bio } = req.body;
  if (!name) return badRequest(res, '请填写队伍名称');
  try {
    // 检查是否已在队伍中
    const existing = await pool.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (existing.rows.length > 0) return badRequest(res, '你已在其他队伍中，请先退出');

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    await pool.query('INSERT INTO teams (id, name, bio, captainId) VALUES ($1,$2,$3,$4)', [id, name, bio || '', req.userId]);
    await pool.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1,$2,$3)', [id, req.userId, 'captain']);

    const userRes = await pool.query('SELECT username, teamName, coachName, level FROM users WHERE id = $1', [req.userId]);
    const u = userRes.rows[0] || {};
    res.json({ team: { id, name, bio: bio || '', captainId: req.userId, status: 'open', memberCount: 1, maxMembers: 7, members: [{ userId: req.userId, role: 'captain', username: u.username, coachName: u.coachname, level: u.level }] } });
  } catch (e) { console.error(e); serverError(res, '创建失败'); }
});

// 更新队伍信息（仅队长）
app.put('/api/teams/:id', authMiddleware, async (req, res) => {
  const { name, bio, status } = req.body;
  try {
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) return notFound(res, '队伍不存在');
    if (tRes.rows[0].captainid !== req.userId) return forbidden(res, '仅队长可修改队伍信息');
    await pool.query('UPDATE teams SET name = COALESCE($1, name), bio = COALESCE($2, bio), status = COALESCE($3, status) WHERE id = $4', [name || null, bio || null, status || null, req.params.id]);
    ok(res);
  } catch (e) { console.error(e); serverError(res, '修改失败'); }
});

// 解散队伍（仅队长）
app.delete('/api/teams/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return forbidden(res, '仅队长可解散队伍'); }
    await client.query('DELETE FROM team_members WHERE teamId = $1', [req.params.id]);
    await client.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '解散失败'); } finally { client.release(); }
});

// 加入队伍
app.post('/api/teams/:id/join', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    const t = tRes.rows[0];
    if (t.status !== 'open') { await client.query('ROLLBACK'); return badRequest(res, '该队伍已关闭入队通道'); }

    const existing = await client.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (existing.rows.length > 0) { await client.query('ROLLBACK'); return badRequest(res, '你已在其他队伍中'); }

    const countRes = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    if (parseInt(countRes.rows[0].count) >= 7) {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
      await client.query('ROLLBACK');
      return badRequest(res, '队伍已满（7人）');
    }

    await client.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1,$2,$3)', [req.params.id, req.userId, 'member']);

    // 如果满了自动关闭
    const newCount = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    if (parseInt(newCount.rows[0].count) >= 7) {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
    // 通知队长有新成员加入
    if (t.captainid && t.captainid !== req.userId) {
      await sendNotification(t.captainid, 'team_join', `有新成员加入了你的队伍「${t.name}」`, req.params.id);
    }
    ok(res);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return badRequest(res, '你已在该队伍中');
    console.error(e); serverError(res, '加入失败');
  } finally { client.release(); }
});

// 退出队伍
app.post('/api/teams/:id/leave', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    const t = tRes.rows[0];

    const memberRes = await client.query('SELECT * FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, req.userId]);
    if (memberRes.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '你不是该队伍成员'); }

    await client.query('DELETE FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, req.userId]);

    // 如果是队长退出且队伍还有人，转让给最早加入的成员
    if (t.captainid === req.userId) {
      const remaining = await client.query('SELECT * FROM team_members WHERE teamId = $1 ORDER BY joinedAt ASC LIMIT 1', [req.params.id]);
      if (remaining.rows.length > 0) {
        await client.query('UPDATE teams SET captainId = $1 WHERE id = $2', [remaining.rows[0].userid, req.params.id]);
        await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['captain', req.params.id, remaining.rows[0].userid]);
      } else {
        // 没人了，直接删除队伍
        await client.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
      }
    }

    // 删除成员后，根据当前人数自动更新队伍状态
    const countRes = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    const count = parseInt(countRes.rows[0].count);
    const maxMembers = t.maxmembers || 7;
    if (count < maxMembers) {
      await client.query("UPDATE teams SET status = 'open' WHERE id = $1", [req.params.id]);
    } else {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
    // 通知队长有成员退出（非队长自己退出时）
    if (t.captainid && t.captainid !== req.userId) {
      await sendNotification(t.captainid, 'team_leave', `有成员退出了你的队伍「${t.name}」`, req.params.id);
    }
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '退出失败'); } finally { client.release(); }
});

// 踢出队员（仅队长）
app.delete('/api/teams/:id/members/:userId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return forbidden(res, '仅队长可操作'); }
    if (req.params.userId === req.userId) { await client.query('ROLLBACK'); return badRequest(res, '请使用退出队伍功能'); }

    await client.query('DELETE FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, req.params.userId]);

    // 删除成员后，根据当前人数自动更新队伍状态
    const countRes = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    const count = parseInt(countRes.rows[0].count);
    const maxMembers = tRes.rows[0].maxmembers || 7;
    if (count < maxMembers) {
      await client.query("UPDATE teams SET status = 'open' WHERE id = $1", [req.params.id]);
    } else {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
    // 通知被踢出的成员
    await sendNotification(req.params.userId, 'team_kick', `你已被队长移出队伍「${tRes.rows[0].name}」`, req.params.id);
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '操作失败'); } finally { client.release(); }
});

// 转让队长
app.post('/api/teams/:id/transfer', authMiddleware, async (req, res) => {
  const { newCaptainId } = req.body;
  if (!newCaptainId) return badRequest(res, '请指定新队长');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return forbidden(res, '仅队长可操作'); }
    if (newCaptainId === req.userId) { await client.query('ROLLBACK'); return badRequest(res, '你已经是队长'); }

    const memberRes = await client.query('SELECT * FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, newCaptainId]);
    if (memberRes.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '该成员不在队伍中'); }

    await client.query('UPDATE teams SET captainId = $1 WHERE id = $2', [newCaptainId, req.params.id]);
    await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['captain', req.params.id, newCaptainId]);
    await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['member', req.params.id, req.userId]);

    await client.query('COMMIT');
    // 通知新队长
    await sendNotification(newCaptainId, 'team_transfer', `你已成为队伍「${tRes.rows[0].name}」的新队长`, req.params.id);
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '转让失败'); } finally { client.release(); }
});

// ====================== 管理员队伍接口 ======================

app.get('/api/admin/teams', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const teams = await pool.query('SELECT * FROM teams ORDER BY createdAt DESC');
    if (teams.rows.length === 0) return res.json({ teams: [] });

    const teamIds = teams.rows.map(t => t.id);
    const members = await pool.query('SELECT * FROM team_members WHERE teamId = ANY($1)', [teamIds]);
    const userIds = [...new Set(members.rows.map(m => m.userid))];
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });

    const result = teams.rows.map(t => {
      const tm = members.rows.filter(m => m.teamid === t.id);
      const memberList = tm.map(m => {
        const u = userMap[m.userid] || {};
        return { userId: m.userid, role: m.role, username: u.username, teamName: u.teamname, coachName: u.coachname, level: u.level };
      });
      return { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: t.status, memberCount: tm.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat };
    });
    res.json({ teams: result });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
});

app.delete('/api/admin/teams/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM team_members WHERE teamId = $1', [req.params.id]);
    await client.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '删除失败'); } finally { client.release(); }
});

// 管理员创建队伍
app.post('/api/admin/teams', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, bio, maxMembers, captainId } = req.body;
  if (!name || !name.trim()) return badRequest(res, '请输入队伍名称');
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO teams (id, name, bio, captainId, maxMembers, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, name.trim(), bio || '', captainId || null, parseInt(maxMembers) || 7, 'open']
    );
    const team = result.rows[0];
    if (captainId) {
      await client.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1, $2, $3)', [team.id, captainId, 'captain']);
    }
    await client.query('COMMIT');
    res.json({ success: true, team: { id: team.id, name: team.name } });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '创建失败'); } finally { client.release(); }
});

// 管理员更新队伍（改名/换队长/改状态）
app.put('/api/admin/teams/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, captainId, newCaptainUsername, status, bio, maxMembers } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
    const team = current.rows[0];
    // 如果提供了用户名，自动解析为用户ID
    let resolvedCaptainId = captainId;
    if (resolvedCaptainId === undefined && newCaptainUsername) {
      const userRes = await client.query('SELECT id FROM users WHERE username = $1', [newCaptainUsername]);
      if (userRes.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到用户：' + newCaptainUsername); }
      resolvedCaptainId = userRes.rows[0].id;
    }
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name.trim()); }
    if (resolvedCaptainId !== undefined) { updates.push(`captainId = $${idx++}`); params.push(resolvedCaptainId); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
    if (bio !== undefined) { updates.push(`bio = $${idx++}`); params.push(bio); }
    if (maxMembers !== undefined) { updates.push(`maxMembers = $${idx++}`); params.push(parseInt(maxMembers)); }
    if (updates.length > 0) {
      params.push(req.params.id);
      await client.query(`UPDATE teams SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    }
    // 如果换了队长，同步更新 team_members
    if (resolvedCaptainId !== undefined && resolvedCaptainId !== team.captainid) {
      await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['member', req.params.id, team.captainid]);
      await client.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1, $2, $3) ON CONFLICT (teamId, userId) DO UPDATE SET role = $3', [req.params.id, resolvedCaptainId, 'captain']);
    }
    await client.query('COMMIT');
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '更新失败'); } finally { client.release(); }
});

// 管理员添加成员到队伍（同时从其他队伍移除）
app.post('/api/admin/teams/:id/members', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return badRequest(res, '请指定用户');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 查询队伍名称
    const teamRes = await client.query('SELECT name FROM teams WHERE id = $1', [req.params.id]);
    const teamName = teamRes.rows[0]?.name || '未知队伍';
    // 从其他队伍移除
    await client.query('DELETE FROM team_members WHERE userId = $1', [userId]);
    // 加入新队伍
    await client.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1, $2, $3)', [req.params.id, userId, 'member']);
    await client.query('COMMIT');
    // 发送通知给用户
    await sendNotification(userId, 'team_invite', `管理员已将你加入队伍「${teamName}」，可在「我的队伍」中查看。`, req.params.id);
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '添加失败'); } finally { client.release(); }
});

// 管理员移除成员
app.delete('/api/admin/teams/:id/members/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, req.params.userId]);
    // 如果移除的是队长，清空队伍的 captainId
    await client.query('UPDATE teams SET captainId = NULL WHERE id = $1 AND captainId = $2', [req.params.id, req.params.userId]);

    // 删除成员后，根据当前人数自动更新队伍状态
    const countRes = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    const count = parseInt(countRes.rows[0].count);
    const teamInfoRes = await client.query('SELECT maxMembers FROM teams WHERE id = $1', [req.params.id]);
    const maxMembers = teamInfoRes.rows[0]?.maxmembers || 7;
    if (count < maxMembers) {
      await client.query("UPDATE teams SET status = 'open' WHERE id = $1", [req.params.id]);
    } else {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
    // 通知被移除的成员
    const teamRes = await pool.query('SELECT name FROM teams WHERE id = $1', [req.params.id]);
    await sendNotification(req.params.userId, 'team_remove', `你已被管理员移出队伍「${teamRes.rows[0]?.name || '未知队伍'}」`, req.params.id);
    ok(res);
  } catch (e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '移除失败'); } finally { client.release(); }
});


// ==================== 赛事管理 ====================
app.get('/api/competitions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.coachName AS created_by_name, u.username AS created_by_username
      FROM competitions c
      LEFT JOIN users u ON u.id = c.created_by
      WHERE c.status != 'deleted'
      ORDER BY c.created_at DESC
    `);
    // 为每个赛事附加报名统计
    const comps = result.rows;
    if (comps.length > 0) {
      const ids = comps.map(c => c.id);
      const regs = await pool.query(
        `SELECT competition_id, entry_fee, status FROM competition_registrations WHERE competition_id = ANY($1) AND status != 'cancelled'`,
        [ids]
      );
      const statsMap = {};
      comps.forEach(c => { statsMap[c.id] = { count: 0, fee500: 0, fee1000: 0, fee2000: 0, prizePool: 0 }; });
      regs.rows.forEach(r => {
        const s = statsMap[r.competition_id];
        if (!s) return;
        s.count++;
        if (r.entry_fee === 500) s.fee500++;
        else if (r.entry_fee === 1000) s.fee1000++;
        else if (r.entry_fee === 2000) s.fee2000++;
        s.prizePool += r.entry_fee;
      });
      comps.forEach(c => { c.reg_stats = statsMap[c.id]; });
    }
    const all = comps;
    all.forEach(c => {
      c.start_time = fmtLocalISO(c.start_time);
      c.end_time = fmtLocalISO(c.end_time);
    });
    res.json({
      competitions: all,
      elite: all.filter(c => c.tier === 'elite'),
      secondary: all.filter(c => c.tier === 'secondary'),
      regular: all.filter(c => ['regular','arena','training'].includes(c.tier)),
      arena: all.filter(c => c.tier === 'arena')
    });
  } catch(e) { serverError(res, '查询失败'); }
});

// 辅助：将 Date/字符串格式化为本地 ISO 字符串（YYYY-MM-DDTHH:mm），避免时区偏移
function fmtLocalISO(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 获取单个 competition 详情（兼容 comp_ 前缀旧数据）=====
app.get('/api/competitions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const compResult = await pool.query(
      'SELECT * FROM competitions WHERE id = $1 AND status != \'deleted\'',
      [id]
    );
    if (compResult.rows.length === 0) return notFound(res, '赛事不存在');
    const comp = compResult.rows[0];
    // 查询创建者信息
    if (comp.created_by) {
      try {
        const userResult = await pool.query('SELECT coachName, username FROM users WHERE id = $1', [comp.created_by]);
        if (userResult.rows.length > 0) {
          comp.created_by_name = userResult.rows[0].coachname;
          comp.created_by_username = userResult.rows[0].username;
        }
      } catch (userErr) { /* ignore */ }
    }
    comp.start_time = fmtLocalISO(comp.start_time);
    comp.end_time = fmtLocalISO(comp.end_time);
    // 附加报名统计
    const regs = await pool.query(
      'SELECT entry_fee, status FROM competition_registrations WHERE competition_id = $1 AND status != \'cancelled\'',
      [id]
    );
    comp.reg_stats = { count: 0, fee500: 0, fee1000: 0, fee2000: 0, prizePool: 0 };
    regs.rows.forEach(r => {
      comp.reg_stats.count++;
      if (r.entry_fee === 500) comp.reg_stats.fee500++;
      else if (r.entry_fee === 1000) comp.reg_stats.fee1000++;
      else if (r.entry_fee === 2000) comp.reg_stats.fee2000++;
      comp.reg_stats.prizePool += (r.entry_fee || 0);
    });
    // 附加 participants（从 competition_registrations 表构建）
    const participants = await pool.query(
      `SELECT cr.player_user_id, u.username, u.coachName, cr.side, cr.lane, cr.club_id
       FROM competition_registrations cr
       LEFT JOIN users u ON u.id = cr.player_user_id
       WHERE cr.competition_id = $1 AND cr.status != 'cancelled'`,
      [id]
    );
    comp.participants = participants.rows.map(r => ({
      user_id: r.player_user_id,
      username: r.username,
      coachName: r.coachname,
      side: r.side,
      lane: r.lane,
      club_id: r.club_id
    }));
    res.json({ success: true, competition: comp });
  } catch(e) { console.error('[GET /api/competitions/:id]', e.message, e.stack); serverError(res, '查询失败'); }
});

app.post('/api/admin/competitions', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, qr_code_url, tier, start_time, end_time, bo, description } = req.body;
  if (!name) return badRequest(res, '请填写赛事名称');
  const id = 'comp_' + Date.now();
  try {
    await pool.query(
      'INSERT INTO competitions (id, name, qr_code_url, tier, created_by, start_time, end_time, bo, comp_status, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, name, qr_code_url || null, tier || 'regular', req.userId, start_time || null, end_time || null, bo || 1, 'upcoming', description || null]
    );
    ok(res, {id });
  } catch(e) { console.error(e); serverError(res, '创建失败'); }
});

app.delete('/api/admin/competitions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query("UPDATE competitions SET comp_status = 'cancelled', status = 'deleted' WHERE id = $1", [req.params.id]);
    // 取消所有报名并退费
    const regs = await pool.query("SELECT player_user_id, entry_fee FROM competition_registrations WHERE competition_id = $1 AND entry_fee > 0", [req.params.id]);
    for (const r of regs.rows) {
      await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [r.entry_fee, r.player_user_id]);
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'refund','赛事取消退款')", [r.player_user_id, r.entry_fee]);
    }
    await pool.query("UPDATE competition_registrations SET status = 'cancelled' WHERE competition_id = $1", [req.params.id]);
    ok(res);
  } catch(e) { serverError(res, '删除失败'); }
});

// 管理员手动开赛
app.post('/api/admin/competitions/:id/start', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const comp = await pool.query('SELECT id, comp_status FROM competitions WHERE id = $1', [req.params.id]);
    if (comp.rows.length === 0) return notFound(res, '赛事不存在');
    if (comp.rows[0].comp_status === 'live') return badRequest(res, '赛事已在进行中');
    if (comp.rows[0].comp_status === 'finished') return badRequest(res, '赛事已结束');
    await pool.query(
      "UPDATE competitions SET comp_status = 'live', start_time = NOW() WHERE id = $1",
      [req.params.id]
    );
    ok(res, { comp_status: 'live' }, '已开赛');
  } catch(e) { console.error(e); serverError(res, '开赛失败'); }
});

// ==================== 赛事报名系统 ====================

// 团队报名（队长操作，指定5人+位置）
app.post('/api/competitions/:id/register', authMiddleware, async (req, res) => {
  const { team_id, club_id, players } = req.body; // players: [{user_id, lane}]
  const isClub = !!club_id;
  const isTeam = !!team_id;
  if (!isTeam && !isClub) return badRequest(res, '请选择队伍或俱乐部');
  if (!players || !Array.isArray(players) || players.length !== 5) return badRequest(res, '请指定5名队员');
  for (const p of players) {
    if (!p.user_id) return badRequest(res, 'user_id 必填');
  }
  // 日志：报名请求
  console.info('[报名请求]', JSON.stringify({ competition_id: req.params.id, user_id: req.userId, team_id: team_id || null, club_id: club_id || null, player_ids: players.map(p => p.user_id), timestamp: new Date().toISOString() }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comp = await client.query('SELECT * FROM competitions WHERE id = $1', [req.params.id]);
    if (comp.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '赛事不存在'); }
    const c = comp.rows[0];
    if (c.comp_status !== 'upcoming' && c.comp_status !== 'open') { await client.query('ROLLBACK'); return badRequest(res, '该赛事不可报名'); }
    if (isTeam) {
      // 验证队伍和队长
      const team = await client.query('SELECT * FROM teams WHERE id = $1', [team_id]);
      if (team.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '队伍不存在'); }
      if (team.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return forbidden(res, '仅队长可报名'); }
      // 验证队员都在队伍中
      const tm = await client.query('SELECT userId FROM team_members WHERE teamId = $1', [team_id]);
      const memberIds = new Set(tm.rows.map(r => r.userid));
      for (const p of players) {
        if (!memberIds.has(p.user_id)) { await client.query('ROLLBACK'); return badRequest(res, '队员 ' + p.user_id + ' 不在队伍中'); }
      }
      // 已报名检查（同队伍）
      const already = await client.query('SELECT * FROM competition_registrations WHERE competition_id = $1 AND team_id = $2 AND status != $3', [req.params.id, team_id, 'cancelled']);
      if (already.rows.length > 0) { await client.query('ROLLBACK'); return badRequest(res, '该队伍已报名'); }
    } else {
      // 验证俱乐部和老板
      const club = await client.query('SELECT * FROM clubs WHERE id = $1', [club_id]);
      if (club.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '俱乐部不存在'); }
      if (club.rows[0].owner_id !== req.userId) { await client.query('ROLLBACK'); return forbidden(res, '仅俱乐部老板可报名'); }
      // 验证队员都在俱乐部自由名单中（tier='free'）
      const rosterRes = await client.query(
        'SELECT player_user_id FROM club_rosters WHERE club_id = $1 AND tier = $2',
        [club_id, 'free']
      );
      const freeUserIds = new Set(rosterRes.rows.map(r => r.player_user_id));
      for (const p of players) {
        if (!freeUserIds.has(p.user_id)) { await client.query('ROLLBACK'); return badRequest(res, '队员 ' + p.user_id + ' 不在俱乐部自由名单中'); }
      }
      // 已报名检查（同俱乐部）
      const already = await client.query('SELECT * FROM competition_registrations WHERE competition_id = $1 AND club_id = $2 AND status != $3', [req.params.id, club_id, 'cancelled']);
      if (already.rows.length > 0) { await client.query('ROLLBACK'); return badRequest(res, '该俱乐部已报名'); }
    }
    // 自动分配红蓝方
    const groupField = isTeam ? 'team_id' : 'club_id';
    const groupId = isTeam ? team_id : club_id;
    const existingSides = await client.query(
      `SELECT DISTINCT side, ${groupField} FROM competition_registrations WHERE competition_id = $1 AND status != 'cancelled' AND ${groupField} != '' AND ${groupField} IS NOT NULL`,
      [req.params.id]
    );
    const redTaken = existingSides.rows.some(r => r.side === 'red');
    const blueTaken = existingSides.rows.some(r => r.side === 'blue');
    let side = 'red';
    if (redTaken && !blueTaken) {
      side = 'blue';
    } else if (redTaken && blueTaken) {
      // 检查当前队伍是否已占某一方（重复报名检查已在上面做，这里理论上不会触发）
      const mySide = existingSides.rows.find(r => r[groupField] === groupId);
      if (mySide) side = mySide.side;
      else { await client.query('ROLLBACK'); return badRequest(res, '红蓝双方均已满员'); }
    }
    // 房间容量检查（常规赛事/训练赛固定10人上限，自由模式无限制）
    const isFreeMode = ['arena'].includes(c.tier);
    if (!isFreeMode) {
      const countRes = await client.query(
        'SELECT COUNT(*) FROM competition_registrations WHERE competition_id = $1 AND status != $2',
        [req.params.id, 'cancelled']
      );
      const currentCount = parseInt(countRes.rows[0].count);
      if (currentCount >= 10) { await client.query('ROLLBACK'); return badRequest(res, '房间已满（10人上限）'); }
    }
    // 单选手重复报名检测：同一选手不能被不同队伍/俱乐部重复报名
    const playerIds = players.map(p => p.user_id);
    const dupCheck = await client.query(
      'SELECT player_user_id FROM competition_registrations WHERE competition_id = $1 AND status != $2 AND player_user_id = ANY($3)',
      [req.params.id, 'cancelled', playerIds]
    );
    if (dupCheck.rows.length > 0) {
      const dupNames = dupCheck.rows.map(r => r.player_user_id).join(', ');
      await client.query('ROLLBACK');
      return badRequest(res, '以下选手已报名本赛事：' + dupNames);
    }
    // 自动补全 players 记录（无记录时默认身价=35）
    for (const p of players) {
      const hasPlayer = await client.query('SELECT user_id FROM players WHERE user_id=$1', [p.user_id]);
      if (hasPlayer.rows.length === 0) {
        const u = await client.query('SELECT gameid, coachname, username FROM users WHERE id=$1', [p.user_id]);
        const gid = (u.rows.length > 0) ? (u.rows[0].gameid || u.rows[0].coachname || u.rows[0].username || 'unknown') : 'unknown';
        await client.query(
          'INSERT INTO players (user_id, game_id, market_value, status, positions) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING',
          [p.user_id, gid, 35, 'available', '']
        );
        console.log('[自动补全 players] user_id=' + p.user_id + ' game_id=' + gid + ' market_value=35');
      }
    }
    // 创建5人报名
    for (const p of players) {
      await client.query(
        'INSERT INTO competition_registrations (competition_id, team_id, club_id, player_user_id, status, side, lane) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.params.id, isTeam ? team_id : '', club_id || null, p.user_id, 'reserved', side, p.lane || '']
      );
    }
    if (c.comp_status === 'upcoming') {
      await client.query("UPDATE competitions SET comp_status = 'open' WHERE id = $1", [req.params.id]);
    }
    await client.query('COMMIT');
    // 通知被选中的5人（非阻塞，失败不影响报名结果）
    for (const p of players) {
      try {
        const modeLabel = c.tier === 'arena' ? '擂台赛' : (c.tier === 'training' ? '训练赛' : '赛事');
        const noFeeMode = ['arena','training'].includes(c.tier);
        const notifyText = noFeeMode
          ? `你被${isClub?'老板':'队长'}选入${modeLabel}「${c.name}」，请进入比赛页确认入场`
          : `你被${isClub?'老板':'队长'}选入赛事「${c.name}」，请进入比赛页确认入场并选择入场费`;
        await sendNotification(p.user_id, 'competition_register', notifyText);
      } catch(notifyErr) { console.warn('[报名通知失败]', p.user_id, notifyErr.message); }
    }
    // 日志：报名成功
    console.info('[报名成功]', JSON.stringify({ competition_id: req.params.id, user_id: req.userId, team_id: isTeam ? team_id : null, club_id: isClub ? club_id : null, player_ids: players.map(p => p.user_id), timestamp: new Date().toISOString(), status: 'SUCCESS' }));
    ok(res, {message: '报名成功，队员请确认入场' });
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch(rollbackErr) {}
    console.error('[报名失败]', JSON.stringify({ competition_id: req.params.id, user_id: req.userId, error: e.message, stack: e.stack, timestamp: new Date().toISOString(), status: 'FAILED' }));
    serverError(res, '报名失败: ' + e.message, e);
  } finally { client.release(); }
});

// 查询用户在赛事中的报名状态
app.get('/api/competitions/:id/my-reg', authMiddleware, async (req, res) => {
  try {
    const regs = await pool.query(
      'SELECT * FROM competition_registrations WHERE competition_id = $1 AND status != $2',
      [req.params.id, 'cancelled']
    );
    res.json({ registrations: regs.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// 查询赛事所有报名人员（带用户信息，公开可见）
app.get('/api/competitions/:id/registrations', async (req, res) => {
  try {
    const regs = await pool.query(`
      SELECT r.*, u.coachName, u.username, u.teamName, u.gameId
      FROM competition_registrations r
      LEFT JOIN users u ON u.id = r.player_user_id
      WHERE r.competition_id = $1 AND r.status != 'cancelled'
      ORDER BY r.side, r.created_at
    `, [req.params.id]);
    res.json({ registrations: regs.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// 队员确认入场 + 选择入场费（擂台赛无需入场费，直接确认）
app.post('/api/competitions/:id/confirm', authMiddleware, async (req, res) => {
  const { entry_fee } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comp = await client.query('SELECT * FROM competitions WHERE id = $1', [req.params.id]);
    if (comp.rows.length === 0) { await client.query('ROLLBACK'); return notFound(res, '赛事不存在'); }
    const c = comp.rows[0];
    const isFreeMode = ['arena'].includes(c.tier);
    const noFeeMode = ['arena','training'].includes(c.tier);
    // 直接查找该用户的报名记录（队长已指定队员+位置）
    const reg = await client.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND player_user_id = $2 AND status = 'reserved'",
      [req.params.id, req.userId]
    );
    if (reg.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到你的报名记录'); }
    if (!noFeeMode) {
      if (![500,1000,2000].includes(entry_fee)) { await client.query('ROLLBACK'); return badRequest(res, '入场费必须为500/1000/2000'); }
      // 检查余额
      const user = await client.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
      const balance = user.rows[0]?.dream_coins || 0;
      if (balance < entry_fee) { await client.query('ROLLBACK'); return badRequest(res, `梦币不足（余额：${balance}）`); }
      // 扣梦币
      await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) - $1 WHERE id = $2', [entry_fee, req.userId]);
      await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct','赛事入场费')", [req.userId, -entry_fee]);
    }
    // 更新报名状态
    await client.query(
      "UPDATE competition_registrations SET entry_fee = $1, status = 'confirmed' WHERE id = $2",
      [noFeeMode ? 0 : (entry_fee || 0), reg.rows[0].id]
    );
    // 检查是否10人全部确认（仅常规赛事）
    if (!isFreeMode) {
      const confirmed = await client.query(
        "SELECT COUNT(*) FROM competition_registrations WHERE competition_id = $1 AND status = 'confirmed'",
        [req.params.id]
      );
      if (parseInt(confirmed.rows[0].count) >= 10) {
        await client.query("UPDATE competitions SET comp_status = 'locked' WHERE id = $1", [req.params.id]);
      }
    }
    await client.query('COMMIT');
    ok(res, { entry_fee: noFeeMode ? 0 : entry_fee });
  } catch(e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '确认失败'); } finally { client.release(); }
});
// 取消入场（退费）
app.post('/api/competitions/:id/cancel', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reg = await client.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND player_user_id = $2 AND status = 'confirmed'",
      [req.params.id, req.userId]
    );
    if (reg.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到已确认的报名'); }
    const r = reg.rows[0];
    if (r.entry_fee > 0) {
      await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [r.entry_fee, req.userId]);
      await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'refund','取消入场退费')", [req.userId, r.entry_fee]);
    }
    await client.query("UPDATE competition_registrations SET status = 'cancelled', entry_fee = 0 WHERE id = $1", [r.id]);
    // 如果之前是 locked，恢复为 open
    await client.query("UPDATE competitions SET comp_status = 'open' WHERE id = $1 AND comp_status = 'locked'", [req.params.id]);
    await client.query('COMMIT');
    ok(res);
  } catch(e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '取消失败'); } finally { client.release(); }
});

// 查询赛事结果（用于管理员审核）
app.get('/api/competitions/:id/results', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM competition_results WHERE competition_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    res.json({ result: result.rows[0] || null });
  } catch(e) { serverError(res, '查询失败'); }
});

// 提交赛后截图
app.post('/api/competitions/:id/submit-result', authMiddleware, async (req, res) => {
  const { winner, screenshots, players, mvp_player_id, coin_rewards } = req.body;
  if (!winner || !screenshots || !players) return badRequest(res, '参数不完整');
  if (!['red','blue','draw'].includes(winner)) return badRequest(res, 'winner 只接受 red/blue/draw');
  try {
    // 校验：赛事必须存在且状态为 open/ongoing
    var comp = await pool.query('SELECT * FROM competitions WHERE id = $1', [req.params.id]);
    if (comp.rows.length === 0) return notFound(res, '赛事不存在');
    var c = comp.rows[0];
    if (c.comp_status !== 'open' && c.comp_status !== 'ongoing' && c.comp_status !== 'review') {
      return badRequest(res, '赛事当前状态不可提交结果（状态：' + c.comp_status + '）');
    }
    
    // 校验：用户是否已报名此赛事
    // 注意：competition_registrations 表只有 player_user_id，没有 user_id
    var reg = await pool.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND (player_user_id = $2 OR team_id IN (SELECT id FROM teams WHERE captainid = $2) OR club_id IN (SELECT id FROM clubs WHERE owner_id = $2)) AND status != 'cancelled'",
      [req.params.id, req.userId]
    );
    if (reg.rows.length === 0) return forbidden(res, '你未报名此赛事，无法提交结果');
    
    // 校验：防止重复提交
    var existing = await pool.query(
      'SELECT * FROM competition_results WHERE competition_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (existing.rows.length > 0) return badRequest(res, '该赛事已有结果提交，如需修改请联系管理员');
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO competition_results (competition_id, winner, screenshot_urls, player_data, mvp_player_id, coin_rewards) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, winner, JSON.stringify(screenshots), JSON.stringify(players), mvp_player_id || null, JSON.stringify(coin_rewards || {})]
      );
      await client.query("UPDATE competitions SET comp_status = 'review' WHERE id = $1", [req.params.id]);
      await client.query('COMMIT');
      ok(res, {message: '结果已提交，等待管理员审核' });
    } catch(innerErr) {
      await client.query('ROLLBACK');
      throw innerErr;
    } finally { client.release(); }
  } catch(e) { console.error(e); serverError(res, '提交失败'); }
});

// ==================== 截图AI识别（王者荣耀结算截图）- 腾讯云混元视觉 ====================
async function recognizeScreenshot(base64Image) {
  const client = getHunyuanClient();
  if (!client) throw new Error('未配置腾讯云密钥，请在环境变量中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');

  var imageUrl = base64Image.indexOf('base64,') > -1 ? base64Image : 'data:image/jpeg;base64,' + base64Image;
  var prompt = '这是王者荣耀的比赛结算截图。请仔细分析图片，提取以下信息并以JSON格式返回：\n\n1. 获胜方："red"（红方胜）、"blue"（蓝方胜）或 "draw"（平局）\n2. 所有玩家信息数组，每个玩家包含：\n   - game_id: 游戏ID（截图中的玩家名称/游戏ID）\n   - hero: 使用的英雄名称\n   - kda: KDA数据，字符串格式如 "5/2/8"\n   - score: 评分数值（如 8.5）\n   - is_mvp: 是否MVP（true/false）\n   - team: "red" 或 "blue"\n\n请只返回纯JSON对象，不要有markdown代码块或其他文字。\n格式示例：\n{"winner":"red","players":[{"game_id":"Player1","hero":"典韦","kda":"5/2/8","score":8.5,"is_mvp":true,"team":"red"}]}';

  var params = {
    Model: 'hunyuan-vision',
    Messages: [
      {
        Role: 'user',
        Contents: [
          { Type: 'text', Text: prompt },
          { Type: 'image_url', ImageUrl: { Url: imageUrl } }
        ]
      }
    ],
    TopP: 1
  };

  try {
    var result = await client.ChatCompletions(params);
    var content = result.Choices && result.Choices[0] && result.Choices[0].Message
                  ? result.Choices[0].Message.Content || '' : '';
    if (!content) throw new Error('AI返回内容为空');
    var jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI返回格式无法解析，原始返回: ' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  } catch(e) {
    if (e.message.indexOf('未配置') >= 0 || e.message.indexOf('无法解析') >= 0) throw e;
    throw new Error('混元视觉调用失败: ' + (e.message || JSON.stringify(e)));
  }
}

// 截图识别接口
app.post('/api/competitions/:id/recognize-screenshot', authMiddleware, adminMiddleware, async (req, res) => {
  const { screenshot } = req.body;
  if (!screenshot) return badRequest(res, '缺少截图');
  try {
    const aiResult = await recognizeScreenshot(screenshot);
    ok(res, aiResult);
  } catch(e) {
    console.error('截图识别失败:', e);
    serverError(res, '截图识别失败: ' + e.message);
  }
});

// ==================== 唯一结算源 ====================

/**
 * 解析小局数据，计算胜负统计
 * @param {Array} games - [{game, winner, mvp_player_id}, ...]
 * @returns {{redWins, blueWins, winner, sideWinDiff, mvpCounts}}
 */
function parseGames(games) {
  let redWins = 0, blueWins = 0;
  const mvpCounts = {};
  if (games && Array.isArray(games)) {
    for (const g of games) {
      if (g.winner === 'red') redWins++;
      else if (g.winner === 'blue') blueWins++;
      if (g.mvp_player_id) {
        mvpCounts[g.mvp_player_id] = (mvpCounts[g.mvp_player_id] || 0) + 1;
      }
    }
  }
  const winner = redWins > blueWins ? 'red' : (blueWins > redWins ? 'blue' : 'draw');
  const sideWinDiff = Math.abs(redWins - blueWins); // 胜局差（正数）
  return { redWins, blueWins, winner, sideWinDiff, mvpCounts };
}

/**
 * 计算单个选手的身价变化（唯一算法源）
 * 公式：(胜局差) × 2% + MVP次数 × 2%，保底 ±1
 * @param {number} oldValue - 当前身价
 * @param {boolean} isWinnerSide - 是否胜方选手
 * @param {number} mvpCount - 该选手 MVP 次数
 * @param {number} sideWinDiff - 队伍胜局差（BO3 2:0=2, 2:1=1; BO5 3:0=3, 3:1=2, 3:2=1）
 * @returns {{newValue: number, deltaPercent: number}}
 *   deltaPercent: 业务规则百分比（如 +4 / -4 / +8），用于 UI 显示
 *   newValue: 计算后的最终身价（仅用于写库）
 */
function calcPlayerValue(oldValue, isWinnerSide, mvpCount, sideWinDiff) {
  if (sideWinDiff <= 0) sideWinDiff = 1; // 无比赛数据时降级为 ±1
  const baseDiff = isWinnerSide ? sideWinDiff : -sideWinDiff;
  const deltaPercent = baseDiff * 2 + mvpCount * 2; // 业务规则百分比
  let newValue = Math.ceil(oldValue * (1 + deltaPercent / 100));
  // 保底：至少变化1（身价=1时不再减）
  if (isWinnerSide && newValue <= oldValue) newValue = oldValue + 1;
  if (!isWinnerSide && newValue >= oldValue && oldValue > 1) newValue = oldValue - 1;
  newValue = Math.max(1, newValue);
  return { newValue, deltaPercent };
}

// 预览结算结果（干跑，不写库）—— 使用唯一结算源
app.post('/api/competitions/:id/preview-result', authMiddleware, async (req, res) => {
  try {
    const { games } = req.body;
    const stats = parseGames(games);
    if (!games || games.length === 0) {
      // 无 games 时从 competition_results 读取
      const result = await pool.query('SELECT * FROM competition_results WHERE competition_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.id]);
      if (result.rows.length === 0) return notFound(res, '未找到比赛结果，请先提交结果');
      const r = result.rows[0];
      const pd = r.player_data || [];
      // 优先用 _games
      if (pd.length > 0 && pd[0]._games && Array.isArray(pd[0]._games)) {
        Object.assign(stats, parseGames(pd[0]._games));
      } else {
        // 降级：从 player_data 还原胜负
        for (const p of pd) {
          if (p._games) continue; // 跳过元数据元素
          if (p.win && p.team === 'red') stats.redWins++;
          else if (p.win && p.team === 'blue') stats.blueWins++;
        }
        stats.sideWinDiff = Math.abs(stats.redWins - stats.blueWins) || 1;
        stats.winner = stats.redWins > stats.blueWins ? 'red' : (stats.blueWins > stats.redWins ? 'blue' : 'draw');
      }
    }

    // 读取报名选手
    const regs = await pool.query(
      'SELECT player_user_id, side AS team FROM competition_registrations WHERE competition_id = $1 AND status != $2',
      [req.params.id, 'cancelled']
    );
    if (regs.rows.length === 0) return notFound(res, '该比赛暂无报名选手');

    // 计算每个选手身价
    const results = [];
    for (const reg of regs.rows) {
      const uid = reg.player_user_id;
      if (!uid) continue;
      const pl = await pool.query('SELECT market_value, game_id FROM players WHERE user_id=$1', [uid]);
      if (pl.rows.length === 0) { results.push({ player_user_id: uid, player_name: uid, skipped: true, reason: '玩家不存在' }); continue; }
      const oldValue = parseInt(pl.rows[0].market_value, 10);
      if (!oldValue || oldValue <= 0 || isNaN(oldValue)) {
        results.push({ player_user_id: uid, player_name: pl.rows[0].game_id || uid, skipped: true, reason: '身价为0或无效' });
        continue;
      }
      const isWinnerSide = reg.team === stats.winner;
      const mvpCount = stats.mvpCounts[uid] || 0;
      const { newValue, deltaPercent } = calcPlayerValue(oldValue, isWinnerSide, mvpCount, stats.sideWinDiff);
      results.push({
        player_user_id: uid,
        player_name: pl.rows[0].game_id || uid,
        old_value: oldValue,
        new_value: newValue,
        delta_percent: deltaPercent,
        win: isWinnerSide,
        mvp_count: mvpCount
      });
    }
    ok(res, { results });
  } catch(e) { console.error('[preview-result ERROR]', e.message, e.stack); serverError(res, '预览结算失败: ' + e.message); }
});

// 管理员确认结果并发放奖池
app.post('/api/admin/competitions/:id/confirm-result', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 获取所有有效报名（排除已取消）
    const regs = await client.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND status != 'cancelled'",
      [req.params.id]
    );
    if (regs.rows.length < 10) { await client.query('ROLLBACK'); return badRequest(res, '报名不足10人'); }
    // 获取结果
    const result = await client.query('SELECT * FROM competition_results WHERE competition_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.id]);
    if (result.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到比赛结果'); }
    const r = result.rows[0];
    // 处理梦币奖励（管理员手动设置）
    const coinRewards = r.coin_rewards || {};
    const coinRewardEntries = Object.entries(coinRewards).filter(([uid, amount]) => amount > 0);
    let totalPool = 0, winnerCount = 0;
    // playerData 提到外部，两个分支都能用
    const playerData = (r.player_data || []);
    // winnerIds 提到外部
    let winnerIds = new Set();

    if (coinRewardEntries.length > 0) {
      // 手动设置奖励：按 coin_rewards 发放
      for (const [uid, amount] of coinRewardEntries) {
        await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [amount, uid]);
        await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward','赛事奖励')", [uid, amount]);
      }
      winnerCount = coinRewardEntries.length;
    } else {
      // 自动奖池分配（原有逻辑）
      totalPool = regs.rows.reduce((sum, x) => sum + (parseInt(x.entry_fee, 10) || 0), 0);
      const winners = playerData.filter(p => p.team === r.winner && p.win);
      winnerIds = new Set(winners.map(p => p.player_user_id));
      const winnerFees = regs.rows.filter(x => winnerIds.has(x.player_user_id));
      const winnerTotalFee = winnerFees.reduce((sum, x) => sum + (parseInt(x.entry_fee, 10) || 0), 0);
      winnerCount = winnerFees.length;
      for (const w of winnerFees) {
        const fee = parseInt(w.entry_fee, 10) || 0;
        const share = winnerTotalFee > 0 ? Math.round(totalPool * (fee / winnerTotalFee)) : 0;
        if (isNaN(share)) { console.warn('[confirm-result] NaN share for', w.player_user_id); continue; }
        await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [share, w.player_user_id]);
        await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward','赛事奖励')", [w.player_user_id, share]);
      }
    }
    // 写入玩家统计（跳过 player_user_id 缺失的玩家）
    for (const p of playerData) {
      if (!p.player_user_id) { console.warn('[confirm-result] skip player with no player_user_id', p); continue; }
      await client.query(
        'INSERT INTO competition_player_stats (competition_id, player_user_id, team, lane, kda, win) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, p.player_user_id, p.team, p.lane, p.kda || '', p.win || false]
      );
    }
    // === 比赛结算 → 身价波动 + MVP加成（唯一结算源） ===
    const compResultId = r.id;
    // 从 player_data 提取 _games 元数据
    const gamesMeta = (playerData.length > 0 && playerData[0]._games && Array.isArray(playerData[0]._games))
      ? playerData[0]._games
      : [];
    const stats = parseGames(gamesMeta);
    // 降级：无 _games 时用 r.winner + playerData 还原（兼容旧数据）
    if (gamesMeta.length === 0) {
      stats.winner = r.winner;
      // 用 playerData 里的 win 字段还原胜方队伍
      for (const p of playerData) {
        if (p._games) continue; // 跳过元数据
        if (p.win && p.team === 'red') stats.redWins++;
        else if (p.win && p.team === 'blue') stats.blueWins++;
      }
      stats.sideWinDiff = Math.max(Math.abs(stats.redWins - stats.blueWins), 1);
      // 降级模式：MVP 只从单字段取
      if (r.mvp_player_id) stats.mvpCounts[r.mvp_player_id] = (stats.mvpCounts[r.mvp_player_id] || 0) + 1;
    }
    const scoreUpdateIds = [];
    for (const p of playerData) {
      if (!p.player_user_id || p._games) continue; // 跳过元数据和无效行
      const uid = p.player_user_id;
      const pl = await client.query('SELECT market_value, last_match_id FROM players WHERE user_id=$1', [uid]);
      if (pl.rows.length === 0) { console.warn('[confirm-result] no players record for', uid); continue; }
      if (pl.rows[0].last_match_id === compResultId) continue; // 防重复
      const oldValue = parseInt(pl.rows[0].market_value, 10) || 0;
      if (oldValue <= 0 || isNaN(oldValue)) continue;
      const isWinnerSide = p.team === stats.winner;
      const mvpCount = stats.mvpCounts[uid] || 0;
      const { newValue, deltaPercent } = calcPlayerValue(oldValue, isWinnerSide, mvpCount, stats.sideWinDiff);
      if (isNaN(newValue)) { console.warn('[confirm-result] NaN newValue for', uid, 'oldValue=', oldValue); continue; }
      const safeCompResultId = parseInt(compResultId, 10);
      if (isNaN(safeCompResultId)) { console.warn('[confirm-result] NaN compResultId', compResultId); continue; }
      await client.query(
        `UPDATE players SET market_value=$1, grade=$2, last_match_result=$3, last_match_mvp=$4,
         last_change_percentage=$5, last_match_id=$6 WHERE user_id=$7`,
        [newValue, calcGrade(newValue), isWinnerSide ? 'win' : 'lose', mvpCount > 0, deltaPercent, safeCompResultId, uid]
      );
      scoreUpdateIds.push(uid);
    }
    // 更新状态
    await client.query('UPDATE competition_results SET confirmed_by = $1, confirmed_at = NOW() WHERE id = $2', [req.userId, r.id]);
    await client.query("UPDATE competitions SET comp_status = 'finished' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    // 事务提交后同步更新排行榜（确保 market_value 已持久化可见）
    for (const uid of scoreUpdateIds) {
      try { await updatePlayerScore(uid); } catch (e) { console.error('[confirm-result] updatePlayerScore failed for', uid, e); }
    }
    ok(res, { totalPool, winnerCount });
  } catch(e) { await client.query('ROLLBACK'); console.error('[confirm-result ERROR]', e.message, e.stack); serverError(res, '结算失败: ' + e.message); } finally { client.release(); }
});

// 管理员设置/修改比赛 MVP（审核阶段）
app.put('/api/admin/competitions/:id/set-mvp', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { mvp_player_id } = req.body;
    // UUID 格式校验：防止 game_id / 用户名污染 mvp_player_id
    if (mvp_player_id) {
      if (typeof mvp_player_id !== 'string' || !/^[0-9a-f-]+$/.test(mvp_player_id) || mvp_player_id.length < 20) {
        return badRequest(res, 'mvp_player_id 必须是用户 UUID，不能是游戏ID或用户名');
      }
    }
    const result = await pool.query('SELECT * FROM competition_results WHERE competition_id=$1 ORDER BY created_at DESC LIMIT 1', [req.params.id]);
    if (result.rows.length === 0) return notFound(res, '比赛结果不存在');
    if (result.rows[0].confirmed_by) return badRequest(res, '比赛已结算，无法修改 MVP');
    // 如果指定了 mvp_player_id，校验该选手确实在比赛 player_data 中
    if (mvp_player_id) {
      const pd = result.rows[0].player_data || [];
      const found = pd.some(p => String(p.player_user_id) === String(mvp_player_id));
      if (!found) return badRequest(res, '所选选手不在本场比赛参赛名单中');
    }
    await pool.query('UPDATE competition_results SET mvp_player_id=$1 WHERE id=$2', [mvp_player_id || null, result.rows[0].id]);
    ok(res, { message: mvp_player_id ? 'MVP 已设置' : 'MVP 已清除' });
  } catch(e) { console.error(e); serverError(res, '设置 MVP 失败', e); }
});

// ==================== 梦币系统 ====================
app.get('/api/me/coins', authMiddleware, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
    const balance = userRes.rows[0] ? userRes.rows[0].dream_coins : 0;
    const txRes = await pool.query('SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json({ balance, transactions: txRes.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

app.post('/api/admin/award-coins', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, amount, note, target } = req.body;
  if (!amount) return badRequest(res, '缺少金额参数');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let affectedCount = 0;
    // 批量发放给所有用户（带去重检查）
    if (userId === 'all' || target === 'all') {
      const allUsers = await client.query('SELECT id FROM users');
      const reason = note || (amount > 0 ? '管理员发放初始奖金' : '梦币调整');
      const txType = amount > 0 ? 'award' : 'deduct';
      affectedCount = 0;
      let skippedCount = 0;
      const affectedUserIds = [];
      // 逐用户处理：先检查是否已有相同 note 的流水，再决定是否发放
      for (const u of allUsers.rows) {
        const existing = await client.query(
          'SELECT id FROM coin_transactions WHERE user_id = $1 AND note = $2',
          [u.id, reason]
        );
        if (existing.rows.length > 0) {
          // 该用户已有相同 note 的记录，跳过（不重复发放）
          skippedCount++;
          continue;
        }
        // 未发放过：更新余额 + 插入流水
        await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [amount, u.id]);
        await client.query(
          "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, $3, $4)",
          [u.id, amount, txType, reason]
        );
        affectedCount++;
        affectedUserIds.push(u.id);
      }
      // 保留一条汇总记录供管理员全部流水查看（即使全部跳过也记录）
      const summaryNote = reason + (skippedCount > 0 ? '（批量操作汇总，共' + allUsers.rowCount + '人，已跳过' + skippedCount + '人）' : '（批量操作汇总，共' + affectedCount + '人）');
      await client.query(
        "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ('system', $1, $2, $3)",
        [amount, txType, summaryNote]
      );
      await client.query('COMMIT');
      // 更新榜单分数
      for (const id of affectedUserIds) { await updatePlayerScore(id); }
      ok(res, {message: '已向 ' + affectedCount + ' 名用户发放 ' + amount + ' 梦币（' + skippedCount + '人已跳过）', affectedCount, skippedCount });
      return;
    }
    // 单用户发放
    if (!userId) return badRequest(res, '参数不完整');
    const updateRes = await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [amount, userId]);
    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, '用户不存在，请检查用户ID是否正确');
    }
    await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,$3,$4)", [userId, amount, amount > 0 ? 'award' : 'deduct', note || (amount > 0 ? '赛事奖励' : '梦币扣除')]);
    await client.query('COMMIT');
    // 更新榜单分数
    await updatePlayerScore(userId);
    try {
      const notifMsg = amount > 0
        ? '你获得了 ' + amount + ' 梦币！' + (note ? '备注：' + note : '')
        : '你被扣除 ' + Math.abs(amount) + ' 梦币！' + (note ? '备注：' + note : '');
      await pool.query("INSERT INTO notifications (userId, type, content) VALUES ($1,'coin_reward',$2)", [userId, notifMsg]);
    } catch(e) {}
    ok(res);
  } catch(e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '发放失败'); }
  finally { client.release(); }
});

app.get('/api/admin/coin-transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT ct.*, u.coachName, u.username FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id ORDER BY ct.created_at DESC LIMIT 200');
    res.json({ transactions: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// ====================== 选手认证系统 ======================

// 身价计算
function calcMarketValue(peakScore, gameRank) {
  const peakTable = [[2200,50],[2100,40],[2000,32],[1900,25],[1800,18],[1700,12],[1600,8],[1500,5]];
  let peakVal = 2;
  for (const [min,val] of peakTable) { if (peakScore >= min) { peakVal = val; break; } }

  let rankVal = 1;
  if (gameRank.includes('荣耀') && gameRank.includes('100')) rankVal = 45;
  else if (gameRank.includes('荣耀') && gameRank.includes('50')) rankVal = 35;
  else if (gameRank.includes('荣耀')) rankVal = 28;
  else if (gameRank.includes('王者50') || gameRank.includes('王者100')) rankVal = 22;
  else if (gameRank.includes('王者25')) rankVal = 15;
  else if (gameRank.includes('王者10')) rankVal = 10;
  else if (gameRank.includes('王者')) rankVal = 6;
  else if (gameRank.includes('星耀')) rankVal = 3;
  return Math.max(peakVal, rankVal);
}

// 等级计算（每周更新）
function calcGrade(marketValue) {
  if (marketValue >= 40) return 'S';
  if (marketValue >= 28) return 'A';
  if (marketValue >= 18) return 'B';
  return 'C';
}
const GRADE_SALARY = { S: 20000, A: 10000, B: 5000, C: 0, D: 0 };

// 选手认证申请
app.post('/api/player/apply', authMiddleware, async (req, res) => {
  const { gameId, positions, peakScore, gameRank, screenshotUrl1, screenshotUrl2 } = req.body;
  if (!gameId || !positions || peakScore === undefined || !gameRank) {
    return badRequest(res, '请填写完整的认证信息');
  }
  try {
    // 检查是否已有认证记录
    const existing = await pool.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    if (existing.rows.length > 0 && existing.rows[0].status !== 'rejected') {
      return badRequest(res, '你已有待审核或已通过的认证记录');
    }
    const marketValue = calcMarketValue(peakScore, gameRank);
    if (existing.rows.length > 0) {
      // 重新提交
      await pool.query(
        "UPDATE players SET game_id=$1,positions=$2,peak_score=$3,game_rank=$4,status='pending',market_value=$5,screenshot_url=$6,screenshot_url2=$7,reviewed_by=NULL,reviewed_at=NULL,created_at=NOW() WHERE user_id=$8",
        [gameId, JSON.stringify(positions), peakScore, gameRank, marketValue, screenshotUrl1 || null, screenshotUrl2 || null, req.userId]
      );
    } else {
      await pool.query(
        'INSERT INTO players (user_id,game_id,positions,peak_score,game_rank,status,market_value,screenshot_url,screenshot_url2) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [req.userId, gameId, JSON.stringify(positions), peakScore, gameRank, 'pending', marketValue, screenshotUrl1 || null, screenshotUrl2 || null]
      );
    }
    // 通知管理员
    try {
      await sendNotification(ADMIN_USER_ID, 'player_review', '有新的选手认证申请待审核: ' + gameId);
      console.log('[选手认证] 已通知管理员审核:', gameId);
    } catch(e) { console.error('[选手认证] 通知管理员失败:', e.message); }
    ok(res, {message: '认证申请已提交，预计24小时内审核' });
  } catch(e) {
    console.error('[选手认证] 提交失败:', e.message);
    serverError(res, '提交失败: ' + e.message);
  }
});

// 查询自己的认证状态
app.get('/api/player/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS club_name FROM players p LEFT JOIN clubs c ON p.club_id = c.id WHERE p.user_id = $1`,
      [req.userId]
    );
    const p = result.rows[0] || null;
    if (p) {
      const grade = p.grade;
      p.weekly_salary = p.custom_salary !== null && p.custom_salary !== undefined
        ? p.custom_salary
        : (GRADE_SALARY[grade] || 0);
    }
    res.json({ player: p });
  } catch(e) { serverError(res, '查询失败'); }
});

// 管理员：获取所有认证申请
app.get('/api/admin/players', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 明确排除截图字段，避免一次返回几MB base64数据
    const result = await pool.query(
      `SELECT p.id, p.user_id, p.game_id, p.positions, p.peak_score, p.game_rank,
              p.status, p.market_value, p.grade, p.club_id, p.created_at, p.reviewed_at,
              (p.screenshot_url IS NOT NULL OR p.screenshot_url2 IS NOT NULL) AS has_screenshots,
              u.username, u.coachName
       FROM players p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.status ASC, p.created_at DESC`
    );
    res.json({ players: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// 管理员：获取指定选手的截图（按需加载）
app.get('/api/admin/player-screenshots', authMiddleware, adminMiddleware, async (req, res) => {
  const { ids } = req.query; // 逗号分隔的 user_id
  if (!ids) return badRequest(res, '请提供选手ID');
  try {
    const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
    if (idList.length === 0 || idList.length > 20) return badRequest(res, '参数错误');
    const result = await pool.query(
      `SELECT user_id, screenshot_url, screenshot_url2 FROM players WHERE user_id = ANY($1)`,
      [idList]
    );
    res.json({ screenshots: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// 管理员：审核选手认证
app.post('/api/admin/player-review', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !['approved','rejected'].includes(status)) return badRequest(res, '参数错误');
  try {
    if (status === 'rejected') {
      await pool.query("UPDATE players SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE user_id=$2", [req.userId, userId]);
      return ok(res);
    }
    // 审批通过：取当前巅峰分/段位重新计算身价
    const player = await pool.query('SELECT * FROM players WHERE user_id = $1', [userId]);
    if (player.rows.length === 0) return notFound(res, '选手不存在');
    const p = player.rows[0];
    const marketValue = calcMarketValue(p.peak_score, p.game_rank);
    const grade = calcGrade(marketValue);
    await pool.query(
      "UPDATE players SET status='approved',market_value=$1,grade=$2,reviewed_by=$3,reviewed_at=NOW() WHERE user_id=$4",
      [marketValue, grade, req.userId, userId]
    );
    await updatePlayerScore(userId);
    // 认证通过 → 自动发放1000梦币（去重：同一用户不重复发放）
    const existingReward = await pool.query(
      "SELECT id FROM coin_transactions WHERE user_id=$1 AND type='cert_reward' LIMIT 1",
      [userId]
    );
    if (existingReward.rows.length === 0) {
      await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins, 0) + 1000 WHERE id = $1', [userId]);
      await pool.query(
        "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, 1000, 'cert_reward', '认证通过奖励')",
        [userId]
      );
      await sendNotification(userId, 'coin_award', '恭喜认证通过！你获得了 1000 梦币新人奖励，快去参与赛事吧！', null);
    }
    await sendNotification(userId, 'player_approved', `你的选手认证已通过！身价：${marketValue}万 等级：${grade}级 + 1000梦币奖励`);
    ok(res, {marketValue });
  } catch(e) { serverError(res, '操作失败'); }
});

// 管理员：补发已认证选手1000梦币（一次性批量操作）
app.post('/api/admin/retroactive-cert-rewards', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 查出所有已认证但未领取过认证奖励的用户
    const result = await pool.query(`
      SELECT DISTINCT p.user_id FROM players p
      WHERE p.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM coin_transactions ct
        WHERE ct.user_id = p.user_id AND ct.type = 'cert_reward'
      )
    `);
    if (result.rows.length === 0) return ok(res, {awarded: 0, message: '所有已认证选手都已领取过认证奖励'});
    let count = 0;
    for (const row of result.rows) {
      await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins, 0) + 1000 WHERE id = $1', [row.user_id]);
      await pool.query(
        "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, 1000, 'cert_reward', '认证补发奖励')",
        [row.user_id]
      );
      count++;
    }
    ok(res, {awarded: count, message: `成功为 ${count} 位已认证选手补发1000梦币`});
  } catch(e) { console.error(e); serverError(res, '操作失败'); }
});

// ====================== 转会市场 ======================
app.get('/api/market/players', authMiddleware, async (req, res) => {
  const { sort, maxValue } = req.query;
  try {
    let query = `
      SELECT p.*, u.username, u.coachName, u.heroPool, c.name AS club_name,
        COALESCE(ms.match_count, 0) AS last_match_count,
        COALESCE(ms.win_count, 0) AS last_match_win_count,
        COALESCE(ms.loss_count, 0) AS last_match_loss_count
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN clubs c ON p.club_id = c.id
      LEFT JOIN (
        SELECT mp.user_id,
          COUNT(*) FILTER (WHERE m.winner IS NOT NULL) AS match_count,
          COUNT(*) FILTER (WHERE (m.winner = 'red' AND mp.side = 'red') OR (m.winner = 'blue' AND mp.side = 'blue')) AS win_count,
          COUNT(*) FILTER (WHERE (m.winner = 'red' AND mp.side != 'red') OR (m.winner = 'blue' AND mp.side != 'blue')) AS loss_count
        FROM match_participants mp
        JOIN matches m ON mp.match_id = m.id AND m.status = 'FINISHED'
        GROUP BY mp.user_id
      ) ms ON p.user_id = ms.user_id
      WHERE p.status = 'approved'
    `;
    const params = [];
    if (maxValue) {
      params.push(parseInt(maxValue));
      query += ` AND p.market_value <= $${params.length}`;
    }
    query += ' ORDER BY ';
    if (sort === 'value') query += 'p.market_value DESC, p.created_at DESC';
    else query += 'p.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ players: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// ====================== 俱乐部系统 ======================

// 创建俱乐部（仅管理员）
app.post('/api/club/create', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, ownerId } = req.body;
  if (!name || !ownerId) return badRequest(res, '请填写俱乐部名称和老板ID');
  try {
    const existing = await pool.query('SELECT * FROM clubs WHERE name = $1', [name]);
    if (existing.rows.length > 0) return badRequest(res, '俱乐部名称已存在');
    const result = await pool.query(
      'INSERT INTO clubs (name, owner_id) VALUES ($1, $2) RETURNING id',
      [name, ownerId]
    );
    const clubId = result.rows[0].id;
    // 自动将老板加入队员名单
    await pool.query('INSERT INTO club_members (club_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [clubId, ownerId, 'boss']);
    ok(res, {clubId });
  } catch(e) { serverError(res, '创建失败'); }
});

// 管理员修改俱乐部名称
app.put('/api/admin/clubs/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return badRequest(res, '俱乐部名称不能为空');
  try {
    const existing = await pool.query('SELECT * FROM clubs WHERE name = $1 AND id != $2', [name.trim(), req.params.id]);
    if (existing.rows.length > 0) return badRequest(res, '俱乐部名称已存在');
    await pool.query('UPDATE clubs SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
    ok(res);
  } catch(e) { serverError(res, '修改失败'); }
});

// 获取所有俱乐部列表
app.get('/api/clubs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.username AS owner_username, u.coachName AS owner_name, u.gameId AS owner_game_id,
        (SELECT COUNT(*) FROM club_members WHERE club_id = c.id) AS member_count
      FROM clubs c
      LEFT JOIN users u ON c.owner_id = u.id
      ORDER BY c.id
    `);
    const memberships = await pool.query(
      'SELECT club_id, role FROM club_members WHERE user_id = $1',
      [req.userId]
    );
    ok(res, { clubs: result.rows, memberships: memberships.rows });
  } catch(e) { serverError(res, '查询俱乐部列表失败', e); }
});

// 俱乐部详情
app.get('/api/club/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const club = await pool.query(`
      SELECT c.*, u.username AS owner_username, u.coachName AS owner_name, u.gameId AS owner_game_id
      FROM clubs c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = $1
    `, [id]);
    if (club.rows.length === 0) return notFound(res, '俱乐部不存在');

    const members = await pool.query(`
      SELECT cm.*, u.username, u.coachName, u.gameid, u.gameRank, u.peakScore,
        p.market_value, p.grade
      FROM club_members cm
      LEFT JOIN users u ON cm.user_id = u.id
      LEFT JOIN players p ON cm.user_id = p.user_id
      WHERE cm.club_id = $1
      ORDER BY cm.role, cm.joined_at
    `, [id]);

    // 签约历史
    const transfers = await pool.query(`
      SELECT tr.*, u.username AS player_username, u.coachName AS player_name
      FROM transfer_records tr
      LEFT JOIN users u ON tr.player_user_id = u.id
      WHERE tr.to_club_id = $1 OR tr.from_club_id = $1
      ORDER BY tr.created_at DESC
      LIMIT 30
    `, [id]);

    // 老板（owner）不在 club_members 表中，将其加入成员列表供报名使用
    const c = club.rows[0];
    let memberList = members.rows;
    if (c.owner_id) {
      const ownerInClub = members.rows.find(m => m.user_id === c.owner_id);
      if (!ownerInClub) {
        const ownerUser = await pool.query(`
          SELECT u.id AS user_id, u.username, u.coachName, u.gameid, u.gameRank, u.peakScore,
            p.market_value, p.grade, 'boss' AS role
          FROM users u LEFT JOIN players p ON u.id = p.user_id WHERE u.id = $1
        `, [c.owner_id]);
        if (ownerUser.rows.length > 0) memberList = [ownerUser.rows[0], ...memberList];
      }
    }

    ok(res, { club: c, members: memberList, transfers: transfers.rows });
  } catch(e) { serverError(res, '查询俱乐部失败', e); }
});

// 老板管理队员（移除队员）
app.post('/api/club/:id/manage', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action, userId } = req.body;
  try {
    // 验证是否为该俱乐部老板
    const club = await pool.query('SELECT * FROM clubs WHERE id = $1', [id]);
    if (club.rows.length === 0) return notFound(res, '俱乐部不存在');
    if (club.rows[0].owner_id !== req.userId && req.userId !== ADMIN_USER_ID) {
      return forbidden(res, '仅俱乐部老板可管理');
    }
    if (action === 'remove') {
      await pool.query('DELETE FROM club_members WHERE club_id = $1 AND user_id = $2', [id, userId]);
      await pool.query('UPDATE players SET club_id = NULL WHERE user_id = $1', [userId]);
      ok(res, {message: '队员已移除' });
    } else {
      badRequest(res, '未知操作');
    }
  } catch(e) { serverError(res, '操作失败'); }
});

// ====================== 签约系统 ======================

// 签约选手（完整财务逻辑）
app.post('/api/club/sign', authMiddleware, async (req, res) => {
  const { playerUserId, clubId } = req.body;
  if (!playerUserId || !clubId) return badRequest(res, '参数不完整');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 验证选手已认证且未签约
    const player = await client.query("SELECT * FROM players WHERE user_id = $1 AND status = 'approved' FOR UPDATE", [playerUserId]);
    if (player.rows.length === 0) {
      await client.query('ROLLBACK');
      return badRequest(res, '选手未通过认证或已不可签约');
    }
    const p = player.rows[0];
    if (p.club_id) {
      await client.query('ROLLBACK');
      return badRequest(res, '该选手已签约其他俱乐部');
    }
    const feeWan = p.market_value; // 万为单位
    const fee = feeWan * 10000; // 转为梦币单位

    // 2. 验证俱乐部存在
    const club = await client.query('SELECT * FROM clubs WHERE id = $1 FOR UPDATE', [clubId]);
    if (club.rows.length === 0) {
      await client.query('ROLLBACK');
      return notFound(res, '俱乐部不存在');
    }

    // 3. 验证老板余额
    const ownerId = club.rows[0].owner_id;
    if (ownerId !== req.userId && req.userId !== ADMIN_USER_ID) {
      await client.query('ROLLBACK');
      return forbidden(res, '仅俱乐部老板可签约');
    }
    const boss = await client.query('SELECT dream_coins FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
    if (boss.rows.length === 0 || (boss.rows[0].dream_coins || 0) < fee) {
      await client.query('ROLLBACK');
      return badRequest(res, '老板余额不足，签约需 ' + feeWan + ' 万梦币（实际扣' + fee + '）');
    }

    // 4. 扣除老板梦币
    await client.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id = $2', [fee, ownerId]);
    await client.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct',$3)",
      [ownerId, -fee, '签约选手' + (p.game_id || playerUserId) + '，签约费 ' + feeWan + ' 万梦币']
    );

    // 5. 分配资金（浅梦 = 平台方 = ADMIN_USER_ID）
    const playerShare = Math.floor(fee * 0.1); // 选手得 10%
    const platformShare = fee - playerShare; // 浅梦得 90%

    // 给选手转账 10%
    await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [playerShare, playerUserId]);
    await client.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward',$3)",
      [playerUserId, playerShare, '签约转会分成10%（' + playerShare + '梦币），来自俱乐部签约费' + feeWan + '万']
    );

    // 给浅梦（管理员）转账 90%
    await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [platformShare, ADMIN_USER_ID]);
    await client.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward',$3)",
      [ADMIN_USER_ID, platformShare, '俱乐部签约平台抽成90%（' + platformShare + '梦币），选手' + (p.game_id || playerUserId) + '，签约费' + feeWan + '万']
    );

    // 6. 更新选手所属俱乐部
    await client.query('UPDATE players SET club_id = $1 WHERE user_id = $2', [clubId, playerUserId]);

    // 7. 添加选手到俱乐部
    await client.query(
      'INSERT INTO club_members (club_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (club_id,user_id) DO UPDATE SET role=$3',
      [clubId, playerUserId, 'player']
    );

    // 8. 记录转会（fee存万单位，与market_value一致）
    await client.query(
      'INSERT INTO transfer_records (player_user_id, from_club_id, to_club_id, fee, platform_fee) VALUES ($1,NULL,$2,$3,$4)',
      [playerUserId, clubId, feeWan, platformShare]
    );

    // 9. 通知
    await client.query(
      "INSERT INTO notifications (userId, type, content) VALUES ($1,'club_sign',$2)",
      [playerUserId, '你已被俱乐部签下，获得签约分成' + playerShare + '梦币（签约费' + feeWan + '万）']
    );

    await client.query('COMMIT');
    // 更新榜单分数
    await updatePlayerScore(ownerId);
    await updatePlayerScore(playerUserId);
    res.json({
      success: true,
      message: '签约成功！签约费 ' + feeWan + ' 万梦币',
      breakdown: { totalFeeWan: feeWan, totalFee: fee, playerShare, platformShare }
    });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('[签约失败]', e);
    serverError(res, '签约失败: ' + e.message);
  } finally { client.release(); }
});

// 管理员查看所有转会记录
app.get('/api/admin/transfers', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tr.*, u.username AS player_username, u.coachName AS player_name
      FROM transfer_records tr
      LEFT JOIN users u ON tr.player_user_id = u.id
      ORDER BY tr.created_at DESC
      LIMIT 50
    `);
    res.json({ transfers: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// ====================== 薪资发放 ======================
app.post('/api/admin/salary/pay', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const signed = await pool.query("SELECT p.*, c.owner_id, c.id as cid FROM players p JOIN clubs c ON p.club_id = c.id WHERE p.status='approved' AND p.club_id IS NOT NULL");
    if (signed.rows.length === 0) return res.json({ message: '暂无签约选手', totalPaid: 0 });
    // 按俱乐部老板分组
    const byOwner = {};
    for (const p of signed.rows) {
      const grade = calcGrade(p.market_value);
      const salary = GRADE_SALARY[grade] || 0;
      if (salary <= 0) continue;
      // 更新选手等级
      await pool.query('UPDATE players SET grade=$1 WHERE user_id=$2', [grade, p.user_id]);
      if (!byOwner[p.owner_id]) byOwner[p.owner_id] = { bossId: p.owner_id, clubId: p.cid, players: [], total: 0 };
      byOwner[p.owner_id].players.push({ userId: p.user_id, gameId: p.game_id, grade, salary });
      byOwner[p.owner_id].total += salary;
    }
    // 扣老板 + 发选手
    let totalPaid = 0;
    for (const [bossId, group] of Object.entries(byOwner)) {
      const boss = await pool.query('SELECT dream_coins FROM users WHERE id=$1', [bossId]);
      if ((boss.rows[0]?.dream_coins || 0) < group.total) continue; // 余额不足跳过
      await pool.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id=$2', [group.total, bossId]);
      await updatePlayerScore(bossId);
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct',$3)", [bossId, -group.total, '本周薪资支出，共' + group.players.length + '位选手']);
      for (const mp of group.players) {
        await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id=$2', [mp.salary, mp.userId]);
        await updatePlayerScore(mp.userId);
        await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward',$3)", [mp.userId, mp.salary, '周薪' + mp.grade + '级']);
        await pool.query('INSERT INTO salary_records (club_id, player_user_id, amount, grade, paid_by) VALUES ($1,$2,$3,$4,$5)', [group.clubId, mp.userId, mp.salary, mp.grade, bossId]);
        totalPaid += mp.salary;
      }
    }
    ok(res, {totalPaid, clubs: byOwner });
  } catch(e) { console.error(e); serverError(res, '发薪失败: ' + e.message); }
});

// ====================== 禁言管理 ======================
// 管理员禁言用户
app.post('/api/admin/mute', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, minutes, reason } = req.body;
    if (!userId || !minutes) return badRequest(res, '缺少参数：userId, minutes');
    const mins = parseInt(minutes);
    if (isNaN(mins) || mins <= 0 || mins > 10080) return badRequest(res, '禁言时长必须在1~10080分钟之间');

    const until = new Date(Date.now() + mins * 60000);
    await pool.query('UPDATE users SET muted_until=$1, mute_reason=$2 WHERE id=$3', [until, reason || '', userId]);

    // Socket.IO 通知被禁言用户
    if (global._io) {
      global._io.to('user_' + userId).emit('user_muted', { until: until.toISOString(), reason: reason || '', minutes: mins });
    }

    ok(res, { userId, until, minutes: mins });
  } catch(e) { serverError(res, '禁言失败', e); }
});

// 管理员解禁用户
app.delete('/api/admin/mute/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query('UPDATE users SET muted_until=NULL, mute_reason=NULL WHERE id=$1', [userId]);

    if (global._io) {
      global._io.to('user_' + userId).emit('user_unmuted', { userId });
    }

    ok(res, { userId });
  } catch(e) { serverError(res, '解禁失败', e); }
});

app.get('/api/club/:id/salary-records', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT sr.*, u.coachName FROM salary_records sr LEFT JOIN users u ON sr.player_user_id=u.id WHERE sr.club_id=$1 ORDER BY sr.paid_at DESC LIMIT 100', [req.params.id]);
    res.json({ records: result.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

// ====================== 俱乐部大名单 ======================
app.get('/api/club/:id/roster', authMiddleware, async (req, res) => {
  try {
    const elite = await pool.query("SELECT cr.*, p.game_id, p.grade, p.market_value FROM club_rosters cr LEFT JOIN players p ON cr.player_user_id=p.user_id WHERE cr.club_id=$1 AND cr.tier='elite'", [req.params.id]);
    const secondary = await pool.query("SELECT cr.*, p.game_id, p.grade, p.market_value FROM club_rosters cr LEFT JOIN players p ON cr.player_user_id=p.user_id WHERE cr.club_id=$1 AND cr.tier='secondary'", [req.params.id]);
    const free = await pool.query("SELECT cr.*, p.game_id, p.grade, p.market_value FROM club_rosters cr LEFT JOIN players p ON cr.player_user_id=p.user_id WHERE cr.club_id=$1 AND cr.tier='free'", [req.params.id]);
    res.json({ elite: elite.rows, secondary: secondary.rows, free: free.rows });
  } catch(e) { serverError(res, '查询失败'); }
});

app.put('/api/club/:id/roster', authMiddleware, async (req, res) => {
  const { tier, players, teamId } = req.body; // tier: 'elite'|'secondary'|'free', players: [{userId, teamId?}, ...] 或 [userId,...]
  try {
    if (!['elite','secondary','free'].includes(tier)) return badRequest(res, '无效联赛等级');
    // 兼容两种格式：新格式 [{userId, teamId?}] 或旧格式 [userId]
    const playerEntries = players.map(p => (typeof p === 'string' ? { userId: p, teamId: teamId || '' } : { userId: p.userId || p, teamId: p.teamId || teamId || '' }));
    // 自由名单：每支队伍最多5人（不设总人数上限）
    // elite/secondary：保持原有每等级最多5人限制
    if (!['free'].includes(tier) && playerEntries.length > 5) return badRequest(res, tier + '大名单最多5人');
    // 自由名单：按 team_id 分组校验，每组不超过5人
    if (tier === 'free') {
      const teamGroups = {};
      for (const entry of playerEntries) {
        const tid = entry.teamId || '';
        teamGroups[tid] = (teamGroups[tid] || 0) + 1;
        if (teamGroups[tid] > 5) return badRequest(res, '自由名单每支队伍最多5人（队伍：' + (tid || '默认') + '）');
      }
    }
    // 等级校验
    const gradeMap = { elite: ['S','A'], secondary: ['B','C','D'], free: [] };
    const allowedGrades = gradeMap[tier];
    for (const entry of playerEntries) {
      const uid = entry.userId;
      const cm = await pool.query('SELECT * FROM club_members WHERE club_id=$1 AND user_id=$2', [req.params.id, uid]);
      if (cm.rows.length === 0) return badRequest(res, '选手' + uid + '未签约该俱乐部');
      const role = cm.rows[0].role;
      if (role !== 'boss' && allowedGrades.length > 0) {
        const p = await pool.query('SELECT grade FROM players WHERE user_id=$1 AND status=$2', [uid, 'approved']);
        const grade = p.rows[0]?.grade;
        if (!allowedGrades.includes(grade)) {
          return badRequest(res, '选手' + uid + '等级' + (grade || '无') + '不满足' + tier + '联赛条件（需' + allowedGrades.join('/') + '级）');
        }
      }
    }
    // 删除旧记录再批量插入
    await pool.query('DELETE FROM club_rosters WHERE club_id=$1 AND tier=$2', [req.params.id, tier]);
    for (const entry of playerEntries) {
      await pool.query(
        "INSERT INTO club_rosters (club_id, tier, player_user_id, team_id) VALUES ($1,$2,$3,$4) ON CONFLICT (club_id, tier, player_user_id) DO UPDATE SET team_id=EXCLUDED.team_id",
        [req.params.id, tier, entry.userId, entry.teamId || '']
      );
    }
    ok(res);
  } catch(e) { console.error(e); serverError(res, '设置失败'); }
});

// ====================== 联赛报名校验 ======================
app.post('/api/competition/:id/register', authMiddleware, async (req, res) => {
  try {
    const comp = await pool.query('SELECT * FROM competitions WHERE id=$1', [req.params.id]);
    if (comp.rows.length === 0) return notFound(res, '赛事不存在');
    const c = comp.rows[0];
    const { clubId, playerIds } = req.body; // playerIds: 报名选手列表
    if (!clubId) return badRequest(res, '请选择俱乐部');
    // 常规赛事：需在自由大名单中
    if (c.tier === 'regular') {
      for (const uid of playerIds) {
        const roster = await pool.query("SELECT * FROM club_rosters WHERE club_id=$1 AND tier='free' AND player_user_id=$2", [clubId, uid]);
        if (roster.rows.length === 0) return badRequest(res, '选手' + uid + '不在俱乐部自由名单中（自由名单选手方可参加常规赛事）');
      }
      return ok(res, {message: '报名成功' });
    }
    // 顶级/次级联赛校验
    const allowedGrades = c.tier === 'elite' ? ['S','A'] : ['B','C','D'];
    const rosterTier = c.tier;
    for (const uid of playerIds) {
      const p = await pool.query('SELECT * FROM players WHERE user_id=$1 AND status=$2', [uid, 'approved']);
      if (p.rows.length === 0) return badRequest(res, '选手' + uid + '未通过认证');
      if (!allowedGrades.includes(p.rows[0].grade)) return badRequest(res, '选手' + uid + '等级' + p.rows[0].grade + '不满足' + c.tier + '联赛参赛条件（需' + allowedGrades.join('/') + '级）');
      const roster = await pool.query('SELECT * FROM club_rosters WHERE club_id=$1 AND tier=$2 AND player_user_id=$3', [clubId, rosterTier, uid]);
      if (roster.rows.length === 0) return badRequest(res, '选手' + uid + '不在俱乐部' + c.tier + '大名单中');
    }
    ok(res, {message: '报名成功' });
  } catch(e) { console.error(e); serverError(res, '报名失败'); }
});

// ====================== 老板调整选手身价（7天冷却） ======================
app.post('/api/club/:id/player/:userId/update', authMiddleware, async (req, res) => {
  const { id, userId } = req.params;
  const { marketValue } = req.body;
  try {
    const club = await pool.query('SELECT * FROM clubs WHERE id = $1', [id]);
    if (club.rows.length === 0) return notFound(res, '俱乐部不存在');
    if (club.rows[0].owner_id !== req.userId && req.userId !== ADMIN_USER_ID) {
      return forbidden(res, '仅俱乐部老板可调整');
    }
    const cm = await pool.query('SELECT * FROM club_members WHERE club_id=$1 AND user_id=$2', [id, userId]);
    if (cm.rows.length === 0) return badRequest(res, '该选手未签约本俱乐部');

    // 身价调整：7天冷却期检查
    if (marketValue !== undefined && marketValue !== null) {
      const mv = parseInt(marketValue);
      if (isNaN(mv) || mv < 1) return badRequest(res, '身价需为正整数');

      const recentLog = await pool.query(
        "SELECT adjusted_at FROM price_adjust_logs WHERE club_id=$1 AND player_user_id=$2 ORDER BY adjusted_at DESC LIMIT 1",
        [id, userId]
      );
      if (recentLog.rows.length > 0) {
        const lastAt = new Date(recentLog.rows[0].adjusted_at);
        const now = new Date();
        const diffMs = now - lastAt;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
          const remain = 7 - diffDays;
          return badRequest(res, '该选手身价在 ' + remain + ' 天内不可再次调整（每7天限调一次）');
        }
      }

      const player = await pool.query('SELECT market_value FROM players WHERE user_id=$1', [userId]);
      const oldValue = player.rows[0]?.market_value || 0;

      // ±20% 区间限制
      if (oldValue > 0) {
        const minMV = Math.floor(oldValue * 0.8);
        const maxMV = Math.ceil(oldValue * 1.2);
        if (mv < minMV || mv > maxMV) {
          return badRequest(res, `身价调整范围仅限 ${minMV}万 ~ ${maxMV}万（当前身价 ${oldValue}万的±20%）`);
        }
      }

      const newGrade = calcGrade(mv);

      await pool.query('UPDATE players SET market_value=$1, grade=$2 WHERE user_id=$3', [mv, newGrade, userId]);

      // 写入调价日志
      await pool.query(
        "INSERT INTO price_adjust_logs (club_id, player_user_id, old_value, new_value, adjusted_by) VALUES ($1,$2,$3,$4,$5)",
        [id, userId, oldValue, mv, req.userId]
      );

      await updatePlayerScore(userId);
      return ok(res, {message: '身价已调整为' + mv + '万'});
    }

    return badRequest(res, '无有效更新字段');
  } catch(e) { console.error(e); serverError(res, '更新失败'); }
});

// 查询选手身价调整冷却状态
app.get('/api/club/:id/player/:userId/cooldown', authMiddleware, async (req, res) => {
  try {
    const log = await pool.query(
      "SELECT adjusted_at, old_value, new_value FROM price_adjust_logs WHERE club_id=$1 AND player_user_id=$2 ORDER BY adjusted_at DESC LIMIT 1",
      [req.params.id, req.params.userId]
    );
    if (log.rows.length === 0) return ok(res, { canAdjust: true, daysLeft: 0 });
    const lastAt = new Date(log.rows[0].adjusted_at);
    const now = new Date();
    const diffMs = now - lastAt;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 7) return ok(res, { canAdjust: true, daysLeft: 0, lastAdjust: log.rows[0] });
    return ok(res, { canAdjust: false, daysLeft: 7 - diffDays, lastAdjust: log.rows[0] });
  } catch(e) { serverError(res, '查询失败'); }
});


// ====================== 解约/身价调整 ======================
app.post('/api/player/:userId/buyout', authMiddleware, async (req, res) => {
  try {
    const p = await pool.query('SELECT * FROM players WHERE user_id=$1', [req.params.userId]);
    if (p.rows.length === 0) return notFound(res, '选手不存在');
    if (p.rows[0].user_id !== req.userId) return forbidden(res, '只能自己解约');
    if (!p.rows[0].club_id) return badRequest(res, '你当前无签约俱乐部');
    const buyout = Math.floor(p.rows[0].market_value * 5000); // 身价(万)*50%*10000/10000 = market_value*5000梦币
    const user = await pool.query('SELECT dream_coins FROM users WHERE id=$1', [req.userId]);
    if ((user.rows[0]?.dream_coins || 0) < buyout) return badRequest(res, '余额不足，解约需' + buyout + '梦币');
    await pool.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id=$2', [buyout, req.userId]);
    await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct',$3)", [req.userId, -buyout, '解约费（身价' + p.rows[0].market_value + '万的50%）']);
    const oldClubId = p.rows[0].club_id;
    await pool.query('UPDATE players SET club_id=NULL, buyout_fee=$1 WHERE user_id=$2', [buyout, req.userId]);
    await pool.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [oldClubId, req.userId]);
    await pool.query('DELETE FROM club_rosters WHERE player_user_id=$1', [req.userId]);
    // 更新榜单分数
    await updatePlayerScore(req.userId);
    // 更新原俱乐部分数
    if (oldClubId) await updateClubScore(oldClubId);
    ok(res, {buyout });
  } catch(e) { console.error(e); serverError(res, '解约失败'); }
});

// ====================== 选手交易系统 ======================

// 1. 发起购买/互换请求
app.post('/api/trade/initiate', authMiddleware, async (req, res) => {
  try {
    const { player_user_id, from_club_id, to_club_id, trade_type, swap_player_user_id, price_diff } = req.body;
    if (!player_user_id || !from_club_id || !to_club_id) return badRequest(res, '参数不完整');
    if (from_club_id === to_club_id) return badRequest(res, '不能与自己俱乐部交易');
    // 校验发起人是否是目标俱乐部老板
    const toClub = await pool.query('SELECT * FROM clubs WHERE id=$1', [to_club_id]);
    if (toClub.rows.length === 0) return notFound(res, '目标俱乐部不存在');
    if (toClub.rows[0].owner_id !== req.userId) return forbidden(res, '只有俱乐部老板可以发起交易');
    // 校验选手是否已签约且该俱乐部
    const player = await pool.query('SELECT * FROM players WHERE user_id=$1', [player_user_id]);
    if (player.rows.length === 0) return notFound(res, '选手不存在');
    if (player.rows[0].club_id != from_club_id) return badRequest(res, '选手不在源俱乐部');
    if (player.rows[0].trade_status === 'pending_trade') return badRequest(res, '选手已在交易中');
    // 校验源俱乐部存在
    const fromClub = await pool.query('SELECT * FROM clubs WHERE id=$1', [from_club_id]);
    if (fromClub.rows.length === 0) return notFound(res, '源俱乐部不存在');
    // 如果是互换，校验互换选手是否在目标俱乐部
    if (trade_type === 'swap' && swap_player_user_id) {
      const swapP = await pool.query('SELECT * FROM players WHERE user_id=$1', [swap_player_user_id]);
      if (swapP.rows.length === 0) return notFound(res, '互换选手不存在');
      if (swapP.rows[0].club_id != to_club_id) return badRequest(res, '互换选手不在你的俱乐部');
    }
    // 计算差价（如果是购买，price_diff = 选手身价*10000；如果是互换，price_diff由前端计算传入）
    let finalPriceDiff = 0;
    if (trade_type === 'buy') {
      finalPriceDiff = (player.rows[0].market_value || 0) * 10000;
    } else {
      finalPriceDiff = Math.abs(parseInt(price_diff) || 0);
    }
    // 检查目标俱乐部老板余额是否足够支付差价
    const owner = await pool.query('SELECT dream_coins FROM users WHERE id=$1', [req.userId]);
    if ((owner.rows[0]?.dream_coins || 0) < finalPriceDiff) return badRequest(res, '余额不足，需支付差价' + finalPriceDiff + '梦币');
    // 源俱乐部老板（接收方）
    const fromClubOwner = fromClub.rows[0].owner_id;
    // 创建交易记录
    const result = await pool.query(`INSERT INTO player_trades
      (player_user_id, from_club_id, to_club_id, trade_type, swap_player_user_id, price_diff, status, initiated_by, initiated_club_id, initiator_id, recipient_id)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8, $9, $10) RETURNING id`,
      [player_user_id, from_club_id, to_club_id, trade_type || 'buy', swap_player_user_id || null, finalPriceDiff, req.userId, to_club_id, req.userId, fromClubOwner]);
    // 标记选手交易中
    await pool.query("UPDATE players SET trade_status='pending_trade' WHERE user_id=$1", [player_user_id]);
    if (trade_type === 'swap' && swap_player_user_id) {
      await pool.query("UPDATE players SET trade_status='pending_trade' WHERE user_id=$1", [swap_player_user_id]);
    }
    ok(res, { tradeId: result.rows[0].id, price_diff: finalPriceDiff });
  } catch(e) { console.error(e); serverError(res, '发起交易失败'); }
});

// 2. 接受交易
app.post('/api/trade/:id/accept', authMiddleware, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const trade = await pool.query('SELECT * FROM player_trades WHERE id=$1', [tradeId]);
    if (trade.rows.length === 0) return notFound(res, '交易不存在');
    if (trade.rows[0].status !== 'pending') return badRequest(res, '交易已处理');
    // 校验接受人是否是源俱乐部老板
    const fromClub = await pool.query('SELECT * FROM clubs WHERE id=$1', [trade.rows[0].from_club_id]);
    if (fromClub.rows.length === 0) return notFound(res, '源俱乐部不存在');
    if (fromClub.rows[0].owner_id !== req.userId) return forbidden(res, '只有源俱乐部老板可以接受交易');
    const t = trade.rows[0];
    const priceDiff = t.price_diff || 0;
    // 转账差价：从数据库读取动态比例
    // swap(互换) 和 buy(买入/转会) 都是俱乐部间交易，使用 transfer 比例
    const ratioType = ['swap', 'buy'].includes(t.trade_type) ? 'transfer' : 'purchase';
    const ratioResult = await pool.query('SELECT * FROM transaction_ratios WHERE type=$1', [ratioType]);
    const _defaults = ratioType === 'transfer'
      ? { player_ratio: 10, club_ratio: 40, admin_ratio: 50 }
      : { player_ratio: 10, club_ratio: 0, admin_ratio: 90 };
    const ratios = ratioResult.rows[0] || _defaults;
    const playerRatio = parseFloat(ratios.player_ratio) / 100;
    const clubRatio = parseFloat(ratios.club_ratio || 0) / 100;
    const adminRatio = parseFloat(ratios.admin_ratio) / 100;
    if (priceDiff > 0) {
      const platformFee = Math.floor(priceDiff * adminRatio);
      const clubFee = Math.floor(priceDiff * clubRatio);
      const playerFee = priceDiff - platformFee - clubFee;
      // 目标俱乐部老板扣款
      await pool.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id=$2', [priceDiff, t.initiated_by]);
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'trade','选手交易支付差价')", [t.initiated_by, -priceDiff]);
      // 平台收入（管理员）
      await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id=$2', [platformFee, 'mp4hmya7ad15v6']);
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'trade','平台交易手续费')", ['mp4hmya7ad15v6', platformFee]);
      // 俱乐部收入（如果是转会，俱乐部获得部分；采买则俱乐部部分为0）
      if (clubFee > 0) {
        const origBossId = fromClub.rows[0].owner_id;
        await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id=$2', [clubFee, origBossId]);
        await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'trade','俱乐部交易分成')", [origBossId, clubFee]);
      }
      // 选手收入
      await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id=$2', [playerFee, t.player_user_id]);
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'trade','选手交易分成')", [t.player_user_id, playerFee]);
    }
    // 更新选手俱乐部
    await pool.query('UPDATE players SET club_id=$1, trade_status=NULL WHERE user_id=$2', [t.to_club_id, t.player_user_id]);
    await pool.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [t.from_club_id, t.player_user_id]);
    await pool.query('INSERT INTO club_members (club_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.to_club_id, t.player_user_id, 'member']);
    // 如果是互换， also 更新互换选手
    if (t.trade_type === 'swap' && t.swap_player_user_id) {
      await pool.query('UPDATE players SET club_id=$1, trade_status=NULL WHERE user_id=$2', [t.from_club_id, t.swap_player_user_id]);
      await pool.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [t.to_club_id, t.swap_player_user_id]);
      await pool.query('INSERT INTO club_members (club_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.from_club_id, t.swap_player_user_id, 'member']);
    }
    // 更新大名单（如果有）
    await pool.query('DELETE FROM club_rosters WHERE player_user_id=$1', [t.player_user_id]);
    await pool.query('INSERT INTO club_rosters (club_id, tier, player_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.to_club_id, 'regular', t.player_user_id]);
    if (t.trade_type === 'swap' && t.swap_player_user_id) {
      await pool.query('DELETE FROM club_rosters WHERE player_user_id=$1', [t.swap_player_user_id]);
      await pool.query('INSERT INTO club_rosters (club_id, tier, player_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.from_club_id, 'regular', t.swap_player_user_id]);
    }
    // 更新交易状态
    await pool.query("UPDATE player_trades SET status='accepted', accepted_by=$1, updated_at=NOW() WHERE id=$2", [req.userId, tradeId]);
    // 清除选手交易状态
    await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [t.player_user_id]);
    if (t.trade_type === 'swap' && t.swap_player_user_id) {
      await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [t.swap_player_user_id]);
    }
    // 更新榜单分数
    await updatePlayerScore(t.player_user_id);
    if (t.trade_type === 'swap' && t.swap_player_user_id) {
      await updatePlayerScore(t.swap_player_user_id);
    }
    ok(res, { success: true });
  } catch(e) { console.error(e); serverError(res, '接受交易失败'); }
});

// 3. 拒绝交易
app.post('/api/trade/:id/reject', authMiddleware, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const trade = await pool.query('SELECT * FROM player_trades WHERE id=$1', [tradeId]);
    if (trade.rows.length === 0) return notFound(res, '交易不存在');
    if (trade.rows[0].status !== 'pending') return badRequest(res, '交易已处理');
    // 校验拒绝人是否是源俱乐部老板
    const fromClub = await pool.query('SELECT * FROM clubs WHERE id=$1', [trade.rows[0].from_club_id]);
    if (fromClub.rows[0]?.owner_id !== req.userId) return forbidden(res, '只有源俱乐部老板可以拒绝交易');
    await pool.query("UPDATE player_trades SET status='rejected', accepted_by=$1, updated_at=NOW() WHERE id=$2", [req.userId, tradeId]);
    // 清除选手交易状态
    await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [trade.rows[0].player_user_id]);
    if (trade.rows[0].swap_player_user_id) {
      await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [trade.rows[0].swap_player_user_id]);
    }
    ok(res, { success: true });
  } catch(e) { console.error(e); serverError(res, '拒绝交易失败'); }
});

// 4. 取消交易（发起人撤回）
app.post('/api/trade/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const trade = await pool.query('SELECT * FROM player_trades WHERE id=$1', [tradeId]);
    if (trade.rows.length === 0) return notFound(res, '交易不存在');
    if (trade.rows[0].status !== 'pending') return badRequest(res, '交易已处理');
    if (trade.rows[0].initiated_by !== req.userId) return forbidden(res, '只有发起人可以取消交易');
    await pool.query("UPDATE player_trades SET status='cancelled', updated_at=NOW() WHERE id=$1", [tradeId]);
    // 清除选手交易状态
    await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [trade.rows[0].player_user_id]);
    if (trade.rows[0].swap_player_user_id) {
      await pool.query("UPDATE players SET trade_status=NULL WHERE user_id=$1", [trade.rows[0].swap_player_user_id]);
    }
    ok(res, { success: true });
  } catch(e) { console.error(e); serverError(res, '取消交易失败'); }
});

// 5. 我的交易列表（支持 clubId 参数过滤指定俱乐部的交易）
app.get('/api/trades', authMiddleware, async (req, res) => {
  try {
    const filterClubId = req.query.clubId ? parseInt(req.query.clubId) : null;
    if (filterClubId) {
      // 校验当前用户是否有权限查看该俱乐部的交易（俱乐部老板或管理员）
      const club = await pool.query('SELECT * FROM clubs WHERE id=$1', [filterClubId]);
      if (club.rows.length === 0) return notFound(res, '俱乐部不存在');
      if (club.rows[0].owner_id !== req.userId && req.userId !== ADMIN_USER_ID) return forbidden(res, '无权限查看该俱乐部交易记录');
      const result = await pool.query(`SELECT t.*, p.game_id as player_name, p.market_value, fc.name as from_club_name, tc.name as to_club_name,
        u1.username as initiated_name, u2.username as accepted_name
        FROM player_trades t
        LEFT JOIN players p ON t.player_user_id=p.user_id
        LEFT JOIN clubs fc ON t.from_club_id=fc.id
        LEFT JOIN clubs tc ON t.to_club_id=tc.id
        LEFT JOIN users u1 ON t.initiated_by=u1.id
        LEFT JOIN users u2 ON t.accepted_by=u2.id
        WHERE t.from_club_id=$1 OR t.to_club_id=$1
        ORDER BY t.created_at DESC LIMIT 50`, [filterClubId]);
      return ok(res, { trades: result.rows });
    }
    // 原有逻辑：查询与当前用户相关的交易
    const myClubs = await pool.query('SELECT id FROM clubs WHERE owner_id=$1', [req.userId]);
    const clubIds = myClubs.rows.map(c => c.id);
    let query = 'SELECT t.*, p.game_id as player_name, fc.name as from_club_name, tc.name as to_club_name FROM player_trades t LEFT JOIN players p ON t.player_user_id=p.user_id LEFT JOIN clubs fc ON t.from_club_id=fc.id LEFT JOIN clubs tc ON t.to_club_id=tc.id WHERE t.initiated_by=$1';
    let params = [req.userId];
    if (clubIds.length > 0) {
      query += ' OR t.from_club_id IN (' + clubIds.map((_,i) => '$'+(i+2)).join(',') + ') OR t.to_club_id IN (' + clubIds.map((_,i) => '$'+(i+2+clubIds.length)).join(',') + ')';
      params = [req.userId, ...clubIds, ...clubIds];
    }
    query += ' ORDER BY t.created_at DESC LIMIT 50';
    const result = await pool.query(query, params);
    ok(res, { trades: result.rows });
  } catch(e) { console.error(e); serverError(res, '获取交易列表失败'); }
});

// 6. 交易详情
app.get('/api/trade/:id', authMiddleware, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const result = await pool.query(`SELECT t.*, p.game_id as player_name, p.market_value, fc.name as from_club_name, tc.name as to_club_name,
      u1.username as initiated_name, u2.username as accepted_name
      FROM player_trades t
      LEFT JOIN players p ON t.player_user_id=p.user_id
      LEFT JOIN clubs fc ON t.from_club_id=fc.id
      LEFT JOIN clubs tc ON t.to_club_id=tc.id
      LEFT JOIN users u1 ON t.initiated_by=u1.id
      LEFT JOIN users u2 ON t.accepted_by=u2.id
      WHERE t.id=$1`, [tradeId]);
    if (result.rows.length === 0) return notFound(res, '交易不存在');
    ok(res, { trade: result.rows[0] });
  } catch(e) { console.error(e); serverError(res, '获取交易详情失败'); }
});



require('./leaderboard.js')(app, pool, authMiddleware, ok, badRequest, serverError);

// ==================== 健康检查接口（放在所有路由之后）====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 备用健康检查（Railway 需要）
app.get('/up', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

async function startServer() {
  try {
    await initDB();
    console.log("✅ 数据库初始化完成");

    // 等待连接池就绪
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log("✅ 数据库连接池就绪");

    // 创建 HTTP 服务器并集成 Socket.IO
    const server = http.createServer(app);
    const io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      path: '/socket.io'
    });

    // 将 io 实例存到全局变量，供 API 路由使用
    global._io = io;

    // Socket.IO 事件处理
    io.on('connection', (socket) => {
      console.log('[Socket.IO] 新连接:', socket.id);
      let authenticatedUserId = null;

      // 认证：传入 token 验证身份
      socket.on('authenticate', (token) => {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          authenticatedUserId = payload.userId;
          socket.userId = authenticatedUserId;
          socket.join('user_' + authenticatedUserId);
          console.log('[Socket.IO] 用户已认证:', authenticatedUserId);
          socket.emit('authenticated', { userId: authenticatedUserId });
        } catch (e) {
          socket.emit('auth_error', { message: '认证失败' });
        }
      });

      // 加入聊天室
      socket.on('join_room', (data) => {
        if (!socket.userId) {
          socket.emit('error', { message: '请先认证' });
          return;
        }
        const { type, team_id, club_id } = data;
        if (type === 'team' && team_id) {
          socket.join('team_' + team_id);
          console.log('[Socket.IO] 用户', socket.userId, '加入队伍聊天室:', team_id);
        } else if (type === 'club' && club_id) {
          socket.join('club_' + club_id);
          console.log('[Socket.IO] 用户', socket.userId, '加入俱乐部聊天室:', club_id);
        } else if (type === 'public') {
          socket.join('public');
          console.log('[Socket.IO] 用户', socket.userId, '加入公聊室');
        }
      });

      // 离开聊天室
      socket.on('leave_room', (data) => {
        const { type, team_id, club_id } = data;
        if (type === 'team' && team_id) {
          socket.leave('team_' + team_id);
        } else if (type === 'club' && club_id) {
          socket.leave('club_' + club_id);
        } else if (type === 'public') {
          socket.leave('public');
        }
      });

      socket.on('disconnect', () => {
        console.log('[Socket.IO] 断开连接:', socket.id);
      });

      // ===== 赛事系统重构：轻量 Socket 同步 =====
      // 前端调用：socket.emit('match:create', matchData)
      socket.on('match:create', async (data) => {
        if (!socket.userId) return socket.emit('error', { message: '请先认证' });
        try {
          // 创建比赛（复用 routes/matches.js 的逻辑，这里简化）
          const { title, mode = 'training' } = data;
          const id = require('crypto').randomUUID();
          const result = await pool.query(`
            INSERT INTO matches (id, title, mode, status, created_by, created_at, updated_at)
            VALUES ($1,$2,$3,'CREATED',$4,NOW(),NOW())
            RETURNING *;
          `, [id, title, mode, socket.userId]);
          const match = result.rows[0];
          // 广播：所有人收到新比赛通知
          io.emit('matchCreated', match);
          socket.emit('match:create:success', match);
        } catch (e) {
          console.error('[Socket] match:create', e);
          socket.emit('match:create:error', { message: '创建失败' });
        }
      });

      // 前端调用：socket.emit('match:update', { matchId, updates })
      socket.on('match:update', async (data) => {
        if (!socket.userId) return socket.emit('error', { message: '请先认证' });
        try {
          const { matchId, updates } = data;
          if (!matchId || !updates) return socket.emit('match:update:error', { message: '参数错误' });

          // ✅ 先查当前状态，校验状态机
          const current = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
          if (current.rows.length === 0) return socket.emit('match:update:error', { message: '比赛不存在' });

          const currentStatus = current.rows[0].status;
          const newStatus = updates.status?.toUpperCase();

          // ✅ 如果有状态变更，校验状态机
          if (newStatus && newStatus !== currentStatus) {
            if (!isValidTransition(currentStatus, newStatus)) {
              const nextStates = getNextStates(currentStatus).join(', ') || '无（终态）';
              return socket.emit('match:update:error', {
                message: `非法状态转换：${currentStatus} → ${newStatus}。允许转换：${nextStates}`
              });
            }
          }

          const fields = [];
          const params = [];
          let idx = 0;
          if (updates.status) { fields.push(`status = $${++idx}`); params.push(updates.status); }
          if (updates.winner !== undefined) { fields.push(`winner = $${++idx}`); params.push(updates.winner); }
          if (updates.score) { fields.push(`score = $${++idx}`); params.push(JSON.stringify(updates.score)); }
          if (updates.mvp_id) { fields.push(`mvp_id = $${++idx}`); params.push(updates.mvp_id); }
          if (fields.length === 0) return socket.emit('match:update:error', { message: '没有要更新的字段' });

          params.push(matchId, currentStatus);
          const result = await pool.query(`
            UPDATE matches SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${params.length - 1} AND status = $${params.length}
            RETURNING *;
          `, params);
          if (result.rows.length === 0) return socket.emit('match:update:error', { message: '状态已变更，请刷新重试' });

          const match = result.rows[0];
          io.emit('matchUpdated', { success: true, match });
          // 特定状态转换事件
          if (newStatus === 'LIVE') io.emit('matchStarted', { success: true, match });
          if (newStatus === 'FINISHED') io.emit('matchFinished', { success: true, match });
          socket.emit('match:update:success', { success: true, match });
        } catch (e) {
          console.error('[Socket] match:update', e);
          socket.emit('match:update:error', { message: '更新失败：' + e.message });
        }
      });

      // 前端调用：socket.emit('match:score', { matchId, score, mvp_id })
      socket.on('match:score', async (data) => {
        if (!socket.userId) return socket.emit('error', { message: '请先认证' });
        try {
          const { matchId, score, mvp_id } = data;
          if (!matchId) return socket.emit('match:score:error', { message: 'matchId 必填' });

          // ✅ 只允许 LIVE 状态的比赛更新比分
          const current = await pool.query('SELECT * FROM matches WHERE id = $1 AND status = $2', [matchId, 'LIVE']);
          if (current.rows.length === 0) {
            return socket.emit('match:score:error', { message: '比赛不存在或非 LIVE 状态' });
          }

          const fields = [];
          const params = [matchId];
          let idx = 1;
          if (score) { fields.push(`score = $${++idx}`); params.splice(idx - 1, 0, JSON.stringify(score)); }
          if (mvp_id) { fields.push(`mvp_id = $${++idx}`); params.push(mvp_id); }
          if (fields.length === 0) return socket.emit('match:score:error', { message: '没有要更新的字段' });

          const result = await pool.query(`
            UPDATE matches SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $1 AND status = 'LIVE'
            RETURNING *;
          `, params);

          if (result.rows.length === 0) return socket.emit('match:score:error', { message: '更新失败' });

          const match = result.rows[0];
          io.emit('scoreUpdated', { success: true, matchId, score, mvp_id });
          socket.emit('match:score:success', { success: true, match });
        } catch (e) {
          console.error('[Socket] match:score', e);
          socket.emit('match:score:error', { message: '更新比分失败：' + e.message });
        }
      });
      // ===== 结束赛事 Socket 同步 =====

      // ===== Timeline 实时同步（为未来功能预留）=====
      // 前端调用：socket.emit('timeline:add', { matchId, type, team, player_id, player_name, text, data })
      socket.on('timeline:add', async (data) => {
        if (!socket.userId) return socket.emit('error', { message: '请先认证' });
        try {
          const { matchId, type, team, player_id, player_name, text, data = {} } = data;
          if (!matchId || !type || !text) {
            return socket.emit('timeline:add:error', { message: 'matchId, type, text 必填' });
          }

          // 权限：只有管理员或比赛创建者可以添加事件
          const match = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
          if (match.rows.length === 0) {
            return socket.emit('timeline:add:error', { message: '比赛不存在' });
          }
          const isAdmin = socket.userId === (process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6');
          if (!isAdmin && match.rows[0].created_by !== socket.userId) {
            return socket.emit('timeline:add:error', { message: '无权限' });
          }

          const result = await pool.query(`
            INSERT INTO match_timeline (match_id, type, team, player_id, player_name, text, data, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $8, NOW())
            RETURNING *;
          `, [matchId, type, team, player_id, player_name, text, JSON.stringify(data)]);

          const event = result.rows[0];

          // 广播：所有人收到新事件（实时播报）
          io.emit('timelineAdded', { success: true, matchId, event });

          socket.emit('timeline:add:success', { success: true, event });
        } catch (e) {
          console.error('[Socket] timeline:add', e);
          socket.emit('timeline:add:error', { message: '添加事件失败：' + e.message });
        }
      });

      // 前端调用：socket.emit('timeline:list', { matchId, limit, offset })
      socket.on('timeline:list', async (data) => {
        try {
          const { matchId, limit = 50, offset = 0 } = data;
          if (!matchId) return socket.emit('timeline:list:error', { message: 'matchId 必填' });

          const result = await pool.query(
            'SELECT * FROM match_timeline WHERE match_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
            [matchId, parseInt(limit), parseInt(offset)]
          );

          socket.emit('timeline:list:success', { success: true, matchId, timeline: result.rows });
        } catch (e) {
          console.error('[Socket] timeline:list', e);
          socket.emit('timeline:list:error', { message: '查询失败：' + e.message });
        }
      });
      // ===== 结束 Timeline Socket 同步 =====

    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 服务启动成功，端口: ${PORT}`);
      console.log(`📝 健康检查: http://localhost:${PORT}/health`);
      console.log(`💬 Socket.IO: http://localhost:${PORT}/socket.io`);
    });
  } catch (e) {
    console.error("❌ 服务启动失败:", e.message);
    process.exit(1);
  }

  // 赛事状态自动转换：每分钟检查
  setInterval(async () => {
    try {
      const now = new Date();
      // 即将开始的赛事 → 如果报名<10人，取消；否则进入 live
      const upcoming = await pool.query("SELECT * FROM competitions WHERE comp_status IN ('upcoming','open','locked')");
      for (const c of upcoming.rows) {
        if (!c.start_time) continue;
        const startAt = new Date(c.start_time);
        if (startAt <= now) {
          const regs = await pool.query("SELECT COUNT(*) FROM competition_registrations WHERE competition_id = $1 AND status = 'confirmed'", [c.id]);
          const count = parseInt(regs.rows[0].count);
          if (count < 10) {
            // 取消赛事，退费
            await pool.query("UPDATE competitions SET comp_status = 'cancelled' WHERE id = $1", [c.id]);
            const paid = await pool.query("SELECT player_user_id, entry_fee FROM competition_registrations WHERE competition_id = $1 AND entry_fee > 0 AND status = 'confirmed'", [c.id]);
            for (const p of paid.rows) {
              await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [p.entry_fee, p.player_user_id]);
              await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'refund','赛事报名不足10人取消退费')", [p.player_user_id, p.entry_fee]);
            }
            console.log(`[赛事] ${c.id} 报名不足10人，已取消并退费`);
          } else {
            await pool.query("UPDATE competitions SET comp_status = 'live' WHERE id = $1", [c.id]);
            console.log(`[赛事] ${c.id} 已开始`);
          }
        }
      }
      // 开赛20分钟后的赛事 → 可上传截图
      const live = await pool.query("SELECT * FROM competitions WHERE comp_status = 'live'");
      for (const c of live.rows) {
        if (!c.start_time) continue;
        const startAt = new Date(c.start_time);
        const reviewTime = new Date(startAt.getTime() + 20 * 60 * 1000);
        if (now >= reviewTime) {
          await pool.query("UPDATE competitions SET comp_status = 'review' WHERE id = $1", [c.id]);
          console.log(`[赛事] ${c.id} 进入赛后审核阶段`);
        }
      }
    } catch(e) { console.error('[赛事自动转换]', e.message); }
  }, 60 * 1000);
}

// 测试时导出 app/pool/io，不启动服务器
if (require.main === module) {
  startServer();
} else {
  module.exports = {
    app,
    pool,
    io: () => io, // 延迟导出（io 在 startServer 后初始化）
    transitionMatchStatus,
    MATCH_STATUS: MATCH_STATUS
  };
}
