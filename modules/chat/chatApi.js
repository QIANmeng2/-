/**
 * chatApi.js — 聊天 HTTP 接口层
 * 禁止：操作 DOM、读取 window.xxx、直接修改 Store
 * 仅负责 HTTP 请求 + 解包 { success, data }
 */
const ChatApi = (() => {
  const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';

  /**
   * 通用请求包装（带超时 + 自动 Authorization header）
   */
  const request = async (endpoint, options = {}) => {
    const token = localStorage.getItem('local_current_user')
      ? JSON.parse(localStorage.getItem('local_current_user')).token
      : null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {})
    };

    try {
      const res = await fetch(API_BASE + endpoint, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 401) {
          // 不自动 logout，由调用者决定
          throw new Error('未授权，请重新登录');
        }
        throw new Error('HTTP ' + res.status);
      }

      const json = await res.json();
      // 自动解包 { success: true, data: ... }
      if (json && typeof json === 'object' && 'success' in json) {
        if (!json.success) throw new Error(json.message || '请求失败');
        return json.data;
      }
      return json;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') throw new Error('请求超时，请检查网络');
      throw e;
    }
  };

  return {
    /**
     * 发送消息
     * @param {Object} body - { type, content, receiver_id?, team_id?, club_id? }
     * @returns {Promise<Object>} { message: {...} }
     */
    sendMessage: (body) =>
      request('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify(body)
      }),

    /**
     * 加载消息历史（分页）
     * @param {Object} params - { type, receiver_id?, team_id?, club_id?, offset?, limit? }
     * @returns {Promise<Array>}
     */
    loadMessages: (params) => {
      const qs = Object.entries(params || {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
      return request('/api/chat/fetch?' + qs, { method: 'GET' });
    },

    /**
     * 撤回消息
     * @param {string|number} messageId
     * @returns {Promise<void>}
     */
    recallMessage: (messageId) =>
      request('/api/chat/' + messageId + '/recall', { method: 'PUT' }),

    /**
     * 标记消息已读
     * @param {Object} params - { type, sender_id?, team_id?, club_id? }
     * @returns {Promise<void>}
     */
    markRead: (params) => {
      const qs = new URLSearchParams(params).toString();
      return request('/api/chat/read?' + qs, { method: 'PUT' });
    },

    /**
     * 获取我的队伍列表（用于聊天室选择）
     * @returns {Promise<Array>}
     */
    getMyTeams: () => request('/api/chat/my-teams', { method: 'GET' }),

    /**
     * 获取我的俱乐部列表
     * @returns {Promise<Array>}
     */
    getMyClubs: () => request('/api/chat/my-clubs', { method: 'GET' }),

    /**
     * 获取最近私聊联系人列表
     * @returns {Promise<Array>}
     */
    getContacts: () => request('/api/chat/contacts', { method: 'GET' }),

    /**
     * 搜索用户（用于发起私聊）
     * @param {string} query
     * @returns {Promise<Array>}
     */
    searchUsers: (query) =>
      request('/api/users/search?q=' + encodeURIComponent(query), { method: 'GET' })
  };
})();

window.ChatApi = ChatApi;
