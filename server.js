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

// ========== 持久化数据文件 ==========
// Railway Volume 挂载到 /data，数据文件存在那里
const DB_PATH = path.join('/data', 'data.json');

// 确保 /data 目录存在
if (!fs.existsSync('/data')) {
  fs.mkdirSync('/data');
}

// 内存数据库缓存
let MEMORY_DB = { users: [], schedules: [] };

function loadFromDisk() {
  if (fs.existsSync(DB_PATH)) {
    try {
      MEMORY_DB = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (e) {
      MEMORY_DB = { users: [], schedules: [] };
    }
  }
}
function saveToDisk() {
  fs.writeFileSync(DB_PATH, JSON.stringify(MEMORY_DB, null, 2));
}

// 定时存盘（每 5 秒）
setInterval(saveToDisk, 5000);
process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });
process.on('SIGINT', () => { saveToDisk(); process.exit(0); });

// 启动时加载
loadFromDisk();

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
  if (MEMORY_DB.users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }
  const newUser = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    username,
    password: bcrypt.hashSync(password, 10),
    teamName,
    coachName,
    wechat,
    disabledDates: []
  };
  MEMORY_DB.users.push(newUser);
  saveToDisk();
  const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, teamName, coachName, wechat, disabledDates: [] } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = MEMORY_DB.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ message: '用户名或密码错误' });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat, disabledDates: user.disabledDates || [] } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = MEMORY_DB.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  res.json({ user: { id: user.id, teamName: user.teamName, coachName: user.coachName, wechat: user.wechat, disabledDates: user.disabledDates || [] } });
});

app.put('/api/users/me/disabled-dates', authMiddleware, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ message: '日期不能为空' });
  const user = MEMORY_DB.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  if (!user.disabledDates) user.disabledDates = [];
  const index = user.disabledDates.indexOf(date);
  if (index === -1) user.disabledDates.push(date);
  else user.disabledDates.splice(index, 1);
  saveToDisk();
  res.json({ disabledDates: user.disabledDates });
});

// ==================== 档期相关（多人申请） ====================

// 获取所有可申请的档期（status = 'available'）
app.get('/api/schedules', (req, res) => {
  const available = MEMORY_DB.schedules.filter(s => s.status === 'available');
  const schedules = available.map(s => {
    const user = MEMORY_DB.users.find(u => u.id === s.userId);
    const applicants = (s.applicants || []).map(aid => {
      const applicant = MEMORY_DB.users.find(u => u.id === aid);
      return applicant ? { id: applicant.id, teamName: applicant.teamName, coachName: applicant.coachName, wechat: applicant.wechat } : null;
    }).filter(Boolean);
    return {
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      mode: s.mode || 'bo1',
      globalBp: s.globalBp || false,
      status: s.status,
      applicantCount: applicants.length,
      team: user ? { teamName: user.teamName, coachName: user.coachName, wechat: user.wechat } : null
    };
  });
  res.json({ schedules });
});

// 获取我的档期（全部状态，包含申请者列表）
app.get('/api/schedules/mine', authMiddleware, (req, res) => {
  const user = MEMORY_DB.users.find(u => u.id === req.userId);
  const schedules = MEMORY_DB.schedules
    .filter(s => s.userId === req.userId)
    .map(s => {
      const applicants = (s.applicants || []).map(aid => {
        const applicant = MEMORY_DB.users.find(u => u.id === aid);
        return applicant ? { id: applicant.id, teamName: applicant.teamName, coachName: applicant.coachName, wechat: applicant.wechat } : null;
      }).filter(Boolean);
      return {
        id: s.id,
        date: s.date,
        startTime: s.startTime,
        mode: s.mode || 'bo1',
        globalBp: s.globalBp || false,
        status: s.status,
        applicants,
        confirmedApplicant: s.confirmedApplicant || null,  // 被确认的申请者 ID
        team: { teamName: user.teamName, coachName: user.coachName, wechat: user.wechat }
      };
    });
  res.json({ schedules, disabledDates: user.disabledDates || [] });
});

// 发布档期
app.post('/api/schedules', authMiddleware, (req, res) => {
  const { date, startTime, mode, globalBp } = req.body;
  if (!date || !startTime) {
    return res.status(400).json({ message: '请填写日期和时间' });
  }
  const newSchedule = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
    userId: req.userId,
    date,
    startTime,
    mode: mode || 'bo1',
    globalBp: globalBp || false,
    status: 'available',
    applicants: [],          // 申请者 userId 数组
    confirmedApplicant: null
  };
  MEMORY_DB.schedules.push(newSchedule);
  saveToDisk();
  res.json({ schedule: newSchedule });
});

// 申请档期（允许多人）
app.post('/api/schedules/:id/apply', authMiddleware, (req, res) => {
  const schedule = MEMORY_DB.schedules.find(s => s.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  if (schedule.userId === req.userId) return res.status(400).json({ message: '不能申请自己的档期' });
  if (schedule.status !== 'available') return res.status(400).json({ message: '该档期不可申请' });
  if (!schedule.applicants) schedule.applicants = [];
  if (schedule.applicants.includes(req.userId)) return res.status(400).json({ message: '你已经申请过了' });
  schedule.applicants.push(req.userId);
  saveToDisk();
  res.json({ success: true });
});

// 发布者确认某一个申请者
app.put('/api/schedules/:id/confirm-applicant', authMiddleware, (req, res) => {
  const schedule = MEMORY_DB.schedules.find(s => s.id === req.params.id && s.userId === req.userId);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  const { applicantId } = req.body;
  if (!applicantId) return res.status(400).json({ message: '缺少申请者 ID' });
  if (!schedule.applicants || !schedule.applicants.includes(applicantId)) {
    return res.status(400).json({ message: '该用户未申请' });
  }
  schedule.status = 'confirmed';
  schedule.confirmedApplicant = applicantId;
  // 可选：清除其他申请者，但保留申请记录
  saveToDisk();
  res.json({ success: true });
});

// 拒绝某个申请者（只是从 applicants 里移除，如果只剩一个可以选择拒绝并恢复）
app.put('/api/schedules/:id/reject-applicant', authMiddleware, (req, res) => {
  const schedule = MEMORY_DB.schedules.find(s => s.id === req.params.id && s.userId === req.userId);
  if (!schedule) return res.status(404).json({ message: '档期不存在' });
  const { applicantId } = req.body;
  if (schedule.status !== 'available') return res.status(400).json({ message: '档期状态不可操作' });
  if (!schedule.applicants) schedule.applicants = [];
  const index = schedule.applicants.indexOf(applicantId);
  if (index === -1) return res.status(400).json({ message: '未找到该申请者' });
  schedule.applicants.splice(index, 1);
  saveToDisk();
  res.json({ success: true });
});

// 删除档期
app.delete('/api/schedules/:id', authMiddleware, (req, res) => {
  const index = MEMORY_DB.schedules.findIndex(s => s.id === req.params.id && s.userId === req.userId);
  if (index === -1) return res.status(404).json({ message: '档期不存在' });
  MEMORY_DB.schedules.splice(index, 1);
  saveToDisk();
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
