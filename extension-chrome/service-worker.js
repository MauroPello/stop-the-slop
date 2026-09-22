/**
 * Stop the Slop: Service Worker (Background)
 *
 * Handles messages from the content script and manages badge state.
 * Per MV3 rules: no global state, uses chrome.storage for persistence.
 */

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (message.type === 'VIDEO_CHANGED') {
    handleVideoChange(message.videoId, tabId);
  } else if (message.type === 'CLEAR_BADGE') {
    if (tabId) {
      clearBadge(tabId);
    }
  } else if (message.type === 'ANALYSIS_COMPLETE') {
    if (tabId && typeof message.score === 'number') {
      // Only update the badge if the analyzed video is still the one open in
      // this tab, otherwise a late result for a previous video sticks around.
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          const activeVideoId = extractVideoIdFromUrl(tab.url || tab.pendingUrl);
          if (!activeVideoId || activeVideoId === message.videoId) {
            updateBadge(tabId, message.score);
          }
        })
        .catch(() => { });
    }
  }
  return false; // No async response needed
});

// Safety net: whenever a tab's URL changes (full navigation or SPA
// pushState), clear any stale per-tab badge if the destination is not a
// YouTube video page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (typeof changeInfo.url === 'string' && !extractVideoIdFromUrl(changeInfo.url)) {
    clearBadge(tabId);
  }
});

const API_BASE = 'https://stop-the-slop-api.maurobum43.workers.dev';

const VIDEO_ID_PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /\/shorts\/([a-zA-Z0-9_-]{11})/,
  /(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
];

function extractVideoIdFromUrl(url) {
  if (!url) return null;
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Clear the toolbar badge for a tab (no-op if nothing is set).
 */
async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ text: '', tabId });
  } catch (e) {
    // Tab may already be gone
  }
}

/**
 * When the user navigates to a new video, update badge state.
 */
async function handleVideoChange(videoId, tabId) {
  if (!videoId || !tabId) return;

  // Store the current video ID for the popup
  await chrome.storage.local.set({ currentVideoId: videoId });

  // 1. Check local storage first
  const storageKey = `result_${videoId}`;
  const stored = await chrome.storage.local.get(storageKey);

  if (stored[storageKey] && typeof stored[storageKey].score === 'number') {
    const score = stored[storageKey].score;
    await updateBadge(tabId, score);
    return;
  }

  // Clear badge immediately for unanalyzed videos so previous video's score doesn't linger
  await chrome.action.setBadgeText({ text: '', tabId });

  // 2. Check Cloudflare Worker edge cache
  try {
    const resp = await fetch(
      `${API_BASE}/api/check?videoId=${encodeURIComponent(videoId)}`
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.found && typeof data.score === 'number') {
        await chrome.storage.local.set({
          [storageKey]: data,
          [`sts_cache_${videoId}`]: {
            score: data.score,
            analyzedAt: data.analyzedAt || new Date().toISOString(),
          },
        });
        // Only set the badge if this video is still the one open in the tab,
        // otherwise a slow edge-cache lookup could resurrect a stale badge.
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        const activeVideoId = extractVideoIdFromUrl(tab?.url || tab?.pendingUrl);
        if (!activeVideoId || activeVideoId === videoId) {
          await updateBadge(tabId, data.score);
        }
        return;
      }
    }
  } catch (e) {
    // Ignore network error in background
  }

  // Clear badge for unanalyzed videos
  await chrome.action.setBadgeText({ text: '', tabId });
}

/**
 * Update the extension badge with the AI score.
 */
async function updateBadge(tabId, score) {
  const pct = Math.round(score * 100);
  let bgColor;

  if (score < 0.40) {
    bgColor = '#34d399'; // green (Likely Human)
  } else if (score <= 0.70) {
    bgColor = '#fbbf24'; // yellow (Mixed Signals)
  } else {
    bgColor = '#ef4444'; // red (Likely AI)
  }

  await chrome.action.setBadgeText({ text: `${pct}%`, tabId });
  await chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId });
}
