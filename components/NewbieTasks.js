/**
 * NewbieTasks.js  v20260522e
 * 
 * 新手任务系统 — 首次进入后显示可完成的新手任务
 * 任务完成后标记 localStorage + 调用 API 发梦币奖励
 *
 * 用法：
 *   NewbieTasks.mount(containerEl) — 挂载到某容器
 *   NewbieTasks.check(taskKey) — 检查任务是否完成
 *   NewbieTasks.complete(taskKey) — 标记完成并发放奖励
 */
;(function () {
  const STORAGE_PREFIX = 'qm_task_';

  const TASKS = [
    {
      key: 'auth_verify',
      title: '完成选手认证',
      desc: '填写游戏ID、巅峰分、段位，提交认证申请',
      reward: 1000,
      icon: '📋',
      checkFn: (user) => user && user.is_verified === true
    },
    {
      key: 'join_club',
      title: '加入一家战队',
      desc: '在俱乐部大厅找到心仪的战队，申请加入',
      reward: 500,
      icon: '🏟',
      checkFn: (user) => user && !!user.club_id
    },
    {
      key: 'enter_match',
      title: '报名第一场赛事',
      desc: '进入赛事中心，选择一场比赛并报名',
      reward: 300,
      icon: '🎮',
      checkFn: () => false // 由后端事件触发，前端只展示
    },
    {
      key: 'first_coins',
      title: '获得第一笔梦币',
      desc: '完成认证奖励，或赢得首场比赛瓜分奖池',
      reward: 0,
      icon: '💰',
      checkFn: (user) => user && user.dream_coins > 0
    }
  ];

  function isDone(key) {
    return localStorage.getItem(STORAGE_PREFIX + key) === '1';
  }
  function markDone(key) {
    localStorage.setItem(STORAGE_PREFIX + key, '1');
  }

  function render(container, user) {
    const incomplete = TASKS.filter(t => !isDone(t.key));
    if (!incomplete.length) {
      container.innerHTML = `
        <div class="nt-panel nt-all-done">
          <div class="nt-header">
            <span class="nt-icon">🏆</span>
            <span class="nt-title">新手任务全部完成！</span>
          </div>
          <div class="nt-done-msg">继续在赛事中成长吧，未来的电竞之星！</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="nt-panel">
        <div class="nt-header">
          <span class="nt-icon">🎯</span>
          <span class="nt-title">新手任务</span>
          <span class="nt-progress">${TASKS.length - incomplete.length}/${TASKS.length}</span>
        </div>
        <div class="nt-list">
          ${incomplete.map(t => {
            const canClaim = t.checkFn(user);
            return `
              <div class="nt-task ${canClaim ? 'nt-task--claimable' : ''}" data-task-key="${t.key}">
                <div class="nt-task-icon">${t.icon}</div>
                <div class="nt-task-body">
                  <div class="nt-task-title">${t.title}</div>
                  <div class="nt-task-desc">${t.desc}</div>
                </div>
                <div class="nt-task-reward">
                  ${t.reward > 0 ? '+' + t.reward + ' 梦币' : '无奖励'}
                </div>
                ${canClaim ? '<button class="nt-claim-btn" onclick="NewbieTasks.claim(\'' + t.key + '\')">领取</button>' : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  const self = {
    mount(el, user) {
      if (typeof el === 'string') el = document.querySelector(el);
      if (!el) return;
      if (window.Tracker) Tracker.trackTaskView();
      render(el, user || window.currentUser || null);
    },

    refresh(user) {
      const panel = document.querySelector('.nt-panel');
      if (panel) render(panel.parentNode, user || window.currentUser || null);
    },

    claim(key) {
      if (window.Tracker) Tracker.trackTaskClaim(key, (TASKS.find(t => t.key === key) || {}).reward || 0);
      const task = TASKS.find(t => t.key === key);
      if (!task) return;
      if (isDone(key)) { showToast('任务已完成', 'info'); return; }
      if (!task.checkFn(window.currentUser || null)) {
        showToast('条件尚未满足，继续努力！', 'warning');
        return;
      }
      // 调用 API 发奖励
      if (task.reward > 0 && window.authToken) {
        fetch(window.API_BASE + '/api/me/coins/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.authToken },
          body: JSON.stringify({ task_key: key, amount: task.reward })
        }).then(r => r.json()).then(data => {
          if (data.success) {
            showToast('领取成功！+' + task.reward + ' 梦币', 'success');
            markDone(key);
            self.refresh();
          } else {
            showToast(data.message || '领取失败', 'error');
          }
        }).catch(() => showToast('网络错误', 'error'));
      } else {
        markDone(key);
        self.refresh();
      }
    },

    check(key) { return isDone(key); },
    complete(key) { if (window.Tracker) Tracker.trackTaskComplete(key); markDone(key); self.refresh(); }
  };

  window.NewbieTasks = self;
})();
