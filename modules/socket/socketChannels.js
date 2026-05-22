/**
 * socketChannels.js — 房间状态自管理（IIFE 闭包）
 *
 * 职责：注册/注销房间状态，不操作 socket 连接本身
 * 依赖：window.SocketManager
 * 外部暴露：window.SocketChannels
 */

;(function() {
  'use strict';

  var _joinedRooms = {};   // { [roomId]: true }
  var _roomCallbacks = {};   // { [roomId]: callback }

  function _getSM() { return window.SocketManager || null; }

  /**
   * 加入房间（emit join_room）
   */
  function join(roomId, onState) {
    if (!roomId) return;
    _joinedRooms[roomId] = true;
    if (onState) _roomCallbacks[roomId] = onState;

    var SM = _getSM();
    if (SM && SM.getSocket) {
      var socket = SM.getSocket();
      if (socket && socket.connected) {
        socket.emit('join_room', { roomId: roomId });
        console.log('[Channels] join_room:', roomId);
      }
    }
  }

  /**
   * 离开房间（emit leave_room）
   */
  function leave(roomId) {
    if (!roomId || !_joinedRooms[roomId]) return;
    delete _joinedRooms[roomId];
    delete _roomCallbacks[roomId];

    var SM = _getSM();
    if (SM && SM.getSocket) {
      var socket = SM.getSocket();
      if (socket && socket.connected) {
        socket.emit('leave_room', { roomId: roomId });
        console.log('[Channels] leave_room:', roomId);
      }
    }
  }

  /**
   * 获取已加入房间列表
   */
  function getJoined() {
    return Object.keys(_joinedRooms);
  }

  /**
   * 重连后重新 join 所有房间
   * （由 ChatRoomManager 通过 onReconnect 调用）
   */
  function rejoinAll() {
    var SM = _getSM();
    if (!SM || !SM.getSocket) return;
    var socket = SM.getSocket();
    if (!socket || !socket.connected) return;

    Object.keys(_joinedRooms).forEach(function(rid) {
      console.log('[Channels] rejoin:', rid);
      socket.emit('join_room', { roomId: rid });
    });
  }

  // ===== 暴露 =====
  window.SocketChannels = {
    join:      join,
    leave:     leave,
    getJoined: getJoined,
    rejoinAll:  rejoinAll
  };

  console.log('[SocketChannels] loaded');

})();
