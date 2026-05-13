const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';

// 终极解决方案：直接使用 Supabase 数据库的 IPv4 地址，彻底绕过 DNS 解析
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
// 初始化数据表
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
        modification JSONB
      );
    `);
  } finally {
    client.release();
  }
}
initDB();

app.use(cors());
app.use(express.json());

// 认证中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' });
  }
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ message: '登录已过期' });
  }
}

// ==================== 用户相关 ====================
app.post('/api/auth/register', async (req, res) => {
  const { username, password, teamName, coachName, wechat, level } = req.body;
  if (!username || !password || !teamName || !coachName || !wechat) {
    return res.status(400).json({ message: '信息不完整' });
  }
  try {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.status(400).json({ message: '用户名已存在' });
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const hashed = bcrypt.hashSync(password, 10);
    await pool.query(
      'INSERT INTO users (id, username, password, teamName, coachName, wechat, level) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, username, hashed, teamName, coachName, wechat, level || '大众']
    );
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName, coachName, wechat, level: level || '大众', disabledDates: [] } });
  } catch (e) { res.status(500).json({ message: '注册失败' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password)) {
      return res.status(400).json({ message: '用户名或密码错误' });
    }
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamname, coachName: user.coachname, wechat: user.wechat, level: user.level, disabledDates: user.disableddates || [] } });
  } catch (e) { res.status(500).json({ message: '登录失败' }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const u = result.rows[0];
    res.json({ user: { id: u.id, teamName: u.teamname, coachName: u.coachname, wechat: u.wechat, level: u.level, disabledDates: u.disableddates || [] } });
  } catch (e) { res.status(500).json({ message: '获取失败' }); }
});

// 更新个人信息（等级、教练名、微信号）
app.put('/api/users/me', authMiddleware, async (req, res) => {
  const { coachName, wechat, level } = req.body;
  try {
    await pool.query(
      'UPDATE users SET coachName = COALESCE($1, coachName), wechat = COALESCE($2, wechat), level = COALESCE($3, level) WHERE id = $4',
      [coachName || null, wechat || null, level || null, req.userId]
    );
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
    if (index === -1) disabled.push(date);
    else disabled.splice(index, 1);
    await pool.query('UPDATE users SET disabledDates = $1 WHERE id = $2', [disabled, req.userId]);
    res.json({ disabledDates: disabled });
  } catch (e) { res.status(500).json({ message: '操作失败' }); }
});

// ==================== 档期广场 ====================
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedules WHERE status = 'available'");
    const schedules = await Promise.all(result.rows.map(async (s) => {
      const userRes = await pool.query('SELECT teamName, coachName, level FROM users WHERE id = $1', [s.userid]);
      const user = userRes.rows[0] || {};
      return {
        id: s.id,
        date: s.date,
        startTime: s.starttime,
        mode: s.mode,
        globalBp: s.globalbp,
        status: s.status,
        applicantCount: (s.applicants || []).length,
        team: { teamName: user.teamname, coachName: user.coachname, level: user.level }
      };
    }));
    res.json({ schedules });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

// ==================== 我的日程（包含双方） ====================
app.get('/api/schedules/mine', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM schedules WHERE userId = $1 OR (confirmedApplicant = $1 AND status = 'confirmed')`,
      [req.userId]
    );
    const schedules = [];
    for (const s of result.rows) {
      const pubUser = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = $1', [s.userid]);
      const publisher = pubUser.rows[0] || {};
      let opponent = null;
      if (s.confirmedapplicant) {
        const oppRes = await pool.query('SELECT id, teamName, coachName, level FROM users WHERE id = $1', [s.confirmedapplicant]);
        opponent = oppRes.rows[0] || null;
      }
      schedules.push({
        id: s.id,
        date: s.date,
        startTime: s.starttime,
        mode: s.mode,
        globalBp: s.globalbp,
        status: s.status,
        publisher: { id: publisher.id, teamName: publisher.teamname, coachName: publisher.coachname, level: publisher.level },
        opponent: opponent ? { id: opponent.id, teamName: opponent.teamname, coachName: opponent.coachname, level: opponent.level } : null,
        modification: s.modification,
        isPublisher: s.userid === req.userId
      });
    }
    const user = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    res.json({ schedules, disabledDates: user.rows[0]?.disableddates || [] });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

// 发布档期
app.post('/api/schedules', authMiddleware, async (req, res) => {
  const { date, startTime, mode, globalBp } = req.body;
  if (!date || !startTime) return res.status(400).json({ message: '请填写日期和时间' });
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  try {
    await pool.query(
      'INSERT INTO schedules (id, userId, date, startTime, mode, globalBp) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.userId, date, startTime, mode || 'bo1', globalBp || false]
    );
    res.json({ schedule: { id, date, startTime, mode, globalBp } });
  } catch (e) { res.status(500).json({ message: '发布失败' }); }
});

// 申请约队
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
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '申请失败' }); }
});

// 确认申请者
app.put('/api/schedules/:id/confirm-applicant', authMiddleware, async (req, res) => {
  const { applicantId } = req.body;
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    if (!sRes.rows[0].applicants || !sRes.rows[0].applicants.includes(applicantId)) {
      return res.status(400).json({ message: '该用户未申请' });
    }
    await pool.query(
      "UPDATE schedules SET status = 'confirmed', confirmedApplicant = $1, applicants = '{}' WHERE id = $2",
      [applicantId, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '确认失败' }); }
});

// 发起修改请求
app.post('/api/schedules/:id/modify-request', authMiddleware, async (req, res) => {
  const { type, newTime } = req.body;  // type: 'cancel' 或 'modify'
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (schedule.status !== 'confirmed') return res.status(400).json({ message: '只有已确认的档期才能修改' });
    // 必须是双方之一
    if (req.userId !== schedule.userid && req.userId !== schedule.confirmedapplicant) {
      return res.status(403).json({ message: '无权修改' });
    }
    const modification = {
      type,
      newTime: newTime || null,
      fromUserId: req.userId,
      status: 'pending'
    };
    await pool.query('UPDATE schedules SET modification = $1 WHERE id = $2', [modification, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '发起修改失败' }); }
});

// 处理修改请求（同意/拒绝）
app.put('/api/schedules/:id/modify-response', authMiddleware, async (req, res) => {
  const { action } = req.body;  // 'accept' 或 'reject'
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (!schedule.modification || schedule.modification.status !== 'pending') {
      return res.status(400).json({ message: '没有待处理的修改请求' });
    }
    // 只能是对方操作
    const otherUserId = schedule.modification.fromUserId === schedule.userid ? schedule.confirmedapplicant : schedule.userid;
    if (req.userId !== otherUserId) return res.status(403).json({ message: '只有对方可以处理请求' });

    if (action === 'accept') {
      if (schedule.modification.type === 'cancel') {
        await pool.query("UPDATE schedules SET status = 'cancelled', modification = NULL WHERE id = $1", [req.params.id]);
      } else if (schedule.modification.type === 'modify') {
        await pool.query(
          "UPDATE schedules SET startTime = $1, modification = NULL WHERE id = $2",
          [schedule.modification.newTime, req.params.id]
        );
      }
    } else {
      await pool.query('UPDATE schedules SET modification = NULL WHERE id = $1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '处理失败' }); }
});

// 重新发布已取消的档期（回到广场）
app.post('/api/schedules/:id/republish', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    if (sRes.rows[0].status !== 'cancelled') return res.status(400).json({ message: '只有已取消的档期才能重新发布' });
    await pool.query("UPDATE schedules SET status = 'available', confirmedApplicant = NULL WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '重新发布失败' }); }
});

app.delete('/api/schedules/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '档期不存在' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '删除失败' }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
