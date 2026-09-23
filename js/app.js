/* 页面逻辑：首页（频道+网格）与播放页（HLS/mp4、切集、直播） */

const BASE = window.__BASE__ || '';
const SSR = window.__SSR__ || null;
const app = document.getElementById('app');

const state = {
  config: null,
  channels: {}, // id -> { videos, updated_at, stale }
  activeId: null,
  homeScroll: 0,
  reqSeq: 0,
  player: null, // { hls, video, url }
  q: '',
  tag: '',
  index: null,
  indexTags: null,
  junkTags: new Set(),
};

/* ---------------- 路由 ---------------- */

function routeFromLocation() {
  let p = location.pathname;
  const prefix = BASE.replace(/\/$/, '');
  if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length);
  const m = p.match(/\/play\/([0-9a-f]+)\/?/);
  return m ? { name: 'play', hash: m[1] } : { name: 'home' };
}

function navigate(url) {
  history.pushState(null, '', url);
  render();
}

window.addEventListener('popstate', render);

function playUrl(hash) {
  return (BASE || '/') + 'play/' + hash + '/';
}

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function coverImgHtml(cover) {
  if (cover.src) {
    return (
      '<img src="' + esc(cover.src) + '" alt="' + esc(cover.name) +
      '" loading="lazy" onerror="this.parentElement.classList.add(' + "'noimg'" + ')">'
    );
  }
  return '';
}

function cardTagsHtml(tags) {
  const list = tags.filter((t) => !state.junkTags.has(t));
  if (!list.length) return '';
  return (
    '<span class="card-tags">' +
    list.slice(0, 3).map((t) => '<span class="mini-tag">' + esc(t) + '</span>').join('') +
    '</span>'
  );
}

function cardHtml(v) {
  const badge = v.is_live
    ? '<span class="badge live">直播</span>'
    : v.episodes
      ? '<span class="badge">' + esc(v.episodes) + '</span>'
      : '';
  return (
    '<a class="card" data-play="' + Parser.videoHash(v) + '" href="' + playUrl(Parser.videoHash(v)) + '">' +
      '<span class="cover' + (v.preview_image ? '' : ' noimg') + '" data-name="' + esc(v.name) + '">' +
        badge + coverImgHtml({ src: v.preview_image, name: v.name }) +
      '</span>' +
      '<span class="card-meta">' +
        '<span class="card-name">' + esc(v.name) + '</span>' +
        cardTagsHtml(v.tags) +
        (v.episodes ? '<span class="card-sub">' + esc(v.episodes) + '</span>' : '') +
      '</span>' +
    '</a>'
  );
}

/* ---------------- 搜索索引与过滤态 ---------------- */

function readFilterFromURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.tag = p.get('tag') || '';
}

function syncFilterURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.tag) p.set('tag', state.tag);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
}

async function ensureIndex() {
  if (state.index) return state.index;
  const res = await Data.getIndex();
  if (!res) return null;
  state.index = res.data;
  const freq = {};
  res.data.forEach((it) => it.t.forEach((t) => { freq[t] = (freq[t] || 0) + 1; }));
  // 覆盖过半的通用标签（如“短剧”）不参与快捷过滤，也不在卡片上展示
  state.junkTags = new Set(
    Object.keys(freq).filter((t) => freq[t] > res.data.length * 0.6)
  );
  state.indexTags = Object.keys(freq)
    .filter((t) => !state.junkTags.has(t))
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, 16);
  return state.index;
}

function resultCardHtml(it) {
  const img = it.i
    ? '<img src="' + esc(it.i) + '" alt="' + esc(it.n) + '" loading="lazy" onerror="this.parentElement.classList.add(' + "'noimg'" + ')">'
    : '';
  const badge = it.e ? '<span class="badge">' + esc(it.e) + '</span>' : '';
  return (
    '<a class="card" data-play="' + esc(it.h) + '" href="' + playUrl(it.h) + '">' +
      '<span class="cover' + (it.i ? '' : ' noimg') + '" data-name="' + esc(it.n) + '">' + badge + img + '</span>' +
      '<span class="card-meta"><span class="card-name">' + esc(it.n) + '</span>' +
      cardTagsHtml(it.t) +
      (it.e ? '<span class="card-sub">' + esc(it.e) + '</span>' : '') +
      '</span></a>'
  );
}

function emptyBox(msg) {
  return '<div class="state-box"><p>' + esc(msg) + '</p></div>';
}

/* 过滤态变化时只刷新网格，不重绘 header（避免输入框失焦） */
function paintGrid() {
  const host = document.getElementById('grid');
  const meta = document.getElementById('result-meta');
  if (!host) return;
  let items = null;

  if (state.q || state.tag) {
    if (!state.index) {
      host.className = '';
      host.innerHTML = emptyBox('搜索功能暂不可用，请稍后重试');
      if (meta) meta.textContent = '';
      return;
    }
    const q = state.q.trim();
    items = state.index.filter((it) => {
      if (state.tag && !it.t.includes(state.tag)) return false;
      if (!q) return true;
      return it.n.includes(q) || (it.a && it.a.includes(q)) ||
        it.t.some((t) => t.includes(q));
    });
  } else {
    const ch = state.channels[state.activeId];
    items = ch ? ch.videos : [];
  }

  host.className = 'grid';
  host.innerHTML = items.length
    ? items.map((it) => (it.h ? resultCardHtml(it) : cardHtml(it))).join('')
    : emptyBox('没有找到相关短剧，换个关键词或标签试试');
  if (meta) {
    meta.textContent = (state.q || state.tag) ? '找到 ' + items.length + ' 部相关短剧' : '';
  }
}

function fillChips() {
  const box = document.getElementById('chips');
  if (!box || !state.indexTags) return;
  box.innerHTML = state.indexTags
    .map((t) =>
      '<button class="chip' + (t === state.tag ? ' active' : '') +
      '" data-filter-tag="' + esc(t) + '">' + esc(t) + '</button>'
    )
    .join('');
}

function updateChipsActive() {
  document.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.filterTag === state.tag);
  });
}

function bindSearchInput() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.value = state.q;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value;
    timer = setTimeout(async () => {
      state.q = v;
      syncFilterURL();
      if ((state.q || state.tag) && !state.index) await ensureIndex();
      paintGrid();
    }, 200);
  });
}

function skeletonHtml() {
  let cards = '';
  for (let i = 0; i < 6; i++) {
    cards += '<div class="sk-card"><div class="sk-cover shimmer"></div><div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>';
  }
  return '<div class="skeleton-grid">' + cards + '</div>';
}

/* ---------------- 首页 ---------------- */

async function ensureConfig() {
  if (state.config) return state.config;
  if (SSR && SSR.type === 'home') {
    state.config = Parser.normalizeConfig({ channels: SSR.channels, updated_at: SSR.updated_at });
  } else {
    const res = await Data.getConfig();
    if (!res) return null;
    state.config = Parser.normalizeConfig(res.data);
    state.configStale = res.stale;
  }
  return state.config;
}

async function loadChannel(channel) {
  if (state.channels[channel.id]) return state.channels[channel.id];
  if (SSR && SSR.type === 'home' && SSR.channelId === channel.id) {
    const d = Parser.normalizeChannelData({
      channel_id: SSR.channelId,
      updated_at: SSR.updated_at,
      videos: SSR.videos,
    });
    state.channels[channel.id] = { videos: d.videos, updated_at: d.updated_at, stale: false };
  } else {
    const res = await Data.getChannel(channel);
    if (!res) return null;
    const d = Parser.normalizeChannelData(res.data);
    state.channels[channel.id] = { videos: d.videos, updated_at: res.updated_at, stale: res.stale };
  }
  return state.channels[channel.id];
}

async function renderHome() {
  destroyPlayer();
  const seq = ++state.reqSeq;
  const config = await ensureConfig();
  if (routeFromLocation().name !== 'home' || seq !== state.reqSeq) return;
  if (!config || config.channels.length === 0) {
    app.innerHTML = errorBox('数据加载失败，可能是网络问题。');
    return;
  }
  if (!state.activeId || !config.channels.some((c) => c.id === state.activeId)) {
    state.activeId = config.channels[0].id;
  }
  paintHomeShell(config);
  const grid = document.getElementById('grid');
  const active = config.channels.find((c) => c.id === state.activeId);
  grid.outerHTML = '<div id="grid">' + skeletonHtml() + '</div>';
  const data = await loadChannel(active);
  if (seq !== state.reqSeq || routeFromLocation().name !== 'home') return;
  if (!data) {
    app.innerHTML = errorBox('该频道数据加载失败，请稍后重试。');
    return;
  }
  paintHomeShell(config, data.stale);
  bindSearchInput();
  await ensureIndex();
  if (seq !== state.reqSeq || routeFromLocation().name !== 'home') return;
  fillChips();
  paintGrid();
  // document.getElementById('updated-at').textContent =
  //   '数据更新于 ' + (fmtDate(data.updated_at) || '未知');
  window.scrollTo(0, state.homeScroll);
}

function paintHomeShell(config, stale) {
  const tabs = config.channels
    .map(
      (c) =>
        '<a class="tab' + (c.id === state.activeId ? ' active' : '') + '" data-tab="' +
        esc(c.id) + '">' + esc(c.name) + '</a>'
    )
    .join('');
  app.innerHTML =
    '<header class="site-header"><nav class="tabs">' + tabs +
    '</nav><div class="searchbar">' +
    '<input id="search-input" type="search" placeholder="搜索剧名或标签" autocomplete="off">' +
    '</div><div class="chips" id="chips"></div></header>' +
    (stale ? '<div class="notice">网络异常，当前显示的是缓存内容</div>' : '') +
    '<div class="result-meta" id="result-meta"></div>' +
    '<div id="grid"></div>' +
    '<div class="data-time" id="updated-at"></div>';
}

/* ---------------- 播放页 ---------------- */

async function findVideo(hash) {
  if (SSR && SSR.type === 'play') {
    return {
      video: Parser.normalizeVideo(SSR.raw),
      updated_at: SSR.updated_at,
      stale: false,
    };
  }
  const config = await ensureConfig();
  if (!config) return null;
  for (const c of config.channels) {
    const data = await loadChannel(c);
    if (data) {
      const v = data.videos.find((v) => Parser.videoHash(v) === hash);
      if (v) return { video: v, updated_at: data.updated_at, stale: data.stale };
    }
  }
  return null;
}

async function renderPlay() {
  state.homeScroll = window.scrollY;
  const seq = ++state.reqSeq;
  const route = routeFromLocation();
  app.innerHTML = '<div class="player-wrap">' + skeletonHtml() + '</div>';
  const found = await findVideo(route.hash);
  if (seq !== state.reqSeq || routeFromLocation().name !== 'play') return;
  if (!found) {
    app.innerHTML = errorBox('没有找到这部剧，可能已下架。');
    return;
  }
  paintPlay(found.video, found.stale, found.updated_at);
  setupPlayer(found.video, 0);
}

function paintPlay(v, stale, updatedAt) {
  const tags = v.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
  const actors = v.actors ? '<div class="info-row"><b>演员：</b>' + esc(v.actors) + '</div>' : '';
  const desc = v.description ? '<div class="desc">' + esc(v.description) + '</div>' : '';
  const episodes = v.is_live
    ? ''
    : '<div class="ep-section"><div class="ep-title">选集（共 ' + v.episodes_list.length + ' 集）</div>' +
      '<div class="ep-grid">' +
      v.episodes_list
        .map(
          (ep, i) =>
            '<button class="ep-btn" data-ep="' + i + '" title="' + esc(ep.name) + '">' +
            esc(ep.name) + (ep.is_vip ? '<span class="vip">VIP</span>' : '') + '</button>'
        )
        .join('') +
      '</div></div>';
  app.innerHTML =
    (stale ? '<div class="notice">网络异常，当前显示的是缓存内容</div>' : '') +
    '<div class="player-wrap">' +
      '<video playsinline webkit-playsinline controls preload="metadata"' +
      (v.preview_image ? ' poster="' + esc(v.preview_image) + '"' : '') + '></video>' +
      '<div class="buffering" id="buffering"><div class="spinner"></div><div class="buf-text">视频加载中，网络较慢请稍候…</div></div>' +
      '<div class="player-error" id="player-error">' +
        '<div class="err-title">播放源失效</div>' +
        '<div class="err-msg">该视频源可能已失效或被限制，请稍后重试</div>' +
        '<button class="btn" id="retry-play">重试</button>' +
      '</div>' +
    '</div>' +
    '<div class="play-info">' +
      '<h1 class="play-name">' + esc(v.name) + '</h1>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      actors + desc +
    '</div>' +
    episodes;
}

/* ---------------- 播放器 ---------------- */

function bindBufferingHint(videoEl) {
  const hint = document.getElementById('buffering');
  if (!hint) return;
  const show = () => {
    const err = document.getElementById('player-error');
    if (!err || !err.classList.contains('show')) hint.classList.add('show');
  };
  const hide = () => hint.classList.remove('show');
  videoEl.addEventListener('waiting', show);
  videoEl.addEventListener('seeking', show);
  videoEl.addEventListener('playing', hide);
  videoEl.addEventListener('canplay', hide);
  show(); // 首帧到达前先显示
}

function setupPlayer(v, epIndex) {
  destroyPlayer();
  state._playVideo = v;
  const ep = v.episodes_list[epIndex];
  const url = ep.link;
  const errBox = document.getElementById('player-error');
  if (errBox) errBox.classList.remove('show');
  const videoEl = app.querySelector('video');
  if (!videoEl || !url) {
    showPlayerError();
    return;
  }
  state.player = { hls: null, video: videoEl, url };

  videoEl.onerror = () => showPlayerError();
  bindBufferingHint(videoEl);

  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (isHls && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = url;
    videoEl.play().catch(() => {});
  } else if (isHls && window.Hls && Hls.isSupported()) {
    // 慢网络：调大加载超时与清单重试，避免误判播放源失效
    const hls = new Hls({
      manifestLoadingTimeOut: 30000,
      manifestLoadingMaxRetry: 3,
      levelLoadingTimeOut: 30000,
      levelLoadingMaxRetry: 4,
      fragLoadingTimeOut: 60000,
      fragLoadingMaxRetry: 8,
    });
    hls.loadSource(url);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (isDeadSource(data)) {
        showPlayerError('dead');
        return;
      }
      if (retriesExhausted(data)) {
        showPlayerError('timeout');
        return;
      }
      // 慢网络/源站抖动：按 maxRetry 由 hls.js 自动重试
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else hls.recoverMediaError();
    });
    state.player.hls = hls;
  } else {
    videoEl.src = url;
    videoEl.play().catch(() => {});
  }

  document.querySelectorAll('.ep-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.ep) === epIndex);
  });
  const retry = document.getElementById('retry-play');
  if (retry) retry.onclick = () => setupPlayer(v, epIndex);
}

function isDeadSource(data) {
  const code = data.response && data.response.code;
  if (code === 403 || code === 404 || code === 410) return true;
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) return true;
  return false;
}

function retriesExhausted(data) {
  if (data.retry === undefined || !data.details) return false;
  const limits = {
    manifestLoadTimeOut: 3,
    levelLoadTimeOut: 4,
    fragLoadTimeOut: 8,
    keyLoadTimeOut: 3,
  };
  const limit = limits[data.details];
  return limit !== undefined && data.retry >= limit;
}

function showPlayerError(kind) {
  const el = document.getElementById('player-error');
  if (!el) return;
  const title = el.querySelector('.err-title');
  const msg = el.querySelector('.err-msg');
  if (kind === 'dead') {
    title.textContent = '播放源失效';
    msg.textContent = '该视频源可能已下架或被限制，请换一集或稍后再试';
  } else {
    title.textContent = '网络加载超时';
    msg.textContent = '当前网络较慢，可点击重试，或换一集观看';
  }
  el.classList.add('show');
  const hint = document.getElementById('buffering');
  if (hint) hint.classList.remove('show');
}

function destroyPlayer() {
  const p = state.player;
  if (!p) return;
  if (p.hls) {
    try { p.hls.destroy(); } catch (e) {}
  }
  p.video.pause();
  p.video.removeAttribute('src');
  try { p.video.load(); } catch (e) {}
  state.player = null;
}

/* ---------------- 通用错误态 ---------------- */

function errorBox(msg) {
  return (
    '<div class="state-box"><p>' + esc(msg) + '</p>' +
    '<button class="btn retry-btn" onclick="location.reload()">重试</button></div>'
  );
}

/* ---------------- 事件委托与启动 ---------------- */

async function toggleTag(t) {
  state.tag = state.tag === t ? '' : t;
  syncFilterURL();
  if (!state.index) await ensureIndex();
  updateChipsActive();
  paintGrid();
}

app.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    e.preventDefault();
    state.activeId = tab.dataset.tab;
    state.homeScroll = 0;
    state.q = '';
    state.tag = '';
    syncFilterURL();
    renderHome();
    return;
  }
  const chip = e.target.closest('[data-filter-tag]');
  if (chip) {
    e.preventDefault();
    toggleTag(chip.dataset.filterTag);
    return;
  }
  const card = e.target.closest('[data-play]');
  if (card) {
    e.preventDefault();
    state.homeScroll = window.scrollY;
    navigate(playUrl(card.dataset.play));
    return;
  }
  const ep = e.target.closest('[data-ep]');
  if (ep && state._playVideo) {
    setupPlayer(state._playVideo, Number(ep.dataset.ep));
  }
});

async function render() {
  readFilterFromURL();
  if (routeFromLocation().name === 'play') await renderPlay();
  else await renderHome();
}

if (location.protocol === 'file:') {
  app.innerHTML =
    '<div class="state-box"><p>请通过本地服务预览，不要直接双击 HTML 文件。</p>' +
    '<p style="margin-top:8px;font-size:13px">在 <b>dist</b> 目录下执行：<br>python -m http.server 8000<br>' +
    '然后访问 http://localhost:8000</p></div>';
} else {
  render();
}
