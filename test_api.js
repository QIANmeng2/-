// 完整API测试脚本
const https = require('https');

const BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const opts = { hostname: BASE.replace('https://', ''), path, method, headers };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function test() {
  console.log('=== 测试王者荣耀5v5招募系统 ===\n');

  // 1. 注册测试用户1
  console.log('1. 注册发起人...');
  const user1 = await request('POST', '/api/auth/register', {
    username: 'org_' + Date.now(), password: 'test123',
    teamName: '浅梦战队', coachName: '浅梦', wechat: 'qm_wx', level: '主播'
  });
  console.log('  状态:', user1.status, 'Token:', user1.data.token ? '✓' : '✗');
  const token1 = user1.data.token;

  // 2. 创建招募（模式1 - 自己参赛占对抗路）
  console.log('\n2. 创建招募（模式1）...');
  const create = await request('POST', '/api/recruitment', {
    startTime: '2026-05-15T20:00',
    levelReq: '王者',
    notes: '今晚8点训练赛，BP规则全局BP',
    mode: 1
  }, token1);
  console.log('  状态:', create.status, 'Match ID:', create.data.match?.id);
  const matchId = create.data.match?.id;

  // 3. 获取招募列表
  console.log('\n3. 获取招募列表...');
  const list = await request('GET', '/api/recruitment/active');
  console.log('  状态:', list.status, '数量:', list.data.matches?.length);

  // 4. 获取已满列表
  console.log('\n4. 获取已满列表...');
  const full = await request('GET', '/api/recruitment/full');
  console.log('  状态:', full.status, '数量:', full.data.matches?.length);

  // 5. 注册第二个用户
  console.log('\n5. 注册第二个用户（报名者）...');
  const user2 = await request('POST', '/api/auth/register', {
    username: 'player2_' + Date.now(), password: 'test123',
    teamName: '红队', coachName: '小红', wechat: 'red_wx', level: '王者'
  });
  console.log('  状态:', user2.status, 'Token:', user2.data.token ? '✓' : '✗');
  const token2 = user2.data.token;

  // 6. 第二个用户报名蓝方打野
  console.log('\n6. 用户2报名蓝方打野...');
  const join1 = await request('POST', `/api/recruitment/${matchId}/join`, {
    team: 'blue', lane: '打野'
  }, token2);
  console.log('  状态:', join1.status, join1.data.success ? '成功' : join1.data.message);

  // 7. 查看对局详情
  console.log('\n7. 查看对局详情...');
  const detail = await request('GET', `/api/recruitment/${matchId}`);
  console.log('  状态:', detail.status, '位置数:', detail.data.match?.positions?.length);

  // 8. 第三个用户报名红方中路
  console.log('\n8. 注册第三个用户并报名红方中路...');
  const user3 = await request('POST', '/api/auth/register', {
    username: 'player3_' + Date.now(), password: 'test123',
    teamName: '星之队', coachName: '星星', wechat: 'star_wx', level: '星耀'
  });
  const token3 = user3.data.token;
  const join2 = await request('POST', `/api/recruitment/${matchId}/join`, {
    team: 'red', lane: '中路'
  }, token3);
  console.log('  状态:', join2.status, join2.data.success ? '成功' : join2.data.message);

  // 9. 验证同一用户不能重复报名
  console.log('\n9. 测试：同一用户不能重复报名...');
  const dupJoin = await request('POST', `/api/recruitment/${matchId}/join`, {
    team: 'red', lane: '游走'
  }, token2);
  console.log('  状态:', dupJoin.status, '拦截:', dupJoin.data.message);

  // 10. 发起人不能报名自己的对局
  console.log('\n10. 测试：发起人不能报名自己的对局...');
  const orgJoin = await request('POST', `/api/recruitment/${matchId}/join`, {
    team: 'red', lane: '对抗路'
  }, token1);
  console.log('  状态:', orgJoin.status, '拦截:', orgJoin.data.message);

  // 11. 撤销报名
  console.log('\n11. 用户2撤销报名...');
  const leave = await request('POST', `/api/recruitment/${matchId}/leave`, {}, token2);
  console.log('  状态:', leave.status, leave.data.success ? '成功' : leave.data.message);

  // 12. 关闭报名
  console.log('\n12. 发起人关闭报名...');
  const close = await request('PUT', `/api/recruitment/${matchId}/close`, {}, token1);
  console.log('  状态:', close.status, close.data.success ? '成功' : close.data.message);

  // 13. 验证关闭后不能再报名
  console.log('\n13. 验证关闭后不能报名...');
  const joinAfterClose = await request('POST', `/api/recruitment/${matchId}/join`, {
    team: 'blue', lane: '打野'
  }, token3);
  console.log('  状态:', joinAfterClose.status, '拦截:', joinAfterClose.data.message);

  // 14. 清理测试数据
  console.log('\n14. 清理测试数据...');
  const cancel = await request('DELETE', `/api/recruitment/${matchId}`, {}, token1);
  console.log('  状态:', cancel.status, cancel.data.success ? '成功' : cancel.data.message);

  console.log('\n=== 测试完成 ===');
  console.log('所有接口状态码验证: 200=正常, 400=拦截(预期行为), 401=未登录');
}

test().catch(e => console.error('测试失败:', e.message));
