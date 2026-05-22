/**
 * Tracker.js — 用户行为埋点 SDK (非阻塞版 v2)
 * - 所有请求 fire-and-forget，永不阻塞主流程
 * - fetch 带 3s 超时自动取消
 * - beforeunload 使用 sendBeacon 保证不丢事件
 * - 手动调用 window.Tracker.init() 才开始工作（不再自动初始化）
 */
(function () {
  var API_BASE = window.API_BASE || 'https://perpetual-enchantment-production-b163.up.railway.app';
  var TRACKER_ENABLED = true;
  var SESSION_ID;
  var pageEnterTime;
  var currentPage;
  var initCalled = false;

  // ===== 白名单事件名 =====
  var EVENTS = {
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

  var VALID_TYPES = Object.keys(EVENTS).map(function(k) { return EVENTS[k]; });

  function _initSession() {
    try {
      var sid = sessionStorage.getItem('qm_session_id');
      if (!sid) {
        sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('qm_session_id', sid);
      }
      SESSION_ID = sid;
      pageEnterTime = Date.now();
      var hash = window.location.hash || 'home';
      currentPage = hash.replace('#', '') || 'home';
    } catch(e) {
      // sessionStorage 不可用时静默降级
      SESSION_ID = 'sess_mem_' + Date.now();
      pageEnterTime = Date.now();
      currentPage = 'home';
    }
  }

  // 核心发送 — 带超时、fire-and-forget
  function _send(body) {
    if (!TRACKER_ENABLED) return;
    try {
      var controller = new AbortController();
      var tid = setTimeout(function() { controller.abort(); }, 3000);
      fetch(API_BASE + '/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        // 低优先级，不抢占主请求带宽
        // keepalive 使请求在页面卸载后继续
        keepalive: true
      }).then(function() {
        clearTimeout(tid);
      }).catch(function() {
        clearTimeout(tid);
        // 完全静默
      });
    } catch(e) {
      // 静默
    }
  }

  // 页面离开时使用 sendBeacon（更可靠）
  function _sendBeacon(body) {
    if (!TRACKER_ENABLED || !navigator.sendBeacon) return;
    try {
      var blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      navigator.sendBeacon(API_BASE + '/api/track', blob);
    } catch(e) {
      // 静默
    }
  }

  function _track(eventType, eventData) {
    if (!TRACKER_ENABLED) return;
    if (VALID_TYPES.indexOf(eventType) === -1) return;
    try {
      var body = {
        event_type: eventType,
        session_id: SESSION_ID,
        page_url: window.location.href,
        event_data: eventData || {}
      };
      _send(body);
    } catch(e) {
      // 静默
    }
  }

  // ===== 初始化（手动调用，fire-and-forget） =====
  function init() {
    if (initCalled) return;
    initCalled = true;
    try {
      _initSession();
      // 发送 page_view（fire-and-forget）
      _track(EVENTS.PAGE_VIEW, { page: currentPage });

      // 离开页面事件 — 使用 sendBeacon
      window.addEventListener('beforeunload', function() {
        try {
          var duration = Math.round((Date.now() - pageEnterTime) / 1000);
          var body = {
            event_type: EVENTS.PAGE_LEAVE,
            session_id: SESSION_ID,
            page_url: window.location.href,
            event_data: { page: currentPage, duration: duration }
          };
          _sendBeacon(body);
        } catch(e) {}
      });

      // hash 变化（SPA 路由）
      window.addEventListener('hashchange', function() {
        try {
          var newPage = (window.location.hash || 'home').replace('#', '') || 'home';
          var duration = Math.round((Date.now() - pageEnterTime) / 1000);
          _track(EVENTS.PAGE_LEAVE, { page: currentPage, duration: duration });
          currentPage = newPage;
          pageEnterTime = Date.now();
          _track(EVENTS.PAGE_VIEW, { page: newPage });
        } catch(e) {}
      });
    } catch(e) {
      // 静默
    }
  }

  // ===== 快捷方法 =====
  function trackTabSwitch(tabName) {
    if (!tabName) return;
    try { _track(EVENTS.TAB_SWITCH, { tab: String(tabName) }); } catch(e) {}
  }

  function trackMatchOpen(matchId) {
    if (!matchId) return;
    try { _track(EVENTS.MATCH_OPEN, { match_id: String(matchId) }); } catch(e) {}
  }

  function trackMatchRegister(matchId, competitionId) {
    if (!matchId) return;
    try {
      _track(EVENTS.MATCH_REGISTER, {
        match_id: String(matchId),
        competition_id: competitionId ? String(competitionId) : null
      });
    } catch(e) {}
  }

  function trackOnboarding(step, action, extra) {
    if (!action) return;
    try {
      var data = extra ? JSON.parse(JSON.stringify(extra)) : {};
      data.action = action;
      if (action === 'start')   _track(EVENTS.ONBOARDING_START, data);
      else if (action === 'step') { data.step = step; _track(EVENTS.ONBOARDING_STEP, data); }
      else if (action === 'complete') _track(EVENTS.ONBOARDING_COMPLETE, data);
      else if (action === 'skip')    _track(EVENTS.ONBOARDING_SKIP, data);
    } catch(e) {}
  }

  function trackTaskView() {
    try { _track(EVENTS.TASK_VIEW, {}); } catch(e) {}
  }

  function trackTaskComplete(taskKey) {
    if (!taskKey) return;
    try { _track(EVENTS.TASK_COMPLETE, { task_key: String(taskKey) }); } catch(e) {}
  }

  function trackTaskClaim(taskKey, reward) {
    if (!taskKey) return;
    try { _track(EVENTS.TASK_CLAIM, { task_key: String(taskKey), reward: parseInt(reward) || 0 }); } catch(e) {}
  }

  // 暴露全局 API
  window.Tracker = {
    EVENTS: EVENTS,
    init: init,
    trackTabSwitch: trackTabSwitch,
    trackMatchOpen: trackMatchOpen,
    trackMatchRegister: trackMatchRegister,
    trackOnboarding: trackOnboarding,
    trackTaskView: trackTaskView,
    trackTaskComplete: trackTaskComplete,
    trackTaskClaim: trackTaskClaim,
    _track: _track,
    // 紧急开关：禁用所有埋点
    disable: function() { TRACKER_ENABLED = false; },
    enable: function() { TRACKER_ENABLED = true; },
    isEnabled: function() { return TRACKER_ENABLED; }
  };

  // ===== 异步延迟初始化（不阻塞主流程） =====
  // 使用 setTimeout 将 init 推迟到下一个事件循环，保证：
  // 1. 不阻塞 DOMContentLoaded
  // 2. 不阻塞 app.js 初始化
  // 3. 即使失败也完全不影响页面
  setTimeout(function() {
    try {
      // 可选：检查是否要禁用（URL 参数 ?notrack=1 或 localStorage 开关）
      if (window.location.search.indexOf('notrack=1') !== -1) {
        TRACKER_ENABLED = false;
        return;
      }
      if (localStorage.getItem('qm_tracker_disabled') === '1') {
        TRACKER_ENABLED = false;
        return;
      }
      init();
    } catch(e) {
      // 绝对静默
    }
  }, 500); // 延迟 500ms，确保页面主流程已启动
})();
