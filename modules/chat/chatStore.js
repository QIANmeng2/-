/**
 * chatStore.js — 聊天状态管理（IIFE 闭包）
 * 禁止：读取 window.xxx、currentUser 全局变量
 * 仅通过 getState() 暴露数据，通过 setState() 受控修改
 */
const ChatStore = (() => {
  // ====== 闭包状态（外部无法直接修改）======
  let state = {
    // 房间状态
    activeRoom: null,        // { type: 'public'|'private'|'team'|'club', targetId: null|string }
    joinedRoom: null,         // 已 join 的房间（防止重连后重复 join）

    // 消息
    messages: [],             // 当前房间消息列表
    messagesOffset: 0,        // 分页偏移

    // 未读计数（按房间类型）
    unreadCounts: { public: 0, private: 0, team: 0, club: 0 },

    // 正在输入的用户
    typingUsers: [],

    // 当前用户（由 authStore 注入，不读 window.currentUser）
    currentUser: null,

    // 面板数据（原 chatPanelData）
    myTeams: [],
    myClubs: [],
    contacts: [],

    // 连接状态（从 SocketManager 同步）
    isConnected: false,

    // 监听器
    _subscribers: []
  };

  // ====== 公开 API ======
  return {
    /**
     * 获取当前状态（返回浅拷贝，防止外部直接修改）
     */
    getState: () => ({ ...state, messages: [...state.messages], typingUsers: [...state.typingUsers] }),

    /**
     * 受控更新状态
     * @param {Object} patch - 要合并的状态片段
     */
    setState: (patch) => {
      const oldState = { ...state };
      state = { ...state, ...patch };
      // 通知所有订阅者
      state._subscribers.forEach(cb => {
        try { cb(state, oldState); } catch (e) { console.error('[ChatStore] subscriber error:', e); }
      });
    },

    /**
     * 订阅状态变化
     * @param {Function} cb - (newState, oldState) => void
     * @returns {Function} unsubscribe
     */
    subscribe: (cb) => {
      state._subscribers.push(cb);
      return () => {
        state._subscribers = state._subscribers.filter(c => c !== cb);
      };
    },

    // ====== 消息操作 ======
    /**
     * 添加一条消息（去重 by id）
     */
    addMessage: (msg) => {
      if (state.messages.some(m => m.id === msg.id)) return;
      const newMessages = [...state.messages, msg];
      state = { ...state, messages: newMessages };
      state._subscribers.forEach(cb => {
        try { cb(state, state); } catch (e) {}
      });
    },

    /**
     * 批量设置消息（切换房间时调用）
     */
    setMessages: (msgs) => {
      const unique = [];
      const ids = new Set();
      msgs.forEach(m => {
        if (!ids.has(m.id)) { ids.add(m.id); unique.push(m); }
      });
      state = { ...state, messages: unique, messagesOffset: unique.length };
      state._subscribers.forEach(cb => {
        try { cb(state, state); } catch (e) {}
      });
    },

    /**
     * 撤回消息（本地更新）
     */
    recallMessage: (messageId) => {
      const newMessages = state.messages.map(m =>
        m.id === messageId ? { ...m, recalled: true, content: '', recalled_by: state.currentUser?.id || '' } : m
      );
      state = { ...state, messages: newMessages };
      state._subscribers.forEach(cb => {
        try { cb(state, state); } catch (e) {}
      });
    },

    // ====== 未读计数 ======
    incUnread: (type) => {
      const counts = { ...state.unreadCounts, [type]: (state.unreadCounts[type] || 0) + 1 };
      state = { ...state, unreadCounts: counts };
      state._subscribers.forEach(cb => {
        try { cb(state, state); } catch (e) {}
      });
    },

    clearUnread: (type) => {
      const counts = { ...state.unreadCounts, [type]: 0 };
      state = { ...state, unreadCounts: counts };
      state._subscribers.forEach(cb => {
        try { cb(state, state); } catch (e) {}
      });
    },

    getTotalUnread: () => Object.values(state.unreadCounts).reduce((a, b) => a + b, 0),

    // ====== 用户注入（由 authStore 调用，不读 window）======
    setCurrentUser: (user) => {
      state = { ...state, currentUser: user ? { ...user } : null };
    },

    // ====== 调试（仅开发环境）======
    _dump: () => ({ ...state, _subscribers: state._subscribers.length })
  };
})();

// 仅暴露 ChatStore 到全局（供 Page 初始化，不供其他模块直接读状态）
window.ChatStore = ChatStore;
