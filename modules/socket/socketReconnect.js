/**
 * socketReconnect.js — 心跳检测 + 重连辅助（IIFE 闭包）
 *
 * 职责：
 *   - 启动/停止心跳（由 SocketManager 调用）
 *   - 提供 onReconnect 注册（兼容旧模块）
 *   - 不直接操作 socket，只暴露工具方法
 *
 * 依赖：window.SocketManager
 * 外部暴露：window.SocketReconnect
 */

;(function() {
  'use strict';

  var _heartbeatTimer  = null;
  var _timeoutTimer     = null;
  var _reconnectCbs    = [];
  var _PING_INTERVAL = 30000;  // 30s
  var _PING_TIMEOUT  = 8000;    // 8s

  var _sm = null;

  // ===== 内部 =====

  function _getSM() {
    if (!_sm) _sm = window.SocketManager || null;
    return _sm;
  }

  function _clearTimers() {
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    if (_timeoutTimer)  { clearTimeout(_timeoutTimer);  _timeoutTimer  = null; }
  }

  function _emitReconnect() {
    _reconnectCbs.forEach(function(cb) {
      try { cb(); } catch(e) { console.error('[SockReconn] cb error:', e); }
    });
  }

  // ===== 公开 API =====

  /**
   * 启动心跳（由 SocketManager.connect() 成功后调用）
   */
  function startHeartbeat() {
    _clearTimers();
    _heartbeatTimer = setInterval(function() {
      var SM = _getSM();
      if (!SM || !SM.getSocket) return;
      var socket = SM.getSocket();
      if (!socket || !socket.connected) return;

      socket.emit('ping');
      // 8s 超时
      _timeoutTimer = setTimeout(function() {
        console.warn('[SockReconn] ping timeout → disconnect');
        socket.disconnect();
      }, _PING_TIMEOUT);
    }, _PING_INTERVAL);
    console.log('[SockReconn] heartbeat started');
  }

  /**
   * 停止心跳
   */
  function stopHeartbeat() {
    _clearTimers();
    console.log('[SockReconn] heartbeat stopped');
  }

  /**
   * 注册重连回调（兼容旧模块）
   * @return {number} 回调索引
   */
  function onReconnect(cb) {
    if (typeof cb !== 'function') return -1;
    _reconnectCbs.push(cb);
    return _reconnectCbs.length - 1;
  }

  /**
   * 注销重连回调
   */
  function offReconnect(idx) {
    if (idx >= 0 && idx < _reconnectCbs.length) {
      _reconnectCbs[idx] = null;
    }
  }

  /**
   * 触发所有重连回调（由外部/SocketManager 在 reconnect 事件时调用）
   */
  function triggerReconnect() {
    _emitReconnect();
  }

  /**
   * 初始化（绑定 SocketManager 的 reconnect 事件）
   */
  function init() {
    var SM = _getSM();
    if (!SM) { setTimeout(init, 500); return; }

    // 如果 SocketManager 提供 onReconnect，注册
    if (typeof SM.onReconnect === 'function') {
      SM.onReconnect(triggerReconnect);
      console.log('[SockReconn] bound to SocketManager.onReconnect');
    }

    // 监听 connected / reconnected 事件
    if (window.SocketEvents && window.SocketEvents.on) {
      window.SocketEvents.on('connected',    function() { startHeartbeat(); });
      window.SocketEvents.on('reconnected',  function() { startHeartbeat(); });
      window.SocketEvents.on('disconnected', function() { stopHeartbeat(); });
    }

    console.log('[SockReconn] init');
  }

  // ===== 暴露 =====
  window.SocketReconnect = {
    init:            init,
    startHeartbeat:   startHeartbeat,
    stopHeartbeat:    stopHeartbeat,
    onReconnect:      onReconnect,
    offReconnect:     offReconnect,
    triggerReconnect: triggerReconnect
  };

  // 自启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  console.log('[SockReconn] loaded');

})();
