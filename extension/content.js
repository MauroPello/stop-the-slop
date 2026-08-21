/**
 * Stop the Slop — Isolated World Content Script
 *
 * Injected into YouTube pages in the ISOLATED world.
 * Bridges between the popup/service-worker and content-main.js (which runs in MAIN world).
 */

(() => {
  if (window.__STOP_THE_SLOP_ISO_INIT__) return;
  window.__STOP_THE_SLOP_ISO_INIT__ = true;
  let lastVideoId = null;

  /**
   * Extract video ID from current URL
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || null;
  }

  /**
   * Request transcript from content-main.js running in MAIN world
   */
  function requestTranscriptFromMainWorld(videoId) {
    return new Promise((resolve) => {
      const requestId = `sts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const timer = setTimeout(() => {
        window.removeEventListener('message', handleResponse);
        resolve({ transcript: null, error: 'Timed out waiting for transcript' });
      }, 5000);

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

  /**
   * Notify background service worker when video changes
   */
  function handleVideoChange(videoId) {
    if (!videoId || videoId === lastVideoId) return;
    lastVideoId = videoId;

    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_CHANGED',
        videoId,
      });
    } catch (e) {
      // Background worker might be sleeping
    }
  }

  /**
   * Listen for messages from the popup
   */
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
      return true; // Keep message channel open for async response
    }
  });

  // Track SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    const videoId = getVideoId();
    if (videoId) handleVideoChange(videoId);
  });

  // Initial check
  const initialVideoId = getVideoId();
  if (initialVideoId) handleVideoChange(initialVideoId);
})();
