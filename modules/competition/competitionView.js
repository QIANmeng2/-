/**
 * competitionView.js — 赛事列表渲染层
 *
 * 设计原则：
 * - 只读写 DOM（#cList / #cSubtitle / #cFilterBar）
 * - 不调用 API，不修改 State（只允许读）
 * - 所有外部引用通过参数传入，不读 window
 * - 卡片点击 → 回调通知 Page 层处理
 */

;(function() {
  'use strict';

  // ===== 常量（模式/状态映射）=====
  var MODE_LABELS = { training: '训练赛', regular: '正赛', arena: '自由赛' };
  var MODE_ICONS  = { training: '⚔️', regular: '🏆', arena: '🎯' };
  var STATUS_LABEL = {
    CREATED: '已创建', REGISTERING: '报名中', READY: '准备就绪',
    LIVE: '进行中', FINISHED: '已结束', ARCHIVED: '已归档'
  };

  // ===== 工具函数 =====
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var h = d.getHours();
    var min = d.getMinutes();
    return m + '/' + day + ' ' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  function statusLabel(s) {
    return STATUS_LABEL[(s || '').toUpperCase()] || s || '';
  }

  function statusClass(s) {
    return 'c-status--' + ((s || '').toLowerCase());
  }

  function modeIconClass(mode) {
    return 'c-card__icon--' + (mode || 'training');
  }

  // ===== 渲染：加载中 =====
  function renderLoading() {
    var container = document.getElementById('cList');
    var subtitle  = document.getElementById('cSubtitle');
    if (subtitle) subtitle.textContent = '加载中…';
    if (!container) return;
    container.innerHTML =
      '<div class="c-loading">' +
        '<div class="c-loading__spinner"></div>' +
        '<div>正在加载赛事列表…</div>' +
      '</div>';
  }

  // ===== 渲染：错误 =====
  function renderError(msg) {
    var container = document.getElementById('cList');
    var subtitle  = document.getElementById('cSubtitle');
    if (subtitle) subtitle.textContent = '加载失败';
    if (!container) return;
    container.innerHTML =
      '<div class="c-error">' +
        '<p class="c-error__text">' + escapeHtml(msg || '未知错误') + '</p>' +
        '<button class="c-btn c-btn--primary" onclick="window.__COMP_PAGE && window.__COMP_PAGE.reload()">重新加载</button>' +
      '</div>';
  }

  // ===== 渲染：空列表 =====
  function renderEmpty() {
    var container = document.getElementById('cList');
    var subtitle  = document.getElementById('cSubtitle');
    if (subtitle) subtitle.textContent = '暂无赛事';
    if (!container) return;
    container.innerHTML =
      '<div class="c-empty">' +
        '<div class="c-empty__icon">📭</div>' +
        '<div class="c-empty__text">当前没有赛事</div>' +
      '</div>';
  }

  // ===== 渲染：列表 =====
  // onCardClick(matchId) — 由 Page 层注入
  function renderList(matches, onCardClick) {
    var container = document.getElementById('cList');
    var subtitle  = document.getElementById('cSubtitle');
    if (subtitle) subtitle.textContent = '共 ' + matches.length + ' 场赛事';
    if (!container) return;

    var html = '';
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var modeIcon = MODE_ICONS[m.mode] || '⚔️';
      var modeClass = modeIconClass(m.mode);
      var st = (m.status || '').toUpperCase();

      html +=
        '<div class="c-card" data-id="' + escapeHtml(String(m.id)) + '" role="button" tabindex="0">' +
          '<div class="c-card__icon ' + modeClass + '">' + modeIcon + '</div>' +
          '<div class="c-card__body">' +
            '<div class="c-card__title">' + escapeHtml(m.title || m.name || '未命名赛事') + '</div>' +
            '<div class="c-card__meta">' +
              '<span>' + (MODE_LABELS[m.mode] || m.mode || '') + '</span>' +
              '<span>BO' + (m.bo || 1) + '</span>' +
              (m.start_time ? '<span>' + fmtTime(m.start_time) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="c-card__right">' +
            '<span class="c-status-badge ' + statusClass(st) + '">' + escapeHtml(statusLabel(st)) + '</span>' +
          '</div>' +
        '</div>';
    }

    container.innerHTML = html;

    // 事件委托（不依赖 jQuery / 全局）
    container.onclick = function(e) {
      var el = e.target.closest ? e.target.closest('.c-card') : null;
      if (!el) return;
      var id = el.getAttribute('data-id');
      if (id && typeof onCardClick === 'function') onCardClick(id);
    };
    container.onkeydown = function(e) {
      if (e.key === 'Enter' && e.target.classList.contains('c-card')) {
        var id = e.target.getAttribute('data-id');
        if (id && typeof onCardClick === 'function') onCardClick(id);
      }
    };
  }

  // ===== 渲染：过滤栏 =====
  // onFilterChange(filterObj) — 由 Page 层注入
  function renderFilterBar(filter, onFilterChange) {
    var bar = document.getElementById('cFilterBar');
    if (!bar) return;

    var modes   = [['', '全部模式'], ['training', '训练赛'], ['regular', '正赛'], ['arena', '自由赛']];
    var statuses = [['', '全部状态'], ['REGISTERING', '报名中'], ['READY', '准备就绪'], ['LIVE', '进行中'], ['FINISHED', '已结束']];

    var html = '<div class="c-filter-row">';

    // 模式筛选
    html += '<select class="c-filter-select" data-filter="mode">';
    for (var i = 0; i < modes.length; i++) {
      var selected = (filter.mode === modes[i][0]) ? ' selected' : '';
      html += '<option value="' + modes[i][0] + '"' + selected + '>' + modes[i][1] + '</option>';
    }
    html += '</select>';

    // 状态筛选
    html += '<select class="c-filter-select" data-filter="status">';
    for (var j = 0; j < statuses.length; j++) {
      var selected2 = (filter.status === statuses[j][0]) ? ' selected' : '';
      html += '<option value="' + statuses[j][0] + '"' + selected2 + '>' + statuses[j][1] + '</option>';
    }
    html += '</select>';

    // 搜索框
    html += '<input class="c-filter-input" type="text" placeholder="搜索赛事…" data-filter="search" value="' + escapeHtml(filter.search || '') + '">';

    html += '</div>';
    bar.innerHTML = html;

    // 事件绑定
    bar.onchange = function(e) {
      var sel = e.target.getAttribute('data-filter');
      if (!sel) return;
      var val = e.target.value;
      if (typeof onFilterChange === 'function') onFilterChange({ key: sel, value: val });
    };
    var searchInput = bar.querySelector('[data-filter="search"]');
    if (searchInput) {
      var timer = null;
      searchInput.oninput = function(e) {
        clearTimeout(timer);
        var val = e.target.value;
        timer = setTimeout(function() {
          if (typeof onFilterChange === 'function') onFilterChange({ key: 'search', value: val });
        }, 300);
      };
    }
  }

  // ===== 更新副标题 =====
  function updateSubtitle(text) {
    var el = document.getElementById('cSubtitle');
    if (el) el.textContent = text;
  }

  // ===== 暴露 =====
  window.CompetitionView = {
    renderLoading: renderLoading,
    renderError: renderError,
    renderEmpty: renderEmpty,
    renderList: renderList,
    renderFilterBar: renderFilterBar,
    updateSubtitle: updateSubtitle,
    escapeHtml: escapeHtml,
    fmtTime: fmtTime,
    statusLabel: statusLabel,
    statusClass: statusClass
  };

})();
