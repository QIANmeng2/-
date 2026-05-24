/**
 * authSession — 会话恢复（IIFE 闭包）
 * 职责：页面加载时恢复 token，定时刷新，处理 401 全局清理
 * 禁止：不操作 DOM，不调用 showToast（通过回调通知 Page 层）
 * version: 20260523a
 */
const AuthSession = (() => {
  'use strict';

  const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次 token 是否还有效
  let intervalId = null;
  let onAuthError = null;   // (err) => void  401 等认证错误时通知 Page 层
  let onSessionRestored = null; // () => void  token 恢复成功时通知

  // ---- 内部：调用 /api/auth/me 验证 token 是否仍有效 ----
  async function _verifyToken() {
    try {
      const data = await window.AuthApi?.fetchMe();
      if (data && (data.user || data.id)) {
        window.AuthStore?.setUser(data.user || data, window.AuthApi.getToken());
        return true;
      }
      throw new Error('无效的用户数据');
    } catch (err) {
      // 401 或网络错误 → 清除本地状态
      window.AuthApi?.clearToken();
      window.AuthStore?.clearUser();
      if (onAuthError) {
        try { onAuthError(err); } catch (e) { console.error('[AuthSession] onAuthError error:', e); }
      }
      return false;
    }
  }

  // ---- 内部：静默恢复会话（页面首次加载）----
  async function _restore() {
    if (!window.AuthApi?.hasToken()) {
      window.AuthStore?.markLoaded();
      return;
    }
    const ok = await _verifyToken();
    if (ok && onSessionRestored) {
      try { onSessionRestored(); } catch (e) { console.error('[AuthSession] onSessionRestored error:', e); }
    }
    window.AuthStore?.markLoaded();
  }

  // ---- 内部：定时检查 ----
  function _startPolling() {
    _stopPolling();
    intervalId = setInterval(async () => {
      if (!window.AuthStore?.isLoggedIn()) return;
      await _verifyToken();
    }, CHECK_INTERVAL);
  }

  function _stopPolling() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  // ---- public: 初始化（Page 层调用）----
  function init(opts = {}) {
    onAuthError = typeof opts.onAuthError === 'function' ? opts.onAuthError : null;
    onSessionRestored = typeof opts.onSessionRestored === 'function' ? opts.onSessionRestored : null;

    // 恢复会话（异步，不阻塞）
    _restore().then(() => {
      // 恢复完成后，启动定时检查
      if (window.AuthStore?.isLoggedIn()) {
        _startPolling();
      }
    });

    console.log('[AuthSession] 初始化完成，等待会话恢复...');
  }

  // ---- public: 登录成功后调用（由 AuthPage 层调用）----
  function onLogin(token, user) {
    window.AuthStore?.setUser(user, token);
    _startPolling();
  }

  // ---- public: 登出后调用 ----
  function onLogout() {
    _stopPolling();
    window.AuthApi?.logout(); // 清除 localStorage
    window.AuthStore?.clearUser();
  }

  // ---- public: 销毁 ----
  function destroy() {
    _stopPolling();
    onAuthError = null;
    onSessionRestored = null;
  }

  return {
    init,
    onLogin,
    onLogout,
    destroy
  };
})();

window.AuthSession = AuthSession;
