/**
 * notifStore — 通知状态管理（IIFE 闭包）
 * 职责：存储通知列表、未读数，提供可预测的状态读取
 * 禁止：不操作 DOM，不读/写 localStorage
 * version: 20260523a
 */
const NotifStore = (() => {
  'use strict';

  // ---- 内部状态 ----
  let state = {
    notifications: [],   // { id, type, content, read, created_at, relatedId }
    announcements: [],   // { id, title, content, created_at }
    unreadCount: 0,
    loaded: false
  };

  const listeners = []; // (newState) => void

  // ---- 私有：通知所有监听者 ----
  function _notify() {
    const snapshot = {
      ...state,
      notifications: state.notifications.map(n => ({ ...n })),
      announcements: state.announcements.map(a => ({ ...a }))
    };
    listeners.forEach(fn => { try { fn(snapshot); } catch(e) { console.error('[NotifStore] listener error:', e); } });
  }

  // ---- public: 设置通知列表 ----
  function setNotifications(notifications) {
    if (!Array.isArray(notifications)) return;
    state.notifications = notifications.map(n => ({ ...n }));
    state.unreadCount = notifications.filter(n => !n.read).length;
    state.loaded = true;
    _notify();
  }

  // ---- public: 追加单条通知（socket 推送）----
  function appendNotification(notif) {
    state.notifications.unshift({ ...notif });
    if (!notif.read) state.unreadCount++;
    _notify();
  }

  // ---- public: 标记单条已读 ----
  function markRead(notifId) {
    const n = state.notifications.find(x => x.id == notifId);
    if (n && !n.read) { n.read = true; state.unreadCount = Math.max(0, state.unreadCount - 1); _notify(); }
  }

  // ---- public: 全部已读 ----
  function markAllRead() {
    state.notifications.forEach(n => n.read = true);
    state.unreadCount = 0;
    _notify();
  }

  // ---- public: 设置公告列表 ----
  function setAnnouncements(ann) {
    if (!Array.isArray(ann)) return;
    state.announcements = ann.map(a => ({ ...a }));
    _notify();
  }

  // ---- public: 读取状态快照 ----
  function getState() {
    return {
      ...state,
      notifications: state.notifications.map(n => ({ ...n })),
      announcements: state.announcements.map(a => ({ ...a }))
    };
  }
  function getUnreadCount() { return state.unreadCount; }
  function getNotifications() { return state.notifications.map(n => ({ ...n })); }
  function getAnnouncements() { return state.announcements.map(a => ({ ...a })); }

  // ---- public: 订阅状态变化 ----
  function subscribe(callback) {
    listeners.push(callback);
    // 立刻回调用当前状态
    try { callback(getState()); } catch(e) {}
    return () => { listeners = listeners.filter(fn => fn !== callback); };
  }

  // ---- public: 销毁 ----
  function destroy() {
    listeners.length = 0;
    state.notifications = [];
    state.announcements = [];
    state.unreadCount = 0;
    state.loaded = false;
  }

  return {
    setNotifications,
    appendNotification,
    markRead,
    markAllRead,
    setAnnouncements,
    getState,
    getUnreadCount,
    getNotifications,
    getAnnouncements,
    subscribe,
    destroy
  };
})();

window.NotifStore = NotifStore;
