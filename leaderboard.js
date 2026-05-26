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
            p.market_value AS player_value,
            u.username,
            u.gameId,
            u.dream_coins,
            c.name AS club_name
          FROM players p
          LEFT JOIN users u ON p.user_id = u.id
          LEFT JOIN clubs c ON p.club_id = c.id
          ORDER BY p.player_score DESC, p.market_value DESC, u.dream_coins DESC
          LIMIT $1`;
        const { rows } = await pool.query(sql, [parseInt(limit)]);
        // dense rank: 同分同名，下一名不跳号
        let rank = 0, prevScore = null;
        const list = rows.map((row) => {
          if (row.player_score !== prevScore) { rank++; prevScore = row.player_score; }
          return {
            rank,
            username: row.username,
            game_id: row.gameid,
            club_name: row.club_name,
            player_value: row.player_value,
            player_score: row.player_score,
            dreamcoin_value: row.dream_coins || 0
          };
        });
        return ok(res, { list });
      } else if (type === 'club') {
        const sql = `
          SELECT 
            c.id,
            c.name AS club_name,
            c.club_score,
            u.username as boss_name,
            u.gameId as boss_game_id
          FROM clubs c
          LEFT JOIN users u ON c.owner_id = u.id
          ORDER BY c.club_score DESC
          LIMIT $1`;
        const { rows } = await pool.query(sql, [parseInt(limit)]);
        // dense rank: 同分同名，下一名不跳号
        let clubRank = 0, prevClubScore = null;
        const list = rows.map((row) => {
          if (row.club_score !== prevClubScore) { clubRank++; prevClubScore = row.club_score; }
          return {
            rank: clubRank,
            club_name: row.club_name,
            boss_name: row.boss_name,
            boss_game_id: row.boss_game_id,
            club_score: row.club_score
          };
        });
        return ok(res, { list });
      } else {
        return badRequest(res, 'type 参数必须是 player 或 club');
      }
    } catch (err) {
      return serverError(res, '获取榜单失败', err);
    }
  });

};
