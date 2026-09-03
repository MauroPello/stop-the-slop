/**
 * Stop the Slop: Service Worker (Background)
 *
 * Handles messages from the content script and manages badge state.
 * Per MV3 rules: no global state, uses chrome.storage for persistence.
 */

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VIDEO_CHANGED') {
    handleVideoChange(message.videoId, sender.tab?.id);
  }
  return false; // No async response needed
});

const API_BASE = 'https://stop-the-slop-api.maurobum43.workers.dev';

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
        await updateBadge(tabId, data.score);
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

  if (score < 0.35) {
    bgColor = '#34d399'; // green
  } else if (score < 0.65) {
    bgColor = '#fbbf24'; // yellow
  } else {
    bgColor = '#ef4444'; // red
  }

  await chrome.action.setBadgeText({ text: `${pct}%`, tabId });
  await chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId });
}
