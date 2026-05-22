/**
 * chatRoomManager.js — 聊天房间生命周期管理（IIFE 闭包）
 *
 * 职责：
 *   1. 加入/离开房间（join_room / leave_room）
 *   2. 注册 SocketManager.onReconnect 回调（reconnect 后自动 rejoin）
 *   3. 同步 ChatStore 房间状态
 *   4. destroy() 时完整清理所有 listener 和 socket 回调
 *
 * 依赖：window.SocketManager / window.ChatStore / window.ChatView / window.ChatSocket
 * 禁止：自己监听 socket.reconnect（由本模块通过 SocketManager API 注册）
 * 外部暴露：window.ChatRoomManager
 */

;(function() {
  'use strict';

  var _currentRoomId = null;   // 当前已加入的房间
  var _currentUserId = null;     // 当前用户 ID（用于撤回权限判断）
  var _SM  = null;              // SocketManager 引用
  var _Store = null;
  var _View  = null;
  var _Socket = null;
  var _SM     = null;

  // 清理标记
  var _destroyed = false;
  var _reconnectCbRegistered = false;

  // ===== 内部方法 =====

  function _getSM() {
    if (!_SM) _SM = window.SocketManager || null;
    return _SM;
  }

  function _getStore() {
    if (!_Store) _Store = window.ChatStore || null;
    return _Store;
  }

  function _getView() {
    if (!_View) _View = window.ChatView || null;
    return _View;
  }

  function _getChatSocket() {
    if (!_Socket) _Socket = window.ChatSocket || null;
    return _Socket;
  }

  function _getMeId() {
    try {
      var me = JSON.parse(localStorage.getItem('user'));
      return me ? me.id : null;
    } catch(e) { return null; }
  }

  /**
   * 加入房间（带去重，防止 reconnect 重复 join）
   */
  function _joinRoom(roomId, cb) {
    if (_destroyed) return;
    if (!roomId) return;

    // 去重：已经在房间里就不再发 join_room
    if (_currentRoomId === roomId) {
      console.log('[ChatRoomMgr] already in room', roomId, '- skip duplicate join');
      if (cb) cb();
      return;
    }

    // 先离开旧房间
    if (_currentRoomId) {
      _leaveRoom(function() {
        _doJoin(roomId, cb);
      });
    } else {
      _doJoin(roomId, cb);
    }
  }

  function _doJoin(roomId, cb) {
    if (_destroyed) return;
    var SM = _getSM();
    if (!SM || !SM.getSocket) {
      console.warn('[ChatRoomMgr] Socket not ready, retry in 500ms');
      setTimeout(function() { _doJoin(roomId, cb); }, 500);
      return;
    }
    var socket = SM.getSocket();
    if (!socket || !socket.connected) {
      console.warn('[ChatRoomMgr] socket not connected, retry in 500ms');
      setTimeout(function() { _doJoin(roomId, cb); }, 500);
      return;
    }

    _currentRoomId = roomId;
    console.log('[ChatRoomMgr] join_room:', roomId);
    socket.emit('join_room', { roomId: roomId });

    // 更新 Store
    var Store = _getStore();
    if (Store) Store.setCurrentRoom(roomId);

    // 更新顶栏
    var View = _getView();
    if (View) {
      // 从房间列表里找名字
      var rooms = Store ? Store.getRooms() : [];
      var name = roomId;
      rooms.forEach(function(r) { if (r.id === roomId) name = r.name; });
      View.updateRoomName(name);
    }

    if (cb) cb();
  }

  /**
   * 离开房间
   */
  function _leaveRoom(cb) {
    if (!_currentRoomId) { if (cb) cb(); return; }

    var SM = _getSM();
    if (SM && SM.getSocket) {
      var socket = SM.getSocket();
      if (socket && socket.connected) {
        console.log('[ChatRoomMgr] leave_room:', _currentRoomId);
        socket.emit('leave_room', { roomId: _currentRoomId });
      }
    }
    _currentRoomId = null;

    var Store = _getStore();
    if (Store) Store.setCurrentRoom(null);

    var View = _getView();
    if (View) View.updateRoomName(null);

    if (cb) cb();
  }

  /**
   * Reconnect 回调（注册到 SocketManager，而非自己监听 socket.reconnect）
   * 只做 rejoin，不重新绑定事件（ChatSocket.init() 已处理）
   */
  function _onReconnect() {
    if (_destroyed) return;
    console.log('[ChatRoomMgr] onReconnect - rejoin room:', _currentRoomId);
    if (_currentRoomId) {
      // 重置 _currentRoomId 让 _joinRoom 允许重新 join
      var rid = _currentRoomId;
      _currentRoomId = null;
      _joinRoom(rid);
    }
  }

  // ===== 注册/注销 Reconnect 回调 =====

  function _registerReconnectCb() {
    if (_reconnectCbRegistered) return;
    var SM = _getSM();
    if (!SM) return;
    // SocketManager 提供 onReconnect(cb) 注册回调
    if (typeof SM.onReconnect === 'function') {
      SM.onReconnect(_onReconnect);
      _reconnectCbRegistered = true;
      console.log('[ChatRoomMgr] reconnect callback registered via SocketManager');
    } else {
      // fallback：自己监听（仅在 SocketManager 未提供 API 时）
      console.warn('[ChatRoomMgr] SocketManager.onReconnect not found, using fallback');
      _registerReconnectFallback();
    }
  }

  function _registerReconnectFallback() {
    var SM = _getSM();
    if (!SM || !SM.getSocket) return;
    var socket = SM.getSocket();
    if (!socket) return;
    // 防止重复监听：用命名函数引用
    if (!_onReconnectFb) {
      _onReconnectFb = function() { _onReconnect(); };
    }
    socket.off('reconnect', _onReconnectFb);
    socket.on('reconnect', _onReconnectFb);
    console.log('[ChatRoomMgr] [fallback] reconnect listener bound');
  }
  var _onReconnectFb = null;

  function _unregisterReconnectCb() {
    if (!_reconnectCbRegistered) {
      // fallback 清理
      var SM = _getSM();
      if (SM && SM.getSocket) {
        var socket = SM.getSocket();
        if (socket && _onReconnectFb) socket.off('reconnect', _onReconnectFb);
      }
      _onReconnectFb = null;
      return;
    }
    // SocketManager 方式：无需手动移除（由 SM 管理）
    _reconnectCbRegistered = false;
  }

  // ===== 公开 API =====

  /**
   * 初始化房间管理器
   * @param {Object} options
   *   - onStateChange: function(state) — ChatStore state 变化回调
   *   - onNewMessage: function(data) — 新消息回调
   *   - onRecalled:  function(data) — 撤回回调
   */
  function init(options) {
    if (_destroyed) { console.warn('[ChatRoomMgr] already destroyed, re-init rejected'); return; }
    options = options || {};

    _Store = window.ChatStore || null;
    _View  = window.ChatView || null;
    _Socket = window.ChatSocket || null;

    // —— 1. 注册 ChatStore 状态变化回调 ——
    if (_Store && typeof _Store.subscribe === 'function') {
      _Store.subscribe(function(state) {
        if (options.onStateChange) options.onStateChange(state);
      });
    }

    // —— 2. 注册 ChatSocket 回调 ——
    if (_Socket) {
      _Socket.setOnNewMessage(function(data) {
        if (options.onNewMessage) options.onNewMessage(data);
      });
      _Socket.setOnRecalled(function(data) {
        if (options.onRecalled) options.onRecalled(data);
      });
    }

    // —— 3. 初始化 ChatSocket 事件绑定 ——
    if (_Socket && typeof _Socket.init === 'function') {
      _Socket.init();
    }

    // —— 4. 注册 reconnect 回调（关键！）——
    _registerReconnectCb();

    // —— 5. 更新连接状态指示灯 ——
    _updateStatusFromSM();

    console.log('[ChatRoomMgr] initialized');
  }

  /**
   * 切换房间
   */
  function switchRoom(roomId) {
    if (_destroyed) return;
    console.log('[ChatRoomMgr] switchRoom:', roomId);
    _joinRoom(roomId);
  }

  /**
   * 获取当前房间 ID
   */
  function getCurrentRoomId() {
    return _currentRoomId;
  }

  /**
   * 销毁（离开房间 + 移除所有回调 + 清理标记）
   * 调用后本模块不再响应任何事件
   */
  function destroy() {
    if (_destroyed) return;
    console.log('[ChatRoomMgr] DESTROY start');

    // 1. 离开房间
    _leaveRoom();

    // 2. 注销 reconnect 回调
    _unregisterReconnectCb();

    // 3. 销毁 ChatSocket（清理其回调引用）
    if (_Socket && typeof _Socket.destroy === 'function') {
      _Socket.destroy();
    }

    // 4. 清理引用
    _Store  = null;
    _View   = null;
    _Socket = null;
    _SM      = null;

    // 5. 标记销毁（所有后续操作直接 return）
    _destroyed = true;

    console.log('[ChatRoomMgr] DESTROY complete - all listeners cleared');
  }

  /**
   * 检查是否已销毁（供外部判断）
   */
  function isDestroyed() {
    return _destroyed;
  }

  // ===== 内部：同步连接状态到 View =====

  function _updateStatusFromSM() {
    var View = _getView();
    if (!View || !View.updateStatusIcon) return;
    var SM = _getSM();
    if (!SM) { View.updateStatusIcon('disconnected'); return; }
    if (SM.isConnected && SM.isConnected()) {
      View.updateStatusIcon('connected');
    } else {
      View.updateStatusIcon('disconnected');
    }
  }

  // ===== 暴露 =====
  window.ChatRoomManager = {
    init:           init,
    switchRoom:      switchRoom,
    getCurrentRoomId: getCurrentRoomId,
    destroy:         destroy,
    isDestroyed:     isDestroyed
  };

  console.log('[ChatRoomMgr] loaded');

})();
