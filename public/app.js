/**
 * CineSphere Browser - Client Application
 * Multi-Provider unified architecture: MovieBox, 4KHDHub, Stremio Addons, CircleFTP, DhakaFlix
 */
(function () {
'use strict';

// State
let currentResults = [];
let activeMedia = null;
let activeFilter = 'all'; // 'all' | 'movie' | 'series'
let selectedProvider = 'movieBoxWeb';

let currentPlayback = {
  rawUrl: '',
  title: '',
  cookie: '',
  headers: null,
  isProxied: true,
  allowDirect: false,
};

// Active hls.js instance (if any). Destroyed before each new source load.
let hlsPlayerInstance = null;
// Tracks which media/provider the currently displayed streams came from, so a
// failed playback can automatically re-resolve sources from another provider.
let activeStreamContext = { id: '', provider: 'addon' };

let autoSwitchTried = false;
// DOM Elements
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchBtnText = document.getElementById('searchBtnText');
const searchSpinner = document.getElementById('searchSpinner');
const heroSearchSection = document.getElementById('heroSearchSection');
const providerSelect = document.getElementById('providerSelect');

function showSearchHero() {
  if (heroSearchSection) {
    heroSearchSection.classList.remove('hidden');
  }
}

function hideSearchHero() {
  if (heroSearchSection) {
    heroSearchSection.classList.add('hidden');
  }
}

// Navigation & Providers Modal DOM Elements
const navHomeBtn = document.getElementById('navHomeBtn');
const navSearchBtn = document.getElementById('navSearchBtn');
const navProvidersBtn = document.getElementById('navProvidersBtn');
const navActiveProviderBadge = document.getElementById('navActiveProviderBadge');

const providersModal = document.getElementById('providersModal');
const closeProvidersBtn = document.getElementById('closeProvidersBtn');
const closeProvidersFooterBtn = document.getElementById('closeProvidersFooterBtn');
const providersSearchInput = document.getElementById('providersSearchInput');
const btnUnifiedAll = document.getElementById('btnUnifiedAll');
const providerCategoryPills = document.getElementById('providerCategoryPills');
const providersModalList = document.getElementById('providersModalList');
const providersModalCount = document.getElementById('providersModalCount');

let allProvidersList = [];
let activeModalCategory = 'all';
let globalMirrorStore = [];

const resultsGrid = document.getElementById('resultsGrid');
const resultsCount = document.getElementById('resultsCount');
const resultsTitle = document.getElementById('resultsTitle');
const filterAllBtn = document.getElementById('filterAllBtn');
const filterMoviesBtn = document.getElementById('filterMoviesBtn');
const filterSeriesBtn = document.getElementById('filterSeriesBtn');

const loadingState = document.getElementById('loadingState');
const welcomeState = document.getElementById('welcomeState');
const emptyState = document.getElementById('emptyState');
const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');

// Modals & Panels
const detailsModal = document.getElementById('detailsModal');
const closeDetailsBtn = document.getElementById('closeDetailsBtn');
const modalProviderBadge = document.getElementById('modalProviderBadge');
const modalPoster = document.getElementById('modalPoster');
const modalTitle = document.getElementById('modalTitle');
const modalTypeBadge = document.getElementById('modalTypeBadge');
const modalYear = document.getElementById('modalYear');
const modalDuration = document.getElementById('modalDuration');
const modalRating = document.getElementById('modalRating');
const modalRatingBadge = document.getElementById('modalRatingBadge');
const modalGenres = document.getElementById('modalGenres');
const modalDescription = document.getElementById('modalDescription');
const modalSubjectId = document.getElementById('modalSubjectId');
const seriesHierarchySection = document.getElementById('seriesHierarchySection');
const seriesSeasonsList = document.getElementById('seriesSeasonsList');
const seriesAudioSelect = document.getElementById('seriesAudioSelect');
const seriesSeasonSelect = document.getElementById('seriesSeasonSelect');

// Library: Watchlist & History
const navLibraryBtn = document.getElementById('navLibraryBtn');
const navWatchlistBadge = document.getElementById('navWatchlistBadge');
const libraryModal = document.getElementById('libraryModal');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const closeLibraryFooterBtn = document.getElementById('closeLibraryFooterBtn');
const tabWatchlistBtn = document.getElementById('tabWatchlistBtn');
const tabHistoryBtn = document.getElementById('tabHistoryBtn');
const libWatchlistBadge = document.getElementById('libWatchlistBadge');
const libHistoryBadge = document.getElementById('libHistoryBadge');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const libraryWatchlistContainer = document.getElementById('libraryWatchlistContainer');
const libraryHistoryContainer = document.getElementById('libraryHistoryContainer');
const modalWatchlistBtn = document.getElementById('modalWatchlistBtn');

const ALLOWED_AUDIO_LANGUAGES = new Set(['english', 'hindi', 'original']);
const DISALLOWED_AUDIO_LANGUAGES = [
  'arabic', 'bengali', 'chinese', 'french', 'german', 'indonesian',
  'italian', 'japanese', 'kannada', 'korean', 'malayalam', 'marathi',
  'punjabi', 'portuguese', 'russian', 'spanish', 'tamil', 'telugu', 'thai',
  'turkish', 'vietnamese', 'tagalog', 'esla', 'ptbr', 'latam', 'castilian',
  'dublado',
];

function normalizeAudioLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Returns strictly 'english', 'hindi', or 'original'.
 * Returns null if the text belongs to any other foreign language (disallowed).
 */
function detectStrictAudioLanguage(value) {
  const label = normalizeAudioLabel(value);
  if (!label) return 'original';

  for (const lang of DISALLOWED_AUDIO_LANGUAGES) {
    if (new RegExp(`(^|\\s)${lang}(\\s|$)`, 'i').test(label)) {
      return null;
    }
  }

  if (/(^|\s)(hindi|hin|bollywood)(\s|$)/i.test(label) || label.includes('hindi dub') || label.includes('hin dub')) {
    return 'hindi';
  }

  if (/(^|\s)(english|eng|en)(\s|$)/i.test(label) || label.includes('english dub') || label.includes('eng dub')) {
    return 'english';
  }

  if (/(^|\s)(original|native|main)(\s|$)/i.test(label) || label.includes('original audio')) {
    return 'original';
  }

  return 'original';
}

function getSeasonNumberFromValue(season) {
  if (!season || typeof season !== 'object') return null;

  const direct = Number(season.seasonNumber ?? season.number ?? season.season ?? season.id ?? season.value ?? season.index);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const text = String(season.title || season.name || season.label || '');
  const match = text.match(/(?:^|\s|\[)(?:season|s)\s*(\d+)(?:\s*[-–]\s*(?:season|s)?\d+)?(?:\]|$)/i)
    || text.match(/(?:^|\s|\[)(\d+)(?:\s*[-–]\s*\d+)?(?:\]|$)/);

  if (match && Number(match[1])) return Number(match[1]);
  return null;
}

function getSeasonLabel(season) {
  const seasonNumber = getSeasonNumberFromValue(season);
  if (Number.isFinite(seasonNumber)) return `Season ${seasonNumber}`;

  const fallback = String(season?.title || season?.name || season?.label || 'Season');
  return fallback || 'Season';
}

function isEpisodeEntry(episode) {
  if (!episode || typeof episode !== 'object') return false;
  const rawType = String(episode.type || episode.kind || '').toLowerCase();
  if (rawType === 'movie' || rawType === 'film') return false;
  const title = String(episode.title || episode.name || episode.label || '');
  if (/\bmovie\b/i.test(title)) return false;
  return true;
}

function getEpisodeAudioLabel(episode) {
  const labelSources = [
    episode?.language,
    episode?.audio,
    episode?.lang,
    episode?.title,
    episode?.name,
    episode?.label,
    episode?.variant,
  ];
  return detectStrictAudioLanguage(labelSources.filter(Boolean).join(' '));
}

function getEpisodeDisplayNumber(episode, fallbackIndex = 0) {
  const direct = Number(episode?.episodeNumber ?? episode?.ep ?? episode?.number ?? episode?.episode ?? episode?.id);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const title = String(episode?.title || episode?.name || episode?.label || '');
  const match = title.match(/(?:episode|ep)[^0-9]*(\d+)/i) || title.match(/(\d+)/);
  if (match && Number(match[1])) return Number(match[1]);

  return fallbackIndex + 1;
}

function dedupeEpisodesByNumberAndAudio(episodes) {
  const seen = new Set();
  return (Array.isArray(episodes) ? episodes : [])
    .filter(isEpisodeEntry)
    .filter((episode, index) => {
      const audio = getEpisodeAudioLabel(episode);
      if (!audio) return false; // Discard any episode that is not english, hindi, or original!
      const key = `${getEpisodeDisplayNumber(episode, index)}::${audio}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function filterSeriesEpisodesForAudio(episodes, selectedAudio = 'all') {
  const audioChoice = String(selectedAudio || 'all').toLowerCase();
  const safeEpisodes = dedupeEpisodesByNumberAndAudio(episodes);

  return safeEpisodes.filter((episode) => {
    const detectedLanguage = getEpisodeAudioLabel(episode);
    if (!detectedLanguage || !ALLOWED_AUDIO_LANGUAGES.has(detectedLanguage)) {
      return false; // strictly exclude any disallowed language
    }
    if (audioChoice === 'all') return true;
    if (audioChoice === 'hindi') {
      return detectedLanguage === 'hindi';
    }
    if (audioChoice === 'english') {
      return detectedLanguage === 'english' || detectedLanguage === 'original';
    }
    if (audioChoice === 'original') {
      return detectedLanguage === 'original';
    }
    return detectedLanguage === audioChoice;
  });
}

if (seriesAudioSelect) {
  seriesAudioSelect.addEventListener('change', () => {
    if (activeMedia) {
      renderSeriesHierarchy(activeMedia);
    }
  });
}

if (seriesSeasonSelect) {
  seriesSeasonSelect.addEventListener('change', () => {
    if (activeMedia) {
      renderSeriesHierarchy(activeMedia);
    }
  });
}

// Streams / Video Player section
const viewSourcesBtn = document.getElementById('viewSourcesBtn');
const streamsSection = document.getElementById('streamsSection');
const streamsLoading = document.getElementById('streamsLoading');
const streamsList = document.getElementById('streamsList');
const streamsCountBadge = document.getElementById('streamsCountBadge');

const playerContainer = document.getElementById('playerContainer');
const videoPlayer = document.getElementById('videoPlayer');
const activeStreamTitle = document.getElementById('activeStreamTitle');
const playerModeBadge = document.getElementById('playerModeBadge');
const toggleProxyBtn = document.getElementById('toggleProxyBtn');
const copyStreamBtn = document.getElementById('copyStreamBtn');
const copyStreamText = document.getElementById('copyStreamText');
const downloadPlayerStream = document.getElementById('downloadPlayerStream');
const openStreamNewTab = document.getElementById('openStreamNewTab');
const closePlayerBtn = document.getElementById('closePlayerBtn');

// Gateway host info
const sessionHostBadge = document.getElementById('sessionHostBadge');
const rotateHostBtn = document.getElementById('rotateHostBtn');

// Provider badge styling mapping
const providerStyles = {
  addon: {
    label: 'Stremio',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
  '4khdhub': {
    label: '4KHDHub',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  circleftp: {
    label: 'CircleFTP',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
  dhakaflix: {
    label: 'DhakaFlix',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
};

// ==========================================
// WATCHLIST & WATCH HISTORY (LOCALSTORAGE)
// ==========================================
const WATCHLIST_STORAGE_KEY = 'cinesphere_watchlist';
const HISTORY_STORAGE_KEY = 'cinesphere_history';
let activeLibraryTab = 'watchlist';

function getStoredWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save watchlist:', e);
  }
  updateWatchlistBadges();
}

function getStoredHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredHistory(list) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save history:', e);
  }
  updateHistoryBadges();
}

function isItemInWatchlist(subjectId) {
  if (!subjectId) return false;
  const list = getStoredWatchlist();
  return list.some((it) => String(it.id) === String(subjectId) || String(it.subjectId) === String(subjectId));
}

function toggleWatchlistItem(mediaItem) {
  if (!mediaItem || (!mediaItem.subjectId && !mediaItem.id)) return false;
  const id = mediaItem.subjectId || mediaItem.id;
  const list = getStoredWatchlist();
  const idx = list.findIndex((it) => String(it.id) === String(id) || String(it.subjectId) === String(id));

  let isAdded = false;
  if (idx >= 0) {
    list.splice(idx, 1);
    isAdded = false;
  } else {
    list.unshift({
      id,
      subjectId: id,
      title: mediaItem.title || 'Untitled',
      type: mediaItem.type || 'movie',
      poster: mediaItem.poster || '',
      year: mediaItem.year || '',
      rating: mediaItem.rating || '',
      provider: mediaItem.provider || 'movieBoxWeb',
      providerDisplayName: mediaItem.providerDisplayName || '',
      addedAt: Date.now(),
    });
    isAdded = true;
  }

  saveStoredWatchlist(list);
  updateModalWatchlistBtnState();
  syncCardWatchlistIcons();
  if (libraryModal && !libraryModal.classList.contains('hidden') && activeLibraryTab === 'watchlist') {
    renderWatchlistTab();
  }
  return isAdded;
}

function removeWatchlistItem(subjectId) {
  if (!subjectId) return;
  const list = getStoredWatchlist().filter((it) => String(it.id) !== String(subjectId) && String(it.subjectId) !== String(subjectId));
  saveStoredWatchlist(list);
  updateModalWatchlistBtnState();
  syncCardWatchlistIcons();
  renderWatchlistTab();
}

function recordPlayHistory(mediaItem, streamDetails = null) {
  if (!mediaItem || (!mediaItem.subjectId && !mediaItem.id)) return;
  const id = mediaItem.subjectId || mediaItem.id;
  const list = getStoredHistory().filter((it) => String(it.id) !== String(id));

  list.unshift({
    id,
    subjectId: id,
    title: mediaItem.title || 'Untitled',
    type: mediaItem.type || 'movie',
    poster: mediaItem.poster || '',
    year: mediaItem.year || '',
    provider: mediaItem.provider || 'movieBoxWeb',
    providerDisplayName: mediaItem.providerDisplayName || '',
    streamTitle: streamDetails?.title || '',
    seasonNumber: streamDetails?.season || null,
    episodeNumber: streamDetails?.episode || null,
    watchedAt: Date.now(),
  });

  if (list.length > 100) list.length = 100;
  saveStoredHistory(list);
  if (libraryModal && !libraryModal.classList.contains('hidden') && activeLibraryTab === 'history') {
    renderHistoryTab();
  }
}

function removeHistoryItem(subjectId) {
  if (!subjectId) return;
  const list = getStoredHistory().filter((it) => String(it.id) !== String(subjectId) && String(it.subjectId) !== String(subjectId));
  saveStoredHistory(list);
  renderHistoryTab();
}

function clearAllHistory() {
  saveStoredHistory([]);
  renderHistoryTab();
}

function updateWatchlistBadges() {
  const count = getStoredWatchlist().length;
  if (navWatchlistBadge) {
    navWatchlistBadge.textContent = count;
    if (count > 0) {
      navWatchlistBadge.classList.remove('hidden');
    } else {
      navWatchlistBadge.classList.add('hidden');
    }
  }
  if (libWatchlistBadge) {
    libWatchlistBadge.textContent = count;
  }
}

function updateHistoryBadges() {
  const count = getStoredHistory().length;
  if (libHistoryBadge) {
    libHistoryBadge.textContent = count;
  }
}

function updateModalWatchlistBtnState() {
  if (!modalWatchlistBtn || !activeMedia) return;
  const inList = isItemInWatchlist(activeMedia.subjectId);
  const textEl = document.getElementById('modalWatchlistText');
  const iconEl = document.getElementById('modalWatchlistIcon');
  if (inList) {
    if (textEl) textEl.textContent = 'In Watchlist';
    modalWatchlistBtn.className = 'px-3.5 py-2 rounded-xl bg-amber-600/30 text-amber-300 border border-amber-500/50 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm';
    if (iconEl) iconEl.setAttribute('fill', 'currentColor');
  } else {
    if (textEl) textEl.textContent = 'Add to Watchlist';
    modalWatchlistBtn.className = 'px-3.5 py-2 rounded-xl bg-[#211d19] hover:bg-[#2c2621] text-slate-200 hover:text-white font-semibold text-xs flex items-center gap-1.5 border border-[#2f2924] transition cursor-pointer';
    if (iconEl) iconEl.setAttribute('fill', 'none');
  }
}

function syncCardWatchlistIcons() {
  if (!resultsGrid) return;
  const buttons = resultsGrid.querySelectorAll('[data-action="toggle-card-watchlist"]');
  buttons.forEach((btn) => {
    const id = btn.dataset.subjectId;
    const inList = isItemInWatchlist(id);
    btn.title = inList ? 'Remove from Watchlist' : 'Add to Watchlist';
    const svg = btn.querySelector('svg');
    if (inList) {
      btn.className = 'w-6 h-6 rounded-lg bg-amber-600 text-white border border-amber-400 backdrop-blur-md flex items-center justify-center transition cursor-pointer shadow';
      if (svg) svg.setAttribute('fill', 'white');
    } else {
      btn.className = 'w-6 h-6 rounded-lg bg-black/75 hover:bg-amber-600 text-slate-200 hover:text-white border border-white/10 backdrop-blur-md flex items-center justify-center transition cursor-pointer shadow';
      if (svg) svg.setAttribute('fill', 'none');
    }
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Recently';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderWatchlistTab() {
  if (!libraryWatchlistContainer) return;
  const list = getStoredWatchlist();
  updateWatchlistBadges();

  if (list.length === 0) {
    libraryWatchlistContainer.innerHTML = `
      <div class="py-12 px-4 text-center space-y-3">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-[#1f1b17] border border-[#2f2924] flex items-center justify-center text-slate-500">
          <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </div>
        <h4 class="text-sm font-bold text-slate-200">Your Watchlist is Empty</h4>
        <p class="text-xs text-slate-400 max-w-sm mx-auto">
          Save movies and TV series to watch later. Click the bookmark icon on any title card or "+ Add to Watchlist" in details view.
        </p>
      </div>
    `;
    return;
  }

  libraryWatchlistContainer.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      ${list.map((item) => {
        const isSeries = item.type === 'series';
        const posterUrl = item.poster || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" fill="%23111726"><rect width="300" height="450"/><text x="50%" y="50%" fill="%2364748b" font-family="sans-serif" font-size="16" text-anchor="middle">No Poster</text></svg>';
        const timeAgo = formatRelativeTime(item.addedAt);

        return `
          <div class="flex gap-3 p-3 rounded-xl bg-[#161412] border border-[#2f2924] hover:border-slate-600 transition group">
            <div class="w-16 h-24 shrink-0 rounded-lg overflow-hidden bg-black/60 border border-[#2f2924] relative cursor-pointer" data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
              <img src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <span class="absolute top-1 left-1 text-[8px] font-mono uppercase font-bold px-1 rounded ${isSeries ? 'badge-series' : 'badge-movie'}">
                ${isSeries ? 'Series' : 'Movie'}
              </span>
            </div>

            <div class="flex-1 flex flex-col justify-between min-w-0">
              <div>
                <h4 class="text-xs font-bold text-slate-200 truncate cursor-pointer hover:text-amber-400 transition" data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
                  ${escapeHtml(item.title)}
                </h4>
                <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-mono">
                  <span>${escapeHtml(item.year || 'HD')}</span>
                  <span>•</span>
                  <span>Saved ${timeAgo}</span>
                </div>
              </div>

              <div class="flex items-center justify-between gap-1.5 pt-2">
                <button
                  data-action="lib-watch-now"
                  data-subject-id="${escapeHtml(item.subjectId)}"
                  data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}"
                  class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-mono text-[11px] font-bold flex items-center gap-1 shadow transition cursor-pointer"
                >
                  <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                  </svg>
                  <span>Play</span>
                </button>

                <button
                  data-action="lib-remove-watchlist"
                  data-subject-id="${escapeHtml(item.subjectId)}"
                  title="Remove from watchlist"
                  class="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition cursor-pointer"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderHistoryTab() {
  if (!libraryHistoryContainer) return;
  const list = getStoredHistory();
  updateHistoryBadges();

  if (list.length === 0) {
    libraryHistoryContainer.innerHTML = `
      <div class="py-12 px-4 text-center space-y-3">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-[#1f1b17] border border-[#2f2924] flex items-center justify-center text-slate-500">
          <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h4 class="text-sm font-bold text-slate-200">No Watch History Yet</h4>
        <p class="text-xs text-slate-400 max-w-sm mx-auto">
          Titles and episodes you play will automatically be tracked here so you can easily resume where you left off.
        </p>
      </div>
    `;
    return;
  }

  libraryHistoryContainer.innerHTML = `
    <div class="space-y-2">
      ${list.map((item) => {
        const posterUrl = item.poster || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" fill="%23111726"><rect width="300" height="450"/><text x="50%" y="50%" fill="%2364748b" font-family="sans-serif" font-size="16" text-anchor="middle">No Poster</text></svg>';
        const timeAgo = formatRelativeTime(item.watchedAt);
        const epDetail = item.seasonNumber && item.episodeNumber
          ? `S${item.seasonNumber} • E${item.episodeNumber}`
          : (item.streamTitle || '');

        return `
          <div class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#161412] border border-[#2f2924] hover:border-slate-600 transition group">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-14 shrink-0 rounded-lg overflow-hidden bg-black/60 border border-[#2f2924] relative cursor-pointer" data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
                <img src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" class="w-full h-full object-cover" />
              </div>

              <div class="min-w-0">
                <h4 class="text-xs font-bold text-slate-200 truncate cursor-pointer hover:text-amber-400 transition" data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
                  ${escapeHtml(item.title)}
                </h4>
                <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                  ${epDetail ? `<span class="px-1.5 py-0.2 rounded bg-[#211d19] text-amber-300 font-semibold border border-[#2f2924]">${escapeHtml(epDetail)}</span>` : ''}
                  <span>Watched ${timeAgo}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                data-action="lib-watch-now"
                data-subject-id="${escapeHtml(item.subjectId)}"
                data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}"
                class="px-2.5 py-1 rounded-lg bg-[#211d19] hover:bg-amber-600 text-slate-200 hover:text-white font-mono text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
              >
                <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                </svg>
                <span>Resume</span>
              </button>

              <button
                data-action="lib-remove-history"
                data-subject-id="${escapeHtml(item.subjectId)}"
                title="Remove from history"
                class="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition cursor-pointer"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openLibraryModal(initialTab = 'watchlist') {
  activeLibraryTab = initialTab;
  switchLibraryTab(initialTab);
  if (libraryModal) {
    libraryModal.classList.remove('hidden');
    libraryModal.style.display = 'flex';
  }
}

function closeLibraryModal() {
  if (libraryModal) {
    libraryModal.classList.add('hidden');
    libraryModal.style.display = 'none';
  }
}

function switchLibraryTab(tabName) {
  activeLibraryTab = tabName;
  if (tabName === 'watchlist') {
    if (tabWatchlistBtn) tabWatchlistBtn.className = 'pb-3 px-1 border-b-2 border-amber-400 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition';
    if (tabHistoryBtn) tabHistoryBtn.className = 'pb-3 px-1 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-semibold text-xs flex items-center gap-2 cursor-pointer transition';
    if (libraryWatchlistContainer) libraryWatchlistContainer.classList.remove('hidden');
    if (libraryHistoryContainer) libraryHistoryContainer.classList.add('hidden');
    if (clearHistoryBtn) clearHistoryBtn.classList.add('hidden');
    renderWatchlistTab();
  } else {
    if (tabHistoryBtn) tabHistoryBtn.className = 'pb-3 px-1 border-b-2 border-amber-400 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition';
    if (tabWatchlistBtn) tabWatchlistBtn.className = 'pb-3 px-1 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-semibold text-xs flex items-center gap-2 cursor-pointer transition';
    if (libraryHistoryContainer) libraryHistoryContainer.classList.remove('hidden');
    if (libraryWatchlistContainer) libraryWatchlistContainer.classList.add('hidden');
    if (clearHistoryBtn) clearHistoryBtn.classList.remove('hidden');
    renderHistoryTab();
  }
}

let activeGenre = null;

/**
 * 1. searchMovies(query, provider, genre)
 * Calls GET /api/search?q=<query>&provider=<provider>&genre=<genre>
 */
async function searchMovies(query, provider = 'all', genre = null) {
  let url = `/api/search?q=${encodeURIComponent(query)}`;
  if (provider && provider !== 'all') {
    url += `&provider=${encodeURIComponent(provider)}`;
  }
  const effectiveGenre = genre || activeGenre;
  if (effectiveGenre) {
    url += `&genre=${encodeURIComponent(effectiveGenre)}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Search failed with status HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 2. showSearchResults(results)
 * Renders list of catalog items into results grid with provider origin badges.
 */
function showSearchResults(results) {
  currentResults = results || [];

  if (welcomeState) {
    welcomeState.classList.add('hidden');
  }

  // Filter by category: all / movie / series
  let filtered = currentResults;
  if (activeFilter === 'movie') {
    filtered = currentResults.filter(item => item.type === 'movie');
  } else if (activeFilter === 'series') {
    filtered = currentResults.filter(item => item.type === 'series');
  }

  resultsCount.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    resultsGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  resultsGrid.innerHTML = filtered.map((item) => {
    const isMovie = item.type === 'movie';
    const posterUrl = item.poster || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" fill="%23111726"><rect width="300" height="450"/><text x="50%" y="50%" fill="%2364748b" font-family="sans-serif" font-size="16" text-anchor="middle">No Poster</text></svg>';
    const safeTitle = escapeHtml(item.title);
    const yearDisplay = item.year ? `${item.year}` : 'HD';
    const is4K = item.provider === '4khdhub' || (item.tag && /4k|uhd|remux/i.test(item.tag));
    const qualityBadge = is4K ? '4K Ultra HD' : 'HD 1080p';
    const inList = isItemInWatchlist(item.subjectId);

    return `
      <div class="media-card group cursor-pointer" data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
        <div class="poster-container">
          <img
            src="${posterUrl}"
            alt="${safeTitle}"
            loading="lazy"
            class="poster-img"
            onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27300%27 height=%27450%27 fill=%27%23111726%27><rect width=%27300%27 height=%27450%27/><text x=%2750%25%27 y=%2750%25%27 fill=%27%2364748b%27 font-family=%27sans-serif%27 font-size=%2716%27 text-anchor=%27middle%27>No Poster</text></svg>'"
          />

          <!-- Quality Badge Top-Left -->
          <div class="absolute top-2 left-2">
            <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-emerald-400 border border-emerald-500/30 shadow">
              ${qualityBadge}
            </span>
          </div>

          <!-- Type Badge & Watchlist Quick Toggle Top-Right -->
          <div class="absolute top-2 right-2 flex items-center gap-1.5 z-10">
            <span class="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded shadow ${isMovie ? 'badge-movie' : 'badge-series'}">
              ${isMovie ? 'Movie' : 'Series'}
            </span>
            <button
              data-action="toggle-card-watchlist"
              data-subject-id="${escapeHtml(item.subjectId)}"
              title="${inList ? 'Remove from Watchlist' : 'Add to Watchlist'}"
              class="w-6 h-6 rounded-lg ${inList ? 'bg-amber-600 text-white border-amber-400' : 'bg-black/75 hover:bg-amber-600 text-slate-200 hover:text-white border-white/10'} backdrop-blur-md flex items-center justify-center border transition cursor-pointer shadow"
            >
              <svg class="w-3.5 h-3.5 ${inList ? 'fill-white' : 'fill-none'}" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
              </svg>
            </button>
          </div>

          <!-- Release Year & Tag Bottom -->
          <div class="absolute bottom-2 inset-x-2 flex items-center justify-between pointer-events-none">
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-black/85 backdrop-blur-md text-slate-200 border border-white/10 shadow">
              ${yearDisplay}
            </span>
            ${item.tag ? `
              <span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/90 text-white shadow backdrop-blur-md">
                ${escapeHtml(item.tag)}
              </span>
            ` : ''}
          </div>

          <!-- Hover Play Overlay (Streaming Platform Style) -->
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <div class="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/50 transform scale-75 group-hover:scale-100 transition-transform">
              <svg class="w-6 h-6 fill-current ml-0.5" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="p-3 flex flex-col justify-between flex-1 gap-2">
          <div>
            <h3 class="font-bold text-sm text-slate-100 group-hover:text-amber-400 transition-colors line-clamp-1">
              ${safeTitle}
            </h3>
            <div class="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-medium">
              <span>${isMovie ? 'Feature Film' : 'TV Series'}</span>
              <span>•</span>
              <span class="text-slate-300">${yearDisplay}</span>
            </div>
          </div>

          <button
            data-action="open-details" data-subject-id="${escapeHtml(item.subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}"
            class="w-full py-1.5 px-3 text-xs font-semibold rounded-lg bg-[#211d19] group-hover:bg-amber-600/90 text-slate-200 group-hover:text-white border border-[#2f2924] group-hover:border-amber-500 transition-all flex items-center justify-center gap-1.5"
          >
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
            </svg>
            <span>Watch Now</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

}

/**
 * 3. loadDetails(id, provider)
 * Calls GET /api/details/:id?provider=<provider>
 */
async function loadDetails(id, provider = 'addon') {
  const url = `/api/details/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch details (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * 4. showDetails(movie)
 */
function showDetails(movie) {
  activeMedia = movie;
  const isSeries = movie.type === 'series' || movie.type === 'tv' || movie.isSeries || (Array.isArray(movie.seasons) && movie.seasons.length > 0);

  if (seriesAudioSelect) {
    seriesAudioSelect.value = 'all';
  }

  if (seriesSeasonSelect) {
    const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];
    let seasonOpts = '<option value="all">All Seasons</option>';
    for (const s of seasons) {
      const sNum = getSeasonNumberFromValue(s) ?? 1;
      const sTitle = getSeasonLabel(s);
      seasonOpts += `<option value="${escapeHtml(String(sNum))}">${escapeHtml(sTitle)}</option>`;
    }
    seriesSeasonSelect.innerHTML = seasonOpts;
    seriesSeasonSelect.value = 'all';
  }

  modalTitle.textContent = movie.title || 'Untitled';
  modalSubjectId.textContent = `ID: ${movie.subjectId}`;
  modalPoster.src = movie.poster || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" fill="%23111726"><rect width="300" height="450"/><text x="50%" y="50%" fill="%2364748b" font-family="sans-serif" font-size="16" text-anchor="middle">No Poster</text></svg>';

  // Provider badge
  const provKey = movie.provider || 'addon';
  const meta = providerStyles[provKey] || { label: movie.providerDisplayName || provKey, badgeClass: 'bg-slate-700 text-slate-300' };
  modalProviderBadge.textContent = meta.label;
  modalProviderBadge.className = `text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded border ${meta.badgeClass}`;

  // Type badge
  modalTypeBadge.textContent = isSeries ? 'Series' : 'Movie';
  modalTypeBadge.className = `text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded ${isSeries ? 'badge-series' : 'badge-movie'}`;

  // Year & Duration
  modalYear.textContent = movie.year ? `${movie.year}` : 'Release N/A';
  modalDuration.textContent = movie.duration || (isSeries ? 'Multi-Episode' : 'N/A');

  // Rating
  if (movie.rating) {
    modalRating.textContent = `IMDb ${movie.rating}`;
    modalRatingBadge.classList.remove('hidden');
  } else {
    modalRatingBadge.classList.add('hidden');
  }

  // Genres
  if (movie.genres && movie.genres.length > 0) {
    modalGenres.innerHTML = movie.genres.map(g =>
      `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#211d19] text-slate-300 border border-[#2f2924]">${escapeHtml(g)}</span>`
    ).join('');
    modalGenres.classList.remove('hidden');
  } else {
    modalGenres.classList.add('hidden');
  }

  // Description
  modalDescription.textContent = movie.description || 'No overview provided for this title.';

  // Series Season & Episode Hierarchy
  if (isSeries) {
    seriesHierarchySection.classList.remove('hidden');
    renderSeriesHierarchy(movie);
  } else {
    seriesHierarchySection.classList.add('hidden');
  }

  // Reset video player and streams view
  closeVideoPlayer();
  streamsSection.classList.add('hidden');
  streamsList.innerHTML = '';

  // Update watchlist button state for this media
  updateModalWatchlistBtnState();

  // Show Modal — use style.display directly; Tailwind class toggling can be
  // unreliable when 'hidden' (!important) and 'flex' classes coexist.
  detailsModal.classList.remove('hidden');
  detailsModal.style.display = 'flex';
}

/**
 * Render Series Hierarchy
 */
function renderSeriesHierarchy(series) {
  const seasons = Array.isArray(series.seasons) ? series.seasons : [];
  const selectedAudio = seriesAudioSelect ? String(seriesAudioSelect.value || 'english').toLowerCase() : 'english';
  const selectedSeason = seriesSeasonSelect ? String(seriesSeasonSelect.value || 'all') : 'all';

  if (seasons.length === 0) {
    seriesSeasonsList.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No episode links are available for this series.</p>';
    return;
  }

  const renderedSeasonsHtml = [];

  for (const s of seasons) {
    const seasonNumber = getSeasonNumberFromValue(s);
    // If season filter is selected and does not match, skip
    if (selectedSeason !== 'all' && String(seasonNumber ?? s.seasonNumber ?? 1) !== selectedSeason) {
      continue;
    }

    const episodes = Array.isArray(s.episodes) ? s.episodes : [];
    const filteredEpisodes = filterSeriesEpisodesForAudio(episodes, selectedAudio);

    // CRITICAL: If no playable episodes match this season for the selected audio, DO NOT RENDER THIS SEASON!
    if (filteredEpisodes.length === 0) continue;

    const episodesHtml = filteredEpisodes.map((episode, idx) => {
      const epNum = getEpisodeDisplayNumber(episode, idx);
      const targetId = episode.streamId || episode.link || series.subjectId;
      const audioLabel = getEpisodeAudioLabel(episode) || 'original';
      const audioBadge = `<span class="text-[10px] uppercase tracking-wide text-amber-400 font-mono font-bold">${escapeHtml(audioLabel)}</span>`;

      return `
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#0c0b0a] border border-[#2f2924] text-xs hover:border-slate-500 transition gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-[11px] flex items-center justify-center font-bold shrink-0">
              ${epNum}
            </span>
            <div class="min-w-0">
              <div class="text-slate-200 font-semibold truncate">${escapeHtml(episode.title || `Episode ${epNum}`)}</div>
              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>Audio:</span>
                ${audioBadge}
              </div>
            </div>
          </div>
          <button
            data-action="load-streams"
            data-stream-id="${escapeHtml(targetId)}"
            data-provider="${escapeHtml(series.provider || 'addon')}"
            data-ep-title="${escapeHtml(series.title)}"
            data-season="${s.seasonNumber || 1}"
            data-episode="${epNum}"
            class="text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-[#211d19] hover:bg-amber-600 text-slate-200 hover:text-white transition shrink-0 font-bold"
          >
            Find Play / Download
          </button>
        </div>
      `;
    }).join('');

    const seasonLabel = getSeasonLabel(s);

    renderedSeasonsHtml.push(`
      <div class="border border-[#2f2924] rounded-xl p-3 bg-[#161412] space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 font-bold text-sm text-slate-200">
            <svg class="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>${escapeHtml(seasonLabel)}</span>
          </div>
          <span class="text-xs font-mono text-slate-400">${filteredEpisodes.length} Episode${filteredEpisodes.length === 1 ? '' : 's'}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          ${episodesHtml}
        </div>
      </div>
    `);
  }

  if (renderedSeasonsHtml.length === 0) {
    const audioName = selectedAudio === 'all' ? 'English, Hindi, or Original' : selectedAudio.charAt(0).toUpperCase() + selectedAudio.slice(1);
    seriesSeasonsList.innerHTML = `
      <div class="py-6 px-4 text-center rounded-xl bg-[#161412] border border-[#2f2924] space-y-1">
        <p class="text-xs text-slate-300 font-semibold">No episodes found for ${escapeHtml(audioName)} audio.</p>
        <p class="text-[11px] text-slate-500">Supported audio languages: English, Hindi, and Original Audio.</p>
      </div>
    `;
    return;
  }

  seriesSeasonsList.innerHTML = renderedSeasonsHtml.join('');

  // Event delegation for episode "Find Play / Download" buttons.
  seriesSeasonsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="load-streams"]');
    if (!btn) return;
    const { streamId, provider: prov, epTitle, season, episode } = btn.dataset;
    loadStreams(streamId, prov, {
      title: epTitle,
      season: parseInt(season, 10),
      episode: parseInt(episode, 10),
    });
  }, { once: true }); // re-bound on each renderSeriesHierarchy call
}

/**
 * 5. loadStreams(id, provider)
 * Calls GET /api/streams/:id?provider=<provider>
 */
async function loadStreams(id, provider = 'addon', episodeContext = null) {
  // Remember which media these streams belong to (used for auto-fallback on failure)
  activeStreamContext = { id, provider };
  autoSwitchTried = false;
  streamsSection.classList.remove('hidden');
  streamsLoading.classList.remove('hidden');
  streamsList.innerHTML = '';
  streamsCountBadge.textContent = 'Querying releases...';
  streamsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    // minSources=1: server automatically switches to other providers if this one
    // is unavailable or returns no sources (works for play AND download links).
    const isEpisodeLookup = episodeContext && provider === 'addon';
    const normalizedTitle = String(episodeContext?.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sourceCandidates = isEpisodeLookup
      ? currentResults.filter((item) => {
        const candidateTitle = String(item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return item.provider !== 'addon' && item.type === 'series' && candidateTitle.includes(normalizedTitle);
      }).map(({ provider: candidateProvider, subjectId, title: candidateTitle }) => ({
        provider: candidateProvider,
        subjectId,
        title: candidateTitle,
        type: 'series',
      })).slice(0, 20)
      : [];

    const titleParam = activeMedia?.title ? `&title=${encodeURIComponent(activeMedia.title)}` : '';
    const yearParam = activeMedia?.year ? `&year=${encodeURIComponent(activeMedia.year)}` : '';
    const typeParam = activeMedia?.type ? `&type=${encodeURIComponent(activeMedia.type)}` : '';
    const altSources = activeMedia?.alternateSources || [];
    const altParam = altSources.length > 0 ? `&alternateSources=${encodeURIComponent(JSON.stringify(altSources))}` : '';

    const url = isEpisodeLookup
      ? '/api/episode-streams'
      : `/api/streams/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}&minSources=1${titleParam}${yearParam}${typeParam}${altParam}`;
    const response = await fetch(url, isEpisodeLookup ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...episodeContext, candidates: sourceCandidates }),
    } : undefined);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const releases = data.releases || [];
    if (data.provider && (data.streamId || data.subjectId)) {
      activeStreamContext = { id: data.streamId || data.subjectId, provider: data.provider };
    }

    streamsLoading.classList.add('hidden');
    const hasSwitched = releases.some((r) => r.switchedFrom);
    if (hasSwitched) {
      const switchedItem = releases.find((r) => r.switchedFrom);
      streamsCountBadge.textContent = `${releases.length} available release${releases.length === 1 ? '' : 's'} • Auto-switched to ${switchedItem.provider}`;
    } else {
      streamsCountBadge.textContent = `${releases.length} available release${releases.length === 1 ? '' : 's'}`;
    }

    if (releases.length === 0) {
      streamsList.innerHTML = `
        <div class="p-6 bg-[#0c0b0a] rounded-xl border border-dashed border-[#2f2924] text-center space-y-2">
          <p class="text-sm font-semibold text-slate-400">No active streaming sources currently found for this title.</p>
          <p class="text-xs text-slate-500">You may switch providers in the streaming hub bar to find alternative mirrors.</p>
        </div>
      `;
      return;
    }

    const switchBanner = hasSwitched ? `
      <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2 mb-3">
        <svg class="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>Default stream was unavailable. Automatically switched to <strong>${escapeHtml(releases[0].provider)}</strong> for high-speed direct playback and download!</span>
      </div>
    ` : '';

    // Store mirror payloads keyed by a DOM-safe index so we never serialize URLs
    // or arbitrary data into HTML attributes (prevents attribute-injection XSS).
    // Event delegation on streamsList picks these up via data-mirror-index.
    const mirrorStore = [];

    streamsList.innerHTML = switchBanner + releases.map((r) => {
      const mirrors = r.mirrors || [];
      const primaryMirror = mirrors[0];
      const hasDirectUrl = primaryMirror && primaryMirror.resolverUrl;
      const sizeFormatted = r.sizeBytes ? `${(r.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB` : null;
      const mediaExt = /\.(mp4|m3u8|mkv|webm|ts)([?&]|$)/i.test(primaryMirror?.resolverUrl || '') ? '' : '.mp4';
      const primaryFilename = encodeURIComponent(((activeMedia?.title || 'video') + '-' + (r.quality || 'HD')).replace(/[^a-zA-Z0-9_-]/g, '_') + mediaExt);
      const primaryHeadersParam = primaryMirror?.headers ? '&headers=' + encodeURIComponent(JSON.stringify(primaryMirror.headers)) : '';
      const primaryDownloadHref = `/api/download?url=${encodeURIComponent(primaryMirror?.resolverUrl || '')}&filename=${primaryFilename}${primaryMirror?.signCookie ? '&cookie=' + encodeURIComponent(primaryMirror.signCookie) : ''}${primaryHeadersParam}`;
      const primaryPlayTitle = `${(activeMedia?.title || 'Video')} - ${r.quality || 'Stream'}`;

      // Register primary mirror in the store
      const primaryIdx = mirrorStore.length;
      mirrorStore.push({ url: primaryMirror?.resolverUrl || '', title: primaryPlayTitle, cookie: primaryMirror?.signCookie || '', headers: primaryMirror?.headers || null });

      return `
        <div class="release-card space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                ${r.quality || 'Standard'}
              </span>
              <span class="text-xs font-mono text-emerald-400 uppercase bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">
                ${escapeHtml(r.provider || provider)}
              </span>
              ${r.codec ? `<span class="text-xs font-mono text-slate-400 uppercase bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">${r.codec}</span>` : ''}
              ${sizeFormatted ? `<span class="text-xs font-mono text-cyan-300">${sizeFormatted}</span>` : ''}
              ${r.language ? `<span class="text-xs text-slate-300 bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">${r.language}</span>` : ''}
            </div>

            ${hasDirectUrl ? `
              <div class="flex items-center gap-2">
                <button
                  data-action="play-stream"
                  data-mirror-index="${primaryIdx}"
                  class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                >
                  <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                  </svg>
                  <span>Play</span>
                </button>

                <a
                  href="${primaryDownloadHref}"
                  download
                  class="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-xs font-semibold flex items-center gap-1.5 transition"
                  title="Download stream file"
                >
                  <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download</span>
                </a>
              </div>
            ` : ''}
          </div>

          <div class="border-t border-[#2f2924] pt-2.5 space-y-2">
            <span class="text-[11px] text-slate-400 font-medium">Available Mirrors & Formats (${mirrors.length}):</span>
            <div class="flex flex-col gap-1.5">
              ${mirrors.map((m) => {
                const mExt = /\.(mp4|m3u8|mkv|webm|ts)([?&]|$)/i.test(m.resolverUrl || '') ? '' : '.mp4';
                const mFilename = encodeURIComponent(((activeMedia?.title || 'video') + '-' + (m.label || 'mirror')).replace(/[^a-zA-Z0-9_-]/g, '_') + mExt);
                const mHeadersParam = m.headers ? '&headers=' + encodeURIComponent(JSON.stringify(m.headers)) : '';
                const mDownloadHref = `/api/download?url=${encodeURIComponent(m.resolverUrl)}&filename=${mFilename}${m.signCookie ? '&cookie=' + encodeURIComponent(m.signCookie) : ''}${mHeadersParam}`;
                const mPlayTitle = `${(activeMedia?.title || 'Video')} - ${m.label}`;
                const mIdx = mirrorStore.length;
                mirrorStore.push({ url: m.resolverUrl, title: mPlayTitle, cookie: m.signCookie || '', headers: m.headers || null });
                return `
                <div class="p-2 rounded-lg bg-[#0c0b0a] border border-[#2f2924] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full ${m.directFile ? 'bg-emerald-400' : (m.isDash ? 'bg-indigo-400' : 'bg-amber-400')}"></span>
                    <span class="text-slate-200 font-medium">${escapeHtml(m.label)}</span>
                    ${m.isDash ? `<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300">DASH HEVC</span>` : ''}
                  </div>

                  <div class="flex items-center gap-1.5">
                    <button
                      data-action="play-stream"
                      data-mirror-index="${mIdx}"
                      class="px-2.5 py-1 rounded bg-[#211d19] hover:bg-amber-600 text-slate-200 hover:text-white font-mono text-[11px] transition flex items-center gap-1"
                    >
                      <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                      </svg>
                      <span>Play</span>
                    </button>
                    <a
                      href="${mDownloadHref}"
                      download
                      class="px-2.5 py-1 rounded bg-emerald-950/50 hover:bg-emerald-900/80 text-emerald-300 font-mono text-[11px] border border-emerald-800/70 transition flex items-center gap-1"
                      title="Direct download file"
                    >
                      <svg class="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Download</span>
                    </a>
                    <button
                      data-action="copy-url"
                      data-mirror-index="${mIdx}"
                      class="px-2.5 py-1 rounded bg-[#161412] hover:bg-[#1f2c4a] text-slate-300 font-mono text-[11px] border border-[#2f2924] transition"
                      title="Copy URL for VLC / external players"
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
              `; }).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Store mirror payloads in global store for reliable play/copy events
    globalMirrorStore = mirrorStore;
  } catch (err) {
    streamsLoading.classList.add('hidden');
    streamsList.innerHTML = `
      <div class="p-4 bg-red-950/40 rounded-xl border border-red-800 text-red-300 text-xs">
        Failed to fetch streaming sources: ${err.message}
      </div>
    `;
  }
}

/**
 * Embedded Video Player Controller
 */
/**
 * Destroy any active hls.js instance and detach it from the video element.
 */
function destroyHls() {
  if (hlsPlayerInstance) {
    hlsPlayerInstance.destroy();
    hlsPlayerInstance = null;
  }
}

function buildProxyUrl(url, cookie, headers) {
  let proxy = `/api/proxy-video?url=${encodeURIComponent(url)}`;
  if (cookie) proxy += `&cookie=${encodeURIComponent(cookie)}`;
  if (headers && typeof headers === 'object' && Object.keys(headers).length > 0) {
    proxy += `&headers=${encodeURIComponent(JSON.stringify(headers))}`;
  }
  return proxy;
}

function playStreamSource(rawUrl, title, cookie = '', forceProxy = false, streamHeaders = null) {
  if (!rawUrl) return;

  // Always destroy any previous hls.js instance before loading a new source.
  destroyHls();

  // Normalize protocol-relative URLs (e.g. //host/path) that some mirrors return
  let url = String(rawUrl).trim();
  if (url.startsWith('//')) url = 'https:' + url;

  currentPlayback.rawUrl = url;
  currentPlayback.title = title;
  currentPlayback.cookie = cookie;
  currentPlayback.headers = streamHeaders;
  // When forceProxy is explicitly true, always use the proxy.
  // When forceProxy is false AND allowDirect has been toggled on by the user,
  // honour direct mode — otherwise default to proxied (CORS safety net).
  if (forceProxy) {
    currentPlayback.isProxied = true;
    currentPlayback.allowDirect = false;
  } else if (currentPlayback.allowDirect) {
    currentPlayback.isProxied = false;
  } else {
    currentPlayback.isProxied = true;
  }

  activeStreamTitle.textContent = title;
  updatePlayerMode();

  // Record playback in persistent watch history
  if (activeMedia) {
    recordPlayHistory(activeMedia, {
      title,
      season: activeStreamContext?.season,
      episode: activeStreamContext?.episode,
    });
  }

  playerContainer.classList.remove('hidden');
  playerContainer.style.display = 'block';
  playerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // ── HLS / M3U8 branch ────────────────────────────────────────────────────
  // Route through /api/proxy-hls so relative segment URLs are rewritten and
  // CORS is handled server-side. Wire Hls.Events.ERROR for fatal network
  // failures so the player auto-switches to another provider mirror.
  if (/\.m3u8(\?|#|$)/i.test(url)) {
    const hlsProxyUrl = `/api/proxy-hls?url=${encodeURIComponent(url)}${cookie ? '&cookie=' + encodeURIComponent(cookie) : ''}`;

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ startLevel: -1 }); // -1 = auto quality
      hlsPlayerInstance = hls;
      hls.loadSource(hlsProxyUrl);
      hls.attachMedia(videoPlayer);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoPlayer.play().catch((e) => console.warn('HLS play() blocked:', e?.name));
      });

      // A4 fix: wire HLS fatal network errors to the same auto-switch path
      // that the plain <video> onerror uses. Non-fatal errors are ignored —
      // hls.js recovers from them internally.
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        console.warn(`HLS fatal error: type=${data.type} details=${data.details}`);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!autoSwitchTried && activeStreamContext.id) {
            autoSwitchTried = true;
            showError('HLS source failed — switching to another provider...');
            autoSwitchToWorkingSource(url);
          } else {
            hls.startLoad(); // try one internal recovery first
            showError('HLS network error — check your connection or try another mirror.');
          }
        } else {
          // Media / other fatal error — nothing hls.js can do, surface to user
          showError('HLS playback error — the stream format may be unsupported. Try another mirror.');
        }
      });

    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS) — point directly at the proxy URL
      videoPlayer.src = hlsProxyUrl;
      videoPlayer.load();
      videoPlayer.play().catch((e) => console.warn('Native HLS play() blocked:', e?.name));
    } else {
      // No HLS support at all — fall back to opening externally
      window.open(url, '_blank');
    }

    // Setup utility buttons for HLS streams too
    if (openStreamNewTab) openStreamNewTab.href = url;
    if (downloadPlayerStream) {
      const filename = encodeURIComponent((title || 'stream').replace(/[^a-zA-Z0-9_-]/g, '_') + '.m3u8');
      downloadPlayerStream.href = `/api/download?url=${encodeURIComponent(url)}&filename=${filename}`;
      downloadPlayerStream.setAttribute('download', filename);
    }
    return; // HLS path handled — skip the regular video setup below
  }
  // ── End HLS branch ───────────────────────────────────────────────────────

  const effectiveUrl = currentPlayback.isProxied
    ? buildProxyUrl(url, cookie, streamHeaders)
    : url;

  videoPlayer.src = effectiveUrl;
  videoPlayer.load();

  const playPromise = videoPlayer.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((err) => {
      // Autoplay with sound can be blocked by browser policy (NotAllowedError) —
      // that's fine, the user can press play. Surface real media errors below.
      console.warn('play() rejected:', err && err.name);
    });
  }

  // Surface actual playback errors (bad URL, 4xx/5xx from CDN, unsupported codec).
  // Debounced: browsers can fire the error event multiple times for the same bad
  // source (e.g. network retries), and calling playStreamSource() from inside
  // onerror itself triggers a new src assignment which fires onerror again before
  // the new source loads — causing an infinite loop without the guard below.
  let _errorHandled = false;
  videoPlayer.onerror = () => {
    if (_errorHandled) return;
    _errorHandled = true;
    // Re-arm on next playStreamSource call (onerror is reassigned each time).

    const err = videoPlayer.error;
    const codeMap = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'UNSUPPORTED_SOURCE (URL expired or format not playable)' };
    const code = err ? (codeMap[err.code] || 'UNKNOWN') : 'UNKNOWN';
    if (!currentPlayback.isProxied) {
      // Direct mode failed → fall back to proxy automatically
      console.warn('Direct playback failed, falling back to server-side stream proxy...');
      playStreamSource(url, title, cookie, true, streamHeaders);
      return;
    }
    // Proxied playback failed. If we haven't already tried switching providers
    // for this media, ask the server to resolve a working source on ANY provider
    // and retry playback transparently.
    if (!autoSwitchTried && activeStreamContext.id) {
      autoSwitchTried = true;
      console.warn(`Playback failed (${code}). Trying another provider automatically...`);
      showError('Source unavailable — switching to another provider...');
      autoSwitchToWorkingSource(url);
    } else {
      showError(`Playback failed (${code}). The link may have expired — try "Check Sources" again or another mirror.`);
    }
  };

  // Setup download button
  if (downloadPlayerStream) {
    const extMatch = url.match(/\.(mp4|mkv|webm|m3u8|ts)(\?|$)/i);
    const filename = `${(title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_')}.${extMatch ? extMatch[1].toLowerCase() : 'mp4'}`;
    let dl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    if (cookie) dl += `&cookie=${encodeURIComponent(cookie)}`;
    if (streamHeaders) dl += `&headers=${encodeURIComponent(JSON.stringify(streamHeaders))}`;
    downloadPlayerStream.href = dl;
    downloadPlayerStream.setAttribute('download', filename);
  }

  // Setup external link
  if (openStreamNewTab) {
    openStreamNewTab.href = url;
  }
}

/**
 * Automatic provider switching for playback & download.
 * Asks the server to probe all providers for a working source of the active
 * media (skipping the URL that just failed), then retries playback with the
 * first healthy source found on another provider/mirror.
 */
async function autoSwitchToWorkingSource(failedUrl) {
  const { id, provider } = activeStreamContext;
  if (!id) return;

  try {
    const titleParam = activeMedia?.title ? `&title=${encodeURIComponent(activeMedia.title)}` : '';
    const yearParam = activeMedia?.year ? `&year=${encodeURIComponent(activeMedia.year)}` : '';
    const typeParam = activeMedia?.type ? `&type=${encodeURIComponent(activeMedia.type)}` : '';

    const res = await fetch(
      `/api/resolve-source?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider || 'movieBoxWeb')}${titleParam}${yearParam}${typeParam}`
    );
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

    const data = await res.json();
    const pool = [data.source, ...(data.alternatives || [])].filter(Boolean);
    // Pick the first candidate that isn't the URL we just tried
    const next = pool.find((c) => c.url !== failedUrl) || null;

    if (!next) {
      showError('No alternative provider has a working source for this title right now.');
      return;
    }

    hideError();
    console.log(`Auto-switched source to provider: ${next.provider || 'unknown'}`);
    playStreamSource(next.url, `${currentPlayback.title || activeMedia?.title || 'Video'} (${next.provider || 'alt provider'})`, next.cookie || '', true, next.headers || null);
  } catch (err) {
    showError('Provider switch failed: ' + err.message);
  }
}

function updatePlayerMode() {
  if (currentPlayback.isProxied) {
    playerModeBadge.textContent = 'Proxied Stream';
    playerModeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800';
    toggleProxyBtn.innerHTML = `
      <svg class="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
      <span>Switch to Direct Stream</span>
    `;
  } else {
    playerModeBadge.textContent = 'Direct Play';
    playerModeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800';
    toggleProxyBtn.innerHTML = `
      <svg class="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
      <span>Switch to Stream Proxy</span>
    `;
  }
}

function toggleStreamMode() {
  if (!currentPlayback.rawUrl) return;
  // Flip between proxied and direct playback modes.
  // Toggle: if we are proxied → go direct; if direct → go proxied.
  const goingDirect = currentPlayback.isProxied;
  currentPlayback.allowDirect = goingDirect;
  currentPlayback.isProxied = !goingDirect;
  playStreamSource(currentPlayback.rawUrl, currentPlayback.title, currentPlayback.cookie, !goingDirect, currentPlayback.headers);
}

function closeVideoPlayer() {
  destroyHls();
  if (videoPlayer) {
    videoPlayer.onerror = null;
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
  }
  if (playerContainer) {
    playerContainer.classList.add('hidden');
    playerContainer.style.display = 'none';
  }
}

/**
 * Copy to Clipboard Helper
 */
function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.textContent;
    btnElement.textContent = 'Copied!';
    setTimeout(() => {
      btnElement.textContent = originalText;
    }, 2000);
  }).catch(() => {
    prompt('Copy stream URL:', text);
  });
}

/**
 * Handle Card Click
 */
async function handleCardClick(subjectId, provider) {
  try {
    const details = await loadDetails(subjectId, provider);
    const item = currentResults.find((it) => it.subjectId === subjectId);
    if (item) {
      if (item.alternateSources) details.alternateSources = item.alternateSources;
      if (!details.title && item.title) details.title = item.title;
      if (!details.year && item.year) details.year = item.year;
      if (!details.poster && item.poster) details.poster = item.poster;
      if (!details.type && item.type) details.type = item.type;
    }
    showDetails(details);
  } catch (err) {
    showError('Failed to load title details: ' + err.message);
  }
}

/**
 * Loads the catalog homepage (trending/featured movies and series).
 * Calls GET /api/catalog/homepage
 */
async function loadCatalogHomepage(provider = selectedProvider, genre = activeGenre) {
  hideError();
  if (welcomeState) welcomeState.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsGrid.innerHTML = '';
  loadingState.classList.remove('hidden');

  const provLabel = providerStyles[provider]?.label || provider;
  resultsTitle.textContent = (provider === 'all' || !provider)
    ? 'Featured Catalog & Trending'
    : `${provLabel} • Catalog Homepage`;
  resultsCount.textContent = 'Loading catalog...';

  try {
    const provParam = provider && provider !== 'all' ? provider : 'movieBoxWeb';
    let url = `/api/catalog/homepage?provider=${encodeURIComponent(provParam)}`;
    if (genre) url += `&genre=${encodeURIComponent(genre)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to load catalog homepage: HTTP ${res.status}`);
    }
    const data = await res.json();
    const items = data.results || [];
    if (items.length > 0) {
      showSearchResults(items);
      resultsTitle.textContent = (provider === 'all' || !provider)
        ? 'Featured Catalog & Trending'
        : `${provLabel} • Catalog Homepage`;
    } else {
      await handleSearch('Inception');
    }
  } catch (err) {
    console.warn('Catalog homepage load fallback:', err.message);
    try {
      await handleSearch('Inception');
    } catch {
      showError(err.message || 'Failed to load catalog homepage');
    }
  } finally {
    loadingState.classList.add('hidden');
  }
}

/**
 * Perform Search Handler
 */
async function handleSearch(query) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return;

  hideError();
  if (welcomeState) welcomeState.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsGrid.innerHTML = '';
  loadingState.classList.remove('hidden');

  searchBtn.disabled = true;
  searchBtnText.textContent = 'Searching...';
  searchSpinner.classList.remove('hidden');
  resultsTitle.textContent = `Results for "${cleanQuery}"`;

  try {
    const data = await searchMovies(cleanQuery, selectedProvider, activeGenre);
    showSearchResults(data.results || []);
  } catch (err) {
    showError(err.message);
  } finally {
    loadingState.classList.add('hidden');
    searchBtn.disabled = false;
    searchBtnText.textContent = 'Search';
    searchSpinner.classList.add('hidden');
  }
}

/**
 * Fetch Session & Gateway Status
 */
async function fetchSessionStatus() {
  try {
    const res = await fetch('/api/session');
    if (res.ok) {
      const data = await res.json();
      if (data.currentHost && sessionHostBadge) {
        const u = new URL(data.currentHost);
        sessionHostBadge.textContent = `${u.hostname} (${data.tokenPreview || 'Auth OK'})`;
      }
    }
  } catch {
    if (sessionHostBadge) sessionHostBadge.textContent = 'Gateway offline';
  }
}

async function handleRotateHost() {
  try {
    if (rotateHostBtn) rotateHostBtn.disabled = true;
    const res = await fetch('/api/hosts/rotate', { method: 'POST' });
    if (res.ok) {
      await fetchSessionStatus();
      if (searchInput.value.trim()) {
        handleSearch(searchInput.value.trim());
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (rotateHostBtn) rotateHostBtn.disabled = false;
  }
}

/**
 * Filter change handler
 */
function setFilter(type) {
  activeFilter = type;
  [filterAllBtn, filterMoviesBtn, filterSeriesBtn].forEach(btn => btn?.classList.remove('active'));
  if (type === 'all') filterAllBtn?.classList.add('active');
  if (type === 'movie') filterMoviesBtn?.classList.add('active');
  if (type === 'series') filterSeriesBtn?.classList.add('active');
  showSearchResults(currentResults);
}

// Helpers
function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Safe for JS string literals inside HTML attributes (onclick="fn('...')")
function escapeQuotes(str) {
  const js = String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
  return escapeHtml(js); // browser decodes entities before running the JS
}

// Event Listeners
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) {
    handleSearch(q);
  } else {
    loadCatalogHomepage(selectedProvider);
  }
});

// Provider select change
providerSelect?.addEventListener('change', (e) => {
  selectedProvider = e.target.value;
  if (searchInput.value.trim()) {
    handleSearch(searchInput.value.trim());
  } else {
    loadCatalogHomepage(selectedProvider);
  }
});

// Results grid — card click and "Explore Details" button
// Placed here (outside showSearchResults) so it's set up exactly once.
// showSearchResults only replaces innerHTML inside the grid; the grid element
// itself and its listeners survive the DOM replacement.
resultsGrid.addEventListener('click', (e) => {
  const bookmarkBtn = e.target.closest('[data-action="toggle-card-watchlist"]');
  if (bookmarkBtn) {
    e.stopPropagation();
    const subjectId = bookmarkBtn.dataset.subjectId;
    const item = currentResults.find((it) => String(it.subjectId) === String(subjectId));
    if (item) {
      toggleWatchlistItem(item);
    }
    return;
  }

  const target = e.target.closest('[data-action="open-details"]');
  if (!target) return;
  const subjectId = target.dataset.subjectId;
  const provider = target.dataset.provider;
  if (subjectId && provider) handleCardClick(subjectId, provider);
});

// Filter buttons
filterAllBtn?.addEventListener('click', () => setFilter('all'));
filterMoviesBtn?.addEventListener('click', () => setFilter('movie'));
filterSeriesBtn?.addEventListener('click', () => setFilter('series'));

// Quick Suggestions
document.querySelectorAll('.quick-chip[data-query]').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.getAttribute('data-query');
    searchInput.value = q;
    handleSearch(q);
  });
});

// Modal close buttons
closeDetailsBtn.addEventListener('click', () => {
  detailsModal.classList.add('hidden');
  detailsModal.style.display = 'none';
  closeVideoPlayer();
});

detailsModal.addEventListener('click', (e) => {
  if (e.target === detailsModal) {
    detailsModal.classList.add('hidden');
    detailsModal.style.display = 'none';
    closeVideoPlayer();
  }
});

viewSourcesBtn.addEventListener('click', () => {
  if (activeMedia) {
    loadStreams(activeMedia.subjectId, activeMedia.provider || 'addon');
  }
});

// Streams list event delegation: handles Play and Copy URL buttons reliably
streamsList?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const idx = parseInt(btn.dataset.mirrorIndex, 10);
  const mirror = Number.isFinite(idx) ? globalMirrorStore[idx] : null;

  if (action === 'play-stream' && mirror && mirror.url) {
    playStreamSource(mirror.url, mirror.title, mirror.cookie, false, mirror.headers);
  } else if (action === 'copy-url' && mirror && mirror.url) {
    copyToClipboard(mirror.url, btn);
  }
});

closePlayerBtn.addEventListener('click', closeVideoPlayer);

// Player mode toggle
toggleProxyBtn?.addEventListener('click', toggleStreamMode);

// Copy active stream URL
copyStreamBtn?.addEventListener('click', () => {
  if (currentPlayback.rawUrl) {
    copyToClipboard(currentPlayback.rawUrl, copyStreamText);
  }
});

// Modal Watchlist Toggle
modalWatchlistBtn?.addEventListener('click', () => {
  if (activeMedia) {
    toggleWatchlistItem(activeMedia);
  }
});

// Library (Watchlist & History) Modal Controls
navLibraryBtn?.addEventListener('click', () => openLibraryModal('watchlist'));
closeLibraryBtn?.addEventListener('click', closeLibraryModal);
closeLibraryFooterBtn?.addEventListener('click', closeLibraryModal);
tabWatchlistBtn?.addEventListener('click', () => switchLibraryTab('watchlist'));
tabHistoryBtn?.addEventListener('click', () => switchLibraryTab('history'));
clearHistoryBtn?.addEventListener('click', () => clearAllHistory());

libraryModal?.addEventListener('click', (e) => {
  if (e.target === libraryModal) closeLibraryModal();

  const watchBtn = e.target.closest('[data-action="lib-watch-now"]');
  if (watchBtn) {
    const { subjectId, provider } = watchBtn.dataset;
    closeLibraryModal();
    if (subjectId && provider) handleCardClick(subjectId, provider);
    return;
  }

  const removeWatchlistBtn = e.target.closest('[data-action="lib-remove-watchlist"]');
  if (removeWatchlistBtn) {
    removeWatchlistItem(removeWatchlistBtn.dataset.subjectId);
    return;
  }

  const removeHistoryBtn = e.target.closest('[data-action="lib-remove-history"]');
  if (removeHistoryBtn) {
    removeHistoryItem(removeHistoryBtn.dataset.subjectId);
    return;
  }

  const detailLink = e.target.closest('[data-action="open-details"]');
  if (detailLink) {
    const { subjectId, provider } = detailLink.dataset;
    closeLibraryModal();
    if (subjectId && provider) handleCardClick(subjectId, provider);
    return;
  }
});

// Update Active Provider UI across badges and channels
function updateProviderUI(provId, provName) {
  if (navActiveProviderBadge) {
    if (provId === 'all') {
      navActiveProviderBadge.textContent = 'All Providers';
    } else {
      const match = allProvidersList.find((p) => p.id === provId);
      navActiveProviderBadge.textContent = match ? match.name : (provName || provId);
    }
  }

  // Sync top channels bar if applicable
  if (topChannelsBar) {
    topChannelsBar.querySelectorAll('.channel-card').forEach((b) => {
      if (b.dataset.provider === provId) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }

  if (providerSelect) {
    providerSelect.value = provId;
  }

  renderProvidersModalList();
}

// Select a provider and refresh view
function selectProvider(provId, provName) {
  selectedProvider = provId;
  updateProviderUI(provId, provName);
  closeProvidersModal();

  const currentQuery = searchInput.value.trim();
  if (currentQuery) {
    handleSearch(currentQuery);
  } else {
    loadCatalogHomepage(provId);
  }
}

// Render Providers Modal Grid with Search & Category Filters
function renderProvidersModalList() {
  if (!providersModalList) return;
  const q = (providersSearchInput?.value || '').toLowerCase().trim();

  let filtered = allProvidersList;
  if (activeModalCategory !== 'all') {
    filtered = filtered.filter((p) => (p.category || '').toLowerCase() === activeModalCategory.toLowerCase());
  }
  if (q) {
    filtered = filtered.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.id || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.tagline || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    providersModalList.innerHTML = `
      <div class="col-span-full py-12 text-center space-y-2">
        <p class="text-slate-400 text-xs">No providers matching "${escapeHtml(q)}"</p>
        <button id="btnClearModalSearch" class="text-xs text-amber-400 hover:underline">Clear Search</button>
      </div>
    `;
    document.getElementById('btnClearModalSearch')?.addEventListener('click', () => {
      if (providersSearchInput) providersSearchInput.value = '';
      renderProvidersModalList();
    });
    return;
  }

  providersModalList.innerHTML = filtered.map((p) => {
    const isSelected = selectedProvider === p.id;
    return `
      <div
        data-provider-id="${escapeHtml(p.id)}"
        data-provider-name="${escapeHtml(p.name)}"
        class="provider-modal-card p-3 rounded-xl border ${isSelected ? 'border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/50' : 'border-[#2f2924] bg-[#161412] hover:border-[#423a33] hover:bg-[#1f1b17]'} cursor-pointer transition flex items-center justify-between gap-2.5 group"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-white group-hover:text-amber-400 transition truncate">${escapeHtml(p.name)}</span>
            ${isSelected ? '<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500 text-black font-extrabold uppercase">Active</span>' : ''}
          </div>
          <p class="text-[10px] text-slate-400 truncate mt-0.5">${escapeHtml(p.tagline || p.category || 'Streaming provider')}</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[9px] font-mono text-slate-500 uppercase">${escapeHtml(p.type || 'source')}</span>
            <span class="text-slate-600">•</span>
            <span class="text-[9px] text-amber-400/80 font-mono truncate">${escapeHtml(p.category || 'General')}</span>
          </div>
        </div>
        <div class="shrink-0">
          <span class="inline-flex items-center justify-center px-2.5 py-1 text-[11px] font-bold rounded-lg ${isSelected ? 'bg-amber-500 text-black' : 'bg-[#211d19] group-hover:bg-amber-600 text-slate-200 group-hover:text-white border border-[#2f2924]'} transition">
            ${isSelected ? 'Selected' : 'Use'}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// Modal open/close helpers
function openProvidersModal() {
  if (!providersModal) return;
  providersModal.classList.remove('hidden');
  providersModal.style.display = 'flex';
  renderProvidersModalList();
  setTimeout(() => providersSearchInput?.focus(), 80);
}

function closeProvidersModal() {
  if (!providersModal) return;
  providersModal.classList.add('hidden');
  providersModal.style.display = 'none';
}

// Load and populate all 50+ providers data
async function loadProvidersDropdown() {
  try {
    const res = await fetch('/api/providers');
    if (!res.ok) return;
    const data = await res.json();
    const providers = data.providers || [];
    allProvidersList = providers;

    if (providersModalCount) {
      providersModalCount.textContent = `${providers.length} Providers`;
    }

    // Group by category
    const groups = {};
    for (const p of providers) {
      const cat = p.category || 'Other Providers';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }

    if (providerSelect) {
      let html = `<option value="all" class="bg-[#161412] text-white">⚡ Unified Search (${providers.length} Providers)</option>`;
      const orderedCategories = [
        'Featured Streaming',
        'Native',
        'Vega English',
        'Vega Global',
        'Vega Anime',
        'Vega Regional (India)',
        'BDIX & Local',
        'Vega Regional',
      ];

      for (const cat of orderedCategories) {
        if (groups[cat] && groups[cat].length > 0) {
          html += `<optgroup label="── ${cat} ──" class="bg-[#161412] text-amber-400 font-bold">`;
          for (const p of groups[cat]) {
            html += `<option value="${escapeQuotes(p.id)}" class="bg-[#161412] text-white">${escapeHtml(p.name)} (${p.type || 'scraper'})</option>`;
          }
          html += `</optgroup>`;
        }
      }

      for (const [cat, list] of Object.entries(groups)) {
        if (!orderedCategories.includes(cat) && list.length > 0) {
          html += `<optgroup label="── ${cat} ──" class="bg-[#161412] text-amber-400 font-bold">`;
          for (const p of list) {
            html += `<option value="${escapeQuotes(p.id)}" class="bg-[#161412] text-white">${escapeHtml(p.name)}</option>`;
          }
          html += `</optgroup>`;
        }
      }

      providerSelect.innerHTML = html;
      providerSelect.value = selectedProvider;
    }

    updateProviderUI(selectedProvider);
  } catch (err) {
    console.warn('Failed to load providers list:', err);
  }
}

// Navigation event listeners
navHomeBtn?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  hideSearchHero();
  if (searchInput) searchInput.value = '';
  activeGenre = null;
  loadCatalogHomepage(selectedProvider);
});

navSearchBtn?.addEventListener('click', () => {
  showSearchHero();
  searchForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  searchInput?.focus();
  searchInput?.select();
});

navProvidersBtn?.addEventListener('click', () => {
  openProvidersModal();
});

closeProvidersBtn?.addEventListener('click', closeProvidersModal);
closeProvidersFooterBtn?.addEventListener('click', closeProvidersModal);

providersModal?.addEventListener('click', (e) => {
  if (e.target === providersModal) closeProvidersModal();
});

btnUnifiedAll?.addEventListener('click', () => {
  selectProvider('all', 'All Providers');
});

providersSearchInput?.addEventListener('input', () => {
  renderProvidersModalList();
});

providerCategoryPills?.addEventListener('click', (e) => {
  const btn = e.target.closest('.quick-chip');
  if (!btn) return;
  providerCategoryPills.querySelectorAll('.quick-chip').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  activeModalCategory = btn.dataset.category || 'all';
  renderProvidersModalList();
});

providersModalList?.addEventListener('click', (e) => {
  const card = e.target.closest('.provider-modal-card');
  if (!card) return;
  const pId = card.dataset.providerId;
  const pName = card.dataset.providerName;
  if (pId) selectProvider(pId, pName);
});

// Top streaming hub channels switcher
const topChannelsBar = document.getElementById('topChannelsBar');
topChannelsBar?.addEventListener('click', (e) => {
  const btn = e.target.closest('.channel-card');
  if (!btn) return;

  topChannelsBar.querySelectorAll('.channel-card').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  const prov = btn.dataset.provider || 'all';
  const g = btn.dataset.genre || null;
  selectedProvider = prov;
  activeGenre = g;
  updateProviderUI(prov, btn.dataset.name);

  const currentQuery = searchInput.value.trim();
  if (currentQuery) {
    handleSearch(currentQuery);
  } else {
    loadCatalogHomepage(prov, g);
  }
});

// Host rotation (if present)
rotateHostBtn?.addEventListener('click', handleRotateHost);

// Brand Home Button click returns to catalog homepage
document.getElementById('brandHomeBtn')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  hideSearchHero();
  if (searchInput) searchInput.value = '';
  activeGenre = null;
  loadCatalogHomepage(selectedProvider);
});

// Initialize gateway status, dynamic providers, and library badges
fetchSessionStatus();
loadProvidersDropdown();
updateWatchlistBadges();
updateHistoryBadges();

// Initial load: show featured catalog homepage from default MovieBox Web
loadCatalogHomepage(selectedProvider);

// Keyboard shortcuts: "/" focuses search, Esc closes details, providers, or library modal
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (e.key === 'Escape') {
    if (libraryModal && !libraryModal.classList.contains('hidden')) {
      closeLibraryModal();
    } else if (providersModal && !providersModal.classList.contains('hidden')) {
      closeProvidersModal();
    } else if (detailsModal && !detailsModal.classList.contains('hidden')) {
      closeDetailsBtn.click();
    }
  }
});

})(); // end IIFE — closes (function () { 'use strict'; ... })()
