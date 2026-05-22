/**
 * OnboardingModal.js  v20260522f  —  有限状态机重构
 *
 * 状态机设计：
 *   WELCOME  →  ROLE_SELECT  →  ROLE_CONFIRM  →  NAVIGATE  →  COMPLETE
 *   (欢迎)       (选择身份)        (确认身份)       (引导跳转)     (完成)
 *
 * 统一入口：transition(action)  →  禁止直接修改 currentState
 * 调试日志：所有状态变化均输出 console.log('[Onboarding]', ...)
 *
 * 用法：
 *   OnboardingModal.open()
 *   OnboardingModal.close()
 *   OnboardingModal.markDone()
 */
;(function () {
  const STORAGE_KEY = 'qm_onboarded';
  const MODAL_ID   = 'onboardingModal';

  // ===================== 有限状态机定义 =====================
  // 每个状态：{ onNext, onPrev, render() }
  // onNext / onPrev 返回下一个状态名，或 null（结束）
  const FSM = {
    WELCOME: {
      onNext:  () => 'ROLE_SELECT',
      onPrev:  () => null,
      render:  function() { _renderWelcome(); }
    },
    ROLE_SELECT: {
      onNext:  () => _selectedRole ? 'ROLE_CONFIRM' : null,
      onPrev:  () => 'WELCOME',
      render:  function() { _renderRoleSelect(); }
    },
    ROLE_CONFIRM: {
      onNext:  () => 'NAVIGATE',
      onPrev:  () => 'ROLE_SELECT',
      render:  function() { _renderRoleConfirm(); }
    },
    NAVIGATE: {
      onNext:  () => 'COMPLETE',
      onPrev:  () => 'ROLE_CONFIRM',
      render:  function() { _renderNavigate(); }
    },
    COMPLETE: {
      onNext:  () => null,
      onPrev:  () => null,
      render:  function() { /* 不会直接 render，close() 由 next() 调用 */ }
    }
  };

  // ===================== 内部状态 =====================
  let _currentState  = 'WELCOME';   // 当前 FSM 状态
  let _selectedRole  = null;          // 用户选择的身份
  let _modalExists   = false;         // DOM 是否已挂载
  let _destroyed     = false;         // 是否已销毁（防止重复操作）

  // ===================== 日志工具 =====================
  function _log(...args) {
    console.log('[Onboarding]', _currentState, '|', ...args);
  }

  // 安全 DOM 访问
  var _$ = function(id) { return document.getElementById(id); };

  // ===================== 状态流转核心 =====================
  /**
   * 统一状态转移入口
   * @param {'NEXT'|'PREV'} action
   */
  function _transition(action) {
    if (_destroyed) return;
    const state = FSM[_currentState];
    if (!state) return _log('未知状态:', _currentState);

    const nextStateName = action === 'NEXT' ? state.onNext() : state.onPrev();
    if (!nextStateName) {
      _log(action + ' 无下一状态，忽略');
      return;
    }

    _log('transition |', action, '|', _currentState, '→', nextStateName);
    _currentState = nextStateName;

    // COMPLETE 是终态：埋点 + 关闭
    if (_currentState === 'COMPLETE') {
      if (window.Tracker) Tracker.trackOnboarding(null, 'complete', { identity: _selectedRole || '' });
      _markDone();
      _closeModal();
      return;
    }

    // 渲染新状态
    FSM[_currentState].render();
    _updateDots();
  }

  // ===================== 埋点包装 =====================
  function _track(eventType, detail) {
    try {
      if (window.Tracker) Tracker.trackOnboarding(null, eventType, detail);
    } catch (e) {
      // 埋点失败不阻塞业务逻辑
      console.warn('[Onboarding] 埋点失败', e.message);
    }
  }

  // ===================== 持久化 =====================
  function _isDone() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }
  function _markDone() {
    localStorage.setItem(STORAGE_KEY, '1');
  }

  // ===================== DOM 构建 =====================
  function _buildModal() {
    if (document.getElementById(MODAL_ID)) { _modalExists = true; return; }
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'onboarding-overlay';
    overlay.innerHTML = `
      <div class="onboarding-panel">
        <!-- 动态内容区：由各 render 函数填充 -->
        <div id="obContent"></div>
        <!-- 步骤指示点 -->
        <div class="ob-dots">
          <span class="ob-dot active" data-dot="WELCOME"></span>
          <span class="ob-dot" data-dot="ROLE_SELECT"></span>
          <span class="ob-dot" data-dot="NAVIGATE"></span>
        </div>
        <!-- 底部操作栏（部分步骤显示） -->
        <div id="obFooter" style="display:flex;gap:8px;justify-content:center;margin-top:16px;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    _modalExists = true;

    // 点击遮罩关闭（仅非 COMPLETE 状态允许）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && _currentState !== 'COMPLETE') {
        _track('skip', { step: _currentState });
        _markDone();
        _closeModal();
      }
    });
    _log('Modal 已挂载到 document.body');
  }

  function _destroyModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
    _modalExists = false;
    _destroyed = true;
    _log('Modal 已销毁');
  }

  function _showModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.style.display = 'flex';
    document.body.classList.add('onboarding-open');
    _log('Modal 显示');
  }

  function _closeModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.style.display = 'none';
    document.body.classList.remove('onboarding-open');
    _log('Modal 隐藏');
  }

  // ===================== 步骤指示点 =====================
  function _updateDots() {
    const dotMap = { WELCOME: 0, ROLE_SELECT: 1, ROLE_CONFIRM: 1, NAVIGATE: 2 };
    const activeIdx = dotMap[_currentState];
    document.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i === activeIdx);
    });
  }

  // ===================== 渲染函数 =====================
  function _renderWelcome() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return _log('obContent/obFooter 未找到');
    content.innerHTML = `
      <div class="ob-icon-ring">
        <svg viewBox="0 0 40 40" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round">
          <path d="M20 4L23.5 14.5L34.5 15.27L25.5 21L28.5 31.5L20 25L11.5 31.5L14.5 21L5.5 15.27L16.5 14.5L20 4Z"/>
        </svg>
      </div>
      <h2 class="ob-title">欢迎来到梦工厂·王者</h2>
      <p class="ob-subtitle">首个王者荣耀电竞训练赛生态平台</p>
      <p class="ob-desc">在这里，你可以成为职业选手、组建战队、投资选手，或观战精彩赛事。</p>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `<button class="ob-btn-primary" id="obNextBtn">开始探索 →</button>`;
    var nextBtn = _$('obNextBtn');
    if (nextBtn) nextBtn.onclick = function() { _transition('NEXT'); };
    _track('start');
  }

  function _renderRoleSelect() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return _log('obContent/obFooter 未找到');
    content.innerHTML = `
      <h2 class="ob-title">选择你的身份</h2>
      <p class="ob-subtitle">不同身份，玩法完全不同</p>
      <div class="ob-roles">
        ${_roleCard('player',    '成为选手',   '认证身价，参赛赢梦币，涨身价', 'M12 8a5 5 0 1 1 0 10a5 5 0 0 1 0-10Zm8 13a8 8 0 1 0-16 0Z')}
        ${_roleCard('boss',      '创建战队',   '组建俱乐部，签约选手，经营电竞军团', 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21L12 17.77L5.82 21L7 14.87 2 9.27l6.91-.99L12 2Z')}
        ${_roleCard('spectator','观战赛事',   '免费观战，关注选手表现，学习战术', 'M5 3l14 9-14 9Z')}
        ${_roleCard('investor',  '投资选手',   '低价买入潜力选手，培养后高价卖出', 'M12 5a3 3 0 1 1 0 6a3 3 0 0 1 0-6Zm0 17v-5m0 0h0m0 0h0')}
      </div>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
      <button class="ob-btn-ghost" id="obPrevBtn">← 上一步</button>
      <button class="ob-btn-primary" id="obNextBtn" style="opacity:0.4;pointer-events:none;">确认身份，继续 →</button>
    `;
    var prevBtn = _$('obPrevBtn');
    var nextBtn2 = _$('obNextBtn');
    if (prevBtn) prevBtn.onclick = function() { _transition('PREV'); };
    if (nextBtn2) nextBtn2.onclick = function() { _transition('NEXT'); };

    // 绑定角色卡片点击（事件委托也可，但卡片少，直接绑定更清晰）
    document.querySelectorAll('.ob-role-card').forEach(card => {
      card.onclick = () => {
        _selectRole(card.dataset.role);
      };
    });
  }

  function _roleCard(role, name, desc, pathD) {
    return `
      <div class="ob-role-card" data-role="${role}">
        <div class="ob-role-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"/></svg>
        </div>
        <div class="ob-role-name">${name}</div>
        <div class="ob-role-desc">${desc}</div>
      </div>
    `;
  }

  function _selectRole(role) {
    if (_currentState !== 'ROLE_SELECT') return;  // 防止重复绑定导致状态错乱
    _selectedRole = role;
    document.querySelectorAll('.ob-role-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.querySelector(`.ob-role-card[data-role="${role}"]`);
    if (activeCard) activeCard.classList.add('active');

    // 启用「下一步」按钮
    const nextBtn = document.getElementById('obNextBtn');
    if (nextBtn) {
      nextBtn.style.opacity = '1';
      nextBtn.style.pointerEvents = 'auto';
    }
    _track('step', { choice: role });
    _log('选择身份:', role);
  }

  function _renderRoleConfirm() {
    const labels = { player: '选手', boss: '战队老板', spectator: '观战者', investor: '投资者' };
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return _log('obContent/obFooter 未找到');
    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(201,168,76,0.4);">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h2 class="ob-title">确认你的身份</h2>
      <p class="ob-subtitle">你将以「${labels[_selectedRole] || '选手'}」的身份开始</p>
      <p class="ob-desc">你可以随时在个人设置中重新选择身份。</p>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
      <button class="ob-btn-ghost" id="obPrevBtn">← 重新选择</button>
      <button class="ob-btn-primary" id="obNextBtn">确认，继续 →</button>
    `;
    var prevBtn = _$('obPrevBtn');
    var nextBtn = _$('obNextBtn');
    if (prevBtn) prevBtn.onclick = function() { _transition('PREV'); };
    if (nextBtn) nextBtn.onclick = function() { _transition('NEXT'); };
  }

  function _renderNavigate() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return _log('obContent/obFooter 未找到');
    const cfg = _getNavConfig();
    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(16,185,129,0.4);">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h2 class="ob-title">准备好了，${cfg.label}！</h2>
      <p class="ob-subtitle">${cfg.tips}</p>
      <div id="obNavActions" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;"></div>
    `;
    footer.style.display = 'none';  // 操作按钮在内容区内

    const actionsEl = _$('obNavActions');
    if (actionsEl) { actionsEl.innerHTML = cfg.actions.map(function(a) { return '<button class="ob-btn-primary" style="width:100%;" onclick="OnboardingModal.goToTab(\x27' + a.tab + '\x27)">' + a.text + ' →</button>'; }).join('') + '<button class="ob-btn-ghost" onclick="OnboardingModal.close()">我先随便看看</button>'; }

    _track('navigate', { identity: _selectedRole });
  }

  function _getNavConfig() {
    const role = _selectedRole || 'player';
    const config = {
      player:   { label: '去成为选手',   tips: '首先完成选手认证，然后报名参加你的第一场训练赛！',   actions: [{ text: '去认证中心', tab: 'profile' }, { text: '浏览赛事', tab: 'competition' }] },
      boss:     { label: '去创建战队',   tips: '首先创建你的俱乐部，然后签约选手、组建战队！',       actions: [{ text: '去创建俱乐部', tab: 'club' }, { text: '去转会市场淘宝', tab: 'market' }] },
      spectator:{ label: '去观战赛事',   tips: '先浏览榜单，关注喜欢的选手，然后观战他们的比赛！', actions: [{ text: '去榜单看看', tab: 'leaderboard' }, { text: '去赛事中心', tab: 'competition' }] },
      investor:  { label: '去投资选手',   tips: '先在转会市场寻找被低估的潜力选手，低价买入！',   actions: [{ text: '去转会市场', tab: 'market' }, { text: '查看选手榜单', tab: 'leaderboard' }] }
    };
    return config[role] || config.player;
  }

  // ===================== 公开 API =====================
  const self = {
    open() {
      if (_destroyed) { _destroyed = false; _modalExists = false; }
      _currentState = 'WELCOME';
      _selectedRole = null;
      _buildModal();
      _showModal();
      FSM[_currentState].render();
      _updateDots();
      _log('open | 状态重置为 WELCOME');
    },

    close() {
      // 未完成引导就关闭 = 跳过
      if (_currentState !== 'COMPLETE') {
        _track('skip', { step: _currentState });
        _markDone();
      }
      _closeModal();
    },

    /** 供 HTML onclick 调用：跳转到指定 Tab（先关闭 Modal） */
    goToTab(tab) {
      self.close();
      setTimeout(() => {
        if (window.switchTab) window.switchTab(tab);
      }, 200);
    },

    /** 兼容旧代码：selectRole（现在由 _selectRole 内部调用） */
    selectRole(cardEl, role) {
      _selectRole(role);
    },

    /** 兼容旧代码：next / prev（现在统一走 _transition） */
    next() { _transition('NEXT'); },
    prev() { _transition('PREV'); },

    /** 标记已完成（不再自动弹） */
    markDone() { _markDone(); },

    /** 自动弹出（首次访问） */
    autoOpenIfFirstTime() {
      if (!_isDone()) {
        setTimeout(() => self.open(), 1200);
      }
    },

    /** 销毁 Modal DOM（用于调试重置） */
    _destroy() { _destroyModal(); },

    /** 获取当前状态（调试用） */
    getState() {
      return { state: _currentState, role: _selectedRole, destroyed: _destroyed };
    }
  };

  // 挂载到全局（供 HTML onclick 调用）
  window.OnboardingModal = self;
  _log('组件已加载');
})();
