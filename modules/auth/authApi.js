/**
 * authApi — 认证 API 层（IIFE 闭包）
 * 职责：login / register / me / logout 请求，不碰 DOM 不碰 Store
 * 禁止：直接操作 currentUser / authToken 全局变量
 * version: 20260523a
 */
const AuthApi = (() => {
  'use strict';

  const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';
  const TOKEN_KEY = 'local_current_user'; // localStorage key，与旧逻辑兼容

  // ---- 内部：通用 fetch 封装（带 timeout + 自动 header）----
  async function _request(path, options = {}, timeoutMs = 12000) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(API_BASE + path, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        signal: controller.signal
      });
      clearTimeout(tid);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // token 失效，由调用方决定如何处理（通常清除本地状态）
        const err = new Error(data.message || '认证失败');
        err.status = 401;
        throw err;
      }
      if (!res.ok) throw new Error(data.message || '请求失败');
      // 自动解包 { success:true, data:... }
      if (data && data.success === true && data.data !== undefined) return data.data;
      return data;
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  }

  // ---- public: 登录 ----
  async function login(username, password) {
    if (!username || !password) throw new Error('请输入用户名和密码');
    const data = await _request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.trim(), password })
    });
    if (data && data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      return { token: data.token, user: data.user || null };
    }
    throw new Error('登录响应格式异常');
  }

  // ---- public: 注册 ----
  async function register({ username, password, coachName, wechat, level }) {
    if (!username || !password || !coachName || !wechat) {
      throw new Error('请填写完整注册信息');
    }
    const data = await _request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: username.trim(),
        password,
        teamName: coachName,
        coachName: coachName.trim(),
        wechat: wechat.trim(),
        level: level || 'C'
      })
    });
    if (data && data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      return { token: data.token, user: data.user || null };
    }
    throw new Error('注册响应格式异常');
  }

  // ---- public: 获取当前登录用户信息（用 token 换 user）----
  async function fetchMe() {
    const data = await _request('/api/auth/me', { method: 'GET' });
    if (data && data.user) return data.user;
    if (data && data.id) return data; // 直接返回 user 对象
    throw new Error('获取用户信息失败');
  }

  // ---- public: 登出（仅清除本地，不调 API）----
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
  }

  // ---- public: 读取本地 token（供 SocketManager 注入）----
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  // ---- public: 检查本地是否有 token（不代表 token 仍有效）----
  function hasToken() {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  // ---- public: 清除本地 token（401 时调用）----
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  return {
    login,
    register,
    fetchMe,
    logout,
    getToken,
    hasToken,
    clearToken
  };
})();

window.AuthApi = AuthApi;
