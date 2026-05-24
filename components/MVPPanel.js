/**
 * MVPPanel 组件（v20260522d — HUD化）
 * MVP 展示组件 — 金色重点卡、浮动动画（仅 MVP 面板使用）
 * 支持：MVP 加成统计、头像展示
 *
 * 用法：MVPPanel.mount(container, match, opts)
 *       MVPPanel.render(match, opts) → HTML string
 */

const MVPPanel = (() => {

  /**
   * 渲染 MVP 面板（HUD化：去噪音，金色高亮仅用于 MVP）
   * @param {Object} match - 统一 Match Object
   *   Required: id, status, mvp_id
   *   Optional: teams, users lookup
   * @param {Object} [opts]
   *   - size: 'sm'|'md'|'lg'  (默认 'md')
   *   - showStats: boolean       (默认 true，显示 MVP 加成)
   *   - horizontal: boolean      (默认 false，横向布局)
   * @returns {string} HTML string
   */
  function render(match, opts = {}) {
    if (!match) return '';

    const { size = 'md', showStats = true, horizontal = false } = opts;
    const status  = (match.status || 'CREATED').toUpperCase();
    const isFinished = status === 'FINISHED';
    const isLive     = status === 'LIVE';

    /* ── 找 MVP 选手信息 ──────────────────── */
    const mvp = extractMVP(match);
    const hasMvp = !!(mvp && mvp.name);

    const panelClass = [
      'mvp-panel',
      `mvp-panel--${size}`,
      hasMvp    ? 'mvp-panel--active' : 'mvp-panel--empty',
      isLive    ? 'mvp-panel--animated'  : '',
      horizontal ? 'mvp-panel--horizontal' : '',
    ].filter(Boolean).join(' ');

    /* ── 空状态 ────────────────────────────── */
    if (!hasMvp) {
      return `
        <div class="${panelClass}">
          <div class="mvp-panel__empty-icon">&#127942;</div>
          <div class="mvp-panel__empty-text">
            ${isLive ? '比赛进行中，MVP 即将揭晓…' : '暂无 MVP 信息'}
          </div>
        </div>`;
    }

    /* ── 头像（HUD 风格：无光环，低饱和边框） ───── */
    const avatarHtml = mvp.avatar
      ? `<img src="${escAttr(mvp.avatar)}" alt="${escHtml(mvp.name)}">`
      : `<span style="font-size:1.6rem;">&#128100;</span>`;

    /* ── 统计数据（HUD 风格：低饱和背景） ─── */
    const statsHtml = showStats ? renderStats(match, mvp) : '';

    /* ── 主 HTML ─────────────────────────────── */
    return `
      <div class="${panelClass}">
        <div class="mvp-panel__badge">&#127942; MVP</div>
        <div class="mvp-panel__body-row">
          <div class="mvp-panel__avatar" title="${escHtml(mvp.name)}">
            ${avatarHtml}
          </div>
          <div class="mvp-panel__info">
            <div class="mvp-panel__name">${escHtml(mvp.name)}</div>
            ${mvp.gameId ? `<div class="mvp-panel__game-id">ID: ${escHtml(mvp.gameId)}</div>` : ''}
            ${mvp.level  ? `<div class="mvp-panel__level">&#11088; ${escHtml(mvp.level)}</div>` : ''}
            ${statsHtml}
          </div>
        </div>
      </div>`;
  }

  /** 渲染 MVP 加成统计 */
  function renderStats(match, mvp) {
    const parts = [];
    // 身价加成 +2%
    parts.push(`<span class="mvp-panel__stat mvp-panel__stat--bonus">身价 +2%</span>`);
    // 梦币奖励
    if (match.prizePool && match.prizePool > 0) {
      const bonus = Math.round(match.prizePool * 0.1);
      parts.push(`<span class="mvp-panel__stat mvp-panel__stat--bonus">+${bonus} 梦币</span>`);
    }
    if (!parts.length) return '';
    return `<div class="mvp-panel__stats">${parts.join('')}</div>`;
  }

  /** 从 match 提取 MVP 信息 */
  function extractMVP(match) {
    if (!match.mvp_id) return null;
    // 1) 直接有 mvp_name
    if (match.mvp_name) {
      return {
        id:       match.mvp_id,
        name:     match.mvp_name,
        gameId:   match.mvp_game_id || '',
        level:    match.mvp_level  || '',
        avatar:   match.mvp_avatar || '',
      };
    }
    // 2) 从 participants 里找
    const list = match.participants || match.players || [];
    const found = list.find(p => String(p.user_id) === String(match.mvp_id));
    if (found) {
      return {
        id:       found.user_id,
        name:     found.username || found.game_id || 'Unknown',
        gameId:   found.game_id   || '',
        level:    found.level      || '',
        avatar:   found.avatar    || '',
      };
    }
    // 3) 兜底
    return { id: match.mvp_id, name: `Player ${match.mvp_id}` };
  }

  /** 直接挂载到 DOM */
  function mount(container, match, opts = {}) {
    if (!container) return;
    container.innerHTML = render(match, opts);
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escAttr(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/"/g,  '&quot;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;');
  }

  return { render, mount, extractMVP };
})();

window.MVPPanel = MVPPanel;
