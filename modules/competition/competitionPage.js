/**
 * competitionPage.js — 赛事独立页初始化入口
 *
 * 设计原则：
 * - 页面级初始化，不依赖 app.js
 * - DOMContentLoaded 自启动
 * - 只初始化本页面依赖的模块
 * - 聊天 / tracker / onboarding / notification 全挂也不影响本页
 */

;(function() {
  'use strict';

  // ===== 模块就绪检测 =====
  function waitForDeps(retries) {
    if (window.CompetitionStore && window.CompetitionView && window.CompetitionApi) {
      initPage();
    } else if (retries > 0) {
      setTimeout(function() { waitForDeps(retries - 1); }, 100);
    } else {
      renderFatal('模块加载失败，请刷新页面重试。');
    }
  }

  // ===== 页面初始化 =====
  function initPage() {
    var Store  = window.CompetitionStore;
    var View   = window.CompetitionView;
    var Api    = window.CompetitionApi;

    // —— 1. 注册 State → View 绑定 ——
    Store.onStateChange(function(state) {
      renderByState(state);
    });

    // —— 2. 渲染过滤栏 ——
    var currentFilter = Store.getState().filter;
    View.renderFilterBar(currentFilter, function(change) {
      var next = {};
      next[change.key] = change.value;
      Store.setFilter(next);
    });

    // —— 3. 卡片点击回调 ——
    function handleCardClick(id) {
      // TODO: 进入赛事详情页（下一阶段实现）
      // 当前：console 输出 + 高亮卡片
      console.log('[Competition] card click:', id);
      var el = document.querySelector('.c-card[data-id="' + String(id).replace(/"/g, '') + '"]');
      if (el) {
        el.style.borderColor = 'rgba(201,168,76,.6)';
        setTimeout(function() { el.style.borderColor = ''; }, 1200);
      }
    }

    // —— 4. 加载数据 ——
    loadData(Store, View, Api, handleCardClick);

    // —— 5. 暴露 reload 给按钮用 ——
    window.__COMP_PAGE = {
      reload: function() { loadData(Store, View, Api, handleCardClick); }
    };
  }

  // ===== 数据加载 =====
  function loadData(Store, View, Api, onCardClick) {
    Store.setLoading(true);
    View.renderLoading();

    Api.fetchMatches()
      .then(function(data) {
        Store.setMatches(data);
        var state = Store.getState();
        View.renderList(state.filtered, onCardClick);
      })
      .catch(function(err) {
        console.error('[Competition] load error:', err);
        Store.setError(err.message || '网络错误');
        View.renderError(Store.getState().error);
      });
  }

  // ===== 按 state 渲染 =====
  function renderByState(state) {
    var View = window.CompetitionView;
    if (state.loading) {
      View.renderLoading();
    } else if (state.error) {
      View.renderError(state.error);
    } else if (!state.filtered || state.filtered.length === 0) {
      View.renderEmpty();
    } else {
      // 保留 onCardClick 引用（通过闭包）
      var container = document.getElementById('cList');
      if (container && container._onCardClick) {
        View.renderList(state.filtered, container._onCardClick);
      } else {
        View.renderList(state.filtered, function() {});
      }
    }
    View.renderFilterBar(state.filter, function(change) {
      var next = {};
      next[change.key] = change.value;
      (window.CompetitionStore).setFilter(next);
    });
  }

  // ===== 致命错误渲染（模块未加载时）=====
  function renderFatal(msg) {
    var container = document.getElementById('cList');
    var subtitle  = document.getElementById('cSubtitle');
    if (subtitle) subtitle.textContent = '加载失败';
    if (!container) return;
    container.innerHTML =
      '<div class="c-error">' +
        '<p class="c-error__text">' + (window.CompetitionView ? window.CompetitionView.escapeHtml(msg) : msg) + '</p>' +
        '<button class="c-btn c-btn--primary" onclick="location.reload()">刷新页面</button>' +
      '</div>';
  }

  // ===== 启动 =====
  function boot() {
    // 依赖：注意脚本加载顺序（competitionStore → competitionApi → competitionView → competitionPage）
    waitForDeps(50); // 最多等 5 秒
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
