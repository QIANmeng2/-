/**
 * chatView.js — 聊天页面 DOM 渲染（IIFE 闭包）
 *
 * 所有 DOM ID 严格对齐 chat.html！
 * 依赖：window.ChatStore
 * 外部暴露：window.ChatView
 */

;(function() {
  'use strict';

  // ===== DOM ID 常量（与 chat.html 严格对齐）=====
  var ID = {
    ROOM_NAME:   'chRoomName',
    STATUS_ICON: 'chStatusIcon',
    SIDEBAR:     'chSidebar',
    ROOM_LIST:    'chRoomList',
    MESSAGES:     'chMessages',
    INPUT:        'chInput',
    SEND_BTN:    'chSendBtn'
  };

  // ===== 内部工具 =====

  function _el(id) { return document.getElementById(id); }

  function _escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _timeStr(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function _isSelf(userId) {
    try {
      var me = JSON.parse(localStorage.getItem('user'));
      return me && me.id === userId;
    } catch(e) { return false; }
  }

  // ===== 渲染方法 =====

  /**
   * 渲染房间列表
   * @param {Array} rooms
   * @param {Function} onRoomClick(roomId)
   */
  function renderRoomList(rooms, onRoomClick) {
    var container = _el(ID.ROOM_LIST);
    if (!container) return;
    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:.82rem;">暂无聊天房间</div>';
      return;
    }

    var html = '';
    rooms.forEach(function(r) {
      var badge = (r.unreadCount > 0)
        ? '<span style="background:#c9a84c;color:#1A1A2E;font-size:.65rem;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:6px;">' + r.unreadCount + '</span>'
        : '';
      var active = (window.ChatStore && window.ChatStore.getCurrentRoom() === r.id) ? ' style="background:rgba(201,168,76,.12);border-radius:8px;"' : '';
      html += '<div class="ch-room-item" data-room-id="' + _escapeHtml(r.id) + '"' + active + '>' +
                '<div style="font-weight:600;font-size:.85rem;">' + _escapeHtml(r.name) + '</div>' +
                '<div style="font-size:.72rem;color:var(--text-muted);">' + _escapeHtml(r.type || 'group') + badge + '</div>' +
              '</div>';
    });
    container.innerHTML = html;

    // 事件委托
    container.onclick = function(e) {
      var item = e.target.closest ? e.target.closest('.ch-room-item') : null;
      if (!item) return;
      var rid = item.getAttribute('data-room-id');
      if (rid && onRoomClick) onRoomClick(rid);
    };
  }

  /**
   * 渲染消息列表
   * @param {Array} messages
   * @param {Function} onRecall(messageId)
   */
  function renderMessages(messages, onRecall) {
    var container = _el(ID.MESSAGES);
    if (!container) return;
    if (!messages || messages.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:.85rem;">暂无消息</div>';
      return;
    }

    var html = '';
    messages.forEach(function(m) {
      if (m.recalled) {
        html += '<div class="ch-msg ch-msg--system">' +
                  '<span style="color:var(--text-muted);font-size:.78rem;font-style:italic;">' + _escapeHtml(m.content || '(消息已撤回)') + '</span>' +
                '</div>';
        return;
      }
      var self = _isSelf(m.userId);
      var cls  = self ? 'ch-msg ch-msg--self' : 'ch-msg ch-msg--other';
      var align = self ? 'style="text-align:right;margin:6px 0;"' : 'style="margin:6px 0;"';
      html += '<div class="' + cls + '" data-msg-id="' + _escapeHtml(m.id) + '" ' + align + '>' +
                '<div style="font-size:.72rem;color:var(--gold);margin-bottom:2px;">' +
                  (self ? '你' : _escapeHtml(m.username || '匿名')) +
                '</div>' +
                '<div class="ch-bubble" style="display:inline-block;background:' + (self ? 'rgba(201,168,76,.15)' : 'rgba(255,255,255,.04)') + ';padding:6px 12px;border-radius:12px;max-width:75%;word-break:break-word;">' +
                  _escapeHtml(m.content) +
                '</div>' +
                '<div style="font-size:.65rem;color:var(--text-muted);margin-top:2px;">' + _timeStr(m.time) + '</div>' +
              '</div>';
    });
    container.innerHTML = html;

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
  }

  /**
   * 追加单条消息（不重刷整个列表）
   */
  function appendMessage(msg) {
    var container = _el(ID.MESSAGES);
    if (!container) return;
    // 用 renderMessages 简化，避免复杂 DOM diff
    var current = window.ChatStore ? window.ChatStore.getMessages(window.ChatStore.getCurrentRoom()) : [];
    renderMessages(current, null);
  }

  /**
   * 更新顶栏房间名
   */
  function updateRoomName(name) {
    var el = _el(ID.ROOM_NAME);
    if (el) el.textContent = name || '选择房间';
  }

  /**
   * 更新连接状态指示灯
   * @param {string} status - 'connected' | 'disconnected' | 'reconnecting'
   */
  function updateStatusIcon(status) {
    var el = _el(ID.STATUS_ICON);
    if (!el) return;
    var color = '#10b981';  // connected - green
    if (status === 'disconnected')  color = '#ef4444';
    if (status === 'reconnecting') color = '#fbbf24';
    el.style.background = color;
    el.title = status;
  }

  /**
   * 渲染输入框状态（禁用/启用）
   */
  function setInputEnabled(enabled) {
    var input = _el(ID.INPUT);
    var btn   = _el(ID.SEND_BTN);
    if (input) input.disabled = !enabled;
    if (btn)   btn.disabled   = !enabled;
  }

  /**
   * 清空输入框
   */
  function clearInput() {
    var input = _el(ID.INPUT);
    if (input) input.value = '';
  }

  /**
   * 渲染 Typing 提示
   * @param {Array<string>} usernames
   */
  function renderTyping(usernames) {
    // 简单实现：在消息容器底部显示
    var container = _el(ID.MESSAGES);
    if (!container) return;
    var existing = document.getElementById('chTypingHint');
    if (existing) existing.remove();
    if (!usernames || usernames.length === 0) return;

    var hint = document.createElement('div');
    hint.id = 'chTypingHint';
    hint.style.cssText = 'font-size:.72rem;color:var(--text-muted);padding:4px 12px;font-style:italic;';
    hint.textContent = usernames.join('、') + ' 正在输入…';
    container.appendChild(hint);
  }

  // ===== 暴露 =====
  window.ChatView = {
    renderRoomList:   renderRoomList,
    renderMessages:   renderMessages,
    appendMessage:    appendMessage,
    updateRoomName:   updateRoomName,
    updateStatusIcon: updateStatusIcon,
    setInputEnabled:  setInputEnabled,
    clearInput:       clearInput,
    renderTyping:     renderTyping,
    _el: _el,
    ID: ID
  };

  console.log('[ChatView] loaded');

})();
