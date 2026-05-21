/**
 * Timeline 组件（v20260522d — 节奏化）
 * 事件流渲染 — 高光事件（MVP/胜利）更大更亮，普通事件正常，系统事件灰化弱化
 * 后续用于：实时播报、AI解说、比赛回放
 *
 * 用法：
 *   Timeline.render(match, opts)     → HTML string
 *   Timeline.mount(container, match) → 挂载
 *   Timeline.appendEvent(container, event) → 追加单条（实时场景）
 */

const Timeline = (() => {

  /** 事件类型 → 图标 + 中文标签 + 颜色 class */
  const TYPE_META = {
    KILL:       { icon: '&#9876;',  label: '击杀',   cls: 'kill' },
    ASSIST:     { icon: '&#128525;', label: '助攻',   cls: 'assist' },
    GOAL:       { icon: '&#127942;', label: '推塔',   cls: 'goal' },
    DRAGON:     { icon: '&#128025;', label: '小龙',   cls: 'dragon' },
    BARON:      { icon: '&#128016;', label: '大龙',   cls: 'baron' },
    TOWER:      { icon: '&#127983;', label: '防御塔', cls: 'tower' },
    WIN:        { icon: '&#127942;', label: '胜利',   cls: 'win' },
    SCORE:      { icon: '&#128200;', label: '比分更新', cls: 'score' },
    MVPAWARD:   { icon: '&#127942;', label: 'MVP',     cls: 'mvp' },
    STATUSCHANGE:{ icon: '&#128260;', label: '状态变更', cls: 'status' },
    CUSTOM:     { icon: '&#128221;', label: '自定义',   cls: 'custom' },
  };

  /** 队伍 → 颜色 class */
  const TEAM_CLS = {
    red:  'timeline__item--red',
    blue: 'timeline__item--blue',
  };

  /**
   * 渲染整条 Timeline
   */
  function render(match, opts = {}) {
    if (!match) return '';

    const { reverse = false, max = 0, compact = false } = opts;

    let events = Array.isArray(match.timeline) ? match.timeline : [];

    if (events.length === 0) {
      return `<div class="timeline timeline--empty">
                <div class="timeline__empty-icon">&#128221;</div>
                <div class="timeline__empty-text">暂无赛事事件</div>
                <div class="timeline__empty-hint">比赛开始后，事件将实时出现在这里</div>
              </div>`;
    }

    if (reverse) events = [...events].reverse();
    if (max > 0 && events.length > max) events = events.slice(0, max);

    const cls = ['timeline', compact ? 'timeline--compact' : ''].filter(Boolean).join(' ');

    const items = events.map((ev, i) => renderOne(ev, i, compact)).join('');

    return `<div class="${cls}" id="timeline-${escAttr(match.id || 'default')}">
              ${items}
            </div>`;
  }

  /**
   * 渲染单条事件（节奏化：高光/普通/系统 三级）
   */
  function renderOne(ev, index, compact) {
    if (!ev) return '';

    const meta    = TYPE_META[ev.type] || { icon: '&#128204;', label: ev.type || '事件', cls: 'custom' };
    const teamCls = TEAM_CLS[ev.team] || '';
    const typeCls = `timeline__item--${meta.cls}`;

    const sideDot = ev.team === 'red'
      ? '<span class="timeline__side-dot timeline__side-dot--red"></span>'
      : ev.team === 'blue'
        ? '<span class="timeline__side-dot timeline__side-dot--blue"></span>'
        : '';

    const timeStr  = formatTime(ev.created_at);
    const player   = ev.player_name ? `<span class="timeline__player">${escHtml(ev.player_name)}</span>` : '';
    const text     = escHtml(ev.text || meta.label);

    /* data 字段 */
    let dataHtml = '';
    if (ev.data && typeof ev.data === 'object') {
      const parts = [];
      if (ev.data.victim)    parts.push(`击杀 <b>${escHtml(ev.data.victim)}</b>`);
      if (ev.data.gold !== undefined) parts.push(`+${ev.data.gold}G`);
      if (ev.data.xp   !== undefined) parts.push(`+${ev.data.xp}XP`);
      if (parts.length) dataHtml = `<div class="timeline__data">${parts.join(' · ')}</div>`;
    }

    const itemCls = ['timeline__item', teamCls, typeCls, compact ? 'timeline__item--compact' : ''].filter(Boolean).join(' ');

    return `
      <div class="${itemCls}" data-index="${index}" data-type="${escAttr(ev.type || '')}">
        <div class="timeline__dot-col">
          <span class="timeline__dot">${meta.icon}</span>
        </div>
        <div class="timeline__content-col">
          <div class="timeline__header-row">
            ${sideDot}
            ${player}
            <span class="timeline__type-label timeline__type-label--${meta.cls}">${meta.label}</span>
            <span class="timeline__time">${timeStr}</span>
          </div>
          <div class="timeline__text">${text}</div>
          ${dataHtml}
        </div>
      </div>`;
  }

  /**
   * 追加单条事件（实时播报：Socket `timeline:add`）
   */
  function appendEvent(container, event, opts = {}) {
    if (!container || !event) return;
    const { prepend = false } = opts;
    const html = renderOne(event, Date.now(), false);
    container.insertAdjacentHTML(prepend ? 'afterbegin' : 'beforeend', html);
    if (!prepend) container.scrollTop = container.scrollHeight;
  }

  function clear(container) {
    if (!container) return;
    container.innerHTML = '';
  }

  /**
   * 从 API 拉取并渲染
   */
  async function load(matchId, container, opts = {}) {
    if (!matchId || !container) return;
    container.innerHTML = '<div class="timeline__loading">加载中…</div>';
    try {
      const API = window.API_BASE || '';
      const res  = await fetch(`${API}/api/matches/${matchId}/timeline`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || '加载失败');
      const html = render({ timeline: json.timeline || [] }, opts);
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="timeline__error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  /* ─── helpers ─────────────────────────────── */

  function formatTime(isoOrPg) {
    try {
      const d = new Date(isoOrPg);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    } catch { return ''; }
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { render, mount: (c, m, o) => { if(c) c.innerHTML = render(m, o); }, appendEvent, clear, load, TYPE_META };
})();

window.Timeline = Timeline;
