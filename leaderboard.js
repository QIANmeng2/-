// leaderboard.js - 榜单 API 路由
// 导出函数，由 server.js 调用：require('./leaderboard.js')(app, pool, authMiddleware, ok, badRequest, serverError);

module.exports = function(app, pool, authMiddleware, ok, badRequest, serverError) {

  // 选手榜单
  app.get('/api/leaderboard', async (req, res) => {
    const { type = 'player', limit = 50 } = req.query;
    try {
      if (type === 'player') {
        const sql = `
          SELECT 
            p.id,
            p.player_score,
            p.player_value,
            u.username,
            c.club_name
          FROM players p
          LEFT JOIN users u ON p.user_id = u.id
          LEFT JOIN clubs c ON p.club_id = c.id
          ORDER BY p.player_score DESC
          LIMIT $1`;
        const { rows } = await pool.query(sql, [parseInt(limit)]);
        const list = rows.map((row, idx) => ({
          rank: idx + 1,
          username: row.username,
          club_name: row.club_name,
          player_value: row.player_value,
          player_score: row.player_score,
          dreamcoin_value: row.dreamcoin_value || 0
        }));
        return ok(res, { list });
      } else if (type === 'club') {
        const sql = `
          SELECT 
            c.id,
            c.club_name,
            c.club_score,
            u.username as boss_name
          FROM clubs c
          LEFT JOIN users u ON c.boss_id = u.id
          ORDER BY c.club_score DESC
          LIMIT $1`;
        const { rows } = await pool.query(sql, [parseInt(limit)]);
        const list = rows.map((row, idx) => ({
          rank: idx + 1,
          club_name: row.club_name,
          boss_name: row.boss_name,
          club_score: row.club_score
        }));
        return ok(res, { list });
      } else {
        return badRequest(res, 'type 参数必须是 player 或 club');
      }
    } catch (err) {
      return serverError(res, '获取榜单失败', err);
    }
  });

};
