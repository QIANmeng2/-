/**
 * chatRoomManager.js — 聊天房间生命周期管理
 * 依赖：SocketManager（已有）、ChatStore、ChatApi、ChatSocket
 * 禁止：读取 window.chatCurrentType / window.chatCurrentTarget / window.chatSocket
 * 负责：join / leave / switch 房间，与 Store 解耦
 *
 * 关键保证：
 *   1. 离开旧房间后再 join 新房間（不重复 join）
 *   2. 切换房间时先清空 messages（防串消息）
 *   3. reconnect 后只 rejoin 当前房间（不重复 join 旧房间）
 *   4. destroy() 时 leave 房间 + 移除所有 listener
 */
const ChatRoomManager = (() => {
  // ====== 闭包状态 ======
  let _joinedRoom    = null;   // 已 join 的房间 { type, targetId }
  let _isSwitching   = false;  // 防重入锁
  let _destroyed     = false;
  let _onStateChange = null;   // Store subscribe 取消函数

  const getSocket = () => {
    if (window.SocketManager && typeof window.SocketManager.getSocket === 'function') {
      return window.SocketManager.getSocket();
    }
    return null;
  };

  // ====== 核心方法 ======
  /**
   * join 房间（内部使用，带去重）
   * @param {string} type - 'public'|'private'|'team'|'club'
   * @param {string|null} targetId
   */
  const _joinRoom = (type, targetId = null) => {
    if (_destroyed) return;
    const socket = getSocket();
    if (!socket || !socket.connected) {
      console.warn('[ChatRoom] socket not ready, skipping join');
      return;
    }

    // 去重：已经在这个房间就不再 join
    if (_joinedRoom &&
        _joinedRoom.type === type &&
        String(_joinedRoom.targetId || '') === String(targetId || '')) {
      console.log('[ChatRoom] already in room', type, targetId);
      return;
    }

    // 先 leave 旧房间
    _leaveCurrentRoom();

    const payload = { type };
    if (type === 'private' && targetId) payload.receiver_id = targetId;
    if (type === 'team'    && targetId) payload.team_id    = targetId;
    if (type === 'club'    && targetId) payload.club_id    = targetId;

    socket.emit('join_room', payload);
    _joinedRoom = { type, targetId };
    console.log('[ChatRoom] joined', payload);
  };

  /**
   * leave 当前房间（内部使用）
   */
  const _leaveCurrentRoom = () => {
    if (!_joinedRoom) return;
    const socket = getSocket();
    if (!socket || !socket.connected) return;

    const { type, targetId } = _joinedRoom;
    const payload = { type };
    if (type === 'private' && targetId) payload.receiver_id = targetId;
    if (type === 'team'    && targetId) payload.team_id    = targetId;
    if (type === 'club'    && targetId) payload.club_id    = targetId;

    socket.emit('leave_room', payload);
    console.log('[ChatRoom] left', payload);
    _joinedRoom = null;
  };

  // ====== 公开 API ======
  return {
    /**
     * 切换到新房间（核心入口）
     * 保证顺序：leave → 清空消息 → join → 加载历史
     *
     * @param {string} type
     * @param {string|null} targetId
     * @returns {Promise<void>}
     */
    switchRoom: async (type, targetId = null) => {
      if (_isSwitching) {
        console.warn('[ChatRoom] switchRoom already in progress, skipping');
        return;
      }
      _isSwitching = true;

      try {
        // 1. 更新 Store：设置 activeRoom + 清空消息 + 清除未读
        if (window.ChatStore) {
          window.ChatStore.setState({
            activeRoom: { type, targetId },
            joinedRoom: { type, targetId }
          });
          window.ChatStore.setMessages([]);   // 先清空，防串消息
          window.ChatStore.clearUnread(type);
        }

        // 2. join 新房間（会先 leave 旧房间）
        _joinRoom(type, targetId);

        // 3. 加载历史消息
        if (window.ChatApi) {
          const params = { type, offset: 0, limit: 50 };
          if (type === 'private' && targetId) params.receiver_id = targetId;
          if (type === 'team'    && targetId) params.team_id    = targetId;
          if (type === 'club'    && targetId) params.club_id    = targetId;

          const data = await window.ChatApi.loadMessages(params);
          const messages = data.messages || data || [];
          if (window.ChatStore) {
            window.ChatStore.setMessages(messages);
          }
          // 触发 View 渲染（通过 Store subscribe）
        }

        console.log('[ChatRoom] switched to', type, targetId);
      } catch (e) {
        console.error('[ChatRoom] switchRoom error:', e);
        if (window.ChatView) {
          window.ChatView.showToast('加载消息失败: ' + e.message, 'error');
        }
      } finally {
        _isSwitching = false;
      }
    },

    /**
     * 重新 join 当前房间（reconnect 后调用）
     * 不带参数，只 rejoin _joinedRoom
     */
    rejoinCurrentRoom: () => {
      if (!_joinedRoom) return;
      // 重置 _joinedRoom 强制重新 join
      const { type, targetId } = _joinedRoom;
      _joinedRoom = null;
      _joinRoom(type, targetId);
      console.log('[ChatRoom] re-joined after reconnect', type, targetId);
    },

    /**
     * 离开当前房间（离开聊天页时调用）
     */
    leaveCurrentRoom: () => {
      _leaveCurrentRoom();
      if (window.ChatStore) {
        window.ChatStore.setState({ activeRoom: null, joinedRoom: null });
        window.ChatStore.setMessages([]);
      }
      console.log('[ChatRoom] left current room');
    },

    /**
     * 初始化（进入聊天页时调用）
     * 绑定 Store 变化 → 自动渲染 View
     */
    init: () => {
      if (_onStateChange) _onStateChange(); // 防止重复订阅

      // 订阅 Store 状态变化 → 通知 View 更新
      _onStateChange = window.ChatStore?.subscribe((state, oldState) => {
        // 消息变化时渲染
        if (state.messages !== oldState.messages) {
          if (window.ChatView && typeof window.ChatView.renderMessages === 'function') {
            window.ChatView.renderMessages(state.messages, state.currentUser);
          }
        }
        // 未读计数变化时更新 badge（由 renderRoomList 处理）
        if (state.unreadCounts !== oldState.unreadCounts) {
          if (window.ChatView && typeof window.ChatView.renderRoomList === 'function') {
            window.ChatView.renderRoomList(state);
          }
        }
        // 连接状态变化时更新图标
        if (state.isConnected !== oldState.isConnected) {
          if (window.ChatView && typeof window.ChatView.updateStatusIcon === 'function') {
            window.ChatView.updateStatusIcon(state.isConnected);
          }
        }
      });

      // 初始化 Socket 事件监听
      if (window.ChatSocket) {
        window.ChatSocket.init();
      }

      // 注册 reconnect 回调：网络恢复后自动 rejoin 当前房间
      if (window.SocketManager) {
        window.SocketManager.onReconnect(() => {
          if (_destroyed) return;
          if (_joinedRoom) {
            // 清除标记强制重新 join
            const { type, targetId } = _joinedRoom;
            _joinedRoom = null;
            _joinRoom(type, targetId);
            console.log('[ChatRoom] re-joined after reconnect', type, targetId);
          }
        });
      }

      console.log('[ChatRoom] initialized');
    },

    /**
     * 销毁（离开聊天页时调用）
     * 必须调用：leave 房间 + 取消订阅 + 销毁 Socket 监听
     */
    destroy: () => {
      _destroyed = true;
      _isSwitching = false;
      _leaveCurrentRoom();

      if (_onStateChange) {
        _onStateChange();  // unsubscribe
        _onStateChange = null;
      }
      if (window.ChatSocket) {
        window.ChatSocket.destroy();
      }

      console.log('[ChatRoom] destroyed');
    },

    /**
     * 获取当前房间（供 Page 层读取）
     */
    getCurrentRoom: () => {
      if (window.ChatStore) {
        return window.ChatStore.getState().activeRoom;
      }
      return null;
    },

    /**
     * 是否已销毁（供 Page 层判断）
     */
    isDestroyed: () => _destroyed
  };
})();

window.ChatRoomManager = ChatRoomManager;
