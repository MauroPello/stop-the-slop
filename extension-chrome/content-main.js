/**
 * Stop the Slop: Main World Content Script
 *
 * Runs in the webpage's MAIN JavaScript context (world: "MAIN").
 * Safely accesses YouTube DOM and internal objects to extract transcripts.
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
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const pr = player.getPlayerResponse();
        if (pr) return pr;
      }
    } catch (e) {}

    try {
      if (typeof window.ytInitialPlayerResponse !== 'undefined' && window.ytInitialPlayerResponse) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) {}

    try {
      if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
        const raw = window.ytplayer.config.args.raw_player_response;
        if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {}

    return null;
  }

  // Extract caption tracks from player response
  function getCaptionTracks(playerResponse) {
    if (!playerResponse) return null;
    return playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  }

  // Attempt timedtext URL fetch (may return 200 empty on newer security signatures)
  async function fetchCaptions(track) {
    if (!track || !track.baseUrl) return null;

    // Try json3
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', 'json3');

      const res = await fetch(url.toString(), { credentials: 'include' });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 10) {
          try {
            const data = JSON.parse(text);
            if (data.events && Array.isArray(data.events)) {
              const segments = data.events
                .filter(e => e.segs && Array.isArray(e.segs))
                .map(e => e.segs.map(s => s.utf8 || '').join(''))
                .map(s => s.replace(/\n/g, ' ').trim())
                .filter(Boolean);

              if (segments.length > 0) return segments.join(' ');
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Try raw XML
    try {
      const res = await fetch(track.baseUrl, { credentials: 'include' });
      if (res.ok) {
        const xml = await res.text();
        if (xml && xml.trim().length > 10) {
          const segments = [];
          const regex = /<text[^>]*>([\s\S]*?)<\/text>/gi;
          let match;
          while ((match = regex.exec(xml)) !== null) {
            const clean = decodeEntities(match[1]).replace(/\n/g, ' ').trim();
            if (clean) segments.push(clean);
          }
          if (segments.length > 0) return segments.join(' ');
        }
      }
    } catch (e) {}

    return null;
  }

  // Inject or ensure stealth style so transcript panel is NEVER visible to user
  function ensureStealthStyle() {
    let style = document.getElementById('sts-stealth-transcript-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sts-stealth-transcript-style';
      style.textContent = `
        ytd-engagement-panel-section-list-renderer[target-id*="transcript"],
        ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"],
        ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] {
          position: fixed !important;
          top: -9999px !important;
          left: -9999px !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          z-index: -99999 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function removeStealthStyle() {
    const style = document.getElementById('sts-stealth-transcript-style');
    if (style) style.remove();
  }

  // Read transcript segments currently rendered in YouTube's DOM (both modern and legacy structures)
  function getTranscriptFromDom() {
    const segments = document.querySelectorAll(
      'transcript-segment-view-model .yt-core-attributed-string, ' +
      'transcript-segment-view-model [class*="segment-text"], ' +
      'transcript-segment-view-model, ' +
      'ytd-transcript-segment-renderer .segment-text, ' +
      'ytd-transcript-segment-renderer #segment-text, ' +
      'ytd-transcript-segment-renderer yt-formatted-string.segment-text, ' +
      'ytd-transcript-segment-renderer .segment-text-fragment, ' +
      'ytd-transcript-search-panel-renderer .segment-text, ' +
      'ytd-transcript-segment-list-renderer .segment-text'
    );

    if (segments && segments.length > 0) {
      const texts = Array.from(segments)
        .map(el => (el.textContent || '').trim())
        .filter(t => t.length > 0 && !/^\d+:\d+$/.test(t)); // Filter out standalone timestamps
      if (texts.length > 0) return texts.join(' ');
    }
    return null;
  }

  // Open YouTube's transcript panel invisibly (offscreen) via DOM interaction and read rendered segments
  async function triggerAndExtractFromDom() {
    // Check if already open and populated
    let domText = getTranscriptFromDom();
    if (domText && domText.length >= 20) return domText;

    // 1. Ensure stealth styles are active before touching any panel or button
    ensureStealthStyle();

    let didExpandDescription = false;

    try {
      // 2. Expand video description if collapsed, so "Show transcript" button is available
      const expandDescBtn = document.querySelector(
        '#description #expand, #expand.ytd-text-inline-expander, tp-yt-paper-button#expand, ytd-text-inline-expander #expand, #description-inline-expander #expand'
      );
      if (expandDescBtn && expandDescBtn.offsetParent !== null) {
        try {
          expandDescBtn.click();
          didExpandDescription = true;
        } catch (e) {}
      }

      // 3. Try expanding the transcript engagement panels directly (works for both legacy & modern panels)
      const engagementPanels = document.querySelectorAll(
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
      );
      for (const panel of engagementPanels) {
        try {
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
        } catch (e) {}
      }

      // 4. Find and click "Show transcript" button in description or actions
      const candidateButtons = [
        ...document.querySelectorAll('ytd-video-description-transcript-section-renderer button'),
        ...document.querySelectorAll('button[aria-label*="transcript" i], button[aria-label*="trascriz" i]'),
        ...Array.from(document.querySelectorAll('ytd-button-renderer button, button.yt-spec-button-shape-next')).filter(b => {
          const t = (b.textContent || '').toLowerCase();
          return t.includes('transcript') || t.includes('trascriz');
        })
      ];

      for (const btn of candidateButtons) {
        if (btn) {
          try {
            btn.click();
            break;
          } catch (e) {}
        }
      }

      // 5. Poll for up to 3.5 seconds for transcript segments to load in DOM
      const startTime = Date.now();
      while (Date.now() - startTime < 3500) {
        await new Promise(r => setTimeout(r, 180));
        domText = getTranscriptFromDom();
        if (domText && domText.length >= 20) {
          return domText;
        }
      }
    } finally {
      // 6. Cleanup: Re-collapse description if we expanded it, and re-hide transcript panels
      if (didExpandDescription) {
        try {
          const collapseDescBtn = document.querySelector(
            '#description #collapse, #collapse.ytd-text-inline-expander, tp-yt-paper-button#collapse, ytd-text-inline-expander #collapse, #description-inline-expander #collapse'
          );
          if (collapseDescBtn && collapseDescBtn.offsetParent !== null) {
            collapseDescBtn.click();
          }
        } catch (e) {}
      }

      const panelsToHide = document.querySelectorAll(
        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"], ' +
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
      );
      for (const panel of panelsToHide) {
        try {
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
          const closeBtn = panel.querySelector('#visibility-button button, button[aria-label*="Close" i], button[aria-label*="Chiudi" i]');
          if (closeBtn) closeBtn.click();
        } catch (e) {}
      }

      // Delay removing stealth style briefly so closing transition completes completely offscreen
      setTimeout(() => {
        removeStealthStyle();
      }, 400);
    }

    return null;
  }

  // Master transcript extraction pipeline
  async function extractTranscript(videoId) {
    console.log('[Stop the Slop] Extracting transcript for', videoId);

    // Method 1: Timedtext API fetch if player response is available for the requested video
    try {
      const playerResp = getPlayerResponse();
      const respVideoId = playerResp?.videoDetails?.videoId;
      if (!respVideoId || respVideoId === videoId) {
        const tracks = getCaptionTracks(playerResp);
        if (tracks && tracks.length > 0) {
          const englishTrack = tracks.find(
            t => t.languageCode === 'en' || (t.languageCode && t.languageCode.startsWith('en'))
          );
          const chosen = englishTrack || tracks[0];
          const res = await fetchCaptions(chosen);
          if (res && res.length >= 20) {
            console.log('[Stop the Slop] Transcript extracted via timedtext fetch');
            return res;
          }
        }
      }
    } catch (e) {
      console.warn('[Stop the Slop] Timedtext fetch method error:', e);
    }

    // Method 2: YouTube DOM transcript panel (stealth, 100% hidden from user)
    try {
      console.log('[Stop the Slop] Attempting stealth DOM transcript extraction...');
      const domResult = await triggerAndExtractFromDom();
      if (domResult && domResult.length >= 20) {
        console.log('[Stop the Slop] Transcript extracted invisibly via DOM transcript panel');
        return domResult;
      }
    } catch (e) {
      console.warn('[Stop the Slop] DOM transcript extraction error:', e);
    }

    return null;
  }

  // Listener for requests from isolated world (content.js)
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
