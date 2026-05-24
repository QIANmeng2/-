/**
 * OnboardingModal.js  V2  —  选手成长主线引导
 *
 * 重构目标：
 *   1. 删除多身份选择（player/boss/spectator/investor）
 *   2. 统一默认身份 = "选手"
 *   3. 新流程：WELCOME → PLAYER_GUIDE（3步） → NAVIGATE → COMPLETE
 *   4. 老板/俱乐部功能改为"进阶功能"，不在新手引导出现
 *
 * 新状态机：
 *   WELCOME → PLAYER_GUIDE_STEP1 → PLAYER_GUIDE_STEP2 → PLAYER_GUIDE_STEP3
 *            → NAVIGATE → COMPLETE
 *
 * 用法（兼容旧 API）：
 *   OnboardingModal.open()
 *   OnboardingModal.close()
 *   OnboardingModal.markDone()
 *   OnboardingModal.autoOpenIfFirstTime()
 */

;(function () {
  const STORAGE_KEY = 'qm_onboarded_v2';
  const MODAL_ID   = 'onboardingModal';

  // ===================== 新状态机 =====================
  // 每一步：{ onNext, onPrev, render() }
  const FSM = {
    WELCOME: {
      onNext: () => 'PLAYER_GUIDE_STEP1',
      onPrev: () => null,
      render:  () => _renderWelcome(),
    },
    PLAYER_GUIDE_STEP1: {
      onNext:  () => 'PLAYER_GUIDE_STEP2',
      onPrev:  () => 'WELCOME',
      render:  () => _renderGuideStep1(),
    },
    PLAYER_GUIDE_STEP2: {
      onNext:  () => 'PLAYER_GUIDE_STEP3',
      onPrev:  () => 'PLAYER_GUIDE_STEP1',
      render:  () => _renderGuideStep2(),
    },
    PLAYER_GUIDE_STEP3: {
      onNext:  () => 'NAVIGATE',
      onPrev:  () => 'PLAYER_GUIDE_STEP2',
      render:  () => _renderGuideStep3(),
    },
    NAVIGATE: {
      onNext:  () => 'COMPLETE',
      onPrev:  () => 'PLAYER_GUIDE_STEP3',
      render:  () => _renderNavigate(),
    },
    COMPLETE: {
      onNext: () => null,
      onPrev: () => null,
      render:  () => { /* close() 由 transition 调用 */ }
    }
  };

  // ===================== 内部状态 =====================
  let _currentState = 'WELCOME';
  let _modalExists  = false;
  let _destroyed   = false;

  // ===================== 日志 =====================
  function _log(...args) {
    console.log('[Onboarding V2]', _currentState, '|', ...args);
  }

  var _$ = function(id) { return document.getElementById(id); };

  // ===================== 状态流转核心 =====================
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

    if (_currentState === 'COMPLETE') {
      if (window.Tracker) Tracker.trackOnboarding(null, 'complete', { identity: 'player' });
      _markDone();
      _closeModal();
      return;
    }

    FSM[_currentState].render();
    _updateDots();
  }

  // ===================== 埋点 =====================
  function _track(eventType, detail) {
    try {
        if (window.Tracker) Tracker.trackOnboarding(null, eventType, detail);
      } catch (e) {
        console.warn('[Onboarding V2] 埋点失败', e.message);
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
        <div id="obContent"></div>
        <!-- 步骤指示点：WELCOME + 3个引导步 + NAVIGATE = 5步 -->
        <div class="ob-dots">
          <span class="ob-dot active" data-dot="0"></span>
          <span class="ob-dot" data-dot="1"></span>
          <span class="ob-dot" data-dot="2"></span>
          <span class="ob-dot" data-dot="3"></span>
          <span class="ob-dot" data-dot="4"></span>
        </div>
        <div id="obFooter" style="display:flex;gap:8px;justify-content:center;margin-top:16px;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    _modalExists = true;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && _currentState !== 'COMPLETE') {
        _track('skip', { step: _currentState });
        _markDone();
        _closeModal();
      }
    });
    _log('Modal 已挂载');
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
  // 5 个状态对应 5 个点
  const DOT_MAP = { WELCOME: 0, PLAYER_GUIDE_STEP1: 1, PLAYER_GUIDE_STEP2: 2, PLAYER_GUIDE_STEP3: 3, NAVIGATE: 4 };

  function _updateDots() {
    const activeIdx = DOT_MAP[_currentState];
    document.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i === activeIdx);
    });
  }

  // ===================== SVG 图标工具 =====================
  function _svgStar(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22L12 17.77L5.82 22L7 14.87 2 9.27l6.91-.99L12 2Z"/>
    </svg>`;
  }

  function _svgCheck(size, color) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || '#10b981'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>`;
  }

  function _svgTrending(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 2 12"/>
    </svg>`;
  }

  function _svgCoin(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7v10M9 10h6M9 14h6"/>
    </svg>`;
  }

  function _svgTrophy(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22L12 17.77L5.82 22L7 14.87 2 9.27l6.91-.99L12 2Z"/>
      <path d="M8 22h8M12 17v5"/>
    </svg>`;
  }

  // ===================== 渲染函数 =====================

  /**
   * Step 0：欢迎页
   *  - 标题：欢迎来到梦工厂·王者
   *  - 副标题：首个王者荣耀电竞训练赛生态平台
   *  - 一句话介绍
   *  - 按钮：「开始探索 →」
   */
  function _renderWelcome() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return _log('obContent/obFooter 未找到');
    content.innerHTML = `
      <div class="ob-icon-ring">
        ${_svgStar(40)}
      </div>
      <h2 class="ob-title">欢迎来到梦工厂·王者</h2>
      <p class="ob-subtitle">首个王者荣耀电竞训练赛生态平台</p>
      <p class="ob-desc">在这里，你将作为一名选手，参加训练赛、提升身价、赢取梦币。</p>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `<button class="ob-btn-primary" id="obNextBtn">开始探索 →</button>`;
    var nextBtn = _$('obNextBtn');
    if (nextBtn) nextBtn.onclick = () => _transition('NEXT');
    _track('start');
  }

  /**
   * Step 1：如何开始（选手成长主线第1步）
   *  - 创建/加入队伍
   *  - 报名比赛
   *  - 参加赛事
   */
  function _renderGuideStep1() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return;
    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(201,168,76,0.4);">
        ${_svgTrophy(36, '#fbbf24')}
      </div>
      <h2 class="ob-title">如何开始</h2>
      <p class="ob-subtitle">作为选手，从这里开启你的职业生涯</p>
      <div class="ob-guide-cards">
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">🏆</div>
          <div class="ob-guide-card-title">创建或加入队伍</div>
          <div class="ob-guide-card-desc">找到你的战队，和队友一起参赛</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">📋</div>
          <div class="ob-guide-card-title">报名训练赛</div>
          <div class="ob-guide-card-desc">浏览赛事列表，选择适合你的比赛</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">⚔️</div>
          <div class="ob-guide-card-title">参加赛事</div>
          <div class="ob-guide-card-desc">上场竞技，证明你的实力</div>
        </div>
      </div>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
      <button class="ob-btn-ghost" id="obPrevBtn">← 上一步</button>
      <button class="ob-btn-primary" id="obNextBtn">下一步 →</button>
    `;
    var prevBtn = _$('obPrevBtn');
    var nextBtn = _$('obNextBtn');
    if (prevBtn) prevBtn.onclick = () => _transition('PREV');
    if (nextBtn) nextBtn.onclick = () => _transition('NEXT');
  }

  /**
   * Step 2：身价系统（选手成长主线第2步）
   *  - 赢比赛 → 身价上涨
   *  - MVP 额外上涨
   *  - 排行榜竞争
   */
  function _renderGuideStep2() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return;
    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(201,168,76,0.4);">
        ${_svgTrending(36)}
      </div>
      <h2 class="ob-title">身价系统</h2>
      <p class="ob-subtitle">你的实力，值得更高身价</p>
      <div class="ob-guide-cards">
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">📈</div>
          <div class="ob-guide-card-title">赢比赛，涨身价</div>
          <div class="ob-guide-card-desc">每场胜利都会提升你的身价，表现越好涨得越多</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">🏅</div>
          <div class="ob-guide-card-title">MVP 额外加成</div>
          <div class="ob-guide-card-desc">获得 MVP 的选手，身价额外 +2%</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">📊</div>
          <div class="ob-guide-card-title">排行榜竞争</div>
          <div class="ob-guide-card-desc">登上身价排行榜，成为明星选手</div>
        </div>
      </div>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
      <button class="ob-btn-ghost" id="obPrevBtn">← 上一步</button>
      <button class="ob-btn-primary" id="obNextBtn">下一步 →</button>
    `;
    var prevBtn = _$('obPrevBtn');
    var nextBtn = _$('obNextBtn');
    if (prevBtn) prevBtn.onclick = () => _transition('PREV');
    if (nextBtn) nextBtn.onclick = () => _transition('NEXT');
  }

  /**
   * Step 3：梦币系统（选手成长主线第3步）
   *  - 比赛奖励梦币
   *  - 竞猜获得梦币
   *  - 活动赠送梦币
   */
  function _renderGuideStep3() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return;
    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(201,168,76,0.4);">
        ${_svgCoin(36)}
      </div>
      <h2 class="ob-title">梦币系统</h2>
      <p class="ob-subtitle">参赛赢梦币，解锁更多玩法</p>
      <div class="ob-guide-cards">
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">🎮</div>
          <div class="ob-guide-card-title">比赛奖励</div>
          <div class="ob-guide-card-desc">参加训练赛，赢取梦币奖励</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">🔮</div>
          <div class="ob-guide-card-title">竞猜赢币</div>
          <div class="ob-guide-card-desc">预测比赛结果，猜对赢取梦币</div>
        </div>
        <div class="ob-guide-card">
          <div class="ob-guide-card-icon">🎁</div>
          <div class="ob-guide-card-title">活动赠送</div>
          <div class="ob-guide-card-desc">平台活动免费领取梦币</div>
        </div>
      </div>
    `;
    footer.style.display = 'flex';
    footer.innerHTML = `
      <button class="ob-btn-ghost" id="obPrevBtn">← 上一步</button>
      <button class="ob-btn-primary" id="obNextBtn">下一步 →</button>
    `;
    var prevBtn = _$('obPrevBtn');
    var nextBtn = _$('obNextBtn');
    if (prevBtn) prevBtn.onclick = () => _transition('PREV');
    if (nextBtn) nextBtn.onclick = () => _transition('NEXT');
  }

  /**
   * Step 4：跳转页（引导完成后）
   *  - 显示"准备好了，选手！"
   *  - 提供两个跳转按钮：「去认证中心」「浏览赛事」
   *  - 老板功能改为"进阶功能"提示
   */
  function _renderNavigate() {
    const content = _$('obContent');
    const footer  = _$('obFooter');
    if (!content || !footer) return;

    content.innerHTML = `
      <div class="ob-icon-ring" style="border-color:rgba(16,185,129,0.4);">
        ${_svgCheck(36, '#10b981')}
      </div>
      <h2 class="ob-title">准备好了，选手！</h2>
      <p class="ob-subtitle">先完成选手认证，然后报名参加你的第一场训练赛！</p>
      <div id="obNavActions" style="display:flex;flex-direction:column;gap:10px;margin-top:18px;">
        <button class="ob-btn-primary" style="width:100%;" onclick="OnboardingModal.goToTab('profile')">去认证中心 →</button>
        <button class="ob-btn-primary" style="width:100%;background:linear-gradient(135deg,#3b3b5c,#2a2a4a);" onclick="OnboardingModal.goToTab('competition')">浏览赛事 →</button>
        <button class="ob-btn-ghost" onclick="OnboardingModal.goToTab('club')">🏰 进阶：创建俱乐部（老板功能）</button>
      </div>
      <p style="margin:14px 0 0;font-size:0.76rem;color:#6a6a8a;text-align:center;">💡 老板功能需要先联系管理员创建俱乐部，详情见俱乐部页面</p>
    `;
    footer.style.display = 'none';
  }

  // ===================== 公开 API =====================
  const self = {
    open() {
      if (_destroyed) { _destroyed = false; _modalExists = false; }
      _currentState = 'WELCOME';
      _buildModal();
      _showModal();
      FSM[_currentState].render();
      _updateDots();
      _log('open | 状态重置为 WELCOME');
    },

    close() {
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

    next() { _transition('NEXT'); },
    prev() { _transition('PREV'); },

    markDone() { _markDone(); },

    autoOpenIfFirstTime() {
      if (!_isDone()) {
        setTimeout(() => self.open(), 1200);
      }
    },

    _destroy() { _destroyModal(); },

    getState() {
      return { state: _currentState, destroyed: _destroyed };
    }
  };

  window.OnboardingModal = self;
  _log('V2 组件已加载');
})();
