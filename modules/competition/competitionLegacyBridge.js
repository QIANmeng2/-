/**
 * competitionLegacyBridge.js — 新页面 ↔ 旧系统 适配层
 * 登录态完全复刻旧 app.js：
 *   1. token 来源：localStorage.getItem('local_current_user')
 *   2. Authorization: Bearer + token
 *   3. 401 不跳转，只降级显示
 */
;(function() {
  'use strict';
  console.log('[Bridge] IIFE loading...');

  // ===== 与旧 app.js 完全一致的认证体系 =====
  var API = 'https://perpetual-enchantment-production-b163.up.railway.app';

  /**
   * getAuthHeaders() — 每次调用时动态读取 token
   * 与旧 app.js L19 + L405 完全一致：
   *   let authToken = localStorage.getItem('local_current_user') || null;
   *   if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
   */
  function getAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('local_current_user') || null;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function hasToken() {
    return !!localStorage.getItem('local_current_user');
  }

  // ===== 图片压缩（file → base64 JPEG） =====
  function compressImageToBase64(file, maxWidth, quality) {
    maxWidth = maxWidth || 1200;
    quality = quality || 0.7;
    return new Promise(function(resolve, reject) {
      if (!file) return resolve(null);
      var img = new Image();
      var reader = new FileReader();
      reader.onload = function(ev) { img.src = ev.target.result; };
      reader.onerror = function() { resolve(null); };
      reader.readAsDataURL(file);
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function() { resolve(null); };
    });
  }

  console.log('[Bridge] hasToken=' + hasToken());

  // ===== 管理员检测 =====
  function isAdmin() {
    try {
      var token = localStorage.getItem('local_current_user');
      if (!token) return false;
      var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      var uid = payload.userId || payload.user_id || payload.sub;
      return String(uid) === 'mp4hmya7ad15v6';
    } catch(e) { return false; }
  }

  // ===== 统一请求（自动带认证）=====
  function req(path, opt) {
    var url = API + path;
    var o = { headers: getAuthHeaders() };
    if (opt) { for (var k in opt) { if (Object.prototype.hasOwnProperty.call(opt,k)) o[k]=opt[k]; } }
    // 合并自定义 headers（不覆盖 Authorization）
    if (opt && opt.headers) {
      Object.assign(o.headers, opt.headers);
    }
    var c = new AbortController();
    var t = setTimeout(function(){ c.abort(); }, 15000);
    o.signal = c.signal;
    return fetch(url, o).then(function(r){
      clearTimeout(t);
      if (r.status===401) {
        // 禁止跳转！只抛出错误，由调用方决定 UI 显示
        throw new Error('TOKEN_EXPIRED');
      }
      if (!r.ok) {
        return r.json().then(function(d){ throw new Error((d&&(d.message||d.error))||'HTTP '+r.status); })
          .catch(function(e){ if (e.message&&e.message!=='HTTP '+r.status) throw e; throw new Error('HTTP '+r.status); });
      }
      return r.json();
    }).catch(function(e){ clearTimeout(t); throw e; });
  }

  // ===== inline button styles (no CSS dependency) =====
  var BTN_PRIMARY = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0F172A;box-shadow:0 2px 8px rgba(245,158,11,0.25);transition:all 0.2s';
  var BTN_GHOST   = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;border:1px solid rgba(245,158,11,0.4);background:transparent;color:#f59e0b;transition:all 0.2s';

  // ===== 统一渲染工具 =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderInto(container, html) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (container) container.innerHTML = html;
  }

  function createModal(opts) {
    opts = opts || {};
    var title = opts.title || '';
    var titleColor = opts.titleColor || '#c9a84c';
    var bodyContent = opts.content || opts.bodyContent || '';
    var footer = opts.footer || '';
    var maxWidth = opts.maxWidth || '440px';
    var borderColor = opts.borderColor || 'rgba(201,168,76,.3)';

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s;';

    var mod = document.createElement('div');
    mod.style.cssText = 'background:#1E1E3A;border:1px solid ' + borderColor + ';border-radius:14px;padding:28px;width:90%;max-width:' + maxWidth + ';max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.5);';

    var inner = '';
    if (title) inner += '<h3 style="margin:0 0 16px;color:' + titleColor + ';font-size:1.1rem;font-weight:700;">' + escapeHtml(title) + '</h3>';
    if (bodyContent) inner += '<div style="color:#e0e0f0;font-size:.88rem;line-height:1.6;">' + bodyContent + '</div>';
    if (footer) inner += '<div style="display:flex;gap:10px;margin-top:20px;">' + footer + '</div>';
    mod.innerHTML = inner;

    overlay.appendChild(mod);
    return {
      overlay: overlay,
      modal: mod,
      getEl: function(id) { return document.getElementById(id); },
      close: function() { overlay.remove(); }
    };
  }

  function renderModalBtnStyle(type, extra) {
    if (type === 'primary') return 'flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#c9a84c,#a88b3c);color:#1A1A2E;font-size:.88rem;font-weight:600;cursor:pointer;' + (extra || '');
    if (type === 'danger') return 'flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-size:.88rem;font-weight:600;cursor:pointer;' + (extra || '');
    if (type === 'success') return 'flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:.88rem;font-weight:600;cursor:pointer;' + (extra || '');
    if (type === 'ghost') return 'flex:1;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#e0e0f0;font-size:.88rem;font-weight:600;cursor:pointer;' + (extra || '');
    return 'flex:1;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#e0e0f0;font-size:.88rem;font-weight:600;cursor:pointer;' + (extra || '');
  }

  // ===== 1. 报名状态 (带认证) =====
  function loadRegistrationState(compId) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/my-reg').then(function(r){
      var regs = (r&&r.data&&r.data.registrations)||(r&&r.registrations)||[];
      var me = null;
      if (!hasToken()) return null;
      try {
        var token = localStorage.getItem('local_current_user');
        var uid = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        // 兼容多种 userId 字段名
        uid = uid.userId || uid.user_id || uid.sub;
        // 先按 player_user_id 匹配（队员视角）
        for (var i=0;i<regs.length;i++) {
          var rid = regs[i].user_id || regs[i].player_user_id || regs[i].userId;
          if (String(rid)===String(uid)) { me=regs[i]; break; }
        }
        // 队长不一定在 player 列表中——通过 team_id 匹配（队长视角）
        if (!me) {
          return req('/api/teams/mine').then(function(td){
            var team = (td&&td.data&&td.data.team)||td.team||null;
            if (team) {
              for (var i=0;i<regs.length;i++) {
                // 兼容多种 team_id 字段名及空字符串
                var regTeamId = regs[i].team_id || regs[i].teamid || '';
                if (String(regTeamId)===String(team.id) && regTeamId!=='') {
                  me=regs[i]; break;
                }
              }
            }
            return me;
          }).catch(function(err){ console.warn('[Bridge] team_id match failed', err); return null; });
        }
        return me;
      } catch(e){ console.warn('[Bridge] loadRegistrationState error', e); return null; }
    });
  }

  // ===== 2. 报名列表 (带认证) =====
  function loadRegistrations(compId) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/registrations').then(function(r){
      return (r&&r.registrations)||[];
    });
  }

  // ===== 3. 报名 (带认证) =====
  function registerTeam(compId, payload) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/register', {
      method:'POST', body:JSON.stringify(payload)
    });
  }

  // ===== 4. 确认入场 (带认证) =====
  function confirmEntry(compId, fee) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/confirm', {
      method:'POST', body:JSON.stringify({entry_fee:fee||0})
    });
  }

  // ===== 5. 取消报名 (带认证) =====
  function cancelRegistration(compId) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/cancel', { method:'POST' });
  }

  // ===== 纯渲染函数：报名状态各分支（只 return HTML，不操作 DOM）=====
  function _renderRegLoading() {
    return '<div style="color:#7a7a90;font-size:.82rem;padding:12px 0;display:flex;align-items:center;gap:8px;">'
      + '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.1);border-top-color:#c9a84c;border-radius:50%;animation:cSpin .7s linear infinite;"></span>'
      + '加载报名状态…</div>';
  }

  function _renderRegButtons(compId) {
    return '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      + '<button onclick="CompetitionLegacyBridge._teamReg(\'' + escapeHtml(compId) + '\')" style="flex:1;min-width:120px;' + BTN_PRIMARY + '">以队伍报名</button>'
      + '<button onclick="CompetitionLegacyBridge._clubReg(\'' + escapeHtml(compId) + '\')" style="flex:1;min-width:120px;' + BTN_GHOST + '">以俱乐部报名</button>'
      + '</div>';
  }

  function _renderRegReserved(compId) {
    return '<div style="padding:12px;background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.2);border-radius:8px;">'
      + '<span style="color:#f59e0b;font-weight:600;">待确认入场</span>'
      + '<div style="margin-top:8px;"><button onclick="CompetitionLegacyBridge._confirmEntry(\'' + escapeHtml(compId) + '\',0)" style="' + BTN_PRIMARY + '">确认入场</button></div></div>';
  }

  function _renderRegConfirmed(fee) {
    var feeHtml = (fee > 0) ? '<span style="color:#6B7280;margin-left:8px;font-size:0.78rem;">入场费:' + escapeHtml(String(fee)) + '梦币</span>' : '';
    return '<div style="padding:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;">'
      + '<span style="color:#10b981;font-weight:600;">已确认入场</span>' + feeHtml + '</div>';
  }

  function _renderRegPending() {
    return '<div style="padding:12px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;">'
      + '<span style="color:#60a5fa;font-weight:600;">已报名</span>'
      + '<span style="color:#6B7280;margin-left:8px;font-size:0.78rem;">等待确认入场</span></div>';
  }

  function _renderRegError(msg) {
    return '<div style="color:#f87171;font-size:.72rem;padding:6px 0 0;">⚠ 状态加载失败: ' + escapeHtml(msg || '未知') + '</div>';
  }

  function _renderRegLoginExpired() {
    return '<div style="padding:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;color:#f87171;font-size:0.82rem;">'
      + '<span>登录已失效，请重新登录</span>'
      + '<div style="margin-top:8px;"><a href="./index.html" style="color:#f59e0b;text-decoration:none;font-size:0.78rem;">返回首页登录</a></div>'
      + '</div>';
  }

  // ===== 登录失效友好提示 =====
  function renderLoginExpired(el) {
    renderInto(el, _renderRegLoginExpired());
  }

  // ===== 获取/创建报名 UI 专属子容器（隔离于其他 render 函数） =====
  function getRegContent(el) {
    var rc = el.querySelector('#compRegContent');
    if (!rc) {
      rc = document.createElement('div');
      rc.id = 'compRegContent';
      el.insertBefore(rc, el.firstChild);
    }
    return rc;
  }

  // ===== 渲染报名 UI（纯 HTML 渲染函数 + renderInto 统一入口）=====
  function renderRegUI(compId, containerId) {
    console.log('[Bridge] renderRegUI ENTRY — compId=' + compId);
    var el = document.getElementById(containerId||'compRegActions');
    console.log('[Bridge] renderRegUI container el=', el);
    if (!el) { console.error('[Bridge] renderRegUI: container not found'); return; }

    // 无 token → 直接显示登录提示（不发 API）— 可清除全体
    if (!hasToken()) {
      console.log('[Bridge] renderRegUI: no token, showing login prompt');
      renderLoginExpired(el);
      return;
    }

    // 使用子容器隔离，避免覆盖其他 render 函数的 appendChild 结果
    var regContent = getRegContent(el);

    // 显示加载中
    renderInto(regContent, _renderRegLoading());

    loadRegistrationState(compId).then(function(me){
      console.log('[Bridge] renderRegUI resolved, me=', JSON.stringify(me));
      if (!me) {
        console.log('[Bridge] renderRegUI: 未报名，渲染按钮');
        renderInto(regContent, _renderRegButtons(compId));
      } else if (me.status === 'reserved') {
        renderInto(regContent, _renderRegReserved(compId));
      } else if (me.status === 'confirmed') {
        renderInto(regContent, _renderRegConfirmed(me.entry_fee));
      } else if (me.status === 'pending' || me.status === 'registered') {
        renderInto(regContent, _renderRegPending());
      } else {
        console.warn('[Bridge] renderRegUI: 意外状态 me.status=' + me.status + '，兜底渲染按钮');
        renderInto(regContent, _renderRegButtons(compId));
      }
    }).catch(function(e){
      console.error('[Bridge] renderRegUI error', e.message, e);
      if (e.message === 'TOKEN_EXPIRED') {
        renderLoginExpired(el);
      } else {
        // 非 TOKEN_EXPIRED 错误也兜底显示按钮 + 错误信息
        renderInto(regContent, _renderRegButtons(compId) + _renderRegError(e.message));
      }
    });
  }

  // ===== 管理员手动开赛（OPEN 状态）=====
  function renderAdminStart(compId, match) {
    console.log('[Bridge] renderAdminStart ENTRY — compId=' + compId + ' isAdmin=' + isAdmin());
    if (!isAdmin()) { console.log('[Bridge] renderAdminStart: not admin, skip'); return; }

    var status = (match.status || match.comp_status || '').toUpperCase();
    if (status !== 'OPEN' && status !== 'UPCOMING' && status !== 'LOCKED') {
      console.log('[Bridge] renderAdminStart: status=' + status + ' not OPEN/UPCOMING/LOCKED, skip');
      return;
    }

    var el = document.getElementById('compRegActions');
    if (!el) { console.log('[Bridge] renderAdminStart: #compRegActions not found'); return; }

    // 防重复渲染
    if (el.querySelector('[data-admin-start]')) {
      console.log('[Bridge] renderAdminStart: already rendered, skip');
      return;
    }

    var adminDiv = document.createElement('div');
    adminDiv.setAttribute('data-admin-start', '1');
    adminDiv.style.cssText = 'margin-top:12px;padding:14px;padding-top:12px;border-top:1px solid rgba(16,185,129,.2);';

    var label = document.createElement('div');
    label.style.cssText = 'font-size:0.72rem;color:#7a7a90;margin-bottom:8px;';
    label.textContent = '管理员操作';
    adminDiv.appendChild(label);

    var btn = document.createElement('button');
    btn.setAttribute('data-action', 'admin-start');
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 2px 8px rgba(16,185,129,0.3);transition:all 0.2s;width:100%;';
    btn.textContent = '开始比赛';
    btn.onclick = function() { _adminStartCompetition(compId); };
    adminDiv.appendChild(btn);

    el.appendChild(adminDiv);
    console.log('[Bridge] renderAdminStart: admin start button rendered');
  }

  // ===== 管理员开赛请求（使用 createModal 工厂）=====
  function _adminStartCompetition(compId) {
    console.log('[Bridge] _adminStartCompetition: POST /api/admin/competitions/' + compId + '/start');
    var old = document.getElementById('adminStartModal');
    if (old) old.remove();

    var bodyContent =
      '<p style="margin:0 0 12px;">点击确认后：</p>' +
      '<ul style="margin:0 0 20px;padding-left:20px;color:#a0a0c0;font-size:.82rem;">' +
        '<li style="margin-bottom:6px;">赛事状态变更为「比赛进行中」</li>' +
        '<li style="margin-bottom:6px;">参赛选手可提交比赛结果</li>' +
        '<li>原自动开赛定时器不再影响此赛事</li>' +
      '</ul>' +
      '<p style="margin:0;color:#f59e0b;font-size:.8rem;">此操作向前不可逆</p>';

    var footer =
      '<button id="asCancelBtn" style="' + renderModalBtnStyle('ghost') + '">取消</button>' +
      '<button id="asConfirmBtn" style="' + renderModalBtnStyle('success', 'flex:2') + '">确认开赛</button>';

    var modal = createModal({
      title: '手动开赛确认',
      titleColor: '#10b981',
      content: bodyContent,
      footer: footer,
      borderColor: 'rgba(16,185,129,.3)'
    });
    modal.overlay.id = 'adminStartModal';
    document.body.appendChild(modal.overlay);

    modal.overlay.addEventListener('click', function(e) { if (e.target === modal.overlay) modal.close(); });
    modal.getEl('asCancelBtn').onclick = function() { modal.close(); };
    modal.getEl('asConfirmBtn').onclick = function() {
      var confirmBtn = modal.getEl('asConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '开赛中...';
      console.log('[Bridge] _adminStartCompetition: sending...');

      req('/api/admin/competitions/' + encodeURIComponent(compId) + '/start', { method:'POST' })
        .then(function(res) {
          console.log('[Bridge] _adminStartCompetition: success, comp_status=' + (res.data ? res.data.comp_status : res.comp_status));
          modal.close();
          showToast('已开赛 — 赛事状态变更为「比赛进行中」', 'success');
          setTimeout(function() {
            if (window.__DETAIL_PAGE && window.__DETAIL_PAGE.reload) {
              window.__DETAIL_PAGE.reload();
            }
          }, 1000);
        })
        .catch(function(e) {
          console.error('[Bridge] _adminStartCompetition: failed', e.message);
          confirmBtn.disabled = false;
          confirmBtn.textContent = '确认开赛';
          if (e.message === 'TOKEN_EXPIRED') alert('登录已失效，请重新登录');
          else alert('开赛失败：' + (e.message || '未知'));
        });
    };
  }

  // ===== 渲染 FINISHED 状态 =====
  function renderFinishedState(compId, match) {
    console.log('[Bridge] renderFinishedState ENTRY — compId=' + compId + ' status=' + (match.status || match.comp_status));
    var status = (match.status || match.comp_status || '').toUpperCase();
    if (status !== 'FINISHED') {
      console.log('[Bridge] renderFinishedState: status=' + status + ' not FINISHED, skip');
      return;
    }

    var el = document.getElementById('compRegActions');
    if (!el) { console.log('[Bridge] renderFinishedState: #compRegActions not found'); return; }

    // 防重复渲染（必须在清空前检查）
    if (el.querySelector('[data-finished-state]')) {
      console.log('[Bridge] renderFinishedState: already rendered, skip');
      return;
    }

    // 清空现有 UI（已结算赛事无需交互）
    el.innerHTML = '';

    var fDiv = document.createElement('div');
    fDiv.setAttribute('data-finished-state', '1');
    fDiv.style.cssText = 'padding:14px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:10px;display:flex;align-items:center;gap:8px;';

    var check = document.createElement('span');
    check.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:0.8rem;';
    check.textContent = '✓';
    fDiv.appendChild(check);

    var label = document.createElement('span');
    label.style.cssText = 'color:#10b981;font-size:0.92rem;font-weight:700;';
    label.textContent = '已结算 — 梦币已发放，身价已更新';
    fDiv.appendChild(label);

    el.appendChild(fDiv);
    console.log('[Bridge] renderFinishedState: FINISHED badge rendered');
  }

  // ===== 渲染 LIVE/ONGOING 状态 UI =====
  function renderLiveState(compId, match) {
    console.log('[Bridge] renderLiveState ENTRY — compId=' + compId + ' status=' + (match.status || match.comp_status));
    var el = document.getElementById('compRegActions');
    if (!el) { console.log('[Bridge] renderLiveState: #compRegActions not found'); return; }

    var status = (match.status || match.comp_status || '').toUpperCase();
    if (status !== 'LIVE' && status !== 'ONGOING') {
      console.log('[Bridge] renderLiveState: status=' + status + ' not LIVE/ONGOING, skip');
      return;
    }

    // 防重复渲染
    if (el.querySelector('[data-live-state]')) {
      console.log('[Bridge] renderLiveState: already rendered, skip');
      return;
    }

    var liveDiv = document.createElement('div');
    liveDiv.setAttribute('data-live-state', '1');
    liveDiv.style.cssText = 'margin-top:12px;padding:14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:10px;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
    var dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.5);animation:pulse 1.5s ease-in-out infinite;';
    var label = document.createElement('span');
    label.style.cssText = 'color:#ef4444;font-size:0.92rem;font-weight:700;';
    label.textContent = '比赛进行中';
    header.appendChild(dot);
    header.appendChild(label);
    liveDiv.appendChild(header);

    var btn = document.createElement('button');
    btn.setAttribute('data-action', 'submit-result');
    btn.style.cssText = BTN_PRIMARY + ';width:100%';
    btn.textContent = '提交比赛结果';
    btn.onclick = function() { openResultModal(compId, match); };
    liveDiv.appendChild(btn);

    el.appendChild(liveDiv);
    console.log('[Bridge] renderLiveState: LIVE banner + submit button rendered');
  }

  // ===== 纯渲染函数：参赛人员 =====
  function _renderParticipantName(reg) {
    return escapeHtml(reg.gameid || reg.gameId || reg.game_id || reg.coachname || reg.username || reg.player_user_id || reg.user_id || '');
  }

  function _renderParticipantList(red, blue, total) {
    var h = '<div style="margin-top:16px;"><div style="font-size:0.78rem;color:#6B7280;margin-bottom:8px;">参赛队伍（' + total + '人）</div>';
    if (red.length) {
      h += '<div style="margin-bottom:8px;"><span style="color:#ef4444;font-size:0.75rem;">红方</span>';
      for (var j = 0; j < red.length; j++) h += '<div style="padding:6px 8px;font-size:0.82rem;color:#E5E7EB;">' + _renderParticipantName(red[j]) + '</div>';
      h += '</div>';
    }
    if (blue.length) {
      h += '<div style="margin-bottom:8px;"><span style="color:#3b82f6;font-size:0.75rem;">蓝方</span>';
      for (var j = 0; j < blue.length; j++) h += '<div style="padding:6px 8px;font-size:0.82rem;color:#E5E7EB;">' + _renderParticipantName(blue[j]) + '</div>';
    } else if (red.length) {
      h += '<div style="margin-bottom:8px;opacity:.55;"><span style="color:#3b82f6;font-size:0.75rem;">蓝方</span>';
      h += '<div style="padding:6px 8px;font-size:0.78rem;color:#6B7280;">等待对手报名...</div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderParticipantsEmpty() {
    return '<div style="color:#6B7280;font-size:0.82rem;padding:12px 0;">暂无报名</div>';
  }

  function _renderParticipantsError() {
    return '<div style="color:#f87171;font-size:0.82rem;">加载失败</div>';
  }

  // ===== 渲染参赛人员（使用纯渲染函数 + renderInto）=====
  function renderParticipants(compId, containerId) {
    var el = document.getElementById(containerId||'dParticipants');
    if (!el) return;
    loadRegistrations(compId).then(function(regs){
      if (!regs || !regs.length) { renderInto(el, _renderParticipantsEmpty()); return; }
      var red = [], blue = [];
      for (var i = 0; i < regs.length; i++) { if (regs[i].side === 'red') red.push(regs[i]); else if (regs[i].side === 'blue') blue.push(regs[i]); }
      renderInto(el, _renderParticipantList(red, blue, regs.length));
    }).catch(function(e){
      console.error('[Bridge] renderParticipants error', e);
      renderInto(el, _renderParticipantsError());
    });
  }

  // ===== 内部：队伍报名 =====
  function _teamReg(compId) {
    if (!hasToken()) { alert('请先登录'); return; }
    req('/api/teams/mine').then(function(d){
      var team = (d&&d.data&&d.data.team)||d.team||null;
      if (!team) { alert('请先加入或创建队伍'); return; }
      var m = team.members||[];
      if (m.length<5) { alert('队伍至少需要5人，当前'+m.length+'人'); return; }
      var lanes = ['对抗路','打野','中路','发育路','游走'];
      var players = m.slice(0,5).map(function(x, i){ return {user_id:x.userId||x.user_id, lane:x.lane||x.position||lanes[i]}; });
      registerTeam(compId, {team_id:team.id, players:players}).then(function(){
        alert('报名成功！'); renderRegUI(compId); renderParticipants(compId);
      }).catch(function(e){
        if (e.message==='TOKEN_EXPIRED') alert('登录已失效，请重新登录');
        else if (/duplicate key.*player_user_id/i.test(e.message)) alert('报名失败：您或您的队员已报名该赛事');
        else if (/duplicate key/i.test(e.message)) alert('报名失败：该位置已被占用，请更换位置或等待对手报名');
        else alert('报名失败：'+(e.message||'未知'));
      });
    }).catch(function(e){
      if (e.message==='TOKEN_EXPIRED') alert('登录已失效，请重新登录');
      else alert('加载队伍信息失败：'+(e.message||'未知'));
    });
  }

  function _clubReg(compId) {
    if (typeof window.loadClubRegisterFlow === 'function') {
      window.loadClubRegisterFlow(compId);
    } else {
      console.error('[Bridge] loadClubRegisterFlow missing');
    }
  }

  function _confirmEntry(compId, fee) {
    if (!hasToken()) { alert('请先登录'); return; }
    confirmEntry(compId, fee||0).then(function(){
      alert('已确认入场'); renderRegUI(compId);
    }).catch(function(e){
      if (e.message==='TOKEN_EXPIRED') alert('登录已失效，请重新登录');
      else alert('确认失败：'+(e.message||'未知'));
    });
  }

  // ===== 6. 提交比赛结果 (带认证) =====
  function submitResult(compId, payload) {
    return req('/api/competitions/' + encodeURIComponent(compId) + '/submit-result', {
      method:'POST', body:JSON.stringify(payload)
    });
  }

  // ===== 渲染结果提交 UI =====
  function renderResultSubmit(compId, match) {
    console.log('[Bridge] renderResultSubmit ENTRY — compId=' + compId + ' status=' + (match.status || match.comp_status));
    var el = document.getElementById('compRegActions');
    if (!el) { console.log('[Bridge] renderResultSubmit: #compRegActions not found'); return; }

    var status = (match.status || match.comp_status || '').toUpperCase();
    if (status !== 'REVIEW') {
      console.log('[Bridge] renderResultSubmit: status=' + status + ' not REVIEW, skip');
      return;
    }

    // 清除已有按钮
    var existing = el.querySelector('button[data-action="submit-result"]');
    if (existing) existing.remove();

    var sDiv = document.createElement('div');
    sDiv.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);';
    var btn = document.createElement('button');
    btn.setAttribute('data-action', 'submit-result');
    btn.style.cssText = BTN_PRIMARY + ';width:100%';
    btn.textContent = '提交比赛结果';
    btn.onclick = function() { openResultModal(compId, match); };
    sDiv.appendChild(btn);
    el.appendChild(sDiv);
    console.log('[Bridge] renderResultSubmit: button rendered');
  }

  // ===== 纯渲染函数：结果提交弹窗各模块 =====
  function _renderResultModalHeader(bo) {
    return '<h3 style="margin:0 0 4px;color:#c9a84c;font-size:1.1rem;font-weight:700;">提交比赛结果 — BO' + bo + '</h3>'
      + '<p style="margin:0 0 16px;font-size:.75rem;color:#7a7a90;">填写各小局结果，胜方/MVP 变化后自动刷新身价预览</p>';
  }

  function _renderGameRow(gIdx) {
    return '<div class="rsGameRow" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;border:1px solid rgba(255,255,255,.05);">'
      + '<span style="font-size:.82rem;color:#c9a84c;font-weight:700;min-width:24px;text-align:center;">G' + (gIdx + 1) + '</span>'
      + '<select id="rsGameWinner' + gIdx + '" data-game="' + gIdx + '" style="flex:1;padding:8px;background:#2A2A4A;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e0e0f0;font-size:.82rem;">'
        + '<option value="">选择胜方</option><option value="red">红方</option><option value="blue">蓝方</option>'
      + '</select>'
      + '<select id="rsGameMvp' + gIdx + '" data-game="' + gIdx + '" style="flex:2;padding:8px;background:#2A2A4A;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e0e0f0;font-size:.82rem;">'
        + '<option value="">MVP（胜方选手）</option>'
      + '</select>'
    + '</div>';
  }

  function _renderGamesContainer(bo) {
    var html = '<div id="rsGamesContainer" style="margin-bottom:12px;">';
    for (var g = 0; g < bo; g++) { html += _renderGameRow(g); }
    html += '</div>';
    return html;
  }

  function _renderResultScoreSummary() {
    return '<div id="rsScoreSummary" style="margin-bottom:12px;padding:8px 12px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.15);border-radius:8px;font-size:.84rem;color:#c9a84c;text-align:center;font-weight:600;display:none;"></div>';
  }

  function _renderResultPreview() {
    return '<div id="rsPreview" style="margin-bottom:12px;display:none;">'
      + '<div style="font-size:.8rem;color:#c9a84c;font-weight:600;margin-bottom:6px;">身价变化预览</div>'
      + '<div id="rsPreviewList" style="max-height:220px;overflow-y:auto;"></div>'
      + '<div id="rsPreviewLoading" style="text-align:center;color:#7a7a90;font-size:.76rem;display:none;">计算中...</div>'
    + '</div>';
  }

  function _renderResultScreenshot() {
    return '<div style="margin-bottom:12px;">'
      + '<label style="display:block;font-size:.8rem;color:#7a7a90;margin-bottom:6px;">赛后截图（可选）</label>'
      + '<input type="file" id="rsScreenshot" accept="image/*" multiple style="display:none;">'
      + '<label for="rsScreenshot" id="rsScreenshotLabel" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:#2A2A4A;border:2px dashed rgba(255,255,255,.15);border-radius:8px;color:#7a7a90;font-size:.85rem;cursor:pointer;transition:all .2s;text-align:center;flex-direction:column;">'
        + '<span style="font-size:1.5rem;">📁</span><span>点击上传截图</span><span style="font-size:.72rem;opacity:.6;">支持 JPG/PNG，可多选</span>'
      + '</label>'
      + '<div id="rsScreenshotPreview" style="display:none;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>'
    + '</div>';
  }

  function _renderResultFooter() {
    return '<div style="display:flex;gap:10px;">'
      + '<button id="rsCancelBtn" style="flex:1;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#e0e0f0;font-size:.88rem;font-weight:600;cursor:pointer;">取消</button>'
      + '<button id="rsSubmitBtn" style="flex:2;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#c9a84c,#a88b3c);color:#1A1A2E;font-size:.88rem;font-weight:600;cursor:pointer;">确认提交</button>'
    + '</div>';
  }

  function _renderResultModalBody(bo) {
    return _renderResultModalHeader(bo)
      + _renderGamesContainer(bo)
      + _renderResultScoreSummary()
      + _renderResultPreview()
      + _renderResultScreenshot()
      + _renderResultFooter();
  }

  function _renderPreviewRow(s) {
    if (s.skipped) {
      return '<div style="padding:4px 0;font-size:.74rem;color:#5a5a70;">' + escapeHtml(s.player_name || s.player_user_id) + ' — 身价0，不调整</div>';
    }
    var color = s.delta_percent >= 0 ? '#10b981' : '#ef4444';
    var sign = s.delta_percent >= 0 ? '+' : '';
    var mvpTag = s.mvp_count > 0 ? ' <span style="color:#c9a84c;font-size:.66rem;">MVP\u00d7' + s.mvp_count + '</span>' : '';
    return '<div style="padding:4px 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.04);">'
      + '<span style="font-size:.78rem;color:#ccc;">' + escapeHtml(s.player_name || s.player_user_id) + mvpTag + '</span>'
      + '<span style="font-size:.8rem;white-space:nowrap;">'
        + '<span style="color:#7a7a90;">' + s.old_value + '</span>'
        + '<span style="color:#666;margin:0 4px;">\u2192</span>'
        + '<span style="color:' + color + ';font-weight:600;">' + s.new_value + '</span>'
        + '<span style="color:' + color + ';font-size:.7rem;margin-left:3px;">(' + sign + s.delta_percent + '%)</span>'
      + '</span>'
    + '</div>';
  }

  function _renderMvpOptionsHtml(players, curVal) {
    var html = '<option value="">选择 MVP（胜方选手）</option>';
    for (var j = 0; j < players.length; j++) {
      var sel = (players[j].id === curVal) ? ' selected' : '';
      html += '<option value="' + escapeHtml(players[j].id) + '"' + sel + '>' + escapeHtml(players[j].name) + '</option>';
    }
    return html;
  }

  // ===== 结果提交弹窗（BO1/BO3/BO5 + 结算预览）=====
  function openResultModal(compId, match) {
    var bo = (match && match.bo) ? parseInt(match.bo) : 1;
    if (bo !== 1 && bo !== 3 && bo !== 5) bo = 1;
    console.log('[Bridge] openResultModal for compId=' + compId + ' BO' + bo);

    var old = document.getElementById('resultSubmitModal');
    if (old) old.remove();

    // 先加载报名列表获取选手名单，再构建弹窗
    loadRegistrations(compId).then(function(regs) {
      var redPlayers = [], bluePlayers = [];
      for (var i = 0; i < regs.length; i++) {
        var r = regs[i];
        if (r.status === 'cancelled') continue;
        var uid = r.player_user_id || r.user_id;
        var name = (r.username || r.gameid || uid) + '';
        var side = r.side || 'unknown';
        if (side === 'red') redPlayers.push({ id: uid, name: escapeHtml(name), team: side });
        else bluePlayers.push({ id: uid, name: escapeHtml(name), team: side });
      }

      // 使用 createModal 工厂 + 纯渲染函数构建弹窗
      var modal = createModal({
        content: _renderResultModalBody(bo),
        footer: '',
        maxWidth: '560px'
      });
      modal.overlay.id = 'resultSubmitModal';
      document.body.appendChild(modal.overlay);

      // 存储 regs 到 overlay 供 _doSubmitResult 使用
      modal.overlay._rsRegs = regs;

      modal.overlay.addEventListener('click', function(e) { if (e.target === modal.overlay) modal.close(); });
      modal.getEl('rsCancelBtn').onclick = function() { modal.close(); };
      modal.getEl('rsSubmitBtn').onclick = function() { _doSubmitResult(compId, regs); };

      // 文件预览
      document.getElementById('rsScreenshot').onchange = function() {
        var files = this.files;
        var preview = document.getElementById('rsScreenshotPreview');
        var label = document.getElementById('rsScreenshotLabel');
        preview.innerHTML = '';
        if (!files || files.length === 0) {
          preview.style.display = 'none'; label.style.display = 'flex'; return;
        }
        label.style.display = 'none'; preview.style.display = 'flex';
        for (var fi = 0; fi < files.length; fi++) {
          (function(file, idx) {
            var reader = new FileReader();
            reader.onload = function(ev) {
              var thumb = document.createElement('div');
              thumb.style.cssText = 'position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:2px solid rgba(201,168,76,.3);flex-shrink:0;';
              thumb.innerHTML = '<img src="' + ev.target.result + '" style="width:100%;height:100%;object-fit:cover;">' +
                '<span style="position:absolute;bottom:2px;right:4px;font-size:.6rem;color:#fff;background:rgba(0,0,0,.6);padding:1px 4px;border-radius:3px;">' + (idx+1) + '/' + files.length + '</span>';
              preview.appendChild(thumb);
            };
            reader.readAsDataURL(file);
          })(files[fi], fi);
        }
      };

      // === MVP 下拉动态更新（使用纯渲染函数，消除 innerHTML +=） ===
      function _updateMvpOptions(gameIdx) {
        var winner = document.getElementById('rsGameWinner' + gameIdx).value;
        var mvpSel = document.getElementById('rsGameMvp' + gameIdx);
        var list = winner === 'red' ? redPlayers : (winner === 'blue' ? bluePlayers : []);
        var curVal = mvpSel.value;
        renderInto(mvpSel, _renderMvpOptionsHtml(list, curVal));
      }

      function _onGameChange(gameIdx) {
        _updateMvpOptions(gameIdx);
        _refreshPreview();
      }

      // 绑定小局变化事件
      for (var gi = 0; gi < bo; gi++) {
        document.getElementById('rsGameWinner' + gi).onchange = (function(idx) { return function() { _onGameChange(idx); }; })(gi);
        document.getElementById('rsGameMvp' + gi).onchange = (function(idx) { return function() { _onGameChange(idx); }; })(gi);
      }

      // === 身价预览刷新（300ms 防抖）===
      var _previewTimer = null;
      function _refreshPreview() {
        if (_previewTimer) clearTimeout(_previewTimer);
        _previewTimer = setTimeout(function() { _doRefreshPreview(); }, 300);
      }

      function _doRefreshPreview() {
        var games = [];
        var gi = 0;
        while (document.getElementById('rsGameWinner' + gi)) {
          var w = document.getElementById('rsGameWinner' + gi).value;
          if (w) {
            var m = document.getElementById('rsGameMvp' + gi).value;
            games.push({ game: gi+1, winner: w, mvp_player_id: m || null });
          }
          gi++;
        }

        // 比分摘要
        var redW = 0, blueW = 0;
        for (var gk = 0; gk < games.length; gk++) {
          if (games[gk].winner === 'red') redW++;
          else if (games[gk].winner === 'blue') blueW++;
        }
        var summary = document.getElementById('rsScoreSummary');
        if (games.length > 0) {
          summary.style.display = 'block';
          summary.textContent = '总分：红方 ' + redW + ' : ' + blueW + ' 蓝方';
        } else {
          summary.style.display = 'none';
        }

        if (games.length === 0) {
          document.getElementById('rsPreview').style.display = 'none';
          return;
        }

        document.getElementById('rsPreview').style.display = 'block';
        document.getElementById('rsPreviewLoading').style.display = 'block';
        document.getElementById('rsPreviewList').innerHTML = '';

        req('/api/competitions/' + encodeURIComponent(compId) + '/preview-result', {
          method: 'POST', body: JSON.stringify({ games: games })
        }).then(function(res) {
          document.getElementById('rsPreviewLoading').style.display = 'none';
          if (!res.success && res.message) {
            renderInto(document.getElementById('rsPreviewList'),
              '<div style="color:#f59e0b;font-size:.76rem;padding:8px 0;">' + escapeHtml(res.message) + '</div>');
            return;
          }
          var data = res.data || res;
          var results = data.results || [];
          var html = '';
          for (var i = 0; i < results.length; i++) {
            html += _renderPreviewRow(results[i]);
          }
          renderInto(document.getElementById('rsPreviewList'), html || '<div style="color:#7a7a90;font-size:.78rem;">无选手数据</div>');
        }).catch(function(e) {
          document.getElementById('rsPreviewLoading').style.display = 'none';
          var errMsg = (e && e.message) ? escapeHtml(e.message) : '网络错误，请重试';
          renderInto(document.getElementById('rsPreviewList'),
            '<div style="color:#ef4444;font-size:.76rem;padding:8px 0;">' + errMsg + '</div>');
        });
      }

      // 初始化 MVP 下拉
      for (var gi2 = 0; gi2 < bo; gi2++) { _updateMvpOptions(gi2); }
      document.getElementById('rsPreview').style.display = 'none';
    });
  }

  // ===== 执行结果提交（含多小局 _games）=====
  function _doSubmitResult(compId, regs) {
    if (!hasToken()) { alert('请先登录'); return; }

    // 收集小局数据
    var games = [];
    var gi = 0;
    while (document.getElementById('rsGameWinner' + gi)) {
      var w = document.getElementById('rsGameWinner' + gi).value;
      if (w) {
        var m = document.getElementById('rsGameMvp' + gi).value;
        games.push({ game: gi+1, winner: w, mvp_player_id: m || null });
      }
      gi++;
    }
    if (games.length === 0) { alert('请至少填写1个小局结果'); return; }

    // 计算总胜方
    var redW = 0, blueW = 0;
    for (var i = 0; i < games.length; i++) {
      if (games[i].winner === 'red') redW++;
      else if (games[i].winner === 'blue') blueW++;
    }
    var overallWinner = redW > blueW ? 'red' : (blueW > redW ? 'blue' : 'draw');

    // 构建 players（含 _games 元数据）
    var players = [{ _games: games }];
    if (!regs) {
      // fallback: regs 未传入时用 DOM 构建基本数据
      for (var gi2 = 0; gi2 < games.length; gi2++) {
        var mvpId = games[gi2].mvp_player_id;
        if (mvpId) {
          players.push({
            player_user_id: mvpId,
            team: games[gi2].winner,
            kda: '',
            win: games[gi2].winner === overallWinner
          });
        }
      }
    } else {
      for (var ri = 0; ri < regs.length; ri++) {
        var r = regs[ri];
        if (r.status === 'cancelled') continue;
        var team = r.side || 'unknown';
        var teamWins = team === 'red' ? redW : blueW;
        var oppWins = team === 'red' ? blueW : redW;
        var uid = r.player_user_id || r.user_id;
        if (!uid) { console.warn('[submit-result] skip reg with no user id', r); continue; }
        players.push({
          player_user_id: uid,
          team: team,
          kda: '',
          win: teamWins > oppWins
        });
      }
    }
    if (players.length <= 1) { alert('没有可提交的参赛玩家'); return; }

    // 截图处理
    var fileInput = document.getElementById('rsScreenshot');
    var files = fileInput && fileInput.files;
    var btn = document.getElementById('rsSubmitBtn');
    btn.disabled = true;

    var screenshotsPromise;
    if (files && files.length > 0) {
      btn.textContent = '压缩图片中...';
      var compressPromises = [];
      for (var fi = 0; fi < files.length; fi++) {
        compressPromises.push(compressImageToBase64(files[fi], 1200, 0.7));
      }
      screenshotsPromise = Promise.all(compressPromises).then(function(raw) {
        var valid = [];
        for (var si = 0; si < raw.length; si++) {
          if (raw[si]) valid.push(raw[si]);
        }
        return valid;
      });
    } else {
      screenshotsPromise = Promise.resolve([]);
      btn.textContent = '提交中...';
    }

    screenshotsPromise.then(function(screenshots) {
      btn.textContent = '提交中...';
      // 截图不随请求发送（避免 Cloudflare body size 拦截）
      // 存入 sessionStorage，管理员审核时可手动触发 AI 识别
      if (screenshots && screenshots.length > 0) {
        try { sessionStorage.setItem('pendingScreenshots', JSON.stringify(screenshots.slice(0,3))); } catch(e) {}
      }
      var body = {
        winner: overallWinner,
        screenshots: [],
        players: players,
        mvp_player_id: null,
        coin_rewards: {}
      };

      return req('/api/competitions/' + encodeURIComponent(compId) + '/submit-result', {
        method: 'POST', body: JSON.stringify(body)
      });
    }).then(function(res) {
      var modal = document.getElementById('resultSubmitModal');
      if (modal) modal.remove();
      showToast('结果已提交，等待管理员审核', 'success');
      if (window.__DETAIL_PAGE && window.__DETAIL_PAGE.reload) {
        setTimeout(function() { window.__DETAIL_PAGE.reload(); }, 800);
      }
    }).catch(function(e) {
      btn.disabled = false;
      btn.textContent = '确认提交';
      if (e.message === 'NO_PLAYERS') alert('没有可提交的参赛玩家');
      else if (e.message === 'TOKEN_EXPIRED') alert('登录已失效，请重新登录');
      else alert('提交失败：' + (e.message || '未知'));
    });
  }

  // ===== Toast 通知 =====
  function showToast(msg, type) {
    var t = document.createElement('div');
    var bg = (type === 'success') ? 'rgba(16,185,129,.92)' : 'rgba(239,68,68,.92)';
    t.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);padding:12px 28px;border-radius:10px;color:#fff;font-size:.88rem;font-weight:600;z-index:99999;background:'+bg+';box-shadow:0 4px 16px rgba(0,0,0,.35);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity='0'; t.style.transition='opacity .35s'; setTimeout(function(){ t.remove(); }, 400); }, 2500);
  }

  // ===== 管理员审核赛果 UI =====
  function renderAdminReview(compId, match) {
    console.log('[Bridge] renderAdminReview ENTRY — compId=' + compId + ' isAdmin=' + isAdmin());
    if (!isAdmin()) { console.log('[Bridge] renderAdminReview: not admin, skip'); return; }

    var status = (match.status || match.comp_status || '').toUpperCase();
    if (status !== 'REVIEW') { console.log('[Bridge] renderAdminReview: status=' + status + ' not REVIEW, skip'); return; }

    var el = document.getElementById('compRegActions');
    if (!el) { console.log('[Bridge] renderAdminReview: #compRegActions not found'); return; }

    // 防重复渲染
    if (el.querySelector('[data-admin-review]')) {
      console.log('[Bridge] renderAdminReview: already rendered, skip');
      return;
    }

    var adminDiv = document.createElement('div');
    adminDiv.setAttribute('data-admin-review', '1');
    adminDiv.style.cssText = 'margin-top:12px;padding:14px;padding-top:12px;border-top:1px solid rgba(201,168,76,.2);';

    var label = document.createElement('div');
    label.style.cssText = 'font-size:0.72rem;color:#7a7a90;margin-bottom:8px;';
    label.textContent = '管理员操作';
    adminDiv.appendChild(label);

    // === MVP 选择区域 ===
    var mvpLabel = document.createElement('div');
    mvpLabel.style.cssText = 'font-size:0.78rem;color:#c9a84c;margin-bottom:6px;font-weight:600;';
    mvpLabel.textContent = '设置 MVP（可选）';
    adminDiv.appendChild(mvpLabel);

    var mvpSelect = document.createElement('select');
    mvpSelect.id = 'adminMvpSelect';
    mvpSelect.style.cssText = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid rgba(201,168,76,.3);background:#1E1E3A;color:#e0e0f0;font-size:0.82rem;margin-bottom:12px;';
    // 默认选项
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '— 暂不设置 MVP —';
    mvpSelect.appendChild(defaultOpt);
    // 从 player_data 加载参赛选手
    try {
      var detailPage = window.__DETAIL_PAGE;
      if (detailPage && detailPage.match && detailPage.match.player_data) {
        var pd = detailPage.match.player_data || [];
        for (var mi = 0; mi < pd.length; mi++) {
          var p = pd[mi];
          if (!p.player_user_id) continue;
          var opt = document.createElement('option');
          opt.value = p.player_user_id;  // ✅ UUID
          opt.textContent = (p.game_id || p.player_user_id) + (p.team ? '（' + (p.team === 'red' ? '红方' : '蓝方') + '）' : '');
          mvpSelect.appendChild(opt);
        }
      } else {
        // fallback: 从报名数据加载
        var regs = (detailPage && detailPage.registrations) || [];
        for (var ri = 0; ri < regs.length; ri++) {
          var r = regs[ri];
          var uid = r.player_user_id || r.user_id;
          if (!uid) continue;
          var opt2 = document.createElement('option');
          opt2.value = uid;  // ✅ UUID
          opt2.textContent = (r.game_id || r.coachName || r.username || uid) + (r.side ? '（' + (r.side === 'red' ? '红方' : '蓝方') + '）' : '');
          mvpSelect.appendChild(opt2);
        }
      }
    } catch(e) { console.warn('[Bridge] MVP select load error:', e); }
    adminDiv.appendChild(mvpSelect);

    var btn = document.createElement('button');
    btn.setAttribute('data-action', 'admin-confirm');
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;border:none;background:linear-gradient(135deg,#c9a84c,#a88b3c);color:#1A1A2E;box-shadow:0 2px 8px rgba(201,168,76,0.3);transition:all 0.2s;width:100%;';
    btn.textContent = '审核赛果';
    btn.onclick = function() { _adminConfirmResult(compId, mvpSelect.value); };
    adminDiv.appendChild(btn);

    el.appendChild(adminDiv);
    console.log('[Bridge] renderAdminReview: admin review button rendered');
  }

  // ===== 管理员确认结算弹窗（使用 createModal 工厂）=====
  function _adminConfirmResult(compId, mvpPlayerId) {
    console.log('[Bridge] _adminConfirmResult for compId=' + compId + ' mvp=' + (mvpPlayerId || 'null'));
    var old = document.getElementById('adminConfirmModal');
    if (old) old.remove();

    var mvpTip = mvpPlayerId ? '<p style="margin:0 0 12px;color:#c9a84c;font-size:.82rem;">已选择 MVP，结算时将额外 +2% 身价加成</p>' : '';

    var bodyContent = mvpTip +
      '<p style="margin:0 0 12px;">确认后将执行以下操作：</p>' +
      '<ul style="margin:0 0 20px;padding-left:20px;color:#a0a0c0;font-size:.82rem;">' +
        '<li style="margin-bottom:6px;">结算梦币奖池（自动/手动奖励）</li>' +
        '<li style="margin-bottom:6px;">更新选手身价（胜+2% / 负-2% / MVP额外+2%）</li>' +
        '<li style="margin-bottom:6px;">写入 coin_transactions 记录</li>' +
        '<li>赛事状态变更为「已结束」</li>' +
      '</ul>' +
      '<p style="margin:0;color:#f87171;font-size:.8rem;">此操作不可撤销</p>';

    var footer =
      '<button id="acCancelBtn" style="' + renderModalBtnStyle('ghost') + '">取消</button>' +
      '<button id="acConfirmBtn" style="' + renderModalBtnStyle('primary', 'flex:2') + '">确认结算</button>';

    var modal = createModal({
      title: '确认结算',
      content: bodyContent,
      footer: footer,
      borderColor: 'rgba(201,168,76,.3)'
    });
    modal.overlay.id = 'adminConfirmModal';
    document.body.appendChild(modal.overlay);

    modal.overlay.addEventListener('click', function(e) { if (e.target === modal.overlay) modal.close(); });
    modal.getEl('acCancelBtn').onclick = function() { modal.close(); };
    modal.getEl('acConfirmBtn').onclick = function() {
      var confirmBtn = modal.getEl('acConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '结算中...';

      // 先设置 MVP（如果选了），再结算
      var setMvpPromise;
      if (mvpPlayerId) {
        setMvpPromise = req('/api/admin/competitions/' + encodeURIComponent(compId) + '/set-mvp', {
          method: 'PUT',
          body: JSON.stringify({ mvp_player_id: mvpPlayerId })
        });
      } else {
        setMvpPromise = Promise.resolve();
      }

      setMvpPromise.then(function() {
        return req('/api/admin/competitions/' + encodeURIComponent(compId) + '/confirm-result', { method:'POST' });
      }).then(function(res) {
        modal.close();
        showToast('结算成功 — 梦币已发放，身价已更新' + (mvpPlayerId ? '，MVP 额外 +2%' : ''), 'success');
        setTimeout(function() {
          if (window.__DETAIL_PAGE && window.__DETAIL_PAGE.reload) {
            window.__DETAIL_PAGE.reload();
          }
        }, 1200);
      }).catch(function(e) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认结算';
        if (e.message === 'TOKEN_EXPIRED') alert('登录已失效，请重新登录');
        else alert('结算失败：' + (e.message || '未知'));
      });
    };
  }

  // ===== 暴露 =====
  window.CompetitionLegacyBridge = {
    getAuthHeaders:          getAuthHeaders,
    hasToken:               hasToken,
    isAdmin:                isAdmin,
    loadRegistrationState:  loadRegistrationState,
    loadRegistrations:      loadRegistrations,
    registerTeam:           registerTeam,
    confirmEntry:           confirmEntry,
    cancelRegistration:     cancelRegistration,
    submitResult:           submitResult,
    renderRegUI:            renderRegUI,
    renderLiveState:        renderLiveState,
    renderFinishedState:    renderFinishedState,
    renderParticipants:     renderParticipants,
    renderResultSubmit:     renderResultSubmit,
    renderAdminStart:       renderAdminStart,
    renderAdminReview:      renderAdminReview,
    openResultModal:        openResultModal,
    showToast:              showToast,
    _teamReg:               _teamReg,
    _clubReg:               _clubReg,
    _confirmEntry:          _confirmEntry,
    _doSubmitResult:        _doSubmitResult,
    _adminStartCompetition: _adminStartCompetition,
    _adminConfirmResult:    _adminConfirmResult
  };

  console.log('[Bridge] IIFE loaded. Methods:', Object.keys(window.CompetitionLegacyBridge).join(', '));
})();
