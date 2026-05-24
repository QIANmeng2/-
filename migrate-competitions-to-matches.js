/**
 * 数据库迁移脚本：competitions → matches（兼容策略）
 *
 * 策略：
 * 1. 新比赛走新 matches 模型
 * 2. 老比赛先兼容（不删除 competitions 表）
 * 3. 本脚本可将现有 competitions 数据同步到 matches 表（可选执行）
 * 4. 后续逐步迁移
 *
 * 使用方法：
 *   node migrate-competitions-to-matches.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// competitions.comp_status → matches.status 映射
const STATUS_MAP = {
  'upcoming': 'CREATED',
  'open': 'REGISTERING',
  'locked': 'READY',
  'live': 'LIVE',
  'review': 'FINISHED', // 后台审核中，前端可按 FINISHED 处理
  'finished': 'FINISHED',
  'cancelled': 'ARCHIVED'
};

// competitions.tier → matches.mode 映射
const MODE_MAP = {
  'arena': 'arena',
  'training': 'training',
  'regular': 'regular'
};

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 开始迁移 competitions → matches...');
    await client.query('BEGIN');

    // 1. 检查是否已有数据
    const existing = await client.query('SELECT COUNT(*) FROM matches');
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('⚠️  matches 表已有数据，跳过迁移（如需重新迁移请先清空 matches 表）');
      await client.query('ROLLBACK');
      return;
    }

    // 2. 查询所有 competitions
    const competitions = await client.query('SELECT * FROM competitions ORDER BY created_at ASC');
    console.log(`📊 找到 ${competitions.rows.length} 条 competitions 记录`);

    let migrated = 0;
    for (const comp of competitions.rows) {
      try {
        const matchId = comp.id; // 复用旧 ID
        const title = comp.name || '未命名比赛';
        const mode = MODE_MAP[comp.tier] || 'training';
        const status = STATUS_MAP[comp.comp_status] || 'CREATED';
        const createdBy = comp.created_by || 'system';
        const description = comp.description || null;
        const startTime = comp.start_time || null;
        const endTime = comp.end_time || null;
        const bo = comp.bo || 1;

        // 插入 matches 表
        await client.query(`
          INSERT INTO matches (id, title, mode, status, created_by, description, start_time, end_time, bo, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (id) DO NOTHING;
        `, [matchId, title, mode, status, createdBy, description, startTime, endTime, bo, comp.created_at]);

        // 迁移报名信息到 match_participants
        const registrations = await client.query(
          'SELECT * FROM competition_registrations WHERE competition_id = $1',
          [comp.id]
        );

        for (const reg of registrations.rows) {
          const userId = reg.player_user_id || reg.user_id;
          if (!userId) continue;

          const side = reg.side || 'neutral';
          const lane = reg.lane || '';
          const clubId = reg.club_id || null;

          await client.query(`
            INSERT INTO match_participants (match_id, user_id, side, lane, club_id, joined_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (match_id, user_id) DO NOTHING;
          `, [matchId, userId, side, lane, clubId, reg.created_at || new Date()]);
        }

        // 迁移比赛结果
        const results = await client.query(
          'SELECT * FROM competition_results WHERE competition_id = $1',
          [comp.id]
        );

        if (results.rows.length > 0) {
          const result = results.rows[0];
          const winner = result.winner || null;
          const mvpId = result.mvp_player_id || null;
          const score = result.coin_rewards || { red: 0, blue: 0 };

          await client.query(`
            UPDATE matches
            SET winner = $1, mvp_id = $2, score = $3, status = 'FINISHED', updated_at = NOW()
            WHERE id = $4;
          `, [winner, mvpId, JSON.stringify(score), matchId]);
        }

        migrated++;
        console.log(`  ✅ [${migrated}/${competitions.rows.length}] 迁移成功: ${title} (${matchId})`);
      } catch (err) {
        console.error(`  ❌ 迁移失败: ${comp.id}`, err.message);
      }
    }

    await client.query('COMMIT');
    console.log(`\n🎉 迁移完成！成功 ${migrated}/${competitions.rows.length}`);
    console.log('💡 后续步骤：');
    console.log('   1. 新比赛将使用 /api/matches 接口（routes/matches.js）');
    console.log('   2. 旧 competitions 表保留，前端可逐步切换到新接口');
    console.log('   3. 确认无问题后，可删除 competitions 相关代码');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ 迁移失败:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

// 执行迁移
migrate().catch(console.error);
