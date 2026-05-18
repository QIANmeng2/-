/**
 * 招募自动会议监控脚本
 *
 * 功能：轮询数据库，检测"约满"但未创建会议的招募，
 *       自动调用 tmeet CLI 创建腾讯会议并回写数据库
 *
 * 依赖：npm install pg node-cron winston
 * 启动：node auto-meeting-monitor.js
 * 停止：SIGTERM / SIGINT（Ctrl+C）
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const cron = require('node-cron');
const { createLogger, transports, format } = require('winston');

// ====== 配置加载 ======
const CONFIG_PATH = path.join(__dirname, 'config.json');
let cfg;

try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  console.error(`[启动] 配置文件不存在或格式错误: ${CONFIG_PATH}`);
  console.error('请创建 config.json，或设置环境变量覆盖。');
  process.exit(1);
}

// 环境变量覆盖（适用于 Railway 等平台）
const DB_URL = process.env.DATABASE_URL || cfg.db.url;
const POLL_INTERVAL_SEC = parseInt(process.env.POLL_INTERVAL_SEC || cfg.poll.intervalSeconds, 10);
const MEETING_DURATION_HOURS = parseInt(process.env.MEETING_DURATION_HOURS || cfg.meeting.durationHours, 10);
const MEETING_JOIN_TYPE = parseInt(process.env.MEETING_JOIN_TYPE || cfg.meeting.joinType, 10);
const LOG_LEVEL = process.env.LOG_LEVEL || cfg.log.level || 'info';

// ====== Winston 日志 ======
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) =>
      stack ? `${timestamp} [${level.toUpperCase()}] ${message}\n  ${stack}` : `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new transports.Console({ format: format.combine(format.colorize(), format.printf(({ timestamp, level, message, stack }) =>
      stack ? `${timestamp} [${level}] ${message}\n  ${stack}` : `${timestamp} [${level}] ${message}`
    )) }),
    new transports.File({ filename: path.join(logDir, 'error.log'), level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: cfg.log.maxFiles }),
    new transports.File({ filename: path.join(logDir, 'combined.log'), maxsize: 5 * 1024 * 1024, maxFiles: cfg.log.maxFiles }),
  ]
});

// ====== 数据库连接池 ======
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 2, // 监控脚本不需要高并发
  idleTimeoutMillis: 60000,
});

// ====== tmeet CLI 封装 ======
function fmtDate(d) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`;
}

/**
 * 调用 tmeet CLI 创建会议
 * @param {string} subject 会议主题
 * @param {string} startTimeISO ISO 8601 格式时间
 * @returns {Promise<{meetingCode: string, meetingLink: string}>}
 */
function createTencentMeeting(subject, startTimeISO) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const start = new Date(startTimeISO);
    const end = new Date(start.getTime() + MEETING_DURATION_HOURS * 60 * 60 * 1000);
    const startFmt = fmtDate(start);
    const endFmt = fmtDate(end);

    const cmd = `tmeet meeting create --subject "${subject}" --start "${startFmt}" --end "${endFmt}" --join-type ${MEETING_JOIN_TYPE}`;
    logger.debug(`执行: ${cmd}`);

    exec(cmd, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`tmeet 失败: ${stderr || err.message}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error || !result.data?.meeting_info_list?.[0]) {
          reject(new Error(`tmeet 错误: ${result.message || result.error || '未知错误'}`));
          return;
        }
        const info = result.data.meeting_info_list[0];
        resolve({ meetingCode: info.meeting_code, meetingLink: info.join_url });
      } catch (parseErr) {
        reject(new Error(`解析 tmeet 输出失败: ${stdout}`));
      }
    });
  });
}

// ====== 核心处理逻辑 ======
async function processMatches() {
  let client;
  try {
    client = await pool.connect();

    const matches = await client.query(`
      SELECT m.id, m.starttime, m.levelreq, m.mode, m.notes,
             p.total AS totalPositions,
             p.filled AS filledPositions,
             u.teamname AS organizerName
      FROM recruitment_matches m
      JOIN (
        SELECT matchid,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE playerid IS NOT NULL AND playerid != '') AS filled
        FROM recruitment_positions
        GROUP BY matchid
      ) p ON p.matchid = m.id
      LEFT JOIN users u ON m.organizerid = u.id
      WHERE m.locked = true
        AND (m.meetingcode IS NULL OR m.meetingcode = '')
        AND m.status = 'full'
    `);

    if (matches.rows.length === 0) {
      process.stdout.write('.');
      return;
    }

    logger.info(`发现 ${matches.rows.length} 条待处理招募`);
    console.log(`\n[${new Date().toLocaleTimeString('zh-CN')}] 发现 ${matches.rows.length} 条待处理招募`);

    for (const match of matches.rows) {
      const filledPct = match.filledPositions === match.totalPositions ? '全部就绪' : `${match.filledPositions}/${match.totalPositions}`;
      logger.info(`处理招募 [${match.id}] | ${match.starttime} | ${match.levelreq} | ${match.mode} | ${filledPct}`);

      const subject = `KPL训练赛 ${match.starttime} ${match.levelreq}`;

      try {
        const meeting = await createTencentMeeting(subject, match.starttime);
        await client.query(
          `UPDATE recruitment_matches SET meetingcode = $1, meetinglink = $2 WHERE id = $3`,
          [meeting.meetingCode, meeting.meetingLink, match.id]
        );
        logger.info(`会议创建成功: ${meeting.meetingCode} → ${meeting.meetingLink}`);
        console.log(`   ✅ ${match.id} | 会议号: ${meeting.meetingCode}`);
      } catch (e) {
        logger.error(`会议创建失败 [${match.id}]: ${e.message}`);
        console.error(`   ❌ [${match.id}] ${e.message}`);
      }
    }
  } catch (e) {
    logger.error(`数据库错误: ${e.message}`);
  } finally {
    if (client) client.release();
  }
}

// ====== tmeet 登录状态检查 ======
async function checkTmeetLogin() {
  const { execSync } = require('child_process');
  try {
    const status = execSync('tmeet auth status', { encoding: 'utf8' }).trim();
    if (status.includes('未登录') || status.includes('empty')) {
      logger.error('tmeet 未登录，请先运行: tmeet auth login');
      process.exit(1);
    }
    logger.info(`tmeet 已登录: ${status.split('\n')[0]}`);
    return true;
  } catch (e) {
    logger.error('无法获取 tmeet 状态，可能未安装或路径不在 PATH 中');
    return false;
  }
}

// ====== 定时任务 ======
// node-cron 表达式: 每 N 秒
const cronExpr = POLL_INTERVAL_SEC >= 60
  ? `*/${Math.floor(POLL_INTERVAL_SEC / 60)} * * * *`   // ≥60s 用分钟
  : `*/${POLL_INTERVAL_SEC} * * * * *`;                  // <60s 用秒

let scheduledTask = null;

function startScheduler() {
  if (scheduledTask) {
    logger.warn('调度器已启动，忽略重复调用');
    return;
  }
  scheduledTask = cron.schedule(cronExpr, async () => {
    logger.debug('触发轮询...');
    await processMatches();
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  });
  logger.info(`调度器已启动 (cron: ${cronExpr}, 间隔: ${POLL_INTERVAL_SEC}s)`);
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('调度器已停止');
  }
}

// ====== 优雅退出 ======
async function gracefulShutdown(signal) {
  logger.info(`收到 ${signal}，开始优雅退出...`);
  stopScheduler();
  try {
    await pool.end();
    logger.info('数据库连接池已关闭');
  } catch (e) {
    logger.error(`关闭连接池失败: ${e.message}`);
  }
  logger.info('进程退出');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (e) => { logger.error(`未捕获异常: ${e.message}`); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { logger.error(`未处理拒绝: ${reason}`); });

// ====== 启动 ======
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  招募自动会议监控脚本 v2.0');
  console.log(`  轮询间隔：${POLL_INTERVAL_SEC}s`);
  console.log(`  日志级别：${LOG_LEVEL}`);
  console.log('═══════════════════════════════════════════════');

  logger.info(`启动监控脚本 | 轮询间隔: ${POLL_INTERVAL_SEC}s | 日志级别: ${LOG_LEVEL}`);

  // 检查 tmeet 登录
  const tmeetOk = await checkTmeetLogin();
  if (!tmeetOk) {
    console.error('⚠️  tmeet 状态检查失败，脚本将以受限模式继续');
    logger.warn('tmeet 状态检查失败');
  }

  // 立即执行一次，然后定时循环
  await processMatches();
  startScheduler();
}

main().catch(e => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
