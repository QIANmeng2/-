/**
 * 状态机单元测试
 * 使用方法：node test_match_state.js
 */

const { MATCH_STATUS, isValidTransition, getNextStates, isValidStatus } = require('./utils/matchState');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     错误：${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n🧪 开始测试 Match 状态机...\n');

// ===== 测试 MATCH_STATUS 枚举 =====
console.log('📋 测试 1：MATCH_STATUS 枚举');
test('应包含 CREATED 状态', () => {
  assert(MATCH_STATUS.CREATED === 'CREATED', 'CREATED 值错误');
});
test('应包含 REGISTERING 状态', () => {
  assert(MATCH_STATUS.REGISTERING === 'REGISTERING', 'REGISTERING 值错误');
});
test('应包含 READY 状态', () => {
  assert(MATCH_STATUS.READY === 'READY', 'READY 值错误');
});
test('应包含 LIVE 状态', () => {
  assert(MATCH_STATUS.LIVE === 'LIVE', 'LIVE 值错误');
});
test('应包含 FINISHED 状态', () => {
  assert(MATCH_STATUS.FINISHED === 'FINISHED', 'FINISHED 值错误');
});
test('应包含 ARCHIVED 状态', () => {
  assert(MATCH_STATUS.ARCHIVED === 'ARCHIVED', 'ARCHIVED 值错误');
});

// ===== 测试 isValidTransition() =====
console.log('\n📋 测试 2：isValidTransition() - 合法转换');

test('CREATED → REGISTERING 应合法', () => {
  assert(isValidTransition('CREATED', 'REGISTERING'), '应为合法转换');
});

test('REGISTERING → READY 应合法', () => {
  assert(isValidTransition('REGISTERING', 'READY'), '应为合法转换');
});

test('REGISTERING → CREATED 应合法（回退）', () => {
  assert(isValidTransition('REGISTERING', 'CREATED'), '应为合法转换');
});

test('READY → LIVE 应合法', () => {
  assert(isValidTransition('READY', 'LIVE'), '应为合法转换');
});

test('READY → CREATED 应合法（回退）', () => {
  assert(isValidTransition('READY', 'CREATED'), '应为合法转换');
});

test('LIVE → FINISHED 应合法', () => {
  assert(isValidTransition('LIVE', 'FINISHED'), '应为合法转换');
});

test('FINISHED → ARCHIVED 应合法', () => {
  assert(isValidTransition('FINISHED', 'ARCHIVED'), '应为合法转换');
});

console.log('\n📋 测试 3：isValidTransition() - 非法转换（重点测试）');

test('FINISHED → LIVE 应非法 ❌', () => {
  assert(!isValidTransition('FINISHED', 'LIVE'), '应为非法转换');
});

test('ARCHIVED → READY 应非法 ❌', () => {
  assert(!isValidTransition('ARCHIVED', 'READY'), '应为非法转换');
});

test('ARCHIVED → CREATED 应非法 ❌', () => {
  assert(!isValidTransition('ARCHIVED', 'CREATED'), '应为非法转换');
});

test('LIVE → CREATED 应非法 ❌', () => {
  assert(!isValidTransition('LIVE', 'CREATED'), '应为非法转换');
});

test('READY → FINISHED 应非法 ❌', () => {
  assert(!isValidTransition('READY', 'FINISHED'), '应为非法转换');
});

test('CREATED → FINISHED 应非法 ❌', () => {
  assert(!isValidTransition('CREATED', 'FINISHED'), '应为非法转换');
});

test('CREATED → ARCHIVED 应非法 ❌', () => {
  assert(!isValidTransition('CREATED', 'ARCHIVED'), '应为非法转换');
});

console.log('\n📋 测试 4：isValidTransition() - 边界情况');

test('空参数应返回 false', () => {
  assert(!isValidTransition(null, 'CREATED'), '应为 false');
  assert(!isValidTransition('CREATED', null), '应为 false');
  assert(!isValidTransition('', ''), '应为 false');
});

test('小写的状态应正常处理', () => {
  assert(isValidTransition('created', 'registering'), '小写应被转为大写');
  assert(!isValidTransition('finished', 'live'), '小写非法转换也应被拦截');
});

// ===== 测试 getNextStates() =====
console.log('\n📋 测试 5：getNextStates()');

test('CREATED 的下一状态应包含 REGISTERING', () => {
  const next = getNextStates('CREATED');
  assert(next.includes('REGISTERING'), '应包含 REGISTERING');
});

test('ARCHIVED 的下一状态应为空数组', () => {
  const next = getNextStates('ARCHIVED');
  assert(next.length === 0, 'ARCHIVED 是终态，应无下一状态');
});

test('无效状态应返回空数组', () => {
  const next = getNextStates('INVALID_STATUS');
  assert(next.length === 0, '无效状态应返回空数组');
});

// ===== 测试 isValidStatus() =====
console.log('\n📋 测试 6：isValidStatus()');

test('CREATED 应是有效状态', () => {
  assert(isValidStatus('CREATED'), '应为有效状态');
});

test('INVALID_STATUS 应是无效状态', () => {
  assert(!isValidStatus('INVALID_STATUS'), '应为无效状态');
});

test('空值应返回 false', () => {
  assert(!isValidStatus(null), 'null 应返回 false');
  assert(!isValidStatus(''), '空字符串应返回 false');
});

// ===== 测试结果 =====
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 测试结果：${passed} 通过，${failed} 失败`);
console.log('='.repeat(50));

if (failed > 0) {
  console.error('\n❌ 存在失败测试，请检查状态机实现！');
  process.exit(1);
} else {
  console.log('\n🎉 所有测试通过！状态机实现正确。');
  process.exit(0);
}
