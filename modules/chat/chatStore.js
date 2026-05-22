/**
 * chatStore.js — 聊天状态管理（IIFE 闭包，零 window 污染）
 *
 * 状态树：
 *   messages: { [roomId]: [ { id, userId, username, content, time, type, recalled } ] }
 *   rooms: [ { id, name, type, unreadCount, lastMsg } ]
 *   currentRoom: null | string
 *   typingUsers: { [roomId]: [userId] }
 *   unreadTotal: number
 *   loading: boolean
 *   error: null | string
 *
 * 外部暴露：window.ChatStore
 */

;(function() {
  'use strict';

  var _state = {
    messages: {},       // { [roomId]: [...] }
    rooms: [],           // 房间列表
    currentRoom: null,   // 当前房间 ID
    typingUsers: {},     // { [roomId]: [userId] }
    unreadTotal: 0,      // 总未读数
    loading: false,
    error: null
  };

  var _listeners = [];  // [{ id, cb }]

  // ===== 内部方法 =====

  function _notify() {
    var state = getState();
    _listeners.forEach(function(l) {
      try { l.cb(state); } catch(e) { console.error('[ChatStore] listener error:', e); }
    });
  }

  function _incUnread(roomId) {
    if (roomId === _state.currentRoom) return;  // 当前房间不计未读
    var rooms = _state.rooms;
    for (var i = 0; i < rooms.length; i++) {
      if (rooms[i].id === roomId) {
        rooms[i].unreadCount = (rooms[i].unreadCount || 0) + 1;
        break;
      }
    }
    _recalculateUnread();
  }

  function _recalculateUnread() {
    var total = 0;
    _state.rooms.forEach(function(r) { total += (r.unreadCount || 0); });
    _state.unreadTotal = total;
  }

  // ===== 公开 API（通过闭包暴露）=====

  function getState() {
    // 返回浅拷贝，防止外部直接修改
    return {
      messages: _state.messages,
      rooms: _state.rooms,
      currentRoom: _state.currentRoom,
      typingUsers: _state.typingUsers,
      unreadTotal: _state.unreadTotal,
      loading: _state.loading,
      error: _state.error
    };
  }

  function subscribe(cb) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    _listeners.push({ id: id, cb: cb });
    return id;  // 返回 id，用于 unsubscribe
  }

  function unsubscribe(id) {
    _listeners = _listeners.filter(function(l) { return l.id !== id; });
  }

  // —— 房间列表 ——
  function setRooms(rooms) {
    _state.rooms = rooms;
    _recalculateUnread();
    _notify();
  }

  function getRooms() {
    return _state.rooms;
  }

  // —— 当前房间 ——
  function setCurrentRoom(roomId) {
    _state.currentRoom = roomId;
    // 切换房间时清未读
    if (roomId) {
      var rooms = _state.rooms;
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].id === roomId) {
          rooms[i].unreadCount = 0;
          break;
        }
      }
      _recalculateUnread();
    }
    _notify();
  }

  function getCurrentRoom() {
    return _state.currentRoom;
  }

  // —— 消息 ——
  function appendMessage(roomId, msg) {
    if (!_state.messages[roomId]) _state.messages[roomId] = [];
    _state.messages[roomId].push(msg);
    _incUnread(roomId);
    _notify();
  }

  function prependMessages(roomId, msgs) {
    if (!_state.messages[roomId]) _state.messages[roomId] = [];
    _state.messages[roomId] = msgs.concat(_state.messages[roomId]);
  }

  function recallMessage(roomId, messageId, userId) {
    var list = _state.messages[roomId];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === messageId && list[i].userId === userId) {
        list[i].recalled = true;
        list[i].content = '(消息已撤回)';
        break;
      }
    }
    _notify();
  }

  function getMessages(roomId) {
    return _state.messages[roomId] || [];
  }

  // —— Typing ——
  function setTyping(roomId, userId, isTyping) {
    if (!_state.typingUsers[roomId]) _state.typingUsers[roomId] = [];
    var arr = _state.typingUsers[roomId];
    var idx = arr.indexOf(userId);
    if (isTyping && idx === -1) {
      arr.push(userId);
    } else if (!isTyping && idx !== -1) {
      arr.splice(idx, 1);
    }
    _notify();
  }

  // —— Loading / Error ——
  function setLoading(v) { _state.loading = v; _notify(); }
  function setError(v)   { _state.error = v;   _notify(); }
  function clearError()   { _state.error = null;  _notify(); }

  // ===== 暴露到 window（仅此一处）=====
  window.ChatStore = {
    getState:      getState,
    subscribe:     subscribe,
    unsubscribe:   unsubscribe,
    setRooms:      setRooms,
    getRooms:      getRooms,
    setCurrentRoom: setCurrentRoom,
    getCurrentRoom: getCurrentRoom,
    appendMessage:  appendMessage,
    prependMessages: prependMessages,
    recallMessage:  recallMessage,
    getMessages:    getMessages,
    setTyping:      setTyping,
    setLoading:     setLoading,
    setError:       setError,
    clearError:     clearError
  };

  console.log('[ChatStore] loaded');

})();
