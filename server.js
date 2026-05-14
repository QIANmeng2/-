const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '';

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
        heroPool TEXT DEFAULT ''
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
    await client.query('ALTER TABLE schedules ADD COLUMN IF NOT EXISTS teamId TEXT');
    await client.query('ALTER TABLE recruitment_matches ADD COLUMN IF NOT EXISTS teamId TEXT');
  } finally { client.release(); }
}

// 万能跨域
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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
  await pool.query('INSERT INTO notifications (userId, type, content, relatedId) VALUES ($1,$2,$3,$4)', [userId, type, content, relatedId]);
}

// ====================== 招募系统接口 ======================

// 获取招募中的对局
app.get('/api/recruitment/active', async (req, res) => {
  try {
    const matches = await pool.query("SELECT * FROM recruitment_matches WHERE status = 'recruiting' ORDER BY createdAt DESC");
    if (matches.rows.length === 0) return res.json({ matches: [] });

    const matchIds = matches.rows.map(m => m.id);
    const positions = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = ANY($1)', [matchIds]);

    const orgIds = [...new Set(matches.rows.map(m => m.organizerid))];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = ANY($1)', [orgIds]);
    const orgMap = {};
    usersRes.rows.forEach(u => { orgMap[u.id] = u; });

    const posMap = {};
    positions.rows.forEach(p => {
      if (!posMap[p.matchid]) posMap[p.matchid] = [];
      posMap[p.matchid].push(p);
    });

    const result = matches.rows.map(m => {
      const pos = posMap[m.id] || [];
      const org = orgMap[m.organizerid] || {};
      return {
        id: m.id, startTime: m.starttime, levelReq: m.levelreq,
        notes: m.notes, mode: m.mode, status: m.status,
        organizer: { id: m.organizerid, teamName: org.teamname || '未知', coachName: org.coachname || '', level: org.level || '' },
        totalCount: pos.length,
        positions: pos.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }))
      };
    });
    res.json({ matches: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取已满对局
app.get('/api/recruitment/full', async (req, res) => {
  try {
    const matches = await pool.query("SELECT * FROM recruitment_matches WHERE status = 'full' ORDER BY createdAt DESC");
    if (matches.rows.length === 0) return res.json({ matches: [] });

    const matchIds = matches.rows.map(m => m.id);
    const positions = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = ANY($1)', [matchIds]);

    const orgIds = [...new Set(matches.rows.map(m => m.organizerid))];
    const usersRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = ANY($1)', [orgIds]);
    const orgMap = {};
    usersRes.rows.forEach(u => { orgMap[u.id] = u; });

    const posMap = {};
    positions.rows.forEach(p => {
      if (!posMap[p.matchid]) posMap[p.matchid] = [];
      posMap[p.matchid].push(p);
    });

    const result = matches.rows.map(m => {
      const pos = posMap[m.id] || [];
      const org = orgMap[m.organizerid] || {};
      return {
        id: m.id, startTime: m.starttime, levelReq: m.levelreq,
        notes: m.notes, mode: m.mode, status: m.status,
        organizer: { id: m.organizerid, teamName: org.teamname || '未知', coachName: org.coachname || '', level: org.level || '' },
        totalCount: pos.length,
        positions: pos.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }))
      };
    });
    res.json({ matches: result });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 获取对局详情
app.get('/api/recruitment/:id', async (req, res) => {
  try {
    const mRes = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) return res.status(404).json({ message: '对局不存在' });
    const m = mRes.rows[0];

    const posRes = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions = posRes.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }));

    const orgRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = $1', [m.organizerid]);
    const org = orgRes.rows[0] || {};

    res.json({
      match: {
        id: m.id, startTime: m.starttime, levelReq: m.levelreq, notes: m.notes,
        mode: m.mode, status: m.status, locked: m.locked,
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
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: '关闭失败' }); }
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

    // 检查是否满员（10人）
    const allPos = await client.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    if (allPos.rows.length >= 10) {
      await client.query("UPDATE recruitment_matches SET status = 'full', locked = true WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');

    const posRes = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = posRes.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }));
    const updated = await pool.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);

    res.json({
      success: true,
      match: { id: req.params.id, status: updated.rows[0].status, locked: updated.rows[0].locked },
      positions: positions_out,
      isFull: updated.rows[0].status === 'full'
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

    // 如果之前已满员，恢复为招募中
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length > 0 && mRes.rows[0].status === 'full') {
      await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');

    const allPos = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = allPos.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }));
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

// 清理占位（仅发起人，可清理恶意报名人员）
app.delete('/api/recruitment/:id/positions/:playerId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mRes = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (mRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '对局不存在' }); }
    if (mRes.rows[0].organizerid !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '仅发起人可清理' }); }

    await client.query('DELETE FROM recruitment_positions WHERE matchId = $1 AND playerId = $2', [req.params.id, req.params.playerId]);

    // 如果之前已满员，恢复为招募中
    const updated = await client.query('SELECT * FROM recruitment_matches WHERE id = $1', [req.params.id]);
    if (updated.rows.length > 0 && updated.rows[0].status === 'full') {
      await client.query("UPDATE recruitment_matches SET status = 'recruiting', locked = false WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');

    const allPos = await pool.query('SELECT * FROM recruitment_positions WHERE matchId = $1', [req.params.id]);
    const positions_out = allPos.rows.map(p => ({ team: p.team, lane: p.lane, playerId: p.playerid, playerName: p.playername }));
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
  const { username, password, teamName, coachName, wechat, level, bio } = req.body;
  if (!username || !password || !teamName || !coachName || !wechat) return res.status(400).json({ message: '信息不完整' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.status(400).json({ message: '用户名已存在' });
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const hashed = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO users (id, username, password, teamName, coachName, wechat, level, bio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, username, hashed, teamName, coachName, wechat, level || '大众', bio || '']);
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName, coachName, wechat, level: level || '大众', bio: bio || '', disabledDates: [], gameId: '', gameServer: '手Q区', gameRank: '星耀', peakScore: 0, laneStats: '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: '' } });
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
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, bio: u.bio, disabledDates: u.disableddates || [], gameId: u.gameid || '', gameServer: u.gameserver || '手Q区', gameRank: u.gamerank || '星耀', peakScore: u.peakscore || 0, laneStats: u.lanestats || '{"对抗路":"0","打野":"0","中路":"0","发育路":"0","游走":"0"}', heroPool: u.heropool || '' } });
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
    const result = await pool.query('SELECT id, teamName, coachName, level, bio FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, level: u.level, bio: u.bio } });
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

// 管理员获取所有用户
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, teamName, coachName, wechat, level, bio, gameId, gameServer, gameRank, peakScore, heroPool, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows.map(u => ({
      id: u.id, username: u.username, teamName: u.teamname, coachName: u.coachname,
      wechat: u.wechat, level: u.level, bio: u.bio, createdAt: u.created_at,
      gameId: u.gameid || '', gameServer: u.gameserver || '', gameRank: u.gamerank || '', peakScore: u.peakscore || 0, heroPool: u.heropool || ''
    })) });
  } catch (e) { console.error(e); res.status(500).json({ message: '加载失败' }); }
});

// 管理员删除用户
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '删除失败' }); }
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

    // 如果之前关闭了，重新开放
    if (t.status === 'closed') {
      await client.query("UPDATE teams SET status = 'open' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
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

    // 如果之前关闭了，重新开放
    if (tRes.rows[0].status === 'closed') {
      await client.query("UPDATE teams SET status = 'open' WHERE id = $1", [req.params.id]);
    }

    await client.query('COMMIT');
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

async function startServer() {
  await initDB();
  console.log("✅ 数据库就绪");
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务运行在端口 ${PORT}`);
  });
}

startServer();
