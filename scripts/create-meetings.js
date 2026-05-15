#!/usr/bin/env node
/**
 * 浅梦训练赛平台 - 腾讯会议自动建会脚本
 * 每5分钟运行一次，检查 mode=2（纯组织者）招募是否即将开赛
 * 赛前10分钟自动创建 A队+B队 两个腾讯会议并更新到服务器
 *
 * 依赖：tmeet CLI（需已安装并登录）
 * 运行：node scripts/create-meetings.js
 */

const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';
const TMEET_BIN = process.platform === 'win32'
  ? 'C:/Users/ASUS/.workbuddy/binaries/node/cli-connector-packages/tmeet.cmd'
  : 'tmeet';

const { execSync } = require('child_process');

function tmeet(args) {
  const cmd = `"${TMEET_BIN}" ${args} --format json-pretty`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    return JSON.parse(out);
  } catch (err) {
    const msg = err.stderr || err.stdout || '';
    if (msg.includes('refresh token failed') || msg.includes('user config is empty')) {
      throw new Error('TMEET_NOT_LOGGED_IN');
    }
    throw new Error(`tmeet 错误: ${msg.substring(0, 200)}`);
  }
}

function api(path, options = {}) {
  const { method = 'GET', body } = options;
  const url = `${API_BASE}${path}`;
  const fetch = require('child_process').execSync;
  let cmd = `curl -s -X ${method} "${url}"`;
  if (body) {
    const escaped = body.replace(/"/g, '\\"');
    cmd += ` -H "Content-Type: application/json" -d "${escaped}"`;
  }
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (err) {
    const raw = err.stdout ? err.stdout.toString() : '';
    try { return JSON.parse(raw); } catch { return {}; }
  }
}

function apiWithAuth(path, options = {}, token) {
  const { method = 'GET', body } = options;
  const url = `${API_BASE}${path}`;
  let cmd = `curl -s -X ${method} "${url}" -H "Authorization: Bearer ${token}"`;
  if (body) {
    const escaped = body.replace(/"/g, '\\"');
    cmd += ` -H "Content-Type: application/json" -d "${escaped}"`;
  }
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (err) {
    const raw = err.stdout ? err.stdout.toString() : '';
    try { return JSON.parse(raw); } catch { return {}; }
  }
}

function formatISO(date) {
  // "2026-05-15T20:00+08:00"
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  log('=== 腾讯会议自动建会脚本启动 ===');

  // Step 1: 检查 tmeet 登录状态
  try {
    tmeet('auth status');
    log('tmeet 已登录');
  } catch (e) {
    if (e.message === 'TMEET_NOT_LOGGED_IN') {
      log('❌ tmeet 未登录或登录已过期');
      log('请运行以下命令重新登录:');
      log('  tmeet auth login');
      log('登录后重新触发本脚本');
      process.exit(1);
    }
    throw e;
  }

  // Step 2: 获取所有 active matches，筛选 mode=2 且需要建会的
  log('查询待建会招募...');
  let matches = [];
  try {
    const data = api('/api/recruitment/active');
    matches = (data.matches || []).filter(m =>
      m.mode === 2 &&
      !m.meetingA
    );
  } catch (e) {
    log(`查询失败: ${e.message}`);
    process.exit(1);
  }

  if (matches.length === 0) {
    log('暂无需要建会的招募');
    process.exit(0);
  }

  log(`找到 ${matches.length} 个待建会招募`);

  for (const match of matches) {
    const startTime = new Date(match.startTime);
    const now = new Date();
    const diffMin = (startTime - now) / 60000;

    // 只处理赛前5~15分钟内的招募（提前建会，留缓冲）
    if (diffMin > 15 || diffMin < 5) {
      log(`跳过 "${match.startTime}"（距开赛 ${Math.round(diffMin)} 分钟，不在建会窗口内）`);
      continue;
    }

    log(`处理招募 ${match.id}（${match.startTime}，距开赛 ${Math.round(diffMin)} 分钟）...`);

    // Step 3: 创建 A 队会议
    const meetingStart = new Date(startTime.getTime() - 10 * 60 * 1000);
    const meetingEnd = new Date(meetingStart.getTime() + 2 * 60 * 60 * 1000);
    const subject = `训练赛 · ${match.startTime}`;

    let codeA = '', linkA = '';

    try {
      log(`创建腾讯会议: ${subject}`);
      const outA = tmeet(`meeting create --subject "${subject}" --start "${formatISO(meetingStart)}+08:00" --end "${formatISO(meetingEnd)}+08:00"`);
      codeA = outA.meeting_code || outA.meetingCode || outA.meeting_id || '';
      linkA = outA.join_url || outA.joinUrl || (codeA ? `https://meeting.tencent.com/s/${codeA}` : '');
      log(`  会议号: ${codeA} ${linkA}`);
    } catch (e) {
      log(`  建会失败: ${e.message}`);
      continue;
    }

    if (!codeA) {
      log('建会成功但未获取到会议号，跳过更新');
      continue;
    }

    // Step 4: 更新服务器（通过 server.js 的建会接口，需要 organizer token）
    // 由于服务器端无法运行 tmeet，这里直接用 UPDATE SQL 写入数据库
    // 需要数据库直连或通过服务器的 admin 接口
    // 简化处理：将会议信息通过 /api/recruitment/:id/meeting 写入
    // 但该接口需要 organizer 的 JWT token
    // 暂用环保变量 ADMIN_TOKEN（若有）或跳过
    const adminToken = process.env.ADMIN_TOKEN;
    if (adminToken) {
      try {
        const body = JSON.stringify({ codeA, linkA });
        const out = execSync(`curl -s -X PUT "${API_BASE}/api/recruitment/${match.id}/meeting-manual" -H "Content-Type: application/json" -H "x-admin-secret: ${adminToken}" -d "${body.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout: 15000 });
        log(`服务器更新结果: ${out}`);
      } catch (e) {
        log(`服务器更新失败: ${e.message}`);
      }
    } else {
      // 无 token 时输出 SQL，需手动执行
      log('未设置 ADMIN_TOKEN 环境变量，请手动执行以下 SQL 更新数据库:');
      log(`  UPDATE recruitment_matches SET meetingcodea='${codeA}', meetinglinka='${linkA}' WHERE id='${match.id}';`);
    }

    log(`✅ 招募 ${match.id} 建会完成`);
  }

  log('=== 脚本执行完毕 ===');
}

main().catch(e => {
  log(`未捕获错误: ${e.message}`);
  process.exit(1);
});
