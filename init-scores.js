// init-scores.js - 一次性脚本：为所有现有选手计算并初始化 player_score
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgres://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@yamabiko.proxy.rlwy.net:35510/railway',
  ssl: { rejectUnauthorized: false }
});

async function updatePlayerScore(userId) {
  try {
    const result = await pool.query(`
      SELECT p.market_value, u.dream_coins
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.user_id = $1
    `, [userId]);
    if (result.rows.length === 0) return;
    const { market_value, dream_coins } = result.rows[0];
    const playerValue = market_value || 0;
    const dreamcoinValue = dream_coins || 0;
    const playerScore = Math.round(0.5 * playerValue + 0.5 * (dreamcoinValue / 10000));
    await pool.query('UPDATE players SET player_score = $1 WHERE user_id = $2', [playerScore, userId]);
    console.log(`  ${userId}: value=${playerValue}, coins=${dreamcoinValue}, score=${playerScore}`);
  } catch (e) {
    console.error(`  [ERROR] ${userId}: ${e.message}`);
  }
}

async function main() {
  console.log('开始初始化所有选手榜单分数...');
  const players = await pool.query('SELECT user_id FROM players ORDER BY user_id');
  console.log(`共 ${players.rows.length} 名选手`);

  for (let i = 0; i < players.rows.length; i++) {
    const p = players.rows[i];
    process.stdout.write(`[${i+1}/${players.rows.length}] `);
    await updatePlayerScore(p.user_id);
    // 每10个暂停100ms避免连接过载
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n更新俱乐部分数...`);
  const clubs = await pool.query('SELECT id FROM clubs');
  for (const c of clubs.rows) {
    try {
      const members = await pool.query(`
        SELECT player_score FROM players
        WHERE club_id = $1 AND status = 'approved'
        ORDER BY player_score DESC LIMIT 5
      `, [c.id]);
      const clubScore = members.rows.reduce((sum, m) => sum + (m.player_score || 0), 0);
      await pool.query('UPDATE clubs SET club_score = $1 WHERE id = $2', [clubScore, c.id]);
      console.log(`  俱乐部 ${c.id}: top5 score=${clubScore}`);
    } catch (e) {
      console.error(`  [ERROR] 俱乐部 ${c.id}: ${e.message}`);
    }
  }

  console.log('\n✅ 初始化完成');
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); process.exit(1); });