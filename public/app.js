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
let resultPage = 1;
let resultContext = { kind: 'catalog', query: '', provider: 'movieBoxWeb', genre: null };
let loadingMoreResults = false;

let currentPlayback = {
  rawUrl: '',
  title: '',
  cookie: '',
  headers: null,
  streamType: '',
  subtitles: [],
  isProxied: true,
  allowDirect: false,
  historyId: null,
};
let pendingResumeSeconds = 0;
let lastProgressSavedAt = 0;

// Active hls.js instance (if any). Destroyed before each new source load.
let hlsPlayerInstance = null;
let hlsStartupTimer = null;
// Tracks which media/provider the currently displayed streams came from, so a
// failed playback can automatically re-resolve sources from another provider.
let activeStreamContext = { id: '', provider: 'addon' };

let autoSwitchResolutionTried = false;
let autoSwitchResolutionPending = false;
let autoSwitchGeneration = 0;
let autoSwitchCandidates = [];
let autoSwitchBaseTitle = '';
let autoSwitchController = null;

function cancelAutoSwitchResolution() {
  autoSwitchController?.abort();
  autoSwitchController = null;
  autoSwitchResolutionPending = false;
}

// ── Download manager state (Vega-inspired) ──────────────────────────────
let downloads = [];          // array of download records from the server
let downloadsPollTimer = null; // polls progress while the Downloads tab is open

// DOM Elements
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchBtnText = document.getElementById('searchBtnText');
const searchSpinner = document.getElementById('searchSpinner');
const searchSuggestionsDropdown = document.getElementById('searchSuggestionsDropdown');
const dismissErrorBtn = document.getElementById('dismissErrorBtn');
const heroSearchSection = document.getElementById('heroSearchSection');

const POSTER_FALLBACK = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450' fill='#111726'><rect width='300' height='450'/><text x='50%' y='50%' fill='#64748b' font-family='sans-serif' font-size='16' text-anchor='middle'>No Poster</text></svg>"
)}`;

/** Resolve an image URL, allowing only image data/http(s) URLs. */
function normalizeImageUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'data:' && /^data:image\//i.test(parsed.href)) return parsed.href;
  } catch {
    // Invalid URLs use the fallback.
  }
  return fallback;
}

/** Escape an image URL for an HTML attribute. */
function safeImageUrl(value, fallback = '') {
  return escapeHtml(normalizeImageUrl(value, fallback));
}

let toastTimer = null;
function showToast(message, kind = 'info') {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = String(message || '');
  toast.classList.toggle('app-toast-error', kind === 'error');
  toast.classList.add('app-toast-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('app-toast-visible'), 3200);
}

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
const emptyState = document.getElementById('emptyState');
const emptyStateTitle = document.getElementById('emptyStateTitle');
const emptyStateMessage = document.getElementById('emptyStateMessage');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const resultsCount = document.getElementById('resultsCount');
const resultsTitle = document.getElementById('resultsTitle');
const filterAllBtn = document.getElementById('filterAllBtn');
const filterMoviesBtn = document.getElementById('filterMoviesBtn');
const filterSeriesBtn = document.getElementById('filterSeriesBtn');

const loadingState = document.getElementById('loadingState');
const welcomeState = document.getElementById('welcomeState');
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
const modalCountry = document.getElementById('modalCountry');
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
const tabDownloadsBtn = document.getElementById('tabDownloadsBtn');
const libDownloadsBadge = document.getElementById('libDownloadsBadge');
const libraryDownloadsContainer = document.getElementById('libraryDownloadsContainer');
const libraryExportBtn = document.getElementById('libraryExportBtn');
const libraryImportBtn = document.getElementById('libraryImportBtn');
const libraryImportFile = document.getElementById('libraryImportFile');
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

function isOriginalAudioAllowedForSeries(series, language) {
  const provider = String(series?.provider || '').toLowerCase();
  const genres = Array.isArray(series?.genres)
    ? series.genres.map((genre) => String(genre).toLowerCase())
    : [];
  const originalLanguage = normalizeAudioLabel(series?.originalLanguage || series?.language);
  if (language === 'japanese') {
    return series?.type === 'anime' ||
      String(series?.category || '').toLowerCase() === 'anime' ||
      genres.some((genre) => genre.includes('anime')) ||
      ['hianime', 'anikoto', 'kickassanime', 'animetsu', 'tokyoinsider', 'uniquestream', 'animeworld', 'animesalt'].includes(provider);
  }
  if (language === 'korean') {
    return originalLanguage === 'korean' || originalLanguage === 'ko' ||
      genres.some((genre) => /k[\s-]?drama|korean/.test(genre));
  }
  return false;
}

function getEpisodeAudioLabel(episode, series = null) {
  const metadataLabel = [
    episode?.language,
    episode?.audio,
    episode?.lang,
    episode?.variant,
  ].filter(Boolean).join(' ');
  const metadataLanguage = detectStrictAudioLanguage(metadataLabel);
  if (metadataLabel && metadataLanguage) return metadataLanguage;
  if (metadataLabel && metadataLanguage === null) {
    const label = normalizeAudioLabel(metadataLabel);
    if (/(^|\s)(japanese|jpn|ja)(\s|$)/.test(label)) {
      return isOriginalAudioAllowedForSeries(series, 'japanese') ? 'original' : null;
    }
    if (/(^|\s)(korean|kor|ko)(\s|$)/.test(label)) {
      return isOriginalAudioAllowedForSeries(series, 'korean') ? 'original' : null;
    }
    return null;
  }

  const title = normalizeAudioLabel(episode?.title || episode?.name || episode?.label || '');
  if (/(^|\s)(hindi|hin|english|eng)(\s+)(dub|audio)(\s|$)/.test(title)) {
    return detectStrictAudioLanguage(title);
  }
  if (/(^|\s)(japanese|jpn)(\s+)(dub|audio|original)(\s|$)/.test(title) &&
      isOriginalAudioAllowedForSeries(series, 'japanese')) {
    return 'original';
  }
  if (/(^|\s)(korean|kor)(\s+)(dub|audio|original)(\s|$)/.test(title) &&
      isOriginalAudioAllowedForSeries(series, 'korean')) {
    return 'original';
  }
  if (/(^|\s)(original|native)(\s+audio)(\s|$)/.test(title)) return 'original';

  return 'original';
}

function getEpisodeDisplayNumber(episode, fallbackIndex = 0) {
  const direct = Number(episode?.episodeNumber ?? episode?.ep ?? episode?.number ?? episode?.episode ?? episode?.id);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const title = String(episode?.title || episode?.name || episode?.label || '');
  const match = title.match(/(?:episode|ep)[^0-9]*(\d+)/i) || title.match(/(\d+)/);
  if (match && Number(match[1])) return Number(match[1]);

  return fallbackIndex + 1;
}

function dedupeEpisodesByNumberAndAudio(episodes, series = null) {
  const seen = new Set();
  return (Array.isArray(episodes) ? episodes : [])
    .filter(isEpisodeEntry)
    .filter((episode, index) => {
      const audio = getEpisodeAudioLabel(episode, series);
      if (!audio) return false; // Discard any episode that is not english, hindi, or original!
      const key = `${getEpisodeDisplayNumber(episode, index)}::${audio}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function filterSeriesEpisodesForAudio(episodes, selectedAudio = 'all', series = null) {
  const audioChoice = String(selectedAudio || 'all').toLowerCase();
  const safeEpisodes = dedupeEpisodesByNumberAndAudio(episodes, series);

  return safeEpisodes.filter((episode) => {
    const detectedLanguage = getEpisodeAudioLabel(episode, series);
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
      updateNextEpisodeUi();
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
const subtitleSelect = document.getElementById('subtitleSelect');
const subtitleStatus = document.getElementById('subtitleStatus');
const audioSelect = document.getElementById('audioSelect');
const playbackRateSelect = document.getElementById('playbackRateSelect');
const videoPlayerContainer = document.getElementById('videoPlayerContainer');
const playerLoading = document.getElementById('playerLoading');
const playerLoadingText = document.getElementById('playerLoadingText');
const playerSeek = document.getElementById('playerSeek');
const playerCurrentTime = document.getElementById('playerCurrentTime');
const playerDuration = document.getElementById('playerDuration');
const playerPlayBtn = document.getElementById('playerPlayBtn');
const playerPlayIcon = document.getElementById('playerPlayIcon');
const playerPauseIcon = document.getElementById('playerPauseIcon');
const playerMuteBtn = document.getElementById('playerMuteBtn');
const playerVolume = document.getElementById('playerVolume');
const playerVolumeIcon = document.getElementById('playerVolumeIcon');
const playerMutedIcon = document.getElementById('playerMutedIcon');
const playerFitBtn = document.getElementById('playerFitBtn');
const playerBackBtn = document.getElementById('playerBackBtn');
const playerForwardBtn = document.getElementById('playerForwardBtn');
const playerCaptionsBtn = document.getElementById('playerCaptionsBtn');
const playerSettingsBtn = document.getElementById('playerSettingsBtn');
const playerSettingsMenu = document.getElementById('playerSettingsMenu');
const playerPipBtn = document.getElementById('playerPipBtn');
const playerFullscreenBtn = document.getElementById('playerFullscreenBtn');
const playerFullscreenIcon = document.getElementById('playerFullscreenIcon');
const playerExitFullscreenIcon = document.getElementById('playerExitFullscreenIcon');
const queuePlayerStream = document.getElementById('queuePlayerStream');
const sleepTimerSelect = document.getElementById('sleepTimerSelect');
const autoNextToggle = document.getElementById('autoNextToggle');
const nextEpisodeBtn = document.getElementById('nextEpisodeBtn');
const nextEpisodeBtnLabel = document.getElementById('nextEpisodeBtnLabel');
const playerSeekFeedback = document.getElementById('playerSeekFeedback');
const playerSeekDelta = document.getElementById('playerSeekDelta');
const playerSeekTarget = document.getElementById('playerSeekTarget');
const playerSeekFeedbackRange = document.getElementById('playerSeekFeedbackRange');
const playerSeekFeedbackMarker = document.getElementById('playerSeekFeedbackMarker');
const playerSeekTooltip = document.getElementById('playerSeekTooltip');
let playerControlsTimeout = null;
let sleepTimerHandle = null;
const PLAYER_VOLUME_KEY = 'cinesphere_player_volume';
const PLAYER_FILL_KEY = 'cinesphere_player_fill';
// Remembers the last chosen audio language across sessions (web mirror of the
// Vega app's `lastAudioTrack` preference). 'auto' keeps the source default.
const AUDIO_PREFERENCE_KEY = 'cinesphere_last_audio';

function applyPlayerFill(enabled) {
  if (!videoPlayerContainer) return;
  videoPlayerContainer.classList.toggle('player-fill', enabled);
  if (playerFitBtn) {
    playerFitBtn.classList.toggle('active', enabled);
    playerFitBtn.setAttribute('aria-pressed', String(enabled));
    playerFitBtn.setAttribute('aria-label', enabled ? 'Fit video in frame' : 'Fill video frame');
    playerFitBtn.title = enabled ? 'Fit video in frame (A)' : 'Fill video frame (A)';
  }
}
const playerFillInitiallyEnabled = (() => {
  try { return localStorage.getItem(PLAYER_FILL_KEY) === '1'; } catch { return false; }
})();
applyPlayerFill(playerFillInitiallyEnabled);

function setPlayerVolume(percent) {
  if (!videoPlayer) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  videoPlayer.volume = clamped / 100;
  videoPlayer.muted = clamped === 0;
  if (playerVolume) playerVolume.value = String(Math.round(clamped));
  try { localStorage.setItem(PLAYER_VOLUME_KEY, String(Math.round(clamped))); } catch { /* optional */ }
  updatePlayerControls();
}

(() => {
  try {
    const raw = localStorage.getItem(PLAYER_VOLUME_KEY);
    const saved = raw === null ? NaN : Number(raw);
    if (Number.isFinite(saved) && saved >= 0 && saved <= 100) {
      videoPlayer.volume = saved / 100;
      videoPlayer.muted = saved === 0;
      if (playerVolume) playerVolume.value = String(Math.round(saved));
      updatePlayerControls();
    }
  } catch { /* localStorage can be unavailable in private mode. */ }
})();

function setPlayerLoading(loading, message = 'Loading stream...') {
  if (!playerLoading) return;
  playerLoading.classList.toggle('hidden', !loading);
  if (loading && playerLoadingText) playerLoadingText.textContent = message;
}

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

// ── Seek feedback ────────────────────────────────────────────────────────
// The native <video> can keep showing the previous frame for a moment after a
// seek. These helpers give immediate visual proof of where the jump landed and
// how much was skipped, instead of waiting for playback/buffering to catch up.
let seekFeedbackTimer = null;
let seekTooltipHideTimer = null;
let activeScrub = null;
const SEEK_FEEDBACK_HOLD_MS = 1150;

function formatSeekDelta(seconds) {
  const rounded = Math.round(Number(seconds) || 0);
  const sign = rounded < 0 ? '−' : '+';
  const abs = Math.abs(rounded);
  if (abs < 60) return `${sign}${abs}s`;
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  return hours
    ? `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${sign}${minutes}:${String(secs).padStart(2, '0')}`;
}

function isTimeBuffered(seconds) {
  if (!videoPlayer || !Number.isFinite(seconds)) return false;
  try {
    const ranges = videoPlayer.buffered;
    for (let i = 0; i < ranges.length; i += 1) {
      if (seconds >= ranges.start(i) - 0.25 && seconds <= ranges.end(i) + 0.25) return true;
    }
  } catch {
    // Buffered ranges may be unavailable while the source is loading.
  }
  return false;
}

function hideSeekFeedback() {
  if (!playerSeekFeedback) return;
  if (seekFeedbackTimer) {
    clearTimeout(seekFeedbackTimer);
    seekFeedbackTimer = null;
  }
  playerSeekFeedback.classList.remove('show', 'is-forward', 'is-backward');
}

function showSeekFeedback(fromSeconds, toSeconds) {
  if (!playerSeekFeedback) return;
  const from = Number.isFinite(fromSeconds) ? fromSeconds : toSeconds;
  const to = Number.isFinite(toSeconds) ? toSeconds : from;
  const duration = Number.isFinite(videoPlayer?.duration) && videoPlayer.duration > 0
    ? videoPlayer.duration
    : 0;

  if (seekFeedbackTimer) {
    clearTimeout(seekFeedbackTimer);
    seekFeedbackTimer = null;
  }

  const directionClass = to < from ? 'is-backward' : 'is-forward';
  const isVisible = playerSeekFeedback.classList.contains('show');
  const sameDirection = playerSeekFeedback.classList.contains(directionClass);
  if (!isVisible || !sameDirection) {
    playerSeekFeedback.classList.remove('show', 'is-forward', 'is-backward');
    // Restart the slide/pop animation only when the HUD was hidden or the
    // direction changed. Continuous scrubbing should not flicker every pixel.
    void playerSeekFeedback.offsetWidth;
    playerSeekFeedback.classList.add('show', directionClass);
  }

  if (playerSeekDelta) playerSeekDelta.textContent = formatSeekDelta(to - from);
  if (playerSeekTarget) {
    playerSeekTarget.textContent = duration > 0
      ? `${formatPlayerTime(to)} / ${formatPlayerTime(duration)}`
      : formatPlayerTime(to);
  }
  if (duration > 0 && playerSeekFeedbackRange && playerSeekFeedbackMarker) {
    const fromPercent = Math.max(0, Math.min(100, (from / duration) * 100));
    const toPercent = Math.max(0, Math.min(100, (to / duration) * 100));
    playerSeekFeedbackRange.style.left = `${Math.min(fromPercent, toPercent)}%`;
    playerSeekFeedbackRange.style.width = `${Math.abs(toPercent - fromPercent)}%`;
    playerSeekFeedbackMarker.style.left = `${toPercent}%`;
  } else if (playerSeekFeedbackRange && playerSeekFeedbackMarker) {
    playerSeekFeedbackRange.style.width = '0%';
    playerSeekFeedbackMarker.style.left = '0%';
  }

  seekFeedbackTimer = setTimeout(() => {
    seekFeedbackTimer = null;
    playerSeekFeedback.classList.remove('show');
  }, SEEK_FEEDBACK_HOLD_MS);
}

/**
 * Seek to a timestamp and paint the seek UI immediately. `from` lets callers
 * describe the size of a drag from where the drag started rather than from the
 * intermediate position of the last input event.
 */
function seekPlayerTo(targetSeconds, { from = null, scrubbing = false } = {}) {
  if (!videoPlayer) return;
  const duration = Number.isFinite(videoPlayer.duration) && videoPlayer.duration > 0
    ? videoPlayer.duration
    : null;
  const rawStart = Number.isFinite(from) ? from : videoPlayer.currentTime;
  const start = Number.isFinite(rawStart) ? rawStart : 0;
  const target = Number(targetSeconds);
  if (!Number.isFinite(target)) return;
  const bounded = Math.max(0, duration ? Math.min(duration, target) : target);

  try {
    videoPlayer.currentTime = bounded;
  } catch {
    return;
  }

  // Do not wait for timeupdate: update the visible time and bar right away.
  if (playerCurrentTime) playerCurrentTime.textContent = formatPlayerTime(bounded);
  if (playerSeek && duration) {
    const progress = (bounded / duration) * 100;
    playerSeek.value = String(Math.round(progress * 10));
    playerSeek.style.setProperty('--seek-progress', `${progress}%`);
    playerSeek.setAttribute(
      'aria-valuetext',
      `${formatPlayerTime(bounded)} of ${formatPlayerTime(duration)}`
    );
  }
  showSeekFeedback(start, bounded);
  showPlayerControls();
  if (!scrubbing && !isTimeBuffered(bounded)) {
    setPlayerLoading(true, `Seeking to ${formatPlayerTime(bounded)}…`);
  }
}

function positionSeekTooltip(clientX) {
  if (!playerSeek || !playerSeekTooltip || !videoPlayer || !videoPlayerContainer) return;
  const duration = videoPlayer.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const seekRect = playerSeek.getBoundingClientRect();
  const containerRect = videoPlayerContainer.getBoundingClientRect();
  if (!seekRect.width || !containerRect.width) return;
  const ratio = Math.max(0, Math.min(1, (clientX - seekRect.left) / seekRect.width));
  const target = ratio * duration;
  playerSeekTooltip.textContent = formatPlayerTime(target);
  const left = Math.max(28, Math.min(containerRect.width - 28, clientX - containerRect.left));
  const bottom = Math.max(12, containerRect.bottom - seekRect.top + 10);
  playerSeekTooltip.style.left = `${left}px`;
  playerSeekTooltip.style.bottom = `${bottom}px`;
  playerSeekTooltip.classList.add('show');
}

function positionSeekTooltipFromValue() {
  if (!playerSeek || !playerSeekTooltip || !videoPlayer) return;
  const duration = videoPlayer.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const seekRect = playerSeek.getBoundingClientRect();
  if (!seekRect.width) return;
  const ratio = Number(playerSeek.value) / 1000;
  positionSeekTooltip(seekRect.left + ratio * seekRect.width);
}

function hideSeekTooltip(delay = 0) {
  if (!playerSeekTooltip) return;
  if (seekTooltipHideTimer) {
    clearTimeout(seekTooltipHideTimer);
    seekTooltipHideTimer = null;
  }
  const apply = () => {
    seekTooltipHideTimer = null;
    if (!activeScrub) playerSeekTooltip.classList.remove('show');
  };
  if (delay > 0) {
    seekTooltipHideTimer = setTimeout(apply, delay);
  } else {
    apply();
  }
}

function updatePlayerControls() {
  if (!videoPlayer) return;
  const duration = videoPlayer.duration;
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = hasDuration ? (videoPlayer.currentTime / duration) * 100 : 0;

  if (playerCurrentTime) playerCurrentTime.textContent = formatPlayerTime(videoPlayer.currentTime);
  if (playerDuration) playerDuration.textContent = formatPlayerTime(duration);
  if (playerSeek) {
    playerSeek.disabled = !hasDuration;
    playerSeek.value = String(Math.round(progress * 10));
    playerSeek.style.setProperty('--seek-progress', `${progress}%`);
    playerSeek.setAttribute(
      'aria-valuetext',
      `${formatPlayerTime(videoPlayer.currentTime)} of ${formatPlayerTime(duration)}`
    );
  }

  const playing = !videoPlayer.paused && !videoPlayer.ended;
  playerPlayIcon?.classList.toggle('hidden', playing);
  playerPauseIcon?.classList.toggle('hidden', !playing);
  if (playerPlayBtn) {
    playerPlayBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playerPlayBtn.title = playing ? 'Pause' : 'Play';
  }

  const muted = videoPlayer.muted || videoPlayer.volume === 0;
  playerVolumeIcon?.classList.toggle('hidden', muted);
  playerMutedIcon?.classList.toggle('hidden', !muted);
  if (playerMuteBtn) {
    playerMuteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    playerMuteBtn.title = muted ? 'Unmute' : 'Mute';
  }
  if (playerVolume && document.activeElement !== playerVolume) {
    playerVolume.value = String(Math.round((muted ? 0 : videoPlayer.volume) * 100));
  }

  const isFullscreen = document.fullscreenElement === videoPlayerContainer;
  videoPlayerContainer?.classList.toggle('is-fullscreen', isFullscreen);
  playerFullscreenIcon?.classList.toggle('hidden', isFullscreen);
  playerExitFullscreenIcon?.classList.toggle('hidden', !isFullscreen);
  if (playerFullscreenBtn) {
    playerFullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    playerFullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
  }

  const captionsEnabled = Boolean(subtitleSelect && subtitleSelect.value !== 'off' && !subtitleSelect.disabled);
  playerCaptionsBtn?.classList.toggle('active', captionsEnabled);
  if (playerCaptionsBtn) playerCaptionsBtn.disabled = !subtitleSelect || subtitleSelect.disabled || subtitleSelect.options.length < 2;
  if (playerPipBtn) {
    playerPipBtn.disabled = !document.pictureInPictureEnabled || typeof videoPlayer.requestPictureInPicture !== 'function';
  }
}

function showPlayerControls() {
  if (!videoPlayerContainer) return;
  videoPlayerContainer.classList.remove('controls-hidden');
  if (playerControlsTimeout) clearTimeout(playerControlsTimeout);
  if (!videoPlayer?.paused && !videoPlayer?.ended) {
    playerControlsTimeout = setTimeout(() => {
      if (activeScrub) return;
      if (!playerSettingsMenu?.classList.contains('hidden')) return;
      videoPlayerContainer.classList.add('controls-hidden');
    }, 2600);
  }
}

function setSelectedSubtitle(value) {
  if (!subtitleSelect || subtitleSelect.disabled) return;
  subtitleSelect.value = value;
  subtitleSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
}

videoPlayer?.addEventListener('loadedmetadata', updatePlayerControls);
videoPlayer?.addEventListener('durationchange', updatePlayerControls);
videoPlayer?.addEventListener('timeupdate', updatePlayerControls);
videoPlayer?.addEventListener('play', () => {
  updatePlayerControls();
  showPlayerControls();
});
videoPlayer?.addEventListener('pause', () => {
  updatePlayerControls();
  showPlayerControls();
});
videoPlayer?.addEventListener('ended', updatePlayerControls);
videoPlayer?.addEventListener('volumechange', updatePlayerControls);
videoPlayer?.addEventListener('loadstart', () => setPlayerLoading(true));
videoPlayer?.addEventListener('waiting', () => setPlayerLoading(true, 'Buffering...'));
videoPlayer?.addEventListener('stalled', () => setPlayerLoading(true, 'Stream stalled; waiting for data...'));
videoPlayer?.addEventListener('canplay', () => setPlayerLoading(false));
videoPlayer?.addEventListener('playing', () => setPlayerLoading(false));
videoPlayer?.addEventListener('seeked', () => setPlayerLoading(false));
videoPlayer?.addEventListener('error', () => setPlayerLoading(false));
document.addEventListener('fullscreenchange', updatePlayerControls);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && typeof window.screen.orientation?.unlock === 'function') {
    window.screen.orientation.unlock();
  }
});

playerPlayBtn?.addEventListener('click', () => {
  if (!videoPlayer) return;
  if (videoPlayer.paused || videoPlayer.ended) {
    videoPlayer.play().catch((error) => console.warn('Playback could not start:', error?.name));
  } else {
    videoPlayer.pause();
  }
});

playerMuteBtn?.addEventListener('click', () => {
  if (!videoPlayer) return;
  if (videoPlayer.muted) {
    videoPlayer.muted = false;
    if (videoPlayer.volume === 0) setPlayerVolume(60);
  } else {
    videoPlayer.muted = true;
  }
  updatePlayerControls();
});

playerVolume?.addEventListener('input', () => {
  setPlayerVolume(playerVolume.value);
});

playerFitBtn?.addEventListener('click', () => {
  if (!videoPlayerContainer) return;
  const enabled = !videoPlayerContainer.classList.contains('player-fill');
  applyPlayerFill(enabled);
  try { localStorage.setItem(PLAYER_FILL_KEY, enabled ? '1' : '0'); } catch { /* optional */ }
  showPlayerControls();
});

playerBackBtn?.addEventListener('click', () => {
  if (!videoPlayer || !Number.isFinite(videoPlayer.currentTime)) return;
  seekPlayerTo(Math.max(0, videoPlayer.currentTime - 10));
});

playerForwardBtn?.addEventListener('click', () => {
  if (!videoPlayer || !Number.isFinite(videoPlayer.currentTime)) return;
  const end = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : Infinity;
  seekPlayerTo(Math.min(end, videoPlayer.currentTime + 10));
});

nextEpisodeBtn?.addEventListener('click', () => {
  const nextContext = getNextEpisodeContext();
  if (!nextContext) return;
  cancelAutoNext();
  playNextEpisode(nextContext);
});

playerSeek?.addEventListener('pointerdown', (event) => {
  if (!videoPlayer || !Number.isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
  event.preventDefault();
  playerSeek.focus({ preventScroll: true });
  playerSeek.setPointerCapture(event.pointerId);
  activeScrub = {
    from: videoPlayer.currentTime,
    startX: event.clientX,
    pointerId: event.pointerId,
    dragging: false,
  };
  positionSeekTooltip(event.clientX);
});

playerSeek?.addEventListener('pointermove', (event) => {
  if (activeScrub) {
    if (event.pointerId !== activeScrub.pointerId) return;
    if (!activeScrub.dragging && Math.abs(event.clientX - activeScrub.startX) < 3) {
      positionSeekTooltip(event.clientX);
      return;
    }

    activeScrub.dragging = true;
    const seekRect = playerSeek.getBoundingClientRect();
    if (!seekRect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - seekRect.left) / seekRect.width));
    playerSeek.value = String(Math.round(ratio * 1000));
    seekPlayerTo(ratio * videoPlayer.duration, {
      from: activeScrub.from,
      scrubbing: true,
    });
  }
  positionSeekTooltip(event.clientX);
});

playerSeek?.addEventListener('pointerleave', () => {
  if (!activeScrub) hideSeekTooltip();
});

playerSeek?.addEventListener('input', () => {
  if (!videoPlayer || !Number.isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
  const progress = Number(playerSeek.value) / 1000;
  const target = Math.max(0, Math.min(videoPlayer.duration, progress * videoPlayer.duration));
  seekPlayerTo(target, {
    from: activeScrub ? activeScrub.from : videoPlayer.currentTime,
    scrubbing: Boolean(activeScrub),
  });
  positionSeekTooltipFromValue();
});

playerSeek?.addEventListener('change', () => {
  if (!videoPlayer || !Number.isFinite(videoPlayer.currentTime)) return;
  if (!isTimeBuffered(videoPlayer.currentTime)) {
    setPlayerLoading(true, `Seeking to ${formatPlayerTime(videoPlayer.currentTime)}…`);
  }
  hideSeekTooltip(700);
});

window.addEventListener('pointerup', (event) => {
  if (!activeScrub || event.pointerId !== activeScrub.pointerId) return;
  const wasDragging = activeScrub.dragging;
  activeScrub = null;
  if (wasDragging && !isTimeBuffered(videoPlayer.currentTime)) {
    setPlayerLoading(true, `Seeking to ${formatPlayerTime(videoPlayer.currentTime)}…`);
  }
  hideSeekTooltip(700);
});

window.addEventListener('pointercancel', (event) => {
  if (!activeScrub || event.pointerId !== activeScrub.pointerId) return;
  activeScrub = null;
  hideSeekTooltip(0);
});

playerCaptionsBtn?.addEventListener('click', () => {
  if (!subtitleSelect || subtitleSelect.disabled || subtitleSelect.options.length < 2) return;
  setSelectedSubtitle(subtitleSelect.value === 'off' ? subtitleSelect.options[1].value : 'off');
});

playerSettingsBtn?.addEventListener('click', () => {
  if (!playerSettingsMenu) return;
  const isOpening = playerSettingsMenu.classList.contains('hidden');
  playerSettingsMenu.classList.toggle('hidden', !isOpening);
  playerSettingsBtn.setAttribute('aria-expanded', String(isOpening));
  showPlayerControls();
});

document.addEventListener('click', (event) => {
  if (!playerSettingsMenu || !playerSettingsBtn || playerSettingsMenu.classList.contains('hidden')) return;
  if (playerSettingsMenu.contains(event.target) || playerSettingsBtn.contains(event.target)) return;
  playerSettingsMenu.classList.add('hidden');
  playerSettingsBtn.setAttribute('aria-expanded', 'false');
});

playerPipBtn?.addEventListener('click', async () => {
  if (!videoPlayer || !document.pictureInPictureEnabled || typeof videoPlayer.requestPictureInPicture !== 'function') return;
  try {
    if (document.pictureInPictureElement === videoPlayer) {
      await document.exitPictureInPicture();
    } else {
      await videoPlayer.requestPictureInPicture();
    }
  } catch (error) {
    console.warn('Picture-in-picture could not be toggled:', error?.name);
  }
});

playerFullscreenBtn?.addEventListener('click', async () => {
  if (!videoPlayerContainer) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (videoPlayerContainer.requestFullscreen) {
      await videoPlayerContainer.requestFullscreen();
      if (typeof window.screen.orientation?.lock === 'function') {
        try {
          await window.screen.orientation.lock('landscape');
        } catch (error) {
          console.warn('Landscape orientation could not be locked:', error?.name);
        }
      }
    } else if (videoPlayer?.webkitEnterFullscreen) {
      videoPlayer.webkitEnterFullscreen();
    }
  } catch (error) {
    console.warn('Fullscreen could not be toggled:', error?.name);
  }
});

videoPlayerContainer?.addEventListener('pointermove', showPlayerControls);
videoPlayerContainer?.addEventListener('pointerdown', showPlayerControls);

function isPlayerShortcutTarget(target) {
  if (!target || target === document.body || target === document.documentElement) return true;
  const tag = String(target.tagName || '').toLowerCase();
  if (target.isContentEditable) return false;
  return !['input', 'select', 'textarea', 'button', 'a', 'summary'].includes(tag);
}

document.addEventListener('keydown', (event) => {
  if (!videoPlayer || !playerContainer || playerContainer.classList.contains('hidden')) return;
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.fullscreenElement && document.fullscreenElement !== videoPlayerContainer) return;
  if (!isPlayerShortcutTarget(event.target)) return;

  const key = String(event.key || '');
  const lower = key.toLowerCase();
  let seekBy = 0;
  let volumeBy = 0;
  if (key === 'ArrowLeft' || lower === 'j') seekBy = event.shiftKey ? -30 : -10;
  if (key === 'ArrowRight' || lower === 'l') seekBy = event.shiftKey ? 30 : 10;
  if (key === 'ArrowUp') volumeBy = 5;
  if (key === 'ArrowDown') volumeBy = -5;

  if (seekBy && Number.isFinite(videoPlayer.duration)) {
    event.preventDefault();
    seekPlayerTo(Math.max(0, Math.min(videoPlayer.duration, videoPlayer.currentTime + seekBy)));
  } else if (volumeBy) {
    event.preventDefault();
    setPlayerVolume(videoPlayer.volume * 100 + volumeBy);
  } else if (key === ' ' || lower === 'k') {
    event.preventDefault();
    playerPlayBtn?.click();
  } else if (key === 'Home' && Number.isFinite(videoPlayer.duration)) {
    event.preventDefault();
    seekPlayerTo(0);
  } else if (key === 'End' && Number.isFinite(videoPlayer.duration)) {
    event.preventDefault();
    seekPlayerTo(videoPlayer.duration);
  } else if (lower === 'm') {
    event.preventDefault();
    playerMuteBtn?.click();
  } else if (lower === 'n' && nextEpisodeBtn && !nextEpisodeBtn.disabled && !nextEpisodeBtn.classList.contains('hidden')) {
    event.preventDefault();
    nextEpisodeBtn.click();
  } else if (lower === 'f') {
    event.preventDefault();
    playerFullscreenBtn?.click();
  } else if (lower === 'p') {
    event.preventDefault();
    playerPipBtn?.click();
  } else if (lower === 'c') {
    event.preventDefault();
    playerCaptionsBtn?.click();
  } else if (lower === 'a') {
    event.preventDefault();
    playerFitBtn?.click();
  } else if (lower === 's') {
    event.preventDefault();
    playerSettingsBtn?.click();
  } else if (key === 'Escape' && playerSettingsMenu && !playerSettingsMenu.classList.contains('hidden')) {
    playerSettingsMenu.classList.add('hidden');
    playerSettingsBtn?.setAttribute('aria-expanded', 'false');
  } else {
    return;
  }
  showPlayerControls();
});

// Gateway host info
const sessionHostBadge = document.getElementById('sessionHostBadge');

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
// VEGA-STYLE CONTINUE WATCHING STRIP
// Reads from cinesphere_history (already tracked) and renders
// resume cards above the catalog. 85% threshold = "watched".
// ==========================================
const CONTINUE_WATCHING_THRESHOLD_MIN = 0.05; // > 5% played
const CONTINUE_WATCHING_THRESHOLD_MAX = 0.92; // < 92% played (not finished)

/** Returns history items that are in-progress (5%–92% complete). */
function getContinueWatchingItems() {
  try {
    const history = JSON.parse(localStorage.getItem('cinesphere_history') || '[]');
    return history
      .filter((item) => {
        const p = Number(item.progressSeconds) || 0;
        const d = Number(item.durationSeconds) || 0;
        if (!d || p <= 0) return false;
        const ratio = p / d;
        return ratio >= CONTINUE_WATCHING_THRESHOLD_MIN && ratio < CONTINUE_WATCHING_THRESHOLD_MAX;
      })
      .sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0))
      .slice(0, 20);
  } catch {
    return [];
  }
}

/** Renders / refreshes the continue-watching strip on the homepage. */
function renderContinueWatchingStrip() {
  const section = document.getElementById('continueWatchingSection');
  const strip = document.getElementById('continueWatchingStrip');
  if (!section || !strip) return;

  const items = getContinueWatchingItems();
  if (items.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  strip.innerHTML = items.map((item) => {
    const pct = Math.min(100, Math.max(0, Math.round(
      (Number(item.progressSeconds) / Number(item.durationSeconds)) * 100
    )));
    const remaining = Math.max(0, Number(item.durationSeconds) - Number(item.progressSeconds));
    const remText = remaining > 60
      ? `${Math.round(remaining / 60)}m left`
      : `${Math.round(remaining)}s left`;
    const poster = item.poster
      ? `/api/poster?url=${encodeURIComponent(item.poster)}`
      : '';
    const safeTitle = escapeHtml(item.title || 'Untitled');
    const streamTitle = item.streamTitle ? escapeHtml(item.streamTitle) : '';
    const isSeries = item.type === 'series' || item.seasonNumber;
    const episodeLine = isSeries && (item.seasonNumber || item.episodeNumber)
      ? `S${escapeHtml(String(item.seasonNumber || 1))}·E${escapeHtml(String(item.episodeNumber || 1))}`
      : '';

    return `
      <div class="cw-card shrink-0 cursor-pointer group relative rounded-xl overflow-hidden border border-[#2f2924] bg-[#161412] hover:border-amber-500/40 transition-all duration-200 shadow-lg"
           style="width:130px;"
           data-action="cw-resume"
           data-history-id="${escapeHtml(item.id)}"
           data-subject-id="${escapeHtml(item.subjectId || item.id)}"
           data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}"
           data-stream-subject-id="${escapeHtml(item.streamSubjectId || '')}"
           data-stream-provider="${escapeHtml(item.streamProvider || item.provider || 'movieBoxWeb')}"
           data-progress="${pct}"
           title="${safeTitle}">
        <!-- Poster -->
        <div class="relative" style="aspect-ratio:2/3;">
          ${poster
            ? `<img src="${safeImageUrl(poster, POSTER_FALLBACK)}" alt="${safeTitle}" class="w-full h-full object-cover" loading="lazy">`
            : `<div class="w-full h-full bg-[#211d19] flex items-center justify-center"><svg class="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></div>`}
          <!-- Play overlay -->
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <div class="w-10 h-10 rounded-full bg-amber-500/90 flex items-center justify-center shadow-xl">
              <svg class="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/></svg>
            </div>
          </div>
          <!-- Progress bar -->
          <div class="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div class="h-full bg-amber-500 rounded-r-full transition-all" style="width:${pct}%"></div>
          </div>
        </div>
        <!-- Info -->
        <div class="p-2">
          <p class="text-[11px] font-semibold text-white truncate leading-tight">${safeTitle}</p>
          ${episodeLine ? `<p class="text-[10px] text-indigo-400 font-mono font-bold">${episodeLine}</p>` : ''}
          ${streamTitle ? `<p class="text-[10px] text-slate-400 truncate">${streamTitle}</p>` : ''}
          <p class="text-[10px] text-amber-400/80 font-mono mt-0.5">${remText}</p>
        </div>
        <!-- Remove button -->
        <button class="cw-remove absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-slate-400 hover:text-white hover:bg-black/90 items-center justify-center hidden group-hover:flex transition text-[10px]"
                data-action="cw-remove"
                data-history-id="${escapeHtml(item.id)}"
                title="Remove"
                aria-label="Remove from continue watching">✕</button>
      </div>
    `;
  }).join('');
}

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
  renderContinueWatchingStrip();
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
  const subjectId = mediaItem.subjectId || mediaItem.id;
  const seasonNumber = Number(streamDetails?.season) || null;
  const episodeNumber = Number(streamDetails?.episode) || null;
  const id = seasonNumber && episodeNumber
    ? `${subjectId}::s${seasonNumber}e${episodeNumber}`
    : subjectId;
  const history = getStoredHistory();
  const existing = history.find((it) =>
    String(it.id) === String(id) ||
    (String(it.subjectId || it.id) === String(subjectId) &&
      Number(it.seasonNumber) === seasonNumber &&
      Number(it.episodeNumber) === episodeNumber)
  );
  const list = history.filter((it) => it !== existing &&
    !(String(it.id) === String(subjectId) && String(it.subjectId || it.id) === String(subjectId) &&
      Number(it.seasonNumber) === seasonNumber && Number(it.episodeNumber) === episodeNumber));

  list.unshift({
    id,
    subjectId,
    title: mediaItem.title || 'Untitled',
    type: mediaItem.type || 'movie',
    poster: mediaItem.poster || '',
    year: mediaItem.year || '',
    provider: mediaItem.provider || 'movieBoxWeb',
    providerDisplayName: mediaItem.providerDisplayName || '',
    streamTitle: streamDetails?.title || '',
    seasonNumber,
    episodeNumber,
    streamSubjectId: streamDetails?.streamSubjectId || '',
    streamProvider: streamDetails?.streamProvider || mediaItem.provider || 'movieBoxWeb',
    progressSeconds: Number(existing?.progressSeconds) || 0,
    durationSeconds: Number(existing?.durationSeconds) || 0,
    watchedAt: Date.now(),
  });

  if (list.length > 100) list.length = 100;
  saveStoredHistory(list);
  lastProgressSavedAt = 0;
  currentPlayback.historyId = id;
  if (libraryModal && !libraryModal.classList.contains('hidden') && activeLibraryTab === 'history') {
    renderHistoryTab();
  }
  return existing;
}

function savePlaybackProgress(clear = false) {
  const historyId = currentPlayback.historyId;
  if (!historyId || !videoPlayer) return;

  const duration = videoPlayer.duration;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(videoPlayer.currentTime)) return;

  const list = getStoredHistory();
  const item = list.find((entry) => String(entry.id) === String(historyId));
  if (!item) return;

  item.durationSeconds = duration;
  item.progressSeconds = clear || duration - videoPlayer.currentTime <= 30
    ? 0
    : Math.max(0, videoPlayer.currentTime);
  item.watchedAt = Date.now();
  saveStoredHistory(list);
}

function applyPendingResumePosition() {
  if (!pendingResumeSeconds || !videoPlayer || !Number.isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
  const target = Math.min(pendingResumeSeconds, Math.max(0, videoPlayer.duration - 5));
  if (target <= 0) {
    pendingResumeSeconds = 0;
    return;
  }
  try {
    if (videoPlayer.seekable.length > 0) {
      const first = videoPlayer.seekable.start(0);
      const last = videoPlayer.seekable.end(videoPlayer.seekable.length - 1);
      if (target < first || target > last) return;
    }
    videoPlayer.currentTime = target;
    pendingResumeSeconds = 0;
  } catch {
    // Seeking may become available after metadata; the canplay handler retries.
  }
}

// Auto-next episode state (Vega-inspired: advance at WATCHED_FRACTION = 0.85)
const WATCHED_FRACTION = 0.85;
const AUTO_NEXT_SECONDS = 7;
let autoNextTriggered = false;
let autoNextCountdownTimer = null;
let autoNextDismissed = false;
let nextEpisodeLoading = false;

/**
 * Series-only episode navigation. The old implementation scraped DOM buttons,
 * which failed when the next season was filtered out of the hierarchy. These
 * helpers walk the full season data instead.
 */
function isSeriesMedia(media) {
  if (!media || typeof media !== 'object') return false;
  if (media.type === 'series' || media.type === 'tv' || media.type === 'anime' || media.isSeries) {
    return true;
  }
  return Array.isArray(media.seasons) &&
    media.seasons.some((season) => Array.isArray(season?.episodes) && season.episodes.length > 0);
}

function getSeriesEpisodeEntries(media = activeMedia) {
  const seasons = Array.isArray(media?.seasons) ? media.seasons : [];
  if (!seasons.length) return [];
  const selectedAudio = String(seriesAudioSelect?.value || 'all').toLowerCase();
  const entries = [];

  seasons.forEach((season, seasonIndex) => {
    const seasonNumber = Number(
      getSeasonNumberFromValue(season) ?? season?.seasonNumber ?? seasonIndex + 1
    ) || seasonIndex + 1;
    const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
    const filteredEpisodes = filterSeriesEpisodesForAudio(episodes, selectedAudio, media);

    filteredEpisodes.forEach((episode, episodeIndex) => {
      const episodeNumber = getEpisodeDisplayNumber(episode, episodeIndex);
      entries.push({
        season: seasonNumber,
        episode: episodeNumber,
        audio: getEpisodeAudioLabel(episode, media) || 'original',
        title: String(episode?.title || episode?.name || episode?.label || `Episode ${episodeNumber}`),
        streamId: episode?.streamId || episode?.link || media?.subjectId || '',
        provider: media?.provider || 'addon',
        seasonIndex,
        episodeIndex,
      });
    });
  });

  entries.sort((a, b) =>
    a.season - b.season ||
    a.episode - b.episode ||
    a.seasonIndex - b.seasonIndex ||
    a.episodeIndex - b.episodeIndex
  );
  return entries;
}

/**
 * Resolve the first playable episode for the current season/audio filters.
 * Used by "View Available Streaming Sources" so a series does not query its
 * series-level ID (which most providers cannot turn into a playable source).
 */
function getFirstEpisodeContext(media = activeMedia) {
  if (!isSeriesMedia(media)) return null;
  const entries = getSeriesEpisodeEntries(media);
  if (!entries.length) return null;

  const selectedSeason = String(seriesSeasonSelect?.value || 'all');
  const candidates = selectedSeason === 'all'
    ? entries
    : entries.filter((entry) => String(entry.season) === selectedSeason);
  const first = (candidates.length ? candidates : entries)[0];

  return {
    streamId: first.streamId,
    provider: first.provider,
    title: media?.title || 'Series',
    episodeTitle: first.title,
    season: first.season,
    episode: first.episode,
    audio: first.audio,
  };
}

/**
 * Highlight the episode whose sources are currently loaded so the user can
 * see which row the "View Sources" action selected.
 */
function markSelectedEpisode(season, episode, audio = null) {
  if (!seriesSeasonsList) return;
  const targetSeason = Number(season);
  const targetEpisode = Number(episode);
  const targetAudio = audio ? String(audio).toLowerCase() : null;

  seriesSeasonsList.querySelectorAll('[data-action="load-streams"]').forEach((button) => {
    const matches = Number(button.dataset.season) === targetSeason &&
      Number(button.dataset.episode) === targetEpisode &&
      (!targetAudio || String(button.dataset.audio || '').toLowerCase() === targetAudio);
    const row = button.closest('.episode-row');
    if (row) row.classList.toggle('episode-selected', matches);
    button.setAttribute('aria-pressed', matches ? 'true' : 'false');
  });
}


function getNextEpisodeContext() {
  if (!isSeriesMedia(activeMedia)) return null;
  if (activeStreamContext?.season == null || activeStreamContext?.episode == null) return null;
  const currentSeason = Number(activeStreamContext.season);
  const currentEpisode = Number(activeStreamContext.episode);
  if (!Number.isFinite(currentSeason) || !Number.isFinite(currentEpisode) || currentEpisode <= 0) return null;

  const entries = getSeriesEpisodeEntries();
  if (!entries.length) return null;
  const currentAudio = String(activeStreamContext.audio || '').toLowerCase();
  const laterEpisodes = entries.filter((entry) =>
    entry.season > currentSeason ||
    (entry.season === currentSeason && entry.episode > currentEpisode)
  );
  if (!laterEpisodes.length) return null;

  const next = (currentAudio && laterEpisodes.find(
    (entry) => String(entry.audio).toLowerCase() === currentAudio
  )) || laterEpisodes[0];

  return {
    streamId: next.streamId,
    provider: next.provider,
    title: `${next.title} · S${next.season}·E${next.episode}`,
    seriesTitle: activeMedia?.title || 'Series',
    season: next.season,
    episode: next.episode,
    audio: next.audio,
  };
}

function updateNextEpisodeUi() {
  if (!nextEpisodeBtn) return;
  const currentEpisode = Number(activeStreamContext?.episode);
  const showForSeries = isSeriesMedia(activeMedia) &&
    activeStreamContext?.episode != null &&
    Number.isFinite(currentEpisode) &&
    currentEpisode > 0;

  if (!showForSeries) {
    nextEpisodeBtn.classList.add('hidden');
    nextEpisodeBtn.disabled = true;
    nextEpisodeBtn.setAttribute('aria-label', 'Next episode unavailable');
    nextEpisodeBtn.title = 'Next episode unavailable';
    return;
  }

  const nextContext = getNextEpisodeContext();
  nextEpisodeBtn.classList.remove('hidden');
  nextEpisodeBtn.disabled = !nextContext || nextEpisodeLoading;

  if (nextContext) {
    const label = `S${nextContext.season}·E${nextContext.episode}`;
    if (nextEpisodeBtnLabel) nextEpisodeBtnLabel.textContent = 'Next';
    nextEpisodeBtn.title = `Next episode: ${label} (N)`;
    nextEpisodeBtn.setAttribute('aria-label', `Next episode: ${label}`);
  } else {
    if (nextEpisodeBtnLabel) nextEpisodeBtnLabel.textContent = 'Next';
    nextEpisodeBtn.title = 'You are on the last episode';
    nextEpisodeBtn.setAttribute('aria-label', 'No next episode');
  }
}

function cancelAutoNext() {
  if (autoNextCountdownTimer) {
    clearInterval(autoNextCountdownTimer);
    autoNextCountdownTimer = null;
  }
  autoNextTriggered = false;
  const overlay = document.getElementById('autoNextOverlay');
  if (overlay) overlay.remove();
}

function triggerAutoNextCountdown(nextCtx) {
  if (!nextCtx || autoNextTriggered || autoNextDismissed || !autoNextEnabled()) return;
  autoNextTriggered = true;

  const host = videoPlayerContainer || playerContainer;
  if (host) {
    const old = document.getElementById('autoNextOverlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'autoNextOverlay';
    overlay.className = 'player-up-next';
    overlay.innerHTML = `
      <div class="player-up-next-head">
        <span>Up Next</span>
        <button id="autoNextClose" class="player-up-next-close" type="button" aria-label="Dismiss next episode prompt">✕</button>
      </div>
      <div class="player-up-next-title">${escapeHtml(nextCtx.title || 'Next Episode')}</div>
      <div class="player-up-next-meta">Auto-play in <span id="autoNextCountdown">${AUTO_NEXT_SECONDS}</span>s</div>
      <div class="player-up-next-progress" aria-hidden="true"><span></span></div>
      <div class="player-up-next-actions">
        <button id="autoNextPlayNow" class="player-up-next-primary" type="button">Play Now</button>
        <button id="autoNextCancel" class="player-up-next-secondary" type="button">Cancel</button>
      </div>
    `;
    host.appendChild(overlay);

    document.getElementById('autoNextPlayNow')?.addEventListener('click', () => {
      cancelAutoNext();
      playNextEpisode(nextCtx);
    });
    document.getElementById('autoNextCancel')?.addEventListener('click', () => {
      autoNextDismissed = true;
      cancelAutoNext();
    });
    document.getElementById('autoNextClose')?.addEventListener('click', () => {
      autoNextDismissed = true;
      cancelAutoNext();
    });
  }

  let remaining = AUTO_NEXT_SECONDS;
  autoNextCountdownTimer = setInterval(() => {
    remaining -= 1;
    const countdown = document.getElementById('autoNextCountdown');
    if (countdown) countdown.textContent = String(Math.max(0, remaining));
    if (remaining > 0) return;
    cancelAutoNext();
    if (autoNextEnabled()) playNextEpisode(nextCtx);
  }, 1000);
}

async function playNextEpisode(ctx) {
  if (!ctx || nextEpisodeLoading) return;
  nextEpisodeLoading = true;
  updateNextEpisodeUi();
  try {
    await loadStreams(ctx.streamId, ctx.provider, {
      title: ctx.seriesTitle,
      season: ctx.season,
      episode: ctx.episode,
      audio: ctx.audio,
    });
    const firstPlayable = streamsList?.querySelector('[data-action="play-stream"]');
    if (firstPlayable) {
      firstPlayable.click();
    } else {
      showError('No playable source was found for the next episode.');
    }
  } catch (err) {
    showError('Could not load the next episode: ' + err.message);
  } finally {
    nextEpisodeLoading = false;
    updateNextEpisodeUi();
  }
}

videoPlayer?.addEventListener('loadedmetadata', applyPendingResumePosition);
videoPlayer?.addEventListener('canplay', applyPendingResumePosition);
videoPlayer?.addEventListener('timeupdate', () => {
  if (currentPlayback.historyId && Date.now() - lastProgressSavedAt >= 5000) {
    lastProgressSavedAt = Date.now();
    savePlaybackProgress();
  }

  if (!autoNextEnabled() || autoNextTriggered) return;

  const dur = videoPlayer.duration;
  const pos = videoPlayer.currentTime;
  if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(pos)) return;

  if (pos / dur < WATCHED_FRACTION) {
    // Rewinding after dismissing the prompt makes it eligible again.
    autoNextDismissed = false;
    return;
  }
  const nextContext = getNextEpisodeContext();
  if (nextContext) triggerAutoNextCountdown(nextContext);
});
videoPlayer?.addEventListener('ended', () => {
  savePlaybackProgress(true);
  if (!autoNextEnabled() || autoNextTriggered) return;
  const nextContext = getNextEpisodeContext();
  if (nextContext) triggerAutoNextCountdown(nextContext);
});

function removeHistoryItem(historyId, subjectId = historyId) {
  if (!historyId) return;
  const list = getStoredHistory().filter((it) =>
    String(it.id) !== String(historyId) &&
    (String(historyId) !== String(subjectId) || String(it.subjectId) !== String(subjectId))
  );
  saveStoredHistory(list);
  renderHistoryTab();
}

async function resumeHistoryItem(item) {
  const subjectId = item?.subjectId || item?.id;
  if (!subjectId) return;
  closeLibraryModal();
  try {
    const details = await loadDetails(subjectId, item.provider || 'movieBoxWeb');
    details.title ||= item.title;
    details.poster ||= item.poster;
    details.year ||= item.year;
    details.type ||= item.type;
    showDetails(details);
    pendingResumeSeconds = 0;
    if (item.progressSeconds > 0 && item.durationSeconds > 0) {
      pendingResumeSeconds = Math.min(Number(item.progressSeconds), Number(item.durationSeconds));
    }
    await loadStreams(item.streamSubjectId || subjectId, item.streamProvider || item.provider || 'movieBoxWeb');
  } catch (err) {
    showError('Failed to resume watch history item: ' + err.message);
  }
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
        const posterUrl = safeImageUrl(item.poster, POSTER_FALLBACK);
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
        const subjectId = item.subjectId || item.id;
        const posterUrl = safeImageUrl(item.poster, POSTER_FALLBACK);
        const timeAgo = formatRelativeTime(item.watchedAt);
        const progress = Number(item.progressSeconds) > 0 && Number(item.durationSeconds) > 0
          ? Math.min(100, Math.max(0, Math.round((item.progressSeconds / item.durationSeconds) * 100)))
          : 0;
        const epDetail = item.seasonNumber && item.episodeNumber
          ? `S${item.seasonNumber} • E${item.episodeNumber}`
          : (item.streamTitle || '');

        return `
          <div class="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#161412] border border-[#2f2924] hover:border-slate-600 transition group">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-14 shrink-0 rounded-lg overflow-hidden bg-black/60 border border-[#2f2924] relative cursor-pointer" data-action="open-details" data-subject-id="${escapeHtml(subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
                <img src="${posterUrl}" alt="${escapeHtml(item.title)}" loading="lazy" class="w-full h-full object-cover" />
              </div>

              <div class="min-w-0">
                <h4 class="text-xs font-bold text-slate-200 truncate cursor-pointer hover:text-amber-400 transition" data-action="open-details" data-subject-id="${escapeHtml(subjectId)}" data-provider="${escapeHtml(item.provider || 'movieBoxWeb')}">
                  ${escapeHtml(item.title)}
                </h4>
                <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                  ${epDetail ? `<span class="px-1.5 py-0.2 rounded bg-[#211d19] text-amber-300 font-semibold border border-[#2f2924]">${escapeHtml(epDetail)}</span>` : ''}
                  <span>Watched ${timeAgo}</span>
                </div>
                ${progress ? `<div class="mt-1.5 h-1 w-full max-w-48 rounded-full bg-[#2f2924]" role="progressbar" aria-label="Playback progress" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><div class="h-full rounded-full bg-violet-400" style="width:${progress}%"></div></div>` : ''}
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                data-action="lib-watch-now"
                data-subject-id="${escapeHtml(subjectId)}"
                data-history-id="${escapeHtml(item.id)}"
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
                data-history-id="${escapeHtml(item.id)}"
                data-subject-id="${escapeHtml(subjectId)}"
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

/** ── Download manager (Vega-inspired) ─────────────────────────────────── */

async function fetchDownloads() {
  try {
    const res = await fetch('/api/downloads', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({ downloads: [] }));
    downloads = Array.isArray(data.downloads) ? data.downloads : [];
    updateDownloadsBadge();
    if (activeLibraryTab === 'downloads') renderDownloadsTab();
  } catch (err) {
    console.warn('[Downloads] fetch failed:', err.message);
  }
}

async function apiDownload(path, method = 'POST', body = null) {
  const opts = { method, credentials: 'same-origin' };
  if (body) opts.headers = { 'Content-Type': 'application/json' };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch('/api/downloads' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Download request failed (HTTP ${res.status})`);
  return data;
}

function startDownloadsPoll(intervalMs = 2000) {
  if (downloadsPollTimer) return;
  fetchDownloads();
  downloadsPollTimer = setInterval(fetchDownloads, intervalMs);
}

function stopDownloadsPoll() {
  if (downloadsPollTimer) {
    clearInterval(downloadsPollTimer);
    downloadsPollTimer = null;
  }
}

function updateDownloadsBadge() {
  const count = downloads.length;
  if (libDownloadsBadge) libDownloadsBadge.textContent = String(count || 0);
  if (libDownloadsBadge) libDownloadsBadge.className = `text-[10px] font-mono px-2 py-0.5 rounded-full ${count ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-[#211d19] text-slate-300 border border-[#2f2924]'}`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(value) / Math.log(k)));
  return parseFloat((value / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bps) {
  const value = Number(bps);
  if (!Number.isFinite(value) || value <= 0) return '';
  return formatBytes(value) + '/s';
}

function statusLabel(status) {
  const map = { queued: 'Queued', downloading: 'Downloading', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
  return map[String(status || '').toLowerCase()] || 'Unknown';
}

function statusClass(status) {
  const map = {
    queued: 'text-amber-300',
    downloading: 'text-emerald-300',
    paused: 'text-slate-300',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-slate-500',
  };
  return map[String(status || '').toLowerCase()] || 'text-slate-400';
}

/** Stable id so queueing the same stream twice does not create duplicates. */
function downloadIdFor(url, title) {
  const input = `${url || ''}::${title || ''}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `dl-${(hash >>> 0).toString(36)}`;
}

/** ── Download queue rendering (Vega-inspired) ─────────────────────────── */

function renderDownloadsTab() {
  if (!libraryDownloadsContainer) return;
  updateDownloadsBadge();

  if (downloads.length === 0) {
    libraryDownloadsContainer.innerHTML = `
      <div class="py-12 px-4 text-center space-y-3">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-[#1f1b17] border border-[#2f2924] flex items-center justify-center text-slate-500">
          <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
        <h4 class="text-sm font-bold text-slate-200">Download Queue is Empty</h4>
        <p class="text-xs text-slate-400 max-w-sm mx-auto">
          Queue a direct stream from any title's playback sources. Progress,
          pause/resume, retry and cancel are supported here. HLS playlists cannot
          be saved as a single file.
        </p>
      </div>
    `;
    return;
  }

  libraryDownloadsContainer.innerHTML = `
    <div class="space-y-3">
      ${downloads.map((d) => {
        const status = String(d.status || '').toLowerCase();
        const rawProgress = Number(d.progress);
        const pct = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, Math.round(rawProgress))) : 0;
        const isActive = status === 'downloading' || status === 'queued';
        const isDone = status === 'completed';
        const canResume = status === 'paused' || status === 'failed' || status === 'cancelled';
        const canCancel = isActive || status === 'paused' || status === 'failed';
        const total = Number(d.totalBytes) > 0 ? Number(d.totalBytes) : 0;
        const fileUrl = isDone && d.fileUrl ? String(d.fileUrl) : '';
        return `
          <div class="p-3 rounded-xl bg-[#161412] border border-[#2f2924] flex flex-col gap-2.5 group">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="font-bold text-slate-200 truncate">${escapeHtml(d.title || 'Untitled')}</span>
                  <span class="text-xs font-mono ${statusClass(status)}">${statusLabel(status)}</span>
                </div>
                <div class="text-[10px] text-slate-500 font-mono mt-0.5 truncate" title="${escapeHtml(d.provider || '')}">${escapeHtml(d.provider || 'unknown')} • ${escapeHtml(d.quality || 'Standard')}</div>
                ${d.error && !isDone ? `<p class="text-[10px] text-red-400/90 mt-1 break-words">${escapeHtml(d.error)}</p>` : ''}
              </div>
              <div class="text-right min-w-[64px]">
                <div class="text-xs font-mono ${isDone ? 'text-emerald-400' : 'text-slate-400'}">${formatBytes(d.downloadedBytes || 0)}${total ? ' / ' + formatBytes(total) : ''}</div>
                ${formatSpeed(d.speed) ? `<div class="text-[9px] text-slate-600 font-mono">${formatSpeed(d.speed)}</div>` : ''}
                <div class="text-[9px] text-slate-600 font-mono">${pct}%</div>
              </div>
            </div>
            <div class="w-full bg-[#211d19] rounded-full h-1.5 border border-[#2f2924] overflow-hidden" role="progressbar" aria-label="Download progress for ${escapeHtml(d.title || 'item')}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
              <div class="bg-amber-500 h-full rounded-full transition-all duration-300" style="width:${pct}%"></div>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              ${isDone && fileUrl ? `
                <a href="${escapeHtml(fileUrl)}" download class="px-2 py-1 rounded bg-emerald-950/50 hover:bg-emerald-900 text-emerald-300 font-mono border border-emerald-800/70 transition flex items-center gap-1" title="Open the downloaded file">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  <span>Open</span>
                </a>
              ` : ''}
              ${isActive ? `
                <button type="button" data-action="dl-toggle" data-dl-id="${escapeHtml(d.id)}" class="px-2 py-1 rounded bg-[#211d19] hover:bg-amber-600 text-slate-200 hover:text-white font-mono border border-transparent transition flex items-center gap-1" title="Pause download">
                  <svg class="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6" /></svg>
                  <span>Pause</span>
                </button>
              ` : ''}
              ${canResume ? `
                <button type="button" data-action="dl-toggle" data-dl-id="${escapeHtml(d.id)}" class="px-2 py-1 rounded bg-[#211d19] hover:bg-emerald-900 text-emerald-300 font-mono border border-emerald-800/60 transition flex items-center gap-1" title="${status === 'failed' ? 'Retry download' : 'Resume download'}">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6-6" /></svg>
                  <span>${status === 'failed' ? 'Retry' : 'Resume'}</span>
                </button>
              ` : ''}
              ${canCancel ? `
                <button type="button" data-action="dl-cancel" data-dl-id="${escapeHtml(d.id)}" class="px-2 py-1 rounded bg-red-950/30 hover:bg-red-900/60 text-red-300 hover:text-white font-mono border border-red-800/50 transition flex items-center gap-1" title="Cancel download">
                  <span>Cancel</span>
                </button>
              ` : ''}
              <button type="button" data-action="dl-remove" data-dl-id="${escapeHtml(d.id)}" class="ml-auto p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-950/20 transition" title="${isDone ? 'Delete downloaded file' : 'Remove from queue'}">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/** Enqueue a single stream as a downloadable item. */
function queueDownloadFromStream(mirror, media) {
  const url = String(mirror?.resolverUrl || '').trim();
  if (!url) {
    showToast('No direct stream URL is available to queue.', 'error');
    return;
  }
  if (/\.m3u8(?:[?#]|$)/i.test(url)) {
    showToast('HLS playlists cannot be queued as a single file. Use a direct MP4/MKV mirror.', 'error');
    return;
  }

  const title = String(media?.title || 'Untitled');
  const label = String(mirror.label || 'source').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'source';
  const extensionMatch = url.match(/\.(mp4|mkv|webm|mov|avi|ts)(?:[?#]|$)/i);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '.mp4';
  const filename = `${title}-${label}`.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) + extension;
  const id = downloadIdFor(url, title);

  const existing = downloads.find((item) => String(item.id) === id);
  if (existing) {
    showToast('This stream is already in Downloads.', 'info');
    return;
  }

  const body = {
    id,
    title,
    type: media?.type === 'series' ? 'series' : 'movie',
    provider: label,
    url,
    filename,
    quality: mirror.quality || 'Standard',
    headers: mirror.headers || undefined,
    cookie: mirror.signCookie || '',
  };

  apiDownload('', 'POST', body)
    .then(() => {
      showToast('Added to Downloads. Open My Library → Downloads to track it.');
      return fetchDownloads();
    })
    .catch((err) => showToast(err.message || 'Could not queue download.', 'error'));
}

function openLibraryModal(initialTab = 'watchlist') {
  activeLibraryTab = initialTab;
  switchLibraryTab(initialTab);
  if (libraryModal) {
    libraryModal.classList.remove('hidden');
    libraryModal.style.display = 'flex';
  }
  if (initialTab === 'downloads') startDownloadsPoll();
}

function closeLibraryModal() {
  if (libraryModal) {
    libraryModal.classList.add('hidden');
    libraryModal.style.display = 'none';
  }
  stopDownloadsPoll();
}

function switchLibraryTab(tabName) {
  const tab = ['watchlist', 'history', 'downloads'].includes(tabName) ? tabName : 'watchlist';
  activeLibraryTab = tab;

  const setTabButton = (button, active) => {
    if (!button) return;
    button.className = active
      ? 'pb-3 px-1 border-b-2 border-amber-400 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition'
      : 'pb-3 px-1 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-semibold text-xs flex items-center gap-2 cursor-pointer transition';
    button.setAttribute('aria-selected', String(active));
  };
  setTabButton(tabWatchlistBtn, tab === 'watchlist');
  setTabButton(tabHistoryBtn, tab === 'history');
  setTabButton(tabDownloadsBtn, tab === 'downloads');

  libraryWatchlistContainer?.classList.toggle('hidden', tab !== 'watchlist');
  libraryHistoryContainer?.classList.toggle('hidden', tab !== 'history');
  libraryDownloadsContainer?.classList.toggle('hidden', tab !== 'downloads');
  clearHistoryBtn?.classList.toggle('hidden', tab !== 'history');

  if (tab === 'watchlist') {
    stopDownloadsPoll();
    renderWatchlistTab();
  } else if (tab === 'history') {
    stopDownloadsPoll();
    renderHistoryTab();
  } else {
    renderDownloadsTab();
    startDownloadsPoll();
  }
}

let activeGenre = null;
// One in-flight catalog/search request at a time. This prevents a slow earlier
// response from overwriting the results of a newer query and cancels work the
// user no longer needs.
let browseController = null;

function beginBrowseRequest() {
  browseController?.abort();
  const controller = new AbortController();
  browseController = controller;
  // A previous search may have been aborted in flight; do not leave its busy
  // state stuck when the replacement request is a catalog load.
  searchBtn.disabled = false;
  searchBtnText.textContent = 'Search';
  searchSpinner.classList.add('hidden');
  return controller;
}

function isCurrentBrowseRequest(controller) {
  return browseController === controller;
}

function finishBrowseRequest(controller) {
  if (browseController === controller) browseController = null;
}

/**
 * 1. searchMovies(query, provider, genre)
 * Calls GET /api/search?q=<query>&provider=<provider>&genre=<genre>
 */
async function searchMovies(query, provider = 'all', genre = null, page = 1, signal = undefined) {
  let url = `/api/search?q=${encodeURIComponent(query)}`;
  if (provider && provider !== 'all') {
    url += `&provider=${encodeURIComponent(provider)}`;
  }
  const effectiveGenre = genre || activeGenre;
  if (effectiveGenre) {
    url += `&genre=${encodeURIComponent(effectiveGenre)}`;
  }
  url += `&page=${encodeURIComponent(page)}`;

  const response = await fetch(url, { signal });
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
function showSearchResults(results, append = false) {
  if (append) {
    const merged = new Map(currentResults.map((item) => [`${item.provider || ''}::${item.subjectId}`, item]));
    for (const item of results || []) {
      const key = `${item.provider || ''}::${item.subjectId}`;
      if (!merged.has(key)) merged.set(key, item);
    }
    currentResults = [...merged.values()];
  } else {
    currentResults = results || [];
  }

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
    if (resultContext.kind === 'catalog') {
      const catalogName = resultContext.genre === 'drama'
        ? 'Asian Drama'
        : resultContext.genre === 'anime'
          ? 'Anime'
          : 'this catalog';
      if (emptyStateTitle) emptyStateTitle.textContent = `No titles available in ${catalogName}`;
      if (emptyStateMessage) {
        emptyStateMessage.textContent = 'The selected catalog providers returned no titles right now. Try again later or search for a specific title.';
      }
    } else {
      if (emptyStateTitle) emptyStateTitle.textContent = 'No media titles found';
      if (emptyStateMessage) {
        emptyStateMessage.textContent = 'Try checking for typos, selecting "All Providers", or searching another title.';
      }
    }
    emptyState.classList.remove('hidden');
    if (loadMoreBtn && currentResults.length === 0) loadMoreBtn.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  resultsGrid.innerHTML = filtered.map((item) => {
    const isMovie = item.type === 'movie';
    const isSeries = item.type === 'series';
    const typeLabel = isMovie ? 'Movie' : isSeries ? 'Series' : 'Type unavailable';
    const typeClass = isMovie ? 'badge-movie' : isSeries ? 'badge-series' : 'bg-slate-700 text-slate-300';
    const typeDescription = isMovie ? 'Feature Film' : isSeries ? 'TV Series' : 'Media type unavailable';
    const posterUrl = safeImageUrl(item.poster, POSTER_FALLBACK);
    const safeTitle = escapeHtml(item.title);
    const yearDisplay = item.year ? escapeHtml(String(item.year)) : 'HD';
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
            decoding="async"
            class="poster-img"
          />

          <!-- Quality Badge Top-Left -->
          <div class="absolute top-2 left-2">
            <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-black/80 backdrop-blur-md text-emerald-400 border border-emerald-500/30 shadow">
              ${qualityBadge}
            </span>
          </div>

          <!-- Type Badge & Watchlist Quick Toggle Top-Right -->
          <div class="absolute top-2 right-2 flex items-center gap-1.5 z-10">
            <span class="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded shadow ${typeClass}">
              ${typeLabel}
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
              <span>${typeDescription}</span>
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
  modalSubjectId.textContent = `ID: ${movie.subjectId || ''}`;
  modalPoster.src = normalizeImageUrl(movie.poster, POSTER_FALLBACK);

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
  if (modalCountry) {
    const country = movie.country || '';
    modalCountry.textContent = country;
    modalCountry.classList.toggle('hidden', !country);
  }
  modalDuration.textContent = movie.duration || (isSeries ? 'Multi-Episode' : 'N/A');

  // Rating
  if (movie.rating) {
    modalRating.textContent = `IMDb ${movie.rating}`;
    modalRatingBadge.classList.remove('hidden');
  } else {
    modalRatingBadge.classList.add('hidden');
  }

  // Genres
  const displayGenres = Array.isArray(movie.genres)
    ? movie.genres.filter((genre) => String(genre) !== String(movie.country || '') && !/^(19|20)\d{2}$/.test(String(genre)))
    : [];
  if (displayGenres.length > 0) {
    modalGenres.innerHTML = displayGenres.map(g =>
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

  // Reset video player and streams view. Clear the previous title's stream
  // context after progress is saved so its episode row cannot stay highlighted
  // and the Next Episode button cannot point at the old series.
  closeVideoPlayer();
  activeStreamContext = { id: '', provider: movie.provider || 'addon' };
  markSelectedEpisode(null, null);
  updateNextEpisodeUi();
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
    const filteredEpisodes = filterSeriesEpisodesForAudio(episodes, selectedAudio, series);

    // CRITICAL: If no playable episodes match this season for the selected audio, DO NOT RENDER THIS SEASON!
    if (filteredEpisodes.length === 0) continue;

    const episodesHtml = filteredEpisodes.map((episode, idx) => {
      const epNum = getEpisodeDisplayNumber(episode, idx);
      const targetId = episode.streamId || episode.link || series.subjectId;
      const audioLabel = getEpisodeAudioLabel(episode, series) || 'original';
      const audioBadge = `<span class="text-[10px] uppercase tracking-wide text-amber-400 font-mono font-bold">${escapeHtml(audioLabel)}</span>`;

      return `
        <div class="episode-row flex items-center justify-between p-2.5 rounded-lg bg-[#0c0b0a] border border-[#2f2924] text-xs hover:border-slate-500 transition gap-2">
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
            data-season="${escapeHtml(String(getSeasonNumberFromValue(s) ?? s.seasonNumber ?? 1))}"
            data-episode="${epNum}"
            data-audio="${escapeHtml(audioLabel)}"
            aria-pressed="false"
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

  if (activeStreamContext?.season != null && activeStreamContext?.episode != null) {
    markSelectedEpisode(
      activeStreamContext.season,
      activeStreamContext.episode,
      activeStreamContext.audio
    );
  }
}

// Bind once on the stable container so rerendering the season list does not
// accumulate handlers or consume the handler after the first episode click.
seriesSeasonsList?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="load-streams"]');
  if (!btn) return;
  const { streamId, provider: prov, epTitle, season, episode, audio } = btn.dataset;
  loadStreams(streamId, prov, {
    title: epTitle,
    season: parseInt(season, 10),
    episode: parseInt(episode, 10),
    audio: audio || null,
  });
});

/**
 * 5. loadStreams(id, provider)
 * Calls GET /api/streams/:id?provider=<provider>
 */
async function loadStreams(id, provider = 'addon', episodeContext = null) {
  cancelAutoSwitchResolution();
  autoSwitchGeneration += 1;
  autoSwitchResolutionPending = false;
  // Remember which media these streams belong to (used for auto-fallback on failure)
  activeStreamContext = {
    id,
    provider,
    season: episodeContext?.season || null,
    episode: episodeContext?.episode || null,
    audio: episodeContext?.audio || null,
  };
  markSelectedEpisode(
    activeStreamContext.season,
    activeStreamContext.episode,
    activeStreamContext.audio
  );
  updateNextEpisodeUi();
  autoSwitchResolutionTried = false;
  autoSwitchCandidates = [];
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
      activeStreamContext = {
        id: data.streamId || data.subjectId,
        provider: data.provider,
        season: episodeContext?.season || null,
        episode: episodeContext?.episode || null,
        audio: episodeContext?.audio || null,
      };
      updateNextEpisodeUi();
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
      mirrorStore.push({
        url: primaryMirror?.resolverUrl || '',
        title: primaryPlayTitle,
        label: r.quality || 'Source',
        quality: r.quality || 'Standard',
        cookie: primaryMirror?.signCookie || '',
        headers: primaryMirror?.headers || null,
        type: primaryMirror?.type || r.codec || '',
        subtitles: primaryMirror?.subtitles || r.subtitles || [],
      });

      return `
        <div class="release-card space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                ${escapeHtml(r.quality || 'Standard')}
              </span>
              <span class="text-xs font-mono text-emerald-400 uppercase bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">
                ${escapeHtml(r.provider || provider)}
              </span>
              ${r.codec ? `<span class="text-xs font-mono text-slate-400 uppercase bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">${escapeHtml(r.codec)}</span>` : ''}
              ${sizeFormatted ? `<span class="text-xs font-mono text-cyan-300">${sizeFormatted}</span>` : ''}
              ${r.language ? `<span class="text-xs text-slate-300 bg-[#0c0b0a] px-2 py-0.5 rounded border border-[#2f2924]">${escapeHtml(r.language)}</span>` : ''}
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

                <button
                  type="button"
                  data-action="queue-download"
                  data-mirror-index="${primaryIdx}"
                  class="px-3 py-1.5 rounded-lg bg-[#211d19] hover:bg-emerald-900 text-emerald-300 border border-emerald-800/70 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  title="Add to the resumable Downloads queue"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>Queue</span>
                </button>
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
                mirrorStore.push({
                  url: m.resolverUrl,
                  title: mPlayTitle,
                  label: m.label || 'Mirror',
                  quality: r.quality || 'Standard',
                  cookie: m.signCookie || '',
                  headers: m.headers || null,
                  type: m.type || r.codec || '',
                  subtitles: m.subtitles || r.subtitles || [],
                });
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
                      type="button"
                      data-action="queue-download"
                      data-mirror-index="${mIdx}"
                      class="px-2.5 py-1 rounded bg-[#211d19] hover:bg-emerald-900 text-emerald-300 font-mono text-[11px] border border-emerald-800/70 transition flex items-center gap-1"
                      title="Add to the resumable Downloads queue"
                    >
                      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Queue</span>
                    </button>
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
    const error = document.createElement('div');
    error.className = 'p-4 bg-red-950/40 rounded-xl border border-red-800 text-red-300 text-xs';
    error.textContent = `Failed to fetch streaming sources: ${err.message}`;
    streamsList.replaceChildren(error);
  }
}

/**
 * Embedded Video Player Controller
 */
/**
 * Destroy any active hls.js instance and detach it from the video element.
 */
function destroyHls() {
  if (hlsStartupTimer) {
    clearTimeout(hlsStartupTimer);
    hlsStartupTimer = null;
  }
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

function normalizeSubtitleTracks(subtitles) {
  let values = subtitles;
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values);
    } catch {
      values = /^https?:\/\//i.test(values.trim()) ? [{ url: values.trim() }] : [];
    }
  }
  if (!Array.isArray(values)) {
    values = values && typeof values === 'object' ? Object.values(values) : [];
  }

  return values.flatMap((entry, index) => {
    const track = typeof entry === 'string' ? { url: entry } : entry;
    if (!track || typeof track !== 'object') return [];
    const rawUrl = String(
      track.url || track.uri || track.src || track.link || track.file ||
      track.fileUrl || track.subtitleUrl || track.subtitle || ''
    ).trim();
    if (!rawUrl) return [];
    let url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    try {
      const parsed = new URL(url, window.location.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      url = parsed.href;
    } catch {
      return [];
    }
    const language = String(track.language || track.lang || track.srclang || '').trim();
    const label = String(track.label || track.title || track.name || language || `Subtitle ${index + 1}`).trim();
    const languageLabel = `${language} ${label}`.toLowerCase();
    const isEnglish = /(^|[^a-z])(english|eng|en)(?=$|[^a-z])/.test(languageLabel);
    const isBengali = /(^|[^a-z])(bengali|bangla|ben|bn)(?=$|[^a-z])/.test(languageLabel);
    if (!isEnglish && !isBengali) return [];
    const languageCode = language.match(/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i)?.[0] || '';
    return [{ url, label, languageCode: languageCode || (isEnglish ? 'en' : 'bn') }];
  });
}

function setSubtitleTracks(subtitles) {
  if (!subtitleSelect || !videoPlayer) return;
  const tracks = normalizeSubtitleTracks(subtitles);
  videoPlayer.querySelectorAll('track[data-player-subtitle]').forEach((track) => track.remove());
  const offOption = document.createElement('option');
  offOption.value = 'off';
  offOption.textContent = 'Off';
  subtitleSelect.replaceChildren(offOption);
  subtitleSelect.disabled = tracks.length === 0;
  if (subtitleStatus) {
    subtitleStatus.textContent = tracks.length ? `${tracks.length} available` : 'No English or Bengali subtitles available for this source';
  }

  tracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = track.label;
    subtitleSelect.add(option);
    const element = document.createElement('track');
    element.kind = 'subtitles';
    element.label = track.label;
    if (track.languageCode) element.srclang = track.languageCode;
    element.src = `/api/subtitle?url=${encodeURIComponent(track.url)}`;
    element.dataset.playerSubtitle = String(index);
    videoPlayer.append(element);
  });
  subtitleSelect.value = 'off';
  updatePlayerControls();
}

/**
 * Audio track switching — the web counterpart of the Vega app's audio
 * selector. Two runtimes are supported:
 *   • hls.js  — `hls.audioTracks` (multi-audio HLS master playlists with
 *               #EXT-X-MEDIA renditions, e.g. dual-audio anime/drama sources)
 *   • Safari  — HTMLMediaElement.audioTracks (native HLS via WebKit)
 * MP4 sources with muxed multi-audio never expose switchable tracks in the
 * browser, so the selector stays disabled and mirror-level language picks
 * (castle per-language mirrors etc.) remain the way to change audio there.
 */
let currentAudioTracks = [];        // [{ value, label, token, isDefault }]
let audioPreferenceApplied = false; // true once the saved preference was applied for this source

function savedAudioPreference() {
  try {
    const value = localStorage.getItem(AUDIO_PREFERENCE_KEY);
    return typeof value === 'string' && value !== '' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function resetAudioTrackUi() {
  currentAudioTracks = [];
  audioPreferenceApplied = false;
  if (audioSelect) {
    const autoOption = document.createElement('option');
    autoOption.value = 'auto';
    autoOption.textContent = 'Default';
    audioSelect.replaceChildren(autoOption);
    audioSelect.value = 'auto';
    audioSelect.disabled = true;
  }
  updatePlayerControls();
}

/**
 * Rebuilds the audio select from a normalized track list.
 * Returns true when the select now exposes switchable tracks.
 */
function populateAudioSelect(tracks) {
  if (!audioSelect) return false;
  currentAudioTracks = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  const autoOption = document.createElement('option');
  autoOption.value = 'auto';
  autoOption.textContent = 'Default';
  audioSelect.replaceChildren(autoOption);

  let preselect = '';
  const saved = audioPreferenceApplied ? '' : savedAudioPreference();
  currentAudioTracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = track.value;
    option.textContent = track.label;
    option.dataset.audioDefault = String(Boolean(track.isDefault));
    audioSelect.add(option);
    if (!preselect && saved && saved !== 'auto' && track.token === saved) {
      preselect = track.value;
    }
  });

  const switchable = currentAudioTracks.length > 1;
  audioSelect.disabled = !switchable;
  if (preselect) {
    audioSelect.value = preselect;
    audioPreferenceApplied = true;
    applyAudioSelection(audioSelect.value); // apply saved language for this source
  } else {
    audioSelect.value = 'auto';
  }
  updatePlayerControls();
  return switchable;
}

/** Persist + apply an audio selection against the active runtime. */
function applyAudioSelection(value) {
  const isHls = Boolean(
    hlsPlayerInstance && Array.isArray(hlsPlayerInstance.audioTracks) && hlsPlayerInstance.audioTracks.length
  );
  if (isHls) {
    if (value === 'auto' || value === '') {
      const defaultValue = firstDefaultAudioTrackValue(hlsPlayerInstance);
      if (defaultValue !== null) hlsPlayerInstance.audioTrack = defaultValue;
    } else {
      const trackId = Number(value);
      if (Number.isFinite(trackId)) hlsPlayerInstance.audioTrack = trackId;
    }
  } else if (videoPlayer && typeof videoPlayer.audioTracks === 'object' && videoPlayer.audioTracks) {
    const nativeTracks = Array.from(videoPlayer.audioTracks);
    if (!nativeTracks.length) return;
    nativeTracks.forEach((track, index) => {
      const trackValue = String(track.id ?? index);
      track.enabled = value === trackValue;
    });
  } else {
    return; // nothing to switch on muxed MP4 audio
  }

  const meta = currentAudioTracks.find((track) => track.value === value);
  try {
    localStorage.setItem(AUDIO_PREFERENCE_KEY, value === 'auto' || !meta ? 'auto' : meta.token);
  } catch { /* optional */ }
  audioPreferenceApplied = true;
  updatePlayerControls();
}

/** hls.js 'auto' resolves to the rendition flagged default/autoselect, else track 0. */
function firstDefaultAudioTrackValue(hls) {
  const list = hls.audioTracks || [];
  if (!list.length) return null;
  const defIndex = list.findIndex((t) => t && (t.default || t.autoselect));
  const track = defIndex !== -1 ? list[defIndex] : list[0];
  const id = track && track.id !== undefined ? track.id : (defIndex !== -1 ? defIndex : 0);
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Keeps currentAudioTracks/select in sync with the active hls.js instance. */
function syncHlsAudioTracks(hls) {
  if (!hls || !Array.isArray(hls.audioTracks)) return;
  const tracks = hls.audioTracks.map((track, index) => {
    const language = String(track.language || '').trim();
    const name = String(track.name || '').trim();
    const label = [
      name || language || `Audio ${index + 1}`,
      language && language.toUpperCase() !== name.toUpperCase() ? language.toUpperCase() : '',
    ].filter(Boolean).join(' · ');
    return {
      value: String(track.id ?? index),
      label,
      token: (language || name).toLowerCase(),
      isDefault: Boolean(track.default || track.autoselect),
    };
  });
  populateAudioSelect(tracks);
}

/** Safari/WebKit path for native HLS playback. */
function syncNativeAudioTracks() {
  if (!videoPlayer || hlsPlayerInstance) return; // hls.js manages its own list
  const nativeTracks = typeof videoPlayer.audioTracks === 'object' && videoPlayer.audioTracks
    ? Array.from(videoPlayer.audioTracks)
    : [];
  if (!nativeTracks.length) return;
  populateAudioSelect(
    nativeTracks.map((track, index) => {
      const language = String(track.language || '').trim();
      const label = String(track.label || '').trim() || language.toUpperCase() || `Audio ${index + 1}`;
      return {
        value: String(track.id ?? index),
        label,
        token: (language || label).toLowerCase(),
        isDefault: Boolean(track.enabled),
      };
    })
  );
}

audioSelect?.addEventListener('change', () => applyAudioSelection(audioSelect.value));
videoPlayer?.addEventListener('loadedmetadata', syncNativeAudioTracks);

function playStreamSource(rawUrl, title, cookie = '', forceProxy = false, streamHeaders = null, subtitles = currentPlayback.subtitles, streamType = '') {
  if (!rawUrl) return;

  // A manual source pick supersedes any provider-resolution request still in flight.
  cancelAutoSwitchResolution();
  savePlaybackProgress();
  cancelAutoNext();
  autoNextDismissed = false;
  // Always destroy any previous hls.js instance before loading a new source.
  if (hlsStartupTimer) {
    clearTimeout(hlsStartupTimer);
    hlsStartupTimer = null;
  }
  destroyHls();
  resetAudioTrackUi();

  // Normalize protocol-relative URLs (e.g. //host/path) that some mirrors return
  let url = String(rawUrl).trim();
  if (url.startsWith('//')) url = 'https:' + url;

  currentPlayback.rawUrl = url;
  currentPlayback.title = title;
  currentPlayback.cookie = cookie;
  currentPlayback.headers = streamHeaders;
  currentPlayback.streamType = streamType;
  currentPlayback.subtitles = subtitles || [];
  setSubtitleTracks(currentPlayback.subtitles);
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
      streamSubjectId: activeStreamContext?.id,
      streamProvider: activeStreamContext?.provider,
    });
  }

  playerContainer.classList.remove('hidden');
  playerContainer.style.display = 'block';
  playerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setPlayerLoading(true);

  // ── HLS / M3U8 branch ────────────────────────────────────────────────────
  // Route through /api/proxy-hls so relative segment URLs are rewritten and
  // CORS is handled server-side. Wire Hls.Events.ERROR for fatal network
  // failures so the player auto-switches to another provider mirror.
  if (/\.m3u8(\?|#|$)/i.test(url) || /^(?:m3u8|hls)$/i.test(streamType)) {
    const hlsParams = new URLSearchParams({ url });
    if (cookie) hlsParams.set('cookie', cookie);
    if (streamHeaders && typeof streamHeaders === 'object' && Object.keys(streamHeaders).length) {
      hlsParams.set('headers', JSON.stringify(streamHeaders));
    }
    const hlsProxyUrl = `/api/proxy-hls?${hlsParams.toString()}`;

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ startLevel: -1 }); // -1 = auto quality
      hlsPlayerInstance = hls;
      // Dynamic/a-demuxed playlists resolve their audio renditions later.
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => syncHlsAudioTracks(hls));
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (!audioSelect || !data || data.id === undefined || data.id === null) return;
        const value = String(data.id);
        if (Array.from(audioSelect.options).some((option) => option.value === value)) {
          audioSelect.value = value;
          // Sync UI state but don't re-apply selection as it's already switched
          audioPreferenceApplied = true;
          updatePlayerControls();
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        syncHlsAudioTracks(hls); // multi-audio masters expose renditions here
        videoPlayer.play().catch((e) => console.warn('HLS play() blocked:', e?.name));
        hlsStartupTimer = setTimeout(() => {
          hlsStartupTimer = null;
          if (videoPlayer.currentTime > 0 || videoPlayer.readyState >= 2) return;
          if (attemptAutomaticFallback(url, 'HLS source is not starting — checking another source...')) return;
          if (!activeStreamContext.id || autoSwitchResolutionTried) {
            showError('This HLS source is not delivering playable media. Try another mirror.');
            return;
          }
        }, 15000);
      });

      // A4 fix: wire HLS fatal network errors to the same auto-switch path
      // that the plain <video> onerror uses. Non-fatal errors are ignored —
      // hls.js recovers from them internally.
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        console.warn(`HLS fatal error: type=${data.type} details=${data.details}`);
        const fallbackMessage = data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? 'HLS source failed — checking another source...'
          : 'HLS media failed — checking another source...';
        if (attemptAutomaticFallback(url, fallbackMessage)) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          showError('HLS network error — check your connection or try another mirror.');
        } else {
          showError('HLS playback error — try another mirror or source.');
        }
      });

      hls.loadSource(hlsProxyUrl);
      hls.attachMedia(videoPlayer);

    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS) — point directly at the proxy URL
      videoPlayer.src = hlsProxyUrl;
      videoPlayer.load();
      videoPlayer.play().catch((e) => console.warn('Native HLS play() blocked:', e?.name));
    } else {
      // No HLS support at all — fall back to opening externally
      setPlayerLoading(false);
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
      playStreamSource(url, title, cookie, true, streamHeaders, subtitles);
      return;
    }
    // Proxied playback failed. If we haven't already tried switching providers
    // for this media, ask the server to resolve a working source on ANY provider
    // and retry playback transparently.
    if (attemptAutomaticFallback(url, 'Source unavailable — switching to another provider...')) {
      console.warn(`Playback failed (${code}). Trying another provider automatically...`);
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
async function autoSwitchToWorkingSource(failedUrl, generation = autoSwitchGeneration) {
  const { id, provider } = activeStreamContext;
  if (!id) return;

  autoSwitchController?.abort();
  const controller = new AbortController();
  autoSwitchController = controller;
  autoSwitchResolutionPending = true;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 40000);

  try {
    const titleParam = activeMedia?.title ? `&title=${encodeURIComponent(activeMedia.title)}` : '';
    const yearParam = activeMedia?.year ? `&year=${encodeURIComponent(activeMedia.year)}` : '';
    const typeParam = activeMedia?.type ? `&type=${encodeURIComponent(activeMedia.type)}` : '';

    const res = await fetch(
      `/api/resolve-source?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider || 'movieBoxWeb')}${titleParam}${yearParam}${typeParam}`,
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

    const data = await res.json();
    if (generation !== autoSwitchGeneration || autoSwitchController !== controller) return;
    const pool = [data.source, ...(data.alternatives || [])]
      .filter((candidate) => candidate?.url && candidate.url !== failedUrl);
    const seen = new Set();
    autoSwitchCandidates = pool.filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
    tryNextFallbackSource(failedUrl);
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (timedOut && generation === autoSwitchGeneration) {
        showError('Source switch timed out. Try another mirror or refresh the sources.');
      }
      return;
    }
    if (generation === autoSwitchGeneration) {
      showError('Provider switch failed: ' + err.message);
    }
  } finally {
    clearTimeout(timeout);
    if (autoSwitchController === controller) autoSwitchController = null;
    if (generation === autoSwitchGeneration) autoSwitchResolutionPending = false;
  }
}

function attemptAutomaticFallback(failedUrl, message) {
  if (autoSwitchCandidates.length) {
    hideError();
    tryNextFallbackSource(failedUrl);
    return true;
  }
  if (autoSwitchResolutionPending) return true;
  if (!autoSwitchResolutionTried && activeStreamContext.id) {
    autoSwitchResolutionTried = true;
    autoSwitchResolutionPending = true;
    showError(message);
    autoSwitchToWorkingSource(failedUrl, autoSwitchGeneration);
    return true;
  }
  return false;
}

function tryNextFallbackSource(failedUrl) {
  const next = autoSwitchCandidates.shift();
  if (!next) {
    showError('No playable alternate source is available for this title right now.');
    return;
  }
  if (next.url === failedUrl) {
    tryNextFallbackSource(failedUrl);
    return;
  }
  hideError();
  console.log(`Auto-switched source to provider: ${next.provider || 'unknown'}`);
  const baseTitle = autoSwitchBaseTitle || currentPlayback.title || activeMedia?.title || 'Video';
  playStreamSource(
    next.url,
    `${baseTitle} (${next.provider || 'alt provider'})`,
    next.cookie || '',
    true,
    next.headers || null,
    currentPlayback.subtitles,
    next.type || next.codec || ''
  );
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
  if (Number.isFinite(videoPlayer?.currentTime) && videoPlayer.currentTime > 0) {
    pendingResumeSeconds = videoPlayer.currentTime;
  }
  currentPlayback.allowDirect = goingDirect;
  currentPlayback.isProxied = !goingDirect;
  playStreamSource(currentPlayback.rawUrl, currentPlayback.title, currentPlayback.cookie, !goingDirect, currentPlayback.headers, currentPlayback.subtitles, currentPlayback.streamType);
}

function closeVideoPlayer() {
  cancelAutoNext();
  hideSeekFeedback();
  activeScrub = null;
  hideSeekTooltip();
  if (playerControlsTimeout) {
    clearTimeout(playerControlsTimeout);
    playerControlsTimeout = null;
  }
  clearSleepTimer();
  cancelAutoSwitchResolution();
  autoSwitchGeneration += 1;
  autoSwitchResolutionPending = false;
  savePlaybackProgress();
  currentPlayback.historyId = null;
  pendingResumeSeconds = 0;
  autoSwitchCandidates = [];
  autoSwitchBaseTitle = '';
  if (hlsStartupTimer) {
    clearTimeout(hlsStartupTimer);
    hlsStartupTimer = null;
  }
  destroyHls();
  if (videoPlayer) {
    videoPlayer.onerror = null;
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.querySelectorAll('track[data-player-subtitle]').forEach((track) => track.remove());
    videoPlayer.load();
  }
  setPlayerLoading(false);
  if (subtitleSelect) {
    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = 'Off';
    subtitleSelect.replaceChildren(offOption);
    subtitleSelect.disabled = true;
  }
  if (subtitleStatus) subtitleStatus.textContent = '';
  resetAudioTrackUi();
  if (playbackRateSelect) playbackRateSelect.value = '1';
  if (videoPlayer) videoPlayer.playbackRate = 1;
  currentPlayback.subtitles = [];
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
async function loadCatalogHomepage(provider = selectedProvider, genre = activeGenre, page = 1, append = false) {
  hideError();
  if (welcomeState) welcomeState.classList.add('hidden');
  emptyState.classList.add('hidden');
  if (!append) {
    resultsGrid.innerHTML = '';
    loadingState.classList.remove('hidden');
    resultContext = { kind: 'catalog', query: '', provider, genre };
    resultPage = 1;
    if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
    if (heroCarouselSection) heroCarouselSection.classList.add('hidden');
  } else if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading...';
  }

  const provLabel = providerStyles[provider]?.label || provider;
  const catalogLabel = genre === 'drama'
    ? 'Asian Drama'
    : genre === 'anime'
      ? 'Anime'
      : (provider === 'all' || !provider)
        ? 'Featured Catalog & Trending'
        : `${provLabel} • Catalog Homepage`;
  resultsTitle.textContent = catalogLabel;
  resultsCount.textContent = 'Loading catalog...';
  const controller = beginBrowseRequest();

  try {
    const provParam = provider || 'movieBoxWeb';
    let url = `/api/catalog/homepage?provider=${encodeURIComponent(provParam)}`;
    if (genre) url += `&genre=${encodeURIComponent(genre)}`;
    url += `&page=${encodeURIComponent(page)}`;

    const res = await fetch(url, { signal: controller.signal });
    if (!isCurrentBrowseRequest(controller)) return;
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to load catalog homepage: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!isCurrentBrowseRequest(controller)) return;
    const items = data.results || [];
    if (items.length > 0) {
      if (!append) {
        populateHeroCarousel(items);
        renderContinueWatchingStrip();
      }
      showSearchResults(items, append);
      resultPage = page;
      if (loadMoreBtn) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More Titles';
      }
      resultsTitle.textContent = catalogLabel;
    } else {
      if (!append) showSearchResults([]);
      if (loadMoreBtn) {
        loadMoreBtn.classList.add('hidden');
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More Titles';
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || !isCurrentBrowseRequest(controller)) return;
    console.warn('Catalog homepage load fallback:', err.message);
    if (!append) showSearchResults([]);
    showError(err.message || 'Failed to load catalog homepage');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Retry Loading More';
    }
    if (append) throw err;
  } finally {
    if (isCurrentBrowseRequest(controller)) {
      if (!append) loadingState.classList.add('hidden');
      finishBrowseRequest(controller);
    }
  }
}

/**
 * Perform Search Handler
 */
async function handleSearch(query) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return;

  saveSearchTerm(cleanQuery);
  closeSearchSuggestions();
  hideError();
  if (welcomeState) welcomeState.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsGrid.innerHTML = '';
  loadingState.classList.remove('hidden');
  resultPage = 1;
  resultContext = { kind: 'search', query: cleanQuery, provider: selectedProvider, genre: activeGenre };
  if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
  if (heroCarouselSection) heroCarouselSection.classList.add('hidden');
  const cwSection = document.getElementById('continueWatchingSection');
  if (cwSection) cwSection.classList.add('hidden');

  const controller = beginBrowseRequest();
  searchBtn.disabled = true;
  searchBtnText.textContent = 'Searching...';
  searchSpinner.classList.remove('hidden');
  resultsTitle.textContent = `Results for "${cleanQuery}"`;

  try {
    const data = await searchMovies(cleanQuery, selectedProvider, activeGenre, 1, controller.signal);
    if (!isCurrentBrowseRequest(controller)) return;
    showSearchResults(data.results || []);
    if (loadMoreBtn && data.results?.length) {
      loadMoreBtn.classList.remove('hidden');
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load More Titles';
    }
  } catch (err) {
    if (err?.name === 'AbortError' || !isCurrentBrowseRequest(controller)) return;
    showError(err.message);
  } finally {
    if (isCurrentBrowseRequest(controller)) {
      loadingState.classList.add('hidden');
      searchBtn.disabled = false;
      searchBtnText.textContent = 'Search';
      searchSpinner.classList.add('hidden');
      finishBrowseRequest(controller);
    }
  }
}

async function loadMoreResults() {
  if (loadingMoreResults || !loadMoreBtn || loadMoreBtn.classList.contains('hidden')) return;
  loadingMoreResults = true;
  const nextPage = resultPage + 1;
  const contextSnapshot = resultContext;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';
  let controller = null;
  try {
    if (contextSnapshot.kind === 'search') {
      controller = beginBrowseRequest();
      const data = await searchMovies(
        contextSnapshot.query,
        contextSnapshot.provider,
        contextSnapshot.genre,
        nextPage,
        controller.signal
      );
      if (!isCurrentBrowseRequest(controller) || resultContext !== contextSnapshot) return;
      if (!data.results?.length) {
        loadMoreBtn.classList.add('hidden');
        return;
      }
      showSearchResults(data.results, true);
      resultPage = nextPage;
    } else {
      await loadCatalogHomepage(
        contextSnapshot.provider,
        contextSnapshot.genre,
        nextPage,
        true
      );
      if (resultContext !== contextSnapshot || loadMoreBtn.classList.contains('hidden')) return;
    }
    loadMoreBtn.textContent = 'Load More Titles';
  } catch (err) {
    if (err?.name === 'AbortError' || resultContext !== contextSnapshot) return;
    showError(err.message || 'Failed to load more titles');
    loadMoreBtn.textContent = 'Retry Loading More';
  } finally {
    if (controller) finishBrowseRequest(controller);
    loadingMoreResults = false;
    if (resultContext === contextSnapshot && !loadMoreBtn.classList.contains('hidden')) {
      loadMoreBtn.disabled = false;
    }
  }
}

/**
 * Fetch Session & Gateway Status
 * This app does not implement an authenticated gateway/session; reflect that
 * honestly instead of pretending to manage a rotating host or token.
 */
async function fetchSessionStatus() {
  try {
    const res = await fetch('/api/session');
    if (res.ok) {
      const data = await res.json();
      if (sessionHostBadge) {
        const gatewayState = data.gatewayStatus === 'unsupported'
          ? 'Gateway unsupported'
          : (data.currentHost ? new URL(data.currentHost).hostname : 'Gateway offline');
        sessionHostBadge.textContent = gatewayState;
      }
    }
  } catch {
    if (sessionHostBadge) sessionHostBadge.textContent = 'Gateway offline';
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

// ── Search history & autocomplete ───────────────────────────────────────
const SEARCH_HISTORY_KEY = 'cinesphere_search_history';
const MAX_SEARCH_HISTORY = 8;
let suggestionTimer = null;
let suggestionController = null;
let suggestionList = [];
let suggestionIndex = -1;

function getSearchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_SEARCH_HISTORY);
  } catch {
    return [];
  }
}

function saveSearchTerm(term) {
  const clean = String(term || '').trim().slice(0, 120);
  if (!clean) return;
  const list = getSearchHistory().filter((value) => value.toLowerCase() !== clean.toLowerCase());
  list.unshift(clean);
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_SEARCH_HISTORY)));
  } catch (err) {
    console.warn('Failed to save search history:', err.message);
  }
}

function closeSearchSuggestions() {
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
    suggestionTimer = null;
  }
  suggestionController?.abort();
  suggestionController = null;
  suggestionList = [];
  suggestionIndex = -1;
  searchSuggestionsDropdown?.classList.add('hidden');
  searchInput?.setAttribute('aria-expanded', 'false');
  searchInput?.removeAttribute('aria-activedescendant');
}

function renderSearchSuggestions(items, mode) {
  if (!searchSuggestionsDropdown || !searchInput) return;
  suggestionList = Array.isArray(items) ? items.slice(0, 8) : [];
  suggestionIndex = -1;

  if (suggestionList.length === 0) {
    closeSearchSuggestions();
    return;
  }

  const header = mode === 'history' ? 'Recent searches' : 'Suggestions';
  searchSuggestionsDropdown.innerHTML = `
    <div class="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">${header}</div>
    ${suggestionList.map((item, index) => {
      const title = escapeHtml(item.title || '');
      const meta = [item.type === 'series' ? 'Series' : item.type === 'movie' ? 'Movie' : '', item.year ? String(item.year) : '']
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');
      const poster = item.poster ? safeImageUrl(item.poster, '') : '';
      return `
        <button type="button" role="option" id="searchSuggestionOption-${index}" data-suggestion-index="${index}" aria-selected="false" class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#1f1b17] transition cursor-pointer">
          ${poster
            ? `<img src="${poster}" alt="" class="w-7 h-10 rounded object-cover shrink-0 bg-[#211d19]" loading="lazy">`
            : `<span class="w-7 h-10 rounded bg-[#211d19] border border-[#2f2924] flex items-center justify-center text-slate-500 shrink-0">
                 <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
               </span>`}
          <span class="min-w-0">
            <span class="block text-xs font-semibold text-slate-200 truncate">${title}</span>
            ${meta ? `<span class="block text-[10px] font-mono text-slate-500 mt-0.5">${meta}</span>` : ''}
          </span>
        </button>
      `;
    }).join('')}
  `;
  searchSuggestionsDropdown.classList.remove('hidden');
  searchInput.setAttribute('aria-expanded', 'true');
}

function setSuggestionActive(index) {
  if (!searchSuggestionsDropdown || suggestionList.length === 0) return;
  const count = suggestionList.length;
  suggestionIndex = ((index % count) + count) % count;
  searchSuggestionsDropdown.querySelectorAll('[data-suggestion-index]').forEach((button, i) => {
    const active = i === suggestionIndex;
    button.classList.toggle('search-suggestion-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const activeButton = searchSuggestionsDropdown.querySelector(`[data-suggestion-index="${suggestionIndex}"]`);
  if (activeButton && searchInput) {
    activeButton.scrollIntoView({ block: 'nearest' });
    searchInput.setAttribute('aria-activedescendant', activeButton.id);
  }
}

function chooseSuggestion(index) {
  const item = suggestionList[index];
  if (!item) return false;
  const query = String(item.title || '').trim();
  if (!query) return false;
  searchInput.value = query;
  closeSearchSuggestions();
  handleSearch(query);
  return true;
}

async function loadSearchSuggestions(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (query.length < 2) return;

  suggestionController?.abort();
  const controller = new AbortController();
  suggestionController = controller;
  const abortTimer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (suggestionController !== controller) return;
    if (String(searchInput?.value || '').trim().toLowerCase() !== query.toLowerCase()) return;
    if (document.activeElement !== searchInput) return;
    renderSearchSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [], 'suggestions');
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[Suggestions] fetch failed:', err.message);
  } finally {
    clearTimeout(abortTimer);
    if (suggestionController === controller) suggestionController = null;
  }
}

// ── Library backup / restore ────────────────────────────────────────────
function buildLibraryBackup() {
  return {
    app: 'CineSphere Browser',
    version: 1,
    exportedAt: new Date().toISOString(),
    watchlist: getStoredWatchlist(),
    history: getStoredHistory(),
    searchHistory: getSearchHistory(),
  };
}

function exportLibraryBackup() {
  try {
    const blob = new window.Blob([JSON.stringify(buildLibraryBackup(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cinesphere-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Library backup exported.');
  } catch (err) {
    showToast('Could not export library: ' + err.message, 'error');
  }
}

function backupString(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function backupHttpUrl(value) {
  const raw = backupString(value, 2000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeBackupWatchlistItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = backupString(item.id || item.subjectId, 500);
  if (!id) return null;
  return {
    id,
    subjectId: id,
    title: backupString(item.title, 300) || 'Untitled',
    type: item.type === 'series' ? 'series' : 'movie',
    poster: backupHttpUrl(item.poster),
    year: backupString(item.year, 20),
    rating: backupString(item.rating, 20),
    provider: backupString(item.provider, 80) || 'movieBoxWeb',
    providerDisplayName: backupString(item.providerDisplayName, 120),
    addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : Date.now(),
  };
}

function normalizeBackupHistoryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const subjectId = backupString(item.subjectId || item.id, 500);
  if (!subjectId) return null;
  const seasonNumber = Number(item.seasonNumber) > 0 ? Math.floor(Number(item.seasonNumber)) : null;
  const episodeNumber = Number(item.episodeNumber) > 0 ? Math.floor(Number(item.episodeNumber)) : null;
  const id = backupString(item.id, 600) || (seasonNumber && episodeNumber ? `${subjectId}::s${seasonNumber}e${episodeNumber}` : subjectId);
  return {
    id,
    subjectId,
    title: backupString(item.title, 300) || 'Untitled',
    type: item.type === 'series' ? 'series' : 'movie',
    poster: backupHttpUrl(item.poster),
    year: backupString(item.year, 20),
    provider: backupString(item.provider, 80) || 'movieBoxWeb',
    providerDisplayName: backupString(item.providerDisplayName, 120),
    streamTitle: backupString(item.streamTitle, 300),
    seasonNumber,
    episodeNumber,
    streamSubjectId: backupString(item.streamSubjectId, 500),
    streamProvider: backupString(item.streamProvider, 80) || backupString(item.provider, 80) || 'movieBoxWeb',
    progressSeconds: Math.max(0, Number(item.progressSeconds) || 0),
    durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
    watchedAt: Number.isFinite(Number(item.watchedAt)) ? Number(item.watchedAt) : Date.now(),
  };
}

function mergeBackupItems(current, incoming, limit) {
  const merged = new Map(current.map((item) => [String(item.id), item]));
  for (const item of incoming) {
    const key = String(item.id);
    if (!merged.has(key)) merged.set(key, item);
  }
  return [...merged.values()].slice(0, limit);
}

function importLibraryBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Backup file is not valid JSON.');
  const watchlistRaw = Array.isArray(data.watchlist) ? data.watchlist.slice(0, 5000) : [];
  const historyRaw = Array.isArray(data.history) ? data.history.slice(0, 5000) : [];
  const searchRaw = Array.isArray(data.searchHistory) ? data.searchHistory.slice(0, 50) : [];

  const watchlist = watchlistRaw.map(normalizeBackupWatchlistItem).filter(Boolean);
  const history = historyRaw.map(normalizeBackupHistoryItem).filter(Boolean);
  if (watchlist.length === 0 && history.length === 0) {
    throw new Error('Backup contains no watchlist or watch history items.');
  }

  const mergedWatchlist = mergeBackupItems(getStoredWatchlist(), watchlist, 500);
  const mergedHistory = mergeBackupItems(getStoredHistory(), history, 100);
  saveStoredWatchlist(mergedWatchlist);
  saveStoredHistory(mergedHistory);
  for (const term of searchRaw) {
    if (typeof term === 'string') saveSearchTerm(term);
  }

  if (activeLibraryTab === 'watchlist') renderWatchlistTab();
  if (activeLibraryTab === 'history') renderHistoryTab();
  updateModalWatchlistBtnState();
  syncCardWatchlistIcons();
  showToast(`Imported ${watchlist.length} watchlist and ${history.length} history item(s).`);
}

async function handleLibraryImportFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Backup file is too large (maximum 2 MB).', 'error');
    return;
  }
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Backup file is not valid JSON.');
    }
    importLibraryBackup(parsed);
  } catch (err) {
    showToast(err.message || 'Could not import backup.', 'error');
  } finally {
    if (libraryImportFile) libraryImportFile.value = '';
  }
}

// ── Player sleep timer & auto-next preference ──────────────────────────
const AUTO_NEXT_STORAGE_KEY = 'cinesphere_auto_next';

function autoNextEnabled() {
  try {
    return localStorage.getItem(AUTO_NEXT_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function clearSleepTimer(resetSelect = true) {
  if (sleepTimerHandle) {
    clearTimeout(sleepTimerHandle);
    sleepTimerHandle = null;
  }
  if (resetSelect && sleepTimerSelect) sleepTimerSelect.value = '0';
}

function scheduleSleepTimer(minutes) {
  clearSleepTimer(false);
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    showToast('Sleep timer is off.');
    return;
  }
  sleepTimerHandle = setTimeout(() => {
    sleepTimerHandle = null;
    if (sleepTimerSelect) sleepTimerSelect.value = '0';
    if (videoPlayer && !videoPlayer.paused) videoPlayer.pause();
    showToast('Sleep timer reached — playback paused.');
  }, value * 60 * 1000);
  showToast(`Sleep timer set for ${value} minutes.`);
}

// Event Listeners
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  closeSearchSuggestions();
  if (q) {
    handleSearch(q);
  } else {
    loadCatalogHomepage(selectedProvider);
  }
});

searchInput?.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
    suggestionTimer = null;
  }
  suggestionController?.abort();
  suggestionController = null;

  if (!q) {
    renderSearchSuggestions(getSearchHistory().map((term) => ({ title: term })), 'history');
    return;
  }
  if (q.length < 2) {
    closeSearchSuggestions();
    return;
  }
  suggestionTimer = setTimeout(() => {
    suggestionTimer = null;
    loadSearchSuggestions(q);
  }, 250);
});

searchInput?.addEventListener('focus', () => {
  const q = searchInput.value.trim();
  if (!q) {
    renderSearchSuggestions(getSearchHistory().map((term) => ({ title: term })), 'history');
  } else if (q.length >= 2) {
    loadSearchSuggestions(q);
  }
});

searchInput?.addEventListener('keydown', (e) => {
  const open = searchSuggestionsDropdown && !searchSuggestionsDropdown.classList.contains('hidden');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open) {
      const q = searchInput.value.trim();
      if (q.length >= 2) loadSearchSuggestions(q);
      else renderSearchSuggestions(getSearchHistory().map((term) => ({ title: term })), 'history');
    }
    if (suggestionList.length > 0) {
      e.preventDefault();
      setSuggestionActive(suggestionIndex + (e.key === 'ArrowDown' ? 1 : -1));
    }
  } else if (e.key === 'Enter' && open && suggestionIndex >= 0) {
    e.preventDefault();
    chooseSuggestion(suggestionIndex);
  } else if (e.key === 'Escape' && open) {
    e.preventDefault();
    closeSearchSuggestions();
  }
});

searchSuggestionsDropdown?.addEventListener('mousedown', (e) => {
  const button = e.target.closest('[data-suggestion-index]');
  if (!button) return;
  e.preventDefault();
  chooseSuggestion(Number(button.dataset.suggestionIndex));
});

searchSuggestionsDropdown?.addEventListener('click', (e) => {
  const button = e.target.closest('[data-suggestion-index]');
  if (!button) return;
  chooseSuggestion(Number(button.dataset.suggestionIndex));
});

document.addEventListener('click', (e) => {
  if (!searchForm.contains(e.target)) closeSearchSuggestions();
});

dismissErrorBtn?.addEventListener('click', hideError);

loadMoreBtn?.addEventListener('click', loadMoreResults);

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
  if (!activeMedia) return;

  if (isSeriesMedia(activeMedia)) {
    const firstEpisode = getFirstEpisodeContext(activeMedia);
    if (!firstEpisode?.streamId) {
      showToast('No episode sources are available for this series.', 'error');
      return;
    }

    // Selecting the row before loading gives immediate feedback and makes it
    // clear that "View Sources" resolved the first episode, not the series ID.
    markSelectedEpisode(firstEpisode.season, firstEpisode.episode, firstEpisode.audio);
    const selectedRow = seriesSeasonsList?.querySelector('.episode-row.episode-selected');
    selectedRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    loadStreams(firstEpisode.streamId, firstEpisode.provider, firstEpisode);
    return;
  }

  loadStreams(activeMedia.subjectId, activeMedia.provider || 'addon');
});

// Streams list event delegation: handles Play and Copy URL buttons reliably
streamsList?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const idx = parseInt(btn.dataset.mirrorIndex, 10);
  const mirror = Number.isFinite(idx) ? globalMirrorStore[idx] : null;

  if (action === 'play-stream' && mirror && mirror.url) {
    autoSwitchGeneration += 1;
    autoSwitchResolutionPending = false;
    autoSwitchResolutionTried = false;
    const seenUrls = new Set([mirror.url]);
    autoSwitchCandidates = globalMirrorStore
      .filter((candidate) => {
        if (!candidate?.url || seenUrls.has(candidate.url)) return false;
        seenUrls.add(candidate.url);
        return true;
      })
      .map((candidate) => ({
        ...candidate,
        provider: activeStreamContext.provider,
      }));
    autoSwitchBaseTitle = mirror.title;
    playStreamSource(mirror.url, mirror.title, mirror.cookie, false, mirror.headers, mirror.subtitles, mirror.type);
  } else if (action === 'queue-download' && mirror && mirror.url) {
    queueDownloadFromStream({
      resolverUrl: mirror.url,
      label: mirror.label || mirror.quality || 'source',
      quality: mirror.quality || 'Standard',
      headers: mirror.headers,
      signCookie: mirror.cookie,
    }, activeMedia);
  } else if (action === 'copy-url' && mirror && mirror.url) {
    copyToClipboard(mirror.url, btn);
  }
});

closePlayerBtn.addEventListener('click', closeVideoPlayer);

subtitleSelect?.addEventListener('change', () => {
  const selected = subtitleSelect.value;
  videoPlayer?.querySelectorAll('track[data-player-subtitle]').forEach((element) => {
    const track = element;
    track.track.mode = selected !== 'off' && track.dataset.playerSubtitle === selected ? 'showing' : 'disabled';
  });
  updatePlayerControls();
});

playbackRateSelect?.addEventListener('change', () => {
  const rate = Number(playbackRateSelect.value);
  if (videoPlayer && Number.isFinite(rate) && rate > 0) videoPlayer.playbackRate = rate;
});

// Player mode toggle
toggleProxyBtn?.addEventListener('click', toggleStreamMode);

// Copy active stream URL
copyStreamBtn?.addEventListener('click', () => {
  if (currentPlayback.rawUrl) {
    copyToClipboard(currentPlayback.rawUrl, copyStreamText);
  }
});

queuePlayerStream?.addEventListener('click', () => {
  if (!currentPlayback.rawUrl) {
    showToast('No active stream to queue.', 'error');
    return;
  }
  queueDownloadFromStream({
    resolverUrl: currentPlayback.rawUrl,
    label: currentPlayback.streamType || 'player',
    quality: currentPlayback.streamType || 'Stream',
    headers: currentPlayback.headers,
    signCookie: currentPlayback.cookie,
  }, activeMedia);
});

sleepTimerSelect?.addEventListener('change', () => {
  scheduleSleepTimer(sleepTimerSelect.value);
});

if (autoNextToggle) {
  autoNextToggle.checked = autoNextEnabled();
  autoNextToggle.addEventListener('change', () => {
    try {
      localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(autoNextToggle.checked));
    } catch {
      // Preference still applies for this session.
    }
    if (!autoNextToggle.checked) {
      cancelAutoNext();
      showToast('Auto-play next episode disabled.');
    } else {
      showToast('Auto-play next episode enabled.');
    }
  });
}

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
tabDownloadsBtn?.addEventListener('click', () => switchLibraryTab('downloads'));
clearHistoryBtn?.addEventListener('click', () => clearAllHistory());
libraryExportBtn?.addEventListener('click', exportLibraryBackup);
libraryImportBtn?.addEventListener('click', () => libraryImportFile?.click());
libraryImportFile?.addEventListener('change', () => handleLibraryImportFile(libraryImportFile.files?.[0]));

libraryDownloadsContainer?.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const id = String(button.dataset.dlId || '');
  if (!id) return;
  button.disabled = true;
  try {
    if (button.dataset.action === 'dl-toggle') {
      const item = downloads.find((entry) => String(entry.id) === id);
      const active = item && (item.status === 'downloading' || item.status === 'queued');
      await apiDownload(`/${encodeURIComponent(id)}/${active ? 'pause' : 'resume'}`, 'POST');
      showToast(active ? 'Download paused.' : 'Download resumed.');
    } else if (button.dataset.action === 'dl-cancel') {
      await apiDownload(`/${encodeURIComponent(id)}/cancel`, 'POST');
      showToast('Download cancelled.');
    } else if (button.dataset.action === 'dl-remove') {
      const item = downloads.find((entry) => String(entry.id) === id);
      const removingFile = item?.status === 'completed';
      if (!window.confirm(removingFile ? 'Delete this downloaded file from disk?' : 'Remove this download from the queue?')) return;
      await apiDownload(`/${encodeURIComponent(id)}`, 'DELETE');
      showToast(removingFile ? 'Downloaded file deleted.' : 'Download removed.');
    }
    await fetchDownloads();
  } catch (err) {
    showToast(err.message || 'Download action failed.', 'error');
  } finally {
    button.disabled = false;
  }
});

libraryModal?.addEventListener('click', (e) => {
  if (e.target === libraryModal) closeLibraryModal();

  const watchBtn = e.target.closest('[data-action="lib-watch-now"]');
  if (watchBtn) {
    const historyItem = getStoredHistory().find((item) =>
      String(item.id) === String(watchBtn.dataset.historyId || watchBtn.dataset.subjectId)
    );
    if (historyItem && watchBtn.dataset.historyId) {
      resumeHistoryItem(historyItem);
    } else {
      const { subjectId, provider } = watchBtn.dataset;
      closeLibraryModal();
      if (subjectId && provider) handleCardClick(subjectId, provider);
    }
    return;
  }

  const removeWatchlistBtn = e.target.closest('[data-action="lib-remove-watchlist"]');
  if (removeWatchlistBtn) {
    removeWatchlistItem(removeWatchlistBtn.dataset.subjectId);
    return;
  }

  const removeHistoryBtn = e.target.closest('[data-action="lib-remove-history"]');
  if (removeHistoryBtn) {
    removeHistoryItem(removeHistoryBtn.dataset.historyId || removeHistoryBtn.dataset.subjectId, removeHistoryBtn.dataset.subjectId);
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
function updateProviderUI(provId, provName, selectedGenre) {
  if (navActiveProviderBadge) {
    if (provName) {
      navActiveProviderBadge.textContent = provName;
    } else if (provId === 'all') {
      navActiveProviderBadge.textContent = 'All Providers';
    } else {
      const match = allProvidersList.find((p) => p.id === provId);
      navActiveProviderBadge.textContent = match ? match.name : (provName || provId);
    }
  }

  // Sync top channels bar if applicable
  if (topChannelsBar) {
    topChannelsBar.querySelectorAll('.channel-card').forEach((b) => {
      const matchesProvider = b.dataset.provider === provId;
      const matchesGenre = selectedGenre === undefined || (b.dataset.genre || null) === (selectedGenre || null);
      if (matchesProvider && matchesGenre) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
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

// ══════════════════════════════════════════════════════════════
// VEGA-STYLE HERO CAROUSEL
// Picks up to 4 items from catalog results, rotates every 8 s.
// Pauses on pointer-enter; resumes on pointer-leave.
// ══════════════════════════════════════════════════════════════
let heroItems = [];
let heroIndex = 0;
let heroTimer = null;
let heroPaused = false;
const HERO_COUNT = 4;
const HERO_INTERVAL = 8000;

const heroCarouselSection = document.getElementById('heroCarouselSection');
const heroSlides = document.getElementById('heroSlides');
const heroTitle = document.getElementById('heroTitle');
const heroDesc = document.getElementById('heroDesc');
const heroBadges = document.getElementById('heroBadges');
const heroDots = document.getElementById('heroDots');
const heroPlayBtn = document.getElementById('heroPlayBtn');
const heroInfoBtn = document.getElementById('heroInfoBtn');
const heroPrevBtn = document.getElementById('heroPrev');
const heroNextBtn = document.getElementById('heroNext');

function heroGetItem() { return heroItems[heroIndex] || null; }

function heroRenderSlide(item, active) {
  if (!item) return '';
  const bgUrl = item.poster ? `/api/poster?url=${encodeURIComponent(item.poster)}` : '';
  return `<div class="hero-slide absolute inset-0 transition-opacity duration-700 ${active ? 'opacity-100' : 'opacity-0'}" aria-hidden="${!active}">
    ${bgUrl ? `<img src="${bgUrl}" alt="" class="w-full h-full object-cover object-center" loading="lazy" style="filter:brightness(0.55) saturate(1.1);">` : '<div class="w-full h-full bg-gradient-to-br from-[#1a1512] to-[#0c0b0a]"></div>'}
  </div>`;
}

function heroUpdateContent() {
  const item = heroGetItem();
  if (!item || !heroTitle) return;
  heroTitle.textContent = item.title || 'Untitled';
  heroDesc.textContent = item.description || '';
  const isMovie = item.type === 'movie';
  const isSeries = item.type === 'series';
  if (heroBadges) {
    heroBadges.innerHTML = [
      isMovie ? '<span class="badge-movie text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded">Movie</span>' : '',
      isSeries ? '<span class="badge-series text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded">Series</span>' : '',
      item.year ? `<span class="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded bg-black/40 border border-white/5">${escapeHtml(String(item.year))}</span>` : '',
      item.rating ? `<span class="text-[10px] font-mono text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">★ ${escapeHtml(String(item.rating))}</span>` : '',
    ].join('');
  }
}

function heroUpdateSlides() {
  if (!heroSlides) return;
  heroSlides.innerHTML = heroItems.map((item, i) => heroRenderSlide(item, i === heroIndex)).join('');
  if (heroDots) {
    heroDots.innerHTML = heroItems.map((_, i) =>
      `<button class="hero-dot w-2 h-2 rounded-full transition-all ${i === heroIndex ? 'bg-amber-400 scale-125' : 'bg-white/30 hover:bg-white/60'} cursor-pointer" data-hero-index="${i}" aria-label="Go to slide ${i + 1}"></button>`
    ).join('');
  }
  heroUpdateContent();
}

function heroGoTo(index) {
  if (heroItems.length === 0) return;
  heroIndex = ((index % heroItems.length) + heroItems.length) % heroItems.length;
  if (!heroSlides) return;
  heroSlides.querySelectorAll('.hero-slide').forEach((el, i) => {
    el.classList.toggle('opacity-100', i === heroIndex);
    el.classList.toggle('opacity-0', i !== heroIndex);
    el.setAttribute('aria-hidden', String(i !== heroIndex));
  });
  if (heroDots) {
    heroDots.querySelectorAll('.hero-dot').forEach((dot, i) => {
      dot.classList.toggle('bg-amber-400', i === heroIndex);
      dot.classList.toggle('scale-125', i === heroIndex);
      dot.classList.toggle('bg-white/30', i !== heroIndex);
    });
  }
  heroUpdateContent();
}

function heroStartTimer() {
  heroStopTimer();
  if (heroItems.length < 2) return;
  heroTimer = setInterval(() => {
    if (!heroPaused) heroGoTo(heroIndex + 1);
  }, HERO_INTERVAL);
}

function heroStopTimer() {
  if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
}

function populateHeroCarousel(catalogItems) {
  if (!heroCarouselSection) return;
  if (!Array.isArray(catalogItems) || catalogItems.length === 0) {
    heroCarouselSection.classList.add('hidden');
    return;
  }
  const pool = catalogItems.filter(it => it && it.poster);
  if (pool.length === 0) {
    heroCarouselSection.classList.add('hidden');
    return;
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  heroItems = shuffled.slice(0, HERO_COUNT);
  heroIndex = 0;
  heroCarouselSection.classList.remove('hidden');
  heroUpdateSlides();
  heroStartTimer();
}

// Hero carousel event wiring
const heroCarouselEl = document.getElementById('heroCarousel');
if (heroCarouselEl) {
  heroCarouselEl.addEventListener('pointerenter', () => { heroPaused = true; });
  heroCarouselEl.addEventListener('pointerleave', () => { heroPaused = false; });
}
if (heroPrevBtn) heroPrevBtn.addEventListener('click', () => { heroPaused = true; heroGoTo(heroIndex - 1); setTimeout(() => { heroPaused = false; }, 3000); });
if (heroNextBtn) heroNextBtn.addEventListener('click', () => { heroPaused = true; heroGoTo(heroIndex + 1); setTimeout(() => { heroPaused = false; }, 3000); });
if (heroDots) {
  heroDots.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-hero-index]');
    if (!dot) return;
    heroPaused = true;
    heroGoTo(Number(dot.dataset.heroIndex));
    setTimeout(() => { heroPaused = false; }, 3000);
  });
}
if (heroPlayBtn) {
  heroPlayBtn.addEventListener('click', () => {
    const item = heroGetItem();
    if (!item) return;
    loadDetails(item.subjectId, item.provider || 'movieBoxWeb')
      .then(details => {
        details.title ||= item.title;
        details.poster ||= item.poster;
        details.year ||= item.year;
        details.type ||= item.type;
        showDetails(details);
        if (details.type !== 'series') {
          loadStreams(item.subjectId, item.provider || 'movieBoxWeb');
        }
      })
      .catch(err => showError('Failed to open hero item: ' + err.message));
  });
}
if (heroInfoBtn) {
  heroInfoBtn.addEventListener('click', () => {
    const item = heroGetItem();
    if (!item) return;
    loadDetails(item.subjectId, item.provider || 'movieBoxWeb')
      .then(details => {
        details.title ||= item.title;
        details.poster ||= item.poster;
        details.year ||= item.year;
        details.type ||= item.type;
        showDetails(details);
      })
      .catch(err => showError('Failed to open hero item: ' + err.message));
  });
}

// ══ Continue Watching strip click delegation ══
document.addEventListener('click', (e) => {
  // Resume item
  const cwCard = e.target.closest('[data-action="cw-resume"]');
  if (cwCard && !e.target.closest('[data-action="cw-remove"]')) {
    const subjectId = cwCard.dataset.subjectId;
    const provider = cwCard.dataset.provider || 'movieBoxWeb';
    const streamSubjectId = cwCard.dataset.streamSubjectId || subjectId;
    const streamProvider = cwCard.dataset.streamProvider || provider;
    const historyId = cwCard.dataset.historyId;

    const history = JSON.parse(localStorage.getItem('cinesphere_history') || '[]');
    const entry = history.find(it => String(it.id) === String(historyId));
    if (entry && entry.progressSeconds > 0) {
      pendingResumeSeconds = Math.min(Number(entry.progressSeconds), Number(entry.durationSeconds || entry.progressSeconds));
    }

    loadDetails(subjectId, provider)
      .then(details => {
        details.title ||= entry?.title || 'Untitled';
        details.poster ||= entry?.poster || '';
        details.type ||= entry?.type || 'movie';
        showDetails(details);
        loadStreams(streamSubjectId, streamProvider);
      })
      .catch(err => showError('Failed to resume: ' + err.message));
    return;
  }

  // Remove item
  const cwRemove = e.target.closest('[data-action="cw-remove"]');
  if (cwRemove) {
    e.stopPropagation();
    const historyId = cwRemove.dataset.historyId;
    if (!historyId) return;
    try {
      const history = JSON.parse(localStorage.getItem('cinesphere_history') || '[]');
      const updated = history.filter(it => String(it.id) !== String(historyId));
      localStorage.setItem('cinesphere_history', JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to remove continue watching item:', err);
    }
    renderContinueWatchingStrip();
    return;
  }
});

// Clear all continue watching
document.getElementById('cwClearBtn')?.addEventListener('click', () => {
  try {
    const history = JSON.parse(localStorage.getItem('cinesphere_history') || '[]');
    const cwIds = new Set(getContinueWatchingItems().map(it => it.id));
    const kept = history.filter(it => !cwIds.has(it.id));
    localStorage.setItem('cinesphere_history', JSON.stringify(kept));
  } catch (err) {
    console.warn('Failed to clear continue watching items:', err);
  }
  renderContinueWatchingStrip();
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
  updateProviderUI(prov, btn.dataset.name, g);

  const currentQuery = searchInput.value.trim();
  if (currentQuery) {
    handleSearch(currentQuery);
  } else {
    loadCatalogHomepage(prov, g);
  }
});

// Brand Home Button click returns to catalog homepage
document.getElementById('brandHomeBtn')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  hideSearchHero();
  if (searchInput) searchInput.value = '';
  activeGenre = null;
  loadCatalogHomepage(selectedProvider);
});

// One capture-phase listener handles every poster/image error without inline
// handlers (the CSP forbids inline script).
document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof window.HTMLImageElement)) return;
  if (image.dataset.posterFallbackApplied === 'true') return;
  image.dataset.posterFallbackApplied = 'true';
  image.src = POSTER_FALLBACK;
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    heroPaused = true;
    stopDownloadsPoll();
  } else {
    heroPaused = false;
    if (libraryModal && !libraryModal.classList.contains('hidden') && activeLibraryTab === 'downloads') {
      startDownloadsPoll();
    }
  }
});

// Initialize gateway status, dynamic providers, and library badges
fetchSessionStatus();
loadProvidersDropdown();
updateWatchlistBadges();
updateHistoryBadges();
renderContinueWatchingStrip();
fetchDownloads();

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
