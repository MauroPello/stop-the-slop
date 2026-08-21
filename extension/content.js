/**
 * Stop the Slop — Content Script
 *
 * Injected into YouTube pages. Extracts transcripts from YouTube's internal
 * captions API and communicates with the service worker.
 *
 * Since this runs on youtube.com, we can fetch captions without CORS issues
 * or datacenter IP blocks.
 */

(() => {
  let lastVideoId = null;

  /**
   * Extract video ID from the current URL.
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v') || null;
  }

  /**
   * Get the player response by injecting a script into the page context.
   * Content scripts live in an isolated world and can't access page JS globals,
   * so we use postMessage to bridge the gap.
   */
  function getPlayerResponseFromPage() {
    return new Promise((resolve) => {
      const messageId = `__sts_${Date.now()}_${Math.random()}`;

      function handler(event) {
        if (event.data?.type === messageId) {
          window.removeEventListener('message', handler);
          resolve(event.data.playerResponse);
        }
      }
      window.addEventListener('message', handler);

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          var pr = null;
          // Try ytInitialPlayerResponse (set on initial page load)
          if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
            pr = ytInitialPlayerResponse;
          }
          // Try ytplayer.config (older YouTube)
          if (!pr && typeof ytplayer !== 'undefined' && ytplayer && ytplayer.config) {
            try { pr = JSON.parse(ytplayer.config.args.raw_player_response); } catch(e) {}
          }
          // Try to get from the movie_player element
          if (!pr) {
            try {
              var player = document.getElementById('movie_player');
              if (player && player.getPlayerResponse) {
                pr = player.getPlayerResponse();
              }
            } catch(e) {}
          }
          window.postMessage({
            type: ${JSON.stringify(messageId)},
            playerResponse: pr
          }, '*');
        })();
      `;
      document.documentElement.appendChild(script);
      script.remove();

      // Timeout after 2s
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 2000);
    });
  }

  /**
   * Parse the player response from raw HTML using robust JSON extraction.
   * Instead of a simple regex, we find the start marker and then extract
   * the full JSON object by counting braces.
   */
  function extractPlayerResponseFromHtml(html) {
    const markers = [
      'ytInitialPlayerResponse = ',
      'ytInitialPlayerResponse=',
    ];

    for (const marker of markers) {
      const startIdx = html.indexOf(marker);
      if (startIdx === -1) continue;

      const jsonStart = html.indexOf('{', startIdx);
      if (jsonStart === -1) continue;

      // Count braces to find the matching closing brace
      let depth = 0;
      let inString = false;
      let escape = false;

      for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (ch === '\\' && inString) {
          escape = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = html.substring(jsonStart, i + 1);
            try {
              return JSON.parse(jsonStr);
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Fetch transcript using YouTube's internal innertube player API.
   * This is the most reliable method and works regardless of page state.
   */
  async function fetchViaInnertubeApi(videoId) {
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240101.00.00',
              hl: 'en',
            },
          },
        }),
      });

      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
    } catch (e) {
      console.error('[Stop the Slop] Innertube API failed:', e);
      return null;
    }
  }

  /**
   * Get caption tracks from any available source.
   */
  async function getCaptionTracks(videoId) {
    // Method 1: Inject into page context to read the player response directly
    const pageResponse = await getPlayerResponseFromPage();
    if (pageResponse) {
      const tracks = pageResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        console.log('[Stop the Slop] Got caption tracks from page context');
        return tracks;
      }
    }

    // Method 2: Fetch the watch page and extract player response via brace counting
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        credentials: 'include',
      });
      const html = await resp.text();
      const playerResp = extractPlayerResponseFromHtml(html);
      if (playerResp) {
        const tracks = playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('[Stop the Slop] Got caption tracks from HTML parsing');
          return tracks;
        }
      }
    } catch (e) {
      console.error('[Stop the Slop] HTML fetch failed:', e);
    }

    // Method 3: Use YouTube's internal innertube player API
    const innertubeTrack = await fetchViaInnertubeApi(videoId);
    if (innertubeTrack && innertubeTrack.length > 0) {
      console.log('[Stop the Slop] Got caption tracks from innertube API');
      return innertubeTrack;
    }

    return null;
  }

  /**
   * Fetch transcript from a caption track URL.
   */
  async function fetchCaptionsFromTrack(track) {
    if (!track?.baseUrl) return null;

    // Try JSON3 format first (easier to parse)
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', 'json3');

      const resp = await fetch(url.toString(), { credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json();
        if (data.events) {
          const segments = data.events
            .filter((e) => e.segs)
            .map((e) =>
              e.segs
                .map((s) => s.utf8 || '')
                .join('')
                .replace(/\n/g, ' ')
                .trim()
            )
            .filter((t) => t.length > 0);

          if (segments.length > 0) return segments.join(' ');
        }
      }
    } catch (e) {
      console.error('[Stop the Slop] JSON3 format failed:', e);
    }

    // Fallback: XML format
    try {
      const resp = await fetch(track.baseUrl, { credentials: 'include' });
      if (!resp.ok) return null;

      const xml = await resp.text();
      const segments = [];
      const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
      let m;
      while ((m = regex.exec(xml)) !== null) {
        const text = m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\n/g, ' ')
          .trim();
        if (text) segments.push(text);
      }
      if (segments.length > 0) return segments.join(' ');
    } catch (e) {
      console.error('[Stop the Slop] XML format failed:', e);
    }

    return null;
  }

  /**
   * Main function to fetch transcript for a video.
   */
  async function fetchTranscript(videoId) {
    const captionTracks = await getCaptionTracks(videoId);

    if (!captionTracks || captionTracks.length === 0) {
      console.warn('[Stop the Slop] No caption tracks found for', videoId);
      return null;
    }

    // Prefer English, fallback to first available
    const englishTrack = captionTracks.find(
      (t) => t.languageCode === 'en' || t.languageCode?.startsWith('en')
    );
    const track = englishTrack || captionTracks[0];

    console.log('[Stop the Slop] Using caption track:', track.languageCode, track.name?.simpleText || '');

    return await fetchCaptionsFromTrack(track);
  }

  /**
   * Handle video navigation changes.
   */
  function handleVideoChange(videoId) {
    if (!videoId || videoId === lastVideoId) return;
    lastVideoId = videoId;

    chrome.runtime.sendMessage({
      type: 'VIDEO_CHANGED',
      videoId,
    });
  }

  /**
   * Listen for transcript fetch requests from the popup.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_TRANSCRIPT') {
      (async () => {
        try {
          const transcript = await fetchTranscript(message.videoId);
          sendResponse({ transcript, error: null });
        } catch (err) {
          console.error('[Stop the Slop] Transcript fetch error:', err);
          sendResponse({ transcript: null, error: err.message });
        }
      })();
      return true; // keeps channel open for async response
    }
  });

  // YouTube SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    const videoId = getVideoId();
    if (videoId) handleVideoChange(videoId);
  });

  // Initial check
  const initialVideoId = getVideoId();
  if (initialVideoId) handleVideoChange(initialVideoId);
})();
