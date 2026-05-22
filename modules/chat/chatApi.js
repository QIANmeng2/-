/**
 * chatApi.js — 聊天数据接口（IIFE 闭包）
 *
 * 封装所有 /api/chat/* 请求
 * 外部暴露：window.ChatApi
 */

;(function() {
  'use strict';

  var API_BASE = '';  // 同源，无需写死域名

  // ===== 内部工具 =====

  function _headers(extra) {
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    var token = null;
    try { token = localStorage.getItem('token'); } catch(e) {}
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (extra) Object.keys(extra).forEach(function(k) { h[k] = extra[k]; });
    return h;
  }

  function _handleErr(res) {
    if (res.status === 401) {
      setTimeout(function() { window.location.href = './'; }, 100);
      return Promise.reject(new Error('未登录'));
    }
    return res.json().then(function(d) {
      return Promise.reject(new Error(d.message || '请求失败'));
    }).catch(function() {
      return Promise.reject(new Error('HTTP ' + res.status));
    });
  }

  function _get(path) {
    return fetch(API_BASE + path, { headers: _headers() })
      .then(function(res) { return res.ok ? res.json() : _handleErr(res); });
  }

  function _post(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify(body)
    }).then(function(res) { return res.ok ? res.json() : _handleErr(res); });
  }

  function _put(path, body) {
    return fetch(API_BASE + path, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify(body)
    }).then(function(res) { return res.ok ? res.json() : _handleErr(res); });
  }

  // ===== 公开 API =====

  /**
   * 获取房间列表
   * 暂时返回模拟数据，后续对接 /api/chat/my-teams + /api/chat/my-clubs
   */
  function fetchRooms() {
    // TODO: 替换为真实 API
    return Promise.resolve([
      { id: 'public',    name: '公开频道',   type: 'public' },
      { id: 'team-1',   name: '我的战队',     type: 'team' },
      { id: 'club-1',   name: '我的俱乐部',   type: 'club' }
    ]);
    /* 真实 API（待启用）
    return Promise.all([
      _get('/api/chat/my-teams'),
      _get('/api/chat/my-clubs')
    ]).then(function(results) {
      var teams = (results[0] && results[0].data) || [];
      var clubs = (results[1] && results[1].data) || [];
      var rooms = [{ id:'public', name:'公开频道', type:'public' }];
      teams.forEach(function(t) { rooms.push({ id:'team-'+t.id, name:t.name, type:'team' }); });
      clubs.forEach(function(c) { rooms.push({ id:'club-'+c.id, name:c.name, type:'club' }); });
      return rooms;
    });
    */
  }

  /**
   * 获取房间历史消息（分页）
   * GET /api/chat/fetch?type=public&before=ts
   */
  function fetchMessages(roomId, beforeTs, limit) {
    var type = 'public';
    if (roomId.startsWith('team-'))  type = 'team';
    if (roomId.startsWith('club-')) type = 'club';
    var url = '/api/chat/fetch?type=' + type;
    if (beforeTs) url += '&before=' + beforeTs;
    return _get(url).then(function(d) {
      return (d && d.data) || d || [];
    });
  }

  /**
   * 发送消息
   * POST /api/chat/send
   * body: { roomId, content, type? }
   */
  function sendMessage(roomId, content, type) {
    return _post('/api/chat/send', {
      roomId: roomId,
      content: content,
      type:   type || 'text'
    }).then(function(d) {
      return (d && d.data) || d || null;
    });
  }

  /**
   * 撤回消息
   * PUT /api/chat/:id/recall
   * body: { roomId }
   */
  function recallMessage(messageId, roomId) {
    return _put('/api/chat/' + encodeURIComponent(messageId) + '/recall', { roomId: roomId });
  }

  /**
   * 标记已读
   * POST /api/chat/read
   * body: { roomId }
   */
  function markRead(roomId) {
    return _post('/api/chat/read', { roomId: roomId });
  }

  /**
   * 获取在线用户列表
   * GET /api/chat/online/:roomId
   */
  function fetchOnlineUsers(roomId) {
    return _get('/api/chat/online/' + encodeURIComponent(roomId)).then(function(d) {
      return (d && d.data) || d || [];
    });
  }

  // ===== 暴露 =====
  window.ChatApi = {
    fetchRooms:      fetchRooms,
    fetchMessages:    fetchMessages,
    sendMessage:      sendMessage,
    recallMessage:    recallMessage,
    markRead:         markRead,
    fetchOnlineUsers: fetchOnlineUsers
  };

  console.log('[ChatApi] loaded');

})();
