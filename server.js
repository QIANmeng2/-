const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// deploy trigger
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
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
    // 赛事分级
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'regular'");
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL");
    // 选手等级 + 解约
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS grade TEXT DEFAULT NULL');
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS buyout_fee INTEGER DEFAULT NULL');
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS custom_salary INTEGER DEFAULT NULL');
    await client.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS trade_status TEXT DEFAULT NULL");
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
    `);
    // 俱乐部大名单（顶级/次级各≤5人）
    await client.query(`
      CREATE TABLE IF NOT EXISTS club_rosters (
        id SERIAL PRIMARY KEY,
        club_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        player_user_id TEXT NOT NULL,
        UNIQUE(club_id, tier, player_user_id)
      );
    `);
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
        confirmed_by TEXT,
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } finally { client.release(); }
}

// 万能跨域
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// 健康检查
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

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
    await pool.query('INSERT INTO users (id, username, password, teamName, coachName, wechat, level, bio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, username, hashed, '', coachName, wechat, level || '大众', bio || '']);
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName: '', coachName, wechat, level: level || '大众', bio: bio || '', disabledDates: [], gameId: '', gameServer: '手Q区', gameRank: '星耀', peakScore: 0, laneStats: '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: '' } });
  } catch (e) { serverError(res, '注册失败'); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password)) return badRequest(res, '用户名或密码错误');
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamname, coachName: user.coachname, wechat: user.wechat, level: user.level, bio: user.bio, disabledDates: user.disableddates || [], gameId: user.gameid || '', gameServer: user.gameserver || '手Q区', gameRank: user.gamerank || '星耀', peakScore: user.peakscore || 0, laneStats: user.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: user.heropool || '', dream_coins: user.dream_coins || 0 } });
  } catch (e) { serverError(res, '登录失败'); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return notFound(res, '用户不存在');
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, bio: u.bio, disabledDates: u.disableddates || [], gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀', peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: u.heropool || '', dream_coins: u.dream_coins || 0 } });
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
        heroPool: u.heropool || '', wechat: u.wechat || ''
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

// 管理员仪表盘统计
app.get('/api/admin/dashboard', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const teamsCount = await pool.query('SELECT COUNT(*) FROM teams');
    res.json({
      stats: {
        totalUsers: parseInt(usersCount.rows[0].count),
        totalTeams: parseInt(teamsCount.rows[0].count)
      }
    });
  } catch (e) { console.error(e); serverError(res, '加载失败'); }
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
        return { userId: m.userid, role: m.role, joinedAt: m.joinedat, username: u.username, teamName: u.teamname, coachName: u.coachname, level: u.level };
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
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level, gameRank, peakScore, heroPool FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });

    const memberList = members.rows.map(m => {
      const u = userMap[m.userid] || {};
      return {
        userId: m.userid, role: m.role, joinedAt: m.joinedat,
        username: u.username, coachName: u.coachname, level: u.level,
        gameRank: u.gamerank, peakScore: u.peakscore, heroPool: u.heropool
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
    const usersRes = await pool.query('SELECT id, username, teamName, coachName, level, gameRank, peakScore, heroPool FROM users WHERE id = ANY($1)', [userIds]);
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u; });

    const memberList = members.rows.map(m => {
      const u = userMap[m.userid] || {};
      return { userId: m.userid, role: m.role, joinedAt: m.joinedat, username: u.username, coachName: u.coachname, level: u.level, gameRank: u.gamerank, peakScore: u.peakscore, heroPool: u.heropool };
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
      regular: all.filter(c => c.tier === 'regular'),
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
    // 房间容量检查（常规赛事固定10人上限，擂台赛无限制）
    if (c.tier !== 'arena') {
      const countRes = await client.query(
        'SELECT COUNT(*) FROM competition_registrations WHERE competition_id = $1 AND status != $2',
        [req.params.id, 'cancelled']
      );
      const currentCount = parseInt(countRes.rows[0].count);
      if (currentCount >= 10) { await client.query('ROLLBACK'); return badRequest(res, '房间已满（10人上限）'); }
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
        const notifyText = c.tier === 'arena'
          ? `你被${isClub?'老板':'队长'}选入擂台赛「${c.name}」，请进入比赛页确认入场`
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
      SELECT r.*, u.coachName, u.username, u.teamName
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
    const isArena = c.tier === 'arena';
    // 直接查找该用户的报名记录（队长已指定队员+位置）
    const reg = await client.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND player_user_id = $2 AND status = 'reserved'",
      [req.params.id, req.userId]
    );
    if (reg.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到你的报名记录'); }
    if (!isArena) {
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
      [isArena ? 0 : (entry_fee || 0), reg.rows[0].id]
    );
    // 检查是否10人全部确认（仅常规赛事）
    if (!isArena) {
      const confirmed = await client.query(
        "SELECT COUNT(*) FROM competition_registrations WHERE competition_id = $1 AND status = 'confirmed'",
        [req.params.id]
      );
      if (parseInt(confirmed.rows[0].count) >= 10) {
        await client.query("UPDATE competitions SET comp_status = 'locked' WHERE id = $1", [req.params.id]);
      }
    }
    await client.query('COMMIT');
    ok(res, { entry_fee: isArena ? 0 : entry_fee });
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
  const { winner, screenshots, players } = req.body;
  if (!winner || !screenshots || !players) return badRequest(res, '参数不完整');
  try {
    await pool.query(
      'INSERT INTO competition_results (competition_id, winner, screenshot_urls, player_data) VALUES ($1,$2,$3,$4)',
      [req.params.id, winner, JSON.stringify(screenshots), JSON.stringify(players)]
    );
    await pool.query("UPDATE competitions SET comp_status = 'review' WHERE id = $1", [req.params.id]);
    ok(res, {message: '结果已提交，等待管理员审核' });
  } catch(e) { console.error(e); serverError(res, '提交失败'); }
});

// 管理员确认结果并发放奖池
app.post('/api/admin/competitions/:id/confirm-result', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 获取所有已确认的报名
    const regs = await client.query(
      "SELECT * FROM competition_registrations WHERE competition_id = $1 AND status = 'confirmed'",
      [req.params.id]
    );
    if (regs.rows.length < 10) { await client.query('ROLLBACK'); return badRequest(res, '报名不足10人'); }
    // 获取结果
    const result = await client.query('SELECT * FROM competition_results WHERE competition_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.id]);
    if (result.rows.length === 0) { await client.query('ROLLBACK'); return badRequest(res, '未找到比赛结果'); }
    const r = result.rows[0];
    // 计算奖池
    const totalPool = regs.rows.reduce((sum, x) => sum + x.entry_fee, 0);
    // 根据 winner 和 players 数据判定胜负
    const playerData = r.player_data || [];
    const winners = playerData.filter(p => p.team === r.winner && p.win);
    const winnerIds = new Set(winners.map(p => p.player_user_id));
    // 胜方总入场费
    const winnerFees = regs.rows.filter(x => winnerIds.has(x.player_user_id));
    const winnerTotalFee = winnerFees.reduce((sum, x) => sum + x.entry_fee, 0);
    // 按占比分配
    for (const w of winnerFees) {
      const share = Math.round(totalPool * (w.entry_fee / winnerTotalFee));
      await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [share, w.player_user_id]);
      await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward','赛事奖励')", [w.player_user_id, share]);
    }
    // 写入玩家统计
    for (const p of playerData) {
      await client.query(
        'INSERT INTO competition_player_stats (competition_id, player_user_id, team, lane, kda, win) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, p.player_user_id, p.team, p.lane, p.kda || '', p.win || false]
      );
    }
    // 更新状态
    await client.query('UPDATE competition_results SET confirmed_by = $1, confirmed_at = NOW() WHERE id = $2', [req.userId, r.id]);
    await client.query("UPDATE competitions SET comp_status = 'finished' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    ok(res, {totalPool, winnerCount: winnerFees.length });
  } catch(e) { await client.query('ROLLBACK'); console.error(e); serverError(res, '结算失败'); } finally { client.release(); }
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
    await sendNotification(userId, 'player_approved', `你的选手认证已通过！身价：${marketValue}万 等级：${grade}级`);
    ok(res, {marketValue });
  } catch(e) { serverError(res, '操作失败'); }
});

// ====================== 转会市场 ======================
app.get('/api/market/players', authMiddleware, async (req, res) => {
  const { sort, maxValue } = req.query;
  try {
    let query = `
      SELECT p.*, u.username, u.coachName, u.heroPool, c.name AS club_name
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN clubs c ON p.club_id = c.id
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
      SELECT c.*, u.username AS owner_username, u.coachName AS owner_name,
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
      SELECT c.*, u.username AS owner_username, u.coachName AS owner_name
      FROM clubs c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = $1
    `, [id]);
    if (club.rows.length === 0) return notFound(res, '俱乐部不存在');

    const members = await pool.query(`
      SELECT cm.*, u.username, u.coachName, u.gameId, u.gameRank, u.peakScore,
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
          SELECT u.id AS user_id, u.username, u.coachName, u.gameId, u.gameRank, u.peakScore,
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
  const { tier, players } = req.body; // tier: 'elite'|'secondary'|'free', players: [userId,...]
  try {
    if (!['elite','secondary','free'].includes(tier)) return badRequest(res, '无效联赛等级');
    if (!Array.isArray(players) || players.length > 5) return badRequest(res, '大名单最多5人');
    // elite: S/A级，secondary: B/C/D级，free: 不限等级（老板不受限）
    const gradeMap = { elite: ['S','A'], secondary: ['B','C','D'], free: [] };
    const allowedGrades = gradeMap[tier];
    for (const uid of players) {
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
    await pool.query('DELETE FROM club_rosters WHERE club_id=$1 AND tier=$2', [req.params.id, tier]);
    for (const uid of players) {
      await pool.query('INSERT INTO club_rosters (club_id, tier, player_user_id) VALUES ($1,$2,$3) ON CONFLICT (club_id, tier, player_user_id) DO UPDATE SET player_user_id=EXCLUDED.player_user_id', [req.params.id, tier, uid]);
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

// ====================== 老板调整选手身价/周薪 ======================
app.post('/api/club/:id/player/:userId/update', authMiddleware, async (req, res) => {
  const { id, userId } = req.params;
  const { marketValue, customSalary } = req.body;
  try {
    const club = await pool.query('SELECT * FROM clubs WHERE id = $1', [id]);
    if (club.rows.length === 0) return notFound(res, '俱乐部不存在');
    if (club.rows[0].owner_id !== req.userId && req.userId !== ADMIN_USER_ID) {
      return forbidden(res, '仅俱乐部老板可调整');
    }
    const cm = await pool.query('SELECT * FROM club_members WHERE club_id=$1 AND user_id=$2', [id, userId]);
    if (cm.rows.length === 0) return badRequest(res, '该选手未签约本俱乐部');

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (marketValue !== undefined && marketValue !== null) {
      const mv = parseInt(marketValue);
      if (isNaN(mv) || mv < 1) return badRequest(res, '身价需为正整数');
      const newGrade = calcGrade(mv);
      updates.push(`market_value = $${paramIdx++}, grade = $${paramIdx++}`);
      params.push(mv, newGrade);
    }
    if (customSalary !== undefined && customSalary !== null) {
      const cs = parseInt(customSalary);
      if (isNaN(cs) || cs < 0) return badRequest(res, '周薪不能为负数');
      updates.push(`custom_salary = $${paramIdx++}`);
      params.push(cs);
    }

    if (updates.length === 0) return badRequest(res, '无有效更新字段');
    params.push(userId);
    await pool.query(`UPDATE players SET ${updates.join(', ')} WHERE user_id = $${paramIdx}`, params);
    // 更新榜单分数
    await updatePlayerScore(userId);
    ok(res, {message: '选手信息已更新' });
  } catch(e) { console.error(e); serverError(res, '更新失败'); }
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
    // 创建交易记录
    const result = await pool.query(`INSERT INTO player_trades
      (player_user_id, from_club_id, to_club_id, trade_type, swap_player_user_id, price_diff, status, initiated_by, initiated_club_id)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING id`,
      [player_user_id, from_club_id, to_club_id, trade_type || 'buy', swap_player_user_id || null, finalPriceDiff, req.userId, to_club_id]);
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
    const ratioType = t.trade_type === 'swap' ? 'transfer' : 'purchase';
    const ratioResult = await pool.query('SELECT * FROM transaction_ratios WHERE type=$1', [ratioType]);
    const ratios = ratioResult.rows[0] || { player_ratio: 10, club_ratio: 50, admin_ratio: 40 };
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

async function startServer() {
  await initDB();
  console.log("✅ 数据库就绪");
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务运行在端口 ${PORT}`);
  });

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

// 测试时只导出 app，不启动服务器
if (require.main === module) {
  startServer();
} else {
  module.exports = app;
}
