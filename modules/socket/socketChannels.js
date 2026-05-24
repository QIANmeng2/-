/**
 * socketChannels — 房间/频道管理（IIFE 闭包）
 * 职责：封装 join/leave 逻辑，维护当前房间状态
 * 禁止：直接操作 socket，必须通过 SocketManager.emit()
 * version: 20260523a
 */
const SocketChannels = (() => {
  'use strict';

  let currentType = null;   // 'public' | 'private' | 'team' | 'club' | null
  let currentTarget = null; // { team_id, club_id, receiver_id } | null
  let listeners = [];        // 房间切换监听器

  // ===== public: 切换到新房间 =====
  function switchRoom(type, target = null) {
    const oldType = currentType;
    const oldTarget = currentTarget ? { ...currentTarget } : null;

    // 离开旧房间
    if (oldType) {
      window.SocketManager?.leaveRoom(oldType, oldTarget);
    }

    // 加入新房间
    currentType = type;
    currentTarget = target ? { ...target } : null;

    if (type) {
      window.SocketManager?.joinRoom(type, currentTarget);
    }

    // 通知监听者
    listeners.forEach(fn => {
      try { fn({ type, target: currentTarget, oldType, oldTarget }); } catch(e) { console.error('[Channels] listener error:', e); }
    });
  }

  // ===== public: 获取当前房间 =====
  function getCurrentRoom() {
    return { type: currentType, target: currentTarget ? { ...currentTarget } : null };
  }

  // ===== public: 离开所有房间 =====
  function leaveAll() {
    if (currentType) {
      window.SocketManager?.leaveRoom(currentType, currentTarget);
      currentType = null;
      currentTarget = null;
    }
  }

  // ===== public: 订阅房间切换事件 =====
  function onChange(callback) {
    listeners.push(callback);
    return () => { listeners = listeners.filter(fn => fn !== callback); };
  }

  // ===== public: 初始化（供 Page 层调用）=====
  function init() {
    // 监听 SocketManager 状态，断线时清除房间状态
    window.SocketManager?.on('statusChange', (newStatus) => {
      if (newStatus === 'disconnected' || newStatus === 'reconnecting') {
        currentType = null;
        currentTarget = null;
      }
    });
  }

  // ===== public: 销毁 =====
  function destroy() {
    leaveAll();
    listeners = [];
  }

  return { switchRoom, getCurrentRoom, leaveAll, onChange, init, destroy };
})();

window.SocketChannels = SocketChannels;
