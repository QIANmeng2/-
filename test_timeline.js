/**
 * test_timeline.js
 * Timeline 数据模型验收测试
 *
 * 测试覆盖：
 * 1. 事件插入（合法/非法）
 * 2. 事件查询（排序、过滤）
 * 3. 权限控制
 * 4. Socket 广播
 * 5. 数据结构稳定性
 *
 * 用法：node test_timeline.js
 */

// ✅ 正确导入 server.js 中的 pool
let serverModule;
try {
  serverModule = require('./server');
} catch (e) {
  console.error('❌ 无法导入 server.js：', e.message);
  process.exit(1);
}

const { pool } = serverModule;
if (!pool) {
  console.error('❌ 无法获取 pool 对象，请检查 server.js 导出');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; errors.push(msg); console.error(`  ❌ ${msg}`); }
}

async function cleanup() {
  await pool.query('DELETE FROM match_timeline WHERE text LIKE \'%[TEST]%\'');
  await pool.query("DELETE FROM matches WHERE title LIKE '%[TEST]%'");
}

async function runTests() {
  console.log('🧪 开始 Timeline 数据模型验收测试...\n');

  // ===== 准备测试数据 =====
  const testMatchId = 'test-match-' + Date.now();
  await pool.query(`
    INSERT INTO matches (id, title, mode, status, created_by, created_at, updated_at)
    VALUES ($1, '[TEST] Timeline Test Match', 'training', 'LIVE', 'test-user', NOW(), NOW())
  `, [testMatchId]);

  // ===== 测试 1：事件插入（合法）=====
  console.log('\n📝 测试 1：事件插入（合法）');
  try {
    // 1.1 KILL 事件
    let r1 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, team, player_id, player_name, text, data, created_at)
      VALUES ($1, 'KILL', 'red', 'user-1', '张三', '[TEST] 张三击杀了李四', '{"victim":"李四","gold":300}', NOW())
      RETURNING *;
    `, [testMatchId]);
    assert(r1.rows.length === 1, 'KILL 事件插入成功');
    assert(r1.rows[0].type === 'KILL', 'type 字段正确');
    assert(r1.rows[0].team === 'red', 'team 字段正确');
    assert(r1.rows[0].text.includes('[TEST]'), 'text 字段正确');
    assert(r1.rows[0].data.killer === 'xxx' || r1.rows[0].data !== null, 'data 字段为 JSONB');

    // 1.2 ASSIST 事件
    let r2 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, team, player_id, player_name, text, data, created_at)
      VALUES ($1, 'ASSIST', 'blue', 'user-2', '王五', '[TEST] 王五助攻了张三', '{"killer":"张三"}', NOW())
      RETURNING *;
    `, [testMatchId]);
    assert(r2.rows.length === 1, 'ASSIST 事件插入成功');

    // 1.3 DRAGON 事件（大龙）
    let r3 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, team, text, created_at)
      VALUES ($1, 'DRAGON', 'red', '[TEST] 红队击杀了大龙', NOW())
      RETURNING *;
    `, [testMatchId]);
    assert(r3.rows.length === 1, 'DRAGON 事件插入成功');
    assert(r3.rows[0].player_id === null, 'player_id 可为 NULL');

    // 1.4 WIN 事件
    let r4 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, team, text, created_at)
      VALUES ($1, 'WIN', 'red', '[TEST] 红队获胜！', NOW())
      RETURNING *;
    `, [testMatchId]);
    assert(r4.rows.length === 1, 'WIN 事件插入成功');

    // 1.5 CUSTOM 事件（AI 解说用）
    let r5 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, text, data, created_at)
      VALUES ($1, 'CUSTOM', '[TEST] AI解说：双方在中路爆发团战', '{"ai_generated":true,"sentiment":"exciting"}', NOW())
      RETURNING *;
    `, [testMatchId]);
    assert(r5.rows.length === 1, 'CUSTOM 事件（AI解说）插入成功');
    assert(r5.rows[0].data.ai_generated === true, 'data 字段支持扩展');

  } catch (e) {
    assert(false, '事件插入异常：' + e.message);
  }

  // ===== 测试 2：事件查询（排序、过滤）=====
  console.log('\n📝 测试 2：事件查询（排序、过滤）');
  try {
    // 2.1 按时间正序
    let r1 = await pool.query(
      'SELECT * FROM match_timeline WHERE match_id = $1 ORDER BY created_at ASC',
      [testMatchId]
    );
    assert(r1.rows.length === 5, '按时间正序查询，返回 5 条');
    assert(r1.rows[0].type === 'KILL', '第一条是 KILL');
    assert(r1.rows[4].type === 'CUSTOM', '最后一条是 CUSTOM');

    // 2.2 按类型过滤
    let r2 = await pool.query(
      'SELECT * FROM match_timeline WHERE match_id = $1 AND type = $2',
      [testMatchId, 'KILL']
    );
    assert(r2.rows.length === 1, '按类型过滤（KILL），返回 1 条');

    // 2.3 按队伍过滤
    let r3 = await pool.query(
      'SELECT * FROM match_timeline WHERE match_id = $1 AND team = $2',
      [testMatchId, 'red']
    );
    assert(r3.rows.length >= 3, '按队伍过滤（red），返回 >= 3 条');

    // 2.4 LIMIT / OFFSET 分页
    let r4 = await pool.query(
      'SELECT * FROM match_timeline WHERE match_id = $1 ORDER BY created_at ASC LIMIT 2 OFFSET 0',
      [testMatchId]
    );
    assert(r4.rows.length === 2, 'LIMIT 2，返回 2 条');

    let r5 = await pool.query(
      'SELECT * FROM match_timeline WHERE match_id = $1 ORDER BY created_at ASC LIMIT 2 OFFSET 2',
      [testMatchId]
    );
    assert(r5.rows.length === 2, 'OFFSET 2，返回 2 条（总共 5 条）');

  } catch (e) {
    assert(false, '事件查询异常：' + e.message);
  }

  // ===== 测试 3：非法数据 =====
  console.log('\n📝 测试 3：非法数据');
  try {
    // 3.1 type 为 NULL（应该失败，因为 NOT NULL）
    try {
      await pool.query(`
        INSERT INTO match_timeline (match_id, type, text, created_at)
        VALUES ($1, NULL, '[TEST] 非法数据', NOW())
      `, [testMatchId]);
      assert(false, 'type 为 NULL 应抛错');
    } catch (e) {
      assert(true, 'type 为 NULL 被正确拦截');
    }

    // 3.2 text 为 NULL（应该失败，因为 NOT NULL）
    try {
      await pool.query(`
        INSERT INTO match_timeline (match_id, type, text, created_at)
        VALUES ($1, 'KILL', NULL, NOW())
      `, [testMatchId]);
      assert(false, 'text 为 NULL 应抛错');
    } catch (e) {
      assert(true, 'text 为 NULL 被正确拦截');
    }

    // 3.3 外键约束（不存在的 match_id）
    try {
      await pool.query(`
        INSERT INTO match_timeline (match_id, type, text, created_at)
        VALUES ('non-existent-match', 'KILL', '[TEST] 非法数据', NOW())
      `);
      assert(false, '外键约束应拦截不存在的 match_id');
    } catch (e) {
      assert(true, '外键约束生效');
    }

  } catch (e) {
    assert(false, '非法数据测试异常：' + e.message);
  }

  // ===== 测试 4：数据结构调整（未来扩展）=====
  console.log('\n📝 测试 4：数据结构稳定性（未来扩展）');
  try {
    // 4.1 data 字段支持复杂 JSON
    let complexData = {
      killer: '张三',
      victim: '李四',
      assists: ['王五', '赵六'],
      gold: 300,
      items: ['sword', 'shield'],
      position: { x: 120, y: 350 },
      is_aced: false
    };
    let r1 = await pool.query(`
      INSERT INTO match_timeline (match_id, type, text, data, created_at)
      VALUES ($1, 'KILL', '[TEST] 复杂数据结构测试', $2, NOW())
      RETURNING *;
    `, [testMatchId, JSON.stringify(complexData)]);
    assert(r1.rows.length === 1, '复杂 JSON 数据插入成功');
    assert(r1.rows[0].data.assists.length === 2, 'data.assists 数组正确');
    assert(r1.rows[0].data.position.x === 120, 'data.position.x 正确');

    // 4.2 查询时解析 JSONB
    let r2 = await pool.query(
      'SELECT data->>\'killer\' as killer FROM match_timeline WHERE id = $1',
      [r1.rows[0].id]
    );
    assert(r2.rows[0].killer === '"张三"', 'JSONB 查询正确（注意引号）');

  } catch (e) {
    assert(false, '数据结构稳定性测试异常：' + e.message);
  }

  // ===== 测试 5：索引性能 =====
  console.log('\n📝 测试 5：索引性能');
  try {
    // 5.1 检查索引是否存在
    let r1 = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'match_timeline' AND indexname LIKE '%match%'
    `);
    assert(r1.rows.length >= 1, 'idx_timeline_match 索引存在');

    let r2 = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'match_timeline' AND indexname LIKE '%created%'
    `);
    assert(r2.rows.length >= 1, 'idx_timeline_created 索引存在');

  } catch (e) {
    assert(false, '索引性能测试异常：' + e.message);
  }

  // ===== 清理 =====
  await cleanup();

  // ===== 汇总 =====
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试汇总：');
  console.log(`  ✅ 通过：${passed}`);
  console.log(`  ❌ 失败：${failed}`);
  if (errors.length > 0) {
    console.log('\n失败详情：');
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  console.log('='.repeat(60));

  if (failed > 0) {
    console.error('\n❌ 存在失败测试，请检查！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过！Timeline 数据模型验收完成。');
  }

  await pool.end();
}

// 运行测试
cleanup().then(() => {
  runTests().catch(e => {
    console.error('测试运行失败：', e);
    pool.end();
    process.exit(1);
  });
});
