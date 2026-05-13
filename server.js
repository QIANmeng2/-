const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-me';

app.use(cors());
app.use(express.json());

// JSON 文件数据库
const DB_PATH = path.join(__dirname, 'data.json');
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], schedules: [] }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

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
app.post('/api/auth/register', (req, res) => {
  const { username, password, teamName, coachName, wechat } = req.body;
  if (!username || !password || !teamName || !coachName || !wechat) {
    return res.status(400).json({ message: '信息不完整' });
  }
  const db = readDB();
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }
  const newUser = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    username,
    password: bcrypt.hashSync(password, 10),
    teamName,
    coachName,
    wechat
  };
  db.users.push(newUser);
  writeDB(db);
  const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, teamName, coachName, wechat } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ message: '用户名或密码错误' });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  res.json({ user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat } });
});

// ==================== 档期相关 ====================

// 获取所有**可申请**的档期（status = 'available'）
app.get('/api/schedules', (req, res) => {
  const db = readDB();
  const available = db.schedules.filter(s => s.status === 'available');
  const schedules = available.map(s => {
    const user = db.users.find(u => u.id === s.userId);
    return {
      id: s.id,
      date: s.date,
      timeLabel: s.timeLabel,     // 例如 "14:30-16:00"
      status: s.status,
      team: user ? { teamName: user.teamName, coachName: user.coachName, wechat: user.wechat } : null
    };
  });
  res.json({ schedules });
});

// 获取我的档期（所有状态）
app.get('/api/schedules/mine', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.userId);
  const schedules = db.schedules
    .filter(s => s.userId === req.userId)
    .map(s => {
      let applicantInfo = null;
      if (s.applicantUserId) {
        const applicant = db.users.find(u => u.id === s.applicantUserId);
        if (applicant) {
          applicantInfo = { teamName: applicant.teamName, coachName: applicant.coachName, wechat: applicant.wechat };
        }
      }
      return {
        id: s.id,
        date: s.date,
        timeLabel: s.timeLabel,
        status: s.status,
        applicant: applicantInfo,
        team: { teamName: user.teamName, coachName: user.coachName, wechat: user.wechat }
      };
    });
  res.json({ schedules });
});

// 发布档期
app.post('/api/schedules', authMiddleware, (req, res) => {
  const { date, startTime, endTime } = req.body;   // 改为具体开始/结束时间
  if (!date || !startTime || !endTime) {
    return res.status(400).json({ message: '请完整填写日期和时间' });
  }
  const db = readDB();
  const newSchedule = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    userId: req.userId,
    date,
    timeLabel: `${startTime}-${endTime}`,
    status: 'available',
    applicantUserId: null
  };
  db.schedules.push(newSchedule);
  writeDB(db);
  res.json({ schedule: newSchedule });
});

// 申请约队（其他教练点击）
app.post('/api/schedules/:id/apply', authMiddleware, (req, res) => {
  const db = readDB();
  const schedule = db.schedules.find(s => s.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  if (schedule.userId === req.userId) return res.status(400).json({ message: '不能申请自己的档期' });
  if (schedule.status !== 'available') return res.status(400).json({ message: '该档期已被申请或已约' });

  schedule.status = 'pending';
  schedule.applicantUserId = req.userId;
  writeDB(db);
  res.json({ success: true });
});

// 确认申请（发布者操作）
app.put('/api/schedules/:id/confirm', authMiddleware, (req, res) => {
  const db = readDB();
  const schedule = db.schedules.find(s => s.id === req.params.id && s.userId === req.userId);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  if (schedule.status !== 'pending') return res.status(400).json({ message: '当前状态无法确认' });

  schedule.status = 'confirmed';   // 已约
  writeDB(db);
  res.json({ success: true });
});

// 拒绝申请（发布者操作，恢复为可约）
app.put('/api/schedules/:id/reject', authMiddleware, (req, res) => {
  const db = readDB();
  const schedule = db.schedules.find(s => s.id === req.params.id && s.userId === req.userId);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  if (schedule.status !== 'pending') return res.status(400).json({ message: '当前状态无法拒绝' });

  schedule.status = 'available';
  schedule.applicantUserId = null;
  writeDB(db);
  res.json({ success: true });
});

// 删除档期
app.delete('/api/schedules/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const index = db.schedules.findIndex(s => s.id === req.params.id && s.userId === req.userId);
  if (index === -1) return res.status(404).json({ message: '档期不存在' });
  db.schedules.splice(index, 1);
  writeDB(db);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
