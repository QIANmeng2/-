const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Pool } = require('pg');  // 用 PostgreSQL 客户端

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';

// ========== 连接 Supabase 数据库 ==========
const pool = new Pool({
  connectionString: 'postgresql://postgres:[YOUR-PASSWORD]@db.kfgqinvoxzgdsdjsdpkl.supabase.co:5432/postgres',  // ⚠️ 替换这里！！！
  ssl: { rejectUnauthorized: false }
});

// 初始化数据表（第一次运行自动创建）
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
        confirmedApplicant TEXT
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

// ==================== 用户注册 / 登录 ====================
app.post('/api/auth/register', async (req, res) => {
  const { username, password, teamName, coachName, wechat } = req.body;
  if (!username || !password || !teamName || !coachName || !wechat) {
    return res.status(400).json({ message: '信息不完整' });
  }
  try {
    const userExists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    const hashedPassword = bcrypt.hashSync(password, 10);
    await pool.query(
      'INSERT INTO users (id, username, password, teamName, coachName, wechat) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, username, hashedPassword, teamName, coachName, wechat]
    );
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, teamName, coachName, wechat, disabledDates: [] } });
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
    res.json({ token, user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat, disabledDates: user.disabledDates || [] } });
  } catch (e) { res.status(500).json({ message: '登录失败' }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ message: '用户不存在' });
    const user = result.rows[0];
    res.json({ user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat, disabledDates: user.disabledDates || [] } });
  } catch (e) { res.status(500).json({ message: '获取用户失败' }); }
});

app.put('/api/users/me/disabled-dates', authMiddleware, async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ message: '日期不能为空' });
  try {
    const userRes = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    let disabled = userRes.rows[0].disableddates || [];
    const index = disabled.indexOf(date);
    if (index === -1) disabled.push(date);
    else disabled.splice(index, 1);
    await pool.query('UPDATE users SET disabledDates = $1 WHERE id = $2', [disabled, req.userId]);
    res.json({ disabledDates: disabled });
  } catch (e) { res.status(500).json({ message: '操作失败' }); }
});

// ==================== 档期相关 ====================
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedules WHERE status = 'available'");
    const schedules = await Promise.all(result.rows.map(async (s) => {
      const userRes = await pool.query('SELECT teamName, coachName, wechat FROM users WHERE id = $1', [s.userid]);
      const user = userRes.rows[0] || {};
      return {
        id: s.id,
        date: s.date,
        startTime: s.starttime,
        mode: s.mode,
        globalBp: s.globalbp,
        status: s.status,
        applicantCount: (s.applicants || []).length,
        team: { teamName: user.teamname, coachName: user.coachname, wechat: user.wechat }
      };
    }));
    res.json({ schedules });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

app.get('/api/schedules/mine', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schedules WHERE userId = $1', [req.userId]);
    const userRes = await pool.query('SELECT teamName, coachName, wechat FROM users WHERE id = $1', [req.userId]);
    const user = userRes.rows[0] || {};
    const schedules = await Promise.all(result.rows.map(async (s) => {
      let applicants = [];
      if (s.applicants && s.applicants.length > 0) {
        const appRes = await pool.query('SELECT id, teamName, coachName, wechat FROM users WHERE id = ANY($1)', [s.applicants]);
        applicants = appRes.rows.map(a => ({ id: a.id, teamName: a.teamname, coachName: a.coachname, wechat: a.wechat }));
      }
      return {
        id: s.id,
        date: s.date,
        startTime: s.starttime,
        mode: s.mode,
        globalBp: s.globalbp,
        status: s.status,
        applicants,
        confirmedApplicant: s.confirmedapplicant,
        team: { teamName: user.teamname, coachName: user.coachname, wechat: user.wechat }
      };
    }));
    const userRow = await pool.query('SELECT disabledDates FROM users WHERE id = $1', [req.userId]);
    res.json({ schedules, disabledDates: userRow.rows[0]?.disableddates || [] });
  } catch (e) { res.status(500).json({ message: '加载失败' }); }
});

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

app.put('/api/schedules/:id/confirm-applicant', authMiddleware, async (req, res) => {
  const { applicantId } = req.body;
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const schedule = sRes.rows[0];
    if (!schedule.applicants || !schedule.applicants.includes(applicantId)) {
      return res.status(400).json({ message: '该用户未申请' });
    }
    await pool.query("UPDATE schedules SET status = 'confirmed', confirmedApplicant = $1 WHERE id = $2", [applicantId, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '确认失败' }); }
});

app.put('/api/schedules/:id/reject-applicant', authMiddleware, async (req, res) => {
  const { applicantId } = req.body;
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    let applicants = sRes.rows[0].applicants || [];
    const index = applicants.indexOf(applicantId);
    if (index === -1) return res.status(400).json({ message: '未找到该申请者' });
    applicants.splice(index, 1);
    await pool.query('UPDATE schedules SET applicants = $1 WHERE id = $2', [applicants, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '拒绝失败' }); }
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
