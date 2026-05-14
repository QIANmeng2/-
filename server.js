const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@postgres.railway.internal:5432/railway',
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
    `);

    // 自动修复数据库缺失列，解决所有报错
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT \'\'');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS disabledDates TEXT[] DEFAULT \'{}\'');
    await client.query('ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false');

  } finally { client.release(); }
}

// 全局中间件
app.use(cors());
app.use(express.json());

// 登录验证中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ message: '未登录' });
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch { return res.status(401).json({ message: '登录已过期' }); }
}

// 管理员中间件
async function adminMiddleware(req, res, next) {
  if (req.userId !== ADMIN_USER_ID) return res.status(403).json({ message: '无管理员权限' });
  next();
}

// 发送通知函数
async function sendNotification(userId, type, content, relatedId = null) {
  await pool.query('INSERT INTO notifications (userId, type, content, relatedId) VALUES ($1,$2,$3,$4)', [userId, type, content, relatedId]);
}

// ---------- 用户 ----------
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

// ---------- 通知 ----------
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

// ---------- 档期广场 ----------
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

// 发布档期
app.post('/api/schedules', authMiddleware, async (req, res) => {
  const { date, startTime, mode, globalBp } = req.body;
  if (!date || !startTime) return res.status(400).json({ message: '请填写日期和时间' });
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  try {
    await pool.query('INSERT INTO schedules (id, userId, date, startTime, mode, globalBp) VALUES ($1,$2,$3,$4,$5,$6)', [id, req.userId, date, startTime, mode || 'bo1', globalBp || false]);
    res.json({ schedule: { id, date, startTime, mode, globalBp } });
  } catch (e) { res.status(500).json({ message: '发布失败' }); }
});

// 发布人取消自己发布的档期
app.delete('/api/schedules/:id/cancel-post', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在或无权操作' });
    const schedule = sRes.rows[0];
    if (schedule.status === 'confirmed') return res.status(400).json({ message: '已确认的档期请使用取消训练功能' });
    if (schedule.applicants && schedule.applicants.length > 0) {
      for (const appId of schedule.applicants) {
        await sendNotification(appId, 'schedule_cancelled', `你申请的档期 ${schedule.date} ${schedule.starttime} 已被发布者取消`);
      }
    }
    await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '取消失败' }); }
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
    await sendNotification(schedule.userid, 'new_apply', `有人申请了你的档期 ${schedule.date} ${schedule.starttime}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '申请失败' }); }
});

// 确认申请者
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

// 撤回确认
app.put('/api/schedules/:id/unconfirm', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query("SELECT * FROM schedules WHERE id = $1 AND userId = $2 AND status = 'confirmed'", [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在或未确认' });
    await pool.query("UPDATE schedules SET status = 'available', confirmedApplicant = NULL, is_public = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '撤回失败' }); }
});

// 直接取消训练
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

// 直接修改时间
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

// 切换公开
app.put('/api/schedules/:id/toggle-public', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query("SELECT * FROM schedules WHERE id = $1 AND userId = $2 AND status = 'confirmed'", [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    const current = sRes.rows[0].is_public;
    await pool.query('UPDATE schedules SET is_public = NOT is_public WHERE id = $1', [req.params.id]);
    res.json({ isPublic: !current });
  } catch (e) { res.status(500).json({ message: '修改失败' }); }
});

// 重新发布
app.post('/api/schedules/:id/republish', authMiddleware, async (req, res) => {
  try {
    const sRes = await pool.query('SELECT * FROM schedules WHERE id = $1 AND userId = $2', [req.params.id, req.userId]);
    if (sRes.rows.length === 0) return res.status(404).json({ message: '档期不存在' });
    if (sRes.rows[0].status !== 'cancelled') return res.status(400).json({ message: '只有已取消的档期才能重新发布' });
    await pool.query("UPDATE schedules SET status = 'available', confirmedApplicant = NULL, applicants = '{}', modification = NULL, is_public = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: '重新发布失败' }); }
});

// ---------- 管理员 ----------
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

// 启动服务
async function startServer() {
  await initDB();
  console.log("✅ 数据库表创建成功");
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 服务已启动: ${PORT}`));
}
startServer();
