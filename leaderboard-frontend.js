// leaderboard-frontend.js - 榜单页面前端渲染逻辑
// 依赖 app.js 中的全局函数：api(), escapeHtml(), showToast(), switchTab()
// 由 index.html 引入

let currentLeaderboardType = 'player';

async function renderLeaderboardPanel() {
  const content = document.getElementById('tabContent');
  currentLeaderboardType = 'player';
  content.innerHTML = `
    <div class="card">
      <h3>榜单</h3>
      <div class="recruit-tabs" style="margin-bottom:16px;">
        <button class="recruit-tab ${currentLeaderboardType==='player'?'active':''}" onclick="switchLeaderboardTab('player')">选手榜单</button>
        <button class="recruit-tab ${currentLeaderboardType==='club'?'active':''}" onclick="switchLeaderboardTab('club')">俱乐部榜单</button>
      </div>
      <div id="leaderboardContent"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
    </div>`;
  await loadLeaderboardData();
}

function switchLeaderboardTab(type) {
  currentLeaderboardType = type;
  document.querySelectorAll('#tabContent .recruit-tab').forEach(t => {
    t.classList.toggle('active', type === 'player' ? t.textContent.includes('选手') : t.textContent.includes('俱乐部'));
  });
  loadLeaderboardData();
}

// 计算并列排名（标准竞争排名：相同分数同排名，下一名次顺延）
function calcDenseRanking(list, scoreField) {
  let currentRank = 1;
  let prevScore = null;
  return list.map((item, idx) => {
    const score = item[scoreField];
    if (prevScore !== null && score !== prevScore) {
      currentRank = idx + 1;
    }
    prevScore = score;
    return { ...item, displayRank: currentRank };
  });
}

async function loadLeaderboardData() {
  const container = document.getElementById('leaderboardContent');
  const type = currentLeaderboardType;
  try {
    const data = await api(`/api/leaderboard?type=${type}&limit=50`);
    const list = data.list || [];
    if (!list.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;">暂无榜单数据</p>';
      return;
    }
    if (type === 'player') {
      const rankedList = calcDenseRanking(list, 'player_score');
      container.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
            <thead>
              <tr style="color:var(--text-muted);text-align:left;">
                <th style="padding:8px 12px;">排名</th>
                <th style="padding:8px 12px;">选手</th>
                <th style="padding:8px 12px;">俱乐部</th>
                <th style="padding:8px 12px;text-align:right;">身价(万)</th>
                <th style="padding:8px 12px;text-align:right;">梦币</th>
                <th style="padding:8px 12px;text-align:right;">榜单分数</th>
              </tr>
            </thead>
            <tbody>
              ${rankedList.map(p => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 12px;font-weight:700;color:${p.displayRank<=3?'var(--warning)':'var(--text-primary)'};">${p.displayRank}</td>
                  <td style="padding:8px 12px;color:var(--text-primary);">${escapeHtml(p.username||'')}</td>
                  <td style="padding:8px 12px;color:var(--text-secondary);">${escapeHtml(p.club_name||'自由选手')}</td>
                  <td style="padding:8px 12px;text-align:right;color:var(--warning);">${p.player_value||0}</td>
                  <td style="padding:8px 12px;text-align:right;color:${p.dreamcoin_value>=0?'var(--success)':'var(--danger)'};">${p.dreamcoin_value||0}</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:700;color:var(--primary);">${p.player_score||0}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } else {
      const rankedList = calcDenseRanking(list, 'club_score');
      container.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
            <thead>
              <tr style="color:var(--text-muted);text-align:left;">
                <th style="padding:8px 12px;">排名</th>
                <th style="padding:8px 12px;">俱乐部</th>
                <th style="padding:8px 12px;">老板</th>
                <th style="padding:8px 12px;text-align:right;">俱乐部分数</th>
              </tr>
            </thead>
            <tbody>
              ${rankedList.map(c => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 12px;font-weight:700;color:${c.displayRank<=3?'var(--warning)':'var(--text-primary)'};">${c.displayRank}</td>
                  <td style="padding:8px 12px;color:var(--text-primary);">${escapeHtml(c.club_name||'')}</td>
                  <td style="padding:8px 12px;color:var(--text-secondary);">${escapeHtml(c.boss_name||'')}</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:700;color:var(--primary);">${c.club_score||0}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }
  } catch(e) {
    container.innerHTML = `<p style="color:var(--danger);">加载失败：${e.message}</p>`;
  }
}