/**
 * routes/matches.js
 * 赛事系统重构 —— Match 基础路由
 * 第一阶段：只做 CRUD + 状态转换，不堆复杂逻辑
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../server'); // 复用连接池
const { MATCH_STATUS, isValidTransition, getNextStates, isValidStatus } = require('../utils/matchState');

// ===== 工具函数 =====

/** 读取 Authorization -> userId，失败抛 401 */
function requireAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: '未登录' });
    return null;
  }
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET || 'your-secret-key-change-me');
    return payload.userId;
  } catch {
    res.status(401).json({ success: false, message: '登录已过期' });
    return null;
  }
}

/** 检查是否为管理员 */
function requireAdmin(req, res, userId) {
  if (userId !== (process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6')) {
    res.status(403).json({ success: false, message: '无权限' });
    return false;
  }
  return true;
}

// ===== 路由 =====

/**
 * GET /matches
 * 查询比赛列表（支持按 status 过滤）
 * 查询参数：?status=LIVE&limit=20&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    let query = 'SELECT * FROM matches ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    let params = [parseInt(limit), parseInt(offset)];
    if (status) {
      query = 'SELECT * FROM matches WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params = [status, parseInt(limit), parseInt(offset)];
    }
    const result = await pool.query(query, params);
    res.json({ success: true, matches: result.rows });
  } catch (err) {
    console.error('[GET /matches]', err);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /matches/:id
 * 查询单场比赛详情（含参与者）
 */
router.get('/:id', async (req, res) => {
  try {
    const matchResult = await pool.query('SELECT * FROM matches WHERE id = $1', [req.params.id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    const match = matchResult.rows[0];
    // 查询参与者
    const participants = await pool.query(
      'SELECT * FROM match_participants WHERE match_id = $1 ORDER BY joined_at ASC',
      [req.params.id]
    );
    match.participants = participants.rows;
    res.json({ success: true, match });
  } catch (err) {
    console.error('[GET /matches/:id]', err);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * POST /matches
 * 创建比赛（需要登录）
 * Body: { title, mode, description, bo, start_time }
 */
router.post('/', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const { title, mode = 'training', description = '', bo = 1, start_time = null } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title 必填' });

    const id = require('crypto').randomUUID();
    const result = await pool.query(`
      INSERT INTO matches (id, title, mode, status, created_by, description, bo, start_time, created_at, updated_at)
      VALUES ($1, $2, $3, 'CREATED', $4, $5, $6, $7, NOW(), NOW())
      RETURNING *;
    `, [id, title, mode, userId, description, bo, start_time]);

    res.status(201).json({ success: true, match: result.rows[0] });
  } catch (err) {
    console.error('[POST /matches]', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

/**
 * PATCH /matches/:id/status
 * 更新比赛状态（状态机驱动）
 * Body: { status: "REGISTERING" }
 */
router.patch('/:id/status', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const newStatus = (req.body.status || '').toUpperCase();
    if (!newStatus) return res.status(400).json({ success: false, message: 'status 必填' });

    // 先查当前状态
    const current = await pool.query('SELECT * FROM matches WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    const match = current.rows[0];
    const currentStatus = match.status.toUpperCase();

    // 权限：只有创建者或管理员可以操作
    const isAdmin = userId === (process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6');
    if (match.created_by !== userId && !isAdmin) {
      return res.status(403).json({ success: false, message: '无权限' });
    }

    // ✅ 状态机校验：检查转换是否合法
    if (!isValidTransition(currentStatus, newStatus)) {
      const nextStates = getNextStates(currentStatus).join(', ') || '无（终态）';
      return res.status(400).json({
        success: false,
        message: `非法状态转换：${currentStatus} → ${newStatus}。允许转换：${nextStates}`
      });
    }

    // 执行更新（乐观锁）
    const result = await pool.query(`
      UPDATE matches SET status = $1, updated_at = NOW()
      WHERE id = $2 AND status = $3
      RETURNING *;
    `, [newStatus, req.params.id, currentStatus]);

    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, message: '状态已变更，请刷新重试' });
    }

    res.json({ success: true, match: result.rows[0] });
  } catch (err) {
    console.error('[PATCH /matches/:id/status]', err);
    res.status(500).json({ success: false, message: '状态更新失败' });
  }
});

/**
 * POST /matches/:id/participants
 * 报名/加入比赛
 * Body: { user_id, side, lane, club_id }
 */
router.post('/:id/participants', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const { side = 'neutral', lane = '', club_id = null } = req.body;
    const matchId = req.params.id;

    // 检查比赛是否存在且状态允许报名
    const match = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (match.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    if (!['CREATED','REGISTERING'].includes(match.rows[0].status)) {
      return res.status(400).json({ success: false, message: '当前状态不允许报名' });
    }

    // 插入参与者（ON CONFLICT DO NOTHING 防重复）
    await pool.query(`
      INSERT INTO match_participants (match_id, user_id, side, lane, club_id, joined_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (match_id, user_id) DO NOTHING;
    `, [matchId, userId, side, lane, club_id]);

    res.json({ success: true, message: '报名成功' });
  } catch (err) {
    console.error('[POST /matches/:id/participants]', err);
    res.status(500).json({ success: false, message: '报名失败' });
  }
});

/**
 * PATCH /matches/:id/score
 * 更新比分（LIVE 状态下）
 * Body: { score: { red: 1, blue: 0 }, mvp_id }
 */
router.patch('/:id/score', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const { score, mvp_id = null } = req.body;
    const matchId = req.params.id;

    // 只有 LIVE 状态可以更新比分
    const match = await pool.query('SELECT * FROM matches WHERE id = $1 AND status = $2', [matchId, 'LIVE']);
    if (match.rows.length === 0) {
      return res.status(400).json({ success: false, message: '只有 LIVE 状态的比赛可以更新比分' });
    }

    const updates = [];
    const params = [];
    if (score) {
      updates.push('score = $1');
      params.push(JSON.stringify(score));
    }
    if (mvp_id) {
      updates.push('mvp_id = $' + (params.length + 1));
      params.push(mvp_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }

    params.push(matchId);
    const result = await pool.query(`
      UPDATE matches SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING *;
    `, params);

    res.json({ success: true, match: result.rows[0] });
  } catch (err) {
    console.error('[PATCH /matches/:id/score]', err);
    res.status(500).json({ success: false, message: '更新比分失败' });
  }
});

/**
 * GET /matches/:id/timeline
 * 查询比赛事件流（时间线）
 * 查询参数：?limit=50&offset=0&type=KILL
 */
router.get('/:id/timeline', async (req, res) => {
  try {
    const { limit = 50, offset = 0, type = null } = req.query;
    let query = 'SELECT * FROM match_timeline WHERE match_id = $1';
    let params = [req.params.id];

    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }

    query += ' ORDER BY created_at ASC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json({ success: true, timeline: result.rows });
  } catch (err) {
    console.error('[GET /matches/:id/timeline]', err);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * POST /matches/:id/timeline
 * 添加比赛事件（管理员/系统调用）
 * Body: { type, team, player_id, player_name, text, data }
 */
router.post('/:id/timeline', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const {
      type,
      team = null,
      player_id = null,
      player_name = null,
      text,
      data = {}
    } = req.body;

    if (!type || !text) {
      return res.status(400).json({ success: false, message: 'type 和 text 必填' });
    }

    // 权限：只有管理员或比赛创建者可以添加事件
    const match = await pool.query('SELECT * FROM matches WHERE id = $1', [req.params.id]);
    if (match.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    const isAdmin = requireAdmin(req, res, userId);
    if (!isAdmin && match.rows[0].created_by !== userId) {
      return; // requireAdmin 已发送 403 响应
    }

    const result = await pool.query(`
      INSERT INTO match_timeline (match_id, type, team, player_id, player_name, text, data, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `, [req.params.id, type, team, player_id, player_name, text, JSON.stringify(data)]);

    const event = result.rows[0];

    // ✅ 广播到 Socket.IO（实时播报）
    const io = require('../server').io;
    if (io) {
      io.emit('timelineAdded', { success: true, matchId: req.params.id, event });
    }

    res.status(201).json({ success: true, event });
  } catch (err) {
    console.error('[POST /matches/:id/timeline]', err);
    res.status(500).json({ success: false, message: '添加事件失败' });
  }
});

// ===== 预测/竞猜系统 =====

/**
 * POST /matches/:id/predict
 * 提交预测（需要登录）
 * Body: { side: 'red'|'blue'|'draw', amount: 50 }
 * 约束：比赛状态为 REGISTERING 或 READY，每场比赛每人只能预测一次
 */
router.post('/:id/predict', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const matchId = req.params.id;
    const { side, amount } = req.body;

    if (!side || !['red','blue','draw'].includes(side)) {
      return res.status(400).json({ success: false, message: 'side 必须是 red/blue/draw' });
    }
    if (!amount || amount < 10 || amount > 1000) {
      return res.status(400).json({ success: false, message: '投注金额 10-1000 梦币' });
    }

    // 检查比赛状态
    const match = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (match.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    const m = match.rows[0];
    if (!['REGISTERING','READY'].includes(m.status)) {
      return res.status(400).json({ success: false, message: '当前状态不可预测（仅 REGISTERING/READY 阶段）' });
    }

    // 检查是否已预测
    const existing = await pool.query('SELECT id FROM predictions WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: '你已参与本场预测，无法修改' });
    }

    // 检查梦币余额
    const user = await pool.query('SELECT dream_coins FROM users WHERE id = $1', [userId]);
    const balance = user.rows[0]?.dream_coins || 0;
    if (balance < amount) {
      return res.status(400).json({ success: false, message: '梦币不足，当前余额：' + balance });
    }

    // 扣除梦币 + 创建预测记录
    await pool.query('UPDATE users SET dream_coins = dream_coins - $1 WHERE id = $2', [amount, userId]);
    await pool.query(
      "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'deduct', $3)",
      [userId, -amount, '预测投注：' + m.title]
    );
    const pred = await pool.query(
      'INSERT INTO predictions (match_id, user_id, side, amount) VALUES ($1,$2,$3,$4) RETURNING *',
      [matchId, userId, side, amount]
    );

    const newBalance = balance - amount;
    res.status(201).json({ success: true, prediction: pred.rows[0], newBalance });
  } catch (err) {
    console.error('[POST /matches/:id/predict]', err);
    res.status(500).json({ success: false, message: '预测提交失败' });
  }
});

/**
 * GET /matches/:id/predictions/my
 * 查询我的预测（需要登录）
 */
router.get('/:id/predictions/my', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const pred = await pool.query(
      'SELECT * FROM predictions WHERE match_id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    res.json({ success: true, prediction: pred.rows[0] || null });
  } catch (err) {
    console.error('[GET /matches/:id/predictions/my]', err);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * POST /matches/:id/predictions/settle
 * 结算预测（仅管理员/比赛创建者）
 * 根据 match.winner 结算所有 pending 预测：
 * - 猜中：返回 2x 投注金额（赢利=投注额）
 * - 猜错：不返还
 * - 平局(draw)：全部退款
 */
router.post('/:id/predictions/settle', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const matchId = req.params.id;

    // 权限检查
    const match = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (match.rows.length === 0) {
      return res.status(404).json({ success: false, message: '比赛不存在' });
    }
    const m = match.rows[0];
    const isAdmin = userId === (process.env.ADMIN_USER_ID || 'mp4hmya7ad15v6');
    if (m.created_by !== userId && !isAdmin) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    if (!m.winner) {
      return res.status(400).json({ success: false, message: '比赛尚未决出胜者，无法结算预测' });
    }

    // 检查是否已结算
    const settledCheck = await pool.query(
      "SELECT COUNT(*) as cnt FROM predictions WHERE match_id = $1 AND settled = true",
      [matchId]
    );
    if (settledCheck.rows[0].cnt > 0) {
      return res.status(400).json({ success: false, message: '预测已结算，不可重复结算' });
    }

    // 获取所有 pending 预测
    const preds = await pool.query(
      "SELECT * FROM predictions WHERE match_id = $1 AND settled = false",
      [matchId]
    );

    let winCount = 0, lossCount = 0, refundCount = 0;

    for (const p of preds.rows) {
      let newResult, rewardAmount, note;

      if (m.winner === 'draw') {
        // 平局：全部退款
        newResult = 'refund';
        rewardAmount = p.amount;
        note = '预测退款（比赛平局）：' + m.title;
        refundCount++;
      } else if (p.side === m.winner) {
        // 猜中：2x 回报
        newResult = 'win';
        rewardAmount = p.amount * 2;
        note = '预测获胜（+' + (rewardAmount - p.amount) + '）：' + m.title;
        winCount++;
      } else {
        // 猜错：不返还
        newResult = 'loss';
        rewardAmount = 0;
        note = '预测失败：' + m.title;
        lossCount++;
      }

      if (rewardAmount > 0) {
        await pool.query('UPDATE users SET dream_coins = COALESCE(dream_coins,0) + $1 WHERE id = $2', [rewardAmount, p.user_id]);
        await pool.query(
          "INSERT INTO coin_transactions (user_id, amount, type, note) VALUES ($1, $2, 'reward', $3)",
          [p.user_id, rewardAmount, note]
        );
      }

      await pool.query(
        'UPDATE predictions SET result = $1, settled = true, settled_at = NOW() WHERE id = $2',
        [newResult, p.id]
      );
    }

    res.json({
      success: true,
      total: preds.rows.length,
      winCount,
      lossCount,
      refundCount,
      winner: m.winner
    });
  } catch (err) {
    console.error('[POST /matches/:id/predictions/settle]', err);
    res.status(500).json({ success: false, message: '结算失败' });
  }
});

module.exports = router;
