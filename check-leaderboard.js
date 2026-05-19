#!/usr/bin/env node
// ===================================================
// 榜单检查与修复脚本（Node.js 版）
// 适用：qianmeng 项目（Express + PostgreSQL + Railway）
//
// 用法：
//   node check-leaderboard.js              # 检查两个榜单
//   node check-leaderboard.js --fix        # 检查并尝试自动修复
//   node check-leaderboard.js --cron       # 静默模式（用于 crontab）
//
// Crontab 设置（每 10 分钟）：
//   */10 * * * * /usr/bin/node /path/to/check-leaderboard.js --cron >> /var/log/qianmeng-leaderboard.log 2>&1
// ===================================================

const https = require('https');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ------- 配置 -------
const CONFIG = {
  apiBase:    process.env.API_BASE || 'https://perpetual-enchantment-production-b163.up.railway.app',
  dbConnectionString: process.env.DATABASE_URL || 'postgres://postgres:OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD@yamabiko.proxy.rlwy.net:35510/railway',
  logFile:     process.env.LOG_FILE || '/var/log/qianmeng-leaderboard.log',
  notifyHook:  process.env.NOTIFY_HOOK || '',   // 企业微信/钉钉 webhook
};

const isCron = process.argv.includes('--cron');
const shouldFix = process.argv.includes('--fix');

// ------- 日志 -------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (isCron) {
    try { fs.appendFileSync(CONFIG.logFile, line + '\n'); } catch (_) {}
  } else {
    console.log(line);
  }
}

function logError(msg) {
  log(`ERROR: ${msg}`);
  if (CONFIG.notifyHook) {
    // 简易 webhook 通知（可选）
    const payload = JSON.stringify({ text: `【浅梦榜单异常】\n${msg}` });
    const url = new URL(CONFIG.notifyHook);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, () => {});
    req.on('error', () => {});
    req.end(payload);
  }
}

// ------- HTTP GET 封装 -------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// ------- Step1：检查榜单 API 状态 -------
async function checkApi(type) {
  const url = `${CONFIG.apiBase}/api/leaderboard?type=${type}&limit=5`;
  log(`检查 ${type} 榜单 API: ${url}`);
  try {
    const { statusCode, data } = await httpGet(url);
    log(`  HTTP 状态码: ${statusCode}`);
    if (statusCode !== 200) {
      logError(`${type} 榜单 API 返回 ${statusCode}: ${data.substring(0, 200)}`);
      return false;
    }
    const json = JSON.parse(data);
    if (!json.success) {
      logError(`${type} 榜单 API 返回 success=false: ${json.message}`);
      return false;
    }
    const count = (json.data && json.data.list) ? json.data.list.length : 0;
    log(`  ✓ 成功，返回 ${count} 条记录`);
    return true;
  } catch (e) {
    logError(`${type} 榜单 API 调用失败: ${e.message}`);
    return false;
  }
}

// ------- Step2：直接检查数据库榜单数据 -------
async function checkDatabase(pool) {
  log('检查数据库榜单相关表...');
  try {
    // 检查 players 表记录数
    const pRes = await pool.query('SELECT COUNT(*) AS cnt FROM players');
    const pCount = pRes.rows[0].cnt;
    log(`  players 表记录数: ${pCount}`);

    // 检查 clubs 表记录数
    const cRes = await pool.query('SELECT COUNT(*) AS cnt FROM clubs');
    const cCount = cRes.rows[0].cnt;
    log(`  clubs 表记录数: ${cCount}`);

    // 执行一次实际榜单查询，验证 SQL 正确性
    log('  测试 player 榜单 SQL...');
    const sql1 = `
      SELECT 
        p.id,
        p.player_score,
        p.market_value AS player_value,
        u.username,
        u.gameId,
        u.dream_coins,
        c.name AS club_name
      FROM players p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN clubs c ON p.club_id = c.id
      ORDER BY p.player_score DESC
      LIMIT 5`;
    const r1 = await pool.query(sql1);
    log(`  ✓ player 榜单查询成功，返回 ${r1.rows.length} 条`);

    log('  测试 club 榜单 SQL...');
    const sql2 = `
      SELECT 
        c.id,
        c.name AS club_name,
        c.club_score,
        u.username AS boss_name,
        u.gameId AS boss_game_id
      FROM clubs c
      LEFT JOIN users u ON c.owner_id = u.id
      ORDER BY c.club_score DESC
      LIMIT 5`;
    const r2 = await pool.query(sql2);
    log(`  ✓ club 榜单查询成功，返回 ${r2.rows.length} 条`);

    return true;
  } catch (e) {
    logError(`数据库检查失败: ${e.message}`);
    return false;
  }
}

// ------- Step3：（可选）尝试自动修复 -------
async function tryFix(pool) {
  if (!shouldFix) return;
  log('尝试自动修复...');
  // 目前无自动修复逻辑（根因是代码 bug，需部署新版本）
  // 这里可以加入：检查并创建缺失索引、修复异常数据等
  log('  自动修复暂未实现（请部署修复后的代码）');
}

// ------- Main -------
(async () => {
  log('======== 榜单检查开始 ========');

  // Step1：检查 API
  const playerOk = await checkApi('player');
  const clubOk   = await checkApi('club');

  // Step2：如果 API 失败，直接查数据库定位根因
  if (!playerOk || !clubOk) {
    log('API 异常，直接检查数据库...');
    const pool = new Pool({
      connectionString: CONFIG.dbConnectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await checkDatabase(pool);
    } finally {
      await pool.end();
    }
  }

  // Step3：尝试修复（--fix 模式）
  if (!playerOk || !clubOk) {
    const pool = new Pool({
      connectionString: CONFIG.dbConnectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await tryFix(pool);
    } finally {
      await pool.end();
    }
  }

  log(`======== 榜单检查完成 ========'`);
  log('');

  if (playerOk && clubOk) {
    if (!isCron) console.log('✅ 榜单 API 正常');
    process.exit(0);
  } else {
    if (!isCron) console.error('❌ 榜单 API 异常，请查看日志');
    process.exit(1);
  }
})();
