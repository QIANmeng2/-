/**
 * MatchCard 组件（v20260522d — 信息层级重构）
 * 核心目标：S/A/B/C 信息权重 + 移动端优先 + HUD化（去噪音）
 *
 * 信息层级：
 *   S级（最大）：比分 2:1
 *   A级（次大）：战队名 DreamFire VS NightSoul
 *   B级（标签）：LIVE / BO5 / 联赛标签
 *   C级（弱化）：奖池 / 观战人数 / 时间
 *
 * 用法：MatchCard.render(match, opts) → HTML string
 */

const MatchCard = (() => {

  const TYPE_LABELS = {
    training: '训练赛',
    arena:   '擂台赛',
    regular: '常规赛事',
  };

  const TYPE_ICONS = {
    training: '⚔',
    arena:   '⛶',
    regular: '💰',
  };

  /* ── 主渲染 ────────────────────────────────────────── */
  function render(match, opts = {}) {
    if (!match || !match.id) return '';

    const {
      clickable  = true,
      showMode   = true,
      showTime   = false,
      compact    = false,   // 移动端纵向压缩
    } = opts;

    const status     = (match.status || 'CREATED').toUpperCase();
    const isLive     = status === 'LIVE';
    const isFinished = status === 'FINISHED';
    const isReady    = status === 'READY';
    const score      = match.score || { red: 0, blue: 0 };
    const bo         = match.bo || 1;

    const redTeam  = extractTeamName(match, 'red')  || '红方';
    const blueTeam = extractTeamName(match, 'blue') || '蓝方';

    const prizeText = formatPrize(match);
    const timeText  = showTime && match.start_time
      ? formatTime(match.start_time) : '';

    /* ── 卡片整体 class ─────────────────────────────── */
    const cardClass = [
      'match-card',
      compact ? 'match-card--compact' : '',
      isLive     ? 'match-card--live'     : '',
      isFinished ? 'match-card--finished' : '',
    ].filter(Boolean).join(' ');

    /* ── 状态徽章（B级，小号 pill） ───────────────── */
    const statusBadgeHtml = window.MatchStatusBadge
      ? window.MatchStatusBadge.render(match, { size: 'xs', dot: true, pill: true })
      : `<span class="match-card__status-pill status-${status.toLowerCase()}">${status}</span>`;

    /* ── S级：比分区（绝对视觉重心） ──────────────── */
    let scoreHtml = '';
    if (isLive || isFinished) {
      const redWon  = match.winner === 'red';
      const blueWon = match.winner === 'blue';
      scoreHtml = `
        <div class="match-card__score ${isFinished ? 'match-card__score--finished' : ''}">
          <span class="match-card__score-num ${redWon  ? 'winner' : ''}">${score.red}</span>
          <span class="match-card__score-sep">:</span>
          <span class="match-card__score-num ${blueWon ? 'winner' : ''}">${score.blue}</span>
        </div>`;
    } else {
      scoreHtml = `<div class="match-card__score match-card__score--vs">VS</div>`;
    }

    /* ── B级：BO标签 + 联赛标签（小号 pill） ─────── */
    const boHtml = bo > 1
      ? `<span class="match-card__bo-pill">BO${bo}</span>`
      : '';

    const modeHtml = showMode
      ? `<span class="match-card__mode-pill">${TYPE_ICONS[match.mode] || '🎮'} ${TYPE_LABELS[match.mode] || match.mode}</span>`
      : '';

    /* ── C级：奖池（footer 小字灰化） ───────────── */
    const prizeHtml = prizeText
      ? `<div class="match-card__prize">${prizeText}</div>`
      : '';

    /* ── HTML 结构（HUD化：紧凑、无装饰发光） ───── */
    const inner = `
      <div class="match-card">
        <!-- 顶栏：状态 + BO + 联赛 -->
        <div class="match-card__topbar">
          ${statusBadgeHtml}
          ${boHtml}
          ${modeHtml}
          ${timeText ? `<span class="match-card__time-pill">🕐 ${timeText}</span>` : ''}
        </div>

        <!-- 主体：战队 + 比分 -->
        <div class="match-card__body">
          <div class="match-card__team match-card__team--red">
            <span class="match-card__team-dot"></span>
            <span class="match-card__team-name">${escHtml(redTeam)}</span>
          </div>
          ${scoreHtml}
          <div class="match-card__team match-card__team--blue">
            <span class="match-card__team-dot"></span>
            <span class="match-card__team-name">${escHtml(blueTeam)}</span>
          </div>
        </div>

        <!-- 底栏：C级信息 -->
        ${prizeHtml}
      </div>
    `;

    if (!clickable) {
      return `<div class="${cardClass}">${inner}</div>`;
    }
    return `<div class="${cardClass}" data-match-id="${escHtml(match.id)}">${inner}</div>`;
  }

  /* ── 批量渲染 ────────────────────────────────────── */
  function renderList(matches, opts = {}) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return `<div class="match-card__empty">暂无赛事，快来开启一场对局！</div>`;
    }
    const cards = matches.map((m, i) => {
      const html = render(m, opts);
      return html.replace(
        'match-card"',
        `match-card" style="animation-delay:${i * 40}ms"`
      );
    }).join('');
    return `<div class="match-card__list">${cards}</div>`;
  }

  /* ─── helpers ─────────────────────────────────────── */
  function extractTeamName(match, side) {
    if (Array.isArray(match.teams)) {
      const t = match.teams.find(t => t.side === side);
      if (t && (t.club_name || t.name)) return t.club_name || t.name;
    }
    if (side === 'red'  && match.red_club_name)  return match.red_club_name;
    if (side === 'blue' && match.blue_club_name) return match.blue_club_name;
    return null;
  }

  function formatPrize(match) {
    if (match.mode === 'regular' && match.prize_pool) {
      return `🏆 奖池 ${match.prize_pool} 梦币`;
    }
    if (match.entryFee) {
      return `💰 入场费 ${match.entryFee} 梦币`;
    }
    if (match.prizePool) {
      return `🏆 奖池 ${match.prizePool} 梦币`;
    }
    return '';
  }

  function formatTime(isoStr) {
    try {
      const d = new Date(isoStr);
      return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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

  return { render, renderList, TYPE_LABELS, TYPE_ICONS };
})();

window.MatchCard = MatchCard;
