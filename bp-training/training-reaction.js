'use strict';
(() => {
  const origin = 'https://app.neondream.cn';
  const playerUrl = origin + '/reaction-training/';
  const coachUrl = playerUrl + 'coach.html';
  let active = null;
  const theme = () => document.body.classList.contains('theme-light') ? 'light' : 'dark';
  function sendTheme() {
    if (active?.mode === 'coach') active.frame.contentWindow?.postMessage({ type: 'bp-reaction-theme', theme: theme() }, origin);
  }
  async function authorize() {
    const current = active;
    if (!current || current.mode !== 'coach' || !window.trainingAPI?.reactionSession) return;
    try {
      const result = await window.trainingAPI.reactionSession();
      if (active !== current) return;
      current.frame.contentWindow.postMessage(result.ok
        ? { type: 'bp-reaction-session', session: result.session }
        : { type: 'bp-reaction-auth-error', message: result.message || '需要有效 BP 授权。' }, origin);
    } catch {
      if (active === current) current.frame.contentWindow.postMessage({ type: 'bp-reaction-auth-error', message: '授权验证暂时无法连接，请重试。' }, origin);
    }
  }
  window.addEventListener('message', event => {
    if (!active || event.origin !== origin || event.source !== active.frame.contentWindow) return;
    if (event.data?.type === 'bp-reaction-ready') { active.ready = true; active.loading.hidden = true; clearTimeout(active.timeout); sendTheme(); authorize(); }
    if (event.data?.type === 'bp-reaction-renew') authorize();
  });
  new MutationObserver(sendTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function dispose() {
    if (!active) return;
    clearTimeout(active.timeout); active.frame.src = 'about:blank'; active.wrapper.remove(); active = null;
  }
  function create(container) {
    dispose();
    const wrapper = document.createElement('section'); wrapper.className = 'reaction-embed';
    const actions = document.createElement('div'); actions.className = 'reaction-actions';
    const frame = document.createElement('iframe'); frame.title = '反应训练教练视角';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');
    frame.setAttribute('allow', 'fullscreen'); frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const loading = document.createElement('div'); loading.className = 'reaction-loading'; loading.setAttribute('role', 'status');
    const link = document.createElement('a'); link.textContent = '独立打开'; link.href = coachUrl; link.target = '_blank'; link.rel = 'noopener';
    const coach = document.createElement('button'); coach.textContent = '教练视角'; coach.type = 'button';
    const player = document.createElement('button'); player.textContent = '选手页面'; player.type = 'button';
    const phone = document.createElement('details'); phone.className = 'reaction-phone';
    const summary = document.createElement('summary'); summary.textContent = '手机入口';
    const qr = document.createElement('img'); qr.src = playerUrl + 'reaction-training-qr.png'; qr.alt = '手机反应训练二维码'; qr.width = 160; qr.height = 160;
    const phoneLink = document.createElement('a'); phoneLink.href = playerUrl; phoneLink.textContent = '打开手机训练'; phoneLink.target = '_blank'; phoneLink.rel = 'noopener';
    phoneLink.onclick = event => { if (window.trainingAPI?.openReaction) { event.preventDefault(); window.trainingAPI.openReaction('player'); } };
    phone.append(summary, qr, phoneLink);
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试';
    actions.append(coach, player, retry, phone, link); wrapper.append(actions, loading, frame); container.prepend(wrapper);
    const state = { frame, wrapper, mode: 'coach', loading, ready: false, timeout: null };
    active = state;
    function navigate(mode) {
      state.mode = mode; state.ready = false; loading.hidden = false; loading.textContent = '正在载入反应训练…';
      clearTimeout(state.timeout); frame.src = mode === 'coach' ? coachUrl : playerUrl;
      coach.setAttribute('aria-pressed', String(mode === 'coach')); player.setAttribute('aria-pressed', String(mode === 'player'));
      link.href = mode === 'coach' ? coachUrl : playerUrl;
      link.onclick = event => { if (window.trainingAPI?.openReaction) { event.preventDefault(); window.trainingAPI.openReaction(mode); } };
      state.timeout = setTimeout(() => { if (active === state && !state.ready) { loading.hidden = false; loading.textContent = '页面暂时无法载入，请重试或独立打开。'; } }, 15000);
    }
    frame.onload = () => { if (state.mode === 'player') { state.ready = true; loading.hidden = true; clearTimeout(state.timeout); } };
    coach.onclick = () => navigate('coach'); player.onclick = () => navigate('player'); retry.onclick = () => navigate(state.mode);
    navigate('coach');
  }
  window.trainingReaction = { create, dispose };
})();
