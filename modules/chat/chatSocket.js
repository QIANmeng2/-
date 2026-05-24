/**
 * chatSocket.js — 聊天 Socket 事件层
 * 依赖：SocketManager（已有 modules/socket/socketManager.js）
 * 禁止：自己创建 socket、读取 window.chatSocket、污染全局
 * 仅负责：监听服务端事件 → 调用 ChatStore 更新状态
 *
 * 生命周期：
 *   init()    — 绑定事件（在 SocketManager connect 后调用）
 *   destroy() — 移除所有 listener（页面销毁时调用）
 */
const ChatSocket = (() => {
  let _initialized = false;
  let _onNewMessage = null;
  let _onRecall     = null;
  let _onMute       = null;
  let _onUnmute    = null;

  /**
   * 获取 SocketManager 的 socket 实例（不自己创建）
   * @returns {Object|null}
   */
  const getSocket = () => {
    if (window.SocketManager && typeof window.SocketManager.getSocket === 'function') {
      return window.SocketManager.getSocket();
    }
    return null;
  };

  /**
   * 初始化事件监听（在 SocketManager 连上后调用）
   */
  const init = () => {
    if (_initialized) {
      console.warn('[ChatSocket] already initialized, skipping');
      return;
    }

    const socket = getSocket();
    if (!socket) {
      console.warn('[ChatSocket] socket not ready, will retry on connect event');
      // 监听 SocketManager 的 connect（通过事件总线或直接轮询）
      waitForSocket(init);
      return;
    }

    bindEvents(socket);
    _initialized = true;
    console.log('[ChatSocket] initialized');
  };

  /**
   * 等待 SocketManager 就绪（轮询，最多 50 次 = 5s）
   */
  const waitForSocket = (cb, retries = 0) => {
    if (retries > 50) {
      console.error('[ChatSocket] socket not ready after 5s, aborting');
      return;
    }
    if (getSocket() && getSocket().connected) {
      cb();
    } else {
      setTimeout(() => waitForSocket(cb, retries + 1), 100);
    }
  };

  /**
   * 绑定所有服务端事件
   */
  const bindEvents = (socket) => {
    // === new_message（核心）===
    _onNewMessage = (msg) => {
      try {
        // 写入 Store（由 View 层决定是否渲染）
        if (window.ChatStore) {
          window.ChatStore.addMessage(msg);

          // 如果消息不属于当前房间，增加未读计数
          const state = window.ChatStore.getState();
          const activeRoom = state.activeRoom;
          const isCurrentRoom =
            activeRoom &&
            msg.type === activeRoom.type &&
            String(msg.target_id || '') === String(activeRoom.targetId || '');
          if (!isCurrentRoom) {
            window.ChatStore.incUnread(msg.type);
          }
        }
      } catch (e) {
        console.error('[ChatSocket] new_message handler error:', e);
      }
    };
    socket.on('new_message', _onNewMessage);

    // === message_recalled ===
    _onRecall = (data) => {
      try {
        if (window.ChatStore) {
          window.ChatStore.recallMessage(data.messageId);
        }
      } catch (e) {
        console.error('[ChatSocket] message_recalled handler error:', e);
      }
    };
    socket.on('message_recalled', _onRecall);

    // === user_muted ===
    _onMute = (data) => {
      try {
        const state = window.ChatStore?.getState();
        if (data.userId === state?.currentUser?.id || !data.userId) {
          // 由 View 层显示提示
          if (window.ChatView) {
            window.ChatView.showToast(
              '你已被禁言至 ' + new Date(data.until).toLocaleString('zh-CN') +
              (data.reason ? '，原因：' + data.reason : ''),
              'warning',
              5000
            );
          }
        }
      } catch (e) {}
    };
    socket.on('user_muted', _onMute);

    // === user_unmuted ===
    _onUnmute = (data) => {
      try {
        const state = window.ChatStore?.getState();
        if (data.userId === state?.currentUser?.id || !data.userId) {
          if (window.ChatView) {
            window.ChatView.showToast('你已被解除禁言', 'success');
          }
        }
      } catch (e) {}
    };
    socket.on('user_unmuted', _onUnmute);

    // === 注意：reconnect 由 SocketManager 统一管理，不在这里监听 ===
    // ChatRoomManager.init() 会通过 SocketManager.onReconnect() 注册 rejoin 回调
  };

  /**
   * 销毁：移除所有 listener（离开聊天页时调用）
   */
  const destroy = () => {
    const socket = getSocket();
    if (socket) {
      if (_onNewMessage) socket.off('new_message', _onNewMessage);
      if (_onRecall)     socket.off('message_recalled', _onRecall);
      if (_onMute)       socket.off('user_muted', _onMute);
      if (_onUnmute)     socket.off('user_unmuted', _onUnmute);
      // reconnect 是 SocketManager 管理的，不在这里 off
    }
    _onNewMessage = null;
    _onRecall     = null;
    _onMute       = null;
    _onUnmute    = null;
    _initialized  = false;
    console.log('[ChatSocket] destroyed');
  };

  return { init, destroy, getSocket };
})();

window.ChatSocket = ChatSocket;
