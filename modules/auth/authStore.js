/**
 * authStore — 认证状态管理（IIFE 闭包，不污染 window）
 * 职责：存储 currentUser / isLoggedIn，提供可预测的状态读取
 * 禁止：不读/写 localStorage，不操作 DOM
 * version: 20260523a
 */
const AuthStore = (() => {
  'use strict';

  // ---- 内部状态（闭包私有）----
  let state = {
    user: null,       // { id, username, coachName, teamName, ... }
    isLoggedIn: false,
    isAdmin: false,
    loaded: false      // 是否已尝试过 token 恢复
  };

  const listeners = []; // (newState) => void

  // ---- 私有：通知所有监听者 ----
  function _notify() {
    const snapshot = { ...state, user: state.user ? { ...state.user } : null };
    listeners.forEach(fn => {
      try { fn(snapshot); } catch (e) { console.error('[AuthStore] listener error:', e); }
    });
  }

  // ---- public: 设置用户（登录/恢复成功）----
  function setUser(user, token) {
    state.user = user ? { ...user } : null;
    state.isLoggedIn = !!user;
    state.isAdmin = !!(user && user.id === 'mp4hmya7ad15v6');
    state.loaded = true;
    _notify();
  }

  // ---- public: 清除用户（登出/401/token 失效）----
  function clearUser() {
    state.user = null;
    state.isLoggedIn = false;
    state.isAdmin = false;
    // loaded 保持 true — 表示"已确认未登录"状态
    _notify();
  }

  // ---- public: 标记已尝试 token 恢复（避免页面永久 loading）----
  function markLoaded() {
    if (!state.loaded) {
      state.loaded = true;
      _notify();
    }
  }

  // ---- public: 读取状态（返回快照，防止外部直接修改）----
  function getState() {
    return { ...state, user: state.user ? { ...state.user } : null };
  }

  function getUser() { return state.user ? { ...state.user } : null; }
  function isLoggedIn() { return state.isLoggedIn; }
  function isAdmin() { return state.isAdmin; }
  function hasRole(role) {
    if (!state.user) return false;
    if (role === 'admin') return state.isAdmin;
    // 扩展：可支持 'boss', 'signed' 等
    return false;
  }
  function getUserId() { return state.user ? state.user.id : null; }
  function getUserName() { return state.user ? (state.user.coachName || state.user.username) : ''; }

  // ---- public: 订阅状态变化 ----
  function subscribe(callback) {
    listeners.push(callback);
    // 立刻回调用当前状态（方便初始化）
    try { callback({ ...state, user: state.user ? { ...state.user } : null }); } catch (e) {}
    return () => { listeners.filter(fn => fn !== callback); };
  }

  // ---- public: 销毁（清除所有监听）----
  function destroy() {
    listeners.length = 0;
    state.user = null;
    state.isLoggedIn = false;
    state.isAdmin = false;
    state.loaded = false;
  }

  // ---- 暴露 public API ----
  return {
    setUser,
    clearUser,
    markLoaded,
    getState,
    getUser,
    isLoggedIn,
    isAdmin,
    hasRole,
    getUserId,
    getUserName,
    subscribe,
    destroy
  };
})();

window.AuthStore = AuthStore;
