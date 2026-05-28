// fortuneView.js — 每日卜卦 UI 渲染
// IIFE 暴露 window.FortuneView

(function () {
  'use strict';

  // 卦象配置
  var FORTUNE_CONFIG = {
    great:    { label: '大吉', color: '#fbbf24', glow: 'rgba(251,191,36,0.4)',   icon: '🔥' },
    good:     { label: '中吉', color: '#a3e635', glow: 'rgba(163,230,53,0.35)',  icon: '✨' },
    fair:     { label: '小吉', color: '#818cf8', glow: 'rgba(129,140,248,0.3)',  icon: '💫' },
    bad:      { label: '凶',   color: '#f97316', glow: 'rgba(249,115,22,0.35)',  icon: '⚡' },
    terrible: { label: '大凶', color: '#ef4444', glow: 'rgba(239,68,68,0.4)',    icon: '🌪' }
  };

  /**
   * 渲染未卜卦状态卡
   */
  function _renderUnclaimed() {
    return '' +
      '<div class="fortune-card fortune-card--idle">' +
        '<div class="fortune-icon-ring">' +
          '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/>' +
            '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10"/>' +
            '<path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/>' +
            '<line x1="2" y1="12" x2="22" y2="12"/>' +
          '</svg>' +
        '</div>' +
        '<div class="fortune-title">开运卜卦</div>' +
        '<div class="fortune-subtitle">今日还未卜卦</div>' +
        '<div class="fortune-hint">上分前先来看看今日运势</div>' +
        '<button class="fortune-btn" onclick="FortuneView.onDraw()">' +
          '<span class="fortune-btn-icon">🎴</span>开始卜卦' +
        '</button>' +
      '</div>';
  }

  /**
   * 渲染已卜卦结果卡
   */
  function _renderClaimed(state) {
    var cfg = FORTUNE_CONFIG[state.fortuneType] || FORTUNE_CONFIG.fair;
    return '' +
      '<div class="fortune-card fortune-card--result">' +
        '<div class="fortune-badge" style="border-color:' + cfg.color + ';box-shadow:0 0 20px ' + cfg.glow + ';">' +
          '<span class="fortune-badge-icon">' + cfg.icon + '</span>' +
          '<span class="fortune-badge-text" style="color:' + cfg.color + ';">' + cfg.label + '</span>' +
        '</div>' +
        '<div class="fortune-message">' + (state.fortuneText || '') + '</div>' +
        '<div class="fortune-reward">' +
          '<span class="fortune-coin">+</span>' + state.reward +
          '<span class="fortune-coin-icon">💎</span>梦币已到账' +
        '</div>' +
        '<div class="fortune-divider"></div>' +
        '<div class="fortune-tomorrow">明日再来卜一卦</div>' +
      '</div>';
  }

  /**
   * 渲染加载状态
   */
  function _renderLoading() {
    return '' +
      '<div class="fortune-card fortune-card--loading">' +
        '<div class="fortune-spinner"></div>' +
        '<div class="fortune-subtitle">灵力汇聚中...</div>' +
      '</div>';
  }

  /**
   * 渲染错误状态
   */
  function _renderError() {
    return '' +
      '<div class="fortune-card fortune-card--idle">' +
        '<div class="fortune-title">开运卜卦</div>' +
        '<div class="fortune-subtitle" style="color:var(--text-muted);">加载失败</div>' +
        '<button class="fortune-btn" onclick="FortuneView.init()" style="margin-top:12px;">重试</button>' +
      '</div>';
  }

  var _containerId = null;

  var FortuneView = {
    /**
     * 初始化卜卦视图到指定容器
     * @param {string} containerId - DOM 容器 ID
     */
    init: function (containerId) {
      _containerId = containerId || 'fortuneMount';

      // 未登录不渲染
      if (typeof currentUser === 'undefined' || !currentUser) {
        var el = document.getElementById(_containerId);
        if (el) el.innerHTML = '';
        return;
      }

      // 渲染初始加载状态
      var el = document.getElementById(_containerId);
      if (el) el.innerHTML = _renderLoading();

      // 从服务器初始化状态
      if (window.FortuneStore) {
        window.FortuneStore.init();
      }
    },

    /**
     * 状态变更回调（由 FortuneStore 触发）
     */
    render: function (state) {
      var el = document.getElementById(_containerId);
      if (!el) return;

      switch (state.status) {
        case 'loading':
          el.innerHTML = _renderLoading();
          break;
        case 'unclaimed':
          el.innerHTML = _renderUnclaimed();
          break;
        case 'claimed':
          el.innerHTML = _renderClaimed(state);
          // 同步更新梦币余额
          _updateCoinDisplay(state.newBalance);
          break;
        case 'error':
          el.innerHTML = _renderError();
          break;
      }
    },

    /**
     * 从顶部签到按钮触发卜卦（不依赖 fortuneMount 容器）
     * 如果 fortuneMount 存在则播放动画，否则直接走 API 显示 toast
     */
    drawFromTop: async function () {
      // 未登录
      if (typeof currentUser === 'undefined' || !currentUser) {
        if (typeof openAuthModal === 'function') openAuthModal('login');
        if (typeof showToast === 'function') showToast('请先登录', 'info');
        return;
      }

      if (!window.FortuneStore) return;

      var state = window.FortuneStore.getState();

      // 如果 Store 还在初始化（loading），等待它完成
      if (state.status === 'loading') {
        // 手动触发 init 确保状态同步
        await window.FortuneStore.init();
        state = window.FortuneStore.getState();
      }

      if (state.status === 'claimed') {
        if (typeof showToast === 'function') {
          showToast('今日已卜卦 — ' + (state.fortuneType ? (FORTUNE_CONFIG[state.fortuneType] || {}).label || '' : '') + '，明日再来', 'info');
        }
        return;
      }

      if (state.status !== 'unclaimed') {
        if (typeof showToast === 'function') showToast('卜卦状态异常，请刷新页面重试', 'error');
        return;
      }

      // 播放动画（如果 fortuneMount 容器存在）
      var el = document.getElementById(_containerId || 'fortuneMount');
      if (el && window.FortuneAnim) {
        await window.FortuneAnim.play(el);
      }

      // 调用 API
      try {
        await window.FortuneStore.draw();
        // 从 Store 读取最终状态（避免 result 竞态为 undefined）
        var finalState = window.FortuneStore.getState();
        // 更新梦币显示
        if (currentUser && finalState.newBalance) {
          currentUser.dream_coins = finalState.newBalance;
        }
        if (typeof updateUI === 'function') updateUI();
        // 显示 toast
        if (typeof showToast === 'function' && finalState.fortuneType) {
          var cfg = FORTUNE_CONFIG[finalState.fortuneType] || FORTUNE_CONFIG.fair;
          showToast(cfg.icon + ' ' + cfg.label + '！获得 ' + finalState.reward + ' 梦币 💎', 'success');
        }
      } catch (e) {
        if (typeof showToast === 'function') {
          showToast(e.message || '卜卦失败，请重试', 'error');
        }
      }
    },

    /**
     * 检查今日卜卦状态（供 app.js updateUI 调用）
     * 更新顶部签到按钮文案和样式
     */
    checkTodayState: async function () {
      if (!window.FortuneAPI || typeof currentUser === 'undefined' || !currentUser) return;
      try {
        var data = await window.FortuneAPI.getStatus();
        var btn = document.getElementById('btnCheckin');
        if (!btn) return;
        if (data && data.claimed_today) {
          var cfg = FORTUNE_CONFIG[data.fortune_type] || {};
          btn.textContent = (cfg.icon || '') + ' 今日' + (cfg.label || '') + ' ✓';
          btn.style.opacity = '0.6';
          btn.style.cursor = 'default';
          btn.onclick = function () {
            if (typeof showToast === 'function') {
              showToast('今日已卜卦 — ' + (cfg.label || '') + '，明日再来', 'info');
            }
          };
        } else {
          btn.textContent = '卜卦领币';
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.onclick = FortuneView.drawFromTop;
        }
      } catch (e) { /* 静默失败 */ }
    },

    /**
     * 点击「开始卜卦」
     */
    onDraw: async function () {
      if (!window.FortuneStore) return;

      // 播放动画
      var el = document.getElementById(_containerId);
      if (el && window.FortuneAnim) {
        await window.FortuneAnim.play(el);
      }

      // 调用 API
      try {
        await window.FortuneStore.draw();
      } catch (e) {
        if (typeof showToast === 'function') {
          showToast(e.message || '卜卦失败，请重试', 'error');
        }
      }
    }
  };

  /**
   * 更新全局梦币显示
   */
  function _updateCoinDisplay(newBalance) {
    if (newBalance === undefined || newBalance === 0) return;
    var coinDisplay = document.getElementById('coinDisplay');
    if (coinDisplay) {
      coinDisplay.textContent = '💎 ' + newBalance;
    }
  }

  // 自动订阅状态变更
  if (window.FortuneStore) {
    window.FortuneStore.subscribe(function (state) {
      FortuneView.render(state);
    });
  }

  window.FortuneView = FortuneView;
})();
