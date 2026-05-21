/**
 * OnboardingModal.js  v20260522e
 * 
 * 第四阶段：新手引导系统（产品内引导，非长文档）
 * 三步：欢迎 → 选择身份 → 引导跳转
 *
 * 用法：
 *   OnboardingModal.open()   — 手动打开
 *   OnboardingModal.close()
 *   OnboardingModal.markDone() — 标记已完成（不再自动弹）
 */
;(function () {
  const STORAGE_KEY = 'qm_onboarded';
  const MODAL_ID = 'onboardingModal';

  function isDone() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }
  function markDone() {
    localStorage.setItem(STORAGE_KEY, '1');
  }

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'onboarding-overlay';
    overlay.innerHTML = `
      <div class="onboarding-panel">
        <div class="ob-glow"></div>
        <!-- Step 1：欢迎 -->
        <div class="ob-step" data-step="1">
          <div class="ob-icon-ring">
            <svg viewBox="0 0 40 40" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round">
              <path d="M20 4L23.5 14.5L34.5 15.27L25.5 21L28.5 31.5L20 25L11.5 31.5L14.5 21L5.5 15.27L16.5 14.5L20 4Z"/>
            </svg>
          </div>
          <h2 class="ob-title">欢迎来到梦工厂·王者</h2>
          <p class="ob-subtitle">首个王者荣耀电竞训练赛生态平台</p>
          <p class="ob-desc">在这里，你可以成为职业选手、组建战队、投资选手、或观战精彩赛事。</p>
          <button class="ob-btn-primary" onclick="OnboardingModal.next()">开始探索 →</button>
        </div>
        <!-- Step 2：选择身份 -->
        <div class="ob-step" data-step="2" style="display:none;">
          <h2 class="ob-title">选择你的身份</h2>
          <p class="ob-subtitle">不同身份，玩法完全不同</p>
          <div class="ob-roles">
            <div class="ob-role-card" data-role="player" onclick="OnboardingModal.selectRole(this,'player')">
              <div class="ob-role-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
              </div>
              <div class="ob-role-name">成为选手</div>
              <div class="ob-role-desc">认证身价，参赛赢梦币，涨身价</div>
            </div>
            <div class="ob-role-card" data-role="boss" onclick="OnboardingModal.selectRole(this,'boss')">
              <div class="ob-role-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
              <div class="ob-role-name">创建战队</div>
              <div class="ob-role-desc">组建俱乐部，签约选手，经营电竞军团</div>
            </div>
            <div class="ob-role-card" data-role="spectator" onclick="OnboardingModal.selectRole(this,'spectator')">
              <div class="ob-role-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
              <div class="ob-role-name">观战赛事</div>
              <div class="ob-role-desc">免费观战，关注选手表现，学习战术</div>
            </div>
            <div class="ob-role-card" data-role="investor" onclick="OnboardingModal.selectRole(this,'investor')">
              <div class="ob-role-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
              </div>
              <div class="ob-role-name">投资选手</div>
              <div class="ob-role-desc">低价买入潜力选手，培养后高价卖出</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
            <button class="ob-btn-ghost" onclick="OnboardingModal.prev()">← 上一步</button>
            <button class="ob-btn-primary" id="obRoleConfirm" style="opacity:0.4;pointer-events:none;" onclick="OnboardingModal.next()">确认身份，继续 →</button>
          </div>
        </div>
        <!-- Step 3：引导跳转 -->
        <div class="ob-step" data-step="3" style="display:none;">
          <div class="ob-icon-ring" style="border-color:rgba(16,185,129,0.4);">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <h2 class="ob-title" id="obStep3Title">准备好了！</h2>
          <p class="ob-subtitle" id="obStep3Subtitle">现在，去完成你的第一个任务吧</p>
          <div id="obStep3Actions" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;"></div>
          <button class="ob-btn-ghost" style="margin-top:12px;" onclick="OnboardingModal.close()">稍后再说</button>
        </div>
        <div class="ob-dots">
          <span class="ob-dot active" data-dot="1"></span>
          <span class="ob-dot" data-dot="2"></span>
          <span class="ob-dot" data-dot="3"></span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) OnboardingModal.close();
    });
  }

  let _currentStep = 1;
  let _selectedRole = null;

  const self = {
    open() {
      if (window.Tracker) Tracker.trackOnboarding(null, 'start');
      if (document.getElementById(MODAL_ID)) {
        document.getElementById(MODAL_ID).style.display = 'flex';
        _currentStep = 1;
        _selectedRole = null;
        _showStep(1);
        return;
      }
      buildModal();
      const overlay = document.getElementById(MODAL_ID);
      overlay.style.display = 'flex';
      _currentStep = 1;
      _selectedRole = null;
      _showStep(1);
    },

    close() {
      const overlay = document.getElementById(MODAL_ID);
      if (overlay) overlay.style.display = 'none';
      // 未完成引导就关闭 = 跳过
      if (_currentStep < 3 && window.Tracker) Tracker.trackOnboarding(null, 'skip');
      markDone();
    },

    next() {
      if (_currentStep === 2 && !_selectedRole) return;
      if (_currentStep === 1) { _currentStep = 2; _showStep(2); if (window.Tracker) Tracker.trackOnboarding(2, 'step', { choice: _selectedRole || '' }); return; }
      if (_currentStep === 2) { _currentStep = 3; _showStep(3); return; }
      if (_currentStep === 3) { if (window.Tracker) Tracker.trackOnboarding(null, 'complete', { identity: _selectedRole || '' }); this.close(); return; }
    },

    prev() {
      if (_currentStep === 2) { _currentStep = 1; _showStep(1); return; }
      if (_currentStep === 3) { _currentStep = 2; _showStep(2); return; }
    },

    selectRole(cardEl, role) {
      _selectedRole = role;
      document.querySelectorAll('.ob-role-card').forEach(c => c.classList.remove('active'));
      cardEl.classList.add('active');
      const confirmBtn = document.getElementById('obRoleConfirm');
      if (confirmBtn) {
        confirmBtn.style.opacity = '1';
        confirmBtn.style.pointerEvents = 'auto';
      }
    },

    autoOpenIfFirstTime() {
      if (!isDone()) {
        setTimeout(() => self.open(), 1200);
      }
    }
  };

  function _showStep(step) {
    document.querySelectorAll('.ob-step').forEach(el => {
      el.style.display = (parseInt(el.dataset.step) === step) ? '' : 'none';
    });
    document.querySelectorAll('.ob-dot').forEach(d => {
      d.classList.toggle('active', parseInt(d.dataset.dot) === step);
    });
    if (step === 3) _buildStep3();
  }

  function _buildStep3() {
    const title = document.getElementById('obStep3Title');
    const subtitle = document.getElementById('obStep3Subtitle');
    const actions = document.getElementById('obStep3Actions');
    if (!actions) return;

    const role = _selectedRole || 'player';
    const config = {
      player: {
        label: '成为选手',
        tips: '首先完成选手认证，然后报名参加你的第一场训练赛！',
        actions: [
          { text: '去认证中心', tab: 'profile' },
          { text: '浏览赛事', tab: 'competition' }
        ]
      },
      boss: {
        label: '创建战队',
        tips: '首先创建你的俱乐部，然后签约选手、组建战队！',
        actions: [
          { text: '去创建俱乐部', tab: 'club' },
          { text: '去转会市场淘宝', tab: 'market' }
        ]
      },
      spectator: {
        label: '观战赛事',
        tips: '先浏览榜单，关注喜欢的选手，然后观战他们的比赛！',
        actions: [
          { text: '去榜单看看', tab: 'leaderboard' },
          { text: '去赛事中心', tab: 'competition' }
        ]
      },
      investor: {
        label: '投资选手',
        tips: '先在转会市场寻找被低估的潜力选手，低价买入！',
        actions: [
          { text: '去转会市场', tab: 'market' },
          { text: '查看选手榜单', tab: 'leaderboard' }
        ]
      }
    };

    const cfg = config[role] || config.player();
    if (title) title.textContent = '准备好了，' + cfg.label + '！';
    if (subtitle) subtitle.textContent = cfg.tips;

    actions.innerHTML = cfg.actions.map(a =>
      '<button class="ob-btn-primary" style="width:100%;" onclick="OnboardingModal.goToTab(\'' + a.tab + '\')">' + a.text + ' →</button>'
    ).join('') + '<button class="ob-btn-ghost" onclick="OnboardingModal.close()">我先随便看看</button>';
  }

  self.goToTab = function (tab) {
    self.close();
    if (window.switchTab) window.switchTab(tab);
  };

  window.OnboardingModal = self;
})();
