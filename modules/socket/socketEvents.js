/**
 * socketEvents.js — 统一事件总线（IIFE 闭包）
 *
 * 职责：
 *   - 轻量事件总线（替代直接向 socket 绑事件）
 *   - 供 SocketManager / SocketReconnect / 业务模块通信
 *   - 不依赖 socket 连接状态
 *
 * 外部暴露：window.SocketEvents
 */

;(function() {
  'use strict';

  var _listeners = {};  // { eventName: [cb1, cb2, ...] }

  // ===== 内部 =====

  function _getListeners(event) {
    if (!_listeners[event]) _listeners[event] = [];
    return _listeners[event];
  }

  // ===== 公开 API =====

  /**
   * 订阅事件
   * @param {string} event
   * @param {Function} cb
   * @return {Function} unsubscribe function
   */
  function on(event, cb) {
    if (typeof cb !== 'function') return function() {};
    var arr = _getListeners(event);
    arr.push(cb);
    // 返回取消订阅函数
    return function() {
      var idx = arr.indexOf(cb);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  /**
   * 一次性订阅
   */
  function once(event, cb) {
    var unsub = on(event, function() {
      unsub();
      cb.apply(null, arguments);
    });
  }

  /**
   * 触发事件（广播给所有订阅者）
   * @param {string} event
   * @param {*} [data] — 可选参数，传给每个 cb
   */
  function emit(event, data) {
    var arr = _listeners[event];
    if (!arr) return;
    // 复制一份，防止 cb 里 off 导致遍历异常
    arr.slice().forEach(function(cb) {
      try { cb(data); } catch(e) { console.error('[SockEvents] cb error:', event, e); }
    });
  }

  /**
   * 取消订阅
   * @param {string} event
   * @param {Function} [cb] — 不传则清除该事件所有回调
   */
  function off(event, cb) {
    if (!cb) {
      delete _listeners[event];
      return;
    }
    var arr = _listeners[event];
    if (!arr) return;
    var idx = arr.indexOf(cb);
    if (idx !== -1) arr.splice(idx, 1);
  }

  // ===== 暴露 =====
  window.SocketEvents = {
    on:    on,
    once: once,
    emit:  emit,
    off:   off
  };

  console.log('[SockEvents] loaded');

})();
