/**
 * socketManager.js — WebSocket 连接管理（IIFE 闭包）
 *
 * 职责：
 *   1. 创建并管理唯一 socket 实例
 *   2. 封装 connect / disconnect / getSocket
 *   3. 提供 onReconnect(cb) 注册机制（供业务模块注入重连逻辑）
 *   4. 心跳检测（30s ping + 8s 超时）
 *
 * 外部暴露：window.SocketManager
 */

;(function() {
  'use strict';

  var _socket  = null;
  var _connected = false;
  var _reconnectCbs = [];   // onReconnect 回调列表
  var _heartbeatTimer = null;
  var _heartbeatTimeout = null;
  var _token = null;

  // ===== 内部方法 =====

  function _getToken() {
    try { return localStorage.getItem('token'); } catch(e) { return null; }
  }

  function _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = setInterval(function() {
      if (!_socket || !_socket.connected) return;
      _socket.emit('ping');
      // 8s 超时
      _heartbeatTimeout = setTimeout(function() {
        console.warn('[SocketMgr] ping timeout, disconnecting...');
        _socket.disconnect();
      }, 8000);
    }, 30000);
  }

  function _stopHeartbeat() {
    if (_heartbeatTimer)    { clearInterval(_heartbeatTimer);    _heartbeatTimer = null; }
    if (_heartbeatTimeout) { clearTimeout(_heartbeatTimeout); _heartbeatTimeout = null; }
  }

  function _emitReconnect() {
    _reconnectCbs.forEach(function(cb) {
      try { cb(); } catch(e) { console.error('[SocketMgr] reconnect cb error:', e); }
    });
  }

  // ===== 公开 API =====

  /**
   * 初始化连接（页面入口调用一次）
   */
  function connect() {
    if (_socket) return;

    var io = window.io;
    if (!io) { console.error('[SocketMgr] window.io not loaded (missing socket.io client)'); return; }

    _token = _getToken();

    _socket = io({
      path:               '/socket.io',
      transports:         ['websocket', 'polling'],
      reconnection:        true,
      reconnectionDelay:   3000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,   // 无限重连
      timeout:            10000,
      upgrade:            false
    });

    // —— 连接成功 ——
    _socket.on('connect', function() {
      _connected = true;
      console.log('[SocketMgr] connected:', _socket.id);
      // 认证
      if (_token) _socket.emit('authenticate', _token);
      _startHeartbeat();
      // emit 给业务模块
      if (window.SocketEvents && window.SocketEvents.emit) {
        window.SocketEvents.emit('connected');
      }
    });

    // —— 认证成功 ——
    _socket.on('authenticated', function(data) {
      console.log('[SocketMgr] authenticated:', data && data.userId);
    });

    // —— 认证失败 ——
    _socket.on('auth_error', function(data) {
      console.error('[SocketMgr] auth_error:', data && data.message);
    });

    // —— 断开 ——
    _socket.on('disconnect', function(reason) {
      _connected = false;
      console.log('[SocketMgr] disconnected:', reason);
      _stopHeartbeat();
      if (window.SocketEvents && window.SocketEvents.emit) {
        window.SocketEvents.emit('disconnected', reason);
      }
    });

    // —— 重连成功 ——
    _socket.on('reconnect', function() {
      _connected = true;
      console.log('[SocketMgr] reconnected');
      if (_token) _socket.emit('authenticate', _token);
      _startHeartbeat();
      _emitReconnect();   // 通知所有注册的业务模块
      if (window.SocketEvents && window.SocketEvents.emit) {
        window.SocketEvents.emit('reconnected');
      }
    });

    // —— pong ——
    _socket.on('pong', function() {
      if (_heartbeatTimeout) { clearTimeout(_heartbeatTimeout); _heartbeatTimeout = null; }
    });

    console.log('[SocketMgr] initialized');
  }

  /**
   * 断开连接
   */
  function disconnect() {
    _stopHeartbeat();
    if (_socket) {
      _socket.disconnect();
      _socket = null;
    }
    _connected = false;
  }

  /**
   * 获取 socket 实例
   */
  function getSocket() { return _socket; }

  /**
   * 是否已连接
   */
  function isConnected() { return !!(_socket && _connected); }

  /**
   * 注册重连回调（业务模块调用）
   * @param {Function} cb —— 重连成功后执行
   * @return {number} 回调 ID（用于 unregisterReconnectCb）
   */
  function onReconnect(cb) {
    if (typeof cb !== 'function') return -1;
    _reconnectCbs.push(cb);
    return _reconnectCbs.length - 1;  // 返回索引作为 ID
  }

  /**
   * 注销重连回调
   */
  function offReconnect(idx) {
    if (idx >= 0 && idx < _reconnectCbs.length) {
      _reconnectCbs[idx] = null;  // 保留索引，避免其他回调错位
    }
  }

  // ===== 暴露 =====
  window.SocketManager = {
    connect:          connect,
    disconnect:       disconnect,
    getSocket:        getSocket,
    isConnected:      isConnected,
    onReconnect:      onReconnect,
    offReconnect:     offReconnect
  };

  console.log('[SocketMgr] loaded (call SocketManager.connect() to start)');

})();
