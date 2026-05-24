/**
 * socketReconnect — 重连策略控制器（IIFE 闭包）
 * 职责：指数退避、心跳检测、断线后的用户通知
 * 禁止：直接操作 socket 实例，仅通过 SocketManager API
 * version: 20260523a
 */
const SocketReconnect = (() => {
  'use strict';

  const MAX_BACKOFF_MS = 30000;   // 最大退避 30s
  const HEARTBEAT_INTERVAL = 30000; // 心跳 30s
  const HEARTBEAT_TIMEOUT = 8000;   // 心跳超时 8s

  let enabled = true;
  let heartbeatTimer = null;
  let heartbeatTimeout = null;
  let lastPong = Date.now();
  let statusCallback = null;          // (state) => void  状态变化通知
  let toastCallback = null;           // (msg, type) => void  用户通知

  // ===== 内部：指数退避延迟计算 =====
  function _calcBackoff(attempt) {
    const base = 1000 * Math.pow(2, Math.min(attempt, 5));
    return Math.min(base, MAX_BACKOFF_MS) + Math.random() * 1000;
  }

  // ===== 心跳：启动 =====
  function _startHeartbeat() {
    _stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!window.SocketManager?.isConnected()) return;
      // 用 Socket.io 内置 ping 机制，不需要手动 emit
      // 这里仅做超时检测
      const elapsed = Date.now() - lastPong;
      if (elapsed > HEARTBEAT_TIMEOUT) {
        console.warn('[Reconnect] 心跳超时，主动断开重连');
        window.SocketManager?.disconnect();
        window.SocketManager?.connect();
      }
    }, HEARTBEAT_INTERVAL);
  }

  // ===== 心跳：停止 =====
  function _stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
  }

  // ===== 公共：初始化（绑定 SocketManager 事件）=====
  function init(opts = {}) {
    statusCallback = opts.onStatusChange || null;
    toastCallback = opts.onToast || null;

    const sm = window.SocketManager;
    if (!sm) {
      console.error('[Reconnect] SocketManager 未找到，初始化失败');
      return;
    }

    // 连接成功 → 启动心跳
    sm.on('statusChange', (newStatus) => {
      if (newStatus === 'connected') {
        lastPong = Date.now();
        _startHeartbeat();
        _notifyStatus('connected');
        _notifyToast('聊天连接已恢复', 'success');
      } else if (newStatus === 'disconnected') {
        _stopHeartbeat();
        _notifyStatus('disconnected');
        _notifyToast('聊天连接已断开，正在重连...', 'warning');
      } else if (newStatus === 'reconnecting') {
        _notifyStatus('reconnecting');
      }
    });

    // pong 响应（若后端实现了 pong 事件）
    sm.on('pong', () => {
      lastPong = Date.now();
    });

    // 认证失败 → 提醒用户重新登录
    sm.on('authError', () => {
      _notifyToast('聊天认证失败，请重新登录', 'error');
      _notifyStatus('auth_error');
    });

    console.log('[Reconnect] 初始化完成');
  }

  // ===== 公共：销毁 =====
  function destroy() {
    _stopHeartbeat();
    statusCallback = null;
    toastCallback = null;
  }

  // ===== 内部：通知状态变化 =====
  function _notifyStatus(state) {
    if (statusCallback) {
      try { statusCallback(state); } catch (e) { console.error('[Reconnect] statusCallback error:', e); }
    }
  }

  // ===== 内部：通知用户（toast）=====
  function _notifyToast(msg, type = 'info') {
    if (toastCallback) {
      try { toastCallback(msg, type); } catch (e) { console.error('[Reconnect] toastCallback error:', e); }
    }
  }

  // ===== 公共：手动触发重连 =====
  function reconnect() {
    const sm = window.SocketManager;
    if (!sm) return;
    sm.disconnect();
    setTimeout(() => sm.connect(), 500);
  }

  // ===== 公共：启用/禁用 =====
  function setEnabled(val) { enabled = !!val; }

  return { init, destroy, reconnect, setEnabled, _calcBackoff };
})();

window.SocketReconnect = SocketReconnect;
