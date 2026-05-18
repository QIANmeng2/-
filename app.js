const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';
let currentUser = null;
let authToken = localStorage.getItem('local_current_user') || null;
let currentTab = 'square';
let authMode = 'login';
let unreadNotifs = 0;
let currentMatchId = null;

const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];
const LANE_ICONS = { '对抗路': '对抗', '打野': '打野', '中路': '中路', '发育路': '发育', '游走': '游走' };

// ====== 安全工具 ======
/**
 * HTML 转义（防止 XSS）
 * 将用户输入或不可信数据插入 innerHTML 前必须调用此函数
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

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
      if (data && data.token) { authToken = data.token; localStorage.setItem('local_current_user', authToken); currentUser = data.user; closeAuthModal(); updateUI(); switchTab('competition'); showToast('注册成功！','success'); }
    } catch (e) { showToast(e.message,'error'); }
  } else {
    try {
      const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ username, password }) });
      if (data && data.token) { authToken = data.token; localStorage.setItem('local_current_user', authToken); currentUser = data.user; closeAuthModal(); updateUI(); switchTab('competition'); showToast('登录成功！','success'); }
    } catch (e) { showToast(e.message,'error'); }
  }
}
function logout() {
  authToken = null; localStorage.removeItem('local_current_user'); currentUser = null; cacheStore.clear();
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
    // 显示梦币余额
    const dreamCoins = currentUser.dream_coins || 0;
    let coinDisplay = document.getElementById('displayDreamCoins');
    if (!coinDisplay) {
      // 首次创建梦币显示元素
      const sep = document.createElement('span');
      sep.className = 'user-sep';
      sep.style.color = 'var(--text-muted)';
      sep.style.margin = '0 8px';
      sep.textContent = '|';
      ui('displayTeam').parentNode.insertBefore(sep, ui('displayTeam').nextSibling);
      
      coinDisplay = document.createElement('span');
      coinDisplay.id = 'displayDreamCoins';
      coinDisplay.style.cssText = 'color:var(--gradient-gold-stop3, #FFD700);font-weight:700;margin-left:8px;cursor:pointer;';
      coinDisplay.title = '点击查看账户明细';
      coinDisplay.onclick = () => { switchTab('profile'); setTimeout(() => { if (typeof switchProfileTab === 'function') switchProfileTab('account'); }, 200); };
      sep.parentNode.insertBefore(coinDisplay, sep.nextSibling);
    }
    coinDisplay.textContent = '🪙 ' + dreamCoins.toLocaleString();
    document.querySelectorAll('#tabNav .tab-btn[data-tab="publish"], #tabNav .tab-btn[data-tab="team"], #tabNav .tab-btn[data-tab="profile"], #tabNav .tab-btn[data-tab="market"], #tabNav .tab-btn[data-tab="club"]').forEach(b => b.style.display = '');
    ui('notificationBell').style.display = 'flex';
    if (currentUser.id === 'mp4hmya7ad15v6') { ui('tabAdmin').style.display = ''; }
    ui('tabCompetition').style.display = '';
  } else {
    ui('userInfoDisplay').style.display = 'none';
    ui('btnLoginTop').style.display = 'inline-block';
    ui('btnLogoutTop').style.display = 'none';
    document.querySelectorAll('#tabNav .tab-btn[data-tab="publish"], #tabNav .tab-btn[data-tab="team"], #tabNav .tab-btn[data-tab="profile"], #tabNav .tab-btn[data-tab="admin"], #tabNav .tab-btn[data-tab="market"], #tabNav .tab-btn[data-tab="club"]').forEach(b => b.style.display = 'none');
    ui('tabCompetition').style.display = '';
    ui('notificationBell').style.display = 'none';
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
}

// ==================== 比赛页面（三级联赛） ====================
let compTier = 'regular';
const TIER_CONFIG = {
  elite: { label: '顶级联赛', desc: 'S/A级俱乐部大名单参赛' },
  secondary: { label: '次级联赛', desc: 'B级俱乐部大名单参赛' },
  regular: { label: '常规赛事', desc: '消耗梦币入场，10人对战，赢方瓜分奖池' }
};

async function renderCompetitionPanel() {
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  const content = document.getElementById('tabContent');
  const tc = TIER_CONFIG[compTier];
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div>
          <h2 style="font-size:1.1rem;margin:0;">${tc.label}</h2>
          <p style="font-size:0.78rem;color:var(--text-muted);margin:4px 0 0;">${tc.desc}</p>
        </div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" onclick="openCreateCompetitionModal()">+ 创建赛事</button>' : ''}
      </div>
      <div class="comp-tier-tabs" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
        ${['elite','secondary','regular'].map(t => {
          const cfg = TIER_CONFIG[t];
          return '<button class="comp-tier-tab '+(compTier===t?'active-'+t:'')+'" onclick="switchCompTier(\''+t+'\')">'+cfg.label+'</button>';
        }).join('')}
      </div>
      <div id="competitionList"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
    </div>`;
  await loadCompetitionList();
}
async function switchCompTier(t) { compTier = t; await renderCompetitionPanel(); }

async function loadCompetitionList() {
  const container = document.getElementById('competitionList');
  try {
    const data = await api('/api/competitions');
    const all = data.competitions || [];
    window._compCache = {};
    all.forEach(c => { window._compCache[c.id] = c; });
    const comps = all.filter(c => (c.tier || 'regular') === compTier);
    if (!comps.length) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">暂无'+TIER_CONFIG[compTier].label+'，请管理员创建</p>';
      return;
    }
    const isRegular = compTier === 'regular';
    container.innerHTML = comps.map(c => {
      const rs = c.reg_stats || {};
      const s = c.comp_status || c.status || '';
      const statusLabel = { upcoming:'即将开始', open:'报名中', locked:'已满员', live:'比赛中', review:'审核中', finished:'已结束' }[s] || '';
      const statusColor = { upcoming:'var(--text-muted)', open:'#10b981', locked:'var(--warning)', live:'var(--danger)' }[s] || 'var(--text-muted)';
      const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
      const adminBtn = isAdmin ? '<button class="btn btn-xs btn-danger" style="margin-left:8px;" onclick="event.stopPropagation();adminDeleteCompetition(\''+c.id+'\')">删除</button>' : '';
      // 常规赛事卡片
      if (isRegular) {
        return '<div style="padding:14px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;cursor:pointer;" onclick="openCompetitionDetail(\''+c.id+'\')">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">'+
            '<div><span style="font-weight:700;color:var(--text-primary);font-size:0.95rem;">'+c.name+'</span><span style="color:'+statusColor+';font-size:0.72rem;margin-left:8px;font-weight:600;">'+statusLabel+'</span>'+adminBtn+'</div>'+
            '<span style="font-size:0.75rem;color:var(--text-muted);">'+(c.start_time?new Date(c.start_time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'')+'</span>'+
          '</div>'+
          '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;">'+
            '<span style="font-size:0.78rem;color:var(--text-secondary);">👥 '+rs.count+'/10人</span>'+
            (rs.prizePool>0?'<span style="font-size:0.78rem;color:var(--warning);">💰 '+rs.prizePool+'梦币</span>':'')+
            '<span style="font-size:0.72rem;color:var(--text-muted);">500×'+(rs.fee500||0)+' | 1000×'+(rs.fee1000||0)+' | 2000×'+(rs.fee2000||0)+'</span>'+
          '</div></div>';
      }
      // 顶级/次级联赛卡片（简洁版）
      return '<div style="padding:14px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;cursor:pointer;" onclick="openCompetitionDetail(\''+c.id+'\')">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">'+
          '<div><span style="font-weight:700;color:var(--text-primary);">'+c.name+'</span>'+
          '<span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">BO'+(c.bo||1)+'</span>'+adminBtn+'</div>'+
          '<span style="font-size:0.72rem;color:var(--text-muted);">'+(c.start_time?new Date(c.start_time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit'}):'')+'</span>'+
        '</div></div>';
    }).join('');
  } catch(e) { container.innerHTML = '<p style="color:var(--danger);">加载失败</p>'; }
}

// 赛事详情（所有人可见，显示参赛人员+操作区）
async function openCompetitionDetail(id) {
  const c = window._compCache[id];
  if (!c) return;
  const isRegular = (c.tier || 'regular') === 'regular';
  const rs = c.reg_stats || {};
  const overlay = document.createElement('div');
  overlay.className = 'comp-detail-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const s = c.comp_status || c.status || '';
  const statusLabel = { upcoming:'即将开始', open:'报名中', locked:'已满员', live:'比赛中', review:'审核中', finished:'已结束' }[s] || '';
  const tierLabel = TIER_CONFIG[c.tier||'regular']?.label || '';
  const st = c.start_time ? new Date(c.start_time).toLocaleString('zh-CN') : '待定';

  let infoHtml = '';
  if (isRegular) {
    infoHtml =
      '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">状态</span><div style="font-weight:700;color:#fff;">'+statusLabel+'</div></div>'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">已报名</span><div style="font-weight:700;color:#fff;">'+rs.count+'/10</div></div>'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">总奖池</span><div style="font-weight:700;color:var(--warning);">'+(rs.prizePool||0)+'梦币</div></div>'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">500&times;'+(rs.fee500||0)+'</span></div>'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">1000&times;'+(rs.fee1000||0)+'</span></div>'+
        '<div><span style="color:var(--text-muted);font-size:0.72rem;">2000&times;'+(rs.fee2000||0)+'</span></div>'+
      '</div>';
  } else {
    infoHtml =
      '<div style="padding:12px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:16px;">'+
        '<p style="color:var(--text-muted);font-size:0.82rem;">'+(c.description || tierLabel+'由俱乐部大名单选手参赛，请联系管理员安排赛程。')+'</p>'+
        (c.qr_code_url?'<div style="margin-top:8px;"><img src="'+c.qr_code_url+'" style="max-width:260px;border-radius:8px;"></div>':'')+
      '</div>';
  }

  overlay.innerHTML = '<div class="comp-detail-panel" onclick="event.stopPropagation()" style="padding:20px 24px 24px;">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'+
      '<h3 style="font-size:1.05rem;margin:0;">'+c.name+' <span style="font-size:0.72rem;color:var(--text-muted);">'+tierLabel+' &middot; BO'+(c.bo||1)+'</span></h3>'+
      '<button class="btn btn-sm btn-ghost" onclick="this.closest(\'.comp-detail-overlay\').remove()">关闭</button>'+
    '</div>'+
    '<div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:12px;">开赛时间：'+st+'</div>'+
    infoHtml +
    '<div id="compPlayerList" style="margin-bottom:16px;"><div style="color:var(--text-muted);font-size:0.78rem;">加载参赛人员...</div></div>'+
    '<div id="compRegActions"></div>'+
  '</div>';
  document.body.appendChild(overlay);

  await loadCompPlayerList(id, isRegular);
  if (isRegular) await loadCompRegUI(id, c);
}

// 加载赛事参赛人员列表（所有人可见）
async function loadCompPlayerList(compId, isRegular) {
  const container = document.getElementById('compPlayerList');
  if (!container) return;
  try {
    const data = await api('/api/competitions/'+compId+'/registrations');
    const regs = data.registrations || [];
    if (!regs.length) {
      container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border-radius:8px;color:var(--text-muted);font-size:0.82rem;text-align:center;">暂无参赛人员</div>';
      return;
    }
    // 按红蓝方分组，按报名顺序排列
    const redRegs = regs.filter(r => r.side === 'red').sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''));
    const blueRegs = regs.filter(r => r.side === 'blue').sort((a,b) => (a.created_at||'').localeCompare(b.created_at||''));
    const renderSide = (sideRegs, sideLabel, sideColor) => {
      if (!sideRegs.length) return '';
      const confirmedCount = sideRegs.filter(r => r.status === 'confirmed').length;
      return '<div style="margin-bottom:12px;">'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+
          '<span style="font-size:0.78rem;font-weight:700;color:'+sideColor+';">'+sideLabel+'</span>'+
          '<span style="font-size:0.7rem;color:var(--text-muted);">'+confirmedCount+'/5 已确认</span>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">'+
        sideRegs.map(r => {
          const name = r.coachname || r.username || r.player_user_id;
          return '<div style="padding:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;">'+
            '<div style="font-size:0.82rem;color:var(--text-primary);font-weight:600;">'+name+'</div>'+
            '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">'+(isRegular && r.entry_fee ? r.entry_fee+'梦币入场' : '')+'</div>'+
            '<div style="margin-top:4px;">'+statusBadge(r)+'</div>'+
          '</div>';
        }).join('')+
        '</div></div>';
    };
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">参赛人员</div>'+
      renderSide(redRegs, '红方', '#ef4444') +
      renderSide(blueRegs, '蓝方', '#3b82f6');
  } catch(e) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;">参赛人员加载失败</div>';
  }
}

// 创建赛事弹窗（支持三级联赛，动态字段）
function openCreateCompetitionModal() {
  const existing = document.getElementById('createCompModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'createCompModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-sm">
      <h3 style="margin-bottom:16px;">创建赛事</h3>
      <form onsubmit="handleCreateCompetition(event)">
        <div class="form-group"><label>赛事名称 *</label>
          <input class="form-input" type="text" id="compName" required placeholder="如：5月18日黄金赛">
        </div>
        <div class="form-group"><label>赛事等级</label>
          <select class="form-select" id="compTierSel" onchange="toggleCompExtraFields()">
            <option value="regular">常规赛事（梦币入场+奖池）</option>
            <option value="elite">顶级联赛（S/A级俱乐部大名单）</option>
            <option value="secondary">次级联赛（B级俱乐部大名单）</option>
          </select>
        </div>
        <div class="form-group"><label>开赛时间</label>
          <input class="form-input" type="datetime-local" id="compStartTime">
        </div>
        <div class="form-group"><label>BO几</label>
          <select class="form-select" id="compBo">
            <option value="1">BO1</option><option value="3">BO3</option><option value="5">BO5</option>
          </select>
        </div>
        <div id="compExtraFields" style="display:none;">
          <div class="form-group"><label>赛事描述</label>
            <textarea class="form-input" id="compDesc" rows="3" placeholder="填写赛事规则、奖励说明等..."></textarea>
          </div>
          <div class="form-group"><label>赛事图片（QR码/宣传图）</label>
            <input class="form-input" type="file" id="compImage" accept="image/*">
            <div id="compImgPreview" style="display:none;margin-top:8px;"><img style="max-width:200px;border-radius:8px;" src=""></div>
          </div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;">
          <button class="btn btn-primary" type="submit">创建</button>
          <button class="btn btn-ghost" type="button" onclick="this.closest('#createCompModal').remove()">取消</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  // 图片预览
  setTimeout(() => {
    const input = document.getElementById('compImage');
    if (input) input.addEventListener('change', () => {
      const file = input.files[0];
      const preview = document.getElementById('compImgPreview');
      if (!file) { preview.style.display = 'none'; return; }
      const r = new FileReader();
      r.onload = (e) => { preview.querySelector('img').src = e.target.result; preview.style.display = 'block'; };
      r.readAsDataURL(file);
    });
  }, 50);
}

function toggleCompExtraFields() {
  const tier = document.getElementById('compTierSel').value;
  const extra = document.getElementById('compExtraFields');
  if (extra) extra.style.display = tier === 'regular' ? 'none' : 'block';
}

async function handleCreateCompetition(e) {
  e.preventDefault();
  const name = document.getElementById('compName').value.trim();
  const tier = document.getElementById('compTierSel').value;
  const start_time = document.getElementById('compStartTime').value;
  const bo = parseInt(document.getElementById('compBo').value);
  const description = (document.getElementById('compDesc')?.value || '').trim();
  if (!name) { showToast('请输入赛事名称','error'); return; }
  let qr_code_url = null;
  const file = document.getElementById('compImage')?.files?.[0];
  if (file && tier !== 'regular') {
    try {
      qr_code_url = await compressImageToBase64(file, 800, 0.6);
    } catch(err) { showToast('图片处理失败','error'); return; }
  }
  try {
    await api('/api/admin/competitions', { method:'POST', body: JSON.stringify({ name, tier, start_time: start_time || null, bo, description, qr_code_url }) });
    showToast('赛事已创建','success');
    document.getElementById('createCompModal')?.remove();
    loadCompetitionList();
  } catch(err) { showToast(err.message,'error'); }
}

// 图片压缩辅助（复用认证逻辑）
function compressImageToBase64(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const img = new Image();
    const r = new FileReader();
    r.onload = (ev) => { img.src = ev.target.result; };
    r.onerror = () => reject(new Error('读取图片失败'));
    r.readAsDataURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('加载图片失败'));
  });
}

// ==================== 赛事报名交互 ====================

// 入场券玩法说明弹窗
function showEntryFeeRulesThen(callback) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = '<div class="modal modal-sm" style="max-width:420px;">'+
    '<h3 style="margin-bottom:12px;font-size:1rem;">入场券玩法说明</h3>'+
    '<div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.7;">'+
      '<p style="margin:0 0 8px 0;"><strong style="color:var(--warning);">1.</strong> 入场费分三档：<span style="color:#10b981;font-weight:600;">500</span> / <span style="color:#f59e0b;font-weight:600;">1000</span> / <span style="color:#ef4444;font-weight:600;">2000</span> 梦币</p>'+
      '<p style="margin:0 0 8px 0;"><strong style="color:var(--warning);">2.</strong> 赛事需<strong>10人</strong>（红蓝双方各5人）全部确认入场后开赛</p>'+
      '<p style="margin:0 0 8px 0;"><strong style="color:var(--warning);">3.</strong> 总奖池 = 10人总入场费之和</p>'+
      '<p style="margin:0 0 8px 0;"><strong style="color:var(--warning);">4.</strong> 胜方按各自入场费占比瓜分奖池（入场费越高，分得越多）</p>'+
      '<p style="margin:0;color:var(--text-muted);font-size:0.75rem;">例：A投入2000，B投入500，总奖池2500。若A获胜，A分得奖池的2000/2500=80%</p>'+
    '</div>'+
    '<div style="margin-top:16px;display:flex;gap:8px;">'+
      '<button class="btn btn-primary btn-sm" id="entryFeeConfirmBtn" style="flex:1;">我已了解，继续报名</button>'+
      '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.modal-overlay\').remove()" style="flex:1;">返回</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(overlay);
  document.getElementById('entryFeeConfirmBtn').onclick = () => {
    overlay.remove();
    if (typeof callback === 'function') callback();
  };
}

async function loadCompRegUI(compId, c) {
  const container = document.getElementById('compRegActions');
  if (!container) return;
  if (!currentUser) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.03);border-radius:8px;color:var(--text-muted);font-size:0.82rem;text-align:center;">登录后可报名参赛</div>';
    return;
  }
  const canRegister = c.comp_status === 'open' || c.comp_status === 'upcoming';
  const statusMap = { upcoming:'即将开始', open:'报名中', locked:'已满员', live:'比赛中', review:'审核中', finished:'已结束' };
  const statusCN = statusMap[c.comp_status || c.status] || '未知';
  // 已报名状态
  let myReg = null;
  try {
    const data = await api('/api/competitions/'+compId+'/my-reg');
    const allRegs = data.registrations || [];
    myReg = allRegs.find(r => r.player_user_id === currentUser.id);
  } catch(e) {}
  if (myReg && myReg.status === 'confirmed') {
    container.innerHTML = '<div style="padding:12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;"><span style="color:#10b981;font-weight:600;">已确认入场</span><span style="color:var(--text-muted);margin-left:8px;font-size:0.78rem;">入场费：'+(myReg.entry_fee||0)+'梦币</span></div>';
    return;
  } else if (myReg && myReg.status === 'reserved') {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.2);border-radius:8px;"><span style="color:var(--warning);font-weight:600;">待确认入场</span><div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-sm" style="background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.3);color:#10b981;" onclick="confirmCompetitionEntry(\''+compId+'\',500)">500梦币</button><button class="btn btn-sm" style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);color:#f59e0b;" onclick="confirmCompetitionEntry(\''+compId+'\',1000)">1000梦币</button><button class="btn btn-sm" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#ef4444;" onclick="confirmCompetitionEntry(\''+compId+'\',2000)">2000梦币</button></div></div>';
    return;
  }
  if (!canRegister) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;color:var(--text-muted);font-size:0.82rem;">当前赛事状态为 <b style="color:var(--text-primary);">'+statusCN+'</b>，不可报名（仅"即将开始"和"报名中"可报名）</div>';
    return;
  }
  // 两入口选择（点击后先弹出入场券说明）
  container.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;">'+
    '<button class="btn btn-primary btn-sm" onclick="showEntryFeeRulesThen(()=>loadTeamRegisterFlow(\''+compId+'\'))" style="flex:1;min-width:120px;">以队伍报名</button>'+
    '<button class="btn btn-ghost btn-sm" onclick="showEntryFeeRulesThen(()=>loadClubRegisterFlow(\''+compId+'\'))" style="flex:1;min-width:120px;border-color:rgba(245,158,11,.3);color:#f59e0b;">以俱乐部报名</button>'+
    '</div>';
}

// 队伍报名流程（点击后展示）
async function loadTeamRegisterFlow(compId) {
  const container = document.getElementById('compRegActions');
  if (!container) return;
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  let myTeam = null;
  try { const td = await api('/api/teams/mine'); myTeam = (td.data || {}).team || td.team; } catch(e) {}
  const isCaptain = myTeam && myTeam.captainId === currentUser.id;

  if (!myTeam && isAdmin) {
    loadAdminTeamPicker(compId);
    return;
  }
  if (!myTeam) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">您尚未加入任何队伍，需由队长操作报名</p><button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button></div>';
    return;
  }
  if (!isCaptain) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">您不是队长，等待队长 <b style="color:var(--text-primary);">（队伍：'+myTeam.name+'）</b> 操作报名</p><button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button></div>';
    return;
  }
  if (myTeam.memberCount < 5 && !isAdmin) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">队伍 <b style="color:var(--text-primary);">'+myTeam.name+'</b> 人数不足5人（当前'+myTeam.memberCount+'人），无法报名</p><button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button></div>';
    return;
  }
  // 条件满足：选择队员
  container.innerHTML = '<button class="btn btn-primary btn-sm" onclick="openTeamPlayerSelect(\''+compId+'\',\''+myTeam.id+'\',\''+myTeam.name.replace(/'/g,"\\'")+'\')">选择队员报名参赛</button>'+
    '<button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])" style="margin-left:8px;">← 返回选择</button>';
}

// 俱乐部报名流程（点击后展示）
async function loadClubRegisterFlow(compId) {
  const container = document.getElementById('compRegActions');
  if (!container) return;
  const backBtn = '<button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button>';
  try {
    const clubsData = await api('/api/clubs');
    const raw = clubsData.data || {};
    const clubs = raw.clubs || clubsData.clubs || [];
    const memberships = raw.memberships || clubsData.memberships || [];
    // 用户是老板的俱乐部
    const myBossClubs = clubs.filter(c => c.owner_id === currentUser.id || memberships.some(m => m.club_id === c.id && m.role === 'boss'));
    if (!myBossClubs.length) {
      container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">您不是任何俱乐部的老板，请由俱乐部老板操作报名</p>'+backBtn+'</div>';
      return;
    }
    // 列出老板的俱乐部
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">选择俱乐部报名</div>'+
      myBossClubs.map(club => '<button class="btn btn-sm btn-ghost" style="display:block;width:100%;margin-bottom:6px;text-align:left;color:var(--text-primary);" onclick="openClubPlayerSelect(\''+compId+'\',\''+club.id+'\',\''+escapeHtml(club.name||'')+'\')">'+escapeHtml(club.name)+' ('+(club.member_count||club.memberCount||0)+'人)</button>').join('')+
      backBtn;
  } catch(e) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">加载俱乐部失败：'+(e.message||'网络错误')+'</p>'+backBtn+'</div>';
  }
}

// 管理员无队伍时，从所有队伍中选一队报名
async function loadAdminTeamPicker(compId) {
  const container = document.getElementById('compRegActions');
  if (!container) return;
  try {
    const data = await api('/api/admin/teams');
    const teams = data.teams || [];
    if (!teams.length) {
      container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">暂无可用队伍，请先创建队伍</p><button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button></div>';
      return;
    }
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">管理员选择队伍报名</div>'+
      teams.map(t => '<button class="btn btn-sm btn-ghost" style="display:block;width:100%;margin-bottom:6px;text-align:left;color:var(--text-primary);" onclick="openTeamPlayerSelect(\''+compId+'\',\''+t.id+'\',\''+(t.name||'').replace(/'/g,"\\'")+'\')">'+t.name+' ('+(t.memberCount||0)+'人)</button>').join('')+
      '<button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button>';
  } catch(e) {
    container.innerHTML = '<div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;font-size:0.82rem;"><p style="color:var(--text-muted);margin:0 0 8px 0;">加载队伍失败</p><button class="btn btn-sm btn-ghost" onclick="loadCompRegUI(\''+compId+'\',window._compCache[\''+compId+'\'])">← 返回选择</button></div>';
  }
}

// 队长选择5名队员+分配位置
// ---------- 队伍选队员报名（简化版：多选列表，无需分配分路） ----------
async function openTeamPlayerSelect(compId, teamId, teamName) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-md" style="max-width:500px;">'+
    '<h3 style="margin-bottom:12px;">选择上场队员 - '+escapeHtml(teamName)+'</h3>'+
    '<p id="teamSelectStatus" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">加载中…</p>'+
    '<div id="teamPlayerForm" style="display:none;max-height:360px;overflow-y:auto;border:1px solid rgba(255,255,255,.06);border-radius:8px;"></div>'+
    '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;justify-content:space-between;">'+
      '<span id="selectedCount" style="font-size:0.82rem;color:var(--text-muted);">已选 0/5 人</span>'+
      '<div style="display:flex;gap:8px;">'+
        '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>'+
        '<button class="btn btn-primary btn-sm" id="submitTeamBtn">确认报名</button>'+
      '</div>'+
    '</div>'+
  '</div>';
  document.body.appendChild(overlay);

  document.getElementById('submitTeamBtn').addEventListener('click', () => submitTeamPlayers(compId, teamId));

  try {
    const data = await api('/api/teams/mine');
    const team = (data.data || {}).team || data.team;
    if (!team) { document.getElementById('teamSelectStatus').textContent = '队伍不存在'; return; }
    const members = team.members || [];
    if (members.length < 5) {
      document.getElementById('teamSelectStatus').textContent = '队伍不足5人（当前'+members.length+'人），无法报名';
      return;
    }

    const form = document.getElementById('teamPlayerForm');
    form.innerHTML = members.map(m => `
      <label class="player-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,.03')" onmouseout="this.style.background=''">
        <input type="checkbox" class="player-check" value="${m.userId}" data-lane="${escapeHtml(m.lane || m.position || '')}" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0;">
        <span style="color:var(--text-primary);font-size:0.88rem;flex:1;">${escapeHtml(m.coachName || m.username || m.userId)}</span>
        <span style="color:var(--text-muted);font-size:0.75rem;">${escapeHtml(m.gameRank || '')}</span>
      </label>
    `).join('');

    // 复选事件：更新计数
    form.querySelectorAll('.player-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = form.querySelectorAll('.player-check:checked');
        const count = checked.length;
        const countEl = document.getElementById('selectedCount');
        if (count > 5) {
          cb.checked = false;
          showToast('最多选择5人', 'warn');
          return;
        }
        countEl.textContent = `已选 ${count}/5 人`;
        countEl.style.color = count === 5 ? '#4ade80' : 'var(--text-muted)';
        // 整行高亮
        form.querySelectorAll('.player-item').forEach(item => {
          const check = item.querySelector('input');
          item.style.background = check.checked ? 'rgba(123,47,255,.12)' : '';
        });
      });
    });

    document.getElementById('teamSelectStatus').textContent = '共 ' + members.length + ' 名成员，请选择5人上场';
    form.style.display = 'block';
  } catch(e) {
    const el = document.getElementById('teamSelectStatus');
    if (el) { el.textContent = '加载失败：' + (e.message || '网络错误'); el.style.color = '#f87171'; }
  }
}
async function submitTeamPlayers(compId, teamId) {
  const checked = document.querySelectorAll('#teamPlayerForm .player-check:checked');
  if (checked.length !== 5) {
    showToast('请选择恰好5名队员', 'error');
    return;
  }
  const lanes = ['对抗路','打野','中路','发育路','游走'];
  const players = Array.from(checked).map((cb, i) => ({ user_id: cb.value, lane: cb.dataset.lane || lanes[i] || '' }));
  const btn = document.getElementById('submitTeamBtn');
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  try {
    const result = await api('/api/competitions/'+compId+'/register', { method:'POST', body: JSON.stringify({ team_id: teamId, players }) });
    if (!result) { showToast('登录已过期，请重新登录', 'error'); return; }
    if (!result.success) { showToast(result.message || '报名失败', 'error'); return; }
    showToast(result.message || '报名成功', 'success');
    document.querySelector('.modal-overlay')?.remove();
    document.querySelector('.comp-detail-overlay')?.remove();
    loadCompetitionList();
  } catch(e) {
    showToast(e.message || '报名失败，请重试', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '确认报名'; }
  }
}

async function confirmCompetitionEntry(compId, fee) {
  if (!await dialog({ title:'确认入场', body:'确定使用 '+fee+' 梦币入场吗？', confirmText:'确认', cancelText:'取消' })) return;
  try {
    await api('/api/competitions/'+compId+'/confirm', { method:'POST', body: JSON.stringify({ entry_fee: fee }) });
    showToast('已确认入场','success');
    document.querySelector('.comp-detail-overlay')?.remove();
    loadCompetitionList();
  } catch(e) { showToast(e.message,'error'); }
}

// ---------- 俱乐部选队员报名（简化版：多选列表，从自由名单选人） ----------
async function openClubPlayerSelect(compId, clubId, clubName) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-md" style="max-width:500px;">'+
    '<h3 style="margin-bottom:12px;">选择上场队员 - '+escapeHtml(clubName)+'</h3>'+
    '<p id="clubSelectStatus" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">加载中…</p>'+
    '<div id="clubPlayerForm" style="display:none;max-height:360px;overflow-y:auto;border:1px solid rgba(255,255,255,.06);border-radius:8px;"></div>'+
    '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;justify-content:space-between;">'+
      '<span id="selectedCount" style="font-size:0.82rem;color:var(--text-muted);">已选 0/5 人</span>'+
      '<div style="display:flex;gap:8px;">'+
        '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>'+
        '<button class="btn btn-primary btn-sm" id="submitClubBtn">确认报名</button>'+
      '</div>'+
    '</div>'+
  '</div>';
  document.body.appendChild(overlay);

  document.getElementById('submitClubBtn').addEventListener('click', () => submitClubPlayers(compId, clubId));

  try {
    // 从俱乐部大名单 API 获取自由名单成员
    const data = await api('/api/club/'+clubId+'/roster');
    const freeRoster = data.free || [];

    if (freeRoster.length === 0) {
      document.getElementById('clubSelectStatus').innerHTML = '<span style="color:#f87171;">该俱乐部自由名单为空，请先在俱乐部管理中设置自由名单</span>';
      return;
    }
    if (freeRoster.length < 5) {
      document.getElementById('clubSelectStatus').innerHTML = '<span style="color:#f87171;">自由名单不足5人（当前'+freeRoster.length+'人），无法报名</span>';
      return;
    }

    const form = document.getElementById('clubPlayerForm');
    form.innerHTML = freeRoster.map(m => {
      const uid = m.player_user_id || m.user_id;
      const label = m.game_id || m.coachName || m.username || uid;
      const grade = m.grade || '';
      return `
        <label class="player-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,.03)" onmouseout="this.style.background=''">
          <input type="checkbox" class="player-check" value="${uid}" data-lane="${escapeHtml(m.lane || m.position || '')}" style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0;">
          <span style="color:var(--text-primary);font-size:0.88rem;flex:1;">${escapeHtml(label)}</span>
          ${grade ? `<span style="color:#f59e0b;font-size:0.75rem;">${grade}级</span>` : ''}
        </label>
      `;
    }).join('');

    // 复选事件
    form.querySelectorAll('.player-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = form.querySelectorAll('.player-check:checked');
        const count = checked.length;
        if (count > 5) {
          cb.checked = false;
          showToast('最多选择5人', 'warn');
          return;
        }
        document.getElementById('selectedCount').textContent = `已选 ${count}/5 人`;
        document.getElementById('selectedCount').style.color = count === 5 ? '#4ade80' : 'var(--text-muted)';
        form.querySelectorAll('.player-item').forEach(item => {
          const check = item.querySelector('input');
          item.style.background = check.checked ? 'rgba(123,47,255,.12)' : '';
        });
      });
    });

    document.getElementById('clubSelectStatus').textContent = '共 ' + freeRoster.length + ' 名自由名单成员，请选择5人上场';
    form.style.display = 'block';
  } catch(e) {
    const el = document.getElementById('clubSelectStatus');
    if (el) { el.textContent = '加载失败：' + (e.message || '网络错误'); el.style.color = '#f87171'; }
  }
}
async function submitClubPlayers(compId, clubId) {
  const checked = document.querySelectorAll('#clubPlayerForm .player-check:checked');
  if (checked.length !== 5) {
    showToast('请选择恰好5名队员', 'error');
    return;
  }
  const lanes = ['对抗路','打野','中路','发育路','游走'];
  const players = Array.from(checked).map((cb, i) => ({ user_id: cb.value, lane: cb.dataset.lane || lanes[i] || '' }));
  const btn = document.getElementById('submitClubBtn');
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  try {
    const result = await api('/api/competitions/'+compId+'/register', { method:'POST', body: JSON.stringify({ club_id: clubId, players }) });
    if (!result) { showToast('登录已过期，请重新登录', 'error'); return; }
    if (!result.success) { showToast(result.message || '报名失败', 'error'); return; }
    showToast(result.message || '报名成功', 'success');
    document.querySelector('.modal-overlay')?.remove();
    document.querySelector('.comp-detail-overlay')?.remove();
    loadCompetitionList();
  } catch(e) {
    showToast(e.message || '报名失败，请重试', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '确认报名'; }
  }
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
    <div id="coinSubContent"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
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
  content.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  try {
    // 管理员或俱乐部老板跳过选手认证，直接进入转会市场
    const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
    let isBoss = false;
    if (!isAdmin && currentUser) {
      try {
        const clubsData = await api('/api/clubs');
        const raw = clubsData.data || {};
        const memberships = raw.memberships || clubsData.memberships || [];
        isBoss = (raw.clubs || clubsData.clubs || []).some(c => c.owner_id === currentUser.id) || memberships.some(m => m.role === 'boss');
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
      const raw = clubsData.data || {};
      const memberships = raw.memberships || clubsData.memberships || [];
      const myMembershipMap = new Map(memberships.map(m => [m.club_id, m.role]));
      myClubs = (raw.clubs || clubsData.clubs || []).filter(c => c.owner_id === currentUser.id || myMembershipMap.has(c.id));
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
        <div class="market-player-name">${p.game_id} <span style="font-size:0.72rem;color:var(--text-muted);">(${p.coachName || p.username})</span></div>
        <div class="market-player-detail">巅峰${p.peak_score} | ${p.game_rank}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
          ${positions.map(l => `<span class="pos-tag pos-tag-${l}">${l}</span>`).join('')}
        </div>
        ${p.heroPool ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;" title="擅长英雄：${p.heroPool}"><span style="color:var(--text-secondary);">擅长：</span>${p.heroPool}</div>` : ''}
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
      <div id="playerDetailContent"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
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
  content.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  try {
    const clubsData = await api('/api/clubs');
    const raw = clubsData.data || {};
    const clubs = raw.clubs || clubsData.clubs || [];
    const memberships = raw.memberships || clubsData.memberships || [];
    const myMembershipMap = new Map(memberships.map(m => [m.club_id, m.role]));
    // 查找当前用户关联的俱乐部（老板或成员）
    const myClubs = currentUser
      ? clubs.filter(c => c.owner_id === currentUser.id || myMembershipMap.has(c.id))
      : [];

    let html = '<div class="card"><h3>我的俱乐部</h3>';
    if (isAdmin) {
      html += `<button class="btn btn-primary btn-sm" style="margin-bottom:12px;" onclick="openCreateClubModal()">创建俱乐部</button>`;
    }
    if (myClubs.length > 0) {
      html += myClubs.map(c => {
        const isOwner = currentUser && c.owner_id === currentUser.id;
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
  content.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  const isAdmin = currentUser && currentUser.id === 'mp4hmya7ad15v6';
  try {
    const data = await api('/api/club/' + clubId);
    const c = (data.data || data).club;
    if (!c) { content.innerHTML = '<div class="card"><p>俱乐部不存在或加载失败</p><button class="btn btn-sm btn-primary" onclick="renderClubPanel()">返回</button></div>'; return; }
    const members = (data.data || data).members || [];
    const transfers = (data.data || data).transfers || [];
    const isOwner = currentUser && c.owner_id === currentUser.id;

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
      // 安全：数据来自后端，但仍使用 escapeHtml 防护 content 中的特殊字符
      const contentEsc = escapeHtml(n.content || '');
      const timeEsc = escapeHtml(new Date(n.created_at).toLocaleString());
      let actions = '';
      if (n.type === 'team_invite') {
        // 安全：relatedId 通过 data- 属性传递，避免直接拼接进 onclick
        actions = `<div style="margin-top:8px;">
          <button class="btn btn-primary btn-sm notif-action" data-action="acceptInvite" data-id="${escapeHtml(n.relatedId || '')}" style="font-size:0.78rem;">接受邀请</button>
        </div>`;
      } else if (n.type === 'competition_register') {
        // 报名成功通知：显示"确认入场"按钮，点击跳转赛事详情页
        actions = `<div style="margin-top:8px;">
          <button class="btn btn-primary btn-sm notif-action" data-action="confirmEntry" data-id="${escapeHtml(n.relatedId || '')}" style="font-size:0.78rem;">确认入场</button>
        </div>`;
      }
      html += `<div class="notif-item ${n.read ? '' : 'notif-unread'}" style="padding:12px;background:${n.read ? 'var(--bg-glass)' : 'rgba(0, 212, 255, 0.08)'};border-radius:var(--radius-md);margin-bottom:10px;font-size:0.88rem;border:1px solid ${n.read ? 'var(--border-color)' : 'rgba(0, 212, 255, 0.2)'};">${contentEsc}<br><small style="color:var(--text-muted);">${timeEsc}</small>${actions}</div>`;
    });
    html += '<button class="btn btn-primary btn-sm notif-action" data-action="markAllRead" style="width:100%;margin-top:8px;">全部已读</button>';
  }
  html += '</div>';
  const panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.style.cssText = 'position:fixed;top:80px;right:16px;width:340px;max-height:450px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);z-index:150;padding:20px;overflow-y:auto;';
  panel.innerHTML = `<div style="font-weight:700;font-size:1rem;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;color:var(--text-primary);">消息通知 <span id="notifPanelClose" style="cursor:pointer;font-size:1.4rem;color:var(--text-muted);width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);transition:all 0.2s;">&times;</span></div>${html}`;
  // 事件代理：统一处理按钮点击，避免内联 onclick
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.notif-action');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'markAllRead') { markAllRead(); panel.remove(); }
    else if (action === 'acceptInvite') { const id = btn.dataset.id; if (id) acceptTeamInvite(id); panel.remove(); }
    else if (action === 'confirmEntry') {
      const compId = btn.dataset.id;
      panel.remove();
      if (compId) openCompetitionDetail(compId);
    }
  });
  document.body.appendChild(panel);
  panel.querySelector('#notifPanelClose').addEventListener('click', () => panel.remove());
  const closeOnOutside = (e) => { if (!panel.contains(e.target) && e.target.id !== 'notificationBell') { panel.remove(); document.removeEventListener('click', closeOnOutside); } };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}
async function markAllRead() {
  await api('/api/notifications/read-all', { method:'PUT' });
  showToast('已全部标为已读','success');
  checkNotifications();
  document.getElementById('notifPanel')?.remove();
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
  currentTab = tab; updateUI();
    if (tab === 'team') cacheStore.delete('/api/teams/mine');
  const content = document.getElementById('tabContent');
  content.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  try {
    if (tab === 'profile') await renderProfileCenter();
    else if (tab === 'admin') await renderAdminPanel();
    else if (tab === 'team') await renderTeamPanel();
    else if (tab === 'competition') await renderCompetitionPanel();
    else if (tab === 'market') await renderMarketPanel();
    else if (tab === 'club') await renderClubPanel();
  } catch {
    content.innerHTML = '<div class="card"><p>加载失败</p><button class="btn btn-sm btn-primary" onclick="switchTab(\''+tab+'\')">重试</button></div>';
  }
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  if (['publish','profile','admin'].includes(tab) && !currentUser) { showToast('请先登录','info'); openAuthModal('login'); return; }
  switchTab(tab);
}));

// ==================== 个人中心 ====================
let currentProfileTab = 'info'; // info | account

async function renderProfileCenter() {
  const content = document.getElementById('tabContent');
  content.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="profile-center-tabs">
        <button class="profile-center-tab ${currentProfileTab === 'info' ? 'active' : ''}" data-ptab="info" onclick="switchProfileTab('info')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          个人信息
        </button>
        <button class="profile-center-tab ${currentProfileTab === 'account' ? 'active' : ''}" data-ptab="account" onclick="switchProfileTab('account')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
          我的账户
        </button>
      </div>
      <div id="profileCenterContent" style="padding:20px;"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
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
  content.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  try {
    const data = await api('/api/teams/mine', { skipCache: true });
    renderMyTeam((data.data || {}).team || data.team);
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
            <div style="font-weight:700;color:#fff;cursor:pointer;" onclick="${isSelf ? `switchTab('profile')` : `openPlayerDetailModal('${m.userId}')`}">${m.coachName || m.username} ${isSelf ? '<span style="font-size:0.75rem;color:var(--text-muted);">（你）</span>' : ''}</div>
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
    container.innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
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
    const team = (data.data || {}).team || data.team;
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
  const team = (data.data || {}).team || data.team;
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
        <button class="recruit-tab ${currentAdminSubTab==='competitions'?'active':''}" onclick="switchAdminSubTab('competitions')">赛事管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='users'?'active':''}" onclick="switchAdminSubTab('users')">用户管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='teams'?'active':''}" onclick="switchAdminSubTab('teams')">队伍管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='logs'?'active':''}" onclick="switchAdminSubTab('logs')">操作日志</button>
        <button class="recruit-tab ${currentAdminSubTab==='security'?'active':''}" onclick="switchAdminSubTab('security')">权限安全</button>
        <button class="recruit-tab ${currentAdminSubTab==='players'?'active':''}" onclick="switchAdminSubTab('players')">选手审核</button>
        <button class="recruit-tab ${currentAdminSubTab==='clubs'?'active':''}" onclick="switchAdminSubTab('clubs')">俱乐部管理</button>
        <button class="recruit-tab ${currentAdminSubTab==='coins'?'active':''}" onclick="switchAdminSubTab('coins')">梦币管理</button>
      </div>
      <div id="adminSubContent"><div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div></div>
    </div>
  `;
  await loadAdminSubTab();
}

async function switchAdminSubTab(tab) {
  currentAdminSubTab = tab;
  document.querySelectorAll('.recruit-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.includes({
      dashboard: '仪表盘', competitions: '赛事管理',
      users: '用户管理', teams: '队伍管理', logs: '操作日志', security: '权限安全',
      players: '选手审核', clubs: '俱乐部管理'
    }[tab]));
  });
  document.getElementById('adminSubContent').innerHTML = '<div class="loading-spinner"><div class="load-text">加载中… 0%</div><div class="load-bar"><div class="load-fill"></div></div></div>';
  await loadAdminSubTab();
}

async function loadAdminSubTab() {
  const container = document.getElementById('adminSubContent');
  try {
    switch (currentAdminSubTab) {
      case 'dashboard': await loadAdminDashboard(container); break;
      case 'competitions': await loadAdminCompetitions(container); break;
      case 'users': await loadAdminUsers(container); break;
      case 'teams': await loadAdminTeams(container); break;
      case 'logs': await loadAdminLogs(container); break;
      case 'security': await loadAdminSecurity(container); break;
      case 'players': await loadAdminPlayers(container); break;
      case 'clubs': await loadAdminClubs(container); break;
      case 'coins': await loadAdminCoins(container); break;
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
  // 创建可搜索的下拉转让弹窗
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const currentCaptain = members.find(m => m.userId === currentCaptainId);
  const otherMembers = members.filter(m => m.userId !== currentCaptainId);
  overlay.innerHTML = `<div class="modal modal-md" style="max-width:420px;">
    <h3 style="margin-bottom:16px;">换队长 — ${escapeHtml(teamName)}</h3>
    <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">当前队长：${escapeHtml(currentCaptain?.coachName || currentCaptain?.username || currentCaptainId)}</p>
    <div class="form-group">
      <label style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:6px;display:block;">搜索新队长</label>
      <input class="form-input" id="captainSearchInput" placeholder="输入用户名搜索..." style="margin-bottom:8px;">
      <select id="captainSelect" class="form-select" size="6" style="width:100%;padding:8px;border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);font-size:0.88rem;cursor:pointer;">
        ${otherMembers.map(m => `<option value="${m.userId}">${escapeHtml(m.coachName || m.username || m.userId)}${m.gameRank ? ' — ' + m.gameRank : ''}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-primary btn-sm" id="confirmCaptainBtn" style="flex:1;">确认转让</button>
      <button class="btn btn-ghost btn-sm" onclick="this.closest('.modal-overlay').remove()" style="flex:1;">取消</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  // 搜索过滤
  const select = document.getElementById('captainSelect');
  const searchInput = document.getElementById('captainSearchInput');
  const filterMembers = () => {
    const q = searchInput.value.trim().toLowerCase();
    select.innerHTML = otherMembers
      .filter(m => {
        const name = (m.coachName || m.username || m.userId || '').toLowerCase();
        return !q || name.includes(q);
      })
      .map(m => `<option value="${m.userId}">${escapeHtml(m.coachName || m.username || m.userId)}${m.gameRank ? ' — ' + m.gameRank : ''}</option>`)
      .join('');
  };
  searchInput.addEventListener('input', filterMembers);

  // 确认转让
  document.getElementById('confirmCaptainBtn').addEventListener('click', async () => {
    const selected = select.value;
    if (!selected || selected === currentCaptainId) { showToast('请选择不同的成员','warn'); return; }
    const btn = document.getElementById('confirmCaptainBtn');
    btn.disabled = true; btn.textContent = '转让中…';
    try {
      await api(`/api/admin/teams/${teamId}`, { method:'PUT', body: JSON.stringify({ captainId: selected }) });
      showToast('队长已更换','success');
      overlay.remove();
      await loadAdminTeams(document.getElementById('adminSubContent'));
    } catch(err) { showToast(err.message,'error'); btn.disabled = false; btn.textContent = '确认转让'; }
  });
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
      <div class="stat-card red">
        <div class="stat-value">${s.totalTeams || 0}</div>
        <div class="stat-label">队伍总数</div>
      </div>
    </div>
  `;
}

async function loadAdminCompetitions(container) {
  // Phase 3 占位：管理员赛事管理
  container.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="openCreateCompetitionModal()" style="margin-bottom:12px;">创建赛事</button>
    <div id="adminCompList"><p style="color:var(--text-muted);">赛事列表加载中...</p></div>
  `;
  loadAdminCompList();
}
async function loadAdminCompList() {
  const container = document.getElementById('adminCompList');
  try {
    const data = await api('/api/competitions');
    const comps = data.competitions || [];
    if (!comps.length) { container.innerHTML = '<p style="color:var(--text-muted);">暂无赛事</p>'; return; }
    container.innerHTML = comps.map(c => {
      const statusLabel = { upcoming:'未开始', open:'报名中', locked:'已满员', live:'比赛中', review:'待审核', finished:'已结束', cancelled:'已取消' }[c.comp_status] || '';
      const statusColor = { review:'var(--warning)', live:'var(--danger)', finished:'var(--success)' }[c.comp_status] || 'var(--text-muted)';
      return `
      <div style="padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <span style="font-weight:600;color:var(--text-primary);">${c.name}</span>
          <span style="font-size:0.72rem;color:${statusColor};margin-left:8px;font-weight:600;">${statusLabel}</span>
        </div>
        <div style="display:flex;gap:6px;">
          ${c.comp_status === 'review' ? '<button class="btn btn-xs btn-primary" onclick="adminReviewCompetition(\''+c.id+'\')">审核结算</button>' : ''}
          <button class="btn btn-xs btn-danger" onclick="adminDeleteCompetition(\''+c.id+'\')">删除</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) { container.innerHTML = '<p style="color:var(--danger);">加载失败</p>'; }
}
async function adminDeleteCompetition(id) {
  try {
    if (!await dialog({ title: '删除赛事', body: '确定删除该赛事？', confirmText: '删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
    await api(`/api/admin/competitions/${id}`, { method:'DELETE' });
    showToast('已删除', 'info');
    loadAdminCompList();
  } catch(e) { showToast(e.message, 'error'); }
}

async function adminReviewCompetition(compId) {
  try {
    const results = await api('/api/competitions/'+compId+'/results');
    const r = results.result;
    if (!r) { showToast('暂无待审核结果','info'); return; }
    const winnerLabel = r.winner === 'blue' ? '蓝方胜' : '红方胜';
    const players = r.player_data || [];
    const screenshots = r.screenshot_urls || [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-md" style="max-width:550px;">
        <h3 style="margin-bottom:12px;">比赛结果审核</h3>
        <p style="color:var(--warning);font-weight:600;">胜方：${winnerLabel}</p>
        ${screenshots.length ? '<p style="font-size:0.78rem;">截图：'+screenshots.map((s,i)=>'<a href="'+s+'" target="_blank" style="color:var(--accent);">#'+(i+1)+'</a>').join(' ')+'</p>' : ''}
        ${players.length ? '<div style="margin-top:8px;max-height:200px;overflow-y:auto;background:rgba(255,255,255,.02);padding:8px;border-radius:6px;"><table style="width:100%;font-size:0.72rem;">'+players.map(p=>'<tr><td style="padding:2px 4px;">'+(p.win?'&#x2705;':'&#x274C;')+'</td><td>'+p.lane+'</td><td>'+p.kda+'</td></tr>').join('')+'</table></div>' : ''}
        <div style="margin-top:16px;display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="adminConfirmCompResult('${compId}')">确认发放奖池</button>
          <button class="btn btn-ghost btn-sm" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } catch(e) { showToast(e.message,'error'); }
}
async function adminConfirmCompResult(compId) {
  if (!await dialog({ title:'确认结算', body:'确定发放奖池梦币吗？此操作不可撤销。', confirmText:'确认发放', cancelText:'取消' })) return;
  try {
    const res = await api('/api/admin/competitions/'+compId+'/confirm-result', { method:'POST' });
    showToast('奖池已发放！胜方'+res.winnerCount+'人','success');
    document.querySelector('.modal-overlay')?.remove();
    loadAdminCompList();
  } catch(e) { showToast(e.message,'error'); }
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
  const clubs = (clubsData.data || {}).clubs || clubsData.clubs || [];
  if (!clubs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">暂无俱乐部</p><button class="btn btn-primary btn-sm" onclick="openCreateClubModal()" style="margin-top:8px;">创建俱乐部</button>';
    return;
  }
  container.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="openCreateClubModal()" style="margin-bottom:12px;">创建俱乐部</button>
    ${clubs.map(c => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:8px;cursor:pointer;" onclick="renderClubDetail(${c.id})">
        <div>
          <span style="font-weight:600;color:var(--text-primary);">${c.name}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">${c.member_count || 0}名队员</span>
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">老板：${c.owner_name || c.owner_username || c.owner_id}</div>
        </div>
        <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();editClubName(${c.id},'${c.name.replace(/'/g,"\\'")}')" style="flex-shrink:0;">改名</button>
      </div>
    `).join('')}
  `;
}

async function editClubName(clubId, currentName) {
  const result = await dialogPrompt({ title: '修改俱乐部名称', body: '', placeholder: currentName, defaultValue: currentName, confirmText: '保存', cancelText: '取消' });
  if (!result) return;
  try {
    await api('/api/admin/clubs/' + clubId, { method:'PUT', body: JSON.stringify({ name: result }) });
    showToast('名称已更新', 'success');
    loadAdminSubTab();
  } catch(e) { showToast(e.message, 'error'); }
}

async function adminDeleteUser(id) {
  if (!await dialog({ title: '管理员操作', body: '确定删除此用户？该用户的所有数据将被移除。', confirmText: '删除', cancelText: '取消', confirmBtnClass: 'btn-danger' })) return;
  await api(`/api/admin/users/${id}`, { method:'DELETE' });
  showToast('已删除','info');
  loadAdminSubTab();
}

// ==================== 管理员 - 梦币管理 ====================
async function loadAdminCoins(container) {
  try {
    const [usersData, txData] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/coin-transactions')
    ]);
    const users = usersData.users || [];
    const totalCoins = users.reduce((sum, u) => sum + (u.dream_coins || 0), 0);
    const txs = txData.transactions || [];

    container.innerHTML = `
      <div style="margin-bottom:20px;">
        <h4 style="margin:0 0 16px 0;font-size:0.95rem;color:var(--text-secondary);">梦币概览</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;">
          <div style="background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.2);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:1.8rem;font-weight:700;color:#FFD700;">${totalCoins.toLocaleString()}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">总梦币</div>
          </div>
          <div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:1.8rem;font-weight:700;color:#10b981;">${users.length}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">用户数</div>
          </div>
          <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:1.8rem;font-weight:700;color:#3b82f6;">${txs.length}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">交易记录</div>
          </div>
        </div>

        <h4 style="margin:0 0 16px 0;font-size:0.95rem;color:var(--text-secondary);">批量发放</h4>
        <div style="background:#1A1A2E;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:20px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">发放金额（正数=发放，负数=扣除）</label>
              <input type="number" id="batchCoinAmount" class="form-input" placeholder="如：5000" value="5000">
            </div>
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">备注说明</label>
              <input type="text" id="batchCoinNote" class="form-input" placeholder="如：初始奖金发放">
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button class="btn btn-primary" onclick="adminBatchAwardCoins()" style="background:linear-gradient(135deg,#FFD700,#FFA500);color:#000;border:none;font-weight:600;">
              ⭐ 发放给所有用户
            </button>
            <span style="font-size:0.78rem;color:var(--text-muted);">将向全部 ${users.length} 名用户发放/扣除相同数量</span>
          </div>
        </div>

        <h4 style="margin:0 0 16px 0;font-size:0.95rem;color:var(--text-secondary);">单用户发放</h4>
        <div style="background:#1A1A2E;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:20px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">用户</label>
              <select id="singleCoinUser" class="form-select" style="width:100%;">
                <option value="">选择用户...</option>
                ${users.map(u => `<option value="${u.id}">${u.coachname || u.username || u.id} (${u.dream_coins || 0}梦币)</option>`).join('')}
              </select>
            </div>
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">金额</label>
              <input type="number" id="singleCoinAmount" class="form-input" placeholder="正数=发放，负数=扣除">
            </div>
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">备注</label>
              <input type="text" id="singleCoinNote" class="form-input" placeholder="备注说明">
            </div>
            <button class="btn btn-primary" onclick="adminSingleAwardCoin()" style="align-self:flex-end;">发放</button>
          </div>
        </div>

        <h4 style="margin:0 0 16px 0;font-size:0.95rem;color:var(--text-secondary);">用户余额</h4>
        <div style="background:#1A1A2E;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
            <thead>
              <tr style="background:rgba(255,255,255,.03);">
                <th style="padding:12px 16px;text-align:left;color:var(--text-muted);font-weight:500;">用户</th>
                <th style="padding:12px 16px;text-align:right;color:var(--text-muted);font-weight:500;">余额</th>
              </tr>
            </thead>
            <tbody>
              ${users.sort((a,b) => (b.dream_coins||0) - (a.dream_coins||0)).map(u => `
                <tr style="border-top:1px solid rgba(255,255,255,.05);">
                  <td style="padding:12px 16px;color:var(--text-primary);">${u.coachname || u.username || u.id}</td>
                  <td style="padding:12px 16px;text-align:right;color:${(u.dream_coins||0) > 0 ? '#10b981' : '#ef4444'};font-weight:600;">${u.dream_coins?.toLocaleString() || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<p style="color:var(--danger);">加载失败：${e.message}</p>`;
  }
}

async function adminBatchAwardCoins() {
  const amount = parseInt(document.getElementById('batchCoinAmount').value);
  const note = document.getElementById('batchCoinNote').value.trim();
  if (isNaN(amount) || amount === 0) { showToast('请输入有效的金额（非0）', 'error'); return; }
  const action = amount > 0 ? '发放' : '扣除';
  const absAmount = Math.abs(amount);
  if (!await dialog({
    title: '批量' + action + '确认',
    body: `确定向所有用户${action} <strong style="color:#FFD700;">${absAmount}</strong> 梦币吗？\n\n备注：${note || '无'}\n\n此操作不可撤销！`,
    confirmText: '确认' + action,
    cancelText: '取消',
    confirmBtnClass: 'btn-warning'
  })) return;
  try {
    const res = await api('/api/admin/award-coins', {
      method: 'POST',
      body: JSON.stringify({ userId: 'all', amount, note: note || action + '初始奖金' })
    });
    showToast(res.message || action + '成功', 'success');
    loadAdminSubTab();
  } catch(e) {
    showToast(e.message || action + '失败', 'error');
  }
}

async function adminSingleAwardCoin() {
  const userId = document.getElementById('singleCoinUser').value;
  const amount = parseInt(document.getElementById('singleCoinAmount').value);
  const note = document.getElementById('singleCoinNote').value.trim();
  if (!userId) { showToast('请选择用户', 'error'); return; }
  if (isNaN(amount) || amount === 0) { showToast('请输入有效的金额（非0）', 'error'); return; }
  const action = amount > 0 ? '发放' : '扣除';
  try {
    await api('/api/admin/award-coins', {
      method: 'POST',
      body: JSON.stringify({ userId, amount, note: note || action + '奖励' })
    });
    showToast(action + '成功', 'success');
    loadAdminSubTab();
  } catch(e) {
    showToast(e.message || action + '失败', 'error');
  }
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
          ${options.cancelText ? `<button class="btn btn-ghost dialog-cancel">${options.cancelText}</button>` : ''}
          ${options.confirmText ? `<button class="btn ${options.confirmBtnClass||'btn-primary'} dialog-confirm">${options.confirmText}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { if (overlay.parentNode) document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    const btnCancel = overlay.querySelector('.dialog-cancel');
    const btnConfirm = overlay.querySelector('.dialog-confirm');
    if (btnCancel) btnCancel.addEventListener('click', () => close(false));
    if (btnConfirm) btnConfirm.addEventListener('click', () => close(true));
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
        <input class="dialog-input dialog-input-el" value="${options.defaultValue || ''}" placeholder="${options.placeholder || ''}" style="margin-bottom:16px;">
        <div class="dialog-actions">
          <button class="btn btn-ghost dialog-cancel">${options.cancelText || '取消'}</button>
          <button class="btn btn-primary dialog-confirm">${options.confirmText || '确定'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.dialog-input-el');
    if (input) input.focus();
    const close = (result) => { if (overlay.parentNode) document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    const btnCancel = overlay.querySelector('.dialog-cancel');
    const btnConfirm = overlay.querySelector('.dialog-confirm');
    if (btnCancel) btnCancel.addEventListener('click', () => close(null));
    if (btnConfirm) btnConfirm.addEventListener('click', () => close(input ? input.value : null));
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value); });
  });
}

function dialogChoices(options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const choicesHtml = options.choices.map((c, i) => `<button class="btn btn-ghost dialog-choice" data-idx="${i}" style="margin-bottom:8px;width:100%;justify-content:center;">${c}</button>`).join('');
    overlay.innerHTML = `
      <div class="dialog">
        ${options.title ? `<div class="dialog-title">${options.title}</div>` : ''}
        ${options.body ? `<div class="dialog-body">${options.body}</div>` : ''}
        <div class="dialog-choices-list">${choicesHtml}</div>
        <div class="dialog-actions" style="margin-top:12px;">
          <button class="btn btn-ghost dialog-cancel">${options.cancelText || '取消'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { if (overlay.parentNode) document.body.removeChild(overlay); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelectorAll('.dialog-choice').forEach((btn, i) => {
      btn.addEventListener('click', () => close(options.choices[i]));
    });
    const btnCancel = overlay.querySelector('.dialog-cancel');
    if (btnCancel) btnCancel.addEventListener('click', () => close(null));
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

// ==================== 加载进度监控（内存安全版） ====================
// 改进：仅在有 spinner 且页面可见时轮询；页面隐藏时自动暂停；退出时清理
const LOAD_TIMEOUT = 8000;
const _spinnerTimestamps = new WeakMap();
let _spinnerRafId = null;
let _spinnerLastTick = 0;

function _tickSpinners() {
  // 节流：每 120ms 最多一次
  const now = Date.now();
  if (now - _spinnerLastTick < 120) {
    _spinnerRafId = requestAnimationFrame(_tickSpinners);
    return;
  }
  _spinnerLastTick = now;

  const active = document.querySelectorAll('.loading-spinner:not(.load-timeout)');
  if (active.length === 0) {
    // 没有活跃 spinner，停止轮询
    if (_spinnerRafId) { cancelAnimationFrame(_spinnerRafId); _spinnerRafId = null; }
    return;
  }

  active.forEach(spinner => {
    if (!_spinnerTimestamps.has(spinner)) _spinnerTimestamps.set(spinner, now);
    const fill = spinner.querySelector('.load-fill');
    const text = spinner.querySelector('.load-text');
    if (text && fill) {
      const fillW = fill.getBoundingClientRect().width || 0;
      const barW = fill.parentElement?.getBoundingClientRect().width || 280;
      const pct = Math.min(Math.round((fillW / barW) * 100), 99);
      text.textContent = `加载中… ${pct}%`;
    }
    const start = _spinnerTimestamps.get(spinner);
    if (now - start > LOAD_TIMEOUT) {
      spinner.classList.add('load-timeout');
      const retry = spinner.dataset.retry || 'switchTab(currentTab)';
      // 安全：retry 来自 dataset，仅包含受控字符串，不执行用户输入
      spinner.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <div class="load-text" style="color:var(--danger);margin-bottom:12px;">加载超时，请重试</div>
          <button class="btn btn-sm btn-primary" style="padding:8px 24px;">重新加载</button>
        </div>`;
      spinner.querySelector('button').onclick = () => { try { eval(retry); } catch(e) { switchTab(currentTab); } };
    }
  });

  _spinnerRafId = requestAnimationFrame(_tickSpinners);
}

// Visibility API：页面隐藏时暂停，恢复时重启
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (_spinnerRafId) { cancelAnimationFrame(_spinnerRafId); _spinnerRafId = null; }
  } else if (document.querySelector('.loading-spinner:not(.load-timeout)')) {
    _spinnerLastTick = 0; // 重置节流，下次立即执行
    _spinnerRafId = requestAnimationFrame(_tickSpinners);
  }
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  if (_spinnerRafId) { cancelAnimationFrame(_spinnerRafId); _spinnerRafId = null; }
});

// 启动
(async () => {
  updateUI();
  switchTab('competition');
  if (authToken) fetchUserInfo();
  setTimeout(showWelcome, 800);
})();
