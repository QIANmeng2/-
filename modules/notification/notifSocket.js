/**
 * notifSocket — 通知 socket 事件（IIFE 闭包）
 * 职责：监听通知相关 socket 事件，更新 Store，触发 View 刷新
 * 禁止：直接操作 DOM，通过回调通知 Page 层
 * version: 20260523a
 */
const NotifSocket = (() => {
  'use strict';

  let onNewNotification = null;   // (notif) => void
  let onRefreshBadge = null;    // () => void  通知 Store 刷新未读数

  // ---- 内部：注册 socket 事件 ----
  function _bindEvents() {
    const sm = window.SocketManager;
    if (!sm) return;

    // 后端若推新通知事件（可扩展）
    sm.on('new_notification', (data) => {
      console.log('[NotifSocket] 新通知:', data);
      if (data && data.notification) {
        window.NotifStore?.appendNotification(data.notification);
      }
      if (onNewNotification && data && data.notification) {
        try { onNewNotification(data.notification); } catch(e) { console.error('[NotifSocket] onNewNotification error:', e); }
      }
      if (onRefreshBadge) {
        try { onRefreshBadge(); } catch(e) { console.error('[NotifSocket] onRefreshBadge error:', e); }
      }
    });

    // 后端若推通知已读事件（多端同步）
    sm.on('notifications_read', (data) => {
      console.log('[NotifSocket] 通知已读同步:', data);
      if (data && Array.isArray(data.ids)) {
        data.ids.forEach(id => window.NotifStore?.markRead(id));
      } else {
        window.NotifStore?.markAllRead();
      }
      if (onRefreshBadge) { try { onRefreshBadge(); } catch(e) {} }
    });
  }

  // ---- public: 初始化（Page 层调用）----
  function init(opts = {}) {
    onNewNotification = typeof opts.onNewNotification === 'function' ? opts.onNewNotification : null;
    onRefreshBadge = typeof opts.onRefreshBadge === 'function' ? opts.onRefreshBadge : null;

    // 等待 SocketManager 就绪后绑定
    const sm = window.SocketManager;
    if (sm && sm.isConnected && sm.isConnected()) {
      _bindEvents();
    } else {
      // 延迟到连接成功后再绑定
      const check = setInterval(() => {
        if (window.SocketManager && window.SocketManager.isConnected && window.SocketManager.isConnected()) {
          _bindEvents();
          clearInterval(check);
        }
      }, 500);
      // 安全上限：10 秒后停止等待
      setTimeout(() => clearInterval(check), 10000);
    }

    console.log('[NotifSocket] 初始化完成');
  }

  // ---- public: 销毁 ----
  function destroy() {
    onNewNotification = null;
    onRefreshBadge = null;
    // 事件解绑由 SocketManager 销毁时统一清理
  }

  return { init, destroy };
})();

window.NotifSocket = NotifSocket;
