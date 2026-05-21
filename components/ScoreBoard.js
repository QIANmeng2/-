/**
 * ScoreBoard 组件（v20260522d — HUD化）
 * 赛事详情页核心视觉 — 巨型比分、战队对抗布局、LIVE 状态、BO 进度点
 *
 * 用法：ScoreBoard.mount(container, match, opts)
 *       ScoreBoard.render(match, opts) → HTML string
 */

const ScoreBoard = (() => {

  /**
   * 渲染巨型比分板（HUD化：去噪音，强信息层级）
   */
  function render(match, opts = {}) {
    if (!match || !match.id) return '';

    const {
      size = 'lg',
      showBoProgress = true,
      showMap = false,
      showKDA = false,
    } = opts;

    const status  = (match.status || 'CREATED').toUpperCase();
    const isLive     = status === 'LIVE';
    const isFinished = status === 'FINISHED';
    const isReady    = status === 'READY';
    const score      = match.score || { red: 0, blue: 0 };
    const bo         = match.bo || 1;
    const winner     = match.winner || '';

    const redTeam  = extractTeamName(match, 'red')  || '红方战队';
    const blueTeam = extractTeamName(match, 'blue') || '蓝方战队';

    const redWon  = winner === 'red';
    const blueWon = winner === 'blue';
    const isDraw  = winner === 'draw';

    /* ── 类名 ─────────────────────────────── */
    const boardClass = [
      'scoreboard',
      `scoreboard--${size}`,
      isLive     ? 'scoreboard--live'     : '',
      isFinished ? 'scoreboard--finished' : '',
      isReady    ? 'scoreboard--ready'    : '',
    ].filter(Boolean).join(' ');

    /* ── 状态横幅（HUD 风格：低饱和背景 + 高对比文字） ───── */
    let statusBanner = '';
    if (isLive) {
      statusBanner = `
        <div class="scoreboard__status-banner scoreboard__status-banner--live">
          <span class="scoreboard__live-dot"></span>
          比赛进行中 · LIVE
          ${match.start_time ? `<span class="scoreboard__timer">${elapsedText(match.start_time)}</span>` : ''}
        </div>`;
    } else if (isFinished) {
      const label = isDraw ? '平局' : `${redWon ? redTeam : blueTeam} 获胜！`;
      statusBanner = `
        <div class="scoreboard__status-banner scoreboard__status-banner--finished">
          &#127942; ${escHtml(label)}
        </div>`;
    } else if (isReady) {
      statusBanner = `
        <div class="scoreboard__status-banner scoreboard__status-banner--ready">
          &#9881; 准备就绪，即将开始
        </div>`;
    }

    /* ── 战队区块 ────────────────────────── */
    const redCls  = redWon  ? 'scoreboard__team--winner' : '';
    const blueCls = blueWon ? 'scoreboard__team--winner' : '';
    const drawCls = isDraw   ? 'scoreboard__team--draw'   : '';

    const boHtml   = showBoProgress ? renderBoProgress(score, bo, winner) : '';
    const mapHtml  = showMap && match.map_name
      ? `<div class="scoreboard__map">&#128506; ${escHtml(match.map_name)}</div>`
      : '';
    const kdaHtml = showKDA
      ? `<div class="scoreboard__kda-row">
           <span class="scoreboard__kda">${escHtml(match.red_kda || '')}</span>
           <span class="scoreboard__kda-sep">KDA</span>
           <span class="scoreboard__kda">${escHtml(match.blue_kda || '')}</span>
         </div>`
      : '';

    /* ── 主 HTML（HUD 化：巨型比分居中） ─── */
    return `
      <div class="${boardClass}">
        ${statusBanner}
        <div class="scoreboard__body">
          <!-- 红方 -->
          <div class="scoreboard__team scoreboard__team--red ${redCls} ${drawCls}">
            <div class="scoreboard__team-name">${escHtml(redTeam)}</div>
            ${mapHtml}
          </div>
          <!-- 巨型比分 -->
          <div class="scoreboard__score-area">
            <span class="scoreboard__score-num ${redWon ? 'winner' : ''}">${score.red}</span>
            <span class="scoreboard__score-sep">:</span>
            <span class="scoreboard__score-num ${blueWon ? 'winner' : ''}">${score.blue}</span>
          </div>
          <!-- 蓝方 -->
          <div class="scoreboard__team scoreboard__team--blue ${blueCls} ${drawCls}">
            <div class="scoreboard__team-name">${escHtml(blueTeam)}</div>
            ${mapHtml}
          </div>
        </div>
        ${boHtml}
        ${kdaHtml}
      </div>`;
  }

  /* ── mount：直接挂到 DOM ─────────────────────── */
  function mount(container, match, opts = {}) {
    if (!container) return;
    container.innerHTML = render(match, opts);
  }

  /* ── BO 进度点（HUD 风格：低饱和圆点） ───── */
  function renderBoProgress(score, bo, winner) {
    const redWins  = score.red || 0;
    const blueWins = score.blue || 0;
    const total    = Math.max(bo, redWins + blueWins);
    let html = '<div class="scoreboard__bo-progress">';
    for (let i = 0; i < total; i++) {
      let cls = 'scoreboard__bo-dot';
      if (i < redWins)  cls += ' scoreboard__bo-dot--red';
      else if (i < redWins + blueWins) cls += ' scoreboard__bo-dot--blue';
      html += `<span class="${cls}"></span>`;
    }
    html += '</div>';
    return html;
  }

  /* ─── helpers ─────────────────────────────── */
  function extractTeamName(match, side) {
    if (Array.isArray(match.teams)) {
      const t = match.teams.find(t => t.side === side);
      if (t && (t.club_name || t.name)) return t.club_name || t.name;
    }
    if (side === 'red'  && match.red_club_name)  return match.red_club_name;
    if (side === 'blue' && match.blue_club_name) return match.blue_club_name;
    return null;
  }

  function elapsedText(startIso) {
    try {
      const diff = Date.now() - new Date(startIso).getTime();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    } catch { return ''; }
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { render, mount, renderBoProgress };
})();

window.ScoreBoard = ScoreBoard;
