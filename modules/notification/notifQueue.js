/**
 * notifQueue — 通知操作队列（IIFE 闭包）
 * 职责：缓存离线/断线期间的用户操作（标记已读、删除），
 *          网络恢复后批量提交
 * 禁止：不操作 DOM，不操作 Store（仅回调通知）
 * version: 20260523a
 */
const NotifQueue = (() => {
  'use strict';

  const STORAGE_KEY = 'qm_notif_queue';

  let queue = [];           // { action, payload, timestamp }
  let flushing = false;
  let onFlushCallback = null; // (results) => void
  let onErrorCallback = null; // (err, action) => void

  // ---- 内部：从 localStorage 恢复 ----
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      queue = raw ? JSON.parse(raw) : [];
    } catch (e) {
      queue = [];
    }
  }

  // ---- 内部：持久化到 localStorage ----
  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn('[NotifQueue] localStorage 写入失败:', e.message);
    }
  }

  // ---- 内部：执行单个操作 ----
  async function _exec(action) {
    const api = window.AuthApi?._request ?? window.fetch;
    const API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';

    if (action.type === 'mark_read') {
      const res = await fetch(`${API_BASE}/api/notifications/read`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (window.AuthApi?.getToken?.() || '')
        },
        body: JSON.stringify({ ids: action.payload.ids })
      });
      if (!res.ok) throw new Error('标记已读失败: ' + res.status);
      return { type: 'mark_read', ids: action.payload.ids };

    } else if (action.type === 'delete') {
      const res = await fetch(`${API_BASE}/api/notifications`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (window.AuthApi?.getToken?.() || '')
        },
        body: JSON.stringify({ ids: action.payload.ids })
      });
      if (!res.ok) throw new Error('删除通知失败: ' + res.status);
      return { type: 'delete', ids: action.payload.ids };

    } else if (action.type === 'mark_all_read') {
      const res = await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + (window.AuthApi?.getToken?.() || '')
        }
      });
      if (!res.ok) throw new Error('全部已读失败: ' + res.status);
      return { type: 'mark_all_read' };
    }
  }

  // ---- 内部：批量刷新队列 ----
  async function _flush() {
    if (flushing || queue.length === 0) return;
    if (!window.SocketManager?.isConnected?.()) return;

    flushing = true;
    const results = [];

    for (const action of [...queue]) {
      try {
        const result = await _exec(action);
        results.push({ success: true, ...result });
        // 成功后移除
        queue = queue.filter(a => a !== action);
        _save();
      } catch (e) {
        console.error('[NotifQueue] 操作失败:', action.type, e.message);
        if (onErrorCallback) {
          try { onErrorCallback(e, action); } catch {}
        }
        // 失败的操作保留在队列中，下次重试
        break;
      }
    }

    flushing = false;

    if (onFlushCallback && results.length > 0) {
      try { onFlushCallback(results); } catch {}
    }
  }

  // ========== public API ==========

  // ---- 初始化：恢复队列 + 监听网络恢复 ----
  function init(opts = {}) {
    onFlushCallback = typeof opts.onFlush === 'function' ? opts.onFlush : null;
    onErrorCallback = typeof opts.onError === 'function' ? opts.onError : null;

    _load();

    // 网络恢复时自动刷新
    window.addEventListener('online', () => {
      console.log('[NotifQueue] 网络恢复，刷新队列');
      _flush();
    });

    // Socket 重连成功时也刷新
    if (window.SocketManager) {
      window.SocketManager.on('reconnect', () => _flush());
    }

    // 如果当前在线，立即尝试刷新
    if (navigator.onLine) {
      setTimeout(_flush, 1000);
    }
  }

  // ---- 入队：标记单条/批量已读 ----
  function enqueueMarkRead(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    queue.push({
      type: 'mark_read',
      payload: { ids },
      timestamp: Date.now()
    });
    _save();
    _flush();
  }

  // ---- 入队：标记全部已读 ----
  function enqueueMarkAllRead() {
    queue.push({
      type: 'mark_all_read',
      payload: {},
      timestamp: Date.now()
    });
    _save();
    _flush();
  }

  // ---- 入队：删除通知 ----
  function enqueueDelete(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    queue.push({
      type: 'delete',
      payload: { ids },
      timestamp: Date.now()
    });
    _save();
    _flush();
  }

  // ---- 获取当前队列长度（用于 UI 提示）----
  function getQueueLength() {
    return queue.length;
  }

  // ---- 清空队列（用户登出时调用）----
  function clear() {
    queue = [];
    _save();
  }

  // ---- 销毁 ----
  function destroy() {
    onFlushCallback = null;
    onErrorCallback = null;
    // 不清空队列，下次登录后可继续提交
  }

  return {
    init,
    enqueueMarkRead,
    enqueueMarkAllRead,
    enqueueDelete,
    getQueueLength,
    clear,
    destroy
  };
})();

window.NotifQueue = NotifQueue;
