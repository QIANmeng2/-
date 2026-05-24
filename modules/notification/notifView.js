/**
 * notifView — 通知 UI 渲染（IIFE 闭包）
 * 职责：渲染通知面板、未读 badge、公告折叠
 * 禁止：不操作 socket、不操作 Store（仅读取数据后渲染）
 * version: 20260523a
 */
const NotifView = (() => {
  'use strict';

  const ESC = typeof escapeHtml === 'function' ? escapeHtml : (s => s || '');

  // ---- 辅助：安全转义（兜底）----
  function _esc(s) {
    return ESC(String(s));
  }

  // ---- public: 渲染通知面板 ----
  // container: DOM 元素
  // data: { notifications: [], announcements: [], unreadCount: number }
  // handlers: { onAcceptInvite, onConfirmEntry, onMarkAllRead, onClose }
  function renderPanel(container, data = {}, handlers = {}) {
    if (!container) return;

    const notifs = Array.isArray(data.notifications) ? data.notifications : [];
    const ann = Array.isArray(data.announcements) ? data.announcements : [];

    let html = '<div style="padding:14px 0;">';

    // 公告模块
    if (ann.length > 0) {
      html += '<div style="margin-bottom:16px;">';
      html += '<div style="font-size:0.78rem;font-weight:600;color:var(--accent);margin-bottom:10px;display:flex;align-items:center;gap:6px;">📢 平台公告</div>';
      ann.slice(0, 3).forEach(a => {
        const titleEsc = _esc(a.title || '');
        const previewEsc = _esc((a.content || '').substring(0, 60));
        const fullEsc = _esc(a.content || '');
        const dateEsc = _esc(new Date(a.created_at).toLocaleDateString('zh-CN') || '');
        html += `<div class="notif-ann-item" data-id="${a.id || ''}" style="padding:12px;background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(245,158,11,.03));border:1px solid rgba(245,158,11,.2);border-radius:var(--radius-md);margin-bottom:8px;cursor:pointer;">
          <div style="font-weight:600;color:var(--text-primary);font-size:0.88rem;margin-bottom:4px;">${titleEsc}</div>
          <div class="notif-ann-preview" style="font-size:0.78rem;color:var(--text-muted);">${previewEsc}${(a.content||'').length > 60 ? '…' : ''}</div>
          <div class="notif-ann-full" style="display:none;font-size:0.82rem;color:var(--text-secondary);white-space:pre-wrap;margin-top:8px;line-height:1.6;">${fullEsc}</div>
          <small style="color:var(--text-muted);font-size:0.72rem;">${dateEsc}</small>
        </div>`;
      });
      html += '</div>';
      html += '<div style="border-top:1px solid var(--border-color);margin-bottom:12px;"></div>';
    }

    // 通知列表
    if (notifs.length === 0) {
      html += '<p style="text-align:center;color:var(--text-muted);padding:20px 0;">暂无通知</p>';
    } else {
      notifs.forEach(n => {
        const contentEsc = _esc(n.content || '');
        const timeEsc = _esc(new Date(n.created_at).toLocaleString() || '');
        const bgColor = n.read ? 'var(--bg-glass)' : 'rgba(0,212,255,.08)';
        const borderColor = n.read ? 'var(--border-color)' : 'rgba(0,212,255,.2)';
        let actions = '';

        if (n.type === 'team_invite' && handlers.onAcceptInvite) {
          actions = `<div style="margin-top:8px;"><button class="btn btn-primary btn-sm notif-accept-btn" data-id="${_esc(n.relatedId||'')}" style="font-size:0.78rem;">接受邀请</button></div>`;
        } else if (n.type === 'competition_register' && handlers.onConfirmEntry) {
          actions = `<div style="margin-top:8px;"><button class="btn btn-primary btn-sm notif-confirm-btn" data-id="${_esc(n.relatedId||'')}" style="font-size:0.78rem;">确认入场</button></div>`;
        }

        html += `<div class="notif-item ${n.read?'':'notif-unread'}" style="padding:12px;background:${bgColor};border-radius:var(--radius-md);margin-bottom:10px;font-size:0.88rem;border:1px solid ${borderColor};">${contentEsc}<br><small style="color:var(--text-muted);">${timeEsc}</small>${actions}</div>`;
      });
      html += '<button class="btn btn-primary btn-sm notif-mark-all-btn" style="width:100%;margin-top:8px;">全部已读</button>';
    }

    html += '</div>';
    container.innerHTML = html;

    // 公告展开/收起
    container.querySelectorAll('.notif-ann-item').forEach(item => {
      item.addEventListener('click', () => {
        const prev = item.querySelector('.notif-ann-preview');
        const full = item.querySelector('.notif-ann-full');
        if (!prev || !full) return;
        if (full.style.display === 'none') {
          prev.style.display = 'none';
          full.style.display = 'block';
        } else {
          prev.style.display = 'block';
          full.style.display = 'none';
        }
      });
    });

    // 全部已读
    const markAllBtn = container.querySelector('.notif-mark-all-btn');
    if (markAllBtn && handlers.onMarkAllRead) {
      markAllBtn.addEventListener('click', (e) => { e.stopPropagation(); handlers.onMarkAllRead(); });
    }

    // 接受邀请
    container.querySelectorAll('.notif-accept-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id && handlers.onAcceptInvite) handlers.onAcceptInvite(id);
      });
    });

    // 确认入场
    container.querySelectorAll('.notif-confirm-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id && handlers.onConfirmEntry) handlers.onConfirmEntry(id);
      });
    });
  }

  // ---- public: 更新未读 badge ----
  function updateBadge(count) {
    const badge = document.getElementById('notificationBadge') || document.getElementById('notifBadge');
    if (!badge) return;
    const n = Number(count) || 0;
    if (n > 0) {
      badge.style.display = 'inline-flex';
      badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      badge.style.display = 'none';
    }
  }

  // ---- public: 销毁面板 ----
  function destroyPanel() {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.remove();
  }

  return { renderPanel, updateBadge, destroyPanel };
})();

window.NotifView = NotifView;
