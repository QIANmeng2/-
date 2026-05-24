/**
 * components.js — 组件加载器 & 事件委托
 *
 * 职责：
 *  1. 暴露全局 API：window.Components = { MatchCard, ScoreBoard, Timeline, MVPPanel, MatchStatusBadge }
 *  2. 组件点击委托（MatchCard → openMatchDetail）
 *  3. 提供一个统一 mount 入口，供 app.js 调用
 *
 * 使用方式（index.html 中）：
 *  <script src="components/MatchStatusBadge.js"></script>
 *  <script src="components/MatchCard.js"></script>
 *  <script src="components/ScoreBoard.js"></script>
 *  <script src="components/Timeline.js"></script>
 *  <script src="components/MVPPanel.js"></script>
 *  <script src="components/PlayerList.js"></script>
 *  <script src="components/RegistrationPanel.js"></script>
 *  <script src="components.js"></script>   ← 必须在所有组件之后
 */

(function () {
  'use strict';

  // ─── 暴露统一命名空间 ──────────────────────────────
  window.Components = {
    MatchStatusBadge:  window.MatchStatusBadge,
    MatchCard:         window.MatchCard,
    ScoreBoard:        window.ScoreBoard,
    Timeline:          window.Timeline,
    MVPPanel:          window.MVPPanel,
    PlayerList:        window.PlayerList,
    RegistrationPanel: window.RegistrationPanel,
  };

  // ─── MatchCard 点击委托（事件委托，只绑一次）───
  // 所有 .match-card[data-match-id] 的点击都会到这里
  document.addEventListener('click', function (e) {
    const card = e.target.closest('.match-card[data-match-id]');
    if (!card) return;
    const matchId = card.dataset.matchId;
    if (!matchId) return;

    // 如果 app.js 暴露了 onMatchCardClick，则调用
    if (typeof window.onMatchCardClick === 'function') {
      window.onMatchCardClick(matchId, card);
    } else {
      // 兜底：直接跳转/弹窗
      console.log('[Components] MatchCard clicked:', matchId);
      if (typeof window.openMatchDetail === 'function') {
        window.openMatchDetail(matchId);
      }
    }
  });

  // ─── 统一 mount 入口 ─────────────────────────────
  /**
   * 根据容器 data-component 属性自动挂载对应组件
   * 用法：在 HTML 中写
   *   <div data-component="MatchCard" data-match-id="abc"></div>
   * 然后调用 Components.autoMount()
   */
  Components.autoMount = function (container) {
    const root = container || document;
    const nodes = root.querySelectorAll('[data-component]');
    nodes.forEach(node => {
      const name    = node.dataset.component;   // 'MatchCard' | 'ScoreBoard' | ...
      const matchId = node.dataset.matchId;
      if (!name) return;

      // 如果有 matchId，先拉数据再渲染
      if (matchId) {
        fetchMatchAndMount(name, node, matchId);
      }
    });
  };

  /**
   * 拉取 match 数据后挂载组件
   */
  async function fetchMatchAndMount(componentName, node, matchId) {
    try {
      const API = window.API_BASE || '';
      const res  = await fetch(`${API}/api/matches/${matchId}`);
      const json = await res.json();
      const match = json.match || json.data || json;
      if (!match) return;
      mountOne(componentName, node, match);
    } catch (err) {
      console.error('[Components] fetchMatchAndMount error:', err);
    }
  }

  /**
   * 调用单个组件的 render → innerHTML
   */
  function mountOne(name, node, match) {
    const comp = Components[name];
    if (!comp || typeof comp.render !== 'function') {
      console.warn(`[Components] ${name} not found or has no render()`);
      return;
    }
    // 读取节点上的 data-* 选项（JSON 字符串）
    let opts = {};
    try { opts = node.dataset.opts ? JSON.parse(node.dataset.opts) : {}; } catch {}

    node.innerHTML = comp.render(match, opts);
  }

  // ─── 快捷 API：供 app.js 直接调用 ─────────────────
  /**
   * 渲染比赛列表到指定容器
   * Components.renderMatchList(container, matches, opts)
   */
  Components.renderMatchList = function (container, matches, opts) {
    if (!container || !window.MatchCard) return;
    container.innerHTML = window.MatchCard.renderList(matches, opts);
  };

  /**
   * 渲染 ScoreBoard 到容器
   * Components.renderScoreBoard(container, match, opts)
   */
  Components.renderScoreBoard = function (container, match, opts) {
    if (!container || !window.ScoreBoard) return;
    window.ScoreBoard.mount(container, match, opts);
  };

  /**
   * 渲染 Timeline 到容器
   * Components.renderTimeline(container, match, opts)
   */
  Components.renderTimeline = function (container, match, opts) {
    if (!container || !window.Timeline) return;
    window.Timeline.mount(container, match, opts);
  };

  /**
   * 渲染 MVP 面板到容器
   * Components.renderMVPPanel(container, match, opts)
   */
  Components.renderMVPPanel = function (container, match, opts) {
    if (!container || !window.MVPPanel) return;
    window.MVPPanel.mount(container, match, opts);
  };

  /**
   * 渲染状态标签到容器
   * Components.renderStatusBadge(container, match, opts)
   */
  Components.renderStatusBadge = function (container, match, opts) {
    if (!container || !window.MatchStatusBadge) return;
    window.MatchStatusBadge.mount(container, match, opts);
  };

  /**
   * 渲染参赛人员列表到容器
   * Components.renderPlayerList(container, registrations, opts)
   */
  Components.renderPlayerList = function (container, registrations, opts) {
    if (!container || !window.PlayerList) return;
    window.PlayerList.mount(container, registrations, opts);
  };

  /**
   * 渲染报名面板到容器
   * Components.renderRegistrationPanel(container, match, userState, opts)
   */
  Components.renderRegistrationPanel = function (container, match, userState, opts) {
    if (!container || !window.RegistrationPanel) return;
    window.RegistrationPanel.mount(container, match, userState, opts);
  };

  console.log('[Components] 组件系统已加载，7 个组件就绪。');
})();
