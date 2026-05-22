/**
 * Tracker.js — 第六阶段用户行为埋点 SDK
 * 硬编码白名单事件，禁止随意命名
 * 所有事件发送必须通过本文件暴露的方法
 */
(function () {
  const API_BASE = window.API_BASE || 'https://perpetual-enchantment-production-b163.up.railway.app';
  const SESSION_ID = (() => {
    try {
      let sid = sessionStorage.getItem('qm_session_id');
      if (!sid) {
        sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('qm_session_id', sid);
      }
      return sid;
    } catch(e) {
      // sessionStorage 不可用（隐私模式/iframe），退回内存模式
      return 'sess_mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
  })();

  // ===== 白名单事件名（禁止修改，与数据库 CHECK 约束对应）=====
  const EVENTS = {
    PAGE_VIEW:        'page_view',
    PAGE_LEAVE:       'page_leave',
    TAB_SWITCH:       'tab_switch',
    MATCH_OPEN:        'match_open',
    MATCH_REGISTER:    'match_register',
    ONBOARDING_START:   'onboarding_start',
    ONBOARDING_STEP:   'onboarding_step',
    ONBOARDING_COMPLETE:'onboarding_complete',
    ONBOARDING_SKIP:   'onboarding_skip',
    TASK_VIEW:         'task_view',
    TASK_COMPLETE:     'task_complete',
    TASK_CLAIM:        'task_claim',
  };

  // 所有合法事件名（用于校验）
  const VALID_TYPES = Object.values(EVENTS);

  let pageEnterTime = Date.now();
  let currentPage = null;

  // 核心发送方法（内部使用，校验 eventType 是否在白名单中）
  function _track(eventType, eventData = {}) {
    if (!VALID_TYPES.includes(eventType)) {
      console.warn('[Tracker] 非法事件名:', eventType, '已忽略。只允许：', VALID_TYPES.join(', '));
      return;
    }
    const body = {
      event_type: eventType,
      session_id: SESSION_ID,
      page_url: window.location.href,
      event_data: eventData || {}
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    fetch(API_BASE + '/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    }).catch(() => {
      // 静默失败，不阻塞用户操作
    }).finally(() => clearTimeout(timeoutId));
  }

  // 初始化：生成 sessionId，绑定 page_leave，发送 page_view
  function init() {
    // 标记页面进入
    const hash = window.location.hash || 'home';
    currentPage = hash.replace('#', '') || 'home';
    _track(EVENTS.PAGE_VIEW, { page: currentPage });

    // 离开页面时发送 page_leave + 停留时长
    window.addEventListener('beforeunload', () => {
      const duration = Math.round((Date.now() - pageEnterTime) / 1000);
      _track(EVENTS.PAGE_LEAVE, { page: currentPage, duration });
    });

    // hash 变化时更新 currentPage（SPA 路由）
    window.addEventListener('hashchange', () => {
      const newPage = (window.location.hash || 'home').replace('#', '') || 'home';
      // 发送旧页面离开
      const duration = Math.round((Date.now() - pageEnterTime) / 1000);
      _track(EVENTS.PAGE_LEAVE, { page: currentPage, duration });
      // 进入新页面
      currentPage = newPage;
      pageEnterTime = Date.now();
      _track(EVENTS.PAGE_VIEW, { page: newPage });
    });

    console.log('[Tracker] 初始化完成，session:', SESSION_ID);
  }

  // ===== 快捷方法（对外暴露，只允许调这些方法）=====

  function trackTabSwitch(tabName) {
    if (!tabName) return;
    _track(EVENTS.TAB_SWITCH, { tab: String(tabName) });
  }

  function trackMatchOpen(matchId) {
    if (!matchId) return;
    _track(EVENTS.MATCH_OPEN, { match_id: String(matchId) });
  }

  function trackMatchRegister(matchId, competitionId) {
    if (!matchId) return;
    _track(EVENTS.MATCH_REGISTER, {
      match_id: String(matchId),
      competition_id: competitionId ? String(competitionId) : null
    });
  }

  function trackOnboarding(step, action, extra = {}) {
    // action: 'start' | 'step' | 'complete' | 'skip'
    if (!action) return;
    const data = { action, ...extra };
    if (action === 'start')   _track(EVENTS.ONBOARDING_START, data);
    else if (action === 'step') {
      data.step = step;
      _track(EVENTS.ONBOARDING_STEP, data);
    }
    else if (action === 'complete') _track(EVENTS.ONBOARDING_COMPLETE, data);
    else if (action === 'skip')    _track(EVENTS.ONBOARDING_SKIP, data);
  }

  function trackTaskView() {
    _track(EVENTS.TASK_VIEW, {});
  }

  function trackTaskComplete(taskKey) {
    if (!taskKey) return;
    _track(EVENTS.TASK_COMPLETE, { task_key: String(taskKey) });
  }

  function trackTaskClaim(taskKey, reward) {
    if (!taskKey) return;
    _track(EVENTS.TASK_CLAIM, { task_key: String(taskKey), reward: parseInt(reward) || 0 });
  }

  // 暴露全局 API
  window.Tracker = {
    EVENTS,
    init,
    trackTabSwitch,
    trackMatchOpen,
    trackMatchRegister,
    trackOnboarding,
    trackTaskView,
    trackTaskComplete,
    trackTaskClaim,
    // 仅供调试用，生产环境不建议使用
    _track
  };

  // 自动初始化（DOM Ready）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
