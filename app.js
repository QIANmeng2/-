const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';
let currentUser = null;
let authToken = localStorage.getItem('local_current_user') || null;
let currentTab = 'square';
let authMode = 'login';
let calendarYear, calendarMonth;
let unreadNotifs = 0;
let selectedRecruitMode = 1;
let currentRecruitSubTab = 'active';
let currentMatchId = null;
let recruitPollingTimer = null;

const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
const LANE_ICONS = { '对抗路': '对抗', '打野': '打野', '中路': '中路', '发育路': '发育', '游走': '游走' };

const cacheStore = new Map();
async function api(path, options = {}, retries = 2) {
  const isGet = !options.method || options.method === 'GET';
  const cacheKey = path + JSON.stringify(options.body || '');
  if (isGet && !options.skipCache && cacheStore.has(cacheKey)) {
    const cached = cacheStore.get(cacheKey);
    if (Date.now() - cached.time < 20000) return cached.data;
  }
  const url = API_BASE + path;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (res.status === 401) { logout(); return null; }
    if (!res.ok) throw new Error(data.message || '请求失败');
    if (isGet) cacheStore.set(cacheKey, { data, time: Date.now() });
    return data;
  } catch (err) {
    if (retries > 0) {
      if (retries === 2) showToast('正在唤醒服务器...', 'info');
      await new Promise(r => setTimeout(r, 1500));
      return api(path, options, retries - 1);
    }
    throw err;
  }
}

// ---------- 认证 ----------
async function fetchUserInfo() {
  try { const data = await api('/api/auth/me'); if (data && data.user) currentUser = data.user; } catch { logout(); }
  updateUI();
  checkNotifications();
}
function openAuthModal(mode) {
  authMode = mode;
  document.getElementById('authModalOverlay').style.display = 'flex';
  document.getElementById('authModalTitle').textContent = mode === 'login' ? '登录' : '注册';
  document.getElementById('registerFields').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('authForm').reset();
}
function closeAuthModal() { document.getElementById('authModalOverlay').style.display = 'none'; }
function switchAuthMode() { openAuthModal(authMode === 'login' ? 'register' : 'login'); }
async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  if (!username || !password) { showToast('请填写用户名和密码','error'); return; }
  if (authMode === 'register') {
    const coach = document.getElementById('regCoachName').value.trim();
    const wechat = document.getElementById('regWechat').value.trim();
    const level = document.getElementById('regLevel').value;
    if (!coach || !wechat) { showToast('请填写完整注册信息','error'); return; }
    try {
      const data = await api('/api/auth/register', { method:'POST', body: JSON.stringify({ username, password, teamName: coach, coachName: coach, wechat, level }) });
      if (data && data.token) { authToken = data.token; localStorage.setItem('local_current_user', authToken); currentUser = data.user; closeAuthModal(); updateUI(); switchTab('recruit'); showToast('注册成功！','success'); }
    } catch (e) { showToast(e.message,'error'); }
  } else {
    try {
      const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ username, password }) });
      if (data && data.token) { authToken = data.token; localStorage.setItem('local_current_user', authToken); currentUser = data.user; closeAuthModal(); updateUI(); switchTab('recruit'); showToast('登录成功！','success'); }
    } catch (e) { showToast(e.message,'error'); }
  }
}
function logout() {
  authToken = null; localStorage.removeItem('local_current_user'); currentUser = null; cacheStore.clear();
  stopRecruitPolling();
  updateUI(); switchTab('square'); showToast('已退出','info');
}

// ---------- UI 更新 ----------
function updateUI() {
  const ui = id => document.getElementById(id);
  if (currentUser) {
    ui('userInfoDisplay').style.display = 'block';
    ui('btnLoginTop').style.display = 'none';
    ui('btnLogoutTop').style.display = 'inline-block';
    ui('displayName').textContent = currentUser.coachName;
    ui('displayTeam').textContent = currentUser.teamName;
    document.querySelectorAll('#tabNav .tab-btn[data-tab="publish"], #tabNav .tab-btn[data-tab="team"], #tabNav .tab-btn[data-tab="profile"], #tabNav .tab-btn[data-tab="market"], #tabNav .tab-btn[data-tab="club"]').forEach(b => b.style.display = '');
    ui('notificationBell').style.display = 'flex';
    if (currentUser.id === 'mp4hmya7ad15v6') { ui('tabAdmin').style.display = ''; }
    ui('tabCompetition').style.display = '';
  } else {
    ui('userInfoDisplay').style.display = 'none';
    ui('btnLoginTop').style.display = 'inline-block';
    ui('btnLogoutTop').style.display = 'none';
    document.querySelectorAll('#tabNav .tab-btn[data-tab="publish"], #tabNav .tab-btn[data-tab="team"], #tabNav .tab-btn[data-tab="profile"], #tabNav .tab-btn[data-tab="competition"], #tabNav .tab-btn[data-tab="admin"], #tabNav .tab-btn[data-tab="market"], #tabNav .tab-btn[data-tab="club"]').forEach(b => b.style.display = 'none');
    ui('notificationBell').style.display = 'none';
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
}

// ==================== 比赛页面 ====================
let compTier = 'regular'; // 当前赛事层级
async function renderCompetitionPanel() {
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  const content = document.getElementById('tabContent');
  const tierLabel = { elite: '顶级联赛', secondary: '次级联赛', regular: '常规赛事' };
  content.innerHTML = `
    <div class="card">
      <div class="comp-page-header">
        <div class="comp-page-title-wrap">
          <h2 class="comp-page-title">${isAdmin ? '赛事管理' : '赛事信息'}</h2>
          <p class="comp-page-subtitle">${isAdmin ? '创建与管理各级别赛事' : '查看所有级别的电竞赛事'}</p>
        </div>
        ${isAdmin ? `<button class="btn btn-primary" onclick="openCreateCompetitionModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          创建赛事
        </button>` : ''}
      </div>
      <div class="comp-tier-tabs">
        <button class="comp-tier-tab" id="compTierElite" onclick="switchCompTier('elite')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="margin-bottom:3px;display:block;margin-left:auto;margin-right:auto;"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
          顶级联赛
        </button>
        <button class="comp-tier-tab" id="compTierSecondary" onclick="switchCompTier('secondary')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:3px;display:block;margin-left:auto;margin-right:auto;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          次级联赛
        </button>
        <button class="comp-tier-tab active-regular" id="compTierRegular" onclick="switchCompTier('regular')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-bottom:3px;display:block;margin-left:auto;margin-right:auto;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          常规赛事
        </button>
      </div>
      <div id="competitionList"><div class="loading-spinner"></div></div>
    </div>
  `;
  await loadCompetitionList();
}
async function switchCompTier(t) { compTier = t; await loadCompetitionList(); }
async function loadCompetitionList() {
  const container = document.getElementById('competitionList');
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  // 高亮当前tier按钮
  document.querySelectorAll('.comp-tier-tab').forEach(b => {
    b.classList.remove('active-elite', 'active-secondary', 'active-regular');
  });
  const activeBtn = document.getElementById('compTier' + compTier.charAt(0).toUpperCase() + compTier.slice(1));
  if (activeBtn) activeBtn.classList.add('active-' + compTier);

  const emptyMsg = { elite: '暂无顶级联赛赛事', secondary: '暂无次级联赛赛事', regular: '暂无常规赛事' };
  const tierBadge = { elite: { label: '顶级联赛', cls: 'elite' }, secondary: { label: '次级联赛', cls: 'secondary' }, regular: { label: '常规赛事', cls: 'regular' } };
  try {
    const data = await api('/api/competitions');
    const comps = (data[compTier] || []);
    window._compCache = {};
    (data.all||[]).forEach(c => { window._compCache[c.id] = c; });
    if (!comps.length) {
      container.innerHTML = `<div class="comp-empty">
        <svg width="48" height="48" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" opacity="0.25">
          <path d="M18 24H62M18 24V28C18 40 30 52 40 52C50 52 62 40 62 28V24M18 24C14 20 10 22 10 26C10 30 14 32 18 28M62 24C66 20 70 22 70 26C70 30 66 32 62 28" stroke="url(#neonGradE)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 28V52C20 58 28 64 40 64C52 64 60 58 60 52V28" stroke="url(#neonGradE2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M28 64H52M32 68H48M34 72H46" stroke="url(#neonGradE)" stroke-width="2" stroke-linecap="round"/>
          <defs>
            <linearGradient id="neonGradE" x1="10" y1="10" x2="70" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient>
            <linearGradient id="neonGradE2" x1="20" y1="28" x2="60" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient>
          </defs>
        </svg>
        <p class="comp-empty-text">${emptyMsg[compTier]}</p>
      </div>`;
      return;
    }
    container.innerHTML = `<div class="comp-list-grid">` + comps.map(c => {
      const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit' }) : '';
      const tb = tierBadge[c.tier || 'regular'];
      return `
        <div class="competition-card" data-tier="${c.tier || 'regular'}" onclick="openCompetitionDetail('${c.id}')">
          ${isAdmin ? `<button class="btn btn-sm comp-delete-btn" onclick="event.stopPropagation(); deleteCompetition('${c.id}')">删除</button>` : ''}
          <div class="comp-card-body">
            <div class="comp-card-top">
              <div class="comp-card-title">${c.name}</div>
              <span class="comp-tier-badge ${tb.cls}">${tb.label}</span>
            </div>
            <div class="comp-card-meta">
              <span class="comp-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                ${dateStr}
              </span>
              ${c.created_by_username ? `<span class="comp-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                ${c.created_by_username}
              </span>` : ''}
            </div>
            <div class="comp-card-footer">
              <span class="comp-status-badge ${c.status === 'active' ? 'active' : 'closed'}">
                <span class="comp-status-dot ${c.status === 'active' ? 'active' : 'closed'}"></span>
                ${c.status === 'active' ? '进行中' : '已结束'}
              </span>
              <span class="comp-card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
            </div>
          </div>
        </div>`;
    }).join('') + `</div>`;
  } catch (err) { container.innerHTML = `<p style="color:var(--danger);padding:24px 0;text-align:center;">加载失败：${err.message}</p>`; }
}

// 赛事详情弹窗
window._compCache = {};
function openCompetitionDetail(id) {
  const cached = window._compCache[id];
  if (!cached) return;
  const c = cached;
  const creatorName = (c.created_by_name || c.created_by_username || '').replace(/\s*\(.*?\)\s*/, '') || '未知';
  const dateStr = c.created_at
    ? new Date(c.created_at).toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })
    : '未知';
  const tierBadge = { elite: { label: '顶级联赛', cls: 'elite' }, secondary: { label: '次级联赛', cls: 'secondary' }, regular: { label: '常规赛事', cls: 'regular' } };
  const tb = tierBadge[c.tier || 'regular'];
  const overlay = document.createElement('div');
  overlay.className = 'comp-detail-overlay';
  overlay.id = 'compDetailOverlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeCompetitionDetail(); };
  overlay.innerHTML = `
    <div class="comp-detail-panel">
      <div class="comp-detail-header">
        <div style="display:flex;flex-direction:column;gap:6px;flex:1;padding-right:8px;">
          <h3 class="comp-detail-title" style="font-size:1.1rem;">${c.name}</h3>
          <span class="comp-tier-badge ${tb.cls}">${tb.label}</span>
        </div>
        <button class="comp-detail-back" onclick="closeCompetitionDetail()">返回</button>
      </div>
      <div class="comp-detail-body">
        <div class="comp-detail-section">
          <div class="comp-detail-row">
            <span class="comp-detail-label">赛事状态</span>
            <span class="comp-detail-value"><span class="comp-status-badge ${c.status === 'active' ? 'active' : 'closed'}"><span class="comp-status-dot ${c.status === 'active' ? 'active' : 'closed'}"></span>${c.status === 'active' ? '进行中' : '已结束'}</span></span>
          </div>
          <div class="comp-detail-row">
            <span class="comp-detail-label">创建时间</span>
            <span class="comp-detail-value">${dateStr}</span>
          </div>
          <div class="comp-detail-row">
            <span class="comp-detail-label">创建人</span>
            <span class="comp-detail-value">${creatorName}</span>
          </div>
        </div>
        <div class="comp-detail-section">
          <div class="comp-detail-row">
            <span class="comp-detail-label">二维码</span>
          </div>
          <div class="comp-detail-qr-wrap">
            ${c.qr_code_url
              ? `<div class="comp-detail-qr-card" onclick="openCompQrFullscreen('${c.qr_code_url.replace(/'/g, "\\'")}')"><img src="${c.qr_code_url}" alt="赛事二维码"></div>`
              : '<span class="comp-detail-none">未上传</span>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}
function closeCompetitionDetail() {
  const overlay = document.getElementById('compDetailOverlay');
  if (overlay) overlay.remove();
  document.body.style.overflow = '';
}
function openCompQrFullscreen(src) {
  const fs = document.createElement('div');
  fs.className = 'comp-qr-fullscreen';
  fs.onclick = () => fs.remove();
  fs.innerHTML = `<img src="${src}" alt="二维码大图">`;
  document.body.appendChild(fs);
}

function openCreateCompetitionModal() {
  const existing = document.getElementById('createCompModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'createCompModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-sm">
      <h3 style="margin-bottom:20px;">创建赛事</h3>
      <form onsubmit="handleCreateCompetition(event)">
        <div class="form-group">
          <label>赛事名称 *</label>
          <input class="form-input" type="text" id="compName" required placeholder="如：浅梦杯春季赛">
        </div>
        <div class="form-group">
          <label>赛事等级</label>
          <select class="form-select" id="compTierSel">
            <option value="regular">🎮 常规赛事</option>
            <option value="elite">🏆 顶级联赛（仅 S/A 级参赛）</option>
            <option value="secondary">⚔️ 次级联赛（仅 B 级参赛）</option>
          </select>
        </div>
        <div class="form-group">
          <label>二维码图片</label>
          <input class="form-input" type="file" id="compQrFile" accept="image/*" onchange="previewCompQr(this)">
          <input type="hidden" id="compQrUrl">
          <div id="compQrPreview" style="margin-top:8px;max-width:120px;display:none;">
            <img id="compQrPreviewImg" style="width:100%;border-radius:8px;border:1px solid var(--border);">
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">支持 jpg / png / gif，建议不超过 2MB</div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button type="submit" class="btn btn-primary" style="flex:1;">创建</button>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('createCompModal').remove()" style="flex:1;">取消</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function previewCompQr(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('图片过大，请选择5MB以内的图片', 'error'); input.value = ''; return; }

  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 400;
      let w = img.width, h = img.height;
      if (w > MAX_WIDTH) { h = Math.round(h * MAX_WIDTH / w); w = MAX_WIDTH; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.65);
      document.getElementById('compQrUrl').value = compressed;
      document.getElementById('compQrPreviewImg').src = compressed;
      document.getElementById('compQrPreview').style.display = '';
    };
    img.onerror = () => { showToast('图片加载失败', 'error'); };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

async function handleCreateCompetition(e) {
  e.preventDefault();
  const name = document.getElementById('compName').value.trim();
  const qr_code_url = document.getElementById('compQrUrl').value.trim();
  const tier = document.getElementById('compTierSel').value;
  if (!name) { showToast('请输入赛事名称', 'error'); return; }
  try {
    await api('/api/admin/competitions', { method: 'POST', body: JSON.stringify({ name, qr_code_url, tier }) });
    showToast('赛事创建成功', 'success');
    document.getElementById('createCompModal').remove();
    await loadCompetitionList();
  } catch (err) { showToast(err.message || '创建失败', 'error'); }
}

async function deleteCompetition(id) {
  if (!await dialog({ title: '删除赛事', body: '确定删除该赛事吗？此操作不可恢复。', confirmText: '确定删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/admin/competitions/${id}`, { method: 'DELETE' });
    showToast('已删除', 'success');
    await loadCompetitionList();
  } catch (err) { showToast(err.message || '删除失败', 'error'); }
}

// ==================== 我的账户页面 ====================
async function renderAccountPanel(targetEl) {
  const content = targetEl || document.getElementById('tabContent');
  content.innerHTML = `
    <div class="dream-coin-display">
      <div class="dream-coin-icon">梦</div>
      <div class="dream-coin-balance" id="coinBalance">--</div>
      <div class="dream-coin-label">梦 币 余 额</div>
    </div>
    <div class="recruit-tabs" style="margin-bottom:16px;">
      <button class="recruit-tab active" id="coinTabHistory" onclick="switchCoinTab('history')">收支明细</button>
      ${currentUser && currentUser.id === 'mp4hmya7ad15v6' ? '<button class="recruit-tab" id="coinTabAward" onclick="switchCoinTab(\'award\')">发放梦币</button>' : ''}
      ${currentUser && currentUser.id === 'mp4hmya7ad15v6' ? '<button class="recruit-tab" id="coinTabLog" onclick="switchCoinTab(\'log\')">全部流水</button>' : ''}
    </div>
    <div id="coinSubContent"><div class="loading-spinner"></div></div>
  `;
  currentCoinSubTab = 'history';
  await loadCoinSubTab();
}

let currentCoinSubTab = 'history';

function switchCoinTab(tab) {
  currentCoinSubTab = tab;
  document.querySelectorAll('#coinTabHistory,#coinTabAward,#coinTabLog').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById('coinTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (btn) btn.classList.add('active');
  loadCoinSubTab();
}

async function loadAwardUsers() {
  try {
    const data = await api('/api/admin/users/simple');
    window._awardUserList = data.users || [];
    renderAwardUserOptions(window._awardUserList);
  } catch(e) { console.error('加载用户列表失败', e); }
}
function renderAwardUserOptions(list) {
  const sel = document.getElementById('awardUserId');
  if (!sel) return;
  sel.innerHTML = '<option value="">请选择用户</option>' +
    list.map(u => `<option value="${u.id}">${u.coachName || u.username} (${u.username})</option>`).join('');
}
function filterAwardUsers() {
  const kw = document.getElementById('awardUserSearch').value.trim().toLowerCase();
  const list = (window._awardUserList || []).filter(u =>
    (u.username || '').toLowerCase().includes(kw) ||
    (u.coachName || '').toLowerCase().includes(kw)
  );
  renderAwardUserOptions(list);
}

async function loadCoinSubTab() {
  const container = document.getElementById('coinSubContent');
  try {
    if (currentCoinSubTab === 'history') {
      const data = await api('/api/me/coins');
      document.getElementById('coinBalance').textContent = data.balance + ' 梦币';
      const txs = data.transactions || [];
      if (!txs.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;">暂无收支记录</p>';
        return;
      }
      container.innerHTML = txs.map(t => `
        <div class="coin-transaction-item">
          <div class="coin-info">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="coin-type-badge coin-type-${t.type === 'award' ? 'award' : t.type === 'deduct' ? 'deduct' : 'other'}">${t.type === 'award' ? '奖励发放' : t.type === 'deduct' ? '扣除' : '其他'}</span>
            </div>
            <div class="coin-note">${t.note || '无备注'}</div>
            <div class="coin-time">${new Date(t.created_at).toLocaleString('zh-CN')}</div>
          </div>
          <div class="coin-amount ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
        </div>
      `).join('');
    } else if (currentCoinSubTab === 'award') {
      container.innerHTML = `
        <form onsubmit="handleAwardCoins(event)" style="max-width:480px;">
          <div class="form-group">
            <label>选择用户</label>
            <input class="form-input" type="text" id="awardUserSearch" placeholder="搜索用户名/姓名..." oninput="filterAwardUsers()" autocomplete="off">
            <select class="form-input" id="awardUserId" required style="margin-top:8px;">
              <option value="">请选择用户</option>
            </select>
          </div>
          <div class="form-group">
            <label>奖励数量</label>
            <input class="form-input" type="number" id="awardAmount" required placeholder="正数发放，负数扣除">
          </div>
          <div class="form-group">
            <label>备注</label>
            <input class="form-input" type="text" id="awardNote" placeholder="如：比赛冠军奖励">
          </div>
          <button type="submit" class="btn btn-primary" style="padding:12px 28px;">确认发放</button>
        </form>
      `;
      loadAwardUsers();
    } else if (currentCoinSubTab === 'log') {
      const data = await api('/api/admin/coin-transactions');
      const txs = data.transactions || [];
      if (!txs.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;">暂无流水记录</p>';
        return;
      }
      container.innerHTML = `<div style="margin-bottom:12px;font-size:0.82rem;color:var(--text-secondary);">共 ${txs.length} 条记录</div>` +
        txs.map(t => `
          <div class="coin-transaction-item">
            <div class="coin-info">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:0.82rem;color:var(--text-primary);font-weight:600;">${t.username || t.user_id}</span>
                <span class="coin-type-badge coin-type-${t.type === 'award' ? 'award' : t.type === 'deduct' ? 'deduct' : 'other'}">${t.type === 'award' ? '发放' : t.type === 'deduct' ? '扣除' : '其他'}</span>
              </div>
              <div class="coin-note">${t.note || '无备注'}</div>
              <div class="coin-time">${new Date(t.created_at).toLocaleString('zh-CN')}</div>
            </div>
            <div class="coin-amount ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+' : ''}${t.amount}</div>
          </div>
        `).join('');
    }
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);">加载失败：${err.message}</p>`;
  }
}

async function handleAwardCoins(e) {
  e.preventDefault();
  const userId = document.getElementById('awardUserId').value.trim();
  const amount = parseInt(document.getElementById('awardAmount').value);
  const note = document.getElementById('awardNote').value.trim();
  if (!userId || amount === 0 || isNaN(amount)) { showToast('请填写完整信息（数量不能为0）', 'error'); return; }
  try {
    await api('/api/admin/award-coins', { method: 'POST', body: JSON.stringify({ userId, amount, note }) });
    showToast(amount > 0 ? '发放成功' : '扣除成功', 'success');
    e.target.reset();
    // 刷新余额
    try { const d = await api('/api/me/coins'); document.getElementById('coinBalance').textContent = d.balance + ' 梦币'; } catch(e) {}
    // 如果当前在全部流水tab，刷新列表
    if (currentCoinSubTab === 'log') await loadCoinSubTab();
  } catch (err) { showToast(err.message || '操作失败', 'error'); }
}

// ==================== 转会市场 ====================
async function renderMarketPanel() {
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"></div>';
  try {
    // 管理员或俱乐部老板跳过选手认证，直接进入转会市场
    const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
    let isBoss = false;
    if (!isAdmin && currentUser) {
      try {
        const clubsData = await api('/api/clubs');
        const memberships = clubsData.memberships || [];
        isBoss = (clubsData.clubs || []).some(c => c.owner_id === currentUser.id) || memberships.some(m => m.role === 'boss');
      } catch(e) { isBoss = false; }
    }
    if (isAdmin || isBoss) {
      await loadMarketPlayers(content);
      return;
    }
    // 检查选手认证状态
    const playerData = await api('/api/player/status');
    const player = playerData.player;
    if (!player || player.status === 'pending') {
      content.innerHTML = `
        <div class="card" style="max-width:560px;margin:0 auto;">
          <h3 style="margin-bottom:16px;">转会市场</h3>
          ${!player ? `
            <div class="info-banner" style="margin-bottom:16px;">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
              <span>进入转会市场前需要先完成<strong>选手认证</strong>。提交后24小时内审核。</span>
            </div>
            <div id="playerCertForm">${buildCertForm()}</div>
          ` : `
            <div class="info-banner" style="margin-bottom:16px;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.06);">
              <span>你的认证申请<span style="color:var(--warning);">审核中</span>，通过后即可进入转会市场。</span>
            </div>
          `}
          ${player && player.status === 'rejected' ? `
            <div class="info-banner" style="margin-bottom:16px;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);">
              <span>你的认证<span style="color:var(--danger);">未通过</span>，请重新提交。</span>
            </div>
            <div id="playerCertForm">${buildCertForm()}</div>
          ` : ''}
        </div>`;
      setTimeout(initCertPositions, 50);
    } else {
      await loadMarketPlayers(content);
    }
  } catch(e) { content.innerHTML = `<div class="card"><p>加载失败：${e.message}</p></div>`; }
}

function buildCertForm() {
  return `
    <form onsubmit="submitPlayerCert(event)" style="max-width:480px;">
      <div class="form-group"><label>游戏ID *</label><input class="form-input" type="text" id="certGameId" required placeholder="如：浅梦" maxlength="20"></div>
      <div class="form-group">
        <label>擅长位置（可多选）*</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;" id="certPositions"></div>
      </div>
      <div class="form-group"><label>巅峰分 *</label><input class="form-input" type="number" id="certPeakScore" required placeholder="如：2200" min="0" max="5000"></div>
      <div class="form-group">
        <label>当前段位 *</label>
        <select class="form-input" id="certGameRank" required>
          <option value="">请选择段位</option>
          <option>荣耀王者100星+</option><option>荣耀王者50-99星</option><option>荣耀王者1-49星</option>
          <option>王者50-100星</option><option>王者25-49星</option><option>王者10-24星</option><option>王者1-9星</option>
          <option>星耀</option><option>钻石及以下</option>
        </select>
      </div>
      <div class="form-group">
        <label>巅峰分截图（选填，含巅峰分数）</label>
        <input class="form-input" type="file" id="certScreenshot1" accept="image/*" onchange="previewCertImg('certScreenshot1','certPreview1')">
        <div id="certPreview1" style="margin-top:6px;max-width:140px;display:none;"><img style="width:100%;border-radius:8px;border:1px solid rgba(255,255,255,.1);"></div>
      </div>
      <div class="form-group">
        <label>排位段位截图（选填，含当前段位）</label>
        <input class="form-input" type="file" id="certScreenshot2" accept="image/*" onchange="previewCertImg('certScreenshot2','certPreview2')">
        <div id="certPreview2" style="margin-top:6px;max-width:140px;display:none;"><img style="width:100%;border-radius:8px;border:1px solid rgba(255,255,255,.1);"></div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">至少上传一张截图，截图将用于管理员审核验证</div>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;padding:12px;">提交认证</button>
    </form>`;
}

// 初始化位置选择（表单渲染后调用）
function initCertPositions() {
  const selDiv = document.getElementById('certPositions');
  if (!selDiv) return;
  const lanes = ['对抗路','打野','中路','发育路','游走'];
  window._certSelectedLanes = [];
  function renderLanes() {
    const max = 2;
    const sel = window._certSelectedLanes || [];
    selDiv.innerHTML = lanes.map(l => {
      const active = sel.includes(l);
      const disabled = !active && sel.length >= max;
      return `<span class="lane-chip${active?' active':''}${disabled?' disabled':''}" onclick="${disabled?'':`toggleLane('${l}')`}">${l}</span>`;
    }).join('');
    // 提示文字
    let tip = document.getElementById('laneLimitTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'laneLimitTip';
      tip.style.cssText = 'font-size:0.7rem;color:var(--text-muted);margin-top:4px;';
      selDiv.parentNode.appendChild(tip);
    }
    tip.textContent = sel.length >= max ? `已选 ${sel.length}/${max} 个（已达上限）` : `已选 ${sel.length}/${max} 个`;
  }
  window.toggleLane = (l) => {
    const sel = window._certSelectedLanes || [];
    if (sel.includes(l)) { window._certSelectedLanes = sel.filter(x => x !== l); }
    else if (sel.length < 2) { window._certSelectedLanes = [...sel, l]; }
    else { return; }
    renderLanes();
  };
  window.getSelectedLanes = () => window._certSelectedLanes || [];
  renderLanes();
}

// 选手位置 chip 样式（动态注入）
const laneChipStyle = document.createElement('style');
laneChipStyle.textContent = `
  .lane-chip { display:inline-block;padding:4px 12px;border-radius:9999px;font-size:0.8rem;cursor:pointer;transition:all .15s;border:1px solid rgba(255,255,255,.1);color:var(--text-muted); }
  .lane-chip.active { background:rgba(79,70,229,.15);border-color:rgba(79,70,229,.35);color:var(--primary); }
  .lane-chip.disabled { opacity:.35;cursor:not-allowed; }
  .lane-chip:hover { border-color:rgba(79,70,229,.2); }
`;
document.head.appendChild(laneChipStyle);

async function submitPlayerCert(e) {
  e.preventDefault();
  const gameId = document.getElementById('certGameId').value.trim();
  const positions = window.getSelectedLanes();
  const peakScore = parseInt(document.getElementById('certPeakScore').value);
  const gameRank = document.getElementById('certGameRank').value;
  if (!positions.length) { showToast('请至少选择一个位置','error'); return; }
  const f1 = document.getElementById('certScreenshot1').files[0];
  const f2 = document.getElementById('certScreenshot2').files[0];
  if (!f1 && !f2) { showToast('请至少上传一张截图','error'); return; }
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const origText = submitBtn.textContent;
  submitBtn.disabled = true;
  // Canvas 压缩图片（max 800px, jpeg 0.7）
  const compress = (file) => new Promise((resolve) => {
    if (!file) return resolve(null);
    const img = new Image();
    const r = new FileReader();
    r.onload = (ev) => { img.src = ev.target.result; };
    r.readAsDataURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > 500) { h = Math.round(h * 500 / w); w = 500; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.35));
    };
    img.onerror = () => resolve(null);
  });
  try {
    submitBtn.textContent = '压缩中...';
    const [u1, u2] = await Promise.all([compress(f1), compress(f2)]);
    submitBtn.textContent = '提交中...';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(API_BASE + '/api/player/apply', {
      method:'POST', signal: ctrl.signal,
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + authToken },
      body: JSON.stringify({ gameId, positions, peakScore, gameRank, screenshotUrl1: u1, screenshotUrl2: u2 })
    });
    clearTimeout(t);
    if (!res.ok) {
      let msg = '提交失败';
      try {
        const text = await res.text();
        try { msg = JSON.parse(text).message || msg; } catch(e) { msg = text.substring(0, 200) || 'HTTP ' + res.status; }
      } catch(e) { msg = '网络错误 (' + res.status + ')'; }
      throw new Error(msg);
    }
    showToast('认证申请已提交，预计24小时内审核', 'success');
    await renderMarketPanel();
  } catch(e) {
    submitBtn.disabled = false; submitBtn.textContent = origText;
    showToast(e.name === 'AbortError' ? '上传超时，请重试或缩小图片' : (e.message||'提交失败'), 'error');
  }
}

// 截图预览
function previewCertImg(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input.files[0]) { preview.style.display = 'none'; return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.querySelector('img').src = e.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(input.files[0]);
}

async function loadMarketPlayers(container) {
  const data = await api('/api/market/players');
  const players = data.players || [];
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';

  // 检测是否为俱乐部老板并获取余额
  let myClubs = [];
  let balanceHtml = '';
  if (currentUser) {
    try {
      const clubsData = await api('/api/clubs');
      const memberships = clubsData.memberships || [];
      const myMembershipMap = new Map(memberships.map(m => [m.club_id, m.role]));
      myClubs = (clubsData.clubs || []).filter(c => c.owner_id === currentUser.id || myMembershipMap.has(c.id));
      window._myClubs = myClubs;
      if (myClubs.length > 0) {
        const coins = currentUser.dream_coins || 0;
        const wan = (coins / 10000).toFixed(1);
        balanceHtml = `
          <div class="market-balance-bar">
            <div style="display:flex;align-items:center;gap:6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              <span>我的余额：<strong style="color:#fbbf24;">${wan}万</strong> 梦币</span>
            </div>
            <span style="font-size:0.7rem;color:var(--text-muted);">所属俱乐部：${myClubs.map(c => c.name).join('、')}</span>
          </div>`;
      }
    } catch(e) { window._myClubs = []; }
  }

  window._marketPlayers = players;
  window._marketSort = 'time';
  // 必须在 innerHTML 赋值之前初始化，模板求值时会访问这些变量
  if (window._marketContract === undefined) window._marketContract = 'all';
  if (!window._marketPosFilters) window._marketPosFilters = new Set();

  container.innerHTML = `
    <div class="card">
      <h3>转会市场</h3>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:16px;">俱乐部老板可联系选手签约</p>
      ${balanceHtml}
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-sm ${marketSort==='time'?'btn-primary':'btn-secondary'}" onclick="changeMarketSort('time')">最新</button>
        <button class="btn btn-sm ${marketSort==='value'?'btn-primary':'btn-secondary'}" onclick="changeMarketSort('value')">按身价</button>
        <select class="form-input" id="marketMaxValue" onchange="filterMarketPlayers()" style="width:auto;padding:4px 8px;font-size:0.8rem;">
          <option value="">全部身价</option>
          <option value="10">10万以下</option><option value="20">20万以下</option><option value="30">30万以下</option><option value="50">50万以下</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:0.72rem;color:var(--text-muted);">签约：</span>
        <button class="market-chip ${window._marketContract==='all'?'active':''}" onclick="filterMarketContract('all')">全部</button>
        <button class="market-chip market-chip-free ${window._marketContract==='free'?'active':''}" onclick="filterMarketContract('free')">未签约</button>
        <button class="market-chip market-chip-signed ${window._marketContract==='signed'?'active':''}" onclick="filterMarketContract('signed')">已签约</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:0.72rem;color:var(--text-muted);">位置：</span>
        ${['对抗路','打野','中路','发育路','游走'].map(l => `
          <button class="market-chip market-chip-pos ${window._marketPosFilters.has('${l}')?'active':''}" onclick="toggleMarketPos('${l}')">${l}</button>
        `).join('')}
        ${window._marketPosFilters.size > 0 ? `<button class="market-chip" onclick="clearMarketPos()" style="font-size:0.65rem;">清除</button>` : ''}
      </div>
      <div id="marketPlayerList"></div>
    </div>
  `;
  window._marketPlayers = players;
  window._marketSort = 'time';
  window.changeMarketSort = (s) => { window._marketSort = s; renderMarketPlayerList(); };
  window.filterMarketContract = (v) => {
    window._marketContract = v;
    document.querySelectorAll('[onclick^="filterMarketContract"]').forEach(chip => {
      chip.classList.toggle('active', chip.textContent.trim() === (v === 'all' ? '全部' : v === 'free' ? '未签约' : '已签约'));
    });
    renderMarketPlayerList();
  };
  window.toggleMarketPos = (pos) => {
    if (window._marketPosFilters.has(pos)) window._marketPosFilters.delete(pos);
    else window._marketPosFilters.add(pos);
    // 同步 chip 按钮的 active 状态
    document.querySelectorAll('.market-chip-pos').forEach(chip => {
      if (chip.textContent.trim() === pos) chip.classList.toggle('active', window._marketPosFilters.has(pos));
    });
    // 同步'清除'按钮显示/隐藏
    const clearBtn = document.querySelector('[onclick="clearMarketPos()"]');
    if (clearBtn) clearBtn.style.display = window._marketPosFilters.size > 0 ? '' : 'none';
    renderMarketPlayerList();
  };
  window.clearMarketPos = () => {
    window._marketPosFilters.clear();
    document.querySelectorAll('.market-chip-pos').forEach(chip => chip.classList.remove('active'));
    const clearBtn = document.querySelector('[onclick="clearMarketPos()"]');
    if (clearBtn) clearBtn.style.display = 'none';
    renderMarketPlayerList();
  };
  window.filterMarketPlayers = () => { renderMarketPlayerList(); };
  renderMarketPlayerList();
}

let marketSort = 'time';

function renderMarketPlayerList() {
  const container = document.getElementById('marketPlayerList');
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  const myClubs = window._myClubs || [];
  const isBoss = myClubs.length > 0;
  let list = window._marketPlayers || [];
  const maxVal = document.getElementById('marketMaxValue')?.value;
  if (maxVal) list = list.filter(p => p.market_value <= parseInt(maxVal));
  // 签约状态筛选
  if (window._marketContract === 'free') list = list.filter(p => !p.club_id);
  else if (window._marketContract === 'signed') list = list.filter(p => p.club_id);
  // 位置筛选（多选交集，选了对抗路+打野 = 两个都会的选手）
  if (window._marketPosFilters && window._marketPosFilters.size > 0) {
    list = list.filter(p => {
      let pos = [];
      try { pos = JSON.parse(p.positions || '[]'); } catch(e) {}
      return Array.from(window._marketPosFilters).every(f => pos.includes(f));
    });
  }
  if (window._marketSort === 'value') list.sort((a,b) => b.market_value - a.market_value);
  else list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (!list.length) { container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">暂无选手</p>'; return; }
  container.innerHTML = list.map(p => {
    let positions = [];
    try { positions = JSON.parse(p.positions || '[]'); } catch(e) {}
    const isFree = !p.club_id;
    const canBuy = isBoss && isFree && (isAdmin || myClubs.some(c => c.owner_id === currentUser.id));
    return `
    <div class="market-player-card" onclick="openPlayerDetailModal('${p.user_id}')">
      <div class="market-player-info">
        <div class="market-player-name">${p.game_id} <span style="font-size:0.72rem;color:var(--text-muted);">(${p.coachname || p.username})</span></div>
        <div class="market-player-detail">巅峰${p.peak_score} | ${p.game_rank}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
          ${positions.map(l => `<span class="pos-tag pos-tag-${l}">${l}</span>`).join('')}
        </div>
        ${p.heropool ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;" title="擅长英雄：${p.heropool}"><span style="color:var(--text-secondary);">擅长：</span>${p.heropool}</div>` : ''}
      </div>
      <div class="market-player-value">
        ${p.grade ? `<span class="grade-badge grade-${p.grade.toLowerCase()}">${p.grade}级</span>` : ''}
        <span style="font-size:1.2rem;font-weight:700;color:var(--warning);">${p.market_value}万</span>
        <span style="font-size:0.7rem;color:var(--text-muted);">${p.club_name ? '已签约: '+p.club_name : '自由选手'}</span>
        ${canBuy ? `<button class="market-buy-btn" onclick="event.stopPropagation();buyPlayer('${p.user_id}',${p.market_value})">采买</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// 位置标签
const posTagStyle = document.createElement('style');
posTagStyle.textContent = `
  .pos-tag { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;border:1px solid; }
  .pos-tag-对抗路 { color:#ef4444;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08); }
  .pos-tag-打野 { color:#10b981;border-color:rgba(16,185,129,.3);background:rgba(16,185,129,.08); }
  .pos-tag-中路 { color:#8b5cf6;border-color:rgba(139,92,246,.3);background:rgba(139,92,246,.08); }
  .pos-tag-发育路 { color:#f59e0b;border-color:rgba(245,158,11,.3);background:rgba(245,158,11,.08); }
  .pos-tag-游走 { color:#06b6d4;border-color:rgba(6,182,212,.3);background:rgba(6,182,212,.08); }
  .grade-badge { display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;margin-right:6px; }
  .grade-s { color:#FFD700;background:rgba(255,215,0,.12);border:1px solid rgba(255,215,0,.3); }
  .grade-a { color:#a78bfa;background:rgba(123,47,253,.12);border:1px solid rgba(123,47,253,.3); }
  .grade-b { color:#60a5fa;background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3); }
  .grade-c { color:var(--text-muted);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1); }
  .market-player-card { display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:10px;margin-bottom:8px;gap:12px;cursor:pointer;transition:all .2s; }
  .market-player-card:hover { background:rgba(255,255,255,.04);border-color:rgba(79,70,229,.2);box-shadow:0 4px 20px rgba(79,70,229,.08); }
  .market-player-info { flex:1;min-width:0; }
  .market-player-name { font-size:0.92rem;font-weight:600;color:var(--text-primary);margin-bottom:2px; }
  .market-player-detail { font-size:0.78rem;color:var(--text-secondary); }
  .market-player-value { text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px; }
  .market-balance-bar { display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:linear-gradient(135deg,rgba(245,158,11,.08) 0%,rgba(245,158,11,.03) 100%);border:1px solid rgba(245,158,11,.15);border-radius:8px;margin-bottom:16px;flex-wrap:wrap;gap:6px; }
  .market-buy-btn { padding:4px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px; }
  .market-buy-btn:hover { transform:translateY(-1px);box-shadow:0 4px 12px rgba(16,185,129,.3); }
  .market-buy-btn:disabled { opacity:.5;cursor:not-allowed;transform:none;box-shadow:none; }
  .player-detail-section { margin-bottom:14px; }
  .player-detail-section h4 { font-size:0.82rem;color:var(--text-secondary);margin-bottom:8px;font-weight:600; }
  .player-detail-grid { display:grid;grid-template-columns:repeat(2,1fr);gap:8px; }
  .player-detail-item { background:rgba(255,255,255,.03);padding:8px 10px;border-radius:6px;font-size:0.8rem; }
  .player-detail-item label { color:var(--text-muted);font-size:0.7rem;display:block;margin-bottom:2px; }
  .player-detail-item span { color:var(--text-primary);font-weight:600; }
  .lane-stat-bar { display:flex;align-items:center;gap:8px;font-size:0.78rem;margin-bottom:4px; }
  .lane-stat-bar .lane-name { width:48px;color:var(--text-muted); }
  .lane-stat-bar .lane-bar { flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden; }
  .lane-stat-bar .lane-fill { height:100%;background:var(--gradient-primary);border-radius:3px; }
  .lane-stat-bar .lane-val { width:32px;text-align:right;color:var(--text-secondary); }
  .market-chip { display:inline-flex;align-items:center;gap:3px;padding:4px 12px;border-radius:14px;font-size:0.72rem;font-weight:600;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:rgba(255,255,255,.35);cursor:pointer;transition:all .15s;user-select:none; }
  .market-chip:hover { border-color:rgba(255,255,255,.18);color:var(--text-primary); }
  .market-chip.active { border-color:var(--accent);background:rgba(123,47,253,.2);color:#fff;box-shadow:0 0 8px rgba(123,47,253,.25); }
  .market-chip.active::before { content:'✓';font-size:0.6rem;font-weight:700; }
  .market-chip-free { color:rgba(16,185,129,.5);border-color:rgba(16,185,129,.15); }
  .market-chip-free.active { background:rgba(16,185,129,.22);border-color:#10b981;color:#fff;box-shadow:0 0 8px rgba(16,185,129,.25); }
  .market-chip-free.active::before { content:'✓';font-size:0.6rem;font-weight:700; }
  .market-chip-free:hover { border-color:rgba(16,185,129,.35); }
  .market-chip-signed { color:rgba(245,158,11,.5);border-color:rgba(245,158,11,.15); }
  .market-chip-signed.active { background:rgba(245,158,11,.22);border-color:#f59e0b;color:#fff;box-shadow:0 0 8px rgba(245,158,11,.25); }
  .market-chip-signed.active::before { content:'✓';font-size:0.6rem;font-weight:700; }
  .market-chip-signed:hover { border-color:rgba(245,158,11,.35); }
  .market-chip-pos { color:rgba(255,255,255,.35); }
  .market-chip-pos.active { background:rgba(139,92,246,.22);border-color:#8b5cf6;color:#fff;box-shadow:0 0 8px rgba(139,92,246,.3); }
  .market-chip-pos.active::before { content:'✓';font-size:0.6rem;font-weight:700; }
  .market-chip-pos:hover { border-color:rgba(139,92,246,.35); }
`;
document.head.appendChild(posTagStyle);

// 选手详情弹窗
async function openPlayerDetailModal(userId) {
  const overlay = document.createElement('div');
  overlay.id = 'playerDetailModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;">选手名片</h3>
        <button class="btn btn-ghost btn-sm" onclick="closePlayerDetailModal()" style="padding:4px 10px;">关闭</button>
      </div>
      <div id="playerDetailContent"><div class="loading-spinner"></div></div>
    </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) closePlayerDetailModal(); };
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  try {
    const userRes = await api('/api/users/' + userId);
    const u = userRes.user || {};
    const p = userRes.player || {};
    let positions = [];
    try { positions = JSON.parse(p.positions || '[]'); } catch(e) {}
    let laneStats = {};
    try { laneStats = JSON.parse(u.laneStats || '{}'); } catch(e) {}
    const maxLaneVal = Math.max(1, ...Object.values(laneStats).map(v => parseInt(v) || 0));

    const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
    const isClubBoss = p.club_owner_id === currentUser.id;
    const canEdit = (isClubBoss || isAdmin) && p.club_id;
    const salaryDisplay = p.weekly_salary !== undefined && p.weekly_salary !== null
      ? p.weekly_salary.toLocaleString() + ' 梦币/周'
      : '-';

    let detailHtml = `
      <div class="player-detail-section">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff;">${(u.coachName || u.username || '?').charAt(0)}</div>
          <div>
            <div style="font-size:1rem;font-weight:700;color:var(--text-primary);">${p.game_id || u.gameId || '未设置游戏ID'} <span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">(${u.coachName || u.username})</span></div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">${u.gameRank || '星耀'} | 巅峰${u.peakScore || 0}</div>
          </div>
        </div>
      </div>

      <div class="player-detail-section">
        <h4>游戏信息</h4>
        <div class="player-detail-grid">
          <div class="player-detail-item"><label>游戏ID</label><span>${u.gameId || '-'}</span></div>
          <div class="player-detail-item"><label>游戏大区</label><span>${u.gameServer || '-'}</span></div>
          <div class="player-detail-item"><label>当前段位</label><span>${u.gameRank || '-'}</span></div>
          <div class="player-detail-item"><label>巅峰分数</label><span>${u.peakScore || 0}</span></div>
          <div class="player-detail-item"><label>身价</label><span style="color:var(--warning);">${p.market_value || '-'}万</span></div>
          <div class="player-detail-item"><label>等级</label><span>${p.grade || '-'}</span></div>
        </div>
      </div>

      ${p.club_id ? `
      <div class="player-detail-section">
        <h4>俱乐部信息</h4>
        <div class="player-detail-grid">
          <div class="player-detail-item"><label>所属俱乐部</label><span>${p.club_name || '-'}</span></div>
          <div class="player-detail-item"><label>周薪</label><span style="color:var(--success);">${salaryDisplay}</span></div>
        </div>
      </div>
      ` : ''}

      <div class="player-detail-section">
        <h4>擅长位置</h4>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${positions.length ? positions.map(l => `<span class="pos-tag pos-tag-${l}">${l}</span>`).join('') : '<span style="color:var(--text-muted);font-size:0.8rem;">未设置</span>'}
        </div>
      </div>

      <div class="player-detail-section">
        <h4>分路胜场</h4>
        ${['对抗路','打野','中路','发育路','游走'].map(lane => {
          const val = parseInt(laneStats[lane]) || 0;
          const pct = maxLaneVal > 0 ? Math.round(val / maxLaneVal * 100) : 0;
          return `<div class="lane-stat-bar">
            <span class="lane-name">${lane}</span>
            <div class="lane-bar"><div class="lane-fill" style="width:${pct}%"></div></div>
            <span class="lane-val">${val}</span>
          </div>`;
        }).join('')}
      </div>

      ${u.heroPool ? `<div class="player-detail-section"><h4>擅长英雄</h4><div style="font-size:0.85rem;color:var(--text-primary);line-height:1.6;">${u.heroPool}</div></div>` : ''}
      ${u.bio ? `<div class="player-detail-section"><h4>个人简介</h4><div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">${u.bio}</div></div>` : ''}

      <div class="player-detail-section">
        <h4>联系方式</h4>
        <div class="player-detail-item" style="display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span style="color:#10b981;font-weight:700;">${u.wechat || '未填写'}</span>
        </div>
      </div>
    `;

    if (canEdit) {
      detailHtml += `
      <div class="player-detail-section" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;">
        <h4>调整选手信息（老板）</h4>
        <form onsubmit="handleUpdatePlayerInfo(event, '${userId}', ${p.club_id})" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">身价（万梦币）</label>
            <input class="form-input" type="number" id="editMarketValue" value="${p.market_value || ''}" min="1" style="font-size:0.85rem;">
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">自定义周薪（梦币，留空则按等级标准）</label>
            <input class="form-input" type="number" id="editCustomSalary" value="${p.custom_salary !== null && p.custom_salary !== undefined ? p.custom_salary : ''}" min="0" style="font-size:0.85rem;">
          </div>
          <button type="submit" class="btn btn-primary btn-sm">保存调整</button>
        </form>
      </div>`;
    }

    document.getElementById('playerDetailContent').innerHTML = detailHtml;
  } catch(e) {
    document.getElementById('playerDetailContent').innerHTML = `<p style="color:var(--danger);">加载失败：${e.message}</p>`;
  }
}

async function handleUpdatePlayerInfo(e, userId, clubId) {
  e.preventDefault();
  const marketValue = document.getElementById('editMarketValue').value;
  const customSalary = document.getElementById('editCustomSalary').value;
  try {
    await api('/api/club/' + clubId + '/player/' + userId + '/update', {
      method: 'POST',
      body: JSON.stringify({
        marketValue: marketValue ? parseInt(marketValue) : undefined,
        customSalary: customSalary !== '' ? parseInt(customSalary) : undefined
      })
    });
    showToast('选手信息已更新', 'success');
    closePlayerDetailModal();
  } catch(err) { showToast(err.message, 'error'); }
}

function closePlayerDetailModal() {
  const el = document.getElementById('playerDetailModal');
  if (el) el.remove();
  document.body.style.overflow = '';
}

// 采买选手
async function buyPlayer(playerUserId, marketValue) {
  const myClubs = window._myClubs || [];
  if (!myClubs.length) { showToast('你不是俱乐部老板','error'); return; }

  let clubId;
  if (myClubs.length === 1) {
    clubId = myClubs[0].id;
  } else {
    clubId = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:400px;" onclick="event.stopPropagation()">
          <h3 style="margin-bottom:16px;">选择俱乐部</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
            ${myClubs.map(c => `
              <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').dataset.clubId='${c.id}';this.closest('.modal-overlay').click();" style="justify-content:flex-start;">
                <span style="font-weight:700;">${c.name}</span>
                <span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);">${c.member_count || 0}人</span>
              </button>
            `).join('')}
          </div>
          <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').dataset.clubId='';this.closest('.modal-overlay').click();" style="width:100%;">取消</button>
        </div>`;
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          const cid = overlay.dataset.clubId;
          overlay.remove();
          resolve(cid || null);
        }
      };
      document.body.appendChild(overlay);
    });
    if (!clubId) return;
  }

  const coins = currentUser.dream_coins || 0;
  const fee = marketValue * 10000;
  if (coins < fee) {
    showToast(`余额不足，签约需 ${marketValue}万梦币`, 'error');
    return;
  }

  if (!confirm(`确认花费 ${marketValue}万梦币 签约该选手？\n签约后选手将加入你的俱乐部。`)) return;

  try {
    const res = await api('/api/club/sign', {
      method: 'POST',
      body: JSON.stringify({ playerUserId, clubId: parseInt(clubId) })
    });
    showToast(res.message || '签约成功！', 'success');
    // 扣除本地余额显示
    currentUser.dream_coins = (currentUser.dream_coins || 0) - fee;
    // 刷新转会市场
    await renderMarketPanel();
  } catch(e) {
    showToast(e.message || '签约失败', 'error');
  }
}

// ==================== 俱乐部页面 ====================
async function renderClubPanel() {
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"></div>';
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  try {
    const clubsData = await api('/api/clubs');
    const clubs = clubsData.clubs || [];
    const memberships = clubsData.memberships || [];
    const myMembershipMap = new Map(memberships.map(m => [m.club_id, m.role]));
    // 查找当前用户关联的俱乐部（老板或成员）
    const myClubs = clubs.filter(c => c.owner_id === currentUser.id || myMembershipMap.has(c.id));

    let html = '<div class="card"><h3>我的俱乐部</h3>';
    if (isAdmin) {
      html += `<button class="btn btn-primary btn-sm" style="margin-bottom:12px;" onclick="openCreateClubModal()">创建俱乐部</button>`;
    }
    if (myClubs.length > 0) {
      html += myClubs.map(c => {
        const isOwner = c.owner_id === currentUser.id;
        const roleLabel = isOwner ? '你 是老板' : (myMembershipMap.get(c.id) === 'member' ? '你 是成员' : '');
        return `
        <div class="club-card" onclick="renderClubDetail(${c.id})" style="cursor:pointer;">
          <div><span style="font-weight:700;color:var(--text-primary);">${c.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">${c.member_count || 0}名队员</span>
          </div>
          <div style="font-size:0.78rem;color:var(--warning);">${roleLabel}</div>
        </div>
      `;
      }).join('');
    } else {
      html += '<p style="color:var(--text-muted);">你还没有自己的俱乐部</p>';
    }
    html += '</div>';

    // 所有俱乐部列表
    html += `<div class="card" style="margin-top:16px;"><h3 style="margin-bottom:12px;">全部俱乐部</h3>`;
    if (clubs.length === 0) {
      html += '<p style="color:var(--text-muted);">暂无俱乐部</p>';
    } else {
      html += clubs.map(c => `
        <div class="club-card" onclick="renderClubDetail(${c.id})" style="cursor:pointer;">
          <div>
            <span style="font-weight:600;color:var(--text-primary);">${c.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">${c.member_count || 0}名队员</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);">老板：${c.owner_name || c.owner_username || c.owner_id}</div>
        </div>
      `).join('');
    }
    html += '</div>';
    content.innerHTML = html;
  } catch(e) { content.innerHTML = `<div class="card"><p>加载失败：${e.message}</p></div>`; }
}

async function renderClubDetail(clubId) {
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"></div>';
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  try {
    const data = await api('/api/club/' + clubId);
    const c = data.club;
    const members = data.members || [];
    const transfers = data.transfers || [];
    const isOwner = c.owner_id === currentUser.id;

    // 获取大名单
    let rosters = { elite: [], secondary: [], free: [] };
    try { rosters = await api('/api/club/' + clubId + '/roster'); } catch(e) {}
    const eliteIds = new Set((rosters.elite || []).map(r => r.player_user_id));
    const secondaryIds = new Set((rosters.secondary || []).map(r => r.player_user_id));
    const freeIds = new Set((rosters.free || []).map(r => r.player_user_id));

    // 获取转会市场选手列表（老板专用）
    let marketPlayers = [];
    if (isOwner || isAdmin) {
      try { const mp = await api('/api/market/players'); marketPlayers = (mp.players || []).filter(p => !p.club_id); } catch(e) {}
    }

    const gradeCls = { S: 'grade-s', A: 'grade-a', B: 'grade-b', C: 'grade-c', D: 'grade-c' };

    let html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div>
            <h3>${c.name}</h3>
            <p style="font-size:0.8rem;color:var(--text-muted);">老板：${c.owner_name || c.owner_username || c.owner_id}</p>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="renderClubPanel()">返回俱乐部列表</button>
        </div>

        <h4 style="margin-bottom:8px;font-size:0.9rem;">队员名单 (${members.length}人)</h4>
        ${members.length === 0 ? '<p style="color:var(--text-muted);">暂无队员</p>' : members.map(m => {
          const g = m.grade;
          const gCls = gradeCls[g] || 'grade-c';
          const mv = m.market_value;
          return `
          <div class="club-member-row" style="cursor:pointer;" onclick="openPlayerDetailModal('${m.user_id}')">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-weight:600;">${m.coachname || m.username}</span>
              ${m.gameid ? `<span style="font-size:0.72rem;color:var(--text-muted);">${m.gameid}</span>` : ''}
              <span class="pos-tag club-role-${m.role}">${m.role === 'boss' ? '老板' : m.role === 'player' ? '选手' : '队员'}</span>
              ${g ? `<span class="grade-badge ${gCls}">${g}</span>` : ''}
              ${mv ? `<span style="font-size:0.72rem;color:var(--warning);font-weight:700;">${mv}万</span>` : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">${m.gamerank || ''} ${m.peakscore ? '巅峰'+m.peakscore : ''}</div>
            ${(isOwner || isAdmin) && m.role !== 'boss' ? `<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); removeClubMember(${clubId},'${m.user_id}')" style="color:var(--danger);padding:2px 8px;font-size:0.7rem;">移除</button>` : ''}
          </div>`;
        }).join('')}

        ${isOwner || isAdmin ? `
        <h4 style="margin-top:24px;margin-bottom:10px;font-size:0.9rem;">大名单管理</h4>
        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:16px;margin-bottom:16px;">
          <div style="font-size:0.82rem;font-weight:700;color:#fbbf24;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
            顶级联赛 (${eliteIds.size}/5) <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;margin-left:4px;">限S/A级选手，老板不受限</span>
          </div>
          ${members.length === 0 ? '<p style="font-size:0.76rem;color:var(--text-muted);">无可用队员</p>' : `
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${members.map(m => {
              const g = m.grade;
              const gCls = gradeCls[g] || 'grade-c';
              const isBoss = m.role === 'boss';
              const allowed = isBoss || ['S','A'].includes(g);
              const disabledAttr = allowed ? '' : 'disabled';
              const opacityStyle = allowed ? '' : 'opacity:0.45;';
              return `<label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-secondary);cursor:pointer;padding:6px 8px;border-radius:6px;transition:background 0.15s;${opacityStyle}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="roster-elite-check" value="${m.user_id}" ${eliteIds.has(m.user_id) ? 'checked' : ''} ${disabledAttr} style="accent-color:#fbbf24;width:14px;height:14px;cursor:pointer;">
                <span style="font-weight:600;color:var(--text-primary);">${m.coachname || m.username}</span>
                ${m.gameid ? `<span style="font-size:0.7rem;color:var(--text-muted);">${m.gameid}</span>` : ''}
                ${g ? `<span class="grade-badge ${gCls}">${g}</span>` : ''}
                ${m.market_value ? `<span style="font-size:0.7rem;color:var(--warning);font-weight:700;">${m.market_value}万</span>` : ''}
                ${isBoss ? '<span class="pos-tag club-role-boss" style="font-size:0.65rem;">老板</span>' : ''}
                ${!allowed && !isBoss ? '<span style="font-size:0.65rem;color:var(--danger);">需S/A级</span>' : ''}
              </label>`;
            }).join('')}
          </div>
          <button class="btn btn-sm" onclick="saveClubRoster(${clubId},'elite')" style="background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.25);">保存顶级联赛名单</button>`}
        </div>

        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:16px;margin-bottom:16px;">
          <div style="font-size:0.82rem;font-weight:700;color:#a78bfa;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            次级联赛 (${secondaryIds.size}/5) <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;margin-left:4px;">限B/C/D级选手，老板不受限</span>
          </div>
          ${members.length === 0 ? '<p style="font-size:0.76rem;color:var(--text-muted);">无可用队员</p>' : `
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${members.map(m => {
              const g = m.grade;
              const gCls = gradeCls[g] || 'grade-c';
              const isBoss = m.role === 'boss';
              const allowed = isBoss || ['B','C','D'].includes(g);
              const disabledAttr = allowed ? '' : 'disabled';
              const opacityStyle = allowed ? '' : 'opacity:0.45;';
              return `<label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-secondary);cursor:pointer;padding:6px 8px;border-radius:6px;transition:background 0.15s;${opacityStyle}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="roster-secondary-check" value="${m.user_id}" ${secondaryIds.has(m.user_id) ? 'checked' : ''} ${disabledAttr} style="accent-color:#a78bfa;width:14px;height:14px;cursor:pointer;">
                <span style="font-weight:600;color:var(--text-primary);">${m.coachname || m.username}</span>
                ${m.gameid ? `<span style="font-size:0.7rem;color:var(--text-muted);">${m.gameid}</span>` : ''}
                ${g ? `<span class="grade-badge ${gCls}">${g}</span>` : ''}
                ${m.market_value ? `<span style="font-size:0.7rem;color:var(--warning);font-weight:700;">${m.market_value}万</span>` : ''}
                ${isBoss ? '<span class="pos-tag club-role-boss" style="font-size:0.65rem;">老板</span>' : ''}
                ${!allowed && !isBoss ? '<span style="font-size:0.65rem;color:var(--danger);">需B/C/D级</span>' : ''}
              </label>`;
            }).join('')}
          </div>
          <button class="btn btn-sm" onclick="saveClubRoster(${clubId},'secondary')" style="background:rgba(123,47,253,0.12);color:#c4b5fd;border:1px solid rgba(123,47,253,0.25);">保存次级联赛名单</button>`}
        </div>

        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:16px;margin-bottom:16px;">
          <div style="font-size:0.82rem;font-weight:700;color:#34d399;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            自由名单 (${freeIds.size}/5) <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;margin-left:4px;">不限等级，可参加常规赛事，老板可加入，1人可加入多个名单</span>
          </div>
          ${members.length === 0 ? '<p style="font-size:0.76rem;color:var(--text-muted);">无可用队员</p>' : `
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${members.map(m => {
              const g = m.grade;
              const gCls = gradeCls[g] || 'grade-c';
              const isBoss = m.role === 'boss';
              // 自由名单不限等级，所有人都可加入
              return `<label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-secondary);cursor:pointer;padding:6px 8px;border-radius:6px;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="roster-free-check" value="${m.user_id}" ${freeIds.has(m.user_id) ? 'checked' : ''} style="accent-color:#34d399;width:14px;height:14px;cursor:pointer;">
                <span style="font-weight:600;color:var(--text-primary);">${m.coachname || m.username}</span>
                ${m.gameid ? `<span style="font-size:0.7rem;color:var(--text-muted);">${m.gameid}</span>` : ''}
                ${g ? `<span class="grade-badge ${gCls}">${g}</span>` : ''}
                ${m.market_value ? `<span style="font-size:0.7rem;color:var(--warning);font-weight:700;">${m.market_value}万</span>` : ''}
                ${isBoss ? '<span class="pos-tag club-role-boss" style="font-size:0.65rem;">老板</span>' : ''}
              </label>`;
            }).join('')}
          </div>
          <button class="btn btn-sm" onclick="saveClubRoster(${clubId},'free')" style="background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.25);">保存自由名单</button>`}
        </div>

        <h4 style="margin-top:20px;margin-bottom:8px;font-size:0.9rem;">签约选手</h4>
        <select class="form-input" id="signPlayerId" style="margin-bottom:8px;">
          <option value="">选择要签约的选手...</option>
          ${marketPlayers.map(p => `<option value="${p.user_id}">${p.game_id}  | 巅峰${p.peak_score} ${p.game_rank} | ${p.market_value}万</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="signPlayer(${clubId})">签约该选手</button>
        <p style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">签约费将从俱乐部老板账户扣除</p>
        ` : ''}

        <h4 style="margin-top:20px;margin-bottom:8px;font-size:0.9rem;">转会记录</h4>
        ${transfers.length === 0 ? '<p style="color:var(--text-muted);">暂无转会记录</p>' : transfers.map(t => `
          <div class="club-transfer-row" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:0.8rem;">
            <span>${t.player_name || t.player_username || t.player_user_id}</span>
            <span style="color:var(--warning);margin:0 8px;">${t.fee}万</span>
            <span style="color:var(--text-muted);">${new Date(t.created_at).toLocaleDateString('zh-CN')}</span>
          </div>
        `).join('')}
      </div>`;
    content.innerHTML = html;
  } catch(e) { content.innerHTML = `<div class="card"><p>加载失败：${e.message}</p></div>`; }
}

async function signPlayer(clubId) {
  const playerUserId = document.getElementById('signPlayerId').value;
  if (!playerUserId) { showToast('请选择选手','error'); return; }
  if (!confirm('确认签约该选手？签约费将从你的账户扣除。')) return;
  try {
    const res = await api('/api/club/sign', { method:'POST', body: JSON.stringify({ playerUserId, clubId }) });
    showToast(res.message || '签约成功','success');
    await renderClubDetail(clubId);
  } catch(e) { showToast(e.message,'error'); }
}

async function removeClubMember(clubId, userId) {
  if (!confirm('确认移除该队员？')) return;
  try {
    await api('/api/club/' + clubId + '/manage', { method:'POST', body: JSON.stringify({ action:'remove', userId }) });
    showToast('队员已移除','success');
    await renderClubDetail(clubId);
  } catch(e) { showToast(e.message,'error'); }
}

async function saveClubRoster(clubId, tier) {
  const cls = tier === 'elite' ? '.roster-elite-check' : tier === 'secondary' ? '.roster-secondary-check' : '.roster-free-check';
  const checked = Array.from(document.querySelectorAll(cls + ':checked')).map(cb => cb.value);
  if (checked.length > 5) { showToast('大名单最多5人','error'); return; }
  try {
    await api('/api/club/' + clubId + '/roster', { method:'PUT', body: JSON.stringify({ tier, players: checked }) });
    showToast('大名单已保存','success');
    await renderClubDetail(clubId);
  } catch(e) { showToast(e.message,'error'); }
}

function openCreateClubModal() {
  const existing = document.getElementById('createClubModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'createClubModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-sm">
      <h3>创建俱乐部</h3>
      <form onsubmit="handleCreateClub(event)">
        <div class="form-group"><label>俱乐部名称 *</label><input class="form-input" type="text" id="clubName" required placeholder="如：星河战队"></div>
        <div class="form-group">
          <label>老板身份（选择用户）</label>
          <input class="form-input" type="text" id="clubOwnerSearch" placeholder="搜索用户名/姓名..." oninput="filterClubOwnerUsers()" autocomplete="off">
          <select class="form-input" id="clubOwnerId" required style="margin-top:8px;">
            <option value="">请选择用户</option>
          </select>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px;">
          <button type="submit" class="btn btn-primary" style="flex:1;">创建</button>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('createClubModal').remove()" style="flex:1;">取消</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  // 加载用户列表
  loadClubOwnerUsers();
}

async function loadClubOwnerUsers() {
  try {
    const data = await api('/api/admin/users/simple');
    window._clubOwnerUserList = data.users || [];
    renderClubOwnerOptions(window._clubOwnerUserList);
  } catch(e) { console.error('加载用户列表失败', e); }
}
function renderClubOwnerOptions(list) {
  const sel = document.getElementById('clubOwnerId');
  if (!sel) return;
  sel.innerHTML = '<option value="">请选择用户</option>' +
    list.map(u => `<option value="${u.id}">${u.coachName || u.username} (${u.username})</option>`).join('');
}
function filterClubOwnerUsers() {
  const kw = document.getElementById('clubOwnerSearch').value.trim().toLowerCase();
  const list = (window._clubOwnerUserList || []).filter(u =>
    (u.username || '').toLowerCase().includes(kw) ||
    (u.coachName || '').toLowerCase().includes(kw)
  );
  renderClubOwnerOptions(list);
}

async function handleCreateClub(e) {
  e.preventDefault();
  const name = document.getElementById('clubName').value.trim();
  const ownerId = document.getElementById('clubOwnerId').value.trim();
  if (!name || !ownerId) return;
  try {
    await api('/api/club/create', { method:'POST', body: JSON.stringify({ name, ownerId }) });
    showToast('俱乐部创建成功','success');
    document.getElementById('createClubModal').remove();
    await renderClubPanel();
  } catch(e) { showToast(e.message,'error'); }
}

// 俱乐部样式
const clubStyles = document.createElement('style');
clubStyles.textContent = `
  .club-card { display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:10px;margin-bottom:8px;transition:border-color .15s; }
  .club-card:hover { border-color:rgba(79,70,229,.25); }
  .club-member-row { display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(255,255,255,.02);border-radius:8px;margin-bottom:6px;gap:8px;flex-wrap:wrap; }
  .club-role-boss { background:rgba(245,158,11,.12);color:#f59e0b;border-color:rgba(245,158,11,.25); }
  .club-role-player { background:rgba(79,70,229,.12);color:var(--primary);border-color:rgba(79,70,229,.25); }
  .club-role-member { background:rgba(255,255,255,.04);color:var(--text-secondary); }
`;
document.head.appendChild(clubStyles);

// ---------- 通知 ----------
async function checkNotifications() {
  if (!currentUser) return;
  try {
    const data = await api('/api/notifications', { skipCache: true });
    unreadNotifs = data.notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    if (unreadNotifs > 0) { badge.style.display = 'flex'; badge.textContent = unreadNotifs; }
    else badge.style.display = 'none';
  } catch {}
}
async function openNotifications() {
  if (!currentUser) return;
  const existing = document.getElementById('notifPanel');
  if (existing) { existing.remove(); return; }
  const data = await api('/api/notifications', { skipCache: true });
  let html = '<div style="padding:14px 0;">';
  if (data.notifications.length === 0) html += '<p style="text-align:center;color:var(--text-muted);padding:20px 0;">暂无通知</p>';
  else {
    data.notifications.forEach(n => {
      let actions = '';
      if (n.type === 'confirm_result') {
        actions = `<div style="margin-top:8px;display:flex;gap:8px;">
          <button class="btn btn-sm" style="background:rgba(0,200,83,0.15);color:#00C853;border:1px solid rgba(0,200,83,0.3);font-size:0.78rem;" onclick="confirmMatchResult('${n.relatedId}','win')">确认胜利</button>
          <button class="btn btn-sm" style="background:rgba(255,45,85,0.15);color:#FF2D55;border:1px solid rgba(255,45,85,0.3);font-size:0.78rem;" onclick="confirmMatchResult('${n.relatedId}','loss')">确认失败</button>
        </div>`;
      } else if (n.type === 'team_invite') {
        actions = `<div style="margin-top:8px;">
          <button class="btn btn-primary btn-sm" onclick="acceptTeamInvite('${n.relatedId}')" style="font-size:0.78rem;">接受邀请</button>
        </div>`;
      }
      html += `<div style="padding:12px;background:${n.read ? 'var(--bg-glass)' : 'rgba(0, 212, 255, 0.08)'};border-radius:var(--radius-md);margin-bottom:10px;font-size:0.88rem;border:1px solid ${n.read ? 'var(--border-color)' : 'rgba(0, 212, 255, 0.2)'};">${n.content}<br><small style="color:var(--text-muted);">${new Date(n.created_at).toLocaleString()}</small>${actions}</div>`;
    });
    html += '<button class="btn btn-primary btn-sm" onclick="markAllRead()" style="width:100%;margin-top:8px;">全部已读</button>';
  }
  html += '</div>';
  const panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.style.cssText = 'position:fixed;top:80px;right:16px;width:340px;max-height:450px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);z-index:150;padding:20px;overflow-y:auto;';
  panel.innerHTML = `<div style="font-weight:700;font-size:1rem;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;color:var(--text-primary);">消息通知 <span onclick="document.getElementById('notifPanel').remove()" style="cursor:pointer;font-size:1.4rem;color:var(--text-muted);width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);transition:all 0.2s;">&times;</span></div>${html}`;
  document.body.appendChild(panel);
  const closeOnOutside = (e) => { if (!panel.contains(e.target) && e.target.id !== 'notificationBell') { panel.remove(); document.removeEventListener('click', closeOnOutside); } };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}
async function markAllRead() {
  await api('/api/notifications/read-all', { method:'PUT' });
  showToast('已全部标为已读','success');
  checkNotifications();
  document.getElementById('notifPanel')?.remove();
}
async function confirmMatchResult(matchId, result) {
  try {
    await api(`/api/recruitment/${matchId}/confirm-result`, { method:'PUT', body: JSON.stringify({ result }) });
    showToast(result === 'win' ? '已确认胜利！' : '已确认失败', 'success');
    checkNotifications();
    document.getElementById('notifPanel')?.remove();
    switchTab('public');
  } catch(e) { showToast(e.message, 'error'); }
}
async function acceptTeamInvite(teamId) {
  try {
    await api(`/api/teams/${teamId}/join`, { method:'POST' });
    showToast('已加入队伍！', 'success');
    checkNotifications();
    document.getElementById('notifPanel')?.remove();
    switchTab('team');
  } catch(e) { showToast(e.message, 'error'); }
}

// ---------- Tab 切换 ----------
async function switchTab(tab) {
  stopRecruitPolling();
  currentTab = tab; updateUI();
    if (tab === 'public') cacheStore.delete('/api/recruitment/completed');
    else if (tab === 'recruit') { cacheStore.delete('/api/recruitment/active'); cacheStore.delete('/api/recruitment/full'); }
    else if (tab === 'team') cacheStore.delete('/api/teams/mine');
    else if (tab === 'profile') cacheStore.delete('/api/schedules/mine');
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"></div>';
  try {
    if (tab === 'public') await loadPublicSchedules();
    else if (tab === 'profile') await renderProfileCenter();
    else if (tab === 'admin') await renderAdminPanel();
    else if (tab === 'team') await renderTeamPanel();
    else if (tab === 'recruit') { currentRecruitSubTab = 'active'; await loadRecruitHall(); startRecruitPolling(); }
    else if (tab === 'competition') await renderCompetitionPanel();
    else if (tab === 'market') await renderMarketPanel();
    else if (tab === 'club') await renderClubPanel();
  } catch {
    content.innerHTML = '<div class="card"><p>加载失败</p><button class="btn btn-sm btn-primary" onclick="switchTab(\''+tab+'\')">重试</button></div>';
  }
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  if (['publish','profile','admin','competition'].includes(tab) && !currentUser) { showToast('请先登录','info'); openAuthModal('login'); return; }
  switchTab(tab);
}));

// ==================== 招募大厅系统 ====================

// 加载招募大厅
async function loadRecruitHall() {
  const content = document.getElementById('tabContent');
  content.innerHTML = `
    <div class="info-banner">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
      <span><strong>招募大厅</strong>：适合散人玩家，凑齐10人全员确认后成局 → 自动创建会议</span>
    </div>
    <div class="recruit-header">
      <div class="recruit-tabs">
         <button class="recruit-tab ${currentRecruitSubTab==='active'?'active':''}" onclick="switchRecruitSubTab('active')">招募中</button>
         <button class="recruit-tab ${currentRecruitSubTab==='full'?'active':''}" onclick="switchRecruitSubTab('full')">已满专区</button>
      </div>
      ${currentUser ? '<button class="btn btn-primary btn-sm" onclick="openCreateRecruitModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="margin-right:4px;vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建招募</button>' : ''}
    </div>
    <div id="recruitListContainer"><div class="loading-spinner"></div></div>
  `;
  await loadRecruitList();
}

async function switchRecruitSubTab(sub) {
  currentRecruitSubTab = sub;
  cacheStore.delete('/api/recruitment/active');
  cacheStore.delete('/api/recruitment/full');
  document.querySelectorAll('.recruit-tab').forEach(t => t.classList.toggle('active', t.textContent.includes(sub==='active'?'招募中':'已满')));
  document.getElementById('recruitListContainer').innerHTML = '<div class="loading-spinner"></div>';
  await loadRecruitList();
}

async function loadRecruitList() {
  const endpoint = currentRecruitSubTab === 'active' ? '/api/recruitment/active' : '/api/recruitment/full';
  const data = await api(endpoint, { skipCache: true });
  renderRecruitList(data.matches || []);
}

function renderRecruitList(matches) {
  const container = document.getElementById('recruitListContainer');
  if (!matches.length) {
    container.innerHTML = `
       <div class="empty-state">
         <div class="empty-state-icon" style="font-size:2.5rem;color:var(--text-muted);opacity:0.5;">${currentRecruitSubTab==='active'?'空':'无'}</div>
         <p>${currentRecruitSubTab==='active'?'暂无招募中的对局，快来发起第一场吧！':'暂无已满的对局'}</p>
        ${currentRecruitSubTab==='active'&&currentUser?'<br><button class="btn btn-primary" onclick="openCreateRecruitModal()">发起招募</button>':''}
      </div>`;
    return;
  }
  let html = '';
  matches.forEach(m => {
    const blueCount = m.positions.filter(p => p.team === 'blue').length;
    const redCount = m.positions.filter(p => p.team === 'red').length;
    const modeLabels = { 1: '模式1·参赛', 2: '模式2·组织', 3: '模式3·组队' };
    const statusLabel = m.status === 'full' ? '已满' : m.status === 'confirming' ? '待确认' : m.status === 'closed' ? '已关闭' : '招募中';
    const statusClass = m.status === 'full' ? 'badge-full' : m.status === 'confirming' ? 'badge-confirming' : m.status === 'closed' ? 'badge-closed' : 'badge-recruiting';
    const cardClass = m.status === 'full' ? 'full' : m.status === 'confirming' ? 'confirming' : 'recruiting';
    const progress = (m.totalCount / 10) * 100;
    const isOrg = currentUser && currentUser.id === m.organizer.id;

    html += `
      <div class="match-card ${cardClass}" onclick="openMatchDetail('${m.id}')" style="cursor:pointer;">
        <div class="match-card-header">
          <div>
            <span class="badge ${statusClass}">${statusLabel}</span>
            <span class="badge badge-level" style="margin-left:4px;">${m.levelReq}</span>
            <span class="badge" style="background:rgba(79, 70, 229, 0.12);color:#60a5fa;border:1px solid rgba(79, 70, 229, 0.2);margin-left:4px;">${modeLabels[m.mode]||'模式'+m.mode}</span>
          </div>
          <span style="font-size:0.82rem;color:var(--text-light);">${m.startTime}</span>
        </div>
        <div class="match-card-org">发起人：<strong>${m.organizer.teamName}</strong> <span class="badge badge-level">${m.organizer.level}</span></div>
        ${m.notes ? `<p style="font-size:0.82rem;color:var(--text-light);margin-bottom:8px;">${m.notes}</p>` : ''}
        <div class="progress-text">${m.totalCount} / 10 人已就位</div>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%;"></div></div>
        <div class="match-card-slots">
          <span class="slot-badge slot-blue"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4f46e5;margin-right:4px;box-shadow:0 0 4px rgba(79,70,229,0.5);"></span>蓝方 ${blueCount}/5</span>
          <span class="slot-badge slot-red"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ef4444;margin-right:4px;box-shadow:0 0 4px rgba(239,68,68,0.5);"></span>红方 ${redCount}/5</span>
        </div>
        ${isOrg ? `<div style="margin-top:10px;display:flex;gap:8px;" onclick="event.stopPropagation();">
          <button class="btn btn-xs btn-ghost" onclick="cancelMatch('${m.id}', event)">撤销招募</button>
          ${m.status==='recruiting'?'<button class="btn btn-xs btn-ghost" onclick="closeMatch(\''+m.id+'\', event)">关闭报名</button>':''}
        </div>` : ''}
      </div>`;
  });
  container.innerHTML = html;
}

// 打开对局详情页
async function openMatchDetail(matchId) {
  currentMatchId = matchId;
  const data = await api(`/api/recruitment/${matchId}`, { skipCache: true });
  if (!data || !data.match) { showToast('加载失败','error'); return; }
  renderMatchDetail(data.match);
}

function renderMatchDetail(match) {
  stopRecruitPolling();
  const content = document.getElementById('tabContent');
  const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
  const isOrg = currentUser && currentUser.id === match.organizer.id;
  const myPos = currentUser ? match.positions.find(p => p.playerId === currentUser.id) : null;
  const isFull = match.status === 'full';
  const isConfirming = match.status === 'confirming';
  const isClosed = match.status === 'closed';
  // confirming 状态下不能新加入
  const canJoin = currentUser && !isFull && !isConfirming && !isClosed && currentUser.id !== match.organizer.id && !myPos;
  const modeLabels = { 1: '模式1·参赛', 2: '模式2·组织', 3: '模式3·组队' };

  // 构成分路面板
  function buildLanePanel(team, teamLabel, teamColor, teamBg) {
    let html = `<div class="team-panel">
      <div class="team-panel-header ${team}">${teamColor} ${teamLabel}</div>
      <div class="team-panel-body">`;
    LANES.forEach(lane => {
      const pos = match.positions.find(p => p.team === team && p.lane === lane);
      const filled = !!pos;
      const isMine = pos && currentUser && pos.playerId === currentUser.id;
      const isOrgFilled = filled && !isMine;
      const laneDisabled = isFull || isConfirming || isClosed;
      // confirming 状态下：不能新加入，不能自己撤销（只能点确认按钮）
      const joinBtn = canJoin
        ? `<button class="btn btn-xs btn-blue" onclick="joinLane('${match.id}','${team}','${lane}')">报名</button>`
        : (myPos && !filled && !isConfirming ? `<button class="btn btn-xs btn-blue" onclick="joinLane('${match.id}','${team}','${lane}')">报名</button>` : '');
      // confirming 状态下普通用户不能撤销，只能等超时或在确认弹窗中选择
      const leaveBtn = isMine && !isConfirming
        ? `<button class="btn btn-xs btn-danger" onclick="leaveMatch('${match.id}')">撤销</button>`
        : '';
      const removeBtn = isOrg && filled
        ? `<button class="btn btn-xs btn-ghost" onclick="removePlayer('${match.id}','${pos.playerId}')" title="清理">移除</button>`
        : '';
      // confirming 状态下显示确认状态
      const confirmBadge = filled && isConfirming && pos.confirmed
        ? `<span class="badge badge-success" style="font-size:0.65rem;padding:2px 6px;">已确认</span>`
        : (filled && isConfirming && !pos.confirmed ? `<span class="badge badge-confirming" style="font-size:0.65rem;padding:2px 6px;">待确认</span>` : '');
      html += `
        <div class="lane-row ${team} ${filled?'filled':''}">
          <div class="lane-info">
            <div class="lane-name">${LANE_ICONS[lane]||''} ${lane}</div>
            <div class="player-name ${filled?'':'empty'}">${filled ? pos.playerName : '空位'}</div>
          </div>
          <div class="lane-action">
            ${filled && !isMine && !isOrg ? `<span style="font-size:0.72rem;color:var(--text-light);">已占</span>` : ''}
            ${confirmBadge || ''}
            ${leaveBtn}
            ${joinBtn}
            ${removeBtn}
          </div>
        </div>`;
    });
    html += '</div></div>';
    return html;
  }

  let headerActions = '';
  if (isOrg) {
    headerActions = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-sm btn-danger" onclick="cancelMatch('${match.id}')" style="padding:5px 14px;">撤销招募</button>
      ${(!isFull&&!isConfirming&&!isClosed)?'<button class="btn btn-sm btn-ghost" onclick="closeMatch(\''+match.id+'\')" style="padding:5px 14px;">关闭报名</button>':''}
      ${!match.meetingCode&&isFull?'<button class="btn btn-sm btn-primary" onclick="editMatchMeeting(\''+match.id+'\',\''+match.meetingCode+'\',\''+match.meetingLink+'\')" style="padding:5px 14px;">填入会议信息</button>':''}
      ${match.meetingCode&&isOrg?'<button class="btn btn-sm btn-ghost" onclick="editMatchMeeting(\''+match.id+'\',\''+match.meetingCode+'\',\''+match.meetingLink+'\')" style="padding:5px 14px;">编辑会议</button>':''}
    </div>`;
  }
  // 确认阶段的确认弹窗
  if (myPos && isConfirming) {
    if (myPos.confirmed) {
      headerActions = `<div style="margin-top:10px;"><span class="badge badge-success">已确认能参加，请准时参赛</span></div>`;
    } else {
      headerActions = `<div class="card" style="border:1px solid rgba(245,158,11,0.4);margin-top:10px;background:rgba(245,158,11,0.05);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <h4 style="margin:0;color:var(--warning);">请确认能否参加</h4>
        </div>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;">训练赛 ${match.startTime} 已凑齐10人，请确认你的参赛意向：</p>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-success btn-sm" onclick="confirmRecruitment('${match.id}', true)" style="padding:8px 20px;">能参加</button>
          <button class="btn btn-danger btn-sm" onclick="confirmRecruitment('${match.id}', false)" style="padding:8px 20px;">没时间</button>
        </div>
      </div>`;
    }
  }
  if (myPos && !isFull && !isConfirming && !isClosed) {
    headerActions = `<div style="margin-top:10px;"><button class="btn btn-sm btn-danger" onclick="leaveMatch('${match.id}')">撤销报名（${myPos.team==='blue'?'蓝方':'红方'} ${myPos.lane}）</button></div>`;
  }
  if (isFull) {
    headerActions = `<div style="margin-top:10px;"><span class="badge badge-full">10人已满，训练赛已成局！</span></div>`;
  }
  if (!currentUser) {
    headerActions = `<div style="margin-top:10px;font-size:0.82rem;color:rgba(255,255,255,0.8);">请登录后报名参赛</div>`;
  }

  // 构建联系信息卡片
  function buildContactCard() {
    // mode=2：腾讯会议
    if (match.mode === 2) {
      if (match.meetingCode) {
        return `<div class="card" style="border:1px solid rgba(22,93,255,0.35);margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <h3 style="margin:0;color:var(--primary);">腾讯会议已创建</h3>
          </div>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;">赛前10分钟自动开启，点击下方链接入会</p>
          <div style="background:#1A1A2E;border:1px solid rgba(22,93,255,0.2);border-radius:var(--radius-sm);padding:16px;margin-bottom:10px;">
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">会议号</div>
            <div style="font-weight:700;color:#fff;font-size:1.1rem;letter-spacing:2px;margin-bottom:12px;">${match.meetingCode}</div>
            <a href="${match.meetingLink}" target="_blank" class="btn btn-sm" style="background:rgba(79,70,229,0.15);color:#818cf8;border:1px solid rgba(79,70,229,0.4);font-size:0.82rem;padding:6px 16px;border-radius:var(--radius-sm);text-decoration:none;display:inline-block;">入会</a>
          </div>
          <p style="font-size:0.75rem;color:var(--text-muted);">提示：入会后可使用腾讯会议「分组讨论」功能手动分配A队/B队房间</p>
        </div>`;
      } else if (isOrg) {
        // 组织者未创建会议：显示建会按钮
        return `<div class="card" style="border:1px solid rgba(22,93,255,0.35);margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <h3 style="margin:0;color:var(--primary);">腾讯会议</h3>
          </div>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;">点击按钮提前创建腾讯会议（赛前10分钟系统也会自动建会）</p>
          <button class="btn btn-primary btn-sm" onclick="createMatchMeeting('${match.id}')" id="createMeetingBtn" style="padding:8px 16px;">创建腾讯会议</button>
          <p id="createMeetingMsg" style="font-size:0.78rem;color:var(--text-muted);margin-top:8px;display:none;"></p>
        </div>`;
      } else {
        // 非组织者，且会议未创建
        return `<div class="card" style="border:1px solid rgba(245,158,11,0.3);margin-bottom:20px;background:rgba(245,158,11,0.05);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <h3 style="margin:0;color:var(--warning);">腾讯会议创建中</h3>
          </div>
          <p style="font-size:0.82rem;color:var(--text-secondary);">组织者将在开赛前10分钟自动创建腾讯会议，请耐心等待...</p>
        </div>`;
      }
    } else {
      // mode 1/3：QQ群号
      if (match.groupContact) {
        const copied = isFull ? `<div style="margin-top:8px;padding:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:var(--radius-sm);">
          <div style="font-size:0.85rem;color:var(--success);margin-bottom:8px;">训练赛已成局，点击下方按钮加群沟通！</div>
          <button class="btn btn-primary btn-sm" onclick="copyGroupContact('${match.groupContact}')" style="padding:8px 16px;">复制群号：<strong>${match.groupContact}</strong></button>
        </div>` : '';
        return `<div class="card" style="border:1px solid rgba(16,185,129,0.25);margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <h3 style="margin:0;color:var(--success);">队伍联系群</h3>
          </div>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:10px;">QQ群号：<strong style="font-size:1rem;color:#fff;letter-spacing:1px;">${match.groupContact}</strong></p>
          <button class="btn btn-sm" onclick="copyGroupContact('${match.groupContact}')" style="background:rgba(16,185,129,0.12);color:var(--success);border:1px solid rgba(16,185,129,0.3);font-size:0.82rem;padding:6px 14px;border-radius:var(--radius-sm);">一键复制群号</button>
          ${copied}
        </div>`;
      } else {
        return `<div class="card" style="border:1px dashed rgba(255,255,255,0.15);margin-bottom:20px;background:transparent;">
          <p style="font-size:0.82rem;color:var(--text-muted);text-align:center;">房主未填写联系群号，请通过备注或其他方式联系</p>
        </div>`;
      }
    }
  }

  const contactCard = buildContactCard();

  content.innerHTML = `
    <div class="match-detail-header">
      <div class="back-btn" onclick="backToRecruitHall()">← 返回招募大厅</div>
      <h2>5v5 训练赛详情</h2>
      <div class="match-detail-meta">
        <span>${match.startTime}</span>
        <span>${match.levelReq}</span>
        <span>${modeLabels[match.mode]||'模式'+match.mode}</span>
        <span>${match.organizer.teamName}</span>
      </div>
      ${match.notes ? `<p style="font-size:0.85rem;margin-top:8px;opacity:0.9;">${match.notes}</p>` : ''}
      ${headerActions}
    </div>
    ${contactCard}
    <div class="progress-text">${match.positions.length} / 10 人已就位</div>
    <div class="progress-bar-wrap" style="margin-bottom:20px;"><div class="progress-bar-fill" style="width:${(match.positions.length/10)*100}%;"></div></div>
    <div class="teams-container">
      ${buildLanePanel('blue', '蓝方', '', '#e8f2fc')}
      ${buildLanePanel('red', '红方', '', '#fdeaec')}
    </div>`;
}

// 返回招募大厅
async function backToRecruitHall() {
  currentMatchId = null;
  await loadRecruitHall();
  startRecruitPolling();
}

// ---------- 创建招募 ----------
function openCreateRecruitModal() {
  if (!currentUser) { showToast('请先登录','info'); openAuthModal('login'); return; }
  selectedRecruitMode = 1;
  document.getElementById('createRecruitModal').style.display = 'flex';
  document.getElementById('recruitStartTime').value = '';
  document.getElementById('recruitLevelReq').value = '不限';
  document.getElementById('recruitNotes').value = '';
  document.getElementById('recruitGroupContact').value = '';
  document.getElementById('useTeamRecruit').checked = false;
  document.getElementById('teamMemberLanes').style.display = 'none';
  selectMode(1);
  buildPresetPositions();
  // 检查是否有队伍
  loadMyTeamForRecruit();
}

async function loadMyTeamForRecruit() {
  const section = document.getElementById('teamRecruitSection');
  const listContainer = document.getElementById('teamMemberLaneList');
  try {
    const data = await api('/api/teams/mine', { skipCache: true });
    if (data && data.team && data.team.memberCount > 0) {
      section.style.display = 'block';
      // 构建队员列表
      const team = data.team;
      let html = '';
      team.members.forEach((m, i) => {
        const isSelf = m.userId === currentUser.id;
        html += `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px;background:#1A1A2E;border:1px solid rgba(22,93,255,0.15);border-radius:var(--radius-sm);">
            <span style="font-size:0.85rem;flex:1;color:var(--text-primary);">${m.coachName || m.username}${isSelf ? ' <span style="color:var(--primary);font-weight:600;">（我）</span>' : ''}</span>
            <select class="form-select" id="teamLaneTeam_${m.userId}" style="width:80px;padding:5px 8px;font-size:0.8rem;">
              <option value="blue">蓝</option>
              <option value="red">红</option>
            </select>
            <select class="form-select" id="teamLane_${m.userId}" style="flex:1;padding:5px 8px;font-size:0.8rem;">
              <option value="">空位</option>
              <option value="对抗路">对抗路</option>
              <option value="打野">打野</option>
              <option value="中路">中路</option>
              <option value="发育路">发育路</option>
              <option value="游走">游走</option>
            </select>
            <input type="checkbox" checked id="teamLock_${m.userId}" style="width:16px;height:16px;cursor:pointer;" title="锁定此位置">
          </div>`;
      });
      listContainer.innerHTML = html;
    } else {
      section.style.display = 'none';
    }
  } catch {
    document.getElementById('teamRecruitSection').style.display = 'none';
  }
}

function toggleTeamRecruit() {
  const checked = document.getElementById('useTeamRecruit').checked;
  document.getElementById('teamMemberLanes').style.display = checked ? 'block' : 'none';
  const modeSection = document.getElementById('modeSelectorSection');
  modeSection.style.display = checked ? 'none' : 'block';
  if (checked) selectMode(1);
}

function closeCreateRecruitModal() {
  document.getElementById('createRecruitModal').style.display = 'none';
}

function setNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('recruitStartTime').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function selectMode(mode) {
  selectedRecruitMode = mode;
  document.querySelectorAll('.mode-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('mode' + mode + 'Option').classList.add('selected');
  document.getElementById('mode1Section').style.display = mode === 1 ? 'block' : 'none';
  document.getElementById('mode3Section').style.display = mode === 3 ? 'block' : 'none';
  // 模式2为纯组织者，系统自动建腾讯会议；模式1/3需填写群号
  const gcSection = document.getElementById('groupContactSection');
  if (gcSection) gcSection.style.display = mode === 2 ? 'none' : 'block';
}

function buildPresetPositions() {
  const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
  let blueHtml = '', redHtml = '';
  LANES.forEach(lane => {
    blueHtml += `<div class="preset-lane">
      <label>${lane}</label>
      <input type="text" id="preset-blue-${lane}" placeholder="选填">
      <span class="lock-icon">锁</span>
    </div>`;
    redHtml += `<div class="preset-lane">
      <label>${lane}</label>
      <input type="text" id="preset-red-${lane}" placeholder="选填">
      <span class="lock-icon">锁</span>
    </div>`;
  });
  document.getElementById('presetBlue').innerHTML = blueHtml;
  document.getElementById('presetRed').innerHTML = redHtml;

  // 点击输入框切换placeholder提示
  document.querySelectorAll('.preset-lane input').forEach(input => {
    input.addEventListener('focus', () => { input.placeholder = '输入队友的微信号'; });
    input.addEventListener('blur', () => { if (!input.value.trim()) { input.placeholder = '选填'; } });
  });
}

async function handleCreateRecruit(e) {
  e.preventDefault();
  const startTime = document.getElementById('recruitStartTime').value;
  const levelReq = document.getElementById('recruitLevelReq').value;
  const notes = document.getElementById('recruitNotes').value.trim();
  const useTeam = document.getElementById('useTeamRecruit').checked;
  const mode = selectedRecruitMode;

  if (!startTime) { showToast('请选择开赛时间','error'); return; }

  let positions = [];
  let teamId = null;

  // 带上队伍模式
  if (useTeam) {
    // 获取队伍信息
    try {
      const teamData = await api('/api/teams/mine', { skipCache: true });
      if (teamData && teamData.team) {
        teamId = teamData.team.id;
        teamData.team.members.forEach(m => {
          const lane = document.getElementById('teamLane_' + m.userId)?.value;
          const team = document.getElementById('teamLaneTeam_' + m.userId)?.value;
          const locked = document.getElementById('teamLock_' + m.userId)?.checked;
          if (lane && team) {
            positions.push({ team, lane, playerId: m.userId, locked: !!locked });
          }
        });
      }
    } catch {}
  } else if (mode === 1) {
    const team = document.getElementById('mode1Team').value;
    const lane = document.getElementById('mode1Lane').value;
    positions.push({ team, lane, playerId: currentUser.id });
  } else if (mode === 3) {
    const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
    ['blue', 'red'].forEach(team => {
      LANES.forEach(lane => {
        const input = document.getElementById(`preset-${team}-${lane}`);
        if (input && input.value.trim()) {
          positions.push({ team, lane, playerName: input.value.trim() });
        }
      });
    });
  }

  try {
    const groupContact = document.getElementById('recruitGroupContact').value.trim();
    const bodyData = { startTime, levelReq, notes, mode: useTeam ? 3 : mode, positions };
    if (teamId) bodyData.teamId = teamId;
    if (groupContact) bodyData.groupContact = groupContact;
    const data = await api('/api/recruitment', {
      method: 'POST',
      body: JSON.stringify(bodyData)
    });
    closeCreateRecruitModal();
    showToast('招募发布成功！','success');
    cacheStore.delete('/api/recruitment/active');
    cacheStore.delete('/api/recruitment/full');
    await loadRecruitHall();
    startRecruitPolling();
  } catch(err) { showToast(err.message,'error'); }
}

// ---------- 报名 / 撤销 ----------
async function joinLane(matchId, team, lane) {
  if (!currentUser) { showToast('请先登录','info'); openAuthModal('login'); return; }
  try {
    const data = await api(`/api/recruitment/${matchId}/join`, {
      method: 'POST',
      body: JSON.stringify({ team, lane })
    });
    if (data.isFull) {
      // 满员弹窗
      showFullModal();
      cacheStore.delete('/api/recruitment/active');
      cacheStore.delete('/api/recruitment/full');
    } else if (data.isConfirming) {
      // 进入确认阶段
      showToast('报名成功！等待全员确认...', 'info');
      cacheStore.delete('/api/recruitment/active');
      cacheStore.delete('/api/recruitment/full');
    } else {
      showToast('报名成功！','success');
    }
    await openMatchDetail(matchId);
  } catch(err) { showToast(err.message,'error'); }
}

async function leaveMatch(matchId) {
  if (!await dialog({ title: '撤销报名', body: '确定撤销报名吗？撤销后你的位置将空出。', confirmText: '确定撤销', cancelText: '保留', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/recruitment/${matchId}/leave`, { method: 'POST' });
    showToast('已撤销报名','info');
    cacheStore.delete('/api/recruitment/active');
    cacheStore.delete('/api/recruitment/full');
    await openMatchDetail(matchId);
  } catch(err) { showToast(err.message,'error'); }
}

// 确认能否参加（confirming 阶段）
async function confirmRecruitment(matchId, confirmed) {
  try {
    const data = await api(`/api/recruitment/${matchId}/confirm`, {
      method: 'PUT',
      body: JSON.stringify({ confirmed })
    });
    if (confirmed) {
      showToast('已确认，请准时参加！', 'success');
    } else {
      showToast('已退出本次训练赛', 'info');
    }
    cacheStore.delete('/api/recruitment/active');
    cacheStore.delete('/api/recruitment/full');
    await openMatchDetail(matchId);
  } catch(err) { showToast(err.message, 'error'); }
}

async function removePlayer(matchId, playerId) {
  if (!await dialog({ title: '清理占位', body: '确定清理该占位人员吗？', confirmText: '确定清理', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/recruitment/${matchId}/positions/${playerId}`, { method: 'DELETE' });
    showToast('已清理','info');
    await openMatchDetail(matchId);
  } catch(err) { showToast(err.message,'error'); }
}

// 创建腾讯会议（模式2组织者手动触发）
async function createMatchMeeting(matchId) {
  const btn = document.getElementById('createMeetingBtn');
  const msg = document.getElementById('createMeetingMsg');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
  if (msg) { msg.style.display = 'block'; msg.textContent = '正在创建腾讯会议，请稍候...'; }
  try {
    const data = await api(`/api/recruitment/${matchId}/meeting`, { method: 'POST', skipCache: true });
    showToast('腾讯会议创建成功！','success');
    await openMatchDetail(matchId); // 刷新显示
  } catch(err) {
    showToast(err.message || '建会失败','error');
    if (btn) { btn.disabled = false; btn.textContent = '重新创建腾讯会议'; }
    if (msg) { msg.textContent = '建会失败，请检查 tmeet 登录状态（运行 tmeet auth login）'; }
  }
}

// 编辑/填入腾讯会议信息
async function editMatchMeeting(matchId, currentCode, currentLink) {
  const code = await dialogPrompt({ title:'会议号', body:'请输入腾讯会议号', placeholder:'如：123456789', defaultValue: currentCode || '', confirmText:'下一步', cancelText:'取消' });
  if (code === null) return;
  const link = await dialogPrompt({ title:'入会链接', body:'请输入入会链接', placeholder:'https://meeting.tencent.com/dm/xxx', defaultValue: currentLink || '', confirmText:'保存', cancelText:'取消' });
  if (link === null) return;
  try {
    await api(`/api/recruitment/${matchId}/meeting`, { method:'PUT', body: JSON.stringify({ meetingCode: code, meetingLink: link }) });
    showToast('会议信息已保存','success');
    await openMatchDetail(matchId);
  } catch(err) { showToast(err.message || '保存失败','error'); }
}

// 一键复制群号
function copyGroupContact(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('群号 ' + text + ' 已复制！去QQ加群吧','success');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); showToast('群号已复制！去QQ加群吧','success'); } catch { showToast('请手动复制群号：' + text,'info'); }
  document.body.removeChild(ta);
}

async function cancelMatch(matchId, event) {
  if (event) event.stopPropagation();
  if (!await dialog({ title: '撤销招募', body: '确定撤销整场招募吗？此操作不可恢复，所有报名人员将被移除。', confirmText: '确定撤销', cancelText: '保留', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/recruitment/${matchId}`, { method: 'DELETE' });
    showToast('已撤销招募','info');
    cacheStore.delete('/api/recruitment/active');
    cacheStore.delete('/api/recruitment/full');
    await loadRecruitHall();
  } catch(err) { showToast(err.message,'error'); }
}

async function closeMatch(matchId, event) {
  if (event) event.stopPropagation();
  if (!await dialog({ title: '关闭报名', body: '确定关闭报名通道吗？关闭后其他人无法再报名。', confirmText: '确定关闭', cancelText: '保留' })) return;
  try {
    await api(`/api/recruitment/${matchId}/close`, { method: 'PUT' });
    showToast('已关闭报名','info');
    cacheStore.delete('/api/recruitment/active');
    cacheStore.delete('/api/recruitment/full');
    await loadRecruitHall();
  } catch(err) { showToast(err.message,'error'); }
}

function showFullModal() {
  document.getElementById('fullSuccessModal').style.display = 'flex';
}
function closeFullModal() {
  document.getElementById('fullSuccessModal').style.display = 'none';
}

// ---------- 实时刷新轮询 ----------
let isRecruitPolling = false;
function startRecruitPolling() {
  stopRecruitPolling();
  recruitPollingTimer = setInterval(async () => {
    if (currentTab !== 'recruit') { stopRecruitPolling(); return; }
    if (isRecruitPolling) return;
    isRecruitPolling = true;
    try {
      if (currentRecruitSubTab === 'active') {
        const data = await api('/api/recruitment/active', { skipCache: true });
        renderRecruitList(data.matches || []);
      }
    } catch {}
    isRecruitPolling = false;
  }, 8000);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRecruitPolling();
  else if (currentTab === 'recruit' && currentRecruitSubTab === 'active') startRecruitPolling();
});
function stopRecruitPolling() {
  if (recruitPollingTimer) { clearInterval(recruitPollingTimer); recruitPollingTimer = null; }
}

// ==================== 原有功能 ====================

// ---------- 公示榜 ----------
async function loadPublicSchedules() {
  const data = await api('/api/recruitment/completed');
  renderPublicSchedules(data.matches || []);
}
function renderPublicSchedules(matches) {
  const content = document.getElementById('tabContent');
  if (!matches.length) {
    content.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-state-icon" style="font-size:2.5rem;color:var(--text-muted);opacity:0.5;">无</div><p>暂无已结束的对局</p></div></div>';
    return;
  }
  const grouped = {};
  matches.forEach(m => {
    const date = m.startTime ? m.startTime.split('T')[0] : '未知日期';
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(m);
  });
  let html = '';
  Object.keys(grouped).sort().reverse().forEach(date => {
    html += `<div class="card">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>
        </div>
        <div><div class="section-title">${date}</div></div>
      </div>`;
    grouped[date].forEach(m => {
      const resultBadge = m.result === 'win'
        ? '<span style="background:rgba(0,200,83,0.15);color:#00C853;border:1px solid rgba(0,200,83,0.3);padding:2px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;">胜</span>'
        : '<span style="background:rgba(255,45,85,0.15);color:#FF2D55;border:1px solid rgba(255,45,85,0.3);padding:2px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;">负</span>';
      html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:16px; background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.2); margin-bottom:12px; border-radius:var(--radius-md);">
        <div>
          <strong style="font-size:1rem;">${m.organizerName || '未知'}</strong>
          <br><span class="badge badge-level" style="margin-top:6px;">${m.levelReq || ''}</span>
          <br><span style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;display:inline-block;">${m.startTime ? m.startTime.replace('T',' ') : ''} | 模式${m.mode || 1}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">${resultBadge}</div>
      </div>`;
    });
    html += '</div>';
  });
  content.innerHTML = html;
}

// ---------- 我的日程 ----------
async function loadCalendar(year, month, targetEl) {
  if (!year || !month) { const now = new Date(); year = now.getFullYear(); month = now.getMonth() + 1; }
  if (month > 12) { month = 1; year++; }
  if (month < 1) { month = 12; year--; }
  calendarYear = year; calendarMonth = month;
  // 如果传入了目标容器（个人中心场景），则渲染到该容器
  if (targetEl) {
    _calendarTargetEl = targetEl;
    const [data, historyData] = await Promise.all([
      api('/api/schedules/mine'),
      api('/api/users/me/history').catch(() => ({ history: [] }))
    ]);
    targetEl.innerHTML = renderCalendarHtml(year, month, data.schedules || [], data.disabledDates || [], historyData.history || []);
    return;
  }
  // 如果有遗留的渲染目标（个人中心日历翻页），使用该目标
  const target = _calendarTargetEl;
  _calendarTargetEl = null;
  const [data, historyData] = await Promise.all([
    api('/api/schedules/mine'),
    api('/api/users/me/history').catch(() => ({ history: [] }))
  ]);
  if (target) {
    target.innerHTML = renderCalendarHtml(year, month, data.schedules || [], data.disabledDates || [], historyData.history || []);
  } else {
    renderCalendar(data.schedules || [], data.disabledDates || [], historyData.history || []);
  }
}
function renderCalendar(schedules, disabledDates, history) {
  document.getElementById('tabContent').innerHTML = renderCalendarHtml(calendarYear, calendarMonth, schedules, disabledDates, history);
}
function renderCalendarHtml(year, month, schedules, disabledDates, history) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month-1, 1).getDay();
  const today = new Date().toISOString().split('T')[0];
  const map = {};
  schedules.forEach(s => { if (!map[s.date]) map[s.date] = []; map[s.date].push(s); });

  let html = `<div class="card"><div style="display:flex; justify-content:space-between; align-items:center;"><button class="btn btn-sm btn-outline" onclick="loadCalendar(${year}, ${month-1})">上月</button><h3>${year}年${month}月</h3><button class="btn btn-sm btn-outline" onclick="loadCalendar(${year}, ${month+1})">下月</button></div><div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:4px; text-align:center;">`;
  ['日','一','二','三','四','五','六'].forEach(d => html += `<div style="font-weight:600; padding:4px; color:var(--text-secondary);">${d}</div>`);
  for (let i = 0; i < firstDay; i++) html += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isDisabled = disabledDates.includes(dateStr);
    const daySchedules = map[dateStr] || [];
    html += `<div style="min-height:60px; padding:4px; background:${isDisabled ? 'rgba(255,255,255,0.05)' : '#1A1A2E'}; border-radius:6px; cursor:pointer;border:1px solid ${isDisabled ? 'rgba(255,255,255,0.08)' : 'rgba(22,93,255,0.25)'};" onclick="toggleDisableDate('${dateStr}')"><strong style="color:${isDisabled ? 'var(--text-muted)' : '#E5E7EB'}">${d}</strong>`;
    daySchedules.forEach(s => html += `<div style="font-size:0.65rem; background:var(--accent); color:#fff; padding:1px 4px; border-radius:4px; margin-top:2px;">${s.startTime} ${s.status==='confirmed' ? '已约' : ''}</div>`);
    html += '</div>';
  }
  html += '</div></div>';

  html += '<h3 style="margin-top:20px;">日程详情</h3>';
  schedules.forEach(s => {
    let actions = '';
    if (s.status === 'available' && s.isPublisher) {
      actions += '<div style="color:var(--text-secondary);margin-bottom:8px;"><strong style="color:var(--text-primary);">申请者：</strong>';
      if (s.applicants.length > 0) {
        s.applicants.forEach(app => actions += `<div style="color:var(--text-secondary);margin-top:4px;">${app.teamName} (${app.coachName}) <button class="btn btn-xs btn-primary" onclick="confirmApplicant('${s.id}', '${app.id}')">选择</button></div>`);
      } else actions += '<span style="color:var(--text-muted);">暂无</span>';
      actions += '</div>';
      actions += `<button class="btn btn-sm btn-danger" onclick="cancelPublishedSchedule('${s.id}')" style="margin-top:6px;">取消发布</button>`;
    }
    if (s.status === 'confirmed') {
      const partner = s.isPublisher ? s.opponent : s.publisher;
      actions += `<p style="color:var(--text-secondary);"><strong style="color:var(--text-primary);">对手：</strong>${partner.teamName} (${partner.coachName}) <span class="badge badge-confirmed">${partner.level}</span></p>`;
      if (s.isPublisher) {
        actions += `<button class="btn btn-sm btn-outline" onclick="unconfirmSchedule('${s.id}')">撤回选择</button>`;
        actions += `<button class="btn btn-sm btn-outline" onclick="togglePublic('${s.id}')">${s.isPublic ? '取消公示' : '设为公示'}</button>`;
      }
      actions += `<button class="btn btn-sm btn-outline" onclick="requestModify('${s.id}')">修改时间</button>`;
      actions += `<button class="btn btn-sm btn-outline" onclick="requestCancel('${s.id}')" style="color:var(--danger);border-color:var(--danger);">取消训练</button>`;
    }
    if (s.status === 'cancelled' && s.isPublisher) {
      actions += `<button class="btn btn-sm btn-primary" onclick="republishSchedule('${s.id}')">重新发布</button>`;
    }
    html += `<div class="card"><strong style="color:#fff;">${s.date} ${s.startTime}</strong> <span style="color:var(--text-secondary);">| ${s.mode.toUpperCase()} ${s.globalBp ? '全局BP' : ''}</span> <span class="badge badge-available">${s.status}</span><div style="margin-top:8px;">${actions}</div></div>`;
  });

  // 参赛历史
  html += '<h3 style="margin-top:24px;">参赛历史</h3>';
  if (history.length === 0) {
    html += '<p style="color:var(--text-muted);padding:16px;background:var(--bg-glass);border-radius:var(--radius-md);">暂无参赛记录</p>';
  } else {
    history.forEach(h => {
      const modeText = h.mode === 2 ? '模式2' : '模式1';
      const statusBadge = h.status === 'closed' ? '<span class="badge badge-closed">已结束</span>' : (h.locked ? '<span class="badge badge-confirmed">进行中</span>' : '<span class="badge badge-recruiting">招募中</span>');
      html += `<div class="card" style="border-left:3px solid var(--primary);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <strong style="color:#fff;">${h.startTime}</strong>
            <span style="color:var(--text-secondary);margin-left:8px;">${modeText} · ${h.team}队 · ${h.lane}</span>
            ${statusBadge}
          </div>
          <span style="font-size:0.78rem;color:var(--text-muted);">组织者：${h.organizerName}</span>
        </div>
        ${h.notes ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:6px;">备注：${h.notes}</div>` : ''}
      </div>`;
    });
  }
  return html;
}
async function cancelPublishedSchedule(id) {
  if (!await dialog({ title: '取消发布', body: '取消发布将删除该档期，如果已有申请者会收到通知，确定吗？', confirmText: '确定取消', cancelText: '保留', confirmBtnClass: 'btn-danger' })) return;
  try { await api(`/api/schedules/${id}/cancel-post`, { method:'DELETE' }); showToast('已取消发布','info'); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function confirmApplicant(scheduleId, applicantId) {
  const choice = await dialogChoices({ title: '选择确认方式', body: '是否公开这场训练赛？', choices: ['公开', '不公开'], confirmText: '取消' });
  if (choice === null) return;
  const isPublic = choice === '公开';
  try { await api(`/api/schedules/${scheduleId}/confirm-applicant`, { method:'PUT', body: JSON.stringify({ applicantId, isPublic }) }); showToast('已确认约队！','success'); checkNotifications(); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function unconfirmSchedule(id) {
  if (!await dialog({ title: '撤回选择', body: '撤回选择后档期将恢复可约状态，确定吗？', confirmText: '确定撤回', cancelText: '保留' })) return;
  try { await api(`/api/schedules/${id}/unconfirm`, { method:'PUT' }); showToast('已撤回','info'); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function togglePublic(id) {
  const data = await api(`/api/schedules/${id}/toggle-public`, { method:'PUT' });
  showToast(data.isPublic ? '已设为公示' : '已取消公示','info');
  await loadCalendar();
}
async function requestModify(id) {
  const times = ['14:00', '15:00', '16:00', '19:00', '20:00', '21:00'];
  const choice = await dialogChoices({ title: '修改时间', body: '请选择新的时间', choices: times });
  if (!choice) return;
  try { await api(`/api/schedules/${id}/modify-time`, { method:'PUT', body: JSON.stringify({ newTime: choice }) }); showToast('时间已修改','success'); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function requestCancel(id) {
  if (!await dialog({ title: '取消训练赛', body: '确定取消这场训练赛吗？', confirmText: '确定取消', cancelText: '保留', confirmBtnClass: 'btn-danger' })) return;
  try { await api(`/api/schedules/${id}/cancel`, { method:'POST' }); showToast('已取消','info'); checkNotifications(); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function republishSchedule(id) {
  if (!await dialog({ title: '重新发布', body: '重新发布到档期广场？', confirmText: '发布', cancelText: '取消' })) return;
  try { await api(`/api/schedules/${id}/republish`, { method:'POST' }); showToast('已重新发布','success'); await loadCalendar(); } catch(e) { showToast(e.message,'error'); }
}
async function toggleDisableDate(date) {
  if (!currentUser) return;
  const data = await api('/api/users/me/disabled-dates', { method:'PUT', body: JSON.stringify({ date }) });
  currentUser.disabledDates = data.disabledDates;
  loadCalendar(calendarYear, calendarMonth);
}

// ==================== 个人中心 ====================
let currentProfileTab = 'info'; // info | calendar | account
let _calendarTargetEl = null; // 个人中心日历渲染目标

async function renderProfileCenter() {
  const content = document.getElementById('tabContent');
  content.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="profile-center-tabs">
        <button class="profile-center-tab ${currentProfileTab === 'info' ? 'active' : ''}" data-ptab="info" onclick="switchProfileTab('info')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          个人信息
        </button>
        <button class="profile-center-tab ${currentProfileTab === 'calendar' ? 'active' : ''}" data-ptab="calendar" onclick="switchProfileTab('calendar')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          我的日程
        </button>
        <button class="profile-center-tab ${currentProfileTab === 'account' ? 'active' : ''}" data-ptab="account" onclick="switchProfileTab('account')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
          我的账户
        </button>
      </div>
      <div id="profileCenterContent" style="padding:20px;"><div class="loading-spinner"></div></div>
    </div>
  `;
  await loadProfileCenterTab();
}

async function switchProfileTab(tab) {
  currentProfileTab = tab;
  document.querySelectorAll('.profile-center-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.ptab === tab);
  });
  await loadProfileCenterTab();
}

async function loadProfileCenterTab() {
  const container = document.getElementById('profileCenterContent');
  if (currentProfileTab === 'info') {
    await renderProfileForm();
  } else if (currentProfileTab === 'calendar') {
    await loadCalendar(null, null, container);
  } else if (currentProfileTab === 'account') {
    await renderAccountPanel(container);
  }
}

// ---------- 个人信息 ----------
async function renderProfileForm() {
  const gameId = currentUser.gameId || '';
  const gameServer = currentUser.gameServer || '手Q区';
  const gameRank = currentUser.gameRank || '星耀';
  const peakScore = currentUser.peakScore || 0;
  const heroPool = currentUser.heroPool || '';
  const laneStats = currentUser.laneStats || { '对抗路':'0','打野':'0','中路':'0','发育路':'0','游走':'0' };

  let playerHtml = '';
  try {
    const pd = await api('/api/player/status');
    const p = pd.player;
    if (p && p.status === 'approved') {
      const salary = p.weekly_salary !== undefined ? p.weekly_salary.toLocaleString() + ' 梦币/周' : '-';
      const gCls = { S: 'grade-s', A: 'grade-a', B: 'grade-b', C: 'grade-c', D: 'grade-c' }[p.grade] || 'grade-c';
      playerHtml = `
        <div class="card" style="border-left:3px solid var(--success);margin-top:16px;">
          <div class="section-header" style="display:flex;align-items:center;gap:8px;">
            <div class="section-icon" style="background:var(--gradient-success);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
            </div>
            <div><div class="section-title">选手档案</div><div class="section-desc">你的认证信息与俱乐部归属</div></div>
          </div>
          <div class="player-detail-grid" style="margin-top:10px;">
            <div class="player-detail-item"><label>认证状态</label><span style="color:var(--success);">已通过</span></div>
            <div class="player-detail-item"><label>所属俱乐部</label><span>${p.club_name || '自由选手'}</span></div>
            <div class="player-detail-item"><label>身价</label><span style="color:var(--warning);">${p.market_value || '-'}万</span></div>
            <div class="player-detail-item"><label>等级</label><span class="grade-badge ${gCls}">${p.grade || '-'}</span></div>
            <div class="player-detail-item"><label>周薪</label><span style="color:var(--success);">${salary}</span></div>
            <div class="player-detail-item"><label>游戏ID</label><span>${p.game_id || '-'}</span></div>
          </div>
        </div>`;
    } else if (p && p.status === 'pending') {
      playerHtml = `<div class="card" style="border-left:3px solid var(--warning);margin-top:16px;"><p style="color:var(--warning);">选手认证审核中，请耐心等待管理员审核...</p></div>`;
    }
  } catch(e) {}

  const pcContent = document.getElementById('profileCenterContent');
  const target = pcContent || document.getElementById('tabContent');
  target.innerHTML = `
    <div class="card">
      <div class="section-header">
        <div class="section-icon">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
        </div>
        <div><div class="section-title">基本信息</div><div class="section-desc">管理你的账号和个人资料</div></div>
      </div>
      <form onsubmit="handleUpdateProfile(event)">
        <div class="form-group"><label>名称/游戏ID</label><input class="form-input" id="profileCoach" value="${currentUser.coachName||''}" placeholder="请输入"></div>
        <div class="form-group"><label>微信号</label><input class="form-input" id="profileWechat" value="${currentUser.wechat||''}" placeholder="请输入微信号"></div>
        <div class="form-group"><label>等级</label><select class="form-select" id="profileLevel"><option value="大众" ${currentUser.level==='大众'?'selected':''}>大众</option><option value="KPL" ${currentUser.level==='KPL'?'selected':''}>KPL</option><option value="K甲" ${currentUser.level==='K甲'?'selected':''}>K甲</option><option value="KPL青训" ${currentUser.level==='KPL青训'?'selected':''}>KPL青训</option><option value="K甲青训" ${currentUser.level==='K甲青训'?'selected':''}>K甲青训</option><option value="全国大赛" ${currentUser.level==='全国大赛'?'selected':''}>全国大赛</option><option value="主播" ${currentUser.level==='主播'?'selected':''}>主播</option></select></div>
        <div class="form-group"><label>队伍备注</label><textarea class="form-input" id="profileBio" rows="2" placeholder="介绍队伍实力">${currentUser.bio||''}</textarea></div>
        <button class="btn btn-primary" type="submit" style="width:100%;">保存基本信息</button>
      </form>
    </div>
    <div class="card" style="border-left:3px solid var(--secondary);">
      <div class="section-header">
        <div class="section-icon" style="background:var(--gradient-secondary);">
          <svg viewBox="0 0 24 24"><path d="M21 6h-2V4c0-1.1-.9-2-2-2H7C5.9 2 5 2.9 5 4v2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM7 4h10v2H7V4zm13 16H4V8h18v12z"/></svg>
        </div>
        <div><div class="section-title">游戏实力档案</div><div class="section-desc">展示你的游戏实力，方便队友了解你的水平</div></div>
      </div>
      <form onsubmit="handleUpdateGameProfile(event)">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="form-group"><label>王者荣耀游戏ID</label><input class="form-input" id="profileGameId" value="${gameId}" placeholder="如：手q123456"></div>
          <div class="form-group"><label>大区</label>
            <select class="form-select" id="profileGameServer">
              <option value="手Q区" ${gameServer==='手Q区'?'selected':''}>手Q区</option>
              <option value="微信区" ${gameServer==='微信区'?'selected':''}>微信区</option>
            </select>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="form-group"><label>当前段位</label>
            <select class="form-select" id="profileGameRank">
              <option value="青铜" ${gameRank==='青铜'?'selected':''}>青铜</option>
              <option value="白银" ${gameRank==='白银'?'selected':''}>白银</option>
              <option value="黄金" ${gameRank==='黄金'?'selected':''}>黄金</option>
              <option value="铂金" ${gameRank==='铂金'?'selected':''}>铂金</option>
              <option value="钻石" ${gameRank==='钻石'?'selected':''}>钻石</option>
              <option value="星耀" ${gameRank==='星耀'?'selected':''}>星耀</option>
              <option value="王者" ${gameRank==='王者'?'selected':''}>王者</option>
              <option value="荣耀王者" ${gameRank==='荣耀王者'?'selected':''}>荣耀王者</option>
              <option value="百星王者" ${gameRank==='百星王者'?'selected':''}>百星王者</option>
            </select>
          </div>
          <div class="form-group"><label>巅峰赛分数</label><input class="form-input" type="number" id="profilePeakScore" value="${peakScore}" placeholder="如：2200"></div>
        </div>
        <div class="form-group"><label>五大分路段位（选填）</label>
          <div class="lane-grid">
            ${['对抗路','打野','中路','发育路','游走'].map(lane => `
              <div class="lane-card">
                <div class="lane-label">${lane}</div>
                <input class="form-input lane-input" type="text" id="lane_${lane}" value="${typeof laneStats === 'object' ? (laneStats[lane] || '0') : '0'}" placeholder="段位">
              </div>`).join('')}
          </div>
        </div>
        <div class="form-group"><label>擅长英雄（选填）</label><input class="form-input" id="profileHeroPool" value="${heroPool}" placeholder="如：马可波罗、公孙离、大乔"></div>
        <button class="btn btn-primary" type="submit" style="width:100%;">保存游戏档案</button>
      </form>
    </div>
    ${playerHtml}`;
}
async function handleUpdateProfile(e) {
  e.preventDefault();
  const coach = document.getElementById('profileCoach').value.trim();
  const wechat = document.getElementById('profileWechat').value.trim();
  const level = document.getElementById('profileLevel').value;
  const bio = document.getElementById('profileBio').value.trim();
  await api('/api/users/me', { method:'PUT', body: JSON.stringify({ coachName: coach, wechat, level, bio }) });
  currentUser.coachName = coach; currentUser.wechat = wechat; currentUser.level = level; currentUser.bio = bio;
  updateUI();
  showToast('已更新','success');
}
async function handleUpdateGameProfile(e) {
  e.preventDefault();
  const gameId = document.getElementById('profileGameId').value.trim();
  const gameServer = document.getElementById('profileGameServer').value;
  const gameRank = document.getElementById('profileGameRank').value;
  const peakScore = parseInt(document.getElementById('profilePeakScore').value) || 0;
  const heroPool = document.getElementById('profileHeroPool').value.trim();
  const LANES = ['对抗路','打野','中路','发育路','游走'];
  const laneStats = {};
  LANES.forEach(l => { laneStats[l] = document.getElementById('lane_' + l).value.trim() || '0'; });
  try {
    await api('/api/users/me/profile', { method:'PUT', body: JSON.stringify({ gameId, gameServer, gameRank, peakScore, laneStats, heroPool }) });
    currentUser.gameId = gameId; currentUser.gameServer = gameServer; currentUser.gameRank = gameRank;
    currentUser.peakScore = peakScore; currentUser.heroPool = heroPool; currentUser.laneStats = laneStats;
    showToast('游戏档案已保存','success');
  } catch(err) { showToast(err.message,'error'); }
}

// ==================== 队伍系统 ====================

async function renderTeamPanel() {
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/teams/mine', { skipCache: true });
    renderMyTeam(data.team);
  } catch {
    content.innerHTML = '<div class="card"><p>加载失败</p><button class="btn btn-sm btn-primary" onclick="renderTeamPanel()">重试</button></div>';
  }
}

function renderMyTeam(team) {
  const content = document.getElementById('tabContent');
  if (!team) {
    // 无队伍：显示创建/加入
    content.innerHTML = `
      <div class="card" style="text-align:center; padding:40px 20px;">
        <div style="font-size:1.5rem;margin-bottom:16px;color:var(--text-muted);opacity:0.6;">队伍</div>
        <h3 style="margin-bottom:12px;">你还没有加入任何队伍</h3>
        <p style="color:var(--text-light);margin-bottom:24px;">队伍最多7人，凑齐后可代表整队参赛</p>
        <div style="display:flex;flex-direction:column;gap:12px;max-width:320px;margin:0 auto;">
          <button class="btn btn-primary" onclick="openCreateTeamModal()" style="padding:12px;font-size:1rem;">创建新队伍</button>
          <button class="btn btn-ghost" onclick="renderTeamList()" style="padding:12px;">浏览已有队伍</button>
        </div>
      </div>
      <div id="teamListContainer"></div>`;
    return;
  }

  const LANES = ['对抗路','打野','中路','发育路','游走'];
  const LANE_ICONS = { '对抗路':'对抗','打野':'打野','中路':'中路','发育路':'发育','游走':'游走' };
  const isCaptain = team.captainId === currentUser.id;

  let memberRows = '';
  team.members.forEach(m => {
    const isSelf = m.userId === currentUser.id;
    const roleBadge = m.role === 'captain' ? '<span class="badge badge-recruiting">队长</span>' : '<span class="badge badge-level">队员</span>';
    memberRows += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#1A1A2E;border:1px solid rgba(22,93,255,0.2);border-radius:var(--radius-md);margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div>
            <div style="font-weight:700;color:#fff;cursor:pointer;" onclick="${!isSelf ? `switchTab('profile'); setTimeout(()=>viewProfile('${m.userId}'),200)` : ''}">${m.coachName || m.username} ${isSelf ? '<span style="font-size:0.75rem;color:var(--text-muted);">（你）</span>' : ''}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">
              ${roleBadge}
              <span class="badge badge-level" style="margin-left:4px;">${m.level || ''}</span>
              ${m.gameRank ? `<span style="font-size:0.78rem;color:var(--text-muted);margin-left:4px;">段位：${m.gameRank}</span>` : ''}
              ${m.peakScore ? `<span style="font-size:0.78rem;color:var(--text-muted);margin-left:4px;">巅峰：${m.peakScore}</span>` : ''}
            </div>
            ${m.heroPool ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">擅长：${m.heroPool}</div>` : ''}
          </div>
        </div>
        ${isCaptain && !isSelf ? `<div style="display:flex;gap:6px;">
          <button class="btn btn-xs btn-ghost" onclick="kickMember('${team.id}','${m.userId}')">踢出</button>
          <button class="btn btn-xs btn-ghost" onclick="transferCaptain('${team.id}','${m.userId}')">设队长</button>
        </div>` : ''}
      </div>`;
  });

  const recruitBtn = isCaptain
    ? `<button class="btn btn-primary btn-sm" onclick="openCreateRecruitModal()">发布招募（带队伍）</button>`
    : '';
  const inviteBtn = isCaptain && team.memberCount < team.maxMembers
    ? `<button class="btn btn-sm btn-ghost" onclick="openInviteTeamModal('${team.id}')">邀请成员</button>`
    : '';

  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:1.2rem;margin-bottom:6px;">${team.name}</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span class="badge ${team.status==='open'?'badge-recruiting':'badge-closed'}">${team.status==='open'?'招人中':'已满'}</span>
            <span style="font-size:0.85rem;color:var(--text-light);">${team.memberCount} / ${team.maxMembers} 人</span>
            ${isCaptain ? '<span class="badge" style="background:rgba(22,93,255,0.18);color:var(--primary);border:1px solid rgba(22,93,255,0.35);">你是队长</span>' : ''}
          </div>
          ${team.bio ? `<p style="font-size:0.85rem;color:var(--text-light);margin-top:8px;">${team.bio}</p>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${recruitBtn}
          ${inviteBtn}
          ${isCaptain ? `<button class="btn btn-sm btn-ghost" onclick="openEditTeamModal()">编辑队伍</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="leaveTeam('${team.id}')">${isCaptain ? '解散队伍' : '退出队伍'}</button>
        </div>
      </div>
      <h4 style="margin-bottom:12px;">队员列表</h4>
      ${memberRows}
    </div>
    <div class="card">
      <h4 style="margin-bottom:12px;">浏览全部队伍</h4>
      <div id="allTeamsContainer"><button class="btn btn-ghost btn-sm" onclick="renderTeamList()" style="width:100%;">查看所有招募中的队伍</button></div>
    </div>`;
}

async function renderTeamList() {
  const container = document.getElementById('teamListContainer') || document.getElementById('allTeamsContainer');
  if (container) {
    container.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const data = await api('/api/teams', { skipCache: true });
      if (!data.teams.length) { container.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:20px;">暂无招募中的队伍</p>'; return; }
      let html = '';
      data.teams.forEach(t => {
        const captain = t.members.find(m => m.role === 'captain');
        html += `
          <div style="padding:14px;background:#1A1A2E;border:1px solid rgba(114,46,209,0.2);border-radius:var(--radius-md);margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>${t.name}</strong> ${t.bio ? `<span style="font-size:0.82rem;color:var(--text-light);"> · ${t.bio}</span>` : ''}
                <div style="font-size:0.78rem;color:var(--text-light);margin-top:4px;">
                  名称：${captain?.coachName || captain?.username || '未知'} | ${t.memberCount}/${t.maxMembers}人 | ${t.status==='open'?'招人中':'已满'}
                </div>
              </div>
              ${t.status === 'open' ? `<button class="btn btn-primary btn-sm" onclick="joinTeam('${t.id}')">申请加入</button>` : `<span class="badge badge-closed">已满</span>`}
            </div>
          </div>`;
      });
      container.innerHTML = html;
    } catch { container.innerHTML = '<p style="color:var(--text-light);">加载失败</p>'; }
  }
}

// 创建队伍弹窗
async function openCreateTeamModal() {
  const result = await dialogPrompt({ title: '创建新队伍', body: '请输入队伍名称', placeholder: '如：星河战队', defaultValue: '', confirmText: '创建', cancelText: '取消' });
  if (!result) return;
  const name = result.trim();
  if (!name) { showToast('请输入队伍名称','error'); return; }

  const bioResult = await dialogPrompt({ title: '队伍简介（选填）', body: '请输入队伍简介', placeholder: '如：巅峰2200，稳定训练赛', defaultValue: '', confirmText: '下一步', cancelText: '取消' });
  const bio = bioResult ? bioResult.trim() : '';

  try {
    await api('/api/teams', { method:'POST', body: JSON.stringify({ name, bio }) });
    showToast('队伍创建成功！','success');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}

// 邀请成员（仅队长）
async function openInviteTeamModal(teamId) {
  const result = await dialogPrompt({ title: '邀请成员', body: '请输入对方的用户名或名称', placeholder: '用户名/名称', defaultValue: '', confirmText: '发送邀请', cancelText: '取消' });
  if (!result || !result.trim()) return;
  try {
    await api(`/api/teams/${teamId}/invite`, { method:'POST', body: JSON.stringify({ username: result.trim() }) });
    showToast('邀请已发送！对方同意后即可加入','success');
    await renderTeamPanel();
  } catch(err) { showToast(err.message, 'error'); }
}

// 编辑队伍弹窗（仅队长）
async function openEditTeamModal() {
  const nameResult = await dialogPrompt({ title: '编辑队伍', body: '修改队伍名称', placeholder: '队伍名称', defaultValue: '', confirmText: '保存', cancelText: '取消' });
  if (nameResult === null) return;
  const name = nameResult.trim();
  const bioResult = await dialogPrompt({ title: '修改队伍简介', body: '修改队伍简介（选填）', placeholder: '队伍简介', defaultValue: '', confirmText: '保存', cancelText: '取消' });
  if (nameResult === null) return;

  try {
    const data = await api('/api/teams/mine', { skipCache: true });
    const team = data.team;
    await api(`/api/teams/${team.id}`, { method:'PUT', body: JSON.stringify({ name: name || undefined, bio: bioResult?.trim() || '' }) });
    showToast('已更新','success');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}

async function joinTeam(teamId) {
  if (!await dialog({ title: '申请加入', body: '确定申请加入该队伍吗？', confirmText: '申请加入', cancelText: '取消' })) return;
  try {
    await api(`/api/teams/${teamId}/join`, { method:'POST' });
    showToast('加入成功！','success');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}

async function leaveTeam(teamId) {
  const data = await api('/api/teams/mine', { skipCache: true });
  const team = data.team;
  const isCaptain = team && team.captainId === currentUser.id;
  const title = isCaptain ? '解散队伍' : '退出队伍';
  const body = isCaptain ? '确定解散整个队伍吗？此操作不可恢复。' : '确定退出该队伍吗？';
  if (!await dialog({ title, body, confirmText: '确定', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  try {
    if (isCaptain) {
      await api(`/api/teams/${teamId}`, { method:'DELETE' });
    } else {
      await api(`/api/teams/${teamId}/leave`, { method:'POST' });
    }
    showToast(isCaptain ? '队伍已解散' : '已退出队伍','info');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}

async function kickMember(teamId, userId) {
  if (!await dialog({ title: '踢出队员', body: '确定将此队员移出队伍吗？', confirmText: '踢出', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/teams/${teamId}/members/${userId}`, { method:'DELETE' });
    showToast('已移出','info');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}

async function transferCaptain(teamId, userId) {
  if (!await dialog({ title: '转让队长', body: '确定将队长权限转让给该队员吗？转让后你将成为普通队员。', confirmText: '确认转让', cancelText: '取消' })) return;
  try {
    await api(`/api/teams/${teamId}/transfer`, { method:'POST', body: JSON.stringify({ newCaptainId: userId }) });
    showToast('已转让队长权限','success');
    await renderTeamPanel();
  } catch(err) { showToast(err.message,'error'); }
}
let currentAdminSubTab = 'dashboard';

async function renderAdminPanel() {
  const content = document.getElementById('tabContent');
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:16px;">管理员面板</h3>
      <div class="recruit-tabs" style="margin-bottom:16px;">
        <button class="recruit-tab ${currentAdminSubTab==='dashboard'?'active':''}" onclick="switchAdminSubTab('dashboard')">仪表盘</button>
        <button class="recruit-tab ${currentAdminSubTab==='recruitments'?'active':''}" onclick="switchAdminSubTab('recruitments')">招募管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='schedules'?'active':''}" onclick="switchAdminSubTab('schedules')">档期管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='users'?'active':''}" onclick="switchAdminSubTab('users')">用户管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='teams'?'active':''}" onclick="switchAdminSubTab('teams')">队伍管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='logs'?'active':''}" onclick="switchAdminSubTab('logs')">操作日志</button>
        <button class="recruit-tab ${currentAdminSubTab==='security'?'active':''}" onclick="switchAdminSubTab('security')">权限安全</button>
        <button class="recruit-tab ${currentAdminSubTab==='players'?'active':''}" onclick="switchAdminSubTab('players')">选手审核</button>
        <button class="recruit-tab ${currentAdminSubTab==='clubs'?'active':''}" onclick="switchAdminSubTab('clubs')">俱乐部管理</button>
      </div>
      <div id="adminSubContent"><div class="loading-spinner"></div></div>
    </div>
  `;
  await loadAdminSubTab();
}

async function switchAdminSubTab(tab) {
  currentAdminSubTab = tab;
  document.querySelectorAll('.recruit-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.includes({
      dashboard: '仪表盘', recruitments: '招募管理', schedules: '档期管理',
      users: '用户管理', teams: '队伍管理', logs: '操作日志', security: '权限安全',
      players: '选手审核', clubs: '俱乐部管理'
    }[tab]));
  });
  document.getElementById('adminSubContent').innerHTML = '<div class="loading-spinner"></div>';
  await loadAdminSubTab();
}

async function loadAdminSubTab() {
  const container = document.getElementById('adminSubContent');
  try {
    switch (currentAdminSubTab) {
      case 'dashboard': await loadAdminDashboard(container); break;
      case 'recruitments': await loadAdminRecruitments(container); break;
      case 'schedules': await loadAdminSchedules(container); break;
      case 'users': await loadAdminUsers(container); break;
      case 'teams': await loadAdminTeams(container); break;
      case 'logs': await loadAdminLogs(container); break;
      case 'security': await loadAdminSecurity(container); break;
      case 'players': await loadAdminPlayers(container); break;
      case 'clubs': await loadAdminClubs(container); break;
    }
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);">加载失败：${err.message}</p>`;
  }
}

async function loadAdminTeams(container) {
  try {
    const [teamsData, usersData] = await Promise.all([
      api('/api/admin/teams'),
      api('/api/admin/users')
    ]);
    const teams = teamsData.teams || [];
    const users = usersData.users || [];
    const unassignedUsers = users.filter(u => !u.team);

    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <button class="btn btn-primary" onclick="adminCreateTeam()" style="padding:10px 20px;">新建队伍</button>
        <span style="float:right;font-size:0.82rem;color:var(--text-secondary);">共 ${teams.length} 支队伍 | ${unassignedUsers.length} 名用户暂无队伍</span>
      </div>
      ${teams.length === 0 ? '<p style="color:var(--text-light);text-align:center;padding:40px;">暂无队伍数据</p>' : ''}
      ${teams.map(t => buildAdminTeamCard(t, users, unassignedUsers)).join('')}
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);">加载失败：${err.message || '未知错误'}</p><button class="btn btn-sm btn-primary" onclick="loadAdminSubTab()">重试</button>`;
  }
}

function buildAdminTeamCard(t, users, unassignedUsers) {
  const captain = t.members.find(m => m.role === 'captain');
  const unassignedInTeam = unassignedUsers.slice(0, 3); // 预览未分配用户
  return `<div style="padding:16px;background:#1A1A2E;border:1px solid rgba(22,93,255,0.18);border-radius:var(--radius-lg);margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="flex:1;min-width:200px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <strong style="font-size:1.05rem;color:#fff;">${t.name}</strong>
          <span class="badge ${t.status==='open'?'badge-recruiting':'badge-closed'}">${t.status==='open'?'招人中':'已满'}</span>
          <span style="font-size:0.8rem;color:var(--text-secondary);">${t.memberCount}/${t.maxMembers}人</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:4px;">
          名称：<span style="color:var(--primary);">${captain?.coachName || captain?.username || '未设置'}</span>
          ${t.bio ? ` · ${t.bio}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-xs btn-ghost" onclick="adminRenameTeam('${t.id}','${t.name.replace(/'/g,"\\'")}')">改名</button>
        <button class="btn btn-xs btn-ghost" onclick="adminSetCaptain('${t.id}','${t.name.replace(/'/g,"\\'")}', '${captain?.userId||''}', ${JSON.stringify(t.members).replace(/"/g,'&quot;')})">换队长</button>
        <button class="btn btn-xs btn-ghost" onclick="adminAddMember('${t.id}','${t.name.replace(/'/g,"\\'")}')">加人</button>
        <button class="btn btn-xs btn-danger" onclick="adminDeleteTeam('${t.id}')">解散</button>
      </div>
    </div>
    ${t.members.length > 0 ? `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
      ${t.members.map(m => `
        <span style="font-size:0.78rem;background:rgba(22,93,255,0.12);color:${m.role==='captain'?'var(--primary)':'var(--text-primary)'};padding:4px 10px;border-radius:12px;border:1px solid rgba(22,93,255,${m.role==='captain'?'0.4':'0.2'});">
          ${m.coachName || m.username}${m.role==='captain'?' [队长]':''}
          <button onclick="adminRemoveMember('${t.id}','${m.userId}','${(m.coachName||m.username).replace(/'/g,"\\'")}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.7rem;padding:0 0 0 4px;" title="移出队伍">×</button>
        </span>`).join('')}
    </div>` : '<p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">暂无成员</p>'}
    ${t.status === 'open' && unassignedUsers.length > 0 ? `
    <div style="font-size:0.72rem;color:var(--text-muted);">还可以<a href="javascript:void(0)" onclick="adminAddMember('${t.id}','${t.name.replace(/'/g,"\\'")}')" style="color:var(--primary);">添加成员</a> · 当前有 ${unassignedUsers.length} 名用户暂无队伍</div>` : ''}
  </div>`;
}

async function adminCreateTeam() {
  const name = await dialogPrompt({ title:'新建队伍', body:'请输入队伍名称', placeholder:'如：星河战队', defaultValue:'', confirmText:'创建', cancelText:'取消' });
  if (!name || !name.trim()) return;
  const bio = await dialogPrompt({ title:'队伍简介（选填）', body:'请输入队伍简介', placeholder:'如：巅峰2200，稳定训练赛', defaultValue:'', confirmText:'下一步', cancelText:'跳过' });
  const maxMembers = await dialogPrompt({ title:'最大人数（默认7）', body:'请输入队伍最大人数', placeholder:'7', defaultValue:'7', confirmText:'创建', cancelText:'取消' });
  if (maxMembers === null) return;
  try {
    await api('/api/admin/teams', { method:'POST', body: JSON.stringify({ name: name.trim(), bio: bio?.trim()||'', maxMembers: parseInt(maxMembers)||7, captainId: currentUser.id }) });
    showToast('队伍创建成功','success');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function adminRenameTeam(teamId, currentName) {
  const name = await dialogPrompt({ title:'修改队名', body:'请输入新队名', placeholder:'队伍名称', defaultValue:currentName, confirmText:'保存', cancelText:'取消' });
  if (!name || !name.trim() || name.trim() === currentName) return;
  try {
    await api(`/api/admin/teams/${teamId}`, { method:'PUT', body: JSON.stringify({ name: name.trim() }) });
    showToast('队名已修改','success');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function adminSetCaptain(teamId, teamName, currentCaptainId, members) {
  if (!members || members.length === 0) { showToast('该队伍暂无成员，无法设置队长','error'); return; }
  const options = members.map(m => `${m.userId}:${m.coachName||m.username}`).join('\n');
  const selected = await dialogPrompt({ title:`换队长（${teamName}）`, body:`当前队长ID: ${currentCaptainId}\n可选成员：\n${options}\n\n请输入新队长用户ID：`, placeholder:'输入用户ID', defaultValue:currentCaptainId||'', confirmText:'确认', cancelText:'取消' });
  if (!selected || selected === currentCaptainId) return;
  try {
    await api(`/api/admin/teams/${teamId}`, { method:'PUT', body: JSON.stringify({ captainId: selected }) });
    showToast('队长已更换','success');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function adminAddMember(teamId, teamName) {
  const users = (await api('/api/admin/users')).users || [];
  const unassigned = users.filter(u => !u.team || u.team.teamId !== teamId);
  if (unassigned.length === 0) { showToast('所有用户都已在某支队伍中','info'); return; }
  const options = unassigned.slice(0,20).map(u => `${u.id}:${u.coachName||u.username}(${u.gameRank||'未填'})`).join(',');
  const selected = await dialogPrompt({ title:`添加成员（${teamName}）`, body:`共 ${unassigned.length} 名可选用户\n请输入用户ID：`, placeholder:'输入用户ID', defaultValue:'', confirmText:'添加', cancelText:'取消' });
  if (!selected) return;
  try {
    await api(`/api/admin/teams/${teamId}/members`, { method:'POST', body: JSON.stringify({ userId: selected }) });
    showToast('成员已添加','success');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function adminRemoveMember(teamId, userId, userName) {
  if (!await dialog({ title:'移出成员', body:`确定将「${userName}」移出该队伍？`, confirmText:'移出', cancelText:'取消', confirmBtnClass:'btn-danger' })) return;
  try {
    await api(`/api/admin/teams/${teamId}/members/${userId}`, { method:'DELETE' });
    showToast('已移出','info');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function adminDeleteTeam(teamId) {
  if (!await dialog({ title: '解散队伍', body: '确定解散该队伍吗？该队伍所有成员将被移出。', confirmText: '解散', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  try {
    await api(`/api/admin/teams/${teamId}`, { method:'DELETE' });
    showToast('队伍已解散','info');
    await loadAdminTeams(document.getElementById('adminSubContent'));
  } catch(err) { showToast(err.message,'error'); }
}

async function loadAdminDashboard(container) {
  const data = await api('/api/admin/dashboard');
  const s = data.stats;
  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-value">${s.totalUsers}</div>
        <div class="stat-label">总用户数</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-value">${s.totalSchedules}</div>
        <div class="stat-label">总档期数</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-value">${s.totalRecruitments}</div>
        <div class="stat-label">总招募数</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${s.activeRecruitments}</div>
        <div class="stat-label">招募中</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${s.fullRecruitments}</div>
        <div class="stat-label">已满对局</div>
      </div>
      <div class="stat-card red">
        <div class="stat-value">${s.totalTeams || 0}</div>
        <div class="stat-label">队伍总数</div>
      </div>
    </div>
  `;
}

async function loadAdminRecruitments(container) {
  const data = await api('/api/admin/recruitments');
  if (!data.recruitments || data.recruitments.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">暂无招募数据</p>';
    return;
  }
  let html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  html += '<tr style="background:rgba(22,93,255,0.10);"><th style="padding:8px;text-align:left;color:var(--text-primary);">时间</th><th>发起人</th><th>模式</th><th>状态</th><th>人数</th><th>操作</th></tr>';
  data.recruitments.forEach(r => {
    const statusBadge = r.status==='full' ? '<span class="badge badge-full">已满</span>' : r.status==='closed' ? '<span class="badge badge-closed">已关闭</span>' : '<span class="badge badge-recruiting">招募中</span>';
    html += `<tr style="border-bottom:1px solid var(--border-color);">
      <td style="padding:8px;color:var(--text-primary);">${r.startTime}</td>
      <td style="padding:8px;color:var(--text-primary);">${r.organizer.teamName}</td>
      <td style="padding:8px;color:var(--text-secondary);">模式${r.mode}</td>
      <td style="padding:8px;">${statusBadge}</td>
      <td style="padding:8px;color:var(--text-secondary);">${r.totalCount}/10</td>
      <td style="padding:8px;"><button class="btn btn-xs btn-danger" onclick="adminDeleteRecruitment('${r.id}')">删除</button></td>
    </tr>`;
  });
  html += '</table></div>';
  container.innerHTML = html;
}

async function loadAdminSchedules(container) {
  const data = await api('/api/admin/schedules');
  if (!data.schedules || data.schedules.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">暂无档期数据</p>';
    return;
  }
  let html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  html += '<tr style="background:rgba(22,93,255,0.10);"><th style="padding:8px;text-align:left;color:var(--text-primary);">日期</th><th>时间</th><th>模式</th><th>状态</th><th>操作</th></tr>';
  data.schedules.forEach(s => {
    html += `<tr style="border-bottom:1px solid var(--border-color);">
      <td style="padding:8px;color:var(--text-primary);">${s.date}</td>
      <td style="padding:8px;color:var(--text-secondary);">${s.starttime}</td>
      <td style="padding:8px;color:var(--text-secondary);">${s.mode.toUpperCase()}</td>
      <td style="padding:8px;">${s.status}</td>
      <td style="padding:8px;"><button class="btn btn-xs btn-danger" onclick="adminDeleteSchedule('${s.id}')">删除</button></td>
    </tr>`;
  });
  html += '</table></div>';
  container.innerHTML = html;
}

// 管理员用户名片总览
let adminUsersFilter = { level:'', gameServer:'', gameRank:'', search:'', heroPool:'', teamId:'all', minPeak:'', maxPeak:'', peakSort:'' };

async function loadAdminUsers(container) {
  const [usersData, optsData, teamsData] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/users/options'),
    api('/api/admin/teams')
  ]);
  const users = usersData.users || [];
  const opts = optsData;
  const teams = teamsData.teams || [];

  const filterBar = `
    <div style="background:#1A1A2E;border:1px solid rgba(22,93,255,0.15);border-radius:var(--radius-md);padding:14px;margin-bottom:16px;">
      <div style="font-size:0.82rem;font-weight:600;color:var(--primary);margin-bottom:10px;">筛选名片</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">等级</label>
          <select id="af_level" class="form-select" style="font-size:0.8rem;padding:6px 8px;" onchange="afSet('level',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <option value="">全部</option>
            ${opts.levels.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">服务器</label>
          <select id="af_server" class="form-select" style="font-size:0.8rem;padding:6px 8px;" onchange="afSet('gameServer',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <option value="">全部</option>
            ${opts.servers.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">段位</label>
          <select id="af_rank" class="form-select" style="font-size:0.8rem;padding:6px 8px;" onchange="afSet('gameRank',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <option value="">全部</option>
            ${opts.ranks.map(r => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">队伍</label>
          <select id="af_team" class="form-select" style="font-size:0.8rem;padding:6px 8px;" onchange="afSet('teamId',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <option value="all">全部</option>
            <option value="none">未入队</option>
            ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">巅峰分</label>
          <div style="display:flex;gap:4px;align-items:center;">
            <input type="number" id="af_minPeak" placeholder="最低" style="width:48px;padding:6px 4px;font-size:0.78rem;" onchange="afSet('minPeak',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <span style="color:var(--text-muted);font-size:0.7rem;">~</span>
            <input type="number" id="af_maxPeak" placeholder="最高" style="width:48px;padding:6px 4px;font-size:0.78rem;" onchange="afSet('maxPeak',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
            <select id="af_peakSort" style="padding:6px 4px;font-size:0.72rem;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);" onchange="afSet('peakSort',this.value);loadAdminUsers(document.getElementById('adminSubContent'))">
              <option value="">默认</option>
              <option value="desc">高→低</option>
              <option value="asc">低→高</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">搜索</label>
          <input type="text" id="af_search" placeholder="姓名/游戏ID" style="width:100%;padding:6px 8px;font-size:0.78rem;" oninput="afSet('search',this.value)" onkeydown="if(event.key==='Enter'){afSet('search',this.value);loadAdminUsers(document.getElementById('adminSubContent'))}">
        </div>
        <div>
          <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:3px;">擅长英雄</label>
          <input type="text" id="af_hero" placeholder="关键词" style="width:100%;padding:6px 8px;font-size:0.78rem;" onkeydown="if(event.key==='Enter'){afSet('heroPool',this.value);loadAdminUsers(document.getElementById('adminSubContent'))}">
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button class="btn btn-xs btn-ghost" onclick="adminClearFilters()" style="font-size:0.75rem;">重置筛选</button>
        <button class="btn btn-xs btn-ghost" onclick="afSet('heroPool',document.getElementById('af_hero').value);loadAdminUsers(document.getElementById('adminSubContent'))" style="font-size:0.75rem;">搜索英雄</button>
      </div>
    </div>`;

  // 用筛选条件构造查询参数
  const params = new URLSearchParams();
  if (adminUsersFilter.level) params.set('level', adminUsersFilter.level);
  if (adminUsersFilter.gameServer) params.set('gameServer', adminUsersFilter.gameServer);
  if (adminUsersFilter.gameRank) params.set('gameRank', adminUsersFilter.gameRank);
  if (adminUsersFilter.search) params.set('search', adminUsersFilter.search);
  if (adminUsersFilter.heroPool) params.set('heroPool', adminUsersFilter.heroPool);
  if (adminUsersFilter.teamId && adminUsersFilter.teamId !== 'all') params.set('teamId', adminUsersFilter.teamId);
  if (adminUsersFilter.minPeak) params.set('minPeak', adminUsersFilter.minPeak);
  if (adminUsersFilter.maxPeak) params.set('maxPeak', adminUsersFilter.maxPeak);
  if (adminUsersFilter.peakSort) params.set('peakSort', adminUsersFilter.peakSort);

  const filteredData = params.toString() ? await api(`/api/admin/users?${params.toString()}`) : usersData;
  const filtered = filteredData.users || [];
  const total = filteredData.total || filtered.length;

  // 恢复筛选器状态
  setTimeout(() => {
    if (adminUsersFilter.level) document.getElementById('af_level').value = adminUsersFilter.level;
    if (adminUsersFilter.gameServer) document.getElementById('af_server').value = adminUsersFilter.gameServer;
    if (adminUsersFilter.gameRank) document.getElementById('af_rank').value = adminUsersFilter.gameRank;
    if (adminUsersFilter.teamId) document.getElementById('af_team').value = adminUsersFilter.teamId;
    if (adminUsersFilter.search) document.getElementById('af_search').value = adminUsersFilter.search;
    if (adminUsersFilter.minPeak) document.getElementById('af_minPeak').value = adminUsersFilter.minPeak;
    if (adminUsersFilter.maxPeak) document.getElementById('af_maxPeak').value = adminUsersFilter.maxPeak;
    if (document.getElementById('af_peakSort')) document.getElementById('af_peakSort').value = adminUsersFilter.peakSort || '';
  }, 0);

  const levelColors = { '王者': '#FFD700', '星耀': '#9B59B6', '钻石': '#3498DB', '大师': '#E74C3C', '宗师': '#FF6B35' };
  let tableRows = '';
  filtered.forEach(u => {
    const levelColor = levelColors[u.level] || 'var(--text-secondary)';
    const teamBadge = u.team
      ? `<span style="font-size:0.72rem;background:rgba(22,93,255,0.12);color:var(--primary);padding:2px 6px;border-radius:8px;">${u.team.role==='captain'?'[队长] ':''}${u.team.teamName}</span>`
      : `<span style="font-size:0.72rem;background:rgba(245,158,11,0.12);color:var(--warning);padding:2px 6px;border-radius:8px;">未入队</span>`;
    tableRows += `<tr style="border-bottom:1px solid var(--border-color);">
      <td style="padding:10px 8px;color:var(--text-primary);vertical-align:top;">
        <div style="font-weight:600;">${u.coachName || u.username}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">@${u.username}</div>
        ${u.wechat ? `<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">微信：${u.wechat}</div>` : ''}
      </td>
      <td style="padding:10px 8px;vertical-align:top;">${teamBadge}</td>
      <td style="padding:10px 8px;vertical-align:top;"><span style="font-size:0.82rem;color:${levelColor};font-weight:600;">${u.level || '未填'}</span></td>
      <td style="padding:10px 8px;font-size:0.78rem;color:var(--text-secondary);vertical-align:top;">
        <div>${u.gameId || '<span style="color:var(--text-muted);">未填</span>'}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">${u.gameServer || '手Q区'}</div>
      </td>
      <td style="padding:10px 8px;font-size:0.78rem;color:var(--text-secondary);vertical-align:top;">
        <div>${u.gameRank || '未填'}</div>
        ${u.peakScore ? `<div style="font-size:0.72rem;color:var(--primary);">巅峰：${u.peakScore}</div>` : ''}
      </td>
      <td style="padding:10px 8px;font-size:0.78rem;color:var(--text-secondary);vertical-align:top;max-width:120px;">
        ${u.heroPool ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${u.heroPool}">${u.heroPool}</div>` : '<span style="color:var(--text-muted);">—</span>'}
      </td>
      <td style="padding:10px 8px;vertical-align:top;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="btn btn-xs btn-ghost" onclick="adminAssignUserTeam('${u.id}','${(u.coachName||u.username).replace(/'/g,"\\'")}')" style="font-size:0.72rem;padding:4px 8px;">分配队伍</button>
          <button class="btn btn-xs btn-danger" onclick="adminDeleteUser('${u.id}')" style="font-size:0.72rem;padding:4px 8px;">删除</button>
        </div>
      </td>
    </tr>`;
  });

  container.innerHTML = filterBar + `
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:10px;">共 <strong style="color:var(--primary);">${total}</strong> 名用户${params.toString() ? '（已筛选）' : ''}</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:700px;">
        <tr style="background:rgba(22,93,255,0.10);">
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">用户/名称</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">队伍</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">等级</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">游戏ID</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">段位/巅峰</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">擅长英雄</th>
          <th style="padding:10px 8px;text-align:left;color:var(--text-primary);">操作</th>
        </tr>
        ${tableRows || `<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--text-muted);">暂无匹配用户</td></tr>`}
      </table>
    </div>`;
}

function afSet(key, val) { adminUsersFilter[key] = val; }

function adminClearFilters() {
  adminUsersFilter = { level:'', gameServer:'', gameRank:'', search:'', heroPool:'', teamId:'all', minPeak:'', maxPeak:'', peakSort:'' };
  loadAdminUsers(document.getElementById('adminSubContent'));
}

async function adminAssignUserTeam(userId, userName) {
  const teams = (await api('/api/admin/teams')).teams || [];
  if (teams.length === 0) { showToast('暂无队伍，请先创建队伍', 'warning'); return; }
  const teamOptions = teams.map((t, i) => `${i + 1}. ${t.name} (ID: ${t.id})`).join('\n');
  const selected = await dialogPrompt({
    title: `🏆 分配队伍`,
    body: `为「${userName}」选择队伍\n\n${teamOptions}\n\n请输入队伍ID：`,
    placeholder: '粘贴上方队伍ID',
    defaultValue: '',
    confirmText: '分配',
    cancelText: '取消'
  });
  if (!selected) return;
  const teamId = selected.trim();
  const team = teams.find(t => t.id === teamId);
  if (!team) { showToast('无效的队伍ID，请从列表中复制', 'error'); return; }
  try {
    await api(`/api/admin/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
    showToast(`${userName} 已分配至「${team.name}」`, 'success');
    await loadAdminUsers(document.getElementById('adminSubContent'));
  } catch (err) { showToast(err.message, 'error'); }
}

async function loadAdminLogs(container) {
  const data = await api('/api/admin/logs');
  if (!data.logs || data.logs.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">暂无日志数据</p>';
    return;
  }
  let html = '<div style="max-height:400px;overflow-y:auto;">';
  data.logs.forEach(l => {
    const typeColors = { new_apply: '#4a90d9', confirmed: '#27ae60', cancelled: '#e74c3c', schedule_cancelled: '#f0a030' };
    html += `<div style="padding:8px 12px;border-bottom:1px solid var(--border-color);font-size:0.82rem;">
      <span style="color:${typeColors[l.type]||'var(--text-muted)'};font-weight:600;">[${l.type}]</span>
      <span style="color:var(--text-secondary);margin-left:8px;">${l.content}</span>
      <span style="color:var(--text-muted);float:right;">${new Date(l.createdAt).toLocaleString()}</span>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

async function loadAdminSecurity(container) {
  const data = await api('/api/admin/security');
  container.innerHTML = `
    <div style="background:#1A1A2E;padding:16px;border-radius:var(--radius-lg);margin-bottom:16px;border:1px solid rgba(22,93,255,0.18);">
      <h4 style="margin-bottom:12px;color:var(--text-primary);">安全状态</h4>
      <p style="color:var(--text-secondary);"><strong style="color:var(--text-primary);">管理员ID：</strong>${data.adminUserId}</p>
      <p style="color:var(--text-secondary);"><strong style="color:var(--text-primary);">总用户数：</strong>${data.totalUsers}</p>
      <p style="color:var(--text-secondary);"><strong style="color:var(--text-primary);">管理员账户存在：</strong>${data.hasAdmin ? '是' : '否'}</p>
    </div>
    <div style="background:rgba(22,93,255,0.08);padding:16px;border-radius:var(--radius-lg);border-left:4px solid var(--accent);">
      <h4 style="margin-bottom:12px;color:var(--text-primary);">安全建议</h4>
      <ul style="padding-left:20px;line-height:2;color:var(--text-secondary);">
        ${data.tips.map(t => `<li>${t}</li>`).join('')}
      </ul>
    </div>
  `;
}

// 管理员 - 选手审核
async function loadAdminPlayers(container) {
  const data = await api('/api/admin/players');
  const players = data.players || [];
  if (!players.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">暂无选手认证申请</p>';
    return;
  }
  const pending = players.filter(p => p.status === 'pending');
  const approved = players.filter(p => p.status === 'approved');
  const rejected = players.filter(p => p.status === 'rejected');

  // 截图缓存：user_id → { screenshot_url, screenshot_url2 }
  window._reviewScreenshots = window._reviewScreenshots || {};

  function playerCard(p) {
    let positions = [];
    try { positions = JSON.parse(p.positions || '[]'); } catch(e) {}
    const ss = window._reviewScreenshots[p.user_id];
    // 截图区域：已有缓存显示缩略图，pending 且无缓存显示加载中，approved/rejected 无缓存只显示标签
    let screenshotHtml = '';
    if (ss) {
      const shots = [];
      if (ss.screenshot_url) shots.push({ url: ss.screenshot_url, label: '巅峰分截图' });
      if (ss.screenshot_url2) shots.push({ url: ss.screenshot_url2, label: '段位截图' });
      screenshotHtml = shots.length ? `
        <div class="review-screenshots">
          ${shots.map(s => `
            <div class="review-screenshot-wrap">
              <img src="${s.url}" class="review-screenshot-thumb" onclick="openImagePreview('${s.url}')" alt="${s.label}">
              <div class="review-screenshot-label">${s.label}</div>
            </div>
          `).join('')}
        </div>
      ` : '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">未提交截图</div>';
    } else if (p.status === 'pending') {
      screenshotHtml = '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">加载截图中...</div>';
    } else {
      screenshotHtml = p.has_screenshots
        ? '<div style="font-size:0.7rem;color:var(--text-secondary);margin-top:4px;">有截图（展开查看）</div>'
        : '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">未提交截图</div>';
    }

    return `
    <div style="padding:12px 16px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;color:var(--text-primary);">${p.game_id} <span style="font-size:0.72rem;color:var(--text-muted);">(${p.coachname || p.username})</span></div>
          <div style="font-size:0.78rem;color:var(--text-secondary);">巅峰${p.peak_score} | ${p.game_rank}</div>
          <div style="margin-top:4px;">${positions.map(l => `<span class="pos-tag pos-tag-${l}">${l}</span>`).join(' ')}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">身价预估：${p.market_value}万 | ${new Date(p.created_at).toLocaleDateString('zh-CN')}</div>
          <div class="review-screenshots-wrap" data-userid="${p.user_id}" data-status="${p.status}">
            ${screenshotHtml}
          </div>
        </div>
        <div style="white-space:nowrap;">
          ${p.status === 'pending' ? `
            <button class="btn btn-sm" style="background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.3);" onclick="reviewPlayer('${p.user_id}','approved')">通过</button>
            <button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.3);margin-left:4px;" onclick="reviewPlayer('${p.user_id}','rejected')">拒绝</button>
          ` : `<span style="color:${p.status==='approved'?'var(--success)':'var(--danger)'}">${p.status==='approved'?'已通过':'已拒绝'}</span>`}
        </div>
      </div>
    </div>`;
  }

  let html = '';

  // 待审核（置顶展开）
  if (pending.length > 0) {
    html += `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:0.85rem;font-weight:700;color:var(--warning);">待审核</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">${pending.length} 条</span>
      </div>
      ${pending.map(p => playerCard(p)).join('')}
    `;
  }

  // 已通过（折叠）
  if (approved.length > 0) {
    html += `
      <div style="margin-top:16px;">
        <div onclick="toggleReviewSection(this,'approved-list',[${approved.map(p => `'${p.user_id}'`).join(',')}])" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.15);border-radius:8px;cursor:pointer;user-select:none;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.85rem;font-weight:700;color:var(--success);">已通过</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${approved.length} 条</span>
          </div>
          <svg class="review-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--text-muted);transition:transform .2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div id="approved-list" style="display:none;margin-top:8px;">
          ${approved.map(p => playerCard(p)).join('')}
        </div>
      </div>
    `;
  }

  // 已拒绝（折叠）
  if (rejected.length > 0) {
    html += `
      <div style="margin-top:12px;">
        <div onclick="toggleReviewSection(this,'rejected-list',[${rejected.map(p => `'${p.user_id}'`).join(',')}])" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:8px;cursor:pointer;user-select:none;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.85rem;font-weight:700;color:var(--danger);">已拒绝</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${rejected.length} 条</span>
          </div>
          <svg class="review-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--text-muted);transition:transform .2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div id="rejected-list" style="display:none;margin-top:8px;">
          ${rejected.map(p => playerCard(p)).join('')}
        </div>
      </div>
    `;
  }

  if (!pending.length && !approved.length && !rejected.length) {
    html = '<p style="color:var(--text-muted);">暂无选手认证申请</p>';
  }

  container.innerHTML = html;

  // 待审核：自动加载截图
  if (pending.length > 0) {
    loadReviewScreenshots(pending.map(p => p.user_id));
  }
}

// 批量加载选手截图
async function loadReviewScreenshots(userIds) {
  const needLoad = userIds.filter(id => !window._reviewScreenshots[id]);
  if (needLoad.length === 0) return;
  try {
    const data = await api('/api/admin/player-screenshots?ids=' + needLoad.join(','));
    (data.screenshots || []).forEach(s => {
      window._reviewScreenshots[s.user_id] = s;
    });
  } catch(e) {}
  // 刷新DOM中的截图区域
  document.querySelectorAll('.review-screenshots-wrap').forEach(el => {
    const uid = el.dataset.userid;
    const ss = window._reviewScreenshots[uid];
    if (!ss) return;
    const shots = [];
    if (ss.screenshot_url) shots.push({ url: ss.screenshot_url, label: '巅峰分截图' });
    if (ss.screenshot_url2) shots.push({ url: ss.screenshot_url2, label: '段位截图' });
    el.innerHTML = shots.length ? `
      <div class="review-screenshots">
        ${shots.map(s => `
          <div class="review-screenshot-wrap">
            <img src="${s.url}" class="review-screenshot-thumb" onclick="openImagePreview('${s.url}')" alt="${s.label}">
            <div class="review-screenshot-label">${s.label}</div>
          </div>
        `).join('')}
      </div>
    ` : '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">未提交截图</div>';
  });
}

function toggleReviewSection(header, listId, userIds) {
  const list = document.getElementById(listId);
  const icon = header.querySelector('.review-toggle-icon');
  if (list.style.display === 'none') {
    list.style.display = 'block';
    icon.style.transform = 'rotate(180deg)';
    // 展开时加载截图
    if (userIds && userIds.length > 0) {
      loadReviewScreenshots(userIds);
    }
  } else {
    list.style.display = 'none';
    icon.style.transform = 'rotate(0deg)';
  }
}

async function reviewPlayer(userId, status) {
  try {
    await api('/api/admin/player-review', { method:'POST', body: JSON.stringify({ userId, status }) });
    showToast(status === 'approved' ? '已通过审核' : '已拒绝', 'success');
    // 清除截图缓存，下次加载时重新获取
    delete window._reviewScreenshots[userId];
    await loadAdminSubTab();
  } catch(e) { showToast(e.message, 'error'); }
}

// 管理员 - 俱乐部管理
async function loadAdminClubs(container) {
  const clubsData = await api('/api/clubs');
  const clubs = clubsData.clubs || [];
  if (!clubs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">暂无俱乐部</p><button class="btn btn-primary btn-sm" onclick="openCreateClubModal()" style="margin-top:8px;">创建俱乐部</button>';
    return;
  }
  container.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="openCreateClubModal()" style="margin-bottom:12px;">创建俱乐部</button>
    ${clubs.map(c => `
      <div class="club-card" onclick="renderClubDetail(${c.id})" style="cursor:pointer;">
        <div>
          <span style="font-weight:600;color:var(--text-primary);">${c.name}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">${c.member_count || 0}名队员</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-secondary);">老板：${c.owner_name || c.owner_username || c.owner_id}</div>
      </div>
    `).join('')}
  `;
}

async function adminDeleteSchedule(id) {
  if (!await dialog({ title: '管理员操作', body: '确定强制删除此档期？', confirmText: '删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  await api(`/api/admin/schedules/${id}`, { method:'DELETE' });
  showToast('已删除','info');
  loadAdminSubTab();
}

async function adminDeleteRecruitment(id) {
  if (!await dialog({ title: '管理员操作', body: '确定强制删除此招募？所有报名人员将被移除。', confirmText: '删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  await api(`/api/admin/recruitments/${id}`, { method:'DELETE' });
  showToast('已删除','info');
  loadAdminSubTab();
}

async function adminDeleteUser(id) {
  if (!await dialog({ title: '管理员操作', body: '确定删除此用户？该用户的所有数据将被移除。', confirmText: '删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  await api(`/api/admin/users/${id}`, { method:'DELETE' });
  showToast('已删除','info');
  loadAdminSubTab();
}

// 图片预览弹窗
function openImagePreview(url) {
  let overlay = document.getElementById('imagePreviewModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imagePreviewModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:95vw;max-height:95vh;">
        <img id="imagePreviewImg" src="" alt="截图预览" style="max-width:90vw;max-height:80vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);object-fit:contain;">
        <button class="btn btn-sm" onclick="closeImagePreview()" style="margin-top:16px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);">关闭预览</button>
      </div>
    `;
    overlay.onclick = function(e) {
      if (e.target === overlay) closeImagePreview();
    };
    document.body.appendChild(overlay);
  }
  document.getElementById('imagePreviewImg').src = url;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeImagePreview() {
  const overlay = document.getElementById('imagePreviewModal');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

// ---------- 使用说明 ----------
function openGuideModal() {
  document.getElementById('guideModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeGuideModal() {
  document.getElementById('guideModal').style.display = 'none';
  document.body.style.overflow = '';
}

// 工具函数 ----------
function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`; t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function dialog(options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        ${options.title ? `<div class="dialog-title">${options.title}</div>` : ''}
        ${options.body ? `<div class="dialog-body">${options.body}</div>` : ''}
        <div class="dialog-actions">
          ${options.cancelText ? `<button class="btn btn-ghost" id="dialogCancel">${options.cancelText}</button>` : ''}
          ${options.confirmText ? `<button class="btn ${options.confirmBtnClass||'btn-primary'}" id="dialogConfirm">${options.confirmText}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    document.getElementById('dialogCancel')?.addEventListener('click', () => close(false));
    document.getElementById('dialogConfirm')?.addEventListener('click', () => close(true));
  });
}

function dialogPrompt(options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        ${options.title ? `<div class="dialog-title">${options.title}</div>` : ''}
        ${options.body ? `<div class="dialog-body">${options.body}</div>` : ''}
        <input class="dialog-input" id="dialogInput" value="${options.defaultValue || ''}" placeholder="${options.placeholder || ''}" style="margin-bottom:16px;">
        <div class="dialog-actions">
          <button class="btn btn-ghost" id="dialogCancel">${options.cancelText || '取消'}</button>
          <button class="btn btn-primary" id="dialogConfirm">${options.confirmText || '确定'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = document.getElementById('dialogInput');
    input?.focus();
    const close = (result) => { document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    document.getElementById('dialogCancel')?.addEventListener('click', () => close(null));
    document.getElementById('dialogConfirm')?.addEventListener('click', () => close(input?.value || null));
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') close(input?.value || null); });
  });
}

function dialogChoices(options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const choicesHtml = options.choices.map((c, i) => `<button class="btn btn-ghost" data-idx="${i}" style="margin-bottom:8px;width:100%;justify-content:center;">${c}</button>`).join('');
    overlay.innerHTML = `
      <div class="dialog">
        ${options.title ? `<div class="dialog-title">${options.title}</div>` : ''}
        ${options.body ? `<div class="dialog-body">${options.body}</div>` : ''}
        <div id="dialogChoices">${choicesHtml}</div>
        <div class="dialog-actions" style="margin-top:12px;">
          <button class="btn btn-ghost" id="dialogCancel">${options.cancelText || '取消'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    options.choices.forEach((_, i) => {
      document.querySelector(`[data-idx="${i}"]`)?.addEventListener('click', () => close(options.choices[i]));
    });
    document.getElementById('dialogCancel')?.addEventListener('click', () => close(null));
  });
}

function closeModal() { switchTab(currentTab); }

// ==================== 欢迎引导弹窗 ====================
function showWelcome() {
  if (localStorage.getItem('welcome_seen') === '1') return;
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  modal.style.display = 'flex';
  localStorage.setItem('welcome_seen', '1');
  // 防御：3s后再确认一次（移动端有时渲染延迟）
  setTimeout(() => {
    if (modal.style.display !== 'flex') modal.style.display = 'flex';
  }, 200);
}
function closeWelcome() {
  const modal = document.getElementById('welcomeModal');
  if (modal) modal.remove();
}
function closeWelcomeAndLogin() {
  const modal = document.getElementById('welcomeModal');
  if (modal) modal.remove();
  openAuthModal('login');
}

// 启动
(async () => {
  updateUI();
  switchTab('recruit');
  if (authToken) fetchUserInfo();
  setTimeout(showWelcome, 800);
})();
