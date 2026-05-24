/**
 * socketEvents — 事件总线（IIFE 闭包）
 * 职责：统一注册/分发 Socket 事件，隔离业务回调与 socket 实例
 * 禁止：直接操作 DOM，仅通过回调通知 View 层
 * version: 20260523a
 */
const SocketEvents = (() => {
  'use strict';

  // 事件映射：server 事件名 → 回调函数列表
  const registry = {};

  let initialized = false;

  // ===== 内部：确保注册表存在 =====
  function _ensure(event) {
    if (!registry[event]) registry[event] = [];
  }

  // ===== 内部：绑定到 SocketManager（首次 init 或重连后）=====
  function _bindAll() {
    const sm = window.SocketManager;
    if (!sm) return;

    Object.keys(registry).forEach(event => {
      // 先 off 再 on，避免重复绑定
      registry[event].forEach(handler => {
        sm.off(event, handler);
        sm.on(event, handler);
      });
    });
  }

  // ===== public: 注册事件回调 =====
  function on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    _ensure(event);

    // 包装一层，防止单个 handler 报错影响其他
    const wrapped = (...args) => {
      try { handler(...args); } catch (e) {
        console.error(`[SocketEvents] handler error on [${event}]:`, e);
      }
    };
    // 保留原始引用，用于 off()
    wrapped._original = handler;
    registry[event].push(wrapped);

    // 如果已初始化，立即绑定
    if (initialized) {
      const sm = window.SocketManager;
      sm && sm.off(event, wrapped) && sm.on(event, wrapped);
    }

    // 返回取消订阅
    return () => off(event, handler);
  }

  // ===== public: 注销事件回调 =====
  function off(event, handler) {
    if (!registry[event]) return;
    registry[event] = registry[event].filter(h => h._original !== handler);
    const sm = window.SocketManager;
    sm && sm.off(event, handler);
  }

  // ===== public: 触发本地模拟事件（用于测试）=====
  function emitLocal(event, payload) {
    if (!registry[event]) return;
    registry[event].forEach(h => {
      try { h(payload); } catch (e) {
        console.error(`[SocketEvents] emitLocal error on [${event}]:`, e);
      }
    });
  }

  // ===== public: 初始化（绑定 SocketManager + 重连刷新）=====
  function init() {
    if (initialized) return;
    initialized = true;

    const sm = window.SocketManager;
    if (!sm) {
      console.error('[SocketEvents] SocketManager 未找到');
      return;
    }

    _bindAll();

    // 重连后重新绑定（SocketManager 重连时会新建 socket 实例）
    sm.on('statusChange', (status) => {
      if (status === 'connected') {
        _bindAll();
      }
    });

    console.log('[SocketEvents] 初始化完成，已注册事件:', Object.keys(registry).join(', '));
  }

  // ===== public: 销毁（清空所有回调）=====
  function destroy() {
    Object.keys(registry).forEach(event => {
      const sm = window.SocketManager;
      (registry[event] || []).forEach(h => {
        sm && sm.off(event, h);
      });
    });
    Object.keys(registry).forEach(k => delete registry[k]);
    initialized = false;
  }

  // ===== 预设：注册所有聊天相关事件（业务层调用）=====
  function registerChatEvents(handlers = {}) {
    const eventMap = {
      onNewMessage:      'new_message',
      onMessageRecalled:  'message_recalled',
      onUserMuted:        'user_muted',
      onUserUnmuted:      'user_unmuted',
      onAuthenticated:     'authenticated',
      onAuthError:         'auth_error',
    };
    Object.entries(eventMap).forEach(([handlerKey, eventName]) => {
      if (typeof handlers[handlerKey] === 'function') {
        on(eventName, handlers[handlerKey]);
      }
    });
  }

  return {
    on,
    off,
    emitLocal,
    init,
    destroy,
    registerChatEvents
  };
})();

window.SocketEvents = SocketEvents;
