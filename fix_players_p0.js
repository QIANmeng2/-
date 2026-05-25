const { Pool } = require('pg');
const pool = new Pool({
  host: 'yamabiko.proxy.rlwy.net', port: 35510,
  database: 'railway', user: 'postgres',
  password: 'OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const ids = ['mp7rnmpfxrzlxe', 'mpgtscxhbbnpls', 'mp87zo1qsi5vi7'];
    
    for (const id of ids) {
      try {
        // 查 users 表
        const u = await pool.query('SELECT id, username, coachname, gameid FROM users WHERE id=$1', [id]);
        if (u.rows.length === 0) { console.log('[SKIP] user not found:', id); continue; }
        const ur = u.rows[0];
        const gid = ur.gameid || ur.coachname || ur.username || 'unknown';
        console.log('[FOUND]', id.slice(0,16), 'gameid=' + gid);
        
        // 查是否已有 players 记录
        const existing = await pool.query('SELECT user_id, market_value FROM players WHERE user_id=$1', [id]);
        if (existing.rows.length > 0) {
          console.log('  [EXISTS] Already has players record, mv=' + existing.rows[0].market_value);
          continue;
        }
        
        // 创建
        await pool.query(
          'INSERT INTO players (user_id, game_id, market_value, status, positions) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING',
          [id, gid, 35, 'available', '']
        );
        console.log('  [CREATED] market_value=35');
      } catch(e) {
        console.log('  [ERROR]', e.message);
      }
    }

    // 验证
    console.log('\n=== Final Verification ===');
    const check = await pool.query(
      'SELECT user_id, game_id, market_value, status FROM players WHERE user_id = ANY($1::text[])',
      [ids]
    );
    console.log('Records found:', check.rows.length);
    check.rows.forEach(r => console.log('  ' + r.user_id + ' | game_id=' + r.game_id + ' | mv=' + r.market_value + ' | status=' + r.status));
    
  } catch(e) {
    console.error('FATAL:', e.message, e.stack);
  } finally {
    await pool.end();
  }
})();
