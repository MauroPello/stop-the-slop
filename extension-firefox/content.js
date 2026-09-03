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

  const API_BASE = 'https://stop-the-slop-api.maurobum43.workers.dev';
  let lastActiveVideoId = null;

  // In-memory cache: videoId -> { found: boolean, score?: number, analyzedAt?: string }
  const videoCache = new Map();
  const pendingBatch = new Set();
  let batchTimer = null;
  let batchCooldownUntil = 0;
  let scanScheduled = false;
  let isScanning = false;

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

      .sts-popover-flagged-preview {
        background: rgba(255, 255, 255, 0.06) !important;
        border-left: 2.5px solid #ef4444 !important;
        border-radius: 0 4px 4px 0 !important;
        padding: 5px 8px !important;
        margin: 0 0 10px 0 !important;
      }

      .sts-popover-flagged-label {
        font-size: 9.5px !important;
        font-weight: 700 !important;
        color: #fca5a5 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.3px !important;
        margin-bottom: 2px !important;
      }

      .sts-popover-flagged-text {
        font-size: 10.5px !important;
        color: rgba(255, 255, 255, 0.82) !important;
        font-style: italic !important;
        line-height: 1.35 !important;
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
            transcriptLength: val.transcriptLength,
            sentenceScores: val.sentenceScores,
          });
        }
      }
    } catch (e) {
      console.warn('[Stop the Slop] Error syncing local cache:', e);
    }
  }

  // Listen for storage updates (e.g. when popup analyzes a video)
  chrome.storage.onChanged.addListener((changes, areaName) => {
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
            transcriptLength: change.newValue.transcriptLength,
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

    if (score >= 0.65) {
      tierClass = 'sts-thumb-badge--ai';
      tooltip = `Stop the Slop: ${pct}% AI script probability (Likely AI-Generated)`;
    } else if (score >= 0.35) {
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

    if (score >= 0.65) {
      tierClass = 'sts-player-badge--ai';
      tagClass = 'sts-popover-tag--ai';
      meterClass = 'sts-popover-meter-fill--ai';
      verdictTitle = 'Likely AI-Generated';
      verdictTag = 'AI Script';
      verdictDesc = 'Repetitive structures and predictable syntactic patterns detected.';
    } else if (score >= 0.35) {
      tierClass = 'sts-player-badge--mixed';
      tagClass = 'sts-popover-tag--mixed';
      meterClass = 'sts-popover-meter-fill--mixed';
      verdictTitle = 'Mixed Signals';
      verdictTag = 'Mixed';
      verdictDesc = 'Shows a combination of human-like and machine-assisted phrasing.';
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

    let wordCountText = '';
    if (details?.transcriptLength) {
      const words = Math.round(details.transcriptLength / 5);
      wordCountText = `~${words.toLocaleString()} words`;
    }

    let flaggedSentenceHtml = '';
    if (details?.sentenceScores && Array.isArray(details.sentenceScores) && details.sentenceScores.length > 0) {
      const topSentence = details.sentenceScores[0];
      if (topSentence && topSentence.sentence && topSentence.score >= 0.5) {
        const excerpt = topSentence.sentence.length > 80
          ? topSentence.sentence.slice(0, 80) + '…'
          : topSentence.sentence;
        flaggedSentenceHtml = `
          <div class="sts-popover-flagged-preview">
            <div class="sts-popover-flagged-label">Flagged excerpt (${Math.round(topSentence.score * 100)}% AI):</div>
            <div class="sts-popover-flagged-text">“${excerpt}”</div>
          </div>
        `;
      }
    }

    popover.innerHTML = `
      <div class="sts-popover-header">
        <div class="sts-popover-brand">
          <span>Stop the Slop</span>
        </div>
        <span class="sts-popover-tag ${tagClass}">${verdictTag}</span>
      </div>

      <div class="sts-popover-body">
        <div class="sts-popover-score-row">
          <span class="sts-popover-score-number">${pct}%</span>
          <div class="sts-popover-score-meta">
            <div class="sts-popover-score-title">Script ${verdictTitle}</div>
          </div>
        </div>

        <div class="sts-popover-meter">
          <div class="sts-popover-meter-fill ${meterClass}" style="width: ${Math.max(4, Math.min(100, pct))}%;"></div>
        </div>

        <p class="sts-popover-info">${verdictDesc}</p>
        ${flaggedSentenceHtml}
      </div>

      <div class="sts-popover-footer">
        <span>${wordCountText ? wordCountText : 'Transcript analyzed'}</span>
        <span>${analyzedDateText ? `Scanned ${analyzedDateText}` : 'Edge verified'}</span>
      </div>
    `;

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

  async function checkAndRenderPlayerBadge(videoId) {
    if (!videoId) {
      removePlayerBadge();
      return;
    }

    // 1. Check in-memory videoCache
    if (videoCache.has(videoId)) {
      const entry = videoCache.get(videoId);
      if (entry.found && typeof entry.score === 'number') {
        renderPlayerBadge(videoId, entry.score, entry);
        return;
      } else if (entry.found === false) {
        removePlayerBadge();
        return;
      }
    }

    // 2. Check local storage (result_${videoId} or sts_cache_${videoId})
    try {
      const resultKey = `result_${videoId}`;
      const cacheKey = `sts_cache_${videoId}`;
      const stored = await chrome.storage.local.get([resultKey, cacheKey]);

      if (getActiveVideoId() !== videoId) return;

      if (videoCache.has(videoId)) {
        const entry = videoCache.get(videoId);
        if (entry.found && typeof entry.score === 'number') {
          renderPlayerBadge(videoId, entry.score, entry);
          return;
        }
      }

      const data = stored[resultKey] || stored[cacheKey];
      if (data && typeof data.score === 'number') {
        videoCache.set(videoId, {
          found: true,
          score: data.score,
          analyzedAt: data.analyzedAt,
          transcriptLength: data.transcriptLength,
          sentenceScores: data.sentenceScores,
        });
        renderPlayerBadge(videoId, data.score, data);
        return;
      }
    } catch (e) { }

    // 3. Fallback: check worker edge cache if on watch/shorts page
    try {
      const resp = await fetch(`${API_BASE}/api/check?videoId=${encodeURIComponent(videoId)}`);
      if (getActiveVideoId() !== videoId) return;

      if (videoCache.has(videoId)) {
        const entry = videoCache.get(videoId);
        if (entry.found && typeof entry.score === 'number') {
          renderPlayerBadge(videoId, entry.score, entry);
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
            transcriptLength: data.transcriptLength,
            sentenceScores: data.sentenceScores,
          });
          chrome.storage.local.set({
            [`sts_cache_${videoId}`]: {
              score: data.score,
              analyzedAt: data.analyzedAt,
            },
          }).catch(() => { });
          renderPlayerBadge(videoId, data.score, data);
          return;
        } else {
          videoCache.set(videoId, { found: false });
          removePlayerBadge();
          return;
        }
      }
    } catch (e) { }

    // If unanalyzed and not in cache, do not display badge
    if (getActiveVideoId() === videoId && (!videoCache.has(videoId) || !videoCache.get(videoId).found)) {
      videoCache.set(videoId, { found: false });
      removePlayerBadge();
    }
  }

  // --- BATCH QUERY ENGINE ---
  async function flushBatch() {
    if (pendingBatch.size === 0) return;
    if (Date.now() < batchCooldownUntil) return;

    const videoIdsToQuery = Array.from(pendingBatch).slice(0, 40);
    for (const id of videoIdsToQuery) {
      pendingBatch.delete(id);
    }

    try {
      const response = await fetch(`${API_BASE}/api/check-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds: videoIdsToQuery }),
      });

      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const retrySecs =
          Number(response.headers.get('Retry-After')) ||
          Number(data.retryAfter) ||
          30;
        batchCooldownUntil = Date.now() + retrySecs * 1000;
        console.warn(`[Stop the Slop] Batch check rate-limited. Cooling down for ${retrySecs}s.`);
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
      if (Object.keys(storageToSave).length > 0) {
        chrome.storage.local.set(storageToSave).catch(() => { });
      }

      // Re-scan to apply newly fetched badges to DOM
      requestScan();
    } catch (err) {
      console.warn('[Stop the Slop] Batch check error:', err);
      // Mark as not found for now to prevent infinite retry loops
      for (const videoId of videoIdsToQuery) {
        if (!videoCache.has(videoId)) {
          videoCache.set(videoId, { found: false });
        }
      }
    }
  }

  function queueVideoForBatch(videoId) {
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
      if (activeVid && videoCache.has(activeVid)) {
        const entry = videoCache.get(activeVid);
        if (entry.found && typeof entry.score === 'number') {
          const rightControls = getPlayerRightControls();
          if (rightControls && !rightControls.querySelector('.sts-player-badge-wrapper')) {
            renderPlayerBadge(activeVid, entry.score, entry);
          }
        }
      }
    } finally {
      isScanning = false;
    }
  }

  function requestScan() {
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
    if (!videoId) {
      lastActiveVideoId = null;
      removePlayerBadge();
      return;
    }
    if (videoId === lastActiveVideoId) return;
    lastActiveVideoId = videoId;

    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_CHANGED',
        videoId,
      });
    } catch (e) { }

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
    let mutationThrottle = null;
    const observer = new MutationObserver(() => {
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
    let scrollThrottle = null;
    window.addEventListener('scroll', () => {
      if (scrollThrottle) return;
      scrollThrottle = setTimeout(() => {
        scrollThrottle = null;
        requestScan();
      }, 120);
    }, { passive: true, capture: true });

    // YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', () => {
      const videoId = getActiveVideoId();
      if (videoId) {
        handleActiveVideoChange(videoId);
      } else {
        removePlayerBadge();
      }
      requestScan();
    });

    document.addEventListener('yt-page-data-updated', () => {
      const videoId = getActiveVideoId();
      if (videoId) checkAndRenderPlayerBadge(videoId);
      requestScan();
    });

    // Initial page scan and player badge check
    const initialVideoId = getActiveVideoId();
    if (initialVideoId) {
      handleActiveVideoChange(initialVideoId);
    } else {
      removePlayerBadge();
    }
    requestScan();
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
