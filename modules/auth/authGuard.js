/**
 * authGuard — 路由/操作守卫（IIFE 闭包）
 * 职责：保护需要登录的操作，未登录时触发登录弹窗
 * 禁止：不操作 DOM（通过回调通知 AuthPage 层）
 * version: 20260523a
 */
const AuthGuard = (() => {
  'use strict';

  let loginRedirect = null;   // () => void  登录成功后回调
  let loginModalCallback = null; // () => void  需要登录时回调（由 Page 层注入）

  // ---- public: 设置"需要登录"的触发函数 ----
  // Page 层注入：例如 showLoginModal()
  function setLoginModalCallback(cb) {
    loginModalCallback = typeof cb === 'function' ? cb : null;
  }

  // ---- public: 设置登录成功后的重定向 ----
  function setLoginRedirect(cb) {
    loginRedirect = typeof cb === 'function' ? cb : null;
  }

  // ---- public: 核心守卫：检查是否已登录，否则触发登录 ----
  // 用法：if (!AuthGuard.requireLogin()) return;
  function requireLogin() {
    if (window.AuthStore?.isLoggedIn()) return true;

    // 触发登录弹窗
    if (loginModalCallback) {
      try { loginModalCallback(); } catch (e) { console.error('[AuthGuard] loginModalCallback error:', e); }
    } else {
      console.warn('[AuthGuard] 请先登录（未配置 loginModalCallback）');
    }
    return false;
  }

  // ---- public: 检查是否为管理员 ----
  function requireAdmin() {
    if (!requireLogin()) return false;
    if (window.AuthStore?.isAdmin()) return true;
    console.warn('[AuthGuard] 需要管理员权限');
    return false;
  }

  // ---- public: 获取当前用户 ID（便捷方法）----
  function getUserId() {
    return window.AuthStore?.getUserId() || null;
  }

  // ---- public: 登录成功回调（由 AuthPage 层在登录后调用）----
  function onLoginSuccess() {
    if (loginRedirect) {
      try { loginRedirect(); } catch (e) { console.error('[AuthGuard] loginRedirect error:', e); }
      loginRedirect = null;
    }
  }

  // ---- public: 销毁 ----
  function destroy() {
    loginRedirect = null;
    loginModalCallback = null;
  }

  return {
    requireLogin,
    requireAdmin,
    getUserId,
    setLoginModalCallback,
    setLoginRedirect,
    onLoginSuccess,
    destroy
  };
})();

window.AuthGuard = AuthGuard;
