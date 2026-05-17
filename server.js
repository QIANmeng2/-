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
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        teamId TEXT,
        date TEXT NOT NULL,
        startTime TEXT NOT NULL,
        mode TEXT DEFAULT 'bo1',
        globalBp BOOLEAN DEFAULT false,
        status TEXT DEFAULT 'available',
        applicants TEXT[] DEFAULT '{}',
        confirmedApplicant TEXT,
        modification JSONB,
        is_public BOOLEAN DEFAULT false
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
      CREATE TABLE IF NOT EXISTS recruitment_matches (
        id TEXT PRIMARY KEY,
        organizerId TEXT NOT NULL,
        teamId TEXT,
        startTime TEXT NOT NULL,
        levelReq TEXT DEFAULT '不限',
        notes TEXT DEFAULT '',
        mode INTEGER DEFAULT 1,
        status TEXT DEFAULT 'recruiting',
        locked BOOLEAN DEFAULT false,
        createdAt TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS recruitment_positions (
        id SERIAL PRIMARY KEY,
        matchId TEXT NOT NULL,
        team TEXT NOT NULL,
        lane TEXT NOT NULL,
        playerId TEXT,
        playerName TEXT,
        createdAt TIMESTAMP DEFAULT NOW()
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
    await client.query('ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameId TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameServer TEXT DEFAULT \'手Q区\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gameRank TEXT DEFAULT \'星耀\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS peakScore INTEGER DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS laneStats TEXT DEFAULT \'{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS heroPool TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()');
    await client.query('ALTER TABLE schedules ADD COLUMN IF NOT EXISTS teamId TEXT');
    await client.query('ALTER TABLE recruitment_matches ADD COLUMN IF NOT EXISTS teamId TEXT');
    await client.query('ALTER TABLE recruitment_matches ADD COLUMN IF NOT EXISTS meetingCode TEXT');
    await client.query('ALTER TABLE recruitment_matches ADD COLUMN IF NOT EXISTS meetingLink TEXT');
    await client.query("ALTER TABLE recruitment_matches ADD COLUMN IF NOT EXISTS result TEXT DEFAULT ''");
    // 招募确认流程：增加 confirmed 字段和通知 ID 字段
    await client.query('ALTER TABLE recruitment_positions ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT false');
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
    // 赛事分级
    await client.query("ALTER TABLE competitions ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'regular'");
    // 选手等级 + 解约
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS grade TEXT DEFAULT NULL');
    await client.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS buyout_fee INTEGER DEFAULT NULL');
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
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ message: '未登录' });
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch { return res.status(401).json({ message: '登录已过期' }); }
}

function adminMiddleware(req, res, next) {
  if (req.userId !== ADMIN_USER_ID) return res.status(403).json({ message: '无权限' });
  next();
}

async function sendNotification(userId, type, content, relatedId = null) {
  const result = await pool.query(
    'INSERT INTO notifications (userId, type, content, relatedId, notification_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [userId, type, content, relatedId, userId + '_' + Date.now()]
  );
  return result.rows[0].id;
}

// ====================== 招募系统接口 ======================

// 获取招募中的对局
app.get('/api/recruitment/active', async (req, res) => {
  try {
    // 单次JOIN查询：matches + organizer信息 + positions全部一次取回
    const matches = await pool.query(`
      SELECT
        m.id, m.starttime, m.levelreq, m.notes, m.mode, m.status, m.organizerid, m.createdat,
        u.teamname AS org_teamname, u.coachname AS org_coachname, u.level AS org_level,
        json_agg(json_build_object(
          'team', p.team, 'lane', p.lane, 'playerId', p.playerid,
          'playerName', p.playername, 'confirmed', p.confirmed
        )) FILTER (WHERE p.id IS NOT NULL) AS positions
      FROM recruitment_matches m
      LEFT JOIN users u ON u.id = m.organizerid
      LEFT JOIN recruitment_positions p ON p.matchid = m.id
      WHERE m.status = 'recruiting'
      GROUP BY m.id, u.teamname, u.coachname, u.level
      ORDER BY m.createdat DESC
    `);
    const result = matches.rows.map(m => ({
      id: m.id, startTime: m.starttime, levelReq: m.levelreq,
      notes: m.notes, mode: m.mode, status: m.status,
      organizer: { id: m.organizerid, teamName: m.org_teamname || '未知', coachName: m.org_coachname || '', level: m.org_level || '' },
      totalCount: (m.positions || []).length,
      positions: m.positions || []
    }));
    res.json({ matches: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取已满/待确认对局
app.get('/api/recruitment/full', async (req, res) => {
  try {
    const matches = await pool.query(`
      SELECT
        m.id, m.starttime, m.levelreq, m.notes, m.mode, m.status, m.organizerid, m.createdat,
        u.teamname AS org_teamname, u.coachname AS org_coachname, u.level AS org_level,
        json_agg(json_build_object(
          'team', p.team, 'lane', p.lane, 'playerId', p.playerid,
          'playerName', p.playername, 'confirmed', p.confirmed
        )) FILTER (WHERE p.id IS NOT NULL) AS positions
      FROM recruitment_matches m
      LEFT JOIN users u ON u.id = m.organizerid
      LEFT JOIN recruitment_positions p ON p.matchid = m.id
      WHERE m.status IN ('full', 'confirming')
      GROUP BY m.id, u.teamname, u.coachname, u.level
      ORDER BY m.createdat DESC
    `);
    const result = matches.rows.map(m => ({
      id: m.id, startTime: m.starttime, levelReq: m.levelreq,
      notes: m.notes, mode: m.mode, status: m.status,
      organizer: { id: m.organizerid, teamName: m.org_teamname || '未知', coachName: m.org_coachname || '', level: m.org_level || '' },
      totalCount: (m.positions || []).length,
      positions: m.positions || []
    }));
    res.json({ matches: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取对局详情
app.get('/api/recruitment/:id', async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    const m = mRes.rows[0];

    const [posRes, orgRes] = await Promise.all([
      pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]),
      pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = $1', [m.organizerid])
    ]);
    const positions = posRes.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername, confirmed: p.confirmed }));
    const org = orgRes.rows[0] || {};

    res.json({
      match: {
        id: m.id, startTime: m.starttime, levelReq: m.levelreq, notes: m.notes,
        mode: m.mode, status: m.status, locked: m.locked,
        meetingCode: m.meetingcode || '', meetingLink: m.meetinglink || '',
        organizer: { id: m.organizerid, teamName: org.teamname || '未知', coachName: org.coachname || '', level: org.level || '' },
        positions
      }
    });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 创建招募对局
app.post('/api/recruitment', authMiddleware, async (req, res) => {
  const { startTime, levelReq, notes, mode, positions, teamId } = req.body;
  if (!startTime) return res.status(400).json({ message: '请选择开赛时间' });
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO recruitment_matches (id, organizerId, teamId, startTime, levelReq, notes, mode) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, req.userId, teamId || null, startTime, levelReq || '不限', notes || '', mode || 1]
    );

    // 预占位置（模式3或队伍招募）
    if (positions && positions.length > 0) {
      for (const pos of positions) {
        if (pos.playerId) {
          const userRes = await client.query('SELECT teamName FROM users WHERE id = $1', [pos.playerId]);
          const playerName = userRes.rows[0]?.teamname || '未知';
          await client.query(
            'INSERT INTO recruitment_positions (matchId, team, lane, playerId, playerName) VALUES ($1,$2,$3,$4,$5)',
            [id, pos.team, pos.lane, pos.playerId, playerName]
          );
        }
      }
    }

    await client.query('COMMIT');

    // 获取创建后的完整数据
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [id]);
    const posRes = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [id]);
    const orgRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = $1', [req.userId]);
    const org = orgRes.rows[0] || {};
    const positions_out = posRes.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }));

    res.json({
      match: {
        id, startTime, levelReq: levelReq || '不限', notes: notes || '', mode: mode || 1,
        status: 'recruiting', locked: false,
        organizer: { id: req.userId, teamName: org.teamname || '未知', coachName: org.coachname || '', level: org.level || '' },
        positions: positions_out
      }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ message: '创建失败' });
  } finally { client.release(); }
});

// 撤销（删除）招募对局（仅发起人）
app.delete('/api/recruitment/:id', authMiddleware, async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    if (mRes.rows[0].organizerid !== req.userId) return res.status(403).json({ message: '仅发起人可撤销' });
    await pool.query('DELETE FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    await pool.query('DELETE FROM recruitment_matches WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '撤销失败' }); }
});

// 关闭报名通道（仅发起人）
app.put('/api/recruitment/:id/close', authMiddleware, async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    if (mRes.rows[0].organizerid !== req.userId) return res.status(403).json({ message: '仅发起人可关闭' });
    await pool.query("UPDATE recruitment_matches SET status = 'closed' WHERE id = $1", [req.params.id]);
    // 通知发布人确认胜负结果
    await pool.query(
      'INSERT INTO notifications (userId, type, content, relatedId) VALUES ($1,$2,$3,$4)',
      [req.userId, 'confirm_result', `对局「${mRes.rows[0].starttime}」已结束，请确认胜负结果`, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '关闭失败' }); }
});

// 更新腾讯会议信息
app.put('/api/recruitment/:id/meeting', authMiddleware, async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    if (mRes.rows[0].organizerid !== req.userId) return res.status(403).json({ message: '仅发起人可设置会议' });
    const { meetingCode, meetingLink } = req.body;
    await pool.query('UPDATE recruitment_matches SET meetingCode = $1, meetingLink = $2 WHERE id = $3', [meetingCode || '', meetingLink || '', req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '设置失败' }); }
});

// 请求创建腾讯会议（标记等待自动监控创建）
app.post('/api/recruitment/:id/meeting', authMiddleware, async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    if (mRes.rows[0].organizerid !== req.userId) return res.status(403).json({ message: '仅发起人可创建会议' });
    const m = mRes.rows[0];
    if (m.meetingcode) {
      return res.json({ success: true, meetingCode: m.meetingcode, meetingLink: m.meetinglink });
    }
    // 标记为“已锁定，等待自动监控创建会议”
    await pool.query('UPDATE recruitment_matches SET locked = true WHERE id = $1 AND locked = false', [req.params.id]);
    res.json({ success: true, message: '会议将由系统自动创建，请 30 秒后刷新查看会议号', meetingCode: '', meetingLink: '' });
  } catch (e) { console.error(e); res.status(500).json({ message: '创建会议失败' }); }
});

// 确认对局胜负结果（仅发起人）
app.put('/api/recruitment/:id/confirm-result', authMiddleware, async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    if (mRes.rows[0].organizerid !== req.userId) return res.status(403).json({ message: '仅发起人可确认结果' });
    const { result } = req.body;
    if (!['win','loss'].includes(result)) return res.status(400).json({ message: '结果只能是 win 或 loss' });
    await pool.query('UPDATE recruitment_matches SET result = $1 WHERE id = $2', [result, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '确认失败' }); }
});

// 获取已打完的对局列表（公示榜用）
app.get('/api/recruitment/completed', async (req, res) => {
  try {
    const data = await pool.query("SELECT * FROM recruitment_matches WHERE status = 'closed' AND result IS NOT NULL ORDER BY startTime DESC");
    const organizerIds = [...new Set(data.rows.map(r => r.organizerid))];
    let userMap = {};
    if (organizerIds.length > 0) {
      const usersRes = await pool.query('SELECT id, teamName, coachName FROM users WHERE id = ANY($1)', [organizerIds]);
      usersRes.rows.forEach(u => { userMap[u.id] = u; });
    }
    res.json({ matches: data.rows.map(r => ({
      id: r.id, startTime: r.starttime, levelReq: r.levelreq, mode: r.mode,
      result: r.result, organizerName: userMap[r.organizerid]?.teamname || '未知',
      organizerCoachName: userMap[r.organizerid]?.coachname || ''
    })) });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 队长邀请用户加入队伍
app.post('/api/teams/:id/invite', authMiddleware, async (req, res) => {
  try {
    const teamRes = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (teamRes.rows.length === 0) return res.status(404).json({ message: '队伍不存在' });
    if (teamRes.rows[0].captainid !== req.userId) return res.status(403).json({ message: '仅队长可邀请' });
    const { username } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ message: '请输入用户名' });
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 OR coachName = $1', [username.trim()]);
    if (userRes.rows.length === 0) return res.status(404).json({ message: '未找到该用户' });
    const targetUserId = userRes.rows[0].id;
    const existing = await pool.query('SELECT * FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, targetUserId]);
    if (existing.rows.length > 0) return res.status(400).json({ message: '该用户已在队中' });
    await pool.query(
      'INSERT INTO notifications (userId, type, content, relatedId) VALUES ($1,$2,$3,$4)',
      [targetUserId, 'team_invite', `队伍"${teamRes.rows[0].name}"邀请你加入`, req.params.id]
    );
    res.json({ success: true, message: '邀请已发送' });
  } catch (e) { console.error(e); res.status(500).json({ message: '邀请失败' }); }
});

// 报名占位
app.post('/api/recruitment/:id/join', authMiddleware, async (req, res) => {
  const { team, lane } = req.body;
  if (!team || !lane) return res.status(400).json({ message: '请选择阵营和分路' });

  const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
  const TEAMS = ['blue', 'red'];
  if (!TEAMS.includes(team)) return res.status(400).json({ message: '阵营无效' });
  if (!LANES.includes(lane)) return res.status(400).json({ message: '分路无效' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '对局不存在' }); }
    const m = mRes.rows[0];
    if (m.status === 'closed' || m.status === 'full') { await client.query('ROLLBACK'); return res.status(400).json({ message: '该对局已关闭或已满' }); }
    if (m.organizerid === req.userId) { await client.query('ROLLBACK'); return res.status(400).json({ message: '发起人无需报名' }); }

    // 检查是否已报名本对局
    const existing = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '你已在本对局中报名，请先撤销再重新报名' });
    }

    // 检查该位置是否已满
    const lanePos = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1 AND team = $2 AND lane = $3', [req.params.id, team, lane]);
    if (lanePos.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `${team === 'blue' ? '蓝' : '红'}方${lane}已有人占位` });
    }

    // 获取玩家信息
    const userRes = await client.query('SELECT teamName FROM users WHERE id = $1', [req.userId]);
    const playerName = userRes.rows[0]?.teamname || '未知';

    await client.query(
      'INSERT INTO recruitment_positions (matchId, team, lane, playerId, playerName) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, team, lane, req.userId, playerName]
    );

    // 检查是否满员（10人）—— 进入确认阶段
    const allPos = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    if (allPos.rows.length >= 10) {
      // 进入 confirming 状态，通知所有人确认
      await client.query("UPDATE recruitment_matches SET status = 'confirming', locked = true WHERE id = $1", [req.params.id]);
      const players = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
      const matchInfo = await client.query('SELECT startTime FROM recruitment_matches WHERE id = $1', [req.params.id]);
      const startTime = matchInfo.rows[0]?.starttime || '';
      for (const p of players.rows) {
        await sendNotification(p.playerid, 'recruitment_confirm',
          `训练赛 ${startTime} 已凑齐10人，请确认你是否能参加，点击「能参加」后将锁定位置。`);
      }
    }

    await client.query('COMMIT');

    const posRes = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = posRes.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername, confirmed: p.confirmed }));
    const updated = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);

    res.json({
      success: true,
      match: { id: req.params.id, status: updated.rows[0].status, locked: updated.rows[0].locked },
      positions: positions_out,
      isFull: updated.rows[0].status === 'full',
      isConfirming: updated.rows[0].status === 'confirming'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ message: '报名失败' });
  } finally { client.release(); }
});

// 撤销报名
app.post('/api/recruitment/:id/leave', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posRes = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);
    if (posRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '你未报名此对局' }); }

    await client.query('DELETE FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);

    // 获取当前对局状态
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    const m = mRes.rows[0];

    if (m && m.status === 'confirming') {
      // 在确认阶段退出，通知其他人
      const remaining = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
      for (const p of remaining.rows) {
        await sendNotification(p.playerid, 'recruitment_dropped',
          `有人退出，训练赛 ${m.starttime} 仍在招募中（${remaining.rows.length}/10）`);
      }
      // 若不足10人，恢复 recruiting
      if (remaining.rows.length < 10) {
        await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
      }
    } else if (m && m.status === 'full') {
      // 正式成局后退出，恢复 recruiting（这种情况极少发生）
      await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');

    const allPos = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = allPos.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername, confirmed: p.confirmed }));
    const updated = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);

    res.json({
      success: true,
      match: { id: req.params.id, status: updated.rows[0]?.status, locked: updated.rows[0]?.locked },
      positions: positions_out
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ message: '撤销失败' });
  } finally { client.release(); }
});

// 确认能否参加（confirming 阶段）
app.put('/api/recruitment/:id/confirm', authMiddleware, async (req, res) => {
  const { confirmed } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '对局不存在' }); }
    const m = mRes.rows[0];
    if (m.status !== 'confirming') { await client.query('ROLLBACK'); return res.status(400).json({ message: '当前不在确认阶段' }); }

    const posRes = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);
    if (posRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '你不在本对局中' }); }

    if (confirmed === true) {
      // 确认能参加，标记 confirmed=true
      await client.query('UPDATE recruitment_positions SET confirmed = true WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);
      // 通知其他未确认的人
      const others = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1 AND playerId != $2 AND confirmed = false', [req.params.id, req.userId]);
      for (const p of others.rows) {
        await sendNotification(p.playerid, 'recruitment_confirmed', `有人已确认能参加训练赛 ${m.starttime}，还差 ${others.rows.length} 人确认。`);
      }
      // 检查是否所有人都确认了
      const allConfirmed = await client.query('SELECT COUNT(*) FROM recruitment_positions WHERE matchId = $1 AND confirmed = false', [req.params.id]);
      if (parseInt(allConfirmed.rows[0].count) === 0) {
        // 全员确认，正式成局
        await client.query("UPDATE recruitment_matches SET status = 'full' WHERE id = $1", [req.params.id]);
        const players = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
        for (const p of players.rows) {
          await sendNotification(p.playerid, 'recruitment_full',
            `🎉 训练赛 ${m.starttime} 已全员确认，正式成局！请准时参加。${m.mode === 2 && m.meetingcode ? '腾讯会议号：' + m.meetingcode : ''}`);
        }
      }
    } else {
      // 没时间，退出位置
      await client.query('DELETE FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.userId]);
      const remaining = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
      for (const p of remaining.rows) {
        await sendNotification(p.playerid, 'recruitment_dropped',
          `有人退出，训练赛 ${m.starttime} 仍在招募中（${remaining.rows.length}/10）`);
      }
      if (remaining.rows.length < 10) {
        await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
      }
    }

    await client.query('COMMIT');
    const allPos = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = allPos.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername, confirmed: p.confirmed }));
    const updated = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    res.json({
      success: true,
      match: { id: req.params.id, status: updated.rows[0].status, locked: updated.rows[0].locked },
      positions: positions_out
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ message: '确认失败' });
  } finally { client.release(); }
});

// 清理占位（仅发起人，可清理恶意报名人员）
app.delete('/api/recruitment/:id/positions/:playerId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '对局不存在' }); }
    if (mRes.rows[0].organizerid !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '仅发起人可清理' }); }

    await client.query('DELETE FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.params.playerId]);

    const m = mRes.rows[0];
    // confirming/full 状态：通知其他人有人退出
    if (m.status === 'confirming' || m.status === 'full') {
      const remaining = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
      for (const p of remaining.rows) {
        await sendNotification(p.playerid, 'recruitment_dropped',
          `管理员清理了占位，训练赛 ${m.starttime} 仍在招募中（${remaining.rows.length}/10）`);
      }
      // 若不足10人，恢复 recruiting
      if (remaining.rows.length < 10) {
        await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
      }
    }

    await client.query('COMMIT');

    const allPos = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = allPos.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername, confirmed: p.confirmed }));
    const latest = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);

    res.json({
      success: true,
      match: { id: req.params.id, status: latest.rows[0]?.status, locked: latest.rows[0]?.locked },
      positions: positions_out
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ message: '清理失败' });
  } finally { client.release(); }
});

// 获取我的报名情况
app.get('/api/recruitment/mine', authMiddleware, async (req, res) => {
  try {
    const posRes = await pool.query('SELECT * FROM recruitment_positions WHERE playerId = $1', [req.userId]);
    if (posRes.rows.length === 0) return res.json({ matches: [] });

    const matchIds = [...new Set(posRes.rows.map(p => p.matchid))];
    const matches = await pool.query('SELECT * FROM recruitment_matches WHERE id = ANY($1)', [matchIds]);

    const orgIds = [...new Set(matches.rows.map(m => m.organizerid))];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = ANY($1)', [orgIds]);
    const orgMap = {};
    usersRes.rows.forEach(u => { orgMap[u.id] = u; });

    const posMap = {};
    posRes.rows.forEach(p => { if (!posMap[p.matchid]) posMap[p.matchid] = []; posMap[p.matchid].push(p); });

    const result = matches.rows.map(m => ({
      id: m.id, startTime: m.starttime, levelReq: m.levelreq, notes: m.notes, mode: m.mode, status: m.status,
      organizer: { id: m.organizerid, teamName: orgMap[m.organizerid]?.teamname || '未知' },
      myPosition: posMap[m.id]?.map(p => ({ team: p.team, lane: p.lane })) || []
    }));
    res.json({ matches: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// ====================== 以下为原有接口（保持不变） ======================

app.post('/api/auth/register', async (req, res) => {
  const { username, password, coachName, wechat, level, bio } = req.body;
  if (!username || !password || !coachName || !wechat) return res.status(400).json({ message: '信息不完整' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.status(400).json({ message: '用户名已存在' });
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const hashed = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO users (id, username, password, teamName, coachName, wechat, level, bio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, username, hashed, '', coachName, wechat, level || '大众', bio || '']);
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName: '', coachName, wechat, level: level || '大众', bio: bio || '', disabledDates: [], gameId: '', gameServer: '手Q区', gameRank: '星耀', peakScore: 0, laneStats: '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: '' } });
  } catch (e) { res.status(500).json({ message: '注册失败' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password)) return res.status(400).json({ message: '用户名或密码错误' });
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamname, coachName: user.coachname, wechat: user.wechat, level: user.level, bio: user.bio, disabledDates: user.disableddates || [], gameId: user.gameid || '', gameServer: user.gameserver || '手Q区', gameRank: user.gamerank || '星耀', peakScore: user.peakscore || 0, laneStats: user.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: user.heropool || '' } });
  } catch (e) { res.status(500).json({ message: '登录失败' }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, bio: u.bio, disabledDates: u.disableddates || [], gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀', peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: u.heropool || '', dream_coins: u.dream_coins || 0 } });
  } catch (e) { res.status(500).json({ message: '获取失败' }); }
});

app.put('/api/users/me', authMiddleware, async (req, res) => {
  const { coachName, wechat, level, bio } = req.body;
  try {
    await pool.query('UPDATE users SET coachName = COALESCE($1, coachName), wechat = COALESCE($2, wechat), level = COALESCE($3, level), bio = COALESCE($4, bio) WHERE id = $5',
      [coachName || null, wechat || null, level || null, bio || null, req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '更新失败' }); }
});

app.put('/api/users/me/disabled-dates', authMiddleware, async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ message: '日期不能为空' });
  try {
    const result = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    let disabled = result.rows[0].disableddates || [];
    const index = disabled.indexOf(date);
    if (index === -1) disabled.push(date); else disabled.splice(index, 1);
    await pool.query('UPDATE users SET disabledDates = $1 WHERE id = $2', [disabled, req.userId]);
    res.json({ disabledDates: disabled });
  } catch (e) { res.status(500).json({ message: '操作失败' }); }
});

app.get('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const u = result.rows[0];
    res.json({ user: {
      id: u.id, username: u.username, teamName: u.teamname, coachName: u.coachname, level: u.level, bio: u.bio || '',
      gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀',
      peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}',
      heroPool: u.heropool || '', wechat: u.wechat || ''
    }});
  } catch (e) { res.status(500).json({ message: '获取失败' }); }
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE userId = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json({ notifications: result.rows });
  } catch (e) { res.status(500).json({ message: '获取通知失败' }); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read = true WHERE userId = $1", [req.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '标记失败' }); }
});

app.get('/api/schedules', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedules WHERE status = 'available'");
    if (result.rows.length === 0) return res.json({ schedules: [] });
    const userIds = [...new Set(result.rows.map(s => s.userid))];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level, bio FROM users WHERE id = ANY($1)', [userIds]);
    const usersMap = {};
    usersRes.rows.forEach(u => { usersMap[u.id] = u; });
    const schedules = result.rows.map(s => {
      const user = usersMap[s.userid] || {};
      return { id: s.id, date: s.date, startTime: s.starttime, mode: s.mode, globalBp: s.globalbp, status: s.status, applicantCount: (s.applicants || []).length, team: { id: user.id, teamName: user.teamname, coachName: user.coachname, level: user.level, bio: user.bio } };
    });
    res.json({ schedules });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

app.get('/api/public-schedules', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedules WHERE status = 'confirmed' AND is_public = true ORDER BY date DESC, startTime DESC");
    if (result.rows.length === 0) return res.json({ schedules: [] });
    const allUserIds = result.rows.flatMap(s => [s.userid, s.confirmedapplicant].filter(Boolean));
    const uniqueUserIds = [...new Set(allUserIds)];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level, bio FROM users WHERE id = ANY($1)', [uniqueUserIds]);
    const usersMap = {};
    usersRes.rows.forEach(u => { usersMap[u.id] = u; });
    const schedules = result.rows.map(s => {
      const publisher = usersMap[s.userid] || {};
      const opponent = usersMap[s.confirmedapplicant] || {};
      return { id: s.id, date: s.date, startTime: s.starttime, mode: s.mode, globalBp: s.globalbp, status: s.status, publisher: { id: publisher.id, teamName: publisher.teamname, coachName: publisher.coachname, level: publisher.level, bio: publisher.bio }, opponent: { id: opponent.id, teamName: opponent.teamname, coachName: opponent.coachname, level: opponent.level, bio: opponent.bio } };
    });
    res.json({ schedules });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

app.get('/api/schedules/mine', authMiddleware, async (req, res) => {
  try {
    const schedules = await pool.query('SELECT * FROM schedules WHERE userId = $1 ORDER BY date DESC, startTime DESC', [req.userId]);
    const userResult = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    const disabledDates = userResult.rows[0]?.disableddates || [];
    const allApplicantIds = schedules.rows.flatMap(s => s.applicants || []).filter(Boolean);
    const confirmedIds = schedules.rows.map(s => s.confirmedapplicant).filter(Boolean);
    const allUserIds = [...new Set([...allApplicantIds, ...confirmedIds])];
    let usersMap = {};
    if (allUserIds.length > 0) {
      const usersRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = ANY($1)', [allUserIds]);
      usersRes.rows.forEach(u => { usersMap[u.id] = u; });
    }
    const formattedSchedules = schedules.rows.map(s => {
      const applicants = (s.applicants || []).map(id => { const u = usersMap[id] || {}; return { id, teamName: u.teamname || '未知', coachName: u.coachname || '未知', level: u.level || '' }; });
      let opponent = null;
      if (s.confirmedapplicant) { const u = usersMap[s.confirmedapplicant] || {}; opponent = { id: s.confirmedapplicant, teamName: u.teamname || '未知', coachName: u.coachname || '未知', level: u.level || '' }; }
      return { id: s.id, date: s.date, startTime: s.starttime, mode: s.mode, globalBp: s.globalbp, status: s.status, applicants, opponent, isPublisher: true };
    });
    res.json({ schedules: formattedSchedules, disabledDates });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
  const { date, startTime, mode, globalBp } = req.body;
  if (!date || !startTime) return res.status(400).json({ message: '请填写日期和时间' });
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  try {
    await pool.query('INSERT INTO schedules (id, userId, date, startTime, mode, globalBp) VALUES ($1,$2,$3,$4,$5,$6)', [id, req.userId, date, startTime, mode || 'bo1', globalBp || false]);
    res.json({ schedule: { id, date, startTime, mode, globalBp } });
  } catch (e) { res.status(500).json({ message: '发布失败' }); }
});

app.delete('/api/schedules/:id/cancel-post', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在或无权操作' });
    const schedule = sRes.rows[0];
    if (schedule.status === 'confirmed') return res.status(400).json({ message: '已确认的档期请使用取消训练功能' });
    if (schedule.applicants && schedule.applicants.length > 0) {
      for (const appId of schedule.applicants) { await sendNotification(appId, 'schedule_cancelled', `你申请的档期 ${schedule.date} ${schedule.starttime} 已被发布者取消`); }
    }
    await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '取消失败' }); }
});

app.post('/api/schedules/:id/apply', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (schedule.userid === req.userId) return res.status(400).json({ message: '不能申请自己的档期' });
    if (schedule.status !== 'available') return res.status(400).json({ message: '该档期不可申请' });
    let applicants = schedule.applicants || [];
    if (applicants.includes(req.userId)) return res.status(400).json({ message: '你已经申请过了' });
    applicants.push(req.userId);
    await pool.query('UPDATE schedules SET applicants = $1 WHERE id = $2', [applicants, req.params.id]);
    await sendNotification(schedule.userid, 'new_apply', `有人申请了你的档期 ${schedule.date} ${schedule.starttime}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '申请失败' }); }
});

app.put('/api/schedules/:id/confirm-applicant', authMiddleware, async (req, res) => {
  const { applicantId, isPublic } = req.body;
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    if (!sRes.rows[0].applicants || !sRes.rows[0].applicants.includes(applicantId)) return res.status(400).json({ message: '该用户未申请' });
    await pool.query("UPDATE schedules SET status = 'confirmed', confirmedApplicant = $1, applicants = '{}', is_public = COALESCE($3, false) WHERE id = $2", [applicantId, req.params.id, isPublic || false]);
    await sendNotification(applicantId, 'confirmed', `你的申请被接受！档期 ${sRes.rows[0].date} ${sRes.rows[0].starttime} 已确认`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '确认失败' }); }
});

app.put('/api/schedules/:id/unconfirm', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query("SELECT * FROM schedules WHERE id = $1 AND userId = $2 AND status = 'confirmed'", [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在或未确认' });
    await pool.query("UPDATE schedules SET status = 'available', confirmedApplicant = NULL, is_public = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '撤回失败' }); }
});

app.post('/api/schedules/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (schedule.status !== 'confirmed') return res.status(400).json({ message: '只有已确认的档期才能取消' });
    if (req.userId !== schedule.userid && req.userId !== schedule.confirmedapplicant) return res.status(403).json({ message: '无权操作' });
    await pool.query("UPDATE schedules SET status = 'cancelled', modification = NULL WHERE id = $1", [req.params.id]);
    const other = (req.userId === schedule.userid) ? schedule.confirmedapplicant : schedule.userid;
    await sendNotification(other, 'cancelled', `训练赛 ${schedule.date} ${schedule.starttime} 已被取消`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '取消失败' }); }
});

app.put('/api/schedules/:id/modify-time', authMiddleware, async (req, res) => {
  const { newTime } = req.body;
  if (!newTime) return res.status(400).json({ message: '请提供新时间' });
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (schedule.status !== 'confirmed') return res.status(400).json({ message: '只有已确认的档期才能修改时间' });
    if (req.userId !== schedule.userid && req.userId !== schedule.confirmedapplicant) return res.status(403).json({ message: '无权操作' });
    await pool.query('UPDATE schedules SET startTime = $1 WHERE id = $2', [newTime, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '修改失败' }); }
});

app.put('/api/schedules/:id/toggle-public', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query("SELECT * FROM schedules WHERE id = $1 AND userId = $2 AND status = 'confirmed'", [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const current = sRes.rows[0].is_public;
    await pool.query('UPDATE schedules SET is_public = NOT is_public WHERE id = $1', [req.params.id]);
    res.json({ isPublic: !current });
  } catch (e) { res.status(500).json({ message: '修改失败' }); }
});

app.post('/api/schedules/:id/republish', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    if (sRes.rows[0].status !== 'cancelled') return res.status(400).json({ message: '只有已取消的档期才能重新发布' });
    await pool.query("UPDATE schedules SET status = 'available', confirmedApplicant = NULL, applicants = '{}', modification = NULL, is_public = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '重新发布失败' }); }
});

app.get('/api/admin/schedules', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schedules ORDER BY date DESC, startTime DESC');
    res.json({ schedules: result.rows });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

app.delete('/api/admin/schedules/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '删除失败' }); }
});

// 管理员仪表盘统计
app.get('/api/admin/dashboard', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const schedulesCount = await pool.query('SELECT COUNT(*) FROM schedules');
    const recruitmentsCount = await pool.query('SELECT COUNT(*) FROM recruitment_matches');
    const activeRecruitments = await pool.query("SELECT COUNT(*) FROM recruitment_matches WHERE status = 'recruiting'");
    const fullRecruitments = await pool.query("SELECT COUNT(*) FROM recruitment_matches WHERE status = 'full'");
    const teamsCount = await pool.query('SELECT COUNT(*) FROM teams');
    const today = new Date().toISOString().split('T')[0];
    const todaySchedules = await pool.query("SELECT COUNT(*) FROM schedules WHERE date = $1", [today]);
    res.json({
      stats: {
        totalUsers: parseInt(usersCount.rows[0].count),
        totalSchedules: parseInt(schedulesCount.rows[0].count),
        totalRecruitments: parseInt(recruitmentsCount.rows[0].count),
        activeRecruitments: parseInt(activeRecruitments.rows[0].count),
        fullRecruitments: parseInt(fullRecruitments.rows[0].count),
        totalTeams: parseInt(teamsCount.rows[0].count),
        todaySchedules: parseInt(todaySchedules.rows[0].count)
      }
    });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 管理员获取所有招募
app.get('/api/admin/recruitments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const matches = await pool.query('SELECT * FROM recruitment_matches ORDER BY createdAt DESC');
    if (matches.rows.length === 0) return res.json({ recruitments: [] });
    const matchIds = matches.rows.map(m => m.id);
    const positions = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = ANY($1)', [matchIds]);
    const orgIds = [...new Set(matches.rows.map(m => m.organizerid))];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = ANY($1)', [orgIds]);
    const orgMap = {};
    usersRes.rows.forEach(u => { orgMap[u.id] = u; });
    const posMap = {};
    positions.rows.forEach(p => { if (!posMap[p.matchid]) posMap[p.matchid] = []; posMap[p.matchid].push(p); });
    const result = matches.rows.map(m => {
      const pos = posMap[m.id] || [];
      const org = orgMap[m.organizerid] || {};
      return {
        id: m.id, startTime: m.starttime, levelReq: m.levelreq, notes: m.notes,
        mode: m.mode, status: m.status, locked: m.locked, createdAt: m.createdat,
        organizer: { id: m.organizerid, teamName: org.teamname || '未知', coachName: org.coachname || '', level: org.level || '' },
        totalCount: pos.length,
        positions: pos.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }))
      };
    });
    res.json({ recruitments: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 管理员删除招募
app.delete('/api/admin/recruitments/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    await pool.query('DELETE FROM recruitment_matches WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '删除失败' }); }
});

// 管理员获取所有用户（支持筛选）
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { level, gameServer, gameRank, search, heroPool, teamId, minPeak, maxPeak, peakSort } = req.query;
    let sql = 'SELECT id, username, teamName, coachName, wechat, level, bio, gameId, gameServer, gameRank, peakScore, heroPool, created_at FROM users WHERE 1=1';
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
      team: teamMap[u.id] || null
    })) });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
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
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 管理员发放梦币用的用户列表（简化）
app.get('/api/admin/users/simple', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, coachName FROM users ORDER BY coachName, username');
    res.json({ users: result.rows });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
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
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ message: '删除失败' }); } finally { client.release(); }
});

// 管理员操作日志（简化版：从通知表读取）
app.get('/api/admin/logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100');
    res.json({ logs: result.rows.map(l => ({
      id: l.id, userId: l.userid, type: l.type, content: l.content,
      relatedId: l.relatedid, read: l.read, createdAt: l.created_at
    })) });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
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
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// ====================== 个人参赛历史 ======================

app.get('/api/users/me/history', authMiddleware, async (req, res) => {
  try {
    // 获取用户参与过的所有招募位置
    const posRes = await pool.query(
      'SELECT p.*, m.startTime, m.levelReq, m.notes, m.mode, m.status, m.locked, m.createdAt, m.organizerId, u.teamName as organizerName ' +
      'FROM recruitment_positions p ' +
      'JOIN recruitment_matches m ON p.matchId = m.id ' +
      'LEFT JOIN users u ON m.organizerId = u.id ' +
      'WHERE p.playerId = $1 ORDER BY m.startTime DESC',
      [req.userId]
    );
    res.json({
      history: posRes.rows.map(r => ({
        matchId: r.matchid,
        team: r.team,
        lane: r.lane,
        startTime: r.starttime,
        levelReq: r.levelreq,
        notes: r.notes,
        mode: r.mode,
        status: r.status,
        locked: r.locked,
        organizerName: r.organizername || '未知',
        createdAt: r.createdat
      }))
    });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// ====================== 个人游戏资料 ======================

app.get('/api/users/me/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT gameId, gameServer, gameRank, peakScore, laneStats, heroPool FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
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
  } catch (e) { console.error(e); res.status(500).json({ message: '获取失败' }); }
});

app.put('/api/users/me/profile', authMiddleware, async (req, res) => {
  const { gameId, gameServer, gameRank, peakScore, laneStats, heroPool } = req.body;
  try {
    const laneStatsJson = typeof laneStats === 'string' ? laneStats : JSON.stringify(laneStats || {});
    await pool.query(
      'UPDATE users SET gameId = COALESCE($1, gameId), gameServer = COALESCE($2, gameServer), gameRank = COALESCE($3, gameRank), peakScore = COALESCE($4, peakScore), laneStats = COALESCE($5, laneStats), heroPool = COALESCE($6, heroPool) WHERE id = $7',
      [gameId || null, gameServer || null, gameRank || null, peakScore || null, laneStatsJson || null, heroPool || null, req.userId]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '更新失败' }); }
});

// ====================== 队伍系统 ======================

// 获取所有队伍（公开列表）
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await pool.query("SELECT * FROM teams WHERE status = 'open' ORDER BY createdAt DESC");
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
      return { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: t.status, memberCount: tm.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat };
    });
    res.json({ teams: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取我的队伍
app.get('/api/teams/mine', authMiddleware, async (req, res) => {
  try {
    const memberRes = await pool.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (memberRes.rows.length === 0) return res.json({ team: null });

    const teamId = memberRes.rows[0].teamid;
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    if (tRes.rows.length === 0) return res.json({ team: null });
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
    res.json({ team: { id: t.id, name: t.name, bio: t.bio, captainId: t.captainid, status: t.status, memberCount: members.rows.length, maxMembers: t.maxmembers, members: memberList, createdAt: t.createdat, myRole } });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取单个队伍详情
app.get('/api/teams/:id', async (req, res) => {
  try {
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) return res.status(404).json({ message: '队伍不存在' });
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
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 创建队伍
app.post('/api/teams', authMiddleware, async (req, res) => {
  const { name, bio } = req.body;
  if (!name) return res.status(400).json({ message: '请填写队伍名称' });
  try {
    // 检查是否已在队伍中
    const existing = await pool.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (existing.rows.length > 0) return res.status(400).json({ message: '你已在其他队伍中，请先退出' });

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    await pool.query('INSERT INTO teams (id, name, bio, captainId) VALUES ($1,$2,$3,$4)', [id, name, bio || '', req.userId]);
    await pool.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1,$2,$3)', [id, req.userId, 'captain']);

    const userRes = await pool.query('SELECT username, teamName, coachName, level FROM users WHERE id = $1', [req.userId]);
    const u = userRes.rows[0] || {};
    res.json({ team: { id, name, bio: bio || '', captainId: req.userId, status: 'open', memberCount: 1, maxMembers: 7, members: [{ userId: req.userId, role: 'captain', username: u.username, coachName: u.coachname, level: u.level }] } });
  } catch (e) { console.error(e); res.status(500).json({ message: '创建失败' }); }
});

// 更新队伍信息（仅队长）
app.put('/api/teams/:id', authMiddleware, async (req, res) => {
  const { name, bio, status } = req.body;
  try {
    const tRes = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) return res.status(404).json({ message: '队伍不存在' });
    if (tRes.rows[0].captainid !== req.userId) return res.status(403).json({ message: '仅队长可修改队伍信息' });
    await pool.query('UPDATE teams SET name = COALESCE($1, name), bio = COALESCE($2, bio), status = COALESCE($3, status) WHERE id = $4', [name || null, bio || null, status || null, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '修改失败' }); }
});

// 解散队伍（仅队长）
app.delete('/api/teams/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '仅队长可解散队伍' }); }
    await client.query('DELETE FROM team_members WHERE teamId = $1', [req.params.id]);
    await client.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '解散失败' }); } finally { client.release(); }
});

// 加入队伍
app.post('/api/teams/:id/join', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    const t = tRes.rows[0];
    if (t.status !== 'open') { await client.query('ROLLBACK'); return res.status(400).json({ message: '该队伍已关闭入队通道' }); }

    const existing = await client.query('SELECT * FROM team_members WHERE userId = $1', [req.userId]);
    if (existing.rows.length > 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '你已在其他队伍中' }); }

    const countRes = await client.query('SELECT COUNT(*) FROM team_members WHERE teamId = $1', [req.params.id]);
    if (parseInt(countRes.rows[0].count) >= 7) {
      await client.query("UPDATE teams SET status = 'closed' WHERE id = $1", [req.params.id]);
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '队伍已满（7人）' });
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
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ message: '你已在该队伍中' });
    console.error(e); res.status(500).json({ message: '加入失败' });
  } finally { client.release(); }
});

// 退出队伍
app.post('/api/teams/:id/leave', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    const t = tRes.rows[0];

    const memberRes = await client.query('SELECT * FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, req.userId]);
    if (memberRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '你不是该队伍成员' }); }

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
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '退出失败' }); } finally { client.release(); }
});

// 踢出队员（仅队长）
app.delete('/api/teams/:id/members/:userId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '仅队长可操作' }); }
    if (req.params.userId === req.userId) { await client.query('ROLLBACK'); return res.status(400).json({ message: '请使用退出队伍功能' }); }

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
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '操作失败' }); } finally { client.release(); }
});

// 转让队长
app.post('/api/teams/:id/transfer', authMiddleware, async (req, res) => {
  const { newCaptainId } = req.body;
  if (!newCaptainId) return res.status(400).json({ message: '请指定新队长' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    if (tRes.rows[0].captainid !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '仅队长可操作' }); }
    if (newCaptainId === req.userId) { await client.query('ROLLBACK'); return res.status(400).json({ message: '你已经是队长' }); }

    const memberRes = await client.query('SELECT * FROM team_members WHERE teamId = $1 AND userId = $2', [req.params.id, newCaptainId]);
    if (memberRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '该成员不在队伍中' }); }

    await client.query('UPDATE teams SET captainId = $1 WHERE id = $2', [newCaptainId, req.params.id]);
    await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['captain', req.params.id, newCaptainId]);
    await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['member', req.params.id, req.userId]);

    await client.query('COMMIT');
    // 通知新队长
    await sendNotification(newCaptainId, 'team_transfer', `你已成为队伍「${tRes.rows[0].name}」的新队长`, req.params.id);
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '转让失败' }); } finally { client.release(); }
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
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

app.delete('/api/admin/teams/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM team_members WHERE teamId = $1', [req.params.id]);
    await client.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '删除失败' }); } finally { client.release(); }
});

// 管理员创建队伍
app.post('/api/admin/teams', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, bio, maxMembers, captainId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: '请输入队伍名称' });
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
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '创建失败' }); } finally { client.release(); }
});

// 管理员更新队伍（改名/换队长/改状态）
app.put('/api/admin/teams/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, captainId, status, bio, maxMembers } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '队伍不存在' }); }
    const team = current.rows[0];
    const updates = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name.trim()); }
    if (captainId !== undefined) { updates.push(`captainId = $${idx++}`); params.push(captainId); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
    if (bio !== undefined) { updates.push(`bio = $${idx++}`); params.push(bio); }
    if (maxMembers !== undefined) { updates.push(`maxMembers = $${idx++}`); params.push(parseInt(maxMembers)); }
    if (updates.length > 0) {
      params.push(req.params.id);
      await client.query(`UPDATE teams SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    }
    // 如果换了队长，同步更新 team_members
    if (captainId !== undefined && captainId !== team.captainid) {
      await client.query('UPDATE team_members SET role = $1 WHERE teamId = $2 AND userId = $3', ['member', req.params.id, team.captainid]);
      await client.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1, $2, $3) ON CONFLICT (teamId, userId) DO UPDATE SET role = $3', [req.params.id, captainId, 'captain']);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '更新失败' }); } finally { client.release(); }
});

// 管理员添加成员到队伍（同时从其他队伍移除）
app.post('/api/admin/teams/:id/members', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: '请指定用户' });
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
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '添加失败' }); } finally { client.release(); }
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
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '移除失败' }); } finally { client.release(); }
});


// ==================== 赛事管理 ====================
app.get('/api/competitions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.coachName AS created_by_name, u.username AS created_by_username
      FROM competitions c
      LEFT JOIN users u ON u.id = c.created_by
      WHERE c.status != 'deleted'
      ORDER BY c.created_at DESC
    `);
    const all = result.rows;
    res.json({
      elite: all.filter(c => c.tier === 'elite'),
      secondary: all.filter(c => c.tier === 'secondary'),
      regular: all.filter(c => c.tier !== 'elite' && c.tier !== 'secondary'), // 含旧数据
      all
    });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

app.post('/api/admin/competitions', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, qr_code_url, tier } = req.body;
  if (!name) return res.status(400).json({ message: '请填写赛事名称' });
  const id = 'comp_' + Date.now();
  try {
    await pool.query('INSERT INTO competitions (id, name, qr_code_url, tier, created_by) VALUES ($1,$2,$3,$4,$5)', [id, name, qr_code_url || null, tier || 'regular', req.userId]);
    res.json({ success: true, id });
  } catch(e) { console.error(e); res.status(500).json({ message: '创建失败' }); }
});

app.delete('/api/admin/competitions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query("UPDATE competitions SET status = 'deleted' WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ message: '删除失败' }); }
});

// ==================== 梦币系统 ====================
app.get('/api/me/coins', authMiddleware, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [req.userId]);
    const balance = userRes.rows[0] ? userRes.rows[0].dream_coins : 0;
    const txRes = await pool.query('SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json({ balance, transactions: txRes.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

app.post('/api/admin/award-coins', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, amount, note } = req.body;
  if (!userId || !amount) return res.status(400).json({ message: '参数不完整' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateRes = await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [amount, userId]);
    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '用户不存在，请检查用户ID是否正确' });
    }
    await client.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward',$3)", [userId, amount, note || '赛事奖励']);
    await client.query('COMMIT');
    try {
      const notifMsg = '你获得了 ' + amount + ' 梦币！' + (note ? '备注：' + note : '');
      await pool.query("INSERT INTO notifications (userId, type, content) VALUES ($1,'coin_reward',$2)", [userId, notifMsg]);
    } catch(e) {}
    res.json({ success: true });
  } catch(e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ message: '发放失败' }); }
  finally { client.release(); }
});

app.get('/api/admin/coin-transactions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT ct.*, u.coachName, u.username FROM coin_transactions ct LEFT JOIN users u ON ct.user_id = u.id ORDER BY ct.created_at DESC LIMIT 200');
    res.json({ transactions: result.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
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
    return res.status(400).json({ message: '请填写完整的认证信息' });
  }
  try {
    // 检查是否已有认证记录
    const existing = await pool.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    if (existing.rows.length > 0 && existing.rows[0].status !== 'rejected') {
      return res.status(400).json({ message: '你已有待审核或已通过的认证记录' });
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
    res.json({ success: true, message: '认证申请已提交，预计24小时内审核' });
  } catch(e) {
    console.error('[选手认证] 提交失败:', e.message);
    res.status(500).json({ message: '提交失败: ' + e.message });
  }
});

// 查询自己的认证状态
app.get('/api/player/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS club_name FROM players p LEFT JOIN clubs c ON p.club_id = c.id WHERE p.user_id = $1`,
      [req.userId]
    );
    res.json({ player: result.rows[0] || null });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// 管理员：获取所有认证申请
app.get('/api/admin/players', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.username, u.coachName FROM players p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.status ASC, p.created_at DESC`
    );
    res.json({ players: result.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// 管理员：审核选手认证
app.post('/api/admin/player-review', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !['approved','rejected'].includes(status)) return res.status(400).json({ message: '参数错误' });
  try {
    if (status === 'rejected') {
      await pool.query("UPDATE players SET status='rejected',reviewed_by=$1,reviewed_at=NOW() WHERE user_id=$2", [req.userId, userId]);
      return res.json({ success: true });
    }
    // 审批通过：取当前巅峰分/段位重新计算身价
    const player = await pool.query('SELECT * FROM players WHERE user_id = $1', [userId]);
    if (player.rows.length === 0) return res.status(404).json({ message: '选手不存在' });
    const p = player.rows[0];
    const marketValue = calcMarketValue(p.peak_score, p.game_rank);
    const grade = calcGrade(marketValue);
    await pool.query(
      "UPDATE players SET status='approved',market_value=$1,grade=$2,reviewed_by=$3,reviewed_at=NOW() WHERE user_id=$4",
      [marketValue, grade, req.userId, userId]
    );
    await sendNotification(userId, 'player_approved', `你的选手认证已通过！身价：${marketValue}万 等级：${grade}级`);
    res.json({ success: true, marketValue });
  } catch(e) { res.status(500).json({ message: '操作失败' }); }
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
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// ====================== 俱乐部系统 ======================

// 创建俱乐部（仅管理员）
app.post('/api/club/create', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, ownerId } = req.body;
  if (!name || !ownerId) return res.status(400).json({ message: '请填写俱乐部名称和老板ID' });
  try {
    const existing = await pool.query('SELECT * FROM clubs WHERE name = $1', [name]);
    if (existing.rows.length > 0) return res.status(400).json({ message: '俱乐部名称已存在' });
    const result = await pool.query(
      'INSERT INTO clubs (name, owner_id) VALUES ($1, $2) RETURNING id',
      [name, ownerId]
    );
    const clubId = result.rows[0].id;
    // 自动将老板加入队员名单
    await pool.query('INSERT INTO club_members (club_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [clubId, ownerId, 'boss']);
    res.json({ success: true, clubId });
  } catch(e) { res.status(500).json({ message: '创建失败' }); }
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
    res.json({ clubs: result.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// 俱乐部详情
app.get('/api/club/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const club = await pool.query(`
      SELECT c.*, u.username AS owner_username, u.coachName AS owner_name
      FROM clubs c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = $1
    `, [id]);
    if (club.rows.length === 0) return res.status(404).json({ message: '俱乐部不存在' });

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

    res.json({ club: club.rows[0], members: members.rows, transfers: transfers.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// 老板管理队员（移除队员）
app.post('/api/club/:id/manage', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action, userId } = req.body;
  try {
    // 验证是否为该俱乐部老板
    const club = await pool.query('SELECT * FROM clubs WHERE id = $1', [id]);
    if (club.rows.length === 0) return res.status(404).json({ message: '俱乐部不存在' });
    if (club.rows[0].owner_id !== req.userId && req.userId !== ADMIN_USER_ID) {
      return res.status(403).json({ message: '仅俱乐部老板可管理' });
    }
    if (action === 'remove') {
      await pool.query('DELETE FROM club_members WHERE club_id = $1 AND user_id = $2', [id, userId]);
      await pool.query('UPDATE players SET club_id = NULL WHERE user_id = $1', [userId]);
      res.json({ success: true, message: '队员已移除' });
    } else {
      res.status(400).json({ message: '未知操作' });
    }
  } catch(e) { res.status(500).json({ message: '操作失败' }); }
});

// ====================== 签约系统 ======================

// 签约选手（完整财务逻辑）
app.post('/api/club/sign', authMiddleware, async (req, res) => {
  const { playerUserId, clubId } = req.body;
  if (!playerUserId || !clubId) return res.status(400).json({ message: '参数不完整' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 验证选手已认证且未签约
    const player = await client.query("SELECT * FROM players WHERE user_id = $1 AND status = 'approved' FOR UPDATE", [playerUserId]);
    if (player.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '选手未通过认证或已不可签约' });
    }
    const p = player.rows[0];
    if (p.club_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '该选手已签约其他俱乐部' });
    }
    const feeWan = p.market_value; // 万为单位
    const fee = feeWan * 10000; // 转为梦币单位

    // 2. 验证俱乐部存在
    const club = await client.query('SELECT * FROM clubs WHERE id = $1 FOR UPDATE', [clubId]);
    if (club.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '俱乐部不存在' });
    }

    // 3. 验证老板余额
    const ownerId = club.rows[0].owner_id;
    if (ownerId !== req.userId && req.userId !== ADMIN_USER_ID) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: '仅俱乐部老板可签约' });
    }
    const boss = await client.query('SELECT dream_coins FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
    if (boss.rows.length === 0 || (boss.rows[0].dream_coins || 0) < fee) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '老板余额不足，签约需 ' + feeWan + ' 万梦币（实际扣' + fee + '）' });
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
    res.json({
      success: true,
      message: '签约成功！签约费 ' + feeWan + ' 万梦币',
      breakdown: { totalFeeWan: feeWan, totalFee: fee, playerShare, platformShare }
    });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('[签约失败]', e);
    res.status(500).json({ message: '签约失败: ' + e.message });
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
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
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
      await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct',$3)", [bossId, -group.total, '本周薪资支出，共' + group.players.length + '位选手']);
      for (const mp of group.players) {
        await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id=$2', [mp.salary, mp.userId]);
        await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'reward',$3)", [mp.userId, mp.salary, '周薪' + mp.grade + '级']);
        await pool.query('INSERT INTO salary_records (club_id, player_user_id, amount, grade, paid_by) VALUES ($1,$2,$3,$4,$5)', [group.clubId, mp.userId, mp.salary, mp.grade, bossId]);
        totalPaid += mp.salary;
      }
    }
    res.json({ success: true, totalPaid, clubs: byOwner });
  } catch(e) { console.error(e); res.status(500).json({ message: '发薪失败: ' + e.message }); }
});

app.get('/api/club/:id/salary-records', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT sr.*, u.coachName FROM salary_records sr LEFT JOIN users u ON sr.player_user_id=u.id WHERE sr.club_id=$1 ORDER BY sr.paid_at DESC LIMIT 100', [req.params.id]);
    res.json({ records: result.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

// ====================== 俱乐部大名单 ======================
app.get('/api/club/:id/roster', authMiddleware, async (req, res) => {
  try {
    const elite = await pool.query("SELECT cr.*, p.game_id, p.grade, p.market_value FROM club_rosters cr JOIN players p ON cr.player_user_id=p.user_id WHERE cr.club_id=$1 AND cr.tier='elite'", [req.params.id]);
    const secondary = await pool.query("SELECT cr.*, p.game_id, p.grade, p.market_value FROM club_rosters cr JOIN players p ON cr.player_user_id=p.user_id WHERE cr.club_id=$1 AND cr.tier='secondary'", [req.params.id]);
    res.json({ elite: elite.rows, secondary: secondary.rows });
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

app.put('/api/club/:id/roster', authMiddleware, async (req, res) => {
  const { tier, players } = req.body; // tier: 'elite'|'secondary', players: [userId,...]
  try {
    if (!['elite','secondary'].includes(tier)) return res.status(400).json({ message: '无效联赛等级' });
    if (!Array.isArray(players) || players.length > 5) return res.status(400).json({ message: '大名单最多5人' });
    // 校验选手已签约该俱乐部
    for (const uid of players) {
      const cm = await pool.query('SELECT * FROM club_members WHERE club_id=$1 AND user_id=$2', [req.params.id, uid]);
      if (cm.rows.length === 0) return res.status(400).json({ message: '选手' + uid + '未签约该俱乐部' });
    }
    // 清空旧名单
    await pool.query('DELETE FROM club_rosters WHERE club_id=$1 AND tier=$2', [req.params.id, tier]);
    // 插入新名单
    for (const uid of players) {
      await pool.query('INSERT INTO club_rosters (club_id, tier, player_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, tier, uid]);
    }
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ message: '设置失败' }); }
});

// ====================== 联赛报名校验 ======================
app.post('/api/competition/:id/register', authMiddleware, async (req, res) => {
  try {
    const comp = await pool.query('SELECT * FROM competitions WHERE id=$1', [req.params.id]);
    if (comp.rows.length === 0) return res.status(404).json({ message: '赛事不存在' });
    const c = comp.rows[0];
    const { clubId, playerIds } = req.body; // playerIds: 报名选手列表
    if (!clubId) return res.status(400).json({ message: '请选择俱乐部' });
    // 常规赛事无限制
    if (c.tier === 'regular') return res.json({ success: true, message: '报名成功' });
    // 顶级/次级联赛校验
    const allowedGrades = c.tier === 'elite' ? ['S','A'] : ['B'];
    const rosterTier = c.tier;
    for (const uid of playerIds) {
      const p = await pool.query('SELECT * FROM players WHERE user_id=$1 AND status=$2', [uid, 'approved']);
      if (p.rows.length === 0) return res.status(400).json({ message: '选手' + uid + '未通过认证' });
      if (!allowedGrades.includes(p.rows[0].grade)) return res.status(400).json({ message: '选手' + uid + '等级' + p.rows[0].grade + '不满足' + c.tier + '联赛参赛条件（需' + allowedGrades.join('/') + '级）' });
      const roster = await pool.query('SELECT * FROM club_rosters WHERE club_id=$1 AND tier=$2 AND player_user_id=$3', [clubId, rosterTier, uid]);
      if (roster.rows.length === 0) return res.status(400).json({ message: '选手' + uid + '不在俱乐部' + c.tier + '大名单中' });
    }
    res.json({ success: true, message: '报名成功' });
  } catch(e) { console.error(e); res.status(500).json({ message: '报名失败' }); }
});

// ====================== 解约/身价调整 ======================
app.post('/api/player/:userId/buyout', authMiddleware, async (req, res) => {
  try {
    const p = await pool.query('SELECT * FROM players WHERE user_id=$1', [req.params.userId]);
    if (p.rows.length === 0) return res.status(404).json({ message: '选手不存在' });
    if (p.rows[0].user_id !== req.userId) return res.status(403).json({ message: '只能自己解约' });
    if (!p.rows[0].club_id) return res.status(400).json({ message: '你当前无签约俱乐部' });
    const buyout = Math.floor(p.rows[0].market_value * 5000); // 身价(万)*50%*10000/10000 = market_value*5000梦币
    const user = await pool.query('SELECT dream_coins FROM users WHERE id=$1', [req.userId]);
    if ((user.rows[0]?.dream_coins || 0) < buyout) return res.status(400).json({ message: '余额不足，解约需' + buyout + '梦币' });
    await pool.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id=$2', [buyout, req.userId]);
    await pool.query("INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1,$2,'deduct',$3)", [req.userId, -buyout, '解约费（身价' + p.rows[0].market_value + '万的50%）']);
    const oldClubId = p.rows[0].club_id;
    await pool.query('UPDATE players SET club_id=NULL, buyout_fee=$1 WHERE user_id=$2', [buyout, req.userId]);
    await pool.query('DELETE FROM club_members WHERE club_id=$1 AND user_id=$2', [oldClubId, req.userId]);
    await pool.query('DELETE FROM club_rosters WHERE player_user_id=$1', [req.userId]);
    res.json({ success: true, buyout });
  } catch(e) { console.error(e); res.status(500).json({ message: '解约失败' }); }
});

// ====================== 赛事分级展示 ======================
// 重写 GET /api/competitions：按 tier 分组返回

async function startServer() {
  await initDB();
  console.log("✅ 数据库就绪");
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务运行在端口 ${PORT}`);
  });

  // 确认阶段超时检查：每分钟运行一次
  // 开赛前10分钟仍未确认的用户自动退出
  setInterval(async () => {
    try {
      const now = new Date();
      const tenMinMs = 10 * 60 * 1000;

      // 查找所有 confirming 状态的对局（内存中过滤时间）
      const allConfirming = await pool.query("SELECT * FROM recruitment_matches WHERE status = 'confirming'");
      const toProcess = allConfirming.rows.filter(m => {
        try {
          const startDate = new Date(m.starttime.replace(' ', 'T') + ':00');
          return startDate - now <= tenMinMs && startDate > now;
        } catch { return false; }
      });

      for (const m of toProcess) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // 找出未确认的人员
          const unconfirmed = await client.query(
            'SELECT playerId FROM recruitment_positions WHERE matchId = $1 AND confirmed = false',
            [m.id]
          );
          if (unconfirmed.rows.length > 0) {
            // 通知被踢出的人
            for (const p of unconfirmed.rows) {
              await sendNotification(p.playerid, 'recruitment_timeout',
                `训练赛 ${m.starttime} 即将开始，你未在规定时间内确认，已自动退出。`);
            }
            // 删除未确认人员
            await client.query('DELETE FROM recruitment_positions WHERE matchId = $1 AND confirmed = false', [m.id]);
            // 通知剩余的人
            const remaining = await client.query('SELECT playerId FROM recruitment_positions WHERE matchId = $1', [m.id]);
            if (remaining.rows.length < 10) {
              await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [m.id]);
              for (const p of remaining.rows) {
                await sendNotification(p.playerid, 'recruitment_dropped',
                  `有人超时未确认，训练赛 ${m.starttime} 已自动恢复招募。`);
              }
            } else {
              // 凑够10人，重新进入 confirming 阶段
              await client.query("UPDATE recruitment_matches SET status = 'confirming' WHERE id = $1", [m.id]);
              // 重置所有 confirmed 为 false
              await client.query('UPDATE recruitment_positions SET confirmed = false WHERE matchId = $1', [m.id]);
              for (const p of remaining.rows) {
                await sendNotification(p.playerid, 'recruitment_confirm',
                  `有人超时退出，训练赛 ${m.starttime} 重新凑齐10人，请重新确认。`);
              }
            }
          }
          await client.query('COMMIT');
          console.log(`[超时检查] 对局 ${m.id} 已处理`);
        } catch (e) {
          await client.query('ROLLBACK');
          console.error(`[超时检查] 对局 ${m.id} 处理失败:`, e.message);
        } finally {
          client.release();
        }
      }
    } catch (e) {
      console.error('[超时检查] 定时任务异常:', e.message);
    }
  }, 60 * 1000); // 每分钟检查一次
}

startServer();
