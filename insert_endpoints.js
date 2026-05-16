const fs = require('fs');
const path = require('path');

const serverPath = 'C:/Users/ASUS/WorkBuddy/2026-05-14-task-1/qianmeng-clone/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

const newCode = `
// ==================== 赛事管理 ====================
app.get('/api/competitions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM competitions WHERE status != 'deleted' ORDER BY created_at DESC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});

app.post('/api/admin/competitions', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, qr_code_url } = req.body;
  if (!name) return res.status(400).json({ message: '请填写赛事名称' });
  const id = 'comp_' + Date.now();
  try {
    await pool.query('INSERT INTO competitions (id, name, qr_code_url, created_by) VALUES ($1,$2,$3,$4)', [id, name, qr_code_url || null, req.userId]);
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
    await client.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [amount, userId]);
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
    res.json(result.rows);
  } catch(e) { res.status(500).json({ message: '查询失败' }); }
});
`;

// Insert before startServer()
const anchor = 'async function startServer() {';
if (!content.includes(anchor)) { console.error('Anchor not found!'); process.exit(1); }
content = content.replace(anchor, newCode + '\n' + anchor);
fs.writeFileSync(serverPath, content, 'utf8');
console.log('✅ New API endpoints inserted into server.js');
