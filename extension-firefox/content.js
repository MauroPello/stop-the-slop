/**
 * Stop the Slop: Isolated World Content Script
 *
 * Injected into YouTube pages in the ISOLATED world.
 * Features:
 *   1. Bridges transcript extraction between popup and content-main.js.
 *   2. Scans video thumbnails across YouTube feeds (Home, Subscriptions, Search, Watch sidebar).
 *   3. Queries Cloudflare Worker edge cache in debounced batches (/api/check-batch).
 *   4. Renders sleek, real-time AI probability badges directly on video thumbnails.
 */

(() => {
  if (window.__STOP_THE_SLOP_ISO_INIT__) return;
  window.__STOP_THE_SLOP_ISO_INIT__ = true;

  // --- DEBUG LOGGER ---
  // Enable debug mode by running this in the YouTube page console:
  //   localStorage.setItem('__STS_DEBUG__', '1')
  // Disable with:
  //   localStorage.removeItem('__STS_DEBUG__')
  function isDebugEnabled() {
    try {
      return localStorage.getItem('__STS_DEBUG__') === '1';
    } catch (_) {
      return false;
    }
  }

  function stsLog(...args) {
    if (isDebugEnabled()) console.log('[Stop the Slop]', ...args);
  }
  function stsWarn(...args) {
    if (isDebugEnabled()) console.warn('[Stop the Slop]', ...args);
  }

  const API_BASE = 'https://stop-the-slop-api.maurobum43.workers.dev';
  let lastActiveVideoId = null;

  // In-memory cache: videoId -> { found: boolean, score?: number, analyzedAt?: string }
  const videoCache = new Map();
  const pendingBatch = new Set();
  let batchTimer = null;
  let batchCooldownUntil = 0;
  let scanScheduled = false;
  let isScanning = false;
  let observer = null;
  let mutationThrottle = null;
  let scrollThrottle = null;

  // Check if extension runtime context is still valid (becomes invalid when extension reloads/updates)
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome?.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  // Gracefully tear down observers and timers if extension context is invalidated
  function handleContextInvalidated() {
    if (observer) {
      try { observer.disconnect(); } catch (_) { }
      observer = null;
    }
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (mutationThrottle) {
      clearTimeout(mutationThrottle);
      mutationThrottle = null;
    }
    if (scrollThrottle) {
      clearTimeout(scrollThrottle);
      scrollThrottle = null;
    }
  }

  // --- STYLES INJECTION ---
  function injectStyles() {
    if (document.getElementById('sts-thumbnail-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'sts-thumbnail-styles';
    styleEl.textContent = `
      .sts-thumb-badge-container {
        position: absolute !important;
        top: 6px !important;
        left: 6px !important;
        z-index: 99 !important;
        pointer-events: none !important;
        font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
        line-height: 1 !important;
        user-select: none !important;
        animation: sts-badge-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      .sts-thumb-badge-container.sts-thumb-badge-container--compact {
        top: 4px !important;
        left: 4px !important;
      }

      @keyframes sts-badge-pop {
        0% {
          opacity: 0;
          transform: scale(0.82) translateY(-2px);
        }
        100% {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .sts-thumb-badge {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 3.5px 7px !important;
        border-radius: 4px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        letter-spacing: 0.15px !important;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: blur(6px) !important;
        -webkit-backdrop-filter: blur(6px) !important;
        cursor: default !important;
      }

      .sts-thumb-badge.sts-thumb-badge--compact {
        padding: 2.5px 5px !important;
        font-size: 11px !important;
        border-radius: 3.5px !important;
      }

      /* AI Tier: High Risk (>= 65%) */
      .sts-thumb-badge--ai {
        background: rgba(185, 28, 28, 0.92) !important;
        color: #ffffff !important;
        border: 1px solid rgba(254, 202, 202, 0.3) !important;
      }

      /* AI Tier: Mixed (35% - 64%) */
      .sts-thumb-badge--mixed {
        background: rgba(180, 83, 9, 0.92) !important;
        color: #ffffff !important;
        border: 1px solid rgba(254, 240, 138, 0.3) !important;
      }

      /* AI Tier: Human (< 35%) */
      .sts-thumb-badge--human {
        background: rgba(21, 128, 61, 0.92) !important;
        color: #ffffff !important;
        border: 1px solid rgba(187, 247, 208, 0.3) !important;
      }

      .sts-thumb-badge .sts-badge-text {
        font-weight: 700 !important;
        font-size: 13px !important;
        line-height: 1 !important;
      }

      .sts-thumb-badge--compact .sts-badge-text {
        font-size: 11px !important;
        line-height: 1 !important;
      }

      /* --- IN-PLAYER CONTROLS BADGE & POPOVER --- */
      .sts-player-badge-wrapper {
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        height: 100% !important;
        vertical-align: top !important;
        margin-right: 6px !important;
        user-select: none !important;
        animation: sts-player-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
      }

      @keyframes sts-player-pop {
        0% {
          opacity: 0;
          transform: scale(0.88);
        }
        100% {
          opacity: 1;
          transform: scale(1);
        }
      }

      .sts-player-badge {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 28px !important;
        padding: 0 10px !important;
        border-radius: 14px !important;
        font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
        font-size: 11.5px !important;
        font-weight: 700 !important;
        letter-spacing: 0.2px !important;
        cursor: pointer !important;
        border: 1px solid transparent !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        transition: transform 0.18s ease, filter 0.18s ease, background-color 0.18s ease !important;
        box-sizing: border-box !important;
        outline: none !important;
        user-select: none !important;
        line-height: 1 !important;
      }

      .sts-player-badge:hover {
        transform: translateY(-1px) !important;
        filter: brightness(1.15) !important;
      }

      .sts-player-badge:active {
        transform: translateY(0) scale(0.97) !important;
      }

      /* AI Tier: High Risk (>= 65%) */
      .sts-player-badge--ai {
        background: rgba(185, 28, 28, 0.35) !important;
        border-color: rgba(248, 113, 113, 0.5) !important;
        color: #fca5a5 !important;
      }

      /* AI Tier: Mixed (35% - 64%) */
      .sts-player-badge--mixed {
        background: rgba(180, 83, 9, 0.35) !important;
        border-color: rgba(251, 191, 36, 0.5) !important;
        color: #fde047 !important;
      }

      /* AI Tier: Human (< 35%) */
      .sts-player-badge--human {
        background: rgba(21, 128, 61, 0.35) !important;
        border-color: rgba(52, 211, 153, 0.45) !important;
        color: #86efac !important;
      }

      .sts-player-badge-label {
        line-height: 1 !important;
        white-space: nowrap !important;
        font-weight: 700 !important;
      }

      /* In-Player Popover Tooltip */
      .sts-player-popover {
        position: absolute !important;
        bottom: calc(100% + 12px) !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(5px) !important;
        width: 245px !important;
        background: rgba(18, 18, 22, 0.96) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 12px !important;
        padding: 12px 14px !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
        color: #ffffff !important;
        font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
        z-index: 99999 !important;
        pointer-events: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.18s !important;
        cursor: default !important;
        text-align: left !important;
        line-height: 1.3 !important;
      }

      .sts-player-popover::after {
        content: '' !important;
        position: absolute !important;
        bottom: -5px !important;
        left: 50% !important;
        width: 10px !important;
        height: 10px !important;
        background: rgba(18, 18, 22, 0.96) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.14) !important;
        transform: translateX(-50%) rotate(45deg) !important;
      }

      .sts-player-badge-wrapper:hover .sts-player-popover,
      .sts-player-badge-wrapper.sts-popover-open .sts-player-popover {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transform: translateX(-50%) translateY(0) !important;
      }

      .sts-popover-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 10px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        padding-bottom: 8px !important;
      }

      .sts-popover-brand {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        color: rgba(255, 255, 255, 0.7) !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
      }

      .sts-popover-tag {
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-size: 9.5px !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.3px !important;
      }

      .sts-popover-tag--ai {
        background: rgba(239, 68, 68, 0.2) !important;
        color: #fca5a5 !important;
        border: 1px solid rgba(239, 68, 68, 0.4) !important;
      }

      .sts-popover-tag--mixed {
        background: rgba(245, 158, 11, 0.2) !important;
        color: #fde047 !important;
        border: 1px solid rgba(245, 158, 11, 0.4) !important;
      }

      .sts-popover-tag--human {
        background: rgba(16, 185, 129, 0.2) !important;
        color: #86efac !important;
        border: 1px solid rgba(16, 185, 129, 0.4) !important;
      }

      .sts-popover-score-row {
        display: flex !important;
        align-items: baseline !important;
        gap: 8px !important;
        margin-bottom: 8px !important;
      }

      .sts-popover-score-number {
        font-size: 24px !important;
        font-weight: 800 !important;
        line-height: 1 !important;
        letter-spacing: -0.5px !important;
      }

      .sts-popover-score-meta {
        display: flex !important;
        flex-direction: column !important;
        gap: 1px !important;
      }

      .sts-popover-score-title {
        font-size: 12px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        line-height: 1.2 !important;
      }

      .sts-popover-score-sub {
        font-size: 10px !important;
        color: rgba(255, 255, 255, 0.5) !important;
        font-weight: 500 !important;
      }

      .sts-popover-meter {
        position: relative !important;
        height: 6px !important;
        border-radius: 3px !important;
        background: rgba(255, 255, 255, 0.12) !important;
        overflow: hidden !important;
        margin-bottom: 10px !important;
      }

      .sts-popover-meter-fill {
        height: 100% !important;
        border-radius: 3px !important;
        transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      .sts-popover-meter-fill--ai {
        background: linear-gradient(90deg, #f59e0b, #ef4444) !important;
      }

      .sts-popover-meter-fill--mixed {
        background: linear-gradient(90deg, #10b981, #f59e0b) !important;
      }

      .sts-popover-meter-fill--human {
        background: #10b981 !important;
      }

      .sts-popover-info {
        font-size: 11px !important;
        color: rgba(255, 255, 255, 0.8) !important;
        line-height: 1.4 !important;
        margin: 0 0 8px 0 !important;
      }
      .sts-popover-footer {
        font-size: 9.5px !important;
        color: rgba(255, 255, 255, 0.45) !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
        padding-top: 6px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }

      /* Small mode inside mini player */
      .ytp-small-mode .sts-player-badge {
        height: 24px !important;
        padding: 0 7px !important;
        font-size: 10px !important;
        gap: 4px !important;
      }

      .ytp-small-mode .sts-player-popover {
        width: 210px !important;
        padding: 10px 12px !important;
      }
    `;

    (document.head || document.documentElement).appendChild(styleEl);
  }

  // --- LOCAL CACHE SYNCHRONIZATION ---
  async function syncLocalCache() {
    if (!isExtensionValid()) return;
    try {
      const allItems = await chrome.storage.local.get(null);
      for (const [key, val] of Object.entries(allItems)) {
        let videoId = null;
        let score = null;

        if (key.startsWith('result_') && val && typeof val.score === 'number') {
          videoId = key.replace('result_', '');
          score = val.score;
        } else if (key.startsWith('sts_cache_') && val && typeof val.score === 'number') {
          videoId = key.replace('sts_cache_', '');
          score = val.score;
        }

        if (videoId && typeof score === 'number') {
          videoCache.set(videoId, {
            found: true,
            score,
            analyzedAt: val.analyzedAt || new Date().toISOString(),
            sentenceScores: val.sentenceScores,
          });
        }
      }
    } catch (e) {
      if (!isExtensionValid() || (e && typeof e.message === 'string' && e.message.includes('Extension context invalidated'))) {
        handleContextInvalidated();
        return;
      }
      stsWarn('Error syncing local cache:', e);
    }
  }

  // Listen for storage updates (e.g. when popup analyzes a video)
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      if (areaName !== 'local') return;

      let updated = false;
      for (const [key, change] of Object.entries(changes)) {
        if ((key.startsWith('result_') || key.startsWith('sts_cache_')) && change.newValue) {
          const videoId = key.replace(/^(result_|sts_cache_)/, '');
          const score = change.newValue.score;
          if (videoId && typeof score === 'number') {
            videoCache.set(videoId, {
              found: true,
              score,
              analyzedAt: change.newValue.analyzedAt || new Date().toISOString(),
              sentenceScores: change.newValue.sentenceScores,
            });
            updated = true;
          }
        }
      }

      if (updated) {
        requestScan();
        const currentVid = getActiveVideoId();
        if (currentVid) {
          checkAndRenderPlayerBadge(currentVid);
        }
      }
    });
  } catch (_) { }

  // --- VIDEO ID EXTRACTION ---
  function extractVideoId(urlOrStr) {
    if (!urlOrStr) return null;

    try {
      // 1. Direct v= query param
      const matchV = urlOrStr.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (matchV) return matchV[1];

      // 2. /shorts/ path
      const matchShorts = urlOrStr.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (matchShorts) return matchShorts[1];

      // 3. /embed/ or youtu.be
      const matchEmbed = urlOrStr.match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (matchEmbed) return matchEmbed[1];
    } catch (e) { }

    return null;
  }

  function getActiveVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || extractVideoId(window.location.pathname) || null;
  }

  // --- BADGE CREATION & INJECTION ---
  function createBadgeElement(videoId, score, isCompact = false) {
    const pct = Math.round(score * 100);
    let tierClass = 'sts-thumb-badge--human';
    let tooltip = `Stop the Slop: ${pct}% AI Probability (Likely Human-Written)`;

    if (score > 0.70) {
      tierClass = 'sts-thumb-badge--ai';
      tooltip = `Stop the Slop: ${pct}% AI script probability (Likely AI-Generated)`;
    } else if (score >= 0.40) {
      tierClass = 'sts-thumb-badge--mixed';
      tooltip = `Stop the Slop: ${pct}% AI script probability (Mixed Signals)`;
    }

    const container = document.createElement('div');
    container.className = `sts-thumb-badge-container${isCompact ? ' sts-thumb-badge-container--compact' : ''}`;
    container.dataset.stsVid = videoId;
    container.dataset.stsScore = String(score);

    const badge = document.createElement('span');
    badge.className = `sts-thumb-badge ${tierClass}${isCompact ? ' sts-thumb-badge--compact' : ''}`;
    badge.title = tooltip;

    const textSpan = document.createElement('span');
    textSpan.className = 'sts-badge-text';
    textSpan.textContent = `${pct}% AI`;

    badge.appendChild(textSpan);
    container.appendChild(badge);

    return container;
  }

  function findThumbnailTarget(anchorEl) {
    if (!anchorEl) return null;

    // 1. Playlist panel video item (watch queue sidebar / bottom drawer)
    const playlistPanelItem = anchorEl.closest('ytd-playlist-panel-video-renderer');
    if (playlistPanelItem) {
      // Pin badge directly to the thumbnail container or anchor, avoiding 0-height #overlays or the full-row anchor
      const thumb = playlistPanelItem.querySelector('ytd-thumbnail, #thumbnail-container ytd-thumbnail, a#thumbnail');
      if (thumb) return thumb;
    }

    // 2. Playlist page item (/playlist?list=...)
    const playlistVideoItem = anchorEl.closest('ytd-playlist-video-renderer');
    if (playlistVideoItem) {
      const thumb = playlistVideoItem.querySelector('ytd-thumbnail, a#thumbnail');
      if (thumb) return thumb;
    }

    // 3. If element itself is a thumbnail element
    if (anchorEl.tagName && anchorEl.tagName.toLowerCase() === 'ytd-thumbnail') {
      return anchorEl;
    }

    // 4. If anchor contains a ytd-thumbnail child
    const childThumb = anchorEl.querySelector('ytd-thumbnail, a#thumbnail');
    if (childThumb) return childThumb;

    // 5. Parent thumbnail wrapper
    const thumbWrapper = anchorEl.closest('ytd-thumbnail, [class*="thumbnail"], yt-lockup-view-model');
    if (thumbWrapper) {
      const wrapperOverlays = thumbWrapper.querySelector('#overlays');
      if (wrapperOverlays && wrapperOverlays.getBoundingClientRect().height > 10) {
        return wrapperOverlays;
      }
      return thumbWrapper;
    }

    // 6. Overlays container inside anchor with valid rendered height
    const overlays = anchorEl.querySelector('#overlays, .ytd-thumbnail-overlay, div[class*="overlay"]');
    if (overlays && overlays.getBoundingClientRect().height > 10) {
      return overlays;
    }

    // 7. Prevent rendering on loose title or row anchors
    if (
      anchorEl.id === 'video-title' ||
      anchorEl.id === 'video-title-link' ||
      anchorEl.id === 'wc-endpoint' ||
      (anchorEl.classList && anchorEl.classList.contains('yt-simple-endpoint') && !anchorEl.closest('ytd-thumbnail'))
    ) {
      const card = anchorEl.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer'
      );
      if (card) {
        const cardThumb = card.querySelector('ytd-thumbnail, a#thumbnail');
        if (cardThumb) return cardThumb;
      }
      return null;
    }

    return anchorEl;
  }

  function renderBadgeOnAnchor(anchorEl, videoId, score) {
    if (!anchorEl || !videoId || typeof score !== 'number') return;

    const target = findThumbnailTarget(anchorEl);
    if (!target) return;

    const existingContainer = target.querySelector('.sts-thumb-badge-container');
    if (existingContainer) {
      if (
        existingContainer.dataset.stsVid === videoId &&
        existingContainer.dataset.stsScore === String(score)
      ) {
        return; // Already up to date
      }
      existingContainer.remove();
    }

    const isCompact = Boolean(
      target.closest('ytd-playlist-panel-video-renderer') ||
      target.closest('ytd-playlist-video-renderer') ||
      target.closest('ytd-compact-video-renderer')
    );

    const badgeEl = createBadgeElement(videoId, score, isCompact);

    // Ensure target has relative positioning so absolute badge is pinned to thumbnail top-left
    const computed = window.getComputedStyle(target);
    if (computed.position === 'static') {
      target.style.position = 'relative';
    }

    target.appendChild(badgeEl);
  }

  // --- IN-PLAYER CONTROLS BADGE & POPOVER ---
  let playerBadgeRetryTimer = null;

  function createPlayerBadgeElement(videoId, score, details = null) {
    const pct = Math.round(score * 100);
    let tierClass = 'sts-player-badge--human';
    let tagClass = 'sts-popover-tag--human';
    let meterClass = 'sts-popover-meter-fill--human';
    let verdictTitle = 'Likely Human-Written';
    let verdictTag = 'Human';
    let verdictDesc = 'Language patterns strongly reflect natural, authentic human writing.';

    if (score > 0.70) {
      tierClass = 'sts-player-badge--ai';
      tagClass = 'sts-popover-tag--ai';
      meterClass = 'sts-popover-meter-fill--ai';
      verdictTitle = 'Likely AI-Generated';
      verdictTag = 'AI Script';
      verdictDesc = 'Repetitive structures and predictable syntactic patterns detected.';
    } else if (score >= 0.40) {
      tierClass = 'sts-player-badge--mixed';
      tagClass = 'sts-popover-tag--mixed';
      meterClass = 'sts-popover-meter-fill--mixed';
      verdictTitle = 'Mixed Signals';
      verdictTag = 'Mixed';
      verdictDesc = 'Shows a combination of human-like and structured or machine-assisted phrasing.';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'sts-player-badge-wrapper';
    wrapper.dataset.stsVid = videoId;
    wrapper.dataset.stsScore = String(score);

    // Button in player controls
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sts-player-badge ${tierClass}`;
    button.setAttribute('aria-label', `Stop the Slop: ${pct}% AI script probability (${verdictTitle})`);
    button.setAttribute('title', `Stop the Slop: ${pct}% AI Probability`);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'sts-player-badge-label';
    labelSpan.textContent = `${pct}% AI`;

    button.appendChild(labelSpan);
    wrapper.appendChild(button);

    // Popover Card
    const popover = document.createElement('div');
    popover.className = 'sts-player-popover';
    popover.setAttribute('role', 'tooltip');

    let analyzedDateText = '';
    if (details?.analyzedAt) {
      try {
        const d = new Date(details.analyzedAt);
        analyzedDateText = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } catch (e) { }
    }

    const header = document.createElement('div');
    header.className = 'sts-popover-header';
    const brand = document.createElement('div');
    brand.className = 'sts-popover-brand';
    const brandTitle = document.createElement('span');
    brandTitle.textContent = 'Stop the Slop';
    brand.appendChild(brandTitle);
    const tag = document.createElement('span');
    tag.className = `sts-popover-tag ${tagClass}`;
    tag.textContent = verdictTag;
    header.appendChild(brand);
    header.appendChild(tag);

    const body = document.createElement('div');
    body.className = 'sts-popover-body';

    const scoreRow = document.createElement('div');
    scoreRow.className = 'sts-popover-score-row';
    const scoreNum = document.createElement('span');
    scoreNum.className = 'sts-popover-score-number';
    scoreNum.textContent = `${pct}%`;
    const scoreMeta = document.createElement('div');
    scoreMeta.className = 'sts-popover-score-meta';
    const scoreTitle = document.createElement('div');
    scoreTitle.className = 'sts-popover-score-title';
    scoreTitle.textContent = `Script ${verdictTitle}`;
    scoreMeta.appendChild(scoreTitle);
    scoreRow.appendChild(scoreNum);
    scoreRow.appendChild(scoreMeta);

    const meter = document.createElement('div');
    meter.className = 'sts-popover-meter';
    const meterFill = document.createElement('div');
    meterFill.className = `sts-popover-meter-fill ${meterClass}`;
    meterFill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
    meter.appendChild(meterFill);

    const info = document.createElement('p');
    info.className = 'sts-popover-info';
    info.textContent = verdictDesc;

    body.appendChild(scoreRow);
    body.appendChild(meter);
    body.appendChild(info);

    const footer = document.createElement('div');
    footer.className = 'sts-popover-footer';
    const footerSpan1 = document.createElement('span');
    footerSpan1.textContent = 'Transcript analyzed';
    const footerSpan2 = document.createElement('span');
    footerSpan2.textContent = analyzedDateText ? `Scanned ${analyzedDateText}` : 'Edge verified';
    footer.appendChild(footerSpan1);
    footer.appendChild(footerSpan2);

    popover.appendChild(header);
    popover.appendChild(body);
    popover.appendChild(footer);

    wrapper.appendChild(popover);

    // Toggle popover pin on button click
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.toggle('sts-popover-open');
    });

    popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('sts-popover-open');
      }
    });

    return wrapper;
  }

  function getPlayerRightControls() {
    return document.querySelector(
      '#movie_player .ytp-right-controls, ' +
      '.html5-video-player .ytp-right-controls, ' +
      '.ytp-right-controls'
    );
  }

  function schedulePlayerBadgeRetry(videoId, score, details, attemptsLeft = 12) {
    if (playerBadgeRetryTimer) clearTimeout(playerBadgeRetryTimer);
    if (attemptsLeft <= 0) return;

    playerBadgeRetryTimer = setTimeout(() => {
      const currentVid = getActiveVideoId();
      if (currentVid !== videoId) return;

      const rightControls = getPlayerRightControls();
      if (rightControls) {
        renderPlayerBadge(videoId, score, details);
      } else {
        schedulePlayerBadgeRetry(videoId, score, details, attemptsLeft - 1);
      }
    }, 200);
  }

  function renderPlayerBadge(videoId, score, details = null) {
    if (!videoId || typeof score !== 'number') return;

    const rightControls = getPlayerRightControls();
    if (!rightControls) {
      schedulePlayerBadgeRetry(videoId, score, details);
      return;
    }

    const existingWrapper = rightControls.querySelector('.sts-player-badge-wrapper');
    if (existingWrapper) {
      if (
        existingWrapper.dataset.stsVid === videoId &&
        existingWrapper.dataset.stsScore === String(score)
      ) {
        return; // Already up to date
      }
      existingWrapper.remove();
    }

    const badgeWrapper = createPlayerBadgeElement(videoId, score, details);

    // Insert at the beginning of the right controls cluster (alongside right buttons)
    if (rightControls.firstChild) {
      rightControls.insertBefore(badgeWrapper, rightControls.firstChild);
    } else {
      rightControls.appendChild(badgeWrapper);
    }
  }

  function removePlayerBadge() {
    if (playerBadgeRetryTimer) {
      clearTimeout(playerBadgeRetryTimer);
      playerBadgeRetryTimer = null;
    }
    const existing = document.querySelectorAll('.sts-player-badge-wrapper');
    for (const el of existing) {
      el.remove();
    }
  }

  function removeStalePlayerBadge(currentVideoId) {
    if (!currentVideoId) {
      removePlayerBadge();
      return;
    }
    if (playerBadgeRetryTimer) {
      clearTimeout(playerBadgeRetryTimer);
      playerBadgeRetryTimer = null;
    }
    const existing = document.querySelectorAll('.sts-player-badge-wrapper');
    for (const el of existing) {
      if (el.dataset.stsVid !== currentVideoId) {
        el.remove();
      }
    }
  }

  // In-flight tracking to prevent duplicate concurrent checks & auto-analyses
  const inFlightChecks = new Set();
  const inFlightAutoAnalyses = new Set();

  async function checkAndRenderPlayerBadge(videoId) {
    if (!videoId) {
      removePlayerBadge();
      return;
    }

    // Immediately remove any badge belonging to a different video
    removeStalePlayerBadge(videoId);

    // 1. Check in-memory videoCache
    if (videoCache.has(videoId)) {
      const entry = videoCache.get(videoId);
      if (entry.found && typeof entry.score === 'number') {
        renderPlayerBadge(videoId, entry.score, entry);
        return;
      } else if (entry.found === false && entry.noTranscript) {
        if (getActiveVideoId() === videoId) {
          removePlayerBadge();
        }
        return;
      }
    }

    // Guard against firing duplicate concurrent checks for the same video
    if (inFlightChecks.has(videoId)) return;
    inFlightChecks.add(videoId);

    try {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }

      // 2. Check local storage (result_${videoId} or sts_cache_${videoId})
      const resultKey = `result_${videoId}`;
      const cacheKey = `sts_cache_${videoId}`;
      const stored = await chrome.storage.local.get([resultKey, cacheKey]);

      if (getActiveVideoId() !== videoId) return;

      if (videoCache.has(videoId)) {
        const entry = videoCache.get(videoId);
        if (entry.found && typeof entry.score === 'number') {
          renderPlayerBadge(videoId, entry.score, entry);
          return;
        } else if (entry.found === false && entry.noTranscript) {
          if (getActiveVideoId() === videoId) {
            removePlayerBadge();
          }
          return;
        }
      }

      const data = stored[resultKey] || stored[cacheKey];
      if (data && typeof data.score === 'number') {
        videoCache.set(videoId, {
          found: true,
          score: data.score,
          analyzedAt: data.analyzedAt,
          sentenceScores: data.sentenceScores,
        });
        renderPlayerBadge(videoId, data.score, data);
        return;
      }

      // 3. Fallback: check worker edge cache if on watch/shorts page
      try {
        const resp = await fetch(`${API_BASE}/api/check?videoId=${encodeURIComponent(videoId)}`);
        if (getActiveVideoId() !== videoId) return;

        if (videoCache.has(videoId)) {
          const entry = videoCache.get(videoId);
          if (entry.found && typeof entry.score === 'number') {
            renderPlayerBadge(videoId, entry.score, entry);
            return;
          } else if (entry.found === false && entry.noTranscript) {
            if (getActiveVideoId() === videoId) {
              removePlayerBadge();
            }
            return;
          }
        }

        if (resp.ok) {
          const data = await resp.json();
          if (data.found && typeof data.score === 'number') {
            videoCache.set(videoId, {
              found: true,
              score: data.score,
              analyzedAt: data.analyzedAt,
              sentenceScores: data.sentenceScores,
            });
            if (isExtensionValid()) {
              try {
                chrome.storage.local.set({
                  [`sts_cache_${videoId}`]: {
                    score: data.score,
                    analyzedAt: data.analyzedAt,
                  },
                }).catch(() => { });
              } catch (_) { }
            }
            renderPlayerBadge(videoId, data.score, data);
            return;
          }
        }
      } catch (e) { }

      if (getActiveVideoId() !== videoId) return;

      // 4. Video is unanalyzed: automatically analyze it now as soon as it opens!
      await autoAnalyzeVideo(videoId);
    } catch (e) {
      if (!isExtensionValid() || (e && typeof e.message === 'string' && e.message.includes('Extension context invalidated'))) {
        handleContextInvalidated();
        return;
      }
      stsWarn('Error checking player badge:', e);
    } finally {
      inFlightChecks.delete(videoId);
    }
  }

  /**
   * Automatically extracts the video transcript and analyzes it with Jev
   * as soon as a YouTube video is opened.
   */
  async function autoAnalyzeVideo(videoId) {
    if (!videoId || inFlightAutoAnalyses.has(videoId)) return;
    if (getActiveVideoId() !== videoId) return;

    // Skip if we already checked and found no score / no captions
    if (
      videoCache.has(videoId) &&
      videoCache.get(videoId).found === false &&
      videoCache.get(videoId).noTranscript
    ) {
      if (getActiveVideoId() === videoId) {
        removePlayerBadge();
      }
      return;
    }

    inFlightAutoAnalyses.add(videoId);

    try {
      // Allow YouTube player/DOM a brief moment (600ms) to initialize captions
      await new Promise((r) => setTimeout(r, 600));
      if (getActiveVideoId() !== videoId) return;

      // Extract transcript from main world
      let res = await requestTranscriptFromMainWorld(videoId);
      if ((!res || !res.transcript) && getActiveVideoId() === videoId) {
        // Retry once after 1s in case captions were still loading
        await new Promise((r) => setTimeout(r, 1000));
        if (getActiveVideoId() !== videoId) return;
        res = await requestTranscriptFromMainWorld(videoId);
      }

      const transcript = res?.transcript;
      if (!transcript || transcript.length < 50) {
        videoCache.set(videoId, { found: false, noTranscript: true });
        if (getActiveVideoId() === videoId) {
          removePlayerBadge();
        }
        return;
      }

      if (getActiveVideoId() !== videoId) return;

      stsLog('Transcript ready for automatic analysis', {
        videoId,
        length: transcript.length,
        preview: transcript.replace(/\s+/g, ' ').trim().slice(0, 180),
      });

      // Send to worker for instant analysis (defaults to TypeSafe Jev and caches to D1)
      const analyzeUrl = `${API_BASE}/api/analyze`;
      const startedAt = performance.now();
      stsLog('Backend request', {
        method: 'POST',
        url: analyzeUrl,
        operation: 'automatic-analyze',
        videoId,
        transcriptLength: transcript.length,
      });
      const analyzeResp = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          transcript,
        }),
      });
      stsLog('Backend response', {
        method: 'POST',
        url: analyzeUrl,
        operation: 'automatic-analyze',
        videoId,
        status: analyzeResp.status,
        ok: analyzeResp.ok,
        durationMs: Math.round(performance.now() - startedAt),
      });

      if (!analyzeResp.ok) {
        stsWarn('Automatic analysis returned an error', { videoId, status: analyzeResp.status });
        videoCache.set(videoId, { found: false });
        if (getActiveVideoId() === videoId) {
          removePlayerBadge();
        }
        return;
      }

      const data = await analyzeResp.json();
      if (!data || typeof data.score !== 'number') {
        videoCache.set(videoId, { found: false });
        if (getActiveVideoId() === videoId) {
          removePlayerBadge();
        }
        return;
      }

      stsLog('Automatic analysis result', {
        videoId,
        cached: data.cached === true,
        engine: data.engine || null,
        model: data.model || null,
        score: data.score,
        analyzedAt: data.analyzedAt || null,
      });

      // Update in-memory cache
      videoCache.set(videoId, {
        found: true,
        score: data.score,
        analyzedAt: data.analyzedAt || new Date().toISOString(),
        sentenceScores: data.sentenceScores,
        engine: data.engine,
      });

      // Persist to local storage for popup and subsequent visits
      if (isExtensionValid()) {
        try {
          chrome.storage.local
            .set({
              [`result_${videoId}`]: data,
              [`sts_cache_${videoId}`]: {
                score: data.score,
                analyzedAt: data.analyzedAt || new Date().toISOString(),
              },
            })
            .catch(() => {});
        } catch (_) {}

        // Notify service worker to update toolbar action badge
        try {
          chrome.runtime.sendMessage({
            type: 'ANALYSIS_COMPLETE',
            videoId,
            score: data.score,
          });
        } catch (_) {}
      }

      // If user is still on this video, render the in-player badge immediately!
      if (getActiveVideoId() === videoId) {
        renderPlayerBadge(videoId, data.score, data);
      }

      // Re-scan feed thumbnail badges
      requestScan();
    } catch (err) {
      if (!isExtensionValid() || (err && typeof err.message === 'string' && err.message.includes('Extension context invalidated'))) {
        handleContextInvalidated();
        return;
      }
      stsWarn('Auto-analysis error:', err);
      videoCache.set(videoId, { found: false });
      removePlayerBadge();
    } finally {
      inFlightAutoAnalyses.delete(videoId);
    }
  }

  // --- BATCH QUERY ENGINE ---
  async function flushBatch() {
    if (!isExtensionValid()) {
      handleContextInvalidated();
      return;
    }
    if (pendingBatch.size === 0) return;
    if (Date.now() < batchCooldownUntil) return;

    const videoIdsToQuery = Array.from(pendingBatch).slice(0, 40);
    for (const id of videoIdsToQuery) {
      pendingBatch.delete(id);
    }

    try {
      const batchUrl = `${API_BASE}/api/check-batch`;
      const startedAt = performance.now();
      stsLog('Backend request', {
        method: 'POST',
        url: batchUrl,
        operation: 'cache-batch-check',
        videoCount: videoIdsToQuery.length,
      });
      const response = await fetch(batchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds: videoIdsToQuery }),
      });
      stsLog('Backend response', {
        method: 'POST',
        url: batchUrl,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - startedAt),
        videoCount: videoIdsToQuery.length,
      });

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retrySecs =
          Number(response.headers.get('Retry-After')) ||
          Number(data.retryAfter) ||
          30;
        batchCooldownUntil = Date.now() + retrySecs * 1000;
        stsWarn(`Batch check rate-limited. Cooling down for ${retrySecs}s.`);
        // Re-queue IDs so they can be processed once cooldown ends
        for (const id of videoIdsToQuery) {
          pendingBatch.add(id);
        }
        return;
      }

      if (!response.ok) {
        throw new Error(`Batch check failed with status: ${response.status}`);
      }

      const data = await response.json();
      const cachedResults = data.cached || {};
      stsLog('Cache batch result', {
        requested: videoIdsToQuery.length,
        cached: Object.keys(cachedResults).length,
      });
      const storageToSave = {};

      for (const videoId of videoIdsToQuery) {
        const item = cachedResults[videoId];
        if (item && typeof item.score === 'number') {
          videoCache.set(videoId, {
            found: true,
            score: item.score,
            analyzedAt: item.analyzedAt,
          });
          storageToSave[`sts_cache_${videoId}`] = {
            score: item.score,
            analyzedAt: item.analyzedAt,
          };
        } else {
          // Mark not found in memory so we don't spam repeated requests on same page
          videoCache.set(videoId, { found: false });
        }
      }

      // Persist found items to local storage asynchronously
      if (Object.keys(storageToSave).length > 0 && isExtensionValid()) {
        try {
          chrome.storage.local.set(storageToSave).catch(() => { });
        } catch (_) { }
      }

      // Re-scan to apply newly fetched badges to DOM
      requestScan();
    } catch (err) {
      if (!isExtensionValid() || (err && typeof err.message === 'string' && err.message.includes('Extension context invalidated'))) {
        handleContextInvalidated();
        return;
      }
      stsWarn('Batch check error:', err);
      // Mark as not found for now to prevent infinite retry loops
      for (const videoId of videoIdsToQuery) {
        if (!videoCache.has(videoId)) {
          videoCache.set(videoId, { found: false });
        }
      }
    }
  }

  function queueVideoForBatch(videoId) {
    if (!isExtensionValid()) {
      handleContextInvalidated();
      return;
    }
    if (!videoId || videoCache.has(videoId)) return;

    pendingBatch.add(videoId);

    if (Date.now() < batchCooldownUntil) return;

    if (batchTimer) clearTimeout(batchTimer);
    if (pendingBatch.size >= 30) {
      flushBatch();
    } else {
      batchTimer = setTimeout(flushBatch, 160);
    }
  }

  // --- THUMBNAIL SCANNER ---
  function scanThumbnails() {
    if (!isExtensionValid()) {
      handleContextInvalidated();
      return;
    }
    if (isScanning) return;
    isScanning = true;

    try {
      // Broad selectors targeting YouTube thumbnail anchor elements and cards
      const candidateAnchors = document.querySelectorAll(
        'ytd-playlist-panel-video-renderer a#wc-endpoint, ' +
        'ytd-playlist-panel-video-renderer a#thumbnail, ' +
        'ytd-playlist-panel-video-renderer ytd-thumbnail, ' +
        'ytd-playlist-video-renderer a#thumbnail, ' +
        'ytd-playlist-video-renderer ytd-thumbnail, ' +
        'a#thumbnail, ' +
        'ytd-thumbnail a, ' +
        'a.ytd-thumbnail, ' +
        'ytd-rich-item-renderer a[href*="watch?v="], ' +
        'ytd-rich-item-renderer a[href*="/shorts/"], ' +
        'ytd-video-renderer a[href*="watch?v="], ' +
        'ytd-compact-video-renderer a[href*="watch?v="], ' +
        'ytd-grid-video-renderer a[href*="watch?v="], ' +
        'ytd-playlist-video-renderer a[href*="watch?v="], ' +
        'ytd-reel-item-renderer a[href*="/shorts/"], ' +
        'yt-lockup-view-model a[href*="watch?v="], ' +
        'a[class*="thumbnail"][href*="watch?v="]'
      );

      for (const anchor of candidateAnchors) {
        let href = anchor.getAttribute('href') || anchor.href;
        if (!href && anchor.querySelector) {
          const childA = anchor.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
          if (childA) href = childA.getAttribute('href') || childA.href;
        }
        const videoId = extractVideoId(href);

        if (!videoId) continue;

        // Check if cached
        if (videoCache.has(videoId)) {
          const entry = videoCache.get(videoId);
          if (entry.found && typeof entry.score === 'number') {
            renderBadgeOnAnchor(anchor, videoId, entry.score);
          } else {
            // Unanalyzed: remove badge if DOM node was recycled
            const target = findThumbnailTarget(anchor);
            const existing = target?.querySelector('.sts-thumb-badge-container');
            if (existing && existing.dataset.stsVid !== videoId) {
              existing.remove();
            }
          }
        } else {
          queueVideoForBatch(videoId);
        }
      }

      // Ensure active video player badge is present in right controls if analyzed
      const activeVid = getActiveVideoId();
      if (activeVid) {
        const rightControls = getPlayerRightControls();
        if (rightControls) {
          const existingBadge = rightControls.querySelector('.sts-player-badge-wrapper');
          if (existingBadge && existingBadge.dataset.stsVid !== activeVid) {
            existingBadge.remove();
          }
          if (videoCache.has(activeVid)) {
            const entry = videoCache.get(activeVid);
            if (entry.found && typeof entry.score === 'number' && !rightControls.querySelector('.sts-player-badge-wrapper')) {
              renderPlayerBadge(activeVid, entry.score, entry);
            }
          }
        }
      }
    } finally {
      isScanning = false;
    }
  }

  function requestScan() {
    if (!isExtensionValid()) {
      handleContextInvalidated();
      return;
    }
    if (scanScheduled) return;
    scanScheduled = true;

    requestAnimationFrame(() => {
      scanScheduled = false;
      scanThumbnails();
    });
  }

  // --- TRANSCRIPT EXTRACTION BRIDGE (FOR POPUP) ---
  function requestTranscriptFromMainWorld(videoId) {
    return new Promise((resolve) => {
      const requestId = `sts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const timer = setTimeout(() => {
        window.removeEventListener('message', handleResponse);
        resolve({ transcript: null, error: 'Timed out waiting for transcript' });
      }, 9000);

      function handleResponse(event) {
        if (event.source !== window) return;
        if (
          event.data?.type === 'STOP_THE_SLOP_RESP_TRANSCRIPT' &&
          event.data?.requestId === requestId
        ) {
          clearTimeout(timer);
          window.removeEventListener('message', handleResponse);
          resolve({
            transcript: event.data.transcript,
            error: event.data.error,
          });
        }
      }

      window.addEventListener('message', handleResponse);

      window.postMessage(
        {
          type: 'STOP_THE_SLOP_REQ_TRANSCRIPT',
          requestId,
          videoId,
        },
        '*'
      );
    });
  }

  function handleActiveVideoChange(videoId) {
    if (!isExtensionValid()) {
      handleContextInvalidated();
      return;
    }
    if (!videoId) {
      // Navigated to a non-video YouTube page (home, subscriptions, search...):
      // drop the in-player badge and clear the stale toolbar badge.
      lastActiveVideoId = null;
      removePlayerBadge();
      try {
        chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
      } catch (_) { }
      requestScan();
      return;
    }
    if (videoId === lastActiveVideoId) return;
    lastActiveVideoId = videoId;

    // Immediately remove any badge from the previous video
    removeStalePlayerBadge(videoId);

    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_CHANGED',
        videoId,
      });
    } catch (_) { }

    checkAndRenderPlayerBadge(videoId);
    requestScan();
  }

  // --- RUNTIME MESSAGE LISTENER ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_TRANSCRIPT') {
      (async () => {
        try {
          const res = await requestTranscriptFromMainWorld(message.videoId);
          sendResponse({ transcript: res.transcript, error: res.error });
        } catch (err) {
          sendResponse({ transcript: null, error: err.message });
        }
      })();
      return true; // Keep channel open for async response
    }
    if (message.type === 'REFRESH_THUMBNAILS') {
      requestScan();
    }
  });

  // --- INITIALIZATION & OBSERVERS ---
  async function init() {
    injectStyles();
    await syncLocalCache();

    // Observe DOM mutations to dynamically scan new thumbnails during infinite scroll
    observer = new MutationObserver(() => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      if (mutationThrottle) return;
      mutationThrottle = setTimeout(() => {
        mutationThrottle = null;
        requestScan();
      }, 150);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Capture scrolling inside playlist panel container and window to continuously update recycled items
    window.addEventListener('scroll', () => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      if (scrollThrottle) return;
      scrollThrottle = setTimeout(() => {
        scrollThrottle = null;
        requestScan();
      }, 120);
    }, { passive: true, capture: true });

    // YouTube navigation starts: purge old badge immediately upon link click
    document.addEventListener('yt-navigate-start', () => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      removePlayerBadge();
    });

    // YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', () => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      // Always route through handleActiveVideoChange (even for non-video
      // pages) so lastActiveVideoId tracking stays consistent — otherwise
      // revisiting the same video later is treated as "no change" and the
      // service worker is never told to restore the toolbar badge.
      handleActiveVideoChange(getActiveVideoId());
      requestScan();
    });

    document.addEventListener('yt-page-data-updated', () => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      // Always route through handleActiveVideoChange (even for non-video
      // pages) so lastActiveVideoId tracking stays consistent — otherwise
      // revisiting the same video later is treated as "no change" and the
      // service worker is never told to restore the toolbar badge.
      handleActiveVideoChange(getActiveVideoId());
      requestScan();
    });

    window.addEventListener('popstate', () => {
      if (!isExtensionValid()) {
        handleContextInvalidated();
        return;
      }
      handleActiveVideoChange(getActiveVideoId());
      requestScan();
    });

    // Initial page scan and player badge check
    handleActiveVideoChange(getActiveVideoId());
    requestScan();
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
