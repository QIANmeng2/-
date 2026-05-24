const { Pool } = require('pg');
const pool = new Pool({
  host: 'yamabiko.proxy.rlwy.net',
  port: 35510,
  database: 'railway',
  user: 'postgres',
  password: 'OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    console.log('=== competitions 表字段 ===');
    const compCols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'competitions'
      ORDER BY ordinal_position
    `);
    compCols.rows.forEach(r => console.log(r.column_name.padEnd(25), r.data_type));

    console.log('\n=== 最近有报名的比赛 (前5场) ===');
    const recentComp = await pool.query(`
      SELECT c.id, c.status, c.tier, c.bo, c.comp_status
      FROM competitions c
      WHERE EXISTS (SELECT 1 FROM competition_registrations r WHERE r.competition_id = c.id)
      ORDER BY c.created_at DESC LIMIT 5
    `);
    recentComp.rows.forEach(r => {
      console.log(`  [${r.comp_status}][${r.status}] ${r.id.slice(0,12)}... tier=${r.tier} bo=${r.bo}`);
    });

    if (recentComp.rows.length === 0) {
      console.log('无比赛数据，退出');
      await pool.end();
      return;
    }

    // 选第一场比赛做详细审计
    const compId = recentComp.rows[0].id;
    console.log(`\n>>> 详细审计比赛: ${compId}`);

    // 报名数据
    const regs = await pool.query(`
      SELECT id, player_user_id, side, lane, status
      FROM competition_registrations
      WHERE competition_id = $1
      ORDER BY side, lane
    `, [compId]);

    console.log(`\n=== 报名数据 (${regs.rows.length} 条) ===`);
    const allIds = [];
    regs.rows.forEach(r => {
      const uid = r.player_user_id || '';
      if (uid) allIds.push(uid);
      const displayUid = uid ? uid.slice(0,16) + '...' : 'NULL';
      console.log(`  [${r.side||'?'}] lane=${r.lane||'?'} player_user_id=${displayUid} status=${r.status}`);
    });

    const uniqueIds = [...new Set(allIds)];
    console.log(`\n唯一 user_id 数: ${uniqueIds.length}`);

    if (uniqueIds.length === 0) {
      console.log('无有效 user_id，退出');
      await pool.end();
      return;
    }

    // players 表
    const ph = uniqueIds.map((_, i) => '$' + (i+1)).join(',');
    const players = await pool.query(`
      SELECT user_id, game_id, market_value FROM players
      WHERE user_id IN (${ph})
    `, uniqueIds);

    console.log(`\n=== players 表匹配 (${players.rows.length}/${uniqueIds.length}) ===`);
    players.rows.forEach(r => {
      const uid = r.user_id ? r.user_id.slice(0,16) + '...' : 'NULL';
      console.log(`  user_id=${uid} game_id=${r.game_id} market_value=${r.market_value}`);
    });

    // 哪些没有 players 记录
    const foundIds = new Set(players.rows.map(p => p.user_id));
    const missingPlayers = uniqueIds.filter(id => !foundIds.has(id));
    console.log(`\n=== 有报名但无 players 记录 (${missingPlayers.length} 个) ===`);
    missingPlayers.forEach(id => console.log('  ', id));

    // users 表（字段名是 gameid 不是 game_id！）
    const users = await pool.query(`
      SELECT id, username, coachname, gameid FROM users
      WHERE id IN (${ph})
    `, uniqueIds);

    console.log(`\n=== users 表匹配 (${users.rows.length}/${uniqueIds.length}) ===`);
    users.rows.forEach(r => {
      const uid = r.id ? r.id.slice(0,16) + '...' : 'NULL';
      console.log(`  id=${uid} username=${r.username} game_id=${r.game_id}`);
    });

    // competition_results 表
    const results = await pool.query(`
      SELECT id, competition_id, winner, mvp_player_id, player_data
      FROM competition_results
      WHERE competition_id = $1
      ORDER BY created_at DESC LIMIT 2
    `, [compId]);

    if (results.rows.length > 0) {
      console.log(`\n=== competition_results 已有数据 (${results.rows.length} 条) ===`);
      const r = results.rows[0];
      console.log('winner:', r.winner);
      console.log('mvp_player_id:', r.mvp_player_id);
      console.log('player_data 条数:', r.player_data ? r.player_data.length : 0);
      if (r.player_data && r.player_data.length > 0) {
        console.log('player_data[0] 样本:', JSON.stringify(r.player_data[0]).slice(0, 300));
      }
    } else {
      console.log('\n=== competition_results: 暂无数据 ===');
    }

    // 额外：检查 players 表中 market_value 为 0 或 NULL 的
    if (players.rows.length > 0) {
      const zeroMV = players.rows.filter(r => !r.market_value || parseInt(r.market_value) <= 0);
      console.log(`\n=== players 中 market_value 为 0/NULL (${zeroMV.length} 个) ===`);
      zeroMV.forEach(r => {
        console.log(`  user_id=${r.user_id.slice(0,16)}... game_id=${r.game_id} market_value=${r.market_value}`);
      });
    }

    // 额外：检查 registration 中 side 字段的分布
    const sideDist = {};
    regs.rows.forEach(r => {
      const s = r.side || 'NULL';
      sideDist[s] = (sideDist[s] || 0) + 1;
    });
    console.log('\n=== 报名 side 分布 ===');
    Object.entries(sideDist).forEach(([k,v]) => console.log(`  ${k}: ${v} 人`));

  } catch(e) {
    console.error('Error:', e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
})();
