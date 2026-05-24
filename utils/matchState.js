/**
 * utils/matchState.js
 * Match 状态机工具函数（可复用）
 *
 * 状态机：CREATED → REGISTERING → READY → LIVE → FINISHED → ARCHIVED
 */

const MATCH_STATUS = {
  CREATED:      'CREATED',
  REGISTERING:  'REGISTERING',
  READY:         'READY',
  LIVE:          'LIVE',
  FINISHED:      'FINISHED',
  ARCHIVED:      'ARCHIVED'
};

// 合法状态转换表
const STATUS_TRANSITIONS = {
  [MATCH_STATUS.CREATED]:      [MATCH_STATUS.REGISTERING],
  [MATCH_STATUS.REGISTERING]:  [MATCH_STATUS.READY, MATCH_STATUS.CREATED],       // 回退允许
  [MATCH_STATUS.READY]:         [MATCH_STATUS.LIVE, MATCH_STATUS.CREATED],      // 人数不足可回退
  [MATCH_STATUS.LIVE]:          [MATCH_STATUS.FINISHED],
  [MATCH_STATUS.FINISHED]:     [MATCH_STATUS.ARCHIVED],
  [MATCH_STATUS.ARCHIVED]:     []  // 终态
};

/**
 * 校验状态转换是否合法
 * @param {string} from - 当前状态
 * @param {string} to   - 目标状态
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  if (!from || !to) return false;
  const fromNormalized = from.toUpperCase();
  const toNormalized = to.toUpperCase();
  return STATUS_TRANSITIONS[fromNormalized]?.includes(toNormalized) ?? false;
}

/**
 * 获取状态的所有合法下一状态
 * @param {string} status
 * @returns {string[]}
 */
function getNextStates(status) {
  if (!status) return [];
  return STATUS_TRANSITIONS[status.toUpperCase()] || [];
}

/**
 * 检查状态是否存在
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  if (!status) return false;
  return Object.values(MATCH_STATUS).includes(status.toUpperCase());
}

module.exports = {
  MATCH_STATUS,
  STATUS_TRANSITIONS,
  isValidTransition,
  getNextStates,
  isValidStatus
};
