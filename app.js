const app = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const modal = document.getElementById('ep-modal');
const modalBody = document.getElementById('modal-body');
const overlay = document.getElementById('player-overlay');
const video = document.getElementById('video');
const CW_KEY = 'onepace.continueWatching';
const VOL_KEY = 'onepace.volume';
const state = {
  data: null,
  cw: {},
  playlist: [],
  index: -1,
  currentArc: null,
  searchQuery: '',
  filterMode: 'all',
  prevHash: '',
  viewMode: 'grid',
  gridCols: 'auto'
};
try {
  state.viewMode = localStorage.getItem('viewMode') || 'grid';
  state.gridCols = localStorage.getItem('gridCols') || 'auto';
} catch {}

window.setViewMode = function(mode) {
  state.viewMode = mode;
  try { localStorage.setItem('viewMode', mode); } catch {}
  updateViewControls('arc');
  updateViewControls('ep');
  document.querySelectorAll('.view-btn').forEach(b => {
    if (b.dataset.view === mode) b.classList.add('active');
    else b.classList.remove('active');
  });
  document.querySelectorAll('.cols-select').forEach(s => s.disabled = mode === 'list');
};

window.setGridCols = function(cols) {
  state.gridCols = cols;
  try { localStorage.setItem('gridCols', cols); } catch {}
  updateViewControls('arc');
  updateViewControls('ep');
  document.querySelectorAll('.cols-select').forEach(s => s.value = cols);
};

function updateViewControls(type) {
  const container = document.getElementById(type + '-grid');
  if (!container) return;
  container.className = type + '-grid ' + state.viewMode + '-view';
  if (state.viewMode === 'grid' && state.gridCols !== 'auto') {
    container.style.setProperty('--cols', state.gridCols);
  } else {
    container.style.removeProperty('--cols');
  }
}

// Supabase Init
const supabaseUrl = 'https://bdunmrvqcjdbpjozljyh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkdW5tcnZxY2pkYnBqb3psanloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMTcwODcsImV4cCI6MjEwMTg5MzA4N30.wFO7Uhv1YVvwY9aGGGBx_eNMnUe27GlwwYa7AGZsVjA';
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;
let currentUser = null;

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function loadData() {
  const res = await fetch('data.json');
  state.data = await res.json();
}

/* ============ Continue watching persistence ============ */
function getCW() {
  try { return JSON.parse(localStorage.getItem(CW_KEY) || '{}'); }
  catch { return {}; }
}
function setCW(map) {
  try { localStorage.setItem(CW_KEY, JSON.stringify(map)); } catch {}
}
function cwKey(arcSeason, ep, lang) { return `${arcSeason}:${ep}:${lang}`; }
function removeCW(arcSeason, ep, lang) {
  const map = getCW();
  delete map[cwKey(arcSeason, ep, lang)];
  setCW(map);
  state.cw = map;
  renderHome();
  
  if (typeof currentUser !== 'undefined' && currentUser && typeof supabaseClient !== 'undefined' && supabaseClient) {
    supabaseClient.from('user_progress').delete()
      .eq('user_id', currentUser.id)
      .eq('season', arcSeason)
      .eq('ep', ep)
      .eq('lang', lang)
      .then(({ error }) => {
        if (error) console.error('Failed to remove progress from DB:', error);
      });
  }
}

/* ============ Home ============ */
function renderHome() {
  const arcs = state.data.arcs;
  const cwMap = getCW();
  const cwItems = Object.values(cwMap)
    .filter(it => it.time > 5 && it.time < it.duration - 10)
    .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
    .filter((it, i, arr) => arr.findIndex(x => x.season === it.season && x.ep === it.ep) === i);

  let html = '<div class="wrap">';

  if (cwItems.length) {
    html += `<h2 class="section-title">Continue Watching</h2>
      <div class="cw-strip">
        ${cwItems.map(it => `
          <div class="cw-card" onclick="playEpisode(${it.season}, ${it.ep}, '${it.lang}', true)">
            <button class="cw-remove" title="Remove from Continue Watching" onclick="event.stopPropagation(); removeCW(${it.season}, ${it.ep}, '${it.lang}')">✕</button>
            <div class="cw-thumb">
              <img src="${esc(it.poster)}" alt="" loading="lazy" />
              <div class="cw-play">▶</div>
              <div class="cw-progress"><div class="cw-progress-fill" style="width:${it.pct}%"></div></div>
            </div>
            <div class="cw-body">
              <div class="cw-arc">${esc(it.arcName)}</div>
              <div class="cw-title">EP ${String(it.ep).padStart(2, '0')} · ${esc(it.title)}</div>
              <div class="cw-time">${fmt(it.time)} left · ${it.lang}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  html += `<h2 class="section-title">All Arcs</h2>
    <p class="section-sub">${arcs.length} arcs · ${totalEps()} episodes</p>
    <div class="search-wrap" style="display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
      <input class="search-input" type="text" id="arc-search" placeholder="Search arcs..." autocomplete="off" />
      <div class="view-controls" style="display: flex; gap: 8px; align-items: center;">
        <div class="view-toggle" style="display: flex; background: var(--bg-3); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">
          <button class="nav-btn view-btn ${state.viewMode === 'grid' ? 'active' : ''}" data-view="grid" onclick="setViewMode('grid')" style="border-radius: 0; padding: 6px 12px; font-size: 12px;">Grid</button>
          <button class="nav-btn view-btn ${state.viewMode === 'list' ? 'active' : ''}" data-view="list" onclick="setViewMode('list')" style="border-radius: 0; padding: 6px 12px; font-size: 12px;">List</button>
        </div>
        <select class="cols-select search-input" style="width: auto; padding: 5px 10px; font-size: 12px; border-radius: 8px;" onchange="setGridCols(this.value)" ${state.viewMode === 'list' ? 'disabled' : ''}>
          <option value="auto" ${state.gridCols === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="2" ${state.gridCols === '2' ? 'selected' : ''}>2 Cols</option>
          <option value="3" ${state.gridCols === '3' ? 'selected' : ''}>3 Cols</option>
          <option value="4" ${state.gridCols === '4' ? 'selected' : ''}>4 Cols</option>
          <option value="5" ${state.gridCols === '5' ? 'selected' : ''}>5 Cols</option>
          <option value="6" ${state.gridCols === '6' ? 'selected' : ''}>6 Cols</option>
          <option value="7" ${state.gridCols === '7' ? 'selected' : ''}>7 Cols</option>
          <option value="8" ${state.gridCols === '8' ? 'selected' : ''}>8 Cols</option>
          <option value="9" ${state.gridCols === '9' ? 'selected' : ''}>9 Cols</option>
          <option value="10" ${state.gridCols === '10' ? 'selected' : ''}>10 Cols</option>
        </select>
      </div>
    </div>
    <div class="arc-grid ${state.viewMode}-view" id="arc-grid">
      ${arcs.map(a => {
        const d = a.episodes.filter(e => e.lang === 'Dub').length;
        const s = a.episodes.filter(e => e.lang === 'Sub').length;
        const lang = `${uniqueEps(a)} Episodes · ${d} Dub · ${s} Sub`;
        return `
        <div class="arc-card" onclick="location.hash='#/arc/${a.season}'">
          <img class="arc-poster" src="${esc(a.poster)}" alt="${esc(a.name)}" loading="lazy" />
          <div class="arc-meta">
            <div class="arc-name">${esc(a.name)}</div>
            <div class="arc-sub">${lang}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  app.innerHTML = html;
  const searchInput = document.getElementById('arc-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.arc-card').forEach(card => {
        const name = card.querySelector('.arc-name')?.textContent.toLowerCase() || '';
        card.style.display = name.includes(q) ? '' : 'none';
      });
    });
  }
}

function totalEps() {
  return state.data.arcs.reduce((n, a) => n + a.episodes.length, 0);
}

function uniqueEps(arc) {
  return new Set(arc.episodes.map(e => e.ep)).size;
}

/* ============ Arc detail ============ */
function renderArc(season) {
  const arc = state.data.arcs.find(a => a.season === Number(season));
  if (!arc) { location.hash = '#/'; return; }

  const dub = arc.episodes.filter(e => e.lang === 'Dub');
  const sub = arc.episodes.filter(e => e.lang === 'Sub');
  const hasBoth = dub.length > 0 && sub.length > 0;
  const list = sortedEps(arc, 'all');

  // find continue-watching progress for this arc
  const cwMap = getCW();
  const cwInArc = Object.values(cwMap)
    .filter(it => Number(it.season) === arc.season && it.time > 5 && it.time < it.duration - 10)
    .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0));
  const resume = cwInArc[0];

  app.innerHTML = `
    <div class="wrap">
      <div class="arc-hero" style="background-image: url('${esc(arc.poster)}')">
        <div class="arc-hero-content">
          <img class="arc-banner-poster" src="${esc(arc.poster)}" alt="${esc(arc.name)}" />
          <div class="arc-banner-info">
            <div class="arc-banner-number">Arc ${arc.number} · Season ${arc.season}</div>
            <h1 class="arc-banner-title">${esc(arc.name)}</h1>
            <div class="arc-stats-line"><b>${uniqueEps(arc)}</b> Episodes · <b>${dub.length}</b> Dub · <b>${sub.length}</b> Sub</div>
            <p class="arc-banner-overview">${esc(arc.overview)}</p>
            ${resume ? `
              <button class="btn btn-primary cw-resume" onclick="playEpisode(${resume.season}, ${resume.ep}, '${resume.lang}', true)">
                ▶ Continue Watching · EP ${String(resume.ep).padStart(2, '0')} · ${fmt(resume.time)}
              </button>` : ''}
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px;">
        <h2 class="section-title" style="margin: 0;">Episodes</h2>
        <div class="view-controls" style="display: flex; gap: 8px; align-items: center;">
          <div class="view-toggle" style="display: flex; background: var(--bg-3); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">
            <button class="nav-btn view-btn ${state.viewMode === 'grid' ? 'active' : ''}" data-view="grid" onclick="setViewMode('grid')" style="border-radius: 0; padding: 6px 12px; font-size: 12px;">Grid</button>
            <button class="nav-btn view-btn ${state.viewMode === 'list' ? 'active' : ''}" data-view="list" onclick="setViewMode('list')" style="border-radius: 0; padding: 6px 12px; font-size: 12px;">List</button>
          </div>
          <select class="cols-select search-input" style="width: auto; padding: 5px 10px; font-size: 12px; border-radius: 8px;" onchange="setGridCols(this.value)" ${state.viewMode === 'list' ? 'disabled' : ''}>
            <option value="auto" ${state.gridCols === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="2" ${state.gridCols === '2' ? 'selected' : ''}>2 Cols</option>
            <option value="3" ${state.gridCols === '3' ? 'selected' : ''}>3 Cols</option>
            <option value="4" ${state.gridCols === '4' ? 'selected' : ''}>4 Cols</option>
            <option value="5" ${state.gridCols === '5' ? 'selected' : ''}>5 Cols</option>
            <option value="6" ${state.gridCols === '6' ? 'selected' : ''}>6 Cols</option>
            <option value="7" ${state.gridCols === '7' ? 'selected' : ''}>7 Cols</option>
            <option value="8" ${state.gridCols === '8' ? 'selected' : ''}>8 Cols</option>
            <option value="9" ${state.gridCols === '9' ? 'selected' : ''}>9 Cols</option>
            <option value="10" ${state.gridCols === '10' ? 'selected' : ''}>10 Cols</option>
          </select>
        </div>
      </div>
      
      ${hasBoth ? `
        <div class="filters" style="margin-bottom: 14px;">
          <button class="filter-btn active" data-lang="all" onclick="setLangFilter(${arc.season},'all')">All</button>
          <button class="filter-btn" data-lang="Dub" onclick="setLangFilter(${arc.season},'Dub')">Dub</button>
          <button class="filter-btn" data-lang="Sub" onclick="setLangFilter(${arc.season},'Sub')">Sub</button>
        </div>` : ''}
      <div class="ep-grid ${state.viewMode}-view" id="ep-grid">${episodesHTML(list, arc)}</div>
    </div>
  `;
  state.currentArc = arc;
  
  setTimeout(() => {
    updateViewControls('ep');
  }, 0);
}

function sortedEps(arc, lang) {
  let list = arc.episodes.slice();
  if (lang === 'all') {
    // show each episode once, prefer Dub when both exist
    const seen = {};
    list.sort((a, b) => a.ep - b.ep || (a.lang === 'Dub' ? -1 : 1));
    return list.filter(e => {
      if (seen[e.ep]) return false;
      seen[e.ep] = true;
      return true;
    });
  }
  list = list.filter(e => e.lang === lang);
  return list.sort((a, b) => a.ep - b.ep);
}

function episodesHTML(list, arc) {
  if (!list.length) return '<div class="empty">No episodes in this language.</div>';
  arc = arc || state.currentArc;
  return list.map(e => {
    const both = arc && arc.episodes.some(x => x.ep === e.ep && x.lang !== e.lang);
    const langLabel = both ? 'Dub/Sub' : e.lang;
    const langClass = both ? 'both' : (e.lang === 'Dub' ? 'dub' : 'sub');
    return `
    <div class="ep-card" onclick="openEpisode(${e.ep}, '${e.lang}')">
      <div class="ep-num">${String(e.ep).padStart(2, '0')}</div>
      <div class="ep-body">
        <div class="ep-title">${esc(e.title)}</div>
        <div class="ep-tags">
          <span class="tag tag-${langClass}">${langLabel}</span>
          ${e.filler ? '<span class="tag tag-filler">Filler</span>' : ''}
          ${e.alt ? '<span class="tag tag-alt">Alt</span>' : ''}
        </div>
      </div>
      <div class="ep-play">▶</div>
    </div>`;
  }).join('');
}

function setLangFilter(season, lang) {
  const arc = state.data.arcs.find(a => a.season === Number(season));
  document.getElementById('ep-grid').innerHTML = episodesHTML(sortedEps(arc, lang), arc);
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

/* ============ Episode overview modal ============ */
function openEpisode(ep, lang) {
  const arc = state.currentArc;
  const e = arc.episodes.find(x => x.ep === Number(ep) && x.lang === lang);
  if (!e) return;
  const sibling = arc.episodes.find(x => x.ep === Number(ep) && x.lang !== lang);

  const langBtns = sibling ? `
    <button class="btn ${lang === 'Dub' ? 'btn-primary' : 'btn-secondary'}" onclick="openEpisode(${ep},'Dub')">Dub</button>
    <button class="btn ${lang === 'Sub' ? 'btn-primary' : 'btn-secondary'}" onclick="openEpisode(${ep},'Sub')">Sub</button>` :
    `<span class="tag tag-${e.lang === 'Dub' ? 'dub' : 'sub'}" style="align-self:center;padding:6px 12px;">${e.lang}</span>`;

  modalBody.innerHTML = `
    <div class="ep-modal-hero">
      <img class="ep-modal-poster" src="${esc(arc.poster)}" alt="" />
      <div class="ep-modal-meta">
        <div class="ep-modal-arc">${esc(arc.name)} · Episode ${String(ep).padStart(2, '0')}</div>
        <h2 class="ep-modal-title">${esc(e.title)}</h2>
        <div class="ep-modal-lang">${lang} audio${e.filler ? ' · Filler' : ''}${e.alt ? ' · Alt' : ''}</div>
      </div>
    </div>
    <div class="ep-modal-desc-label">Overview</div>
    <div class="ep-modal-desc">${esc(e.description) || '<i>No synopsis available for this episode.</i>'}</div>
    ${(e.anime || e.manga) ? `
      <div class="ep-modal-desc-label">Adapts</div>
      <div class="ep-modal-adapts">
        ${e.anime ? `<div class="adapt-row"><span class="adapt-icon">🎬</span> Anime Episodes: <b>${esc(e.anime)}</b></div>` : ''}
        ${e.manga ? `<div class="adapt-row"><span class="adapt-icon">📖</span> Manga Chapters: <b>${esc(e.manga)}</b></div>` : ''}
      </div>` : ''}
    <div class="ep-modal-actions">
      <button class="btn btn-primary" onclick="playFromModal(${ep},'${lang}')">▶ &nbsp;Play</button>
      ${langBtns}
    </div>
  `;
  modal.classList.remove('hidden');
}

function playFromModal(ep, lang) {
  closeModal();
  playEpisode(state.currentArc.season, ep, lang);
}

function closeModal() { modal.classList.add('hidden'); }

/* ============ Player ============ */
function playEpisode(season, ep, lang, resume) {
  const arc = state.data.arcs.find(a => a.season === Number(season));
  if (!arc) return;
  state.currentArc = arc;
  state.playlist = sortedEps(arc, 'all');
  const target = state.playlist.find(e => e.ep === Number(ep) && e.lang === lang);
  if (!target) return;
  state.index = state.playlist.indexOf(target);
  state.resumeFrom = resume ? getCW()[cwKey(arc.season, target.ep, target.lang)] : null;
  openPlayer();
}

function openPlayer() {
  overlay.classList.remove('hidden');
  overlay.classList.remove('controls-hidden');
  playerInfo.classList.remove('showing');
  const ep = state.playlist[state.index];
  video.src = ep.url;
  updatePlayerUI();
  bufferEl.style.width = '0%';
  setProgressUI(0);
  showLoading();
  const saved = state.resumeFrom;
  const onReady = () => {
    if (saved && saved.time > 3 && saved.time < (video.duration || 999999) - 5) {
      video.currentTime = saved.time;
    }
    video.play();
    video.removeEventListener('canplay', onReady);
  };
  video.addEventListener('canplay', onReady);
  video.load();
  document.body.style.overflow = 'hidden';
  resetIdleTimer();
  // reflect /watch in the url
  const want = `#/watch/${state.currentArc.season}/${ep.ep}/${ep.lang}`;
  if (location.hash !== want) {
    state.prevHash = location.hash || '#/';
    location.hash = want;
  }
}

function showLoading() {
  const l = $('player-loading');
  if (l) l.classList.remove('hidden');
}
function hideLoading() {
  const l = $('player-loading');
  if (l) l.classList.add('hidden');
}

function updatePlayerUI() {
  const arc = state.currentArc;
  const ep = state.playlist[state.index];
  $('player-title').textContent = `${arc.name} — EP ${String(ep.ep).padStart(2, '0')}${ep.alt ? ' (Alt)' : ''}${ep.filler ? ' (Filler)' : ''} · ${ep.title}`;
  const sibling = state.playlist.find(e => e.ep === ep.ep && e.lang !== ep.lang);
  if (sibling) { $('player-subs').classList.remove('hidden'); $('player-subs').textContent = 'Switch: ' + sibling.lang; }
  else { $('player-subs').classList.add('hidden'); }
  $('btn-prev').disabled = state.index === 0;
  $('btn-next').disabled = state.index >= state.playlist.length - 1;
}

function closePlayer() {
  clearTimeout(idleTimer);
  clearTimeout(spaceHoldTimer);
  spaceDown = false;
  spaceBoost = false;
  setSpeedBadge(false);
  playerInfo.classList.remove('showing');
  overlay.classList.add('hidden');
  overlay.classList.remove('controls-hidden');
  video.pause();
  video.removeAttribute('src');
  video.load();
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  if (location.hash.startsWith('#/watch')) location.hash = state.prevHash || '#/';
}

function playIndex(i) {
  if (i < 0 || i >= state.playlist.length) return;
  state.index = i;
  video.src = state.playlist[i].url;
  bufferEl.style.width = '0%';
  setProgressUI(0);
  showLoading();
  video.load();
  video.play();
  updatePlayerUI();
  const epData = state.playlist[i];
  const want = `#/watch/${state.currentArc.season}/${epData.ep}/${epData.lang}`;
  if (location.hash !== want) location.hash = want;
}

function togglePlay() { if (video.paused) video.play(); else video.pause(); }

let dbSyncTimeout = null;
function saveProgressToDB(arc, ep, time) {
  if (!currentUser || !supabaseClient) return;
  if (dbSyncTimeout) clearTimeout(dbSyncTimeout);
  dbSyncTimeout = setTimeout(() => {
    supabaseClient.from('user_progress').upsert({
      user_id: currentUser.id,
      season: arc.season,
      ep: ep.ep,
      lang: ep.lang,
      time: time
    }, { onConflict: 'user_id,season,ep,lang' }).then(({ error }) => {
      if (error) console.error('Failed to sync progress:', error);
    });
  }, 1000); // 1 second debounce
}

/* ============ Save progress ============ */
function saveProgress() {
  const arc = state.currentArc;
  if (!arc) return;
  const ep = state.playlist[state.index];
  if (!ep || !video.duration) return;
  const key = cwKey(arc.season, ep.ep, ep.lang);
  const map = getCW();
  map[key] = {
    season: arc.season, ep: ep.ep, lang: ep.lang,
    title: ep.title, arcName: arc.name, poster: arc.poster,
    time: video.currentTime, duration: video.duration,
    pct: Math.round(video.currentTime / video.duration * 100),
    lastWatched: Date.now()
  };
  setCW(map);
  
  saveProgressToDB(arc, ep, video.currentTime);
}

/* ============ Nav ============ */
function renderNav() {
  const links = document.getElementById('nav-links');
  links.innerHTML = (location.hash === '#/' || location.hash === '') 
    ? `<button class="nav-btn" onclick="openSyncModal()">Sync with One Piece</button>` 
    : `<a class="nav-btn" href="#/">Home</a><button class="nav-btn" onclick="openSyncModal()">Sync with One Piece</button>`;
  
  const authDiv = document.getElementById('nav-auth');
  if (currentUser) {
    authDiv.innerHTML = `
      <div style="position: relative;" id="profile-dropdown-wrap">
        <button class="nav-btn" id="btn-profile">Profile</button>
        <div class="profile-menu hidden" id="profile-menu">
          <div class="profile-menu-header">${esc(currentUser.email)}</div>
          <button class="profile-menu-item" onclick="signOut()">Sign Out</button>
        </div>
      </div>
    `;
    document.getElementById('btn-profile').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('profile-menu').classList.toggle('hidden');
    });
  } else {
    authDiv.innerHTML = `<button class="nav-btn" onclick="openAuthModal()">Sign In</button>`;
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('profile-menu');
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('#profile-dropdown-wrap')) {
    menu.classList.add('hidden');
  }
});

/* ============ Router ============ */
function router() {
  const h = location.hash;
  if (h.startsWith('#/watch')) {
    if (state.playlist.length === 0) {
      const parts = h.split('/');
      if (parts.length >= 5) {
        playEpisode(parts[2], parts[3], parts[4]);
      } else {
        location.hash = '#/';
      }
    }
    return;
  }
  if (h.startsWith('#/arc/')) renderArc(h.split('/')[2]);
  else renderHome();
  renderNav();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

/* ============ Player controls wiring ============ */
const controls = $('player-controls');
const topbar = document.querySelector('.player-topbar');
let idleTimer = null;
let seeking = false;
let spaceDownTime = 0;
let spaceHoldTimer = null;
let spaceBoost = false;
let spaceDown = false;
function setSpeedBadge(on) {
  const b = $('speed-badge');
  if (b) b.classList.toggle('hidden', !on);
}

function showControls() {
  overlay.classList.remove('controls-hidden');
  resetIdleTimer();
}
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    overlay.classList.add('controls-hidden');
  }, 1000);
}
overlay.addEventListener('mousemove', showControls);
overlay.addEventListener('mouseleave', () => overlay.classList.add('controls-hidden'));
overlay.addEventListener('touchstart', showControls);
$('player-clicklayer').addEventListener('click', togglePlay);

$('player-back').addEventListener('click', closePlayer);
$('btn-play').addEventListener('click', togglePlay);
$('btn-prev').addEventListener('click', () => playIndex(state.index - 1));
$('btn-next').addEventListener('click', () => playIndex(state.index + 1));
$('btn-back10').addEventListener('click', () => video.currentTime = Math.max(0, video.currentTime - 10));
$('btn-fwd10').addEventListener('click', () => video.currentTime = Math.min(video.duration || 0, video.currentTime + 10));
$('btn-volume').addEventListener('click', () => { video.muted = !video.muted; syncVolumeUI(); });
$('volume').addEventListener('input', () => {
  video.volume = Number($('volume').value);
  video.muted = video.volume === 0;
  syncVolumeUI();
  try { localStorage.setItem(VOL_KEY, String(video.volume)); } catch {}
});$('btn-full').addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } else {
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
    else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iOS Safari fallback
  }
});
$('player-subs').addEventListener('click', () => {
  const ep = state.playlist[state.index];
  const sibling = state.playlist.find(e => e.ep === ep.ep && e.lang !== ep.lang);
  if (sibling) playIndex(state.playlist.indexOf(sibling));
});

/* Episode overview in player */
const playerInfo = $('player-info');
let piWasPlaying = false;
function showPlayerInfo(ep, lang) {
  const arc = state.currentArc;
  const e = arc.episodes.find(x => x.ep === Number(ep) && x.lang === lang);
  if (!e) return;
  const sibling = arc.episodes.find(x => x.ep === Number(ep) && x.lang !== lang);
  const langBtns = sibling ? `
    <button class="btn ${lang === 'Dub' ? 'btn-primary' : 'btn-secondary'}" onclick="switchPlayerInfo(${ep},'Dub')">Dub</button>
    <button class="btn ${lang === 'Sub' ? 'btn-primary' : 'btn-secondary'}" onclick="switchPlayerInfo(${ep},'Sub')">Sub</button>` :
    `<span class="tag tag-${e.lang === 'Dub' ? 'dub' : 'sub'}" style="align-self:center;padding:6px 12px;">${e.lang}</span>`;
  $('pi-body').innerHTML = `
    <div class="ep-modal-hero">
      <img class="ep-modal-poster" src="${esc(arc.poster)}" alt="" />
      <div class="ep-modal-meta">
        <div class="ep-modal-arc">${esc(arc.name)} · Episode ${String(ep).padStart(2, '0')}</div>
        <h2 class="ep-modal-title">${esc(e.title)}</h2>
        <div class="ep-modal-lang">${lang} audio${e.filler ? ' · Filler' : ''}${e.alt ? ' · Alt' : ''}</div>
      </div>
    </div>
    <div class="ep-modal-desc-label">Overview</div>
    <div class="ep-modal-desc">${esc(e.description) || '<i>No synopsis available for this episode.</i>'}</div>
    ${(e.anime || e.manga) ? `
      <div class="ep-modal-desc-label">Adapts</div>
      <div class="ep-modal-adapts">
        ${e.anime ? `<div class="adapt-row"><span class="adapt-icon">🎬</span> Anime Episodes: <b>${esc(e.anime)}</b></div>` : ''}
        ${e.manga ? `<div class="adapt-row"><span class="adapt-icon">📖</span> Manga Chapters: <b>${esc(e.manga)}</b></div>` : ''}
      </div>` : ''}
    <div class="ep-modal-actions">
      <button class="btn btn-primary" onclick="piPlay(${ep},'${lang}')">▶ &nbsp;Play</button>
      ${langBtns}
    </div>
  `;
  piWasPlaying = !video.paused;
  video.pause();
  playerInfo.classList.add('showing');
}
window.switchPlayerInfo = function (ep, lang) { showPlayerInfo(ep, lang); };
function hidePlayerInfo() {
  playerInfo.classList.remove('showing');
  if (piWasPlaying && !video.ended) video.play();
}
window.piPlay = function (ep, lang) {
  hidePlayerInfo();
  const epObj = state.playlist.find(p => p.ep === ep && p.lang === lang);
  const idx = epObj ? state.playlist.indexOf(epObj) : state.index;
  if (idx >= 0) { state.index = idx; video.src = state.playlist[idx].url; video.load(); video.play(); updatePlayerUI(); }
};
$('pi-close').addEventListener('click', hidePlayerInfo);
playerInfo.addEventListener('click', (e) => { if (e.target === playerInfo) hidePlayerInfo(); });
$('player-overview').addEventListener('click', () => {
  const ep = state.playlist[state.index];
  if (!ep) return;
  if (playerInfo.classList.contains('showing')) hidePlayerInfo();
  else showPlayerInfo(ep.ep, ep.lang);
});

/* Picture in Picture */
$('btn-pip').addEventListener('click', togglePiP);
function togglePiP() {
  if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
  if (video.requestPictureInPicture) {
    video.requestPictureInPicture().catch((err) => console.warn('PiP error:', err));
  }
}
video.addEventListener('enterpictureinpicture', () => $('btn-pip').classList.add('is-paused'));
video.addEventListener('leavepictureinpicture', () => $('btn-pip').classList.remove('is-paused'));

/* Settings menu */
const settingsWrap = $('settings-wrap');
const settingsMenu = $('settings-menu');
const settingsRoot = $('settings-root');
function showSettingsPanel(name) {
  settingsMenu.querySelectorAll('.settings-sub').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  settingsRoot.classList.add('hidden');
}
settingsMenu.querySelectorAll('.settings-item').forEach(item => {
  item.addEventListener('click', () => showSettingsPanel(item.dataset.sub));
});
settingsMenu.querySelectorAll('.settings-back').forEach(btn => {
  btn.addEventListener('click', () => {
    settingsMenu.querySelectorAll('.settings-sub').forEach(p => p.classList.add('hidden'));
    settingsRoot.classList.remove('hidden');
  });
});
$('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsMenu.classList.contains('hidden')) {
    // reset to root when opening
    settingsMenu.querySelectorAll('.settings-sub').forEach(p => p.classList.add('hidden'));
    settingsRoot.classList.remove('hidden');
  }
  settingsMenu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!settingsWrap.contains(e.target)) settingsMenu.classList.add('hidden');
});
let selectedSpeed = 1;
settingsMenu.querySelectorAll('.speed-opts .speed-opt[data-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedSpeed = Number(btn.dataset.speed);
    video.playbackRate = selectedSpeed;
    settingsMenu.querySelectorAll('.speed-opts .speed-opt[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
  });
});
// Volume boost via a WebAudio gain node (allows >100%)
let boostGainValue = Number(localStorage.getItem('onepace.boost') || '1');
let audioCtx = null, gainNode = null, mediaSource = null;
function ensureBoostGraph() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  mediaSource = audioCtx.createMediaElementSource(video);
  gainNode = audioCtx.createGain();
  gainNode.gain.value = boostGainValue;
  mediaSource.connect(gainNode);
  gainNode.connect(audioCtx.destination);
}
function setVolumeBoost(val) {
  boostGainValue = val;
  localStorage.setItem('onepace.boost', String(val));
  if (gainNode) gainNode.gain.value = val;
}
const boostSlider = $('boost');
const boostValueEl = $('boost-value');
function updateBoostUI() {
  boostSlider.value = boostGainValue;
  boostValueEl.textContent = Math.round(boostGainValue * 100) + '%';
}
boostSlider.addEventListener('input', () => {
  ensureBoostGraph();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  setVolumeBoost(Number(boostSlider.value));
  boostValueEl.textContent = Math.round(boostGainValue * 100) + '%';
});
updateBoostUI();

function syncVolumeUI() {
  const muted = video.muted || video.volume === 0;
  $('volume').value = video.muted ? 0 : video.volume;
  $('vol-icon-on').style.display = muted ? 'none' : 'block';
  $('vol-icon-mute').style.display = muted ? 'block' : 'none';
  $('vol-pct').textContent = muted ? 'Muted' : Math.round(video.volume * 100) + '%';
}

/* --- Seek / progress bar with drag --- */
const progress = $('player-progress');
const playedEl = $('progress-played');
const bufferEl = $('progress-buffer');
const handleEl = $('progress-handle');
const tooltipEl = $('progress-tooltip');
const timeEl = $('time');

function seekFromEvent(clientX) {
  const r = progress.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  return frac;
}
function setProgressUI(frac, seekTime) {
  playedEl.style.width = (frac * 100) + '%';
  handleEl.style.left = (frac * 100) + '%';
}
function updateProgressUI() {
  const dur = video.duration || 0;
  const cur = video.currentTime || 0;
  const frac = dur ? cur / dur : 0;
  setProgressUI(frac);
  timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
}

progress.addEventListener('pointerdown', (e) => {
  seeking = true;
  progress.classList.add('dragging');
  progress.setPointerCapture(e.pointerId);
  const frac = seekFromEvent(e.clientX);
  if (video.duration) video.currentTime = frac * video.duration;
  setProgressUI(frac);
  showControls();
  e.preventDefault();
});
progress.addEventListener('pointermove', (e) => {
  const frac = seekFromEvent(e.clientX);
  if (seeking) {
    if (video.duration) video.currentTime = frac * video.duration;
    setProgressUI(frac);
  } else {
    // hover time tooltip
    const dur = video.duration || 0;
    const clamped = Math.max(0.06, Math.min(0.94, frac));
    tooltipEl.style.left = (clamped * 100) + '%';
    tooltipEl.textContent = fmt(frac * dur);
    tooltipEl.style.opacity = '1';
  }
});
progress.addEventListener('pointerleave', () => {
  if (!seeking) tooltipEl.style.opacity = '0';
});
progress.addEventListener('pointerup', (e) => {
  if (!seeking) return;
  seeking = false;
  progress.classList.remove('dragging');
  const frac = seekFromEvent(e.clientX);
  if (video.duration) video.currentTime = frac * video.duration;
  setProgressUI(frac);
  progress.releasePointerCapture(e.pointerId);
});
progress.addEventListener('pointercancel', () => {
  seeking = false;
  progress.classList.remove('dragging');
});

video.addEventListener('click', () => { if (!seeking) togglePlay(); });
video.addEventListener('timeupdate', () => { updateProgressUI(); saveProgress(); });
video.addEventListener('progress', () => {
  const dur = video.duration || 0;
  if (!dur || !video.buffered.length) return;
  const buffered = video.buffered.end(video.buffered.length - 1);
  bufferEl.style.width = Math.min(100, buffered / dur * 100) + '%';
});
video.addEventListener('loadedmetadata', () => { syncVolumeUI(); resetIdleTimer(); });
video.addEventListener('playing', hideLoading);
video.addEventListener('canplay', hideLoading);
video.addEventListener('waiting', showLoading);
video.addEventListener('seeking', showLoading);
video.addEventListener('seeked', hideLoading);
video.addEventListener('play', () => { $('btn-play').classList.add('is-paused'); showControls(); });
video.addEventListener('pause', () => { $('btn-play').classList.remove('is-paused'); overlay.classList.remove('controls-hidden'); });
video.addEventListener('ended', () => { $('btn-play').classList.remove('is-paused'); if (state.index + 1 < state.playlist.length) playIndex(state.index + 1); });
document.addEventListener('fullscreenchange', () => {
  resetIdleTimer();
  const isFS = !!document.fullscreenElement;
  const expandIcon = document.querySelector('#btn-full .ico:not(.ico-fullscreen-exit)');
  const collapseIcon = document.querySelector('#btn-full .ico-fullscreen-exit');
  if (expandIcon) expandIcon.style.display = isFS ? 'none' : '';
  if (collapseIcon) collapseIcon.style.display = isFS ? '' : 'none';
  
  if (!isFS && !overlay.classList.contains('hidden') && playerInfo.classList.contains('showing')) {
    hidePlayerInfo();
  }
});
$('modal-close').addEventListener('click', closeModal);
$('modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!overlay.classList.contains('hidden')) {
      if (playerInfo.classList.contains('showing')) {
        e.preventDefault();
        hidePlayerInfo();
      } else {
        closePlayer();
      }
      return;
    }
    if (!modal.classList.contains('hidden')) closeModal();
    return;
  }
  if (overlay.classList.contains('hidden')) return;
  // space: tap toggles pause, hold = 2x speed (after a short delay)
  if (e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) {
      spaceDown = true;
      spaceDownTime = Date.now();
      spaceBoost = false;
      clearTimeout(spaceHoldTimer);
      spaceHoldTimer = setTimeout(() => {
        if (!spaceDown) return;
        spaceBoost = true;
        video.playbackRate = 2;
        setSpeedBadge(true);
      }, 300);
    }
    return;
  }
  if (e.key === 'k') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'm') { e.preventDefault(); $('btn-volume').click(); return; }
  if (e.key === 'n') { e.preventDefault(); playIndex(state.index + 1); return; }
  if (e.key === 'b') { e.preventDefault(); playIndex(state.index - 1); return; }
  if (e.key === 'f') { e.preventDefault(); $('btn-full').click(); return; }
  if (e.key === 'p') { e.preventDefault(); togglePiP(); return; }
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    $('player-overview').click();
    return;
  }
  if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 10);
  else if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  else if (e.key === 'ArrowUp') { video.volume = Math.min(1, video.volume + 0.1); syncVolumeUI(); }
  else if (e.key === 'ArrowDown') { video.volume = Math.max(0, video.volume - 0.1); syncVolumeUI(); }
});
document.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  clearTimeout(spaceHoldTimer);
  spaceDown = false;
  // restore selected speed when space is released
  const selected = document.querySelector('.speed-opts .speed-opt[data-speed].active');
  const target = selected ? Number(selected.dataset.speed) : selectedSpeed;
  video.playbackRate = target;
  setSpeedBadge(false);
  // a quick tap toggles play; a held space only fast-forwards
  if (!spaceBoost && Date.now() - spaceDownTime < 250) togglePlay();
  spaceBoost = false;
});

/* ============ Boot ============ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW error:', err));
}
(async () => {
  try {
    const [data] = await Promise.all([
      loadData(),
      new Promise((res) => setTimeout(res, 1000))
    ]);
    try {
      const savedVol = localStorage.getItem(VOL_KEY);
      if (savedVol !== null) {
        video.volume = Number(savedVol);
        $('volume').value = savedVol;
        syncVolumeUI();
      }
    } catch {}
    
    if (currentUser) {
      await syncProgressFromDB();
    }
    
    router();
    hideSplash();
  } catch (err) {
    const s = document.getElementById('splash');
    if (s) {
      s.innerHTML += `<div style="color:red; background: black; padding: 20px; position: relative; z-index: 9999;">BOOT ERROR: ${err.message || err}<br/>${err.stack || ''}</div>`;
    }
  }
})();

/* ============ Authentication & Sync ============ */
let authMode = 'signin';
const authModal = $('auth-modal');
const authForm = $('auth-form');
const authError = $('auth-error');
const authSuccess = $('auth-success');
const authTitle = $('auth-title');
const authSub = $('auth-sub');
const authSubmit = $('auth-submit');
const authToggleText = $('auth-toggle-text');

window.openAuthModal = function() {
  authModal.classList.remove('hidden');
  authError.classList.add('hidden');
  authSuccess.classList.add('hidden');
};
window.closeAuthModal = function() {
  authModal.classList.add('hidden');
};
$('auth-close').addEventListener('click', closeAuthModal);
$('auth-backdrop').addEventListener('click', closeAuthModal);

$('auth-toggle-btn').addEventListener('click', (e) => {
  e.preventDefault();
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  authError.classList.add('hidden');
  authSuccess.classList.add('hidden');
  
  const span = authToggleText.childNodes[0]; // the text node before the anchor
  if (authMode === 'signin') {
    authTitle.textContent = 'Welcome Back';
    authSub.textContent = 'Sign in to sync your progress.';
    authSubmit.textContent = 'Sign In';
    span.nodeValue = "Don't have an account? ";
    $('auth-toggle-btn').textContent = 'Sign Up';
  } else {
    authTitle.textContent = 'Create Account';
    authSub.textContent = 'Sign up to sync your progress across devices.';
    authSubmit.textContent = 'Sign Up';
    span.nodeValue = "Already have an account? ";
    $('auth-toggle-btn').textContent = 'Sign In';
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value;
  const password = $('auth-password').value;
  authSubmit.disabled = true;
  authError.classList.add('hidden');
  authSuccess.classList.add('hidden');
  
  if (!supabaseClient) {
    authError.textContent = "Database connection error.";
    authError.classList.remove('hidden');
    authSubmit.disabled = false;
    return;
  }
  
  const { data, error } = authMode === 'signin' 
    ? await supabaseClient.auth.signInWithPassword({ email, password })
    : await supabaseClient.auth.signUp({ email, password });
    
  if (error) {
    authError.textContent = error.message;
    authError.classList.remove('hidden');
  } else {
    if (authMode === 'signup' && data.user && data.user.identities && data.user.identities.length === 0) {
      // If identities is empty on signup, it usually means the email is already registered
      authError.textContent = "This email is already registered. Please sign in.";
      authError.classList.remove('hidden');
    } else if (authMode === 'signup' && data.session === null) {
      // Email confirmation required
      authSuccess.textContent = "Please check your email for a confirmation link!";
      authSuccess.classList.remove('hidden');
    } else {
      closeAuthModal();
    }
  }
  authSubmit.disabled = false;
});

window.signOut = async function() {
  if (supabaseClient) await supabaseClient.auth.signOut();
};

async function syncProgressFromDB() {
  if (!currentUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('user_progress').select('*');
  if (error) {
    console.error('Failed to fetch progress:', error);
    return;
  }
  
  if (data && data.length > 0) {
    const localMap = getCW();
    let updated = false;
    data.forEach(row => {
      const key = cwKey(row.season, row.ep, row.lang);
      if (!localMap[key] || localMap[key].time < row.time) {
        // We only sync essential info, the rest (title, arcName) is missing from DB.
        // If we really need it, we'd have to look it up from state.data.
        // For now, we trust the local storage if it has richer data, but update the time.
        // We should look up the arc & ep to populate correctly.
        if (state.data && state.data.arcs) {
          const arc = state.data.arcs.find(a => a.season === row.season);
          if (arc) {
            const epData = arc.episodes.find(e => String(e.ep) === String(row.ep) && e.lang === row.lang);
            if (epData) {
              localMap[key] = {
                season: arc.season, ep: epData.ep, lang: epData.lang,
                title: epData.title, arcName: arc.name, poster: arc.poster,
                time: row.time, duration: localMap[key] ? localMap[key].duration : 1000,
                pct: localMap[key] ? Math.round(row.time / localMap[key].duration * 100) : 0,
                lastWatched: new Date(row.updated_at).getTime()
              };
              updated = true;
            }
          }
        }
      }
    });
    if (updated) {
      setCW(localMap);
      state.cw = localMap;
      if (!location.hash || location.hash === '#/' || location.hash === '') {
        renderHome();
      }
    }
  }
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    renderNav();
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (state.data) {
        syncProgressFromDB();
      }
    }
  });
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), 600);
}

/* ============ Sync Feature ============ */
function openSyncModal() {
  document.getElementById('sync-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('sync-input').focus(), 50);
}
function closeSyncModal() {
  document.getElementById('sync-modal').classList.add('hidden');
}
function findSyncEpisode() {
  const input = document.getElementById('sync-input').value;
  const num = parseInt(input, 10);
  const resultDiv = document.getElementById('sync-result');
  if (isNaN(num) || num <= 0) {
    resultDiv.innerHTML = `<div style="color: var(--red);">Please enter a valid episode number.</div>`;
    return;
  }
  
  let match = null;
  for (const arc of state.data.arcs) {
    for (const ep of arc.episodes) {
      if (!ep.anime) continue;
      const parts = ep.anime.split(',').map(s => s.trim());
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(s => parseInt(s, 10));
          if (num >= start && num <= end) {
            match = { arc, ep };
            break;
          }
        } else {
          const single = parseInt(part, 10);
          if (num === single) {
            match = { arc, ep };
            break;
          }
        }
      }
      if (match) break;
    }
    if (match) break;
  }

  if (match) {
    resultDiv.innerHTML = `
      <div class="cw-card" style="flex-direction: row; align-items: stretch; height: auto; cursor: default; background: rgba(255,255,255,0.03);">
        <div class="cw-thumb" style="width: 120px;">
          <img src="${esc(match.arc.poster)}" alt="">
        </div>
        <div class="cw-body" style="padding: 16px;">
          <div class="cw-arc">${esc(match.arc.name)}</div>
          <div class="cw-title">${esc(match.ep.title)}</div>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">Covers anime eps: ${esc(match.ep.anime)}</div>
          <button class="btn btn-primary" style="margin-top: 16px; align-self: flex-start; padding: 6px 14px; font-size: 13px;" onclick="closeSyncModal(); playEpisode(${match.arc.season}, ${match.ep.ep}, '${match.ep.lang}', true)">
            ▶ Play Episode ${match.ep.ep}
          </button>
        </div>
      </div>
    `;
  } else {
    resultDiv.innerHTML = `
      <div style="color: var(--text-dim); font-size: 14px; text-align: center; padding: 24px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid var(--border);">
        Unfortunately no One Pace episode has been released to cover episode ${num} at the moment.<br><br>
        <span style="color: var(--text);">Watch One Piece instead.</span>
      </div>`;
  }
}
