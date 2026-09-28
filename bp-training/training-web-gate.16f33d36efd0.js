'use strict';
(() => {
  if (window.trainingAPI) return;
  const origin = 'https://app.neondream.cn';
  const api = 'https://download.neondream.cn/api/coach/';
  let grant = null;
  async function session() {
    if (grant && Date.parse(grant.expires_at) > Date.now() + 30000) return grant;
    const saved = JSON.parse(localStorage.getItem('bp-dream:license-session:v1') || 'null');
    if (!saved?.token || !saved.deviceId) throw new Error('需要有效 BP 授权。');
    const response = await fetch(api + 'session', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + saved.token }, body: JSON.stringify({ deviceId: saved.deviceId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'BP 授权验证失败。');
    grant = data; return data;
  }
  window.trainingWebAuthorization = { session, clear: () => { grant = null; } };
  document.body.classList.add('web-locked', 'theme-light');
  const gate = document.createElement('section'); gate.id = 'training-web-gate';
  const frame = document.createElement('iframe'); frame.title = 'BP 训练授权'; frame.src = origin + '/reaction-training/coach.html';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  const note = document.createElement('p'); note.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => { frame.src = origin + '/reaction-training/coach.html'; };
  gate.append(frame, note, retry); document.body.append(gate);
  let checking = false;
  const message = async event => {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'bp-reaction-ready') { frame.contentWindow.postMessage({ type: 'bp-reaction-parent' }, origin); return; }
    if (event.data?.type !== 'bp-reaction-authenticated' || !event.data.session?.token || checking) return;
    checking = true;
    try {
      const response = await fetch(api + 'overview', { cache: 'no-store', headers: { Authorization: 'Bearer ' + event.data.session.token } });
      if (!response.ok) throw new Error('BP 授权验证失败，请重试。');
      grant = event.data.session; document.body.classList.remove('web-locked'); gate.remove(); window.removeEventListener('message', message);
    } catch (error) { note.textContent = error.message; }
    finally { checking = false; }
  };
  window.addEventListener('message', message);
})();
