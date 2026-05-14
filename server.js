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
        disabledDates TEXT[] DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
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
    `);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS disabledDates TEXT[] DEFAULT \'{}\'');
    await client.query('ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false');
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
  const { startTime, levelReq, notes, mode, positions } = req.body;
  if (!startTime) return res.status(400).json({ message: '请选择开赛时间' });
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO recruitment_matches (id, organizerId, startTime, levelReq, notes, mode) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.userId, startTime, levelReq || '不限', notes || '', mode || 1]
    );

    // 模式3：预占位置
    if (mode === 3 && positions && positions.length > 0) {
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
    res.json({ token, user: { id, teamName, coachName, wechat, level: level || '大众', bio: bio || '', disabledDates: [] } });
  } catch (e) { res.status(500).json({ message: '注册失败' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password)) return res.status(400).json({ message: '用户名或密码错误' });
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamname, coachName: user.coachname, wechat: user.wechat, level: user.level, bio: user.bio, disabledDates: user.disableddates || [] } });
  } catch (e) { res.status(500).json({ message: '登录失败' }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, bio: u.bio, disabledDates: u.disableddates || [] } });
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

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '删除失败' }); }
});

async function startServer() {
  await initDB();
  console.log("✅ 数据库就绪");
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务运行在端口 ${PORT}`);
  });
}

startServer();
