/**
 * 后端 API 集成测试
 *
 * 运行：npm test
 *
 * 策略：
 * - Mock pg.Pool/Client 避免真实数据库
 * - 验证实际 API 响应行为（状态码 + 数据结构）
 * - 失败响应格式为 { message }（server.js 当前未使用 ok()/badRequest() 助手）
 */

const mockClientQuery = jest.fn();
const mockPoolQuery = jest.fn();

const mockClient = {
  query: mockClientQuery,
  release: jest.fn(),
};

// 默认 mock：initDB 期间不报错
mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockPoolQuery,
    connect: jest.fn(() => Promise.resolve(mockClient)),
    end: jest.fn(),
  })),
}));

const request = require('supertest');

let app;
beforeAll(async () => {
  app = require('../server.js');
});

beforeEach(() => {
  // 重置所有预设，确保测试之间不互相干扰
  mockClientQuery.mockReset();
  mockPoolQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(async () => {
  if (app && app.close) await app.close();
});

// ====== 测试用例 ======
describe('✅ 基础路由', () => {
  test('GET / → 200 OK', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  test('GET /health → 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});

describe('✅ 认证与授权', () => {
  test('无 token → /api/auth/me 返回 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('无效 token → /api/auth/me 返回 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });

  test('无 token → /api/notifications 返回 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  test('CORS 预检 OPTIONS → 200/204', async () => {
    const res = await request(app)
      .options('/api/competitions')
      .set('Origin', 'https://neondream.cn')
      .set('Access-Control-Request-Method', 'GET');
    expect([200, 204]).toContain(res.status);
  });
});

describe('✅ 认证 API', () => {
  test('POST /api/auth/login 缺参数 → 400 + 统一格式', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('message');
  });

  test('POST /api/auth/login 用户不存在 → 400', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nouser', password: 'pass' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('密码');
  });

  test('POST /api/auth/register 缺参数 → 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'test' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  test('POST /api/auth/register 用户名已存在 → 400', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }], rowCount: 1 });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'pass', coachName: 'c', wechat: 'w' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('存在');
  });

  test('POST /api/auth/register 成功 → 200 + token（当前 res.json 默认200）', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // exists check
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });  // insert
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'pass123', coachName: 'coach', wechat: 'wx123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
  });
});

describe('✅ 赛事 API', () => {
  test('GET /api/competitions → 200', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: '测试赛' }], rowCount: 1 });
    const res = await request(app).get('/api/competitions');
    expect(res.status).toBe(200);
    // 响应结构：{ competitions, elite, regular, secondary }
    expect(res.body).toHaveProperty('competitions');
  });

  test('GET /api/competitions/:id 不存在 → 404', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/competitions/bad-id');
    expect(res.status).toBe(404);
    // 404 响应体可能为空或含 message
    expect(typeof res.body).toBe('object');
  });

  test('POST /api/admin/competitions 无权限 → 401/403', async () => {
    const res = await request(app)
      .post('/api/admin/competitions')
      .send({ name: '赛' });
    expect([401, 403]).toContain(res.status);
  });
});

describe('✅ 队伍 API', () => {
  test('GET /api/teams 成功 → 200 + teams[]', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: '队1', maxmembers: 5, status: 'open', createdat: new Date() }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // members
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // users
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('teams');
    expect(Array.isArray(res.body.teams)).toBe(true);
  });

  test('GET /api/teams/:id 不存在 → 404', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/teams/bad-id');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
  });

  test('GET /api/teams/:id 存在 → 200 + team{}', async () => {
    // 路由需要3次 pool.query 调用
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: '队', captainid: 'u1', status: 'open', maxmembers: 5, createdat: new Date() }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ userid: 'u1', role: 'captain' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'user1', coachname: 'c', level: '星耀', gamerank: '星耀', peakscore: 2000, heropool: '' }], rowCount: 1 });
    const res = await request(app).get('/api/teams/t1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('team');
  });

  test('POST /api/teams 未登录 → 401', async () => {
    const res = await request(app).post('/api/teams').send({ name: '队' });
    expect(res.status).toBe(401);
  });
});

describe('✅ 俱乐部 API', () => {
  test('GET /api/clubs/:id 不存在 → 404', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/clubs/bad-id');
    expect(res.status).toBe(404);
  });
});

describe('✅ 管理员 API', () => {
  test('GET /api/admin/dashboard 无 token → 401', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('GET /api/admin/users 无 token → 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  test('DELETE /api/admin/users/:id 无 token → 401', async () => {
    const res = await request(app).delete('/api/admin/users/u1');
    expect(res.status).toBe(401);
  });
});

describe('✅ 错误处理', () => {
  test('不存在的路由 → 404', async () => {
    const res = await request(app).get('/api/xyz-not-exist');
    expect(res.status).toBe(404);
  });
});
