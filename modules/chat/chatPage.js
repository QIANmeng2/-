/**
 * chatPage.js — 聊天独立页初始化入口（IIFE 闭包）
 *
 * 设计原则：
 *   - 页面级初始化，不依赖 app.js
 *   - DOMContentLoaded 自启动
 *   - waitForDeps() 处理脚本异步加载顺序
 *   - 只初始化本页面依赖的模块
 *   - 提供 destroy() 供 SPA 场景调用
 *
 * 依赖顺序（由 HTML script 标签保证）：
 *   SocketManager → ChatStore → ChatApi → ChatSocket → ChatView → ChatRoomManager → chatPage
 */

;(function() {
  'use strict';

  var _store   = null;
  var _view    = null;
  var _api     = null;
  var _socket  = null;
  var _mgr     = null;
  var _inited  = false;

  // ===== 工具函数 =====

  function _escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== 模块就绪检测 =====

  function waitForDeps(retries) {
    if (window.ChatStore && window.ChatView && window.ChatApi && window.ChatSocket && window.ChatRoomManager) {
      initPage();
    } else if (retries > 0) {
      setTimeout(function() { waitForDeps(retries - 1); }, 100);
    } else {
      renderFatal('模块加载失败，请刷新页面重试。');
    }
  }

  // ===== 页面初始化 =====

  function initPage() {
    if (_inited) return;
    _inited = true;

    _store = window.ChatStore;
    _view  = window.ChatView;
    _api   = window.ChatApi;
    _socket = window.ChatSocket;
    _mgr    = window.ChatRoomManager;

    console.log('[ChatPage] init');

    // —— 0. 先连接 WebSocket ——
    var SM = window.SocketManager;
    if (SM && typeof SM.connect === 'function') {
      SM.connect();
      console.log('[ChatPage] SocketManager.connect() called');
    } else {
      console.error('[ChatPage] SocketManager.connect not found!');
    }

    // —— 1. 初始化房间管理器 ——
    _mgr.init({
      onStateChange: _onStateChange,
      onNewMessage: _onNewMessage,
      onRecalled:   _onRecalled
    });

    // —— 2. 渲染房间列表 ——
    _loadRooms();

    // —— 3. 绑定发送按钮 ——
    _bindSendBtn();

    // —— 4. 暴露给 HTML onclick ——
    window.__CHAT_SEND = _handleSend;
    window.__CHAT_PAGE  = { destroy: destroyPage, reload: reloadPage };

    console.log('[ChatPage] ready');
  }

  // ===== 数据加载 =====

  function _loadRooms() {
    _store.setLoading(true);
    _api.fetchRooms()
      .then(function(rooms) {
        _store.setRooms(rooms);
        _renderRoomList(rooms);
        // 默认选中第一个房间
        if (rooms && rooms.length > 0) {
          _mgr.switchRoom(rooms[0].id);
        }
      })
      .catch(function(err) {
        console.error('[ChatPage] loadRooms error:', err);
        _store.setError(err.message || '加载房间失败');
        _renderError(err.message);
      })
      .finally(function() {
        _store.setLoading(false);
      });
  }

  function _loadMessages(roomId) {
    _store.setLoading(true);
    _api.fetchMessages(roomId, null, 50)
      .then(function(msgs) {
        _store.prependMessages(roomId, msgs);
        _view.renderMessages(_store.getMessages(roomId), _handleRecall);
      })
      .catch(function(err) {
        console.error('[ChatPage] loadMessages error:', err);
      })
      .finally(function() {
        _store.setLoading(false);
      });
  }

  // ===== 渲染 =====

  function _renderRoomList(rooms) {
    _view.renderRoomList(rooms, function(roomId) {
      _mgr.switchRoom(roomId);
      _loadMessages(roomId);
    });
  }

  function _renderError(msg) {
    var container = document.getElementById('chMessages');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;font-size:.85rem;">' + _escapeHtml(msg || '加载失败') + '</div>';
  }

  function renderFatal(msg) {
    var sidebar = document.getElementById('chSidebar');
    if (sidebar) sidebar.innerHTML = '<div style="padding:20px;color:#ef4444;font-size:.82rem;">' + _escapeHtml(msg) + '<br><br><button onclick="location.reload()" style="background:#c9a84c;color:#1A1A2E;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;">刷新页面</button></div>';
  }

  // ===== 事件处理 =====

  function _onStateChange(state) {
    // 更新顶栏房间名
    var rid = state.currentRoom;
    if (rid) {
      var rooms = state.rooms;
      var name = rid;
      rooms.forEach(function(r) { if (r.id === rid) name = r.name; });
      _view.updateRoomName(name);
    } else {
      _view.updateRoomName(null);
    }
  }

  function _onNewMessage(data) {
    if (!data || !data.roomId) return;
    _store.appendMessage(data.roomId, {
      id:       data.id || Date.now().toString(36),
      userId:   data.userId,
      username: data.username,
      content:  data.content,
      time:     data.time || Date.now(),
      type:     data.type || 'text',
      recalled: false
    });

    // 如果当前正在看这个房间，刷新消息列表
    if (_store.getCurrentRoom() === data.roomId) {
      _view.renderMessages(_store.getMessages(data.roomId), _handleRecall);
    }
  }

  function _onRecalled(data) {
    if (!data || !data.messageId || !data.roomId) return;
    _store.recallMessage(data.roomId, data.messageId, data.userId);
    if (_store.getCurrentRoom() === data.roomId) {
      _view.renderMessages(_store.getMessages(data.roomId), _handleRecall);
    }
  }

  function _handleSend() {
    var input = document.getElementById('chInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;

    var roomId = _store.getCurrentRoom();
    if (!roomId) { alert('请先选择房间'); return; }

    _view.setInputEnabled(false);
    _api.sendMessage(roomId, content)
      .then(function() {
        input.value = '';
        _view.clearInput();
        // 乐观更新：立即加载消息
        _loadMessages(roomId);
      })
      .catch(function(err) {
        console.error('[ChatPage] send error:', err);
        alert('发送失败：' + (err.message || '未知错误'));
      })
      .finally(function() {
        _view.setInputEnabled(true);
        if (input) input.focus();
      });
  }

  function _handleRecall(messageId) {
    var roomId = _store.getCurrentRoom();
    if (!roomId || !messageId) return;
    if (!confirm('确认撤回此消息？')) return;
    _api.recallMessage(messageId, roomId)
      .then(function() { _loadMessages(roomId); })
      .catch(function(err) { console.error('[ChatPage] recall error:', err); });
  }

  function _bindSendBtn() {
    var btn = document.getElementById('chSendBtn');
    if (btn) btn.onclick = _handleSend;
    var input = document.getElementById('chInput');
    if (input) {
      input.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _handleSend();
        }
      };
    }
  }

  // ===== 工具 =====

  function _escape(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ===== 页面销毁（SPA 场景）=====

  function destroyPage() {
    console.log('[ChatPage] destroyPage');
    if (_mgr && typeof _mgr.destroy === 'function') _mgr.destroy();
    _store  = null;
    _view   = null;
    _api    = null;
    _socket = null;
    _mgr    = null;
    _inited = false;
  }

  function reloadPage() {
    destroyPage();
    setTimeout(function() { waitForDeps(50); }, 100);
  }

  // ===== 启动 =====

  function boot() {
    waitForDeps(80); // 最多等 8 秒
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[ChatPage] script loaded');

})();
