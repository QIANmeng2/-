'use strict';
(() => {
  const origin = 'https://app.neondream.cn';
  const playerUrl = origin + '/reaction-training/';
  const coachUrl = playerUrl + 'coach.html?v=20261002-pairing';
  let active = null;
  let pendingPublish = null;
  const theme = () => document.body.classList.contains('theme-light') ? 'light' : 'dark';
  function sendTheme() {
    if (active?.mode === 'coach') active.frame.contentWindow?.postMessage({ type: 'bp-reaction-theme', theme: theme() }, origin);
  }
  function sendViewport(){if(!active)return;const rect=active.frame.getBoundingClientRect();active.frame.contentWindow?.postMessage({type:'bp-training-viewport',top:Math.max(0,-rect.top),height:Math.max(240,Math.min(window.innerHeight,rect.bottom)-Math.max(0,rect.top))},origin);}
  window.addEventListener('scroll',sendViewport,{passive:true});window.addEventListener('resize',sendViewport);
  async function authorize() {
    const current = active;
    if (!current || current.mode !== 'coach' || current.authorizing) return;
    current.authorizing = true;
    try {
      const result = window.trainingAPI?.reactionSession ? await window.trainingAPI.reactionSession()
        : window.trainingWebAuthorization ? { ok: true, session: await window.trainingWebAuthorization.session() } : { ok: false, message: '需要有效 BP 授权。' };
      if (active !== current) return;
      current.frame.contentWindow.postMessage(result.ok
        ? { type: 'bp-reaction-session', session: result.session }
        : { type: 'bp-reaction-auth-error', message: result.message || '需要有效 BP 授权。' }, origin);
    } catch {
      if (active === current) current.frame.contentWindow.postMessage({ type: 'bp-reaction-auth-error', message: '授权验证暂时无法连接，请重试。' }, origin);
    } finally { current.authorizing = false; }
  }
  window.addEventListener('bp-training-unlocked', () => { if (active?.ready && !active.authorized) authorize(); });
  window.addEventListener('message', event => {
    if (!active || event.origin !== origin || event.source !== active.frame.contentWindow) return;
    if (event.data?.type === 'bp-reaction-ready') { active.ready = true; active.loading.hidden = true; active.failure.hidden=true; clearTimeout(active.timeout); sendTheme();sendViewport(); authorize(); }
    if (event.data?.type === 'bp-reaction-renew') { window.trainingWebAuthorization?.clear(); authorize(); }
    if (event.data?.type === 'bp-reaction-authenticated') {
      active.authorized = true;
      window.dispatchEvent(new CustomEvent('bp-training-role', { detail: event.data.session?.role || 'none' }));
      if (active.initialView) active.frame.contentWindow.postMessage({ type: 'bp-training-view', view: active.initialView }, origin);
      if (pendingPublish) active.frame.contentWindow.postMessage({ type: 'bp-training-publish', catalog: pendingPublish.catalog, version: pendingPublish.version }, origin);
    }
    if (event.data?.type === 'bp-training-catalog') window.dispatchEvent(new CustomEvent('bp-training-catalog', { detail: { catalog: event.data.catalog, version: event.data.version } }));
    if(event.data?.type==='bp-training-navigate'){active.initialView=event.data.view;window.dispatchEvent(new CustomEvent('bp-training-navigate',{detail:event.data.view}));}
    if(event.data?.type==='bp-training-height'&&Number.isFinite(event.data.height)){active.frame.style.height=Math.max(420,Math.min(6000,event.data.height+8))+'px';sendViewport();}
    if (event.data?.type === 'bp-training-published' && pendingPublish) { clearTimeout(pendingPublish.timeout); window.dispatchEvent(new CustomEvent('bp-training-published', {detail:event.data.version})); pendingPublish.resolve({version:event.data.version,catalog:event.data.catalog}); pendingPublish = null; }
    if (event.data?.type === 'bp-training-publish-error' && pendingPublish) { clearTimeout(pendingPublish.timeout); pendingPublish.reject(Error(event.data.message || '发布失败')); pendingPublish = null; }
  });
  new MutationObserver(sendTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  function dispose() {
    if (pendingPublish) { clearTimeout(pendingPublish.timeout); pendingPublish.reject(Error('训练页面已关闭，请重新发布。')); pendingPublish = null; }
    if (!active) return;
    clearTimeout(active.timeout); active.frame.src = 'about:blank'; active.wrapper.remove(); active = null;
  }
  function create(container, initialView = 'leaderboard') {
    if (active) {
      active.wrapper.hidden = false;
      active.initialView = initialView;
      if (active.authorized) active.frame.contentWindow.postMessage({ type: 'bp-training-view', view: initialView }, origin);
      else if (active.ready) authorize();
      sendTheme(); sendViewport();
      return;
    }
    const wrapper = document.createElement('section'); wrapper.className = 'reaction-embed';
    const frame = document.createElement('iframe'); frame.title = '反应训练教练视角';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals');
    frame.setAttribute('allow', 'fullscreen'); frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const loading = document.createElement('div'); loading.className = 'reaction-loading'; loading.setAttribute('role', 'status');
    const link = document.createElement('a'); link.textContent = '独立打开'; link.href = coachUrl; link.target = '_blank'; link.rel = 'noopener';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重新加载';
    const failure=document.createElement('div');failure.className='reaction-actions';failure.hidden=true;failure.append(retry,link);
    // Keep the iframe attached outside the rebuilt catalogue to preserve its session.
    wrapper.append(loading,failure,frame); document.getElementById('book').after(wrapper);
    const state = { frame, wrapper, mode: 'coach', loading, failure, ready: false, authorized: false, timeout: null, initialView, attempts:0 };
    active = state;
    function navigate(mode) {
      state.mode = mode; state.ready = false; state.authorized = false; loading.hidden = false; loading.textContent = '正在载入训练…';
      failure.hidden=true;clearTimeout(state.timeout); frame.src = coachUrl + '&reload=' + Date.now();
      link.href = mode === 'coach' ? coachUrl : playerUrl;
      link.onclick = event => { if (window.trainingAPI?.openReaction) { event.preventDefault(); window.trainingAPI.openReaction(mode); } };
      state.timeout = setTimeout(() => { if (active === state && !state.ready) { if(state.attempts++<1){navigate('coach');return;} loading.hidden = false; loading.textContent = '训练页面暂时无法载入。';failure.hidden=false; } }, 15000);
    }
    frame.onload = () => { if (state.mode === 'player') { state.ready = true; loading.hidden = true; clearTimeout(state.timeout); } };
    retry.onclick = () => {state.attempts=0;navigate('coach');};
    navigate('coach');
  }
  function publishCatalog(catalog, version) {
    if (!active) return Promise.reject(Error('请先打开训练安排。'));
    if (pendingPublish) return Promise.reject(Error('正在发布，请稍候。'));
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(() => { if (pendingPublish) { pendingPublish = null; reject(Error('发布超时，请确认网络和授权后重试。')); } }, 20000);
      pendingPublish = { catalog: JSON.parse(JSON.stringify(catalog)), version, resolve, reject, timeout };
      if (active.authorized) active.frame.contentWindow.postMessage({ type: 'bp-training-publish', catalog: pendingPublish.catalog, version }, origin);
    });
  }
  function hide() { if (active) active.wrapper.hidden = true; }
  window.addEventListener('beforeunload', dispose);
  window.trainingReaction = { create, hide, dispose, publishCatalog };
})();
