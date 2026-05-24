/**
 * RegistrationPanel 组件（v20260522d）
 * 赛事报名 UI — 登录提示 / 报名按钮 / 已确认状态 / 不可报名状态
 *
 * 用法：
 *   RegistrationPanel.render(match, userState, opts) → HTML string
 *   RegistrationPanel.mount(container, match, userState, opts)
 *
 * 依赖外部函数（app.js 全局）：
 *   - showEntryFeeRulesThen(cb)
 *   - loadTeamRegisterFlow(compId)
 *   - loadClubRegisterFlow(compId)
 *   - confirmCompetitionEntry(compId, fee)
 *   - openAuthModal()
 */

const RegistrationPanel = (() => {
  'use strict';

  var STATUS_LABELS = {
    'CREATED':      '即将开始',
    'REGISTERING':  '报名中',
    'READY':        '准备就绪',
    'LIVE':         '比赛中',
    'FINISHED':     '已结束',
    'ARCHIVED':     '已归档',
    'upcoming':     '即将开始',
    'open':         '报名中',
    'locked':       '已满员',
    'live':         '比赛中',
    'review':       '审核中',
    'finished':     '已结束'
  };

  /**
   * @param {Object} match — Match 对象 { id, status, mode, tier }
   * @param {Object} [userState]
   *   - loggedIn: boolean
   *   - myReg:     { status, entry_fee } | null  (当前用户的报名记录)
   * @param {Object} [opts]
   *   - onRegister: function(matchId)  报名后回调
   * @returns {string} HTML
   */
  function render(match, userState, opts) {
    opts = opts || {};
    userState = userState || {};
    if (!match || !match.id) return '';

    var compId  = match.id;
    var status  = (match.status || match.comp_status || 'CREATED').toLowerCase();
    var tier    = match.mode || match.tier || 'regular';
    var freeMode = (tier === 'arena');
    var needsFee = (tier === 'regular' || (!match.mode && tier === 'regular'));

    // ① 未登录
    if (!userState.loggedIn) {
      return '<div class="reg-panel reg-panel--guest" onclick="if(window.openAuthModal)openAuthModal(\'login\')">' +
        '<span class="reg-panel__icon">🔒</span> 登录后可报名参赛</div>';
    }

    // ② 已报名确认
    if (userState.myReg && userState.myReg.status === 'confirmed') {
      var feeLine = needsFee && userState.myReg.entry_fee
        ? '<span class="reg-panel__fee">入场费：' + userState.myReg.entry_fee + ' 梦币</span>'
        : '';
      return '<div class="reg-panel reg-panel--confirmed">' +
        '<span class="reg-panel__icon">✅</span> 已确认入场' + feeLine + '</div>';
    }

    // ③ 待确认
    if (userState.myReg && userState.myReg.status === 'reserved') {
      if (freeMode || tier === 'training') {
        return '<div class="reg-panel reg-panel--pending">' +
          '<div class="reg-panel__title">⏳ 待确认入场</div>' +
          '<button class="reg-panel__btn reg-panel__btn--primary" onclick="confirmCompetitionEntry(\'' + escAttr(compId) + '\',0)">确认入场</button>' +
        '</div>';
      }
      return '<div class="reg-panel reg-panel--pending">' +
        '<div class="reg-panel__title">⏳ 待确认入场（选择入场费）</div>' +
        '<div class="reg-panel__fee-options">' +
          '<button class="reg-panel__btn reg-panel__btn--success" onclick="confirmCompetitionEntry(\'' + escAttr(compId) + '\',500)">500 梦币</button>' +
          '<button class="reg-panel__btn reg-panel__btn--warning" onclick="confirmCompetitionEntry(\'' + escAttr(compId) + '\',1000)">1000 梦币</button>' +
          '<button class="reg-panel__btn reg-panel__btn--danger" onclick="confirmCompetitionEntry(\'' + escAttr(compId) + '\',2000)">2000 梦币</button>' +
        '</div></div>';
    }

    // ④ 不可报名状态
    var canRegister = (status === 'registering' || status === 'created' || status === 'open' || status === 'upcoming');
    if (!canRegister) {
      var statusCN = STATUS_LABELS[status] || status;
      return '<div class="reg-panel reg-panel--locked">' +
        '当前赛事状态为 <b>' + escHtml(statusCN) + '</b>，不可报名</div>';
    }

    // ⑤ 可报名 — 显示报名入口
    if (freeMode || tier === 'training') {
      return '<div class="reg-panel__actions">' +
        '<button class="reg-panel__btn reg-panel__btn--primary" onclick="loadTeamRegisterFlow(\'' + escAttr(compId) + '\')">以队伍报名</button>' +
        '<button class="reg-panel__btn reg-panel__btn--ghost" onclick="loadClubRegisterFlow(\'' + escAttr(compId) + '\')">以俱乐部报名</button>' +
      '</div>';
    }

    return '<div class="reg-panel__actions">' +
      '<button class="reg-panel__btn reg-panel__btn--primary" onclick="showEntryFeeRulesThen(function(){loadTeamRegisterFlow(\'' + escAttr(compId) + '\')})">以队伍报名</button>' +
      '<button class="reg-panel__btn reg-panel__btn--ghost" onclick="showEntryFeeRulesThen(function(){loadClubRegisterFlow(\'' + escAttr(compId) + '\')})">以俱乐部报名</button>' +
    '</div>';
  }

  function mount(container, match, userState, opts) {
    if (!container) return;
    container.innerHTML = render(match, userState, opts);
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { render: render, mount: mount, STATUS_LABELS: STATUS_LABELS };
})();

window.RegistrationPanel = RegistrationPanel;
