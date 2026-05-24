/**
 * SocketManager — 连接总控（IIFE 闭包，不污染 window）
 * 职责：创建/销毁 socket 实例、管理连接状态、暴露 public API
 * 禁止：读取 currentUser / authToken 全局变量
 * version: 20260523a
 */
const SocketManager = (() => {
  'use strict';

  const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';

  let socket = null;          // Socket.io 实例（闭包内，不挂 window）
  let status = 'disconnected'; // disconnected | connecting | connected | reconnecting
  let authToken = null;       // 仅用于认证，由外部通过 setToken() 注入
  let eventBus = [];          // { event, handler } 订阅列表
  let reconnectTimer = null;

  // ===== public: 状态查询 =====
  function getStatus() { return status; }
  function isConnected() { return status === 'connected'; }

  // ===== public: token 注入（不读 localStorage）=====
  function setToken(token) { authToken = token || null; }

  // ===== 核心：初始化连接 =====
  function connect(opts = {}) {
    if (socket && status !== 'disconnected') return;

    status = 'connecting';
    _emitInternal('statusChange', status);

    const config = {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,   // 无限重试，指数退避
      timeout: 10000,
      upgrade: false,
      ...opts.socketOptions
    };

    try {
      socket = io(API_BASE, config);
    } catch (e) {
      console.error('[SocketManager] io() 初始化失败:', e);
      status = 'disconnected';
      _emitInternal('statusChange', status);
      return;
    }

    // ---- 内置事件 ----
    socket.on('connect', () => {
      console.log('[SocketManager] 已连接');
      status = 'connected';
      _emitInternal('statusChange', status);

      // 自动认证
      if (authToken) {
        socket.emit('authenticate', authToken);
      }
    });

    socket.on('authenticated', (data) => {
      console.log('[SocketManager] 已认证:', data.userId);
      _emitInternal('authenticated', data);
    });

    socket.on('auth_error', (data) => {
      console.error('[SocketManager] 认证失败:', data.message);
      _emitInternal('authError', data);
    });

    socket.on('disconnect', (reason) => {
      console.log('[SocketManager] 断开:', reason);
      status = 'disconnected';
      _emitInternal('statusChange', status);
      _emitInternal('disconnect', reason);

      // 如果是服务端踢出，不再重连
      if (reason === 'io server disconnect') return;
      // 否则依赖 Socket.io 内置重连
    });

    socket.on('reconnect_attempt', (attempt) => {
      status = 'reconnecting';
      _emitInternal('statusChange', status);
      _emitInternal('reconnectAttempt', attempt);
      // 重连时也尝试认证
      if (authToken) {
        socket.emit('authenticate', authToken);
      }
    });

    socket.on('reconnect_failed', () => {
      console.error('[SocketManager] 重连失败（已达最大次数）');
      status = 'disconnected';
      _emitInternal('statusChange', status);
      _emitInternal('reconnectFailed');
    });

    // 将内部事件总线中的监听者绑定到 socket
    _flushInternalListeners();
  }

  // ===== public: 断开并销毁 =====
  function disconnect() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    status = 'disconnected';
    authToken = null;
    _emitInternal('statusChange', status);
  }

  // ===== public: 发送事件（带连接检查）=====
  function emit(event, data, ack) {
    if (!socket || status !== 'connected') {
      console.warn('[SocketManager] emit 失败：未连接，事件:', event);
      return false;
    }
    if (ack) {
      socket.emit(event, data, ack);
    } else {
      socket.emit(event, data);
    }
    return true;
  }

  // ===== public: 订阅 socket 事件（与 socket.on 解耦）=====
  function on(event, handler) {
    eventBus.push({ event, handler });
    // 如果已经连接，立即绑定
    if (socket) {
      socket.on(event, handler);
    }
    // 返回取消订阅函数
    return () => off(event, handler);
  }

  // ===== public: 取消订阅 =====
  function off(event, handler) {
    eventBus = eventBus.filter(e => !(e.event === event && e.handler === handler));
    if (socket) {
      socket.off(event, handler);
    }
  }

  // ===== 内部：刷新监听者到 socket（init 后调用）=====
  function _flushInternalListeners() {
    if (!socket) return;
    eventBus.forEach(({ event, handler }) => {
      socket.off(event, handler); // 避免重复绑定
      socket.on(event, handler);
    });
  }

  // ===== 内部：触发内部事件总线（用于状态通知）=====
  function _emitInternal(event, payload) {
    eventBus
      .filter(e => e.event === event)
      .forEach(e => {
        try { e.handler(payload); } catch (err) { console.error('[SocketManager] 内部事件错误:', err); }
      });
  }

  // ===== public: 加入/离开房间（封装 emit）=====
  function joinRoom(type, target = {}) {
    return emit('join_room', { type, team_id: target.team_id, club_id: target.club_id });
  }
  function leaveRoom(type, target = {}) {
    return emit('leave_room', { type, team_id: target.team_id, club_id: target.club_id });
  }

  // ===== 暴露 public API =====
  return {
    connect,
    disconnect,
    setToken,
    getStatus,
    isConnected,
    emit,
    on,
    off,
    joinRoom,
    leaveRoom
  };
})();

// 仅挂一个入口到 window，供 Page 层调用
window.SocketManager = SocketManager;
