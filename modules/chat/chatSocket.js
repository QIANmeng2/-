/**
 * chatSocket.js — 聊天 WebSocket 事件监听（IIFE 闭包）
 *
 * 依赖：window.SocketManager（由 modules/socket/socketManager.js 暴露）
 * 禁止：自己监听 socket.reconnect（由 ChatRoomManager 通过 SocketManager.onReconnect 注册）
 * 外部暴露：window.ChatSocket
 */

;(function() {
  'use strict';

  var _bound = false;
  var _onNewMessage  = null;  // 外部注入的回调
  var _onRecalled   = null;
  var _onTyping     = null;
  var _onOnlineChange = null;

  // ===== 内部方法 =====

  function _getSM() { return window.SocketManager; }

  function _bindEvents() {
    if (_bound) return;
    var SM = _getSM();
    if (!SM) { console.warn('[ChatSocket] SocketManager not ready'); return; }

    var socket = SM.getSocket ? SM.getSocket() : null;
    if (!socket) { console.warn('[ChatSocket] socket not connected yet'); return; }

    // —— new_message ——
    socket.on('new_message', function(data) {
      console.log('[ChatSocket] new_message', data);
      if (_onNewMessage && data && data.roomId) {
        _onNewMessage(data);
      }
    });

    // —— message_recalled ——
    socket.on('message_recalled', function(data) {
      console.log('[ChatSocket] message_recalled', data);
      if (_onRecalled && data && data.messageId) {
        _onRecalled(data);
      }
    });

    // —— typing ——
    socket.on('user_typing', function(data) {
      if (_onTyping && data && data.roomId) {
        _onTyping(data);
      }
    });

    // —— online_change ——
    socket.on('online_change', function(data) {
      if (_onOnlineChange && data && data.roomId) {
        _onOnlineChange(data);
      }
    });

    _bound = true;
    console.log('[ChatSocket] events bound');
  }

  // ===== 设置回调（由 ChatRoomManager 调用）=====

  function setOnNewMessage(fn)  { _onNewMessage = fn; }
  function setOnRecalled(fn)    { _onRecalled = fn; }
  function setOnTyping(fn)       { _onTyping = fn; }
  function setOnOnlineChange(fn) { _onOnlineChange = fn; }

  // ===== 初始化（等待 SocketManager Ready）=====

  function init() {
    var SM = _getSM();
    if (!SM) {
      setTimeout(init, 200);
      return;
    }
    // 如果已连接，立即绑定
    if (SM.isConnected && SM.isConnected()) {
      _bindEvents();
    }
    // 监听连接成功事件（SocketManager 会 emit 'connected'）
    if (SM.on) {
      SM.on('connected', _bindEvents);
    }
    console.log('[ChatSocket] init');
  }

  function destroy() {
    _onNewMessage = null;
    _onRecalled = null;
    _onTyping = null;
    _onOnlineChange = null;
    _bound = false;
    // 注意：不 removeAllListeners，因为 SocketManager 还管理其他模块的事件
    console.log('[ChatSocket] destroyed');
  }

  // ===== 暴露 =====
  window.ChatSocket = {
    init:           init,
    destroy:         destroy,
    setOnNewMessage: setOnNewMessage,
    setOnRecalled:   setOnRecalled,
    setOnTyping:     setOnTyping,
    setOnOnlineChange: setOnOnlineChange
  };

  console.log('[ChatSocket] loaded');

})();
