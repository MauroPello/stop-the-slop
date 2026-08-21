/**
 * Stop the Slop — Popup Script
 *
 * Flow:
 *   1. Initialize theme (system default, dark, light)
 *   2. Check if current tab is YouTube video
 *   3. Check worker cache (GET /api/check)
 *   4. If not cached, ask content script to fetch transcript
 *   5. Send transcript to worker (POST /api/analyze)
 *   6. Display results
 */

const API_BASE = 'https://stop-the-slop-api.maurobum43.workers.dev';

// --- DOM refs ---
const states = {
  notYoutube: document.getElementById('state-not-youtube'),
  loading: document.getElementById('state-loading'),
  error: document.getElementById('state-error'),
  result: document.getElementById('state-result'),
};

const els = {
  errorMessage: document.getElementById('error-message'),
  btnRetry: document.getElementById('btn-retry'),
  scoreValue: document.getElementById('score-value'),
  scoreLabel: document.getElementById('score-label'),
  gaugeFill: document.getElementById('gauge-fill'),
  gaugeNeedle: document.getElementById('gauge-needle'),
  verdict: document.getElementById('verdict'),
  verdictEmoji: document.getElementById('verdict-emoji'),
  verdictText: document.getElementById('verdict-text'),
  transcriptLength: document.getElementById('transcript-length'),
  sentencesSection: document.getElementById('sentences-section'),
  sentencesList: document.getElementById('sentences-list'),
  themeToggle: document.getElementById('theme-toggle'),
  themeIconSystem: document.getElementById('theme-icon-system'),
  themeIconDark: document.getElementById('theme-icon-dark'),
  themeIconLight: document.getElementById('theme-icon-light'),
};

let currentVideoId = null;
let currentTabId = null;
let currentTheme = 'system';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await initTheme();

  els.btnRetry.addEventListener('click', () => {
    if (currentVideoId) analyzeVideo(currentVideoId);
  });

  // Get the current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    showState('notYoutube');
    return;
  }

  currentTabId = tab.id;
  const videoId = extractVideoId(tab.url);

  if (!videoId) {
    showState('notYoutube');
    return;
  }

  currentVideoId = videoId;
  analyzeVideo(videoId);
}

// --- Theme Management ---

async function initTheme() {
  try {
    const stored = await chrome.storage.local.get('theme_preference');
    currentTheme = stored.theme_preference || localStorage.getItem('sts_theme') || 'system';
  } catch (e) {
    currentTheme = localStorage.getItem('sts_theme') || 'system';
  }

  applyTheme(currentTheme, false);

  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', cycleTheme);
  }

  // Listen for OS scheme changes to seamlessly adapt if in system mode
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme('system', false);
    }
  });
}

function cycleTheme() {
  // Cycle order: system -> dark -> light -> system
  const order = ['system', 'dark', 'light'];
  const nextIdx = (order.indexOf(currentTheme) + 1) % order.length;
  currentTheme = order[nextIdx];
  applyTheme(currentTheme, true);
}

function applyTheme(theme, save = true) {
  currentTheme = theme;

  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (els.themeToggle) els.themeToggle.setAttribute('title', 'Theme: Light (click for System)');
  } else if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (els.themeToggle) els.themeToggle.setAttribute('title', 'Theme: Dark (click for Light)');
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (els.themeToggle) els.themeToggle.setAttribute('title', 'Theme: System / Auto (click for Dark)');
  }

  // Update theme icons
  if (els.themeIconSystem && els.themeIconDark && els.themeIconLight) {
    els.themeIconSystem.classList.toggle('hidden', theme !== 'system');
    els.themeIconDark.classList.toggle('hidden', theme !== 'dark');
    els.themeIconLight.classList.toggle('hidden', theme !== 'light');
  }

  if (save) {
    try {
      localStorage.setItem('sts_theme', theme);
      chrome.storage.local.set({ theme_preference: theme });
    } catch (e) {
      console.warn('[Stop the Slop] Failed to save theme preference', e);
    }
  }
}

/**
 * Extract YouTube video ID from a URL.
 */
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v');
      }
      const shortsMatch = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Main analysis flow.
 */
async function analyzeVideo(videoId, forceRefresh = false) {
  showState('loading');

  try {
    // Step 1: Check the cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cacheResp = await fetch(
        `${API_BASE}/api/check?videoId=${encodeURIComponent(videoId)}`
      );
      if (cacheResp.ok) {
        const cacheData = await cacheResp.json();
        if (cacheData.found) {
          displayResult(cacheData);
          return;
        }
      }
    }

    // Step 2: Ask the content script to fetch the transcript
    const transcript = await fetchTranscriptFromTab(currentTabId, videoId);

    if (!transcript) {
      throw new Error(
        'No transcript available. This video may not have captions enabled.'
      );
    }

    if (transcript.length < 50) {
      throw new Error('Transcript is too short for reliable AI detection.');
    }

    // Step 3: Send transcript to worker for analysis
    const analyzeResp = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, transcript }),
    });

    if (!analyzeResp.ok) {
      const data = await analyzeResp.json().catch(() => ({}));
      throw new Error(data.error || `Analysis failed: ${analyzeResp.status}`);
    }

    const result = await analyzeResp.json();
    displayResult(result);
  } catch (err) {
    showError(err.message);
  }
}

/**
 * Extract the transcript directly from the YouTube tab in MAIN world context.
 * This directly accesses YouTube's DOM and player objects without message-passing hops.
 */
async function fetchTranscriptFromTab(tabId, videoId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (vid) => {
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

        // 1. Check if segments are already rendered in DOM
        function getSegmentsFromDom() {
          const segments = document.querySelectorAll(
            'ytd-transcript-segment-renderer .segment-text, ' +
            'ytd-transcript-segment-renderer #segment-text, ' +
            'ytd-transcript-segment-renderer yt-formatted-string, ' +
            'ytd-transcript-segment-renderer .segment-text-fragment, ' +
            'ytd-transcript-search-panel-renderer .segment-text, ' +
            'ytd-transcript-segment-list-renderer .segment-text'
          );
          if (segments && segments.length > 0) {
            const texts = Array.from(segments)
              .map((el) => el.textContent.trim())
              .filter(Boolean);
            if (texts.length > 0) return texts.join(' ');
          }
          return null;
        }

        let domText = getSegmentsFromDom();
        if (domText && domText.length >= 20) return domText;

        // 2. Try timedtext URL fetch from playerResponse captionTracks
        try {
          let pr = null;
          const player = document.getElementById('movie_player');
          if (player && typeof player.getPlayerResponse === 'function') {
            pr = player.getPlayerResponse();
          }
          if (!pr && typeof window.ytInitialPlayerResponse !== 'undefined') {
            pr = window.ytInitialPlayerResponse;
          }
          const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (tracks && tracks.length > 0) {
            const enTrack =
              tracks.find(
                (t) =>
                  t.languageCode === 'en' ||
                  (t.languageCode && t.languageCode.startsWith('en'))
              ) || tracks[0];

            if (enTrack?.baseUrl) {
              // Try json3
              try {
                const u = new URL(enTrack.baseUrl);
                u.searchParams.set('fmt', 'json3');
                const r = await fetch(u.toString(), { credentials: 'include' });
                if (r.ok) {
                  const d = await r.json();
                  if (d.events) {
                    const segs = d.events
                      .filter((e) => e.segs)
                      .map((e) =>
                        e.segs
                          .map((s) => s.utf8 || '')
                          .join('')
                          .replace(/\n/g, ' ')
                          .trim()
                      )
                      .filter(Boolean);
                    if (segs.length > 0) return segs.join(' ');
                  }
                }
              } catch (e) {}

              // Try xml
              try {
                const r = await fetch(enTrack.baseUrl, { credentials: 'include' });
                if (r.ok) {
                  const xml = await r.text();
                  if (xml && xml.length > 20) {
                    const segs = [];
                    const rx = /<text[^>]*>([\s\S]*?)<\/text>/gi;
                    let m;
                    while ((m = rx.exec(xml)) !== null) {
                      const clean = decodeEntities(m[1]).replace(/\n/g, ' ').trim();
                      if (clean) segs.push(clean);
                    }
                    if (segs.length > 0) return segs.join(' ');
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // 3. Automated DOM expansion: expand description and trigger transcript panel
        try {
          // Expand description section
          const expandDesc = document.querySelector(
            '#description #expand, #expand.ytd-text-inline-expander, tp-yt-paper-button#expand, ytd-text-inline-expander #expand, #description-inline-expander'
          );
          if (expandDesc) {
            try { expandDesc.click(); } catch (e) {}
          }

          // Expand engagement panel directly if available
          const panel = document.querySelector(
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
          );
          if (panel) {
            panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
          }

          // Find & click "Show transcript" button
          const candidates = [
            ...document.querySelectorAll('ytd-video-description-transcript-section-renderer button'),
            ...document.querySelectorAll('button[aria-label*="transcript" i], button[aria-label*="trascriz" i]'),
            ...Array.from(
              document.querySelectorAll(
                'ytd-button-renderer button, button.yt-spec-button-shape-next'
              )
            ).filter((b) => {
              const t = (b.textContent || '').toLowerCase();
              return t.includes('transcript') || t.includes('trascriz');
            }),
          ];
          for (const btn of candidates) {
            try {
              btn.click();
              break;
            } catch (e) {}
          }

          // Poll up to 4 seconds for segments to load in DOM
          const start = Date.now();
          while (Date.now() - start < 4000) {
            await new Promise((r) => setTimeout(r, 200));
            domText = getSegmentsFromDom();
            if (domText && domText.length >= 20) return domText;
          }
        } catch (e) {}

        return null;
      },
      args: [videoId],
    });

    return results?.[0]?.result || null;
  } catch (err) {
    console.error('[Stop the Slop] executeScript error:', err);
    return null;
  }
}

/**
 * Display the analysis result.
 */
function displayResult(result) {
  showState('result');

  const score = result.score;
  const pct = Math.round(score * 100);

  // Persist to local storage so content script thumbnail badges & service worker update immediately
  if (currentVideoId && typeof score === 'number') {
    chrome.storage.local.set({
      [`result_${currentVideoId}`]: result,
      [`sts_cache_${currentVideoId}`]: {
        score,
        analyzedAt: result.analyzedAt || new Date().toISOString(),
      },
    }).catch(() => {});
  }

  // Score display
  els.scoreValue.textContent = `${pct}%`;

  if (score < 0.35) {
    els.scoreValue.className = 'score-value score-green';
  } else if (score < 0.65) {
    els.scoreValue.className = 'score-value score-yellow';
  } else {
    els.scoreValue.className = 'score-value score-red';
  }

  // Gauge animation
  const arcLength = 251.33;
  const targetOffset = arcLength * (1 - score);

  requestAnimationFrame(() => {
    els.gaugeFill.style.transition =
      'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)';
    els.gaugeFill.setAttribute('stroke-dashoffset', targetOffset);
  });

  const needleAngle = -90 + score * 180;
  requestAnimationFrame(() => {
    els.gaugeNeedle.style.transition =
      'transform 1s cubic-bezier(0.4, 0, 0.2, 1)';
    els.gaugeNeedle.setAttribute(
      'transform',
      `rotate(${needleAngle}, 100, 100)`
    );
  });

  // Verdict
  els.verdict.classList.remove('verdict--human', 'verdict--mixed', 'verdict--ai');

  if (score < 0.35) {
    els.verdictEmoji.textContent = '✅';
    els.verdictText.textContent = 'Likely Human-Written';
    els.verdict.classList.add('verdict--human');
  } else if (score < 0.65) {
    els.verdictEmoji.textContent = '🤔';
    els.verdictText.textContent = 'Mixed / Uncertain';
    els.verdict.classList.add('verdict--mixed');
  } else {
    els.verdictEmoji.textContent = '🤖';
    els.verdictText.textContent = 'Likely AI-Generated';
    els.verdict.classList.add('verdict--ai');
  }

  // Details
  const len = result.transcriptLength;
  if (len) {
    const words = Math.round(len / 5);
    els.transcriptLength.textContent = `~${words.toLocaleString()} words`;
  }

  // Sentence scores
  const sentences = result.sentenceScores || [];
  if (sentences.length > 0) {
    els.sentencesSection.classList.remove('hidden');
    els.sentencesList.innerHTML = '';

    const topSentences = sentences.slice(0, 5);
    for (const s of topSentences) {
      const item = document.createElement('div');
      item.className = 'sentence-item';

      const scoreBadge = document.createElement('span');
      const sPct = Math.round(s.score * 100);
      scoreBadge.textContent = `${sPct}%`;
      scoreBadge.className = 'sentence-score';

      if (s.score >= 0.65) {
        scoreBadge.classList.add('sentence-score--high');
      } else if (s.score >= 0.35) {
        scoreBadge.classList.add('sentence-score--medium');
      } else {
        scoreBadge.classList.add('sentence-score--low');
      }

      const textEl = document.createElement('span');
      textEl.className = 'sentence-text';
      textEl.textContent =
        s.sentence.length > 120
          ? s.sentence.slice(0, 120) + '…'
          : s.sentence;

      item.appendChild(scoreBadge);
      item.appendChild(textEl);
      els.sentencesList.appendChild(item);
    }
  } else {
    els.sentencesSection.classList.add('hidden');
  }
}

// --- UI helpers ---

function showState(name) {
  for (const [key, el] of Object.entries(states)) {
    if (key === name) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
}

function showError(message) {
  els.errorMessage.textContent = message || 'Something went wrong';
  showState('error');
}
