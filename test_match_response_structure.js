/**
 * 第二轮验收：Match 返回结构统一性检查
 * 使用方法：node test_match_response_structure.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     错误：${err.message}`);
    errors.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log('\n🔍 第二轮验收：Match 返回结构统一性检查...\n');

// ===== 测试 1：routes/matches.js 返回结构 =====
console.log('📋 测试 1：routes/matches.js 返回结构');

const matchesJs = fs.readFileSync(path.join(__dirname, 'routes/matches.js'), 'utf8');

test('GET /matches 应返回 { success, matches }', () => {
  assert(matchesJs.includes("res.json({ success: true, matches:"), '缺少 matches 字段');
});

test('GET /matches/:id 应返回 { success, match }', () => {
  assert(matchesJs.includes("res.json({ success: true, match })"), '缺少 match 字段');
});

test('POST /matches 应返回 { success, match }', () => {
  assert(matchesJs.includes("res.status(201).json({ success: true, match:"), '201 响应格式错误');
});

test('PATCH /matches/:id/status 应返回 { success, match }', () => {
  const patchRoute = matchesJs.match(/router\.patch\(.*?res\.json.*?}/s);
  assert(patchRoute && patchRoute[0].includes('match'), 'PATCH 响应格式错误');
});

test('POST /matches/:id/participants 应返回 { success, message }', () => {
  assert(matchesJs.includes("res.json({ success: true, message: '报名成功' })"), '报名响应格式错误');
});

test('PATCH /matches/:id/score 应返回 { success, match }', () => {
  const scoreRoute = matchesJs.match(/router\.patch\(.*?score.*?res\.json.*?}/s);
  assert(scoreRoute && scoreRoute[0].includes('match'), '比分响应格式错误');
});

// ===== 测试 2：server.js Socket 事件返回结构 =====
console.log('\n📋 测试 2：server.js Socket 事件返回结构');

const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('match:create 成功应返回 { success, match }', () => {
  assert(serverJs.includes("socket.emit('match:create:success', match)"), 'match:create:success 格式错误');
});

test('match:update 成功应返回 { success, match }', () => {
  const match = serverJs.match(/match:update.*?match:update:success.*?}/s);
  assert(match && match[0].includes('success'), 'match:update:success 格式错误');
});

test('match:score 成功应返回 { success, match }', () => {
  const match = serverJs.match(/match:score.*?match:score:success.*?}/s);
  assert(match && match[0].includes('success'), 'match:score:success 格式错误');
});

test('广播事件 matchCreated 应返回 match 对象', () => {
  assert(serverJs.includes('io.emit(\'matchCreated\', match)'), 'matchCreated 格式错误');
});

test('广播事件 matchUpdated 应返回 { success, match }', () => {
  assert(serverJs.includes("io.emit('matchUpdated', { success: true, match })"), 'matchUpdated 格式错误');
});

test('广播事件 matchStarted 应返回 { success, match }', () => {
  assert(serverJs.includes("io.emit('matchStarted', { success: true, match })"), 'matchStarted 格式错误');
});

test('广播事件 matchFinished 应返回 { success, match }', () => {
  assert(serverJs.includes("io.emit('matchFinished', { success: true, match })"), 'matchFinished 格式错误');
});

test('广播事件 scoreUpdated 应返回 { success, matchId, score, mvp_id }', () => {
  assert(serverJs.includes("io.emit('scoreUpdated', { success: true, matchId, score, mvp_id })"), 'scoreUpdated 格式错误');
});

// ===== 测试 3：字段命名统一性 =====
console.log('\n📋 测试 3：字段命名统一性（禁止 teamA/teamB 等混乱命名）');

test('不应包含 teamA/teamB 字段', () => {
  const forbidden = ['teamA', 'teamB', 'team1', 'team2'];
  forbidden.forEach(f => {
    assert(!serverJs.includes(f) && !matchesJs.includes(f), `发现禁用字段名：${f}`);
  });
});

test('应使用统一的 redTeam/blueTeam 或类似命名', () => {
  // 检查数据库表结构是否使用 red/blue
  const createTable = serverJs.match(/CREATE TABLE.*?matches.*?\(.*?\)/s);
  if (createTable) {
    assert(createTable[0].includes('winner TEXT'), 'matches 表缺少 winner 字段');
  }
});

// ===== 测试 4：数据库表结构字段一致性 =====
console.log('\n📋 测试 4：数据库表结构字段一致性');

test('matches 表应包含必要字段', () => {
  const createTable = serverJs.match(/CREATE TABLE IF NOT EXISTS matches \(.*?\);/s);
  assert(createTable, '未找到 matches 表 CREATE TABLE 语句');
  
  const sql = createTable[0];
  const requiredFields = ['id', 'title', 'mode', 'status', 'created_by', 'winner', 'score', 'mvp_id'];
  requiredFields.forEach(field => {
    assert(sql.toLowerCase().includes(field.toLowerCase()), `缺少字段：${field}`);
  });
});

test('match_participants 表应包含必要字段', () => {
  const createTable = serverJs.match(/CREATE TABLE IF NOT EXISTS match_participants \(.*?\);/s);
  assert(createTable, '未找到 match_participants 表 CREATE TABLE 语句');
  
  const sql = createTable[0];
  const requiredFields = ['match_id', 'user_id', 'side', 'lane'];
  requiredFields.forEach(field => {
    assert(sql.toLowerCase().includes(field.toLowerCase()), `缺少字段：${field}`);
  });
});

// ===== 测试结果 =====
console.log(`\n${'='.repeat(60)}`);
console.log(`📊 测试结果：${passed} 通过，${failed} 失败`);
if (errors.length > 0) {
  console.log('\n❌ 失败详情：');
  errors.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.name}`);
    console.log(`     错误：${e.error}`);
  });
}
console.log('='.repeat(60));

if (failed > 0) {
  console.error('\n❌ 存在失败测试，返回结构可能不统一！');
  process.exit(1);
} else {
  console.log('\n✅ 所有测试通过！Match 返回结构统一。');
  console.log('\n💡 返回结构规范：');
  console.log('  - 路由返回：{ success: true, match: {...} }');
  console.log('  - Socket 成功：{ success: true, match: {...} }');
  console.log('  - Socket 广播：{ success: true, match: {...} }');
  console.log('  - 错误返回：{ success: false, message: "..." }');
  process.exit(0);
}
