/**
 * Stop the Slop — Popup Script
 *
 * Flow:
 *   1. Check if current tab is YouTube video
 *   2. Check worker cache (GET /api/check)
 *   3. If not cached, ask content script to fetch transcript
 *   4. Send transcript to worker (POST /api/analyze)
 *   5. Display results
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
  btnReanalyze: document.getElementById('btn-reanalyze'),
  scoreValue: document.getElementById('score-value'),
  scoreLabel: document.getElementById('score-label'),
  gaugeFill: document.getElementById('gauge-fill'),
  gaugeNeedle: document.getElementById('gauge-needle'),
  verdict: document.getElementById('verdict'),
  verdictEmoji: document.getElementById('verdict-emoji'),
  verdictText: document.getElementById('verdict-text'),
  transcriptLength: document.getElementById('transcript-length'),
  resultSource: document.getElementById('result-source'),
  sentencesSection: document.getElementById('sentences-section'),
  sentencesList: document.getElementById('sentences-list'),
};

let currentVideoId = null;
let currentTabId = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
  els.btnRetry.addEventListener('click', () => {
    if (currentVideoId) analyzeVideo(currentVideoId);
  });

  els.btnReanalyze.addEventListener('click', () => {
    if (currentVideoId) analyzeVideo(currentVideoId, true);
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
 * Send a message to the content script to fetch the transcript.
 */
function fetchTranscriptFromTab(tabId, videoId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'FETCH_TRANSCRIPT', videoId },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            'Content script communication error:',
            chrome.runtime.lastError.message
          );
          resolve(null);
          return;
        }
        if (response?.error) {
          console.error('Transcript fetch error:', response.error);
          resolve(null);
          return;
        }
        resolve(response?.transcript || null);
      }
    );
  });
}

/**
 * Display the analysis result.
 */
function displayResult(result) {
  showState('result');

  const score = result.score;
  const pct = Math.round(score * 100);

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

  els.resultSource.textContent = result.cached ? 'Cached result' : 'Fresh analysis';

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
