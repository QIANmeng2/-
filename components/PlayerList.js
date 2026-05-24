/**
 * PlayerList 组件（v20260522d）
 * 参赛人员列表 — 红蓝分组 / 自由模式分组展示
 *
 * 用法：
 *   PlayerList.render(registrations, opts) → HTML string
 *   PlayerList.mount(container, registrations, opts)
 */

const PlayerList = (() => {
  'use strict';

  /**
   * 渲染参赛人员列表
   * @param {Array} registrations — 注册记录数组
   *   每条记录：{ side, status, entry_fee, gameid, gameId, coachname, username, player_user_id, team_id, club_id, team_name, club_name }
   * @param {Object} [opts]
   *   - freeMode: boolean    (默认 false，true 时不区分红蓝)
   *   - showFee: boolean     (默认 true，显示入场费)
   *   - compact: boolean     (默认 false，紧凑模式)
   * @returns {string} HTML
   */
  function render(registrations, opts) {
    opts = opts || {};
    var freeMode = !!opts.freeMode;
    var showFee  = opts.showFee !== false;
    var compact  = !!opts.compact;

    if (!Array.isArray(registrations) || !registrations.length) {
      return '<div class="player-list__empty">暂无参赛人员</div>';
    }

    if (freeMode) {
      return renderFreeMode(registrations, compact);
    }
    return renderSides(registrations, showFee, compact);
  }

  /**
   * 挂载到容器
   */
  function mount(container, registrations, opts) {
    if (!container) return;
    container.innerHTML = render(registrations, opts);
  }

  /* ── 红蓝方分组渲染 ────────────────────────────── */
  function renderSides(regs, showFee, compact) {
    var redRegs  = regs.filter(function(r) { return r.side === 'red'; });
    var blueRegs = regs.filter(function(r) { return r.side === 'blue'; });
    var neutral  = regs.filter(function(r) { return r.side !== 'red' && r.side !== 'blue'; });

    var html = '';
    if (redRegs.length)  html += renderSideGroup(redRegs, '红方', '#ef4444', showFee, compact);
    if (blueRegs.length) html += renderSideGroup(blueRegs, '蓝方', '#3b82f6', showFee, compact);
    if (neutral.length)  html += renderSideGroup(neutral, '待分配', 'var(--text-muted)', showFee, compact);
    return html || '<div class="player-list__empty">暂无参赛人员</div>';
  }

  function renderSideGroup(regs, label, color, showFee, compact) {
    var confirmed = regs.filter(function(r) { return r.status === 'confirmed'; }).length;
    var header = '<div class="player-list__side-header">' +
      '<span class="player-list__side-label" style="color:' + color + ';">' + label + '</span>' +
      '<span class="player-list__side-count">' + confirmed + '/' + regs.length + ' 已确认</span>' +
    '</div>';

    var gridCols = compact ? 'repeat(auto-fill, minmax(120px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))';
    var cards = '<div class="player-list__grid" style="grid-template-columns:' + gridCols + ';">' +
      regs.map(function(r) { return renderPlayerCard(r, showFee, compact); }).join('') +
    '</div>';

    return '<div class="player-list__side-group">' + header + cards + '</div>';
  }

  /* ── 自由模式分组渲染 ────────────────────────────── */
  function renderFreeMode(regs, compact) {
    var groups = {};
    regs.forEach(function(r) {
      var key = r.team_name || r.club_name || r.team_id || r.club_id || '自由选手';
      if (!groups[key]) groups[key] = { label: key, regs: [] };
      groups[key].regs.push(r);
    });

    var html = '<div class="player-list__free-header">参赛人员</div>';
    var gridCols = compact ? 'repeat(auto-fill, minmax(120px, 1fr))' : 'repeat(auto-fill, minmax(150px, 1fr))';

    Object.keys(groups).forEach(function(key) {
      var g = groups[key];
      html += '<div class="player-list__free-group">' +
        '<div class="player-list__free-label">' + escHtml(g.label) + '</div>' +
        '<div class="player-list__grid" style="grid-template-columns:' + gridCols + ';">' +
        g.regs.map(function(r) { return renderPlayerCard(r, false, compact); }).join('') +
        '</div></div>';
    });
    return html;
  }

  /* ── 单个选手卡片 ───────────────────────────────── */
  function renderPlayerCard(r, showFee, compact) {
    var name = r.gameid || r.gameId || r.game_id || r.coachname || r.coachName || r.username || r.player_user_id || '未知选手';
    var feeLine = '';
    if (showFee && r.entry_fee) {
      feeLine = '<div class="player-list__fee">' + r.entry_fee + ' 梦币</div>';
    }
    var badgeHtml = renderStatusBadge(r.status);
    var padding = compact ? '6px 10px' : '8px 12px';

    return '<div class="player-list__card" style="padding:' + padding + ';">' +
      '<div class="player-list__name">' + escHtml(name) + '</div>' +
      feeLine +
      '<div class="player-list__badge-row">' + badgeHtml + '</div>' +
    '</div>';
  }

  function renderStatusBadge(status) {
    var map = {
      'confirmed': { label: '已确认', color: '#10b981' },
      'reserved':  { label: '待确认', color: '#f59e0b' },
      'cancelled': { label: '已取消', color: 'var(--text-muted)' }
    };
    var item = map[status] || { label: status || '未知', color: 'var(--text-muted)' };
    return '<span class="player-list__status-badge" style="background:' + item.color + '1a;color:' + item.color + ';border:1px solid ' + item.color + '33;">' + item.label + '</span>';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { render: render, mount: mount };
})();

window.PlayerList = PlayerList;
