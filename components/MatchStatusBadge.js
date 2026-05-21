/**
 * MatchStatusBadge 组件（v20260522d — HUD化）
 * 统一赛事状态标签 — 支持 xs/sm/md/lg 四档尺寸
 * 用法：MatchStatusBadge.render(match, { size:'xs' }) → HTML string
 */

const MatchStatusBadge = (() => {
  // 状态 → 中文标签（电竞世界观）
  const STATUS_LABELS = {
    CREATED:      '已创建',
    REGISTERING:  '报名中',
    READY:        '准备就绪',
    LIVE:         '进行中',
    FINISHED:     '已结束',
    ARCHIVED:     '已归档',
  };

  // 状态 → 样式 class（对应 variables.css 中的定义）
  const STATUS_CLASSES = {
    CREATED:      'status-created',
    REGISTERING:  'status-registering',
    READY:        'status-ready',
    LIVE:         'status-live',
    FINISHED:     'status-finished',
    ARCHIVED:     'status-archived',
  };

  // 状态 → 圆点颜色 + 动画
  const STATUS_DOT = {
    CREATED:      { color: '#6b7280', animate: false },
    REGISTERING:  { color: '#f59e0b', animate: 'pulse' },
    READY:        { color: '#3b82f6', animate: false },
    LIVE:         { color: '#ef4444', animate: 'ping' },
    FINISHED:     { color: '#10b981', animate: false },
    ARCHIVED:     { color: '#374151', animate: false },
  };

  /**
   * 渲染状态标签 HTML
   * @param {object} match  - 比赛对象
   * @param {object} opts   - { size, dot, pill }
   * @returns {string} HTML
   */
  function render(match, opts = {}) {
    if (!match || !match.status) return '';

    const status = match.status.toUpperCase();
    const label  = STATUS_LABELS[status] || match.status;
    const cls    = STATUS_CLASSES[status] || '';
    const dot    = STATUS_DOT[status] || { color: '#6b7280', animate: false };
    const size   = opts.size || 'md';
    const showDot = opts.dot !== false;
    const pill   = opts.pill !== false;

    // class 列表：基础 + 状态色 + 尺寸 + pill 形状
    const classes = [
      'match-status-badge',
      cls,
      `match-status-badge--${size}`,
      pill ? 'match-status-badge--pill' : ''
    ].filter(Boolean).join(' ');

    let dotHtml = '';
    if (showDot) {
      const animClass = dot.animate ? ` status-dot--${dot.animate}` : '';
      dotHtml = `<span class="status-dot${animClass}" style="background:${dot.color};"></span>`;
    }

    return `<span class="${classes}">${dotHtml}<span class="status-label">${label}</span></span>`;
  }

  /**
   * 直接挂载到 DOM 节点
   */
  function mount(container, match, opts = {}) {
    if (!container) return;
    container.innerHTML = render(match, opts);
  }

  /**
   * 仅返回纯文本标签（用于无 CSS 环境）
   */
  function labelOnly(match) {
    if (!match || !match.status) return '';
    return STATUS_LABELS[match.status.toUpperCase()] || match.status;
  }

  return { render, mount, labelOnly, STATUS_LABELS, STATUS_CLASSES };
})();

window.MatchStatusBadge = MatchStatusBadge;
