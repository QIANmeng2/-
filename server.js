const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./schedule.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    teamName TEXT NOT NULL,
    coachName TEXT NOT NULL,
    wechat TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    date TEXT NOT NULL,
    timeLabel TEXT NOT NULL,
    status TEXT DEFAULT 'available',
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ message: '登录已过期' });
  }
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, teamName, coachName, wechat } = req.body;
  if (!username || !password || !teamName || !coachName || !wechat) {
    return res.status(400).json({ message: '信息不完整' });
  }
  const userId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (err) return res.status(500).json({ message: '服务器错误' });
    if (row) return res.status(400).json({ message: '用户名已存在' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run('INSERT INTO users (id, username, password, teamName, coachName, wechat) VALUES (?,?,?,?,?,?)',
      [userId, username, hashedPassword, teamName, coachName, wechat],
      function(err) {
        if (err) return res.status(500).json({ message: '注册失败' });
        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: userId, teamName, coachName, wechat } });
      });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.status(500).json({ message: '服务器错误' });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ message: '用户名或密码错误' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat } });
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  db.get('SELECT id, teamName, coachName, wechat FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err || !user) return res.status(404).json({ message: '用户不存在' });
    res.json({ user });
  });
});

app.get('/api/schedules', (req, res) => {
  db.all(`
    SELECT schedules.id, schedules.date, schedules.timeLabel, schedules.status,
           users.teamName, users.coachName, users.wechat
    FROM schedules JOIN users ON schedules.userId = users.id
    ORDER BY date DESC, timeLabel ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ message: '加载失败' });
    const schedules = rows.map(row => ({
      id: row.id, date: row.date, timeLabel: row.timeLabel, status: row.status,
      team: { teamName: row.teamName, coachName: row.coachName, wechat: row.wechat }
    }));
    res.json({ schedules });
  });
});

app.get('/api/schedules/mine', authMiddleware, (req, res) => {
  db.all('SELECT id, date, timeLabel, status FROM schedules WHERE userId = ? ORDER BY date DESC', [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ message: '加载失败' });
    db.get('SELECT teamName, coachName, wechat FROM users WHERE id = ?', [req.userId], (err2, user) => {
      const schedules = rows.map(row => ({
        id: row.id, date: row.date, timeLabel: row.timeLabel, status: row.status,
        team: { teamName: user.teamName, coachName: user.coachName, wechat: user.wechat }
      }));
      res.json({ schedules });
    });
  });
});

app.post('/api/schedules', authMiddleware, (req, res) => {
  const { date, timeSlots } = req.body;
  if (!date || !timeSlots || timeSlots.length === 0) {
    return res.status(400).json({ message: '参数错误' });
  }
  const inserts = timeSlots.map(slot => {
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    return [id, req.userId, date, slot.label];
  });
  const stmt = db.prepare('INSERT INTO schedules (id, userId, date, timeLabel) VALUES (?,?,?,?)');
  inserts.forEach(i => stmt.run(i));
  stmt.finalize(err => {
    if (err) return res.status(500).json({ message: '发布失败' });
    res.json({ count: inserts.length });
  });
});

app.put('/api/schedules/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  db.run('UPDATE schedules SET status = ? WHERE id = ? AND userId = ?', [status, req.params.id, req.userId], function(err) {
    if (err) return res.status(500).json({ message: '修改失败' });
    if (this.changes === 0) return res.status(404).json({ message: '档期不存在' });
    res.json({ success: true });
  });
});

app.delete('/api/schedules/:id', authMiddleware, (req, res) => {
  db.run('DELETE FROM schedules WHERE id = ? AND userId = ?', [req.params.id, req.userId], function(err) {
    if (err) return res.status(500).json({ message: '删除失败' });
    if (this.changes === 0) return res.status(404).json({ message: '档期不存在' });
    res.json({ success: true });
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
