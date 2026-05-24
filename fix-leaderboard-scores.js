/**
 * 榜单分数批量修复脚本
 * 公式：player_score = 0.5 * market_value + 0.5 * (dream_coins / 10000)
 * 单位统一为"万"
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@yamabiko.proxy.rlwy.net:35510/railway',
  ssl: { rejectUnauthorized: false }
});

async function fixPlayerScores() {
  console.log('🔧 开始修复选手榜单分数...\n');

  try {
    // 批量更新选手分数
    const playerResult = await pool.query(`
      UPDATE players p
      SET player_score = GREATEST(0, ROUND(
        0.5 * COALESCE(p.market_value, 0)
        + 0.5 * (COALESCE(u.dream_coins, 0) / 10000.0)
      ))
      FROM users u
      WHERE p.user_id = u.id
      RETURNING p.user_id, p.market_value, u.dream_coins,
        GREATEST(0, ROUND(
          0.5 * COALESCE(p.market_value, 0)
          + 0.5 * (COALESCE(u.dream_coins, 0) / 10000.0)
        )) as new_score
    `);

    console.log(`✅ 已更新 ${playerResult.rowCount} 名选手的榜单分数\n`);

    // 显示前10名
    if (playerResult.rowCount > 0) {
      console.log('📊 前10名选手：');
      console.log('  排名 | 用户名        | 身价(万) | 梦币(万) | 榜单分数');
      console.log('  ' + '-'.repeat(55));

      const top10 = await pool.query(`
        SELECT p.user_id, u.username, p.market_value,
          ROUND(COALESCE(u.dream_coins, 0) / 10000.0, 2) as dream_coins_wan,
          p.player_score
        FROM players p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.status = 'approved'
        ORDER BY p.player_score DESC
        LIMIT 10
      `);

      top10.rows.forEach((row, idx) => {
        console.log(`  ${(idx + 1).toString().padStart(4)} | ${(row.username || row.user_id).substring(0, 12).padEnd(12)} | ${(row.market_value || 0).toString().padStart(8)} | ${(row.dream_coins_wan || 0).toString().padStart(8)} | ${row.player_score}`);
      });
    }

    // 更新俱乐部分数
    console.log('\n🏢 更新俱乐部分数...');

    const clubs = await pool.query('SELECT id FROM clubs');
    let clubUpdated = 0;

    for (const club of clubs.rows) {
      const members = await pool.query(`
        SELECT player_score
        FROM players p
        WHERE p.club_id = $1 AND p.status = 'approved'
        ORDER BY player_score DESC
        LIMIT 5
      `, [club.id]);

      const clubScore = members.rows.reduce((sum, m) => sum + (m.player_score || 0), 0);

      await pool.query('UPDATE clubs SET club_score = $1 WHERE id = $2', [clubScore, club.id]);
      clubUpdated++;
    }

    console.log(`✅ 已更新 ${clubUpdated} 个俱乐部的榜单分数\n`);

    // 显示俱乐部榜单
    console.log('📊 俱乐部榜单：');
    console.log('  排名 | 俱乐部名称     | 俱乐部分数');
    console.log('  ' + '-'.repeat(35));

    const topClubs = await pool.query(`
      SELECT name, club_score
      FROM clubs
      ORDER BY club_score DESC
      LIMIT 10
    `);

    topClubs.rows.forEach((row, idx) => {
      console.log(`  ${(idx + 1).toString().padStart(4)} | ${(row.name || '').substring(0, 12).padEnd(12)} | ${row.club_score}`);
    });

    console.log('\n✅ 榜单分数修复完成！');

  } catch (e) {
    console.error('❌ 修复失败:', e.message);
    throw e;
  } finally {
    await pool.end();
  }
}

fixPlayerScores().catch(() => process.exit(1));
