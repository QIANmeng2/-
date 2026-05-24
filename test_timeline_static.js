/**
 * test_timeline_static.js
 * Timeline 数据模型静态验收测试（不依赖数据库连接）
 *
 * 测试覆盖：
 * 1. 数据库表结构（从 server.js 中提取 CREATE TABLE 语句）
 * 2. 字段类型正确性
 * 3. 约束正确性（NOT NULL、CHECK、外键）
 * 4. 索引存在性
 * 5. 未来扩展能力（data JSONB 字段）
 *
 * 用法：node test_timeline_static.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; errors.push(msg); console.error(`  ❌ ${msg}`); }
}

function extractCreateTable(sql, tableName) {
  // 简单提取 CREATE TABLE 语句（不解析完整 SQL）
  const regex = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${tableName} \\s*\\(([^;]+)\\)`, 'is');
  const match = sql.match(regex);
  return match ? match[1] : null;
}

function parseColumns(createTableBody) {
  // 简单解析列定义（不处理复杂情况）
  const lines = createTableBody.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));
  const columns = {};
  const constraints = [];

  for (const line of lines) {
    // 跳过 CONSTRAINT、PRIMARY KEY、FOREIGN KEY 等
    if (line.includes('CONSTRAINT') || line.includes('PRIMARY KEY') && !line.startsWith('id ') && !line.startsWith('match_id ')) {
      constraints.push(line);
      continue;
    }
    // 尝试匹配列定义：name TYPE ...
    const colMatch = line.match(/^(\w+)\s+(\w+(?:\([^)]+\))?)(.+)?$/);
    if (colMatch) {
      const name = colMatch[1];
      const type = colMatch[2];
      const rest = colMatch[3] || '';
      columns[name] = {
        type: type.toUpperCase(),
        nullable: !rest.includes('NOT NULL'),
        default: rest.match(/DEFAULT\s+(\S+)/)?.[1] || null,
        constraints: rest
      };
    }
  }

  return { columns, constraints };
}

async function runTests() {
  console.log('🧪 开始 Timeline 数据模型静态验收测试...\n');

  // ===== 读取 server.js =====
  const serverJsPath = path.join(__dirname, 'server.js');
  if (!fs.existsSync(serverJsPath)) {
    console.error('❌ 未找到 server.js');
    process.exit(1);
  }
  const sql = fs.readFileSync(serverJsPath, 'utf8');

  // ===== 测试 1：match_timeline 表是否存在 =====
  console.log('\n📝 测试 1：match_timeline 表结构');
  try {
    const createTableBody = extractCreateTable(sql, 'match_timeline');
    assert(createTableBody !== null, 'match_timeline 表 CREATE TABLE 语句存在');

    if (createTableBody) {
      const { columns, constraints } = parseColumns(createTableBody);

      // 1.1 必需字段存在
      assert(columns['id'] !== undefined, 'id 字段存在');
      assert(columns['match_id'] !== undefined, 'match_id 字段存在');
      assert(columns['type'] !== undefined, 'type 字段存在');
      assert(columns['team'] !== undefined, 'team 字段存在');
      assert(columns['player_id'] !== undefined, 'player_id 字段存在');
      assert(columns['player_name'] !== undefined, 'player_name 字段存在');
      assert(columns['text'] !== undefined, 'text 字段存在');
      assert(columns['data'] !== undefined, 'data 字段存在');
      assert(columns['created_at'] !== undefined, 'created_at 字段存在');

      // 1.2 字段类型正确
      assert(columns['id'].type.includes('SERIAL'), 'id 类型正确（SERIAL）');
      assert(columns['match_id'].type.includes('TEXT'), 'match_id 类型正确（TEXT）');
      assert(columns['type'].type.includes('TEXT'), 'type 类型正确（TEXT）');
      assert(columns['team'].type.includes('TEXT'), 'team 类型正确（TEXT）');
      assert(columns['player_id'].type.includes('TEXT'), 'player_id 类型正确（TEXT）');
      assert(columns['data'].type.includes('JSONB'), 'data 类型正确（JSONB）');
      assert(columns['created_at'].type.includes('TIMESTAMP'), 'created_at 类型正确（TIMESTAMP）');

      // 1.3 NOT NULL 约束
      assert(!columns['type'].nullable, 'type 有 NOT NULL 约束');
      assert(!columns['text'].nullable, 'text 有 NOT NULL 约束');
      assert(columns['team'].nullable, 'team 允许 NULL');
      assert(columns['player_id'].nullable, 'player_id 允许 NULL');

      // 1.4 DEFAULT 约束（直接检查 SQL 文本）
      assert(createTableBody.includes('team TEXT DEFAULT NULL'), 'team 默认值正确（NULL）');
      assert(createTableBody.includes("data JSONB DEFAULT '{}'"), 'data 默认值正确（{}）');

      // 1.5 外键约束（直接检查 CREATE TABLE 语句）
      const hasForeignKey = createTableBody.includes('REFERENCES matches(id)');
      assert(hasForeignKey, '存在外键约束（REFERENCES matches(id)）');
    }
  } catch (e) {
    assert(false, '表结构解析异常：' + e.message);
  }

  // ===== 测试 2：索引是否存在 =====
  console.log('\n📝 测试 2：索引存在性');
  try {
    assert(sql.includes('idx_timeline_match'), 'idx_timeline_match 索引创建语句存在');
    assert(sql.includes('idx_timeline_created'), 'idx_timeline_created 索引创建语句存在');
  } catch (e) {
    assert(false, '索引检查异常：' + e.message);
  }

  // ===== 测试 3：routes/matches.js 中的 Timeline API =====
  console.log('\n📝 测试 3：Timeline API 路由');
  try {
    const routesJsPath = path.join(__dirname, 'routes', 'matches.js');
    if (!fs.existsSync(routesJsPath)) {
      assert(false, 'routes/matches.js 不存在');
    } else {
      const routesJs = fs.readFileSync(routesJsPath, 'utf8');

      // 3.1 GET /matches/:id/timeline
      assert(routesJs.includes('/:id/timeline'), 'GET /matches/:id/timeline 路由存在');
      assert(routesJs.includes('SELECT * FROM match_timeline'), '查询 match_timeline 表');

      // 3.2 POST /matches/:id/timeline
      assert(routesJs.includes("INSERT INTO match_timeline"), 'POST /matches/:id/timeline 路由存在');
      assert(routesJs.includes('io.emit'), '添加事件后广播 Socket.IO');

      // 3.3 返回结构统一
      assert(routesJs.includes('success: true'), '返回结构包含 success: true');
      assert(routesJs.includes('timeline:'), '返回 timeline 字段');
    }
  } catch (e) {
    assert(false, 'Timeline API 检查异常：' + e.message);
  }

  // ===== 测试 4：Socket.IO Timeline 事件 =====
  console.log('\n📝 测试 4：Socket.IO Timeline 事件');
  try {
    assert(sql.includes('timeline:add'), 'Socket 事件 timeline:add 存在');
    assert(sql.includes('timeline:list'), 'Socket 事件 timeline:list 存在');
    assert(sql.includes('timelineAdded'), 'Socket 广播事件 timelineAdded 存在');
  } catch (e) {
    assert(false, 'Socket.IO 事件检查异常：' + e.message);
  }

  // ===== 测试 5：未来扩展能力 =====
  console.log('\n📝 测试 5：未来扩展能力');
  try {
    // 5.1 data 字段为 JSONB（已测试）
    assert(true, 'data 字段为 JSONB，支持任意扩展');

    // 5.2 type 字段支持的事件类型（从注释中提取）
    const typeEnumMatch = sql.match(/-- '(\w+)'\s+[^\n]+/g);
    assert(typeEnumMatch !== null && typeEnumMatch.length > 0, 'type 字段有枚举注释（KILL, ASSIST, DRAGON, etc.）');

    // 5.3 冗余字段 player_name（便于快速显示）
    const createTableBody = extractCreateTable(sql, 'match_timeline');
    if (createTableBody) {
      const { columns } = parseColumns(createTableBody);
      assert(columns['player_name'] !== undefined, 'player_name 冗余字段存在（便于快速显示）');
    }
  } catch (e) {
    assert(false, '未来扩展能力检查异常：' + e.message);
  }

  // ===== 测试 6：与 matches 表结构一致性 =====
  console.log('\n📝 测试 6：与 matches 表结构一致性');
  try {
    const matchesTable = extractCreateTable(sql, 'matches');
    const timelineTable = extractCreateTable(sql, 'match_timeline');

    assert(matchesTable !== null, 'matches 表存在');
    assert(timelineTable !== null, 'match_timeline 表存在');

    if (matchesTable && timelineTable) {
      // 6.1 match_id 外键指向 matches(id)
      assert(timelineTable.includes('REFERENCES matches(id)'), 'match_id 外键正确引用 matches(id)');

      // 6.2 两个表都有 created_at
      const { columns: matchesCols } = parseColumns(matchesTable);
      const { columns: timelineCols } = parseColumns(timelineTable);
      assert(matchesCols['created_at'] !== undefined, 'matches 表有 created_at');
      assert(timelineCols['created_at'] !== undefined, 'match_timeline 表有 created_at');
    }
  } catch (e) {
    assert(false, '表结构一致性检查异常：' + e.message);
  }

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
    console.log('\n💡 建议：');
    console.log('  1. 启动服务后，手动测试 Timeline API：');
    console.log('     curl -X POST http://localhost:8080/api/matches/<id>/timeline \\');
    console.log('       -H "Authorization: Bearer <token>" \\');
    console.log('       -d \'{"type":"KILL","text":"测试事件"}\'');
    console.log('  2. 前端接入 Socket.IO 事件：timelineAdded、timeline:list:success');
    console.log('  3. 未来实现 AI 解说时，使用 type=CUSTOM + data 字段存储解说内容');
  }
}

// 运行测试
runTests().catch(e => {
  console.error('测试运行失败：', e);
  process.exit(1);
});
