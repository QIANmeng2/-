/**
 * chatView.js — 聊天 DOM 渲染层
 *
 * 设计原则：
 * - 只负责 state → DOM，不修改 Store
 * - 不操作 socket，不调用 Api
 * - 所有动态元素事件通过 window.ChatView 委托（onXxx 回调）
 * - 所有 DOM ID 对齐 chat.html（chRoomName / chStatusIcon / chRoomList / chMessages / chInput / chSendBtn）
 */
const ChatView = (() => {
  'use strict';

  const escapeHtml = (str) =>
    String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 身份配色（与旧 app.js 一致）
  const identityColors  = { admin: '#fbbf24', boss: '#f59e0b', signed: '#a78bfa', certified: '#60a5fa', uncerified: '#9ca3af' };
  const identityLabels = { admin: '管理员', boss: '老板', signed: '已签约', certified: '已认证', uncerified: '未认证' };

  // ===== 回调（由 chatPage.js 注入）=====
  let _onAvatarClick  = null;  // (senderId) => void
  let _onRecallClick = null;  // (msgId) => void
  let _onMoreClick   = null;  // (msgId, senderName, senderId) => void
  let _onContextMenu  = null;  // (event, msgId, senderName, senderId) => false|void
  let _onSwitchType   = null;  // (type) => void
  let _onSendClick    = null;  // () => void
  let _onSelectTarget = null;  // (type, id, name) => void
  let _onSearchInput  = null;  // (event) => void

  // ===== 工具 =====
  const $(id) => document.getElementById(id);

  /**
   * 滚动到底部
   */
  function scrollToBottom() {
    const el = $('chMessages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ===== 房间列表渲染 =====
  /**
   * 渲染左侧房间列表
   * @param {Object} state - ChatStore.getState()
   */
  function renderRoomList(state) {
    const container = $('chRoomList');
    if (!container) return;

    const { activeRoom, unreadCounts, myTeams = [], myClubs = [], contacts = [] } = state;

    let html = '';

    // 公聊
    const pubActive = !activeRoom || activeRoom.type === 'public' ? ' active' : '';
    const pubBadge = (unreadCounts?.public || 0) > 0
      ? ` <span class="ch-room-item__badge">${unreadCounts.public > 99 ? '99+' : unreadCounts.public}</span>` : '';
    html += `<div class="ch-room-item${pubActive}" data-type="public" data-id="" onclick="ChatView._handleRoomClick('public','')">
      <span class="ch-room-item__icon">📢</span>
      <span class="ch-room-item__name">公聊大厅</span>${pubBadge}
    </div>`;

    // 私聊联系人
    if (contacts.length > 0) {
      html += `<div class="ch-sidebar__title">私聊</div>`;
      contacts.forEach(c => {
        const isActive = activeRoom?.type === 'private' && String(activeRoom.targetId) === String(c.user_id || c.id);
        const badge = (unreadCounts?.private?.[c.user_id || c.id] || 0) > 0
          ? ` <span class="ch-room-item__badge">${unreadCounts.private[c.user_id || c.id]}</span>` : '';
        html += `<div class="ch-room-item${isActive ? ' active' : ''}" data-type="private" data-id="${c.user_id || c.id}" onclick="ChatView._handleRoomClick('private','${c.user_id || c.id}')">
          <span class="ch-room-item__icon">👤</span>
          <span class="ch-room-item__name">${escapeHtml(c.gameid || c.username || '未知')}</span>${badge}
        </div>`;
      });
    }

    // 队伍
    if (myTeams.length > 0) {
      html += `<div class="ch-sidebar__title">队伍</div>`;
      myTeams.forEach(t => {
        const isActive = activeRoom?.type === 'team' && String(activeRoom.targetId) === String(t.id);
        const badge = (unreadCounts?.team?.[t.id] || 0) > 0
          ? ` <span class="ch-room-item__badge">${unreadCounts.team[t.id]}</span>` : '';
        html += `<div class="ch-room-item${isActive ? ' active' : ''}" data-type="team" data-id="${t.id}" onclick="ChatView._handleRoomClick('team','${t.id}')">
          <span class="ch-room-item__icon">👥</span>
          <span class="ch-room-item__name">${escapeHtml(t.name || '未命名队伍')}</span>${badge}
        </div>`;
      });
    }

    // 俱乐部
    if (myClubs.length > 0) {
      html += `<div class="ch-sidebar__title">俱乐部</div>`;
      myClubs.forEach(c => {
        const isActive = activeRoom?.type === 'club' && String(activeRoom.targetId) === String(c.id);
        const badge = (unreadCounts?.club?.[c.id] || 0) > 0
          ? ` <span class="ch-room-item__badge">${unreadCounts.club[c.id]}</span>` : '';
        html += `<div class="ch-room-item${isActive ? ' active' : ''}" data-type="club" data-id="${c.id}" onclick="ChatView._handleRoomClick('club','${c.id}')">
          <span class="ch-room-item__icon">🏠</span>
          <span class="ch-room-item__name">${escapeHtml(c.name || '未命名俱乐部')}</span>${badge}
        </div>`;
      });
    }

    container.innerHTML = html || '<div class="ch-empty" style="padding:20px;font-size:.8rem;color:var(--text-muted);">暂无会话</div>';
  }

  // ===== 消息列表渲染 =====
  /**
   * 全量替换消息列表
   * @param {Array} messages
   * @param {Object} currentUser
   */
  function renderMessages(messages, currentUser) {
    const container = $('chMessages');
    if (!container) return;
    if (!messages || messages.length === 0) {
      container.innerHTML = '<div class="ch-empty"><div class="ch-empty__icon">💬</div><div>暂无消息，来说点什么吧~</div></div>';
      return;
    }
    container.innerHTML = messages.map(msg => createMessageHTML(msg, currentUser)).join('');
    scrollToBottom();
  }

  /**
   * 追加单条消息（socket 推送时用）
   */
  function appendMessage(msg, currentUser) {
    const container = $('chMessages');
    if (!container) return;
    const empty = container.querySelector('.ch-empty');
    if (empty) empty.remove();
    container.insertAdjacentHTML('beforeend', createMessageHTML(msg, currentUser));
    scrollToBottom();
  }

  /**
   * 生成单条消息 HTML
   * 不依赖 window.currentUser，currentUser 由参数传入
   */
  function createMessageHTML(msg, currentUser) {
    const isMe    = currentUser && msg.sender_id === currentUser.id;
    const time    = new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const avatar  = (msg.sender_name || '?')[0];
    const name    = escapeHtml(msg.sender_name || '未知');
    const teamTag = msg.sender_team ? ' · ' + escapeHtml(msg.sender_team) : '';

    // 身份 badge
    const identity     = msg.sender?.identity || (isMe && currentUser ? (currentUser.id === 'mp4hmya7ad15v6' ? 'admin' : 'uncertified') : 'uncertified');
    const idColor      = identityColors[identity] || '#9ca3af';
    const idLabel      = identityLabels[identity] || '';
    const idBadgeHtml = idLabel ? `<span style="background:${idColor}20;color:${idColor};border:1px solid ${idColor}40;font-size:.65rem;padding:1px 5px;border-radius:6px;margin-left:4px;">${idLabel}</span>` : '';

    // 内容
    let contentHtml;
    if (msg.recalled) {
      contentHtml = `<span style="font-style:italic;opacity:0.6;">${name} 撤回了一条消息</span>`;
    } else {
      let txt = escapeHtml(msg.content || '');
      if (msg.mentions && msg.mentions.length > 0) {
        txt = txt.replace(/@(\S+)/g, '<span style="color:var(--gold);font-weight:600;">@$1</span>');
      }
      contentHtml = txt;
    }

    // 撤回按钮（仅自己的消息 + 2分钟内）
    const msgAge    = (Date.now() - new Date(msg.created_at).getTime()) / 1000;
    const showRecall = isMe && !msg.recalled && msgAge < 120;
    const recallHtml = showRecall ? `<span style="color:var(--text-muted);font-size:.75rem;cursor:pointer;margin-left:8px;" onclick="ChatView._handleRecallClick(${msg.id})">撤回</span>` : '';

    // 管理员更多操作
    const isAdmin  = currentUser && currentUser.id === 'mp4hmya7ad15v6';
    const safeName = name.replace(/"/g, '&quot;');
    const moreHtml = (!isMe && isAdmin) ? `<span style="cursor:pointer;font-size:1rem;margin-left:6px;" onclick="ChatView._handleMoreClick(${msg.id},'${safeName}','${msg.sender_id}')">⋮</span>` : '';

    const recalledClass = msg.recalled ? ' ch-msg--recalled' : '';
    const msgClass = 'ch-msg' + (isMe ? ' ch-msg--self' : '') + recalledClass;

    return `
      <div class="${msgClass}" data-msg-id="${msg.id}"
           ${!isMe ? `onclick="ChatView._handleAvatarClick('${msg.sender_id}')" oncontextmenu="return ChatView._handleContextMenu(event,${msg.id},'${safeName}','${msg.sender_id}')"` : ''}>
        <div class="ch-msg__avatar">${avatar}</div>
        <div class="ch-msg__body">
          <div class="ch-msg__header">
            <span class="ch-msg__name" style="color:${idColor};">${name}${teamTag}${idBadgeHtml}</span>
            <span class="ch-msg__time">${time}</span>
            ${moreHtml}
          </div>
          <div class="ch-msg__text">${contentHtml}${recallHtml}</div>
        </div>
      </div>
    `;
  }

  // ===== 未读 Badge 渲染 =====
  function renderBadges(unreadCounts, activeType) {
    // 更新顶栏总未读（可选）
    const total = Object.values(unreadCounts || {}).reduce((a, b) => a + (typeof b === 'number' ? b : Object.values(b || {}).reduce((x, y) => x + y, 0)), 0);
    // chRoomName 旁边的 badge 不在这里处理，由 chStatusIcon 旁边的元素承担
    // 各房间项的 badge 由 renderRoomList 处理
  }

  // ===== Toast =====
  function showToast(msg, type) {
    let toast = $('ch-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ch-toast';
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,.9);color:#fff;padding:8px 20px;border-radius:8px;font-size:.85rem;z-index:9999;pointer-events:none;animation:chFadeIn .3s ease;';
      document.body.appendChild(toast);
      // 自动移除
      setTimeout(() => { if (toast && toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
    }
    toast.textContent = msg;
    toast.style.background = type === 'success' ? 'rgba(16,185,129,.9)' : 'rgba(239,68,68,.9)';
  }

  // ===== 连接状态更新 =====
  function updateStatusIcon(isConnected) {
    const icon = $('chStatusIcon');
    if (icon) {
      icon.style.background = isConnected ? '#10b981' : '#6b7280';
      icon.title = isConnected ? '在线' : '离线';
    }
  }

  // ===== 公开方法（事件委托入口）=====
  return {
    // --- 渲染方法 ---
    renderRoomList,
    renderMessages,
    appendMessage,
    renderBadges,
    showToast,
    updateStatusIcon,

    // --- 房间列表点击委托（由 chatRoomManager 调用）---
    _handleRoomClick(type, id) {
      if (_onSelectTarget) _onSelectTarget(type, id || null, '');
    },

    // --- 头像点击 ---
    _handleAvatarClick(senderId) {
      if (_onAvatarClick) _onAvatarClick(senderId);
    },

    // --- 撤回点击 ---
    _handleRecallClick(msgId) {
      if (_onRecallClick) _onRecallClick(msgId);
    },

    // --- 更多操作 ---
    _handleMoreClick(msgId, senderName, senderId) {
      if (_onMoreClick) _onMoreClick(msgId, senderName, senderId);
    },

    // --- 右键菜单 ---
    _handleContextMenu(event, msgId, senderName, senderId) {
      if (_onContextMenu) return _onContextMenu(event, msgId, senderName, senderId);
      return true;
    },

    // --- 类型切换（侧边栏 tab）---
    _handleSwitchType(type) {
      if (_onSwitchType) _onSwitchType(type);
    },

    // --- 发送按钮 ---
    _handleSendClick() {
      if (_onSendClick) _onSendClick();
    },

    // --- 搜索输入 ---
    _handleSearchInput(event) {
      if (_onSearchInput) _onSearchInput(event);
    },

    // --- 回调注册（由 chatPage.js 注入）---
    set onAvatarClick(fn)  { _onAvatarClick = fn; },
    set onRecallClick(fn) { _onRecallClick = fn; },
    set onMoreClick(fn)   { _onMoreClick = fn; },
    set onContextMenu(fn)  { _onContextMenu = fn; },
    set onSwitchType(fn)   { _onSwitchType = fn; },
    set onSendClick(fn)    { _onSendClick = fn; },
    set onSelectTarget(fn)  { _onSelectTarget = fn; },
    set onSearchInput(fn)   { _onSearchInput = fn; },

    // --- 销毁（解绑回调）---
    destroy() {
      _onAvatarClick  = null;
      _onRecallClick = null;
      _onMoreClick   = null;
      _onContextMenu  = null;
      _onSwitchType   = null;
      _onSendClick    = null;
      _onSelectTarget = null;
      _onSearchInput  = null;
      // 移除动态创建的 toast
      const toast = $('ch-toast');
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }
  };
})();

window.ChatView = ChatView;
