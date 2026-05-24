/**
 * chatPage.js — 聊天独立页初始化入口
 *
 * 设计原则：
 * - 页面级初始化，不依赖 app.js
 * - 不读取 window.xxx、globalState、currentUser
 * - 不调用 switchTab、updateUI、initChatSocket
 * - 进入页面才初始化，离开页面自动 destroy
 * - 完全对齐 chat.html 的 DOM ID（chRoomName / chInput / chMessages / chSendBtn / chStatusIcon）
 */
;(function () {
  'use strict';

  // ===== DOM 助手（对齐 chat.html）=====
  function $(id) { return document.getElementById(id); }

  // ===== 模块就绪检测 =====
  function waitForDeps(retries) {
    if (
      window.ChatStore &&
      window.ChatApi &&
      window.ChatView &&
      window.ChatRoomManager &&
      window.ChatSocket &&
      window.SocketManager
    ) {
      initPage();
    } else if (retries > 0) {
      setTimeout(function () { waitForDeps(retries - 1); }, 100);
    } else {
      renderFatal('聊天模块加载失败，请刷新页面重试。');
    }
  }

  // ===== 页面初始化 =====
  function initPage() {
    var Store   = window.ChatStore;
    var Api     = window.ChatApi;
    var View    = window.ChatView;
    var RoomMgr = window.ChatRoomManager;
    var Socket  = window.ChatSocket;

    // —— 1. 注入当前用户（从 AuthStore 获取，不读 window.currentUser）——
    try {
      if (window.AuthStore && typeof window.AuthStore.getState === 'function') {
        var authUser = window.AuthStore.getState().user;
        if (authUser) Store.setCurrentUser(authUser);
      }
    } catch (e) {}

    // —— 2. 绑定 ChatView 回调（所有按钮事件委托到这里）——
    if (View) {
      View._onAvatarClick = function (senderId) {
        if (typeof window.openPlayerDetailModal === 'function') {
          window.openPlayerDetailModal(senderId);
        }
      };
      View._onRecallClick = function (msgId) {
        handleRecall(msgId, Store, Api, View);
      };
      View._onMoreClick = function (msgId, senderName, senderId) {
        showAdminMenu(msgId, senderName, senderId);
      };
      View._onContextMenu = function (event, msgId, senderName, senderId) {
        event.preventDefault();
        showAdminMenu(msgId, senderName, senderId);
        return false;
      };
      View._onSwitchType = function (type) {
        handleSwitchType(type, Store, Api, RoomMgr, View);
      };
      View._onSendClick = function () {
        handleSendMessage(Store, Api, View);
      };
      View._onSelectTarget = function (type, id, name) {
        handleSelectTarget(type, id, name, Store, Api, RoomMgr, View);
      };
      View._onSearchInput = function (event) {
        handleSearch(event, Api, View);
      };

      // 绑定输入框 Enter 发送
      var input = $('chInput');
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage(Store, Api, View);
          }
        });
      }

      // 绑定发送按钮
      var sendBtn = $('chSendBtn');
      if (sendBtn) {
        sendBtn.addEventListener('click', function () {
          handleSendMessage(Store, Api, View);
        });
      }
    }

    // —— 3. 初始化房间管理器（绑定 Store → View 渲染链路）——
    RoomMgr.init();

    // —— 4. 加载面板数据（队伍/俱乐部/联系人）——
    loadPanelData(Api, Store, View);

    // —— 5. 默认进入公聊 ——
    RoomMgr.switchRoom('public', null);

    // —— 6. 暴露 reload 给外部（如 reconnect 后）——
    window.__CHAT_PAGE = {
      reload:  function () { loadPanelData(Api, Store, View); },
      destroy: destroyPage
    };

    console.log('[ChatPage] initialized');
  }

  // ===== 数据加载 =====
  function loadPanelData(Api, Store, View) {
    Promise.all([
      Api.getMyTeams().catch(function () { return []; }),
      Api.getMyClubs().catch(function () { return []; }),
      Api.getContacts().catch(function () { return []; })
    ]).then(function (results) {
      Store.setState({
        myTeams:  results[0] || [],
        myClubs:  results[1] || [],
        contacts: results[2] || []
      });
      // 渲染房间列表（由 ChatView.renderRoomList 处理）
      if (View && typeof View.renderRoomList === 'function') {
        View.renderRoomList(Store.getState());
      }
    }).catch(function (err) {
      console.error('[ChatPage] loadPanelData error:', err);
    });
  }

  // ===== 事件处理 =====
  function handleSwitchType(type, Store, Api, RoomMgr, View) {
    RoomMgr.switchRoom(type, null);
    var state = Store.getState();
    if (View && typeof View.renderTargetList === 'function') {
      if (type === 'private') {
        View.renderTargetList('private', state.contacts || []);
      } else if (type === 'team') {
        View.renderTargetList('team', state.myTeams || []);
      } else if (type === 'club') {
        View.renderTargetList('club', state.myClubs || []);
      } else {
        View.renderTargetList('public', []);
      }
    }
  }

  function handleSelectTarget(type, id, name, Store, Api, RoomMgr, View) {
    RoomMgr.switchRoom(type, id);
    var roomName = $('chRoomName');
    if (roomName) roomName.textContent = name || '公聊';
  }

  function handleSendMessage(Store, Api, View) {
    var input = $('chInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    input.value = '';
    input.focus();

    var state = Store.getState();
    var room  = state.activeRoom;
    if (!room) return;

    var body = { type: room.type, content: content };
    if (room.type === 'private' && room.targetId) body.receiver_id = room.targetId;
    if (room.type === 'team'    && room.targetId) body.team_id      = room.targetId;
    if (room.type === 'club'    && room.targetId) body.club_id     = room.targetId;

    Api.sendMessage(body).catch(function (err) {
      if (View && View.showToast) View.showToast('发送失败：' + err.message, 'error');
      input.value = content; // 恢复输入
    });
    // 注意：不在此处手动 append，socket new_message 回调会自动渲染
  }

  function handleRecall(msgId, Store, Api, View) {
    if (!confirm('确定撤回这条消息？')) return;
    Api.recallMessage(msgId).catch(function (err) {
      if (View && View.showToast) View.showToast('撤回失败：' + err.message, 'error');
    });
  }

  function handleSearch(event, Api, View) {
    var query = event.target.value.trim();
    if (!query) {
      var state = (window.ChatStore && window.ChatStore.getState()) || {};
      if (View && View.renderTargetList) View.renderTargetList('private', state.contacts || []);
      return;
    }
    var state = (window.ChatStore && window.ChatStore.getState()) || {};
    var filtered = (state.contacts || []).filter(function (c) {
      var name = c.gameid || c.username || '';
      return name.indexOf(query) !== -1;
    });
    if (View && View.renderTargetList) View.renderTargetList('private', filtered);
  }

  function showAdminMenu(msgId, senderName, senderId) {
    // 管理员操作：禁言（不依赖全局变量）
    var isAdmin = false;
    try {
      var authState = window.AuthStore && window.AuthStore.getState();
      isAdmin = authState && authState.user && authState.user.id === 'mp4hmya7ad15v6';
    } catch (e) {}
    if (!isAdmin) return;
    if (typeof window.showMuteDialog === 'function') {
      window.showMuteDialog(senderId, senderName);
    }
  }

  // ===== 页面销毁 =====
  function destroyPage() {
    if (window.ChatRoomManager) {
      window.ChatRoomManager.destroy();
    }
    // 清理暴露的回调
    if (window.ChatView) {
      var View = window.ChatView;
      View._onAvatarClick  = null;
      View._onRecallClick  = null;
      View._onMoreClick    = null;
      View._onContextMenu  = null;
      View._onSwitchType   = null;
      View._onSendClick    = null;
      View._onSelectTarget = null;
      View._onSearchInput   = null;
    }
    // 清空聊天消息 DOM
    var container = $('chMessages');
    if (container) container.innerHTML = '';
    // 禁用输入框
    var input = $('chInput');
    if (input) input.disabled = true;
    var sendBtn = $('chSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    console.log('[ChatPage] destroyed');
  }

  // ===== 致命错误渲染 =====
  function renderFatal(msg) {
    var container = $('chMessages');
    if (!container) return;
    container.innerHTML =
      '<div class="ch-empty" style="color:var(--danger);padding:40px;">' +
        '<div style="font-size:2.5rem;margin-bottom:12px;opacity:.3;">⚠️</div>' +
        '<div>' + escapeHtml(msg) + '</div>' +
        '<br><button class="ch-btn ch-btn--primary" onclick="location.reload()" style="margin-top:12px;">刷新页面</button>' +
      '</div>';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===== 启动 =====
  function boot() {
    // 依赖：脚本加载顺序（socket* → auth* → chat* → chatPage）
    waitForDeps(50); // 最多等 5 秒
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
