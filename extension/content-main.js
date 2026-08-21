/**
 * Stop the Slop — Main World Content Script
 *
 * Runs in the webpage's MAIN JavaScript context (world: "MAIN").
 * This allows direct access to YouTube's JavaScript objects:
 *   - window.ytInitialPlayerResponse
 *   - document.getElementById('movie_player')
 *   - window.ytplayer
 *
 * Without violating page CSP (since it is injected directly by Chrome).
 */

(() => {
  if (window.__STOP_THE_SLOP_MAIN_INIT__) return;
  window.__STOP_THE_SLOP_MAIN_INIT__ = true;
  // Helper: decode HTML / XML entities
  function decodeEntities(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  }

  // Get player response object
  function getPlayerResponse() {
    // 1. Try movie_player element
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const pr = player.getPlayerResponse();
        if (pr) return pr;
      }
    } catch (e) {
      console.warn('[Stop the Slop] movie_player.getPlayerResponse failed', e);
    }

    // 2. Try window.ytInitialPlayerResponse
    try {
      if (typeof window.ytInitialPlayerResponse !== 'undefined' && window.ytInitialPlayerResponse) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) {}

    // 3. Try ytplayer config
    try {
      if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
        const raw = window.ytplayer.config.args.raw_player_response;
        if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {}

    // 4. Try scanning script tags in DOM for ytInitialPlayerResponse
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('ytInitialPlayerResponse')) {
          const startIdx = t.indexOf('ytInitialPlayerResponse');
          const jsonStart = t.indexOf('{', startIdx);
          if (jsonStart !== -1) {
            let depth = 0, inStr = false, esc = false;
            for (let i = jsonStart; i < t.length; i++) {
              const c = t[i];
              if (esc) { esc = false; continue; }
              if (c === '\\') { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === '{') depth++;
              else if (c === '}') {
                depth--;
                if (depth === 0) {
                  return JSON.parse(t.substring(jsonStart, i + 1));
                }
              }
            }
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // Extract caption tracks
  function getCaptionTracks(playerResponse) {
    if (!playerResponse) return null;
    const captions = playerResponse.captions;
    const tracklist = captions?.playerCaptionsTracklistRenderer;
    return tracklist?.captionTracks || null;
  }

  // Fetch and parse captions from timedtext URL
  async function fetchCaptions(track) {
    if (!track || !track.baseUrl) return null;

    // Try json3 first
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', 'json3');

      const res = await fetch(url.toString(), { credentials: 'include' });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          try {
            const data = JSON.parse(text);
            if (data.events && Array.isArray(data.events)) {
              const segments = data.events
                .filter(e => e.segs && Array.isArray(e.segs))
                .map(e => e.segs.map(s => s.utf8 || '').join(''))
                .map(s => s.replace(/\n/g, ' ').trim())
                .filter(Boolean);

              if (segments.length > 0) {
                return segments.join(' ');
              }
            }
          } catch (e) {
            // Not valid JSON, fallback to XML
          }
        }
      }
    } catch (e) {
      console.warn('[Stop the Slop] json3 fetch error', e);
    }

    // Try default / XML format
    try {
      const res = await fetch(track.baseUrl, { credentials: 'include' });
      if (res.ok) {
        const xml = await res.text();
        if (xml && xml.trim().length > 0) {
          const segments = [];
          const regex = /<text[^>]*>([\s\S]*?)<\/text>/gi;
          let match;
          while ((match = regex.exec(xml)) !== null) {
            const clean = decodeEntities(match[1]).replace(/\n/g, ' ').trim();
            if (clean) segments.push(clean);
          }
          if (segments.length > 0) {
            return segments.join(' ');
          }
        }
      }
    } catch (e) {
      console.warn('[Stop the Slop] xml fetch error', e);
    }

    return null;
  }

  // Fallback: Read transcript directly from DOM if transcript panel is open
  function getTranscriptFromDom() {
    const segments = document.querySelectorAll(
      'ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer #segment-text, ytd-transcript-search-panel-renderer .segment-text'
    );
    if (segments && segments.length > 0) {
      const texts = Array.from(segments)
        .map(el => el.textContent.trim())
        .filter(Boolean);
      if (texts.length > 0) return texts.join(' ');
    }
    return null;
  }

  // Main extraction function
  async function extractTranscript(videoId) {
    // 1. Try player response
    const playerResp = getPlayerResponse();
    const tracks = getCaptionTracks(playerResp);

    if (tracks && tracks.length > 0) {
      // Prefer English track (standard or ASR)
      const englishTrack = tracks.find(
        t => t.languageCode === 'en' || (t.languageCode && t.languageCode.startsWith('en'))
      );
      const chosenTrack = englishTrack || tracks[0];
      const result = await fetchCaptions(chosenTrack);
      if (result && result.length >= 20) {
        return result;
      }

      // Try any other tracks if the first one failed
      for (const t of tracks) {
        if (t === chosenTrack) continue;
        const res = await fetchCaptions(t);
        if (res && res.length >= 20) return res;
      }
    }

    // 2. Try DOM fallback if panel is open
    const domTranscript = getTranscriptFromDom();
    if (domTranscript && domTranscript.length >= 20) {
      return domTranscript;
    }

    return null;
  }

  // Message listener from isolated world (content.js)
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'STOP_THE_SLOP_REQ_TRANSCRIPT') {
      const { requestId, videoId } = event.data;
      try {
        const transcript = await extractTranscript(videoId);
        window.postMessage({
          type: 'STOP_THE_SLOP_RESP_TRANSCRIPT',
          requestId,
          transcript,
          error: transcript ? null : 'No transcript available for this video'
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'STOP_THE_SLOP_RESP_TRANSCRIPT',
          requestId,
          transcript: null,
          error: err.message || 'Failed to extract transcript'
        }, '*');
      }
    }
  });

  console.log('[Stop the Slop] Main world script initialized');
})();
