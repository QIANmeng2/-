const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@yamabiko.proxy.rlwy.net:35510/railway' });

const qm3 = 'mp725x87346eyc'; // QM.Ⅲ
const qm9 = 'mp729nfv6oa7ou'; // QM.Ⅸ

// QM.Ⅲ: 剑下
// QM.Ⅸ: 错花雪, 有希, aa, Y-深海, 桃乐赛, 毫发常重
const adds = [
  [qm3, 'mp6dog42bxkcj9', '剑下'],
  [qm9, 'mp6qppieotrke5', '错花雪'],
  [qm9, 'mp7wy7212itqpf', '有希'],
  [qm9, 'mp5o8mgoxbca1a', 'aa'],
  [qm9, 'mp6nfarqh25ebt', 'Y-深海'],
  [qm9, 'mp7x61qi46t83b', '桃乐赛'],
  [qm9, 'mp6lfvicfuy7ei', '毫发常重'],
];

async function run() {
  for (const [teamId, userId, name] of adds) {
    try {
      await pool.query('DELETE FROM team_members WHERE userId = $1', [userId]);
      await pool.query('INSERT INTO team_members (teamId, userId, role) VALUES ($1, $2, $3)', [teamId, userId, 'member']);
      console.log('OK:', name, '->', teamId);
    } catch(e) {
      if (e.code === '23505') console.log('ALREADY:', name);
      else console.log('ERROR:', name, e.message);
    }
  }
  // 验证
  console.log('\n--- QM.Ⅲ 成员 ---');
  const m3 = await pool.query('SELECT u.username, u.coachname FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = $1', [qm3]);
  m3.rows.forEach(r => console.log(r.username, r.coachname));

  console.log('\n--- QM.Ⅸ 成员 ---');
  const m9 = await pool.query('SELECT u.username, u.coachname FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = $1', [qm9]);
  m9.rows.forEach(r => console.log(r.username, r.coachname));

  pool.end();
}
run();
