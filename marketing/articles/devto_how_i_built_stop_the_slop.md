---
title: How I Built an Open-Source Browser Extension to Detect AI Slop on YouTube
published: true
description: A deep dive into building Stop the Slop, a Manifest V3 browser extension and Cloudflare Worker that analyzes YouTube video transcripts with sub-50ms edge caching.
tags: javascript, webdev, opensource, ai
cover_image: https://raw.githubusercontent.com/MauroPello/stop-the-slop/main/marketing/2%2022.03.03.png
canonical_url: https://mauropello.github.io/stop-the-slop/
---

# How I Built an Open-Source Browser Extension to Detect AI Slop on YouTube

If you've searched YouTube lately for tech tutorials, history documentaries, or product reviews, you've almost certainly encountered them: **"faceless" AI content farms**.

These channels follow an automated template:
1. Scrape trending search terms.
2. Prompt an LLM (like ChatGPT) to spit out a 1,500-word script filled with generic buzzwords and filler phrases (*"In today's fast-paced digital landscape..."*).
3. Feed the text into a synthetic voice generator.
4. Overlay random stock b-roll clips.
5. Upload 5 to 10 videos every single day.

The result is what the internet has dubbed **"AI Slop"**—content produced purely to capture algorithmic search impressions and ad revenue, without offering genuine human insight or research.

Frustrated by wasting time clicking on these videos, I decided to build **[Stop the Slop](https://mauropello.github.io/stop-the-slop/)**, an open-source browser extension for Google Chrome and Mozilla Firefox that detects AI-generated scripts in real-time and overlays probability badges on thumbnails before you click.

In this post, I'll walk through the architecture, technical hurdles of Manifest V3, and how I achieved **sub-50ms thumbnail badging** with Cloudflare Workers and D1.

---

## The System Architecture

Here is how the entire system connects from browser tab to edge AI analysis:

```
┌────────────────────────────────────────────────────────┐
│                   Browser (Client)                     │
│                                                        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │ MAIN World Script     │   │ ISOLATED World Script│  │
│  │ (Extracts Captions)   │──>│ (UI Badges & Popup)  │  │
│  └───────────────────────┘   └──────────┬───────────┘  │
└─────────────────────────────────────────┼──────────────┘
                                          │
                         Batch Lookups & Transcripts
                                          │
                                          ▼
┌────────────────────────────────────────────────────────┐
│               Cloudflare Worker (Edge API)             │
│                                                        │
│   ┌─────────────────────┐      ┌────────────────────┐  │
│   │ Cloudflare D1 Cache │<────>│ Sapling AI API +   │  │
│   │ (Edge SQL Database) │      │ Heuristic Filters  │  │
│   └─────────────────────┘      └────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 1. Extracting Captions in Manifest V3 (MAIN vs ISOLATED Worlds)

YouTube is a complex Single Page Application (SPA) where navigation occurs without full page reloads.

To get the video's script, we need access to YouTube's internal player caption tracks. However, content scripts in Chrome extensions typically run in an **ISOLATED world**, where they can access the DOM but cannot read JavaScript variables or objects created by YouTube's page scripts.

### The Solution: Multi-World Scripts
In our `manifest.json`, we configure two content scripts:

```json
"content_scripts": [
  {
    "matches": ["https://www.youtube.com/*"],
    "js": ["content-main.js"],
    "world": "MAIN",
    "run_at": "document_start"
  },
  {
    "matches": ["https://www.youtube.com/*"],
    "js": ["content.js"],
    "world": "ISOLATED",
    "run_at": "document_idle"
  }
]
```

1. **`content-main.js` (MAIN world)**: Has direct access to `window.ytplayer` and YouTube's player APIs. It grabs the active caption track URL or transcript payloads and posts a `window.postMessage` event.
2. **`content.js` (ISOLATED world)**: Listens for the message, securely processes the transcript, manages thumbnail DOM badges, and talks to the background service worker and Cloudflare API.

---

## 2. Fast Edge Caching with Cloudflare Workers + D1

One major UX goal was: **users shouldn't have to click into a video and wait 3 seconds to find out if it's AI slop.** We wanted badges directly on thumbnails across the YouTube Home feed, Search results, and sidebar recommendations.

However, calling an AI detection model for 30 video thumbnails every time a user scrolls would cause unbearable latency and blow through API rate limits.

### The Caching Strategy
1. When any user analyzes a video, the transcript is evaluated and the resulting score is saved in a **Cloudflare D1 edge database** keyed by YouTube `video_id`.
2. When the extension scans the current feed, `content.js` gathers all visible video IDs and sends a single batch query:
   ```
   POST /api/batch-lookup
   Body: { "videoIds": ["dQw4w9WgXcQ", "abc12345", ...] }
   ```
3. Cloudflare D1 answers in **<50ms**, returning the cached verdicts for any community-analyzed videos.
4. Thumbnail badges render instantly on screen without jitter or delay!

---

## 3. The Detection Pipeline: Combining Models & Heuristics

AI detection is notoriously prone to false positives if relied upon blindly. To provide trustworthy results, Stop the Slop uses a hybrid pipeline:

### A. Linguistic Classification
Transcripts are processed through Sapling AI’s linguistic classifier, which evaluates perplexity and burstiness across the text to estimate the probability that the text was generated by a large language model.

### B. Heuristic Pattern Scoring
LLMs frequently fall back on predictable transition patterns and clichés, such as:
- *"In today's fast-paced digital era..."*
- *"It is important to remember that..."*
- *"Furthermore, let us delve into..."*
- *"In conclusion, by harnessing the power of..."*

We check the frequency of these stereotypical transition structures.

### C. Visual Sentence Heatmap
Rather than just showing an opaque percentage, Stop the Slop renders an interactive sentence breakdown inside the popup:

```html
<!-- Example of Highlighted Sentence Rendering -->
<div class="sentence-item score-high">
  <span class="score-badge">94%</span>
  <span class="sentence-text">In today's fast-paced digital era, the landscape of modern technology is evolving at an unprecedented pace.</span>
</div>
```

This transparency allows users to see *why* the video was flagged and make their own informed judgement.

---

## 4. Privacy-First by Design

Browser extensions often have a terrible reputation for data harvesting. With Stop the Slop, I made strict architectural commitments:

- **Zero User Telemetry**: No Google Analytics, no Mixpanel, no user IDs.
- **No Accounts or Logins**: The extension functions out of the box with zero signups.
- **Strictly Scoped Permissions**: Only requests access to YouTube tabs to read public caption tracks.
- **Approved by Mozilla AMO**: Received approval with strict `data_collection_permissions: ["none"]`.

---

## 5. Lessons Learned Building for Manifest V3

1. **Service Worker Lifecycle**: In MV3, background service workers terminate when idle. Any in-memory state will be lost unless stored in `chrome.storage.local`.
2. **DOM Mutation Resilience**: YouTube updates its DOM structure frequently. Using generic CSS attribute selectors (`ytd-thumbnail`, `a#thumbnail`) combined with `MutationObserver` debouncing keeps thumbnail badging smooth and resilient.
3. **Cross-Browser Compatibility**: Maintaining simultaneous support for Chromium (`extension-chrome/`) and Firefox (`extension-firefox/`) requires keeping the core content scripts modular and adhering strictly to standard web extension APIs.

---

## Try It Out & Get Involved

Stop the Slop is 100% free and open-source under the MIT license.

- **Chrome Web Store**: [Install for Chrome, Brave & Edge](https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg)
- **Firefox Add-ons (AMO)**: [Install on Firefox](https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/)
- **Official Website & Interactive Simulator**: [https://mauropello.github.io/stop-the-slop/](https://mauropello.github.io/stop-the-slop/)
- **GitHub Repository**: [https://github.com/MauroPello/stop-the-slop](https://github.com/MauroPello/stop-the-slop)

If you're interested in browser extensions, edge computing, or open-source tools, I’d love your feedback, PRs, and a star on GitHub! 🌟
