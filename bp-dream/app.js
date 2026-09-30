'use strict';

const UPDATE_ROOT = 'https://download.neondream.cn/bp-dream-updates/win/';
const ADMIN_URL = 'https://175.178.52.116/bp-dream-admin/';
const THEME_KEY = 'bp-web-theme';
const USED_KEY = 'bp-web-used-card-ids-v2';
const MODE_CONFIG = {
  small: { maxCell: 34, gap: 7 },
  large: { maxCell: 56, gap: 8 }
};

const state = {
  cards: [],
  layout: {},
  layoutMode: 'small',
  used: new Set(JSON.parse(sessionStorage.getItem(USED_KEY) || '[]').map(String)),
  resetArmedUntil: 0,
  desktopReleases: { free: null, authorized: null }
};

const board = document.querySelector('#board');
const grids = {
  left: document.querySelector('[data-grid="left"]'),
  right: document.querySelector('[data-grid="right"]')
};
const aboutDialog = document.querySelector('#about-dialog');
const downloadDialog = document.querySelector('#download-dialog');
const toast = document.querySelector('#toast');
let toastTimer = null;
let aboutHoldTimer = null;
let aboutHoldTriggered = false;

function showToast(message, duration = 1800) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

function normalizeName(card) {
  return String(card.name || card.heroKey || '')
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function persistUsed() {
  sessionStorage.setItem(USED_KEY, JSON.stringify([...state.used]));
}

function updateUsedCards() {
  document.querySelectorAll('.hero-card').forEach(element => {
    element.classList.toggle('used', state.used.has(element.dataset.id));
  });
}

function toggleCard(cardId) {
  const key = String(cardId);
  if (state.used.has(key)) state.used.delete(key);
  else state.used.add(key);
  persistUsed();
  updateUsedCards();
}

function createCard(card) {
  const button = document.createElement('button');
  const name = normalizeName(card);
  button.type = 'button';
  button.className = 'hero-card';
  button.dataset.id = String(card.id);
  button.dataset.heroKey = card.heroKey;
  button.title = name;
  button.setAttribute('aria-label', name);
  const image = document.createElement('img');
  image.src = card.src;
  image.alt = '';
  image.loading = 'lazy';
  image.draggable = false;
  button.appendChild(image);
  button.addEventListener('click', () => toggleCard(card.id));
  return button;
}

function renderCards() {
  Object.values(grids).forEach(grid => grid.replaceChildren());
  state.cards.forEach(card => grids[card.side]?.appendChild(createCard(card)));
  updateUsedCards();
  layoutBoard();
}

function usesPhoneLayout() {
  return window.BPWebDeviceLayout.shouldUsePhoneLayout({
    reportedMobile: navigator.userAgentData?.mobile,
    userAgent: navigator.userAgent || '',
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    narrowViewport: window.matchMedia('(max-width: 720px)').matches
  });
}

function getResponsiveLayoutMode() {
  return usesPhoneLayout() || !state.layout.large ? 'small' : 'large';
}

function getCardPoint(card, mode) {
  return card.layouts?.[mode] || card.layouts?.small || { gridX: 0, gridY: 0, offsetX: 0, offsetY: 0 };
}

function getPointPixels(point, spec, cell, gap) {
  const gridX = Number(point.gridX) || 0;
  const gridY = Number(point.gridY) || 0;
  const groupGap = Math.max(0, Number(spec.groupGap) || 0);
  const groupColEvery = Math.max(0, Number(spec.groupColEvery) || 0);
  const groupRowEvery = Math.max(0, Number(spec.groupRowEvery) || 0);
  return {
    x: gridX * (cell + gap) + (groupColEvery > 0 ? Math.floor(gridX / groupColEvery) * groupGap : 0) + (Number(point.offsetX) || 0),
    y: gridY * (cell + gap) + (groupRowEvery > 0 ? Math.floor(gridY / groupRowEvery) * groupGap : 0) + (Number(point.offsetY) || 0)
  };
}

function measureLayoutBounds(side, mode, spec, cell, gap) {
  const cols = Math.max(1, Number(spec.cols) || 1);
  const rows = Math.max(1, Number(spec.rows) || 1);
  const step = cell + gap;
  let minX = 0;
  let minY = 0;
  let maxX = (cols - 1) * step + cell;
  let maxY = (rows - 1) * step + cell;

  state.cards.filter(card => card.side === side).forEach(card => {
    const point = getCardPoint(card, mode);
    const { x, y } = getPointPixels(point, spec, cell, gap);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + cell);
    maxY = Math.max(maxY, y + cell);
  });

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function layoutBoard() {
  const mode = getResponsiveLayoutMode();
  const spec = state.layout[mode] || state.layout.small;
  if (!spec) return;
  state.layoutMode = mode;
  document.body.dataset.webLayout = mode;

  const config = MODE_CONFIG[mode] || MODE_CONFIG.small;
  const compactPhone = mode === 'small' && window.matchMedia('(max-width: 620px)').matches;
  const gap = compactPhone ? 3 : config.gap;
  document.documentElement.style.setProperty('--grid-gap', `${gap}px`);
  const css = getComputedStyle(document.documentElement);
  const pad = Number.parseFloat(css.getPropertyValue('--grid-pad')) || 8;
  const available = Math.max(1, Math.min(
    document.querySelector('.board-side.left').clientWidth,
    document.querySelector('.board-side.right').clientWidth
  ) - pad - 3);
  let cell = config.maxCell;
  while (cell > 14 && ['left', 'right'].some(side => measureLayoutBounds(side, mode, spec, cell, gap).width > available)) {
    cell -= 1;
  }

  let maxHeight = 0;
  Object.entries(grids).forEach(([side, grid]) => {
    const bounds = measureLayoutBounds(side, mode, spec, cell, gap);
    grid.style.setProperty('--cell', `${cell}px`);
    grid.style.width = `${Math.ceil(bounds.width)}px`;
    grid.style.height = `${Math.ceil(bounds.height)}px`;
    grid.dataset.layoutMode = mode;
    maxHeight = Math.max(maxHeight, bounds.height);

    state.cards.filter(card => card.side === side).forEach(card => {
      const point = getCardPoint(card, mode);
      const element = document.querySelector(`.hero-card[data-id="${card.id}"]`);
      if (!element) return;
      const pixels = getPointPixels(point, spec, cell, gap);
      const x = pixels.x - bounds.minX;
      const y = pixels.y - bounds.minY;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    });
  });
  board.style.minHeight = `${Math.max(window.innerHeight - 46, maxHeight + 92)}px`;
}

function setTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]').content = light ? '#f2f3f5' : '#0d0e10';
}

async function resolveDesktopRelease(kind) {
  const filename = kind === 'authorized' ? 'consent.yml' : 'latest.yml';
  const versionLabel = document.querySelector(kind === 'authorized' ? '#download-authorized-version' : '#download-free-version');
  const button = document.querySelector(kind === 'authorized' ? '#download-authorized' : '#download-free');
  try {
    const response = await fetch(`${UPDATE_ROOT}${filename}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('manifest');
    const manifest = await response.text();
    const pathMatch = manifest.match(/^path:\s*(.+?)\s*$/m);
    const versionMatch = manifest.match(/^version:\s*(.+?)\s*$/m);
    const version = versionMatch?.[1].trim() || '';
    const path = pathMatch?.[1].trim() || '';
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[^/\\]+\.exe$/i.test(path) || !path.includes(version)) throw new Error('manifest');
    if (kind === 'free' ? version !== '1.5.20' : Number(version.split('.')[0]) < 2) throw new Error('unavailable');
    state.desktopReleases[kind] = { path, version };
    versionLabel.textContent = `V${version}`;
    button.disabled = false;
    if (kind === 'free') document.querySelector('#desktop-version').textContent = `免费版 V${version}`;
  } catch (error) {
    state.desktopReleases[kind] = null;
    button.disabled = true;
    versionLabel.textContent = kind === 'authorized' ? '暂未发布' : '暂不可用';
    if (kind === 'free') document.querySelector('#desktop-version').textContent = '免费版更新信息暂不可用';
  }
}

function openDownloadDialog() {
  if (aboutDialog.open) aboutDialog.close();
  downloadDialog.showModal();
  resolveDesktopRelease('free');
  resolveDesktopRelease('authorized');
}

function downloadDesktopApp(kind) {
  const release = state.desktopReleases[kind];
  if (!release) return;
  window.location.href = `${UPDATE_ROOT}${encodeURIComponent(release.path)}`;
}

function openAdmin() {
  showToast('正在进入管理后台');
  setTimeout(() => { window.location.href = ADMIN_URL; }, 260);
}

function bindEvents() {
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    setTheme(document.body.classList.contains('light') ? 'dark' : 'light');
  });
  document.querySelector('#download-app').addEventListener('click', openDownloadDialog);
  document.querySelector('#about-download-app').addEventListener('click', openDownloadDialog);
  document.querySelector('#download-free').addEventListener('click', () => downloadDesktopApp('free'));
  document.querySelector('#download-authorized').addEventListener('click', () => downloadDesktopApp('authorized'));
  document.querySelector('#download-close').addEventListener('click', () => downloadDialog.close());
  downloadDialog.addEventListener('click', event => { if (event.target === downloadDialog) downloadDialog.close(); });
  document.querySelector('#reset-used').addEventListener('click', () => {
    const now = Date.now();
    if (now > state.resetArmedUntil) {
      state.resetArmedUntil = now + 2200;
      showToast('再次点击“清空点灰”确认');
      return;
    }
    state.resetArmedUntil = 0;
    state.used.clear();
    persistUsed();
    updateUsedCards();
    showToast('已清空本局点灰状态');
  });

  const aboutButton = document.querySelector('#about-button');
  aboutButton.addEventListener('click', event => {
    if (aboutHoldTriggered) {
      aboutHoldTriggered = false;
      return;
    }
    if (event.shiftKey) {
      openAdmin();
      return;
    }
    aboutDialog.showModal();
  });
  const beginHold = () => {
    aboutHoldTriggered = false;
    clearTimeout(aboutHoldTimer);
    aboutHoldTimer = setTimeout(() => {
      aboutHoldTriggered = true;
      openAdmin();
    }, 1400);
  };
  const cancelHold = () => clearTimeout(aboutHoldTimer);
  aboutButton.addEventListener('pointerdown', beginHold);
  aboutButton.addEventListener('pointerup', cancelHold);
  aboutButton.addEventListener('pointercancel', cancelHold);
  aboutButton.addEventListener('pointerleave', cancelHold);
  document.querySelector('#about-close').addEventListener('click', () => aboutDialog.close());
  aboutDialog.addEventListener('click', event => {
    if (event.target === aboutDialog) aboutDialog.close();
  });
  window.addEventListener('resize', layoutBoard, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(layoutBoard, 180), { passive: true });
}

async function init() {
  setTheme(localStorage.getItem(THEME_KEY) || 'dark');
  bindEvents();
  const response = await fetch('./web-cards.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取网页卡片数据');
  const payload = await response.json();
  state.cards = Array.isArray(payload.cards) ? payload.cards : [];
  state.layout = payload.layout || {};
  document.querySelector('#web-version').textContent = `网页数据 ${payload.generatedAt?.slice(0, 10) || ''}`;
  renderCards();
  resolveDesktopRelease('free');
  resolveDesktopRelease('authorized');
}

init().catch(error => {
  showToast(error?.message || '网页体验版加载失败', 5000);
});
