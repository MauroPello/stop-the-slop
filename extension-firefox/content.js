/**
 * Stop the Slop — Isolated World Content Script
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
        line-line: 1 !important;
        user-select: none !important;
        animation: sts-badge-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
        gap: 4px !important;
        padding: 3px 7px !important;
        border-radius: 6px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.2px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease !important;
        cursor: default !important;
      }

      /* AI Tier: High Risk (>= 65%) */
      .sts-thumb-badge--ai {
        background: rgba(220, 38, 38, 0.90) !important;
        color: #ffffff !important;
        border: 1px solid rgba(254, 202, 202, 0.4) !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4) !important;
      }

      /* AI Tier: Mixed (35% - 64%) */
      .sts-thumb-badge--mixed {
        background: rgba(217, 119, 6, 0.92) !important;
        color: #ffffff !important;
        border: 1px solid rgba(254, 240, 138, 0.4) !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4) !important;
      }

      /* AI Tier: Human (< 35%) */
      .sts-thumb-badge--human {
        background: rgba(16, 185, 129, 0.90) !important;
        color: #ffffff !important;
        border: 1px solid rgba(167, 243, 208, 0.4) !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4) !important;
      }

      .sts-thumb-badge .sts-badge-icon {
        font-size: 11px !important;
        line-height: 1 !important;
      }

      .sts-thumb-badge .sts-badge-text {
        font-weight: 700 !important;
        font-size: 11px !important;
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
          });
          updated = true;
        }
      }
    }

    if (updated) {
      requestScan();
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
    } catch (e) {}

    return null;
  }

  function getActiveVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || extractVideoId(window.location.pathname) || null;
  }

  // --- BADGE CREATION & INJECTION ---
  function createBadgeElement(videoId, score) {
    const pct = Math.round(score * 100);
    let tierClass = 'sts-thumb-badge--human';
    let emoji = '✅';
    let label = `${pct}% Human`;
    let tooltip = `Stop the Slop: ${pct}% Human-written score`;

    if (score >= 0.65) {
      tierClass = 'sts-thumb-badge--ai';
      emoji = '🤖';
      label = `${pct}% AI`;
      tooltip = `Stop the Slop: ${pct}% AI-generated script detected`;
    } else if (score >= 0.35) {
      tierClass = 'sts-thumb-badge--mixed';
      emoji = '🤔';
      label = `${pct}% Mixed`;
      tooltip = `Stop the Slop: ${pct}% Mixed AI/Human script`;
    }

    const container = document.createElement('div');
    container.className = 'sts-thumb-badge-container';
    container.dataset.stsVid = videoId;
    container.dataset.stsScore = String(score);

    const badge = document.createElement('span');
    badge.className = `sts-thumb-badge ${tierClass}`;
    badge.title = tooltip;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'sts-badge-icon';
    iconSpan.textContent = emoji;

    const textSpan = document.createElement('span');
    textSpan.className = 'sts-badge-text';
    textSpan.textContent = label;

    badge.appendChild(iconSpan);
    badge.appendChild(textSpan);
    container.appendChild(badge);

    return container;
  }

  function findThumbnailTarget(anchorEl) {
    // 1. Check overlays container inside anchor
    const overlays = anchorEl.querySelector('#overlays, .ytd-thumbnail-overlay, div[class*="overlay"]');
    if (overlays) return overlays;

    // 2. Check parent thumbnail element
    const thumbWrapper = anchorEl.closest('ytd-thumbnail, [class*="thumbnail"], yt-lockup-view-model');
    if (thumbWrapper) {
      const wrapperOverlays = thumbWrapper.querySelector('#overlays');
      if (wrapperOverlays) return wrapperOverlays;
      return thumbWrapper;
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

    const badgeEl = createBadgeElement(videoId, score);

    // Ensure target has relative positioning
    const computed = window.getComputedStyle(target);
    if (computed.position === 'static') {
      target.style.position = 'relative';
    }

    target.appendChild(badgeEl);
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
        chrome.storage.local.set(storageToSave).catch(() => {});
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
        const href = anchor.getAttribute('href') || anchor.href;
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
    if (!videoId || videoId === lastActiveVideoId) return;
    lastActiveVideoId = videoId;

    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_CHANGED',
        videoId,
      });
    } catch (e) {}

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

    // YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', () => {
      const videoId = getActiveVideoId();
      if (videoId) handleActiveVideoChange(videoId);
      requestScan();
    });

    document.addEventListener('yt-page-data-updated', () => {
      requestScan();
    });

    // Initial page scan
    const initialVideoId = getActiveVideoId();
    if (initialVideoId) handleActiveVideoChange(initialVideoId);
    requestScan();
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
