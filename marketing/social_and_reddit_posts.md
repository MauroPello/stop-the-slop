# 📣 Stop the Slop — Social Media & Reddit Campaign Kit

This document provides **custom-written, high-engagement posts** tailored for 10 specific Reddit communities, X (Twitter), LinkedIn, and Mastodon. Every post is tailored to the specific culture and rules of that community.

---

## 📌 General Reddit Guidelines
- **Spread them out**: Post to 1–2 subreddits per day over 1–2 weeks rather than all on the same day.
- **Engage in the comments**: Reply promptly and transparently to technical feedback, criticism, and questions.
- **Be authentic**: Position yourself as a developer solving a real annoyance rather than promoting a commercial product.

---

## 1. Reddit Posts (Tailored for 10 Subreddits)

---

### 1.1 r/chrome_extensions
- **Target URL**: https://www.reddit.com/r/chrome_extensions/submit
- **Flair**: `Showcase` / `Release`
- **Post Title**:
  > I built an open-source extension that detects AI-generated YouTube scripts and shows badges on thumbnails
- **Post Body**:
```markdown
Hey everyone!

I got tired of clicking on promising YouTube search results and recommendations only to realize 30 seconds in that the video was a low-effort AI content farm reading a generic ChatGPT script over stock clips.

So I built **Stop the Slop** — a lightweight, open-source browser extension.

### What it does:
1. **Thumbnail Badges**: Shows an instant AI probability badge on YouTube video thumbnails across your Home feed, Subscriptions, Search, and Recommendations before you even click.
2. **In-Player Gauge & Sentence Heatmap**: If you open the extension popup while watching a video, it highlights the exact sentences that triggered the AI detector with individual confidence scores.
3. **Sub-50ms Edge Caching**: Uses a Cloudflare Worker + D1 edge cache so videos analyzed by others load badges instantly without slowing down your YouTube browsing.
4. **100% Privacy**: Zero tracking, no user accounts, no analytics cookies. 

Built on Manifest V3 with vanilla JS and CSS.

- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox Add-on**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **GitHub (MIT)**: https://github.com/MauroPello/stop-the-slop
- **Live Demo & Website**: https://mauropello.github.io/stop-the-slop/

Would love to hear your feedback on the UI and performance!
```

---

### 1.2 r/opensource & r/opensourcesoftware
- **Target URL**: https://www.reddit.com/r/opensource/submit
- **Flair**: `Project` / `Showcase`
- **Post Title**:
  > Stop the Slop: An open-source (MIT) browser extension to detect AI-generated YouTube scripts with zero tracking
- **Post Body**:
```markdown
Hi all!

I wanted to share **Stop the Slop**, an MIT-licensed browser extension (Chrome & Firefox) I created to tackle the surge of automated AI content farms on YouTube.

### Why open source?
Most AI detection tools on the web are paywalled SaaS products that harvest data and sell subscriptions. I wanted a transparent, community-owned tool that:
- Collects **zero personal data** (no telemetry, no cookies, no accounts).
- Runs directly in the browser via Manifest V3.
- Caches community-analyzed video ratings on Cloudflare D1 for fast, free lookups.

### Key Features:
- Real-time thumbnail badges across YouTube feeds.
- Sentence-by-sentence linguistic heatmap pinpointing LLM phrasing.
- Lightweight vanilla JavaScript architecture (zero heavy dependencies).

Check out the code, inspect the permissions, or contribute:
- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox AMO**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **Repo**: https://github.com/MauroPello/stop-the-slop
- **Interactive Simulator**: https://mauropello.github.io/stop-the-slop/

PRs, feature suggestions, and code reviews are very welcome!
```

---

### 1.3 r/SideProject
- **Target URL**: https://www.reddit.com/r/SideProject/submit
- **Flair**: `Launched` / `Feedback`
- **Post Title**:
  > I built a tool to spot AI slop on YouTube before you waste your time watching it
- **Post Body**:
```markdown
Hey r/SideProject!

Like a lot of you, I've noticed YouTube getting overrun by "faceless" AI channels: mass-produced ChatGPT scripts read by synthetic ElevenLabs voices over random stock footage.

I built **Stop the Slop** as a weekend project to solve my own frustration.

### How it works:
- It pulls the public caption transcript when you open a video and scores it for AI probability using a Cloudflare Worker + Sapling AI.
- It highlights robotic or repetitive phrasing sentence-by-sentence so you can verify *why* it got flagged.
- Most importantly, it caches results at the edge, allowing the extension to overlay AI probability badges on video thumbnails directly in your Home feed and Search results.

It's 100% free and open source (MIT).

- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox Add-on**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **Website / Interactive Simulator**: https://mauropello.github.io/stop-the-slop/
- **Source Code**: https://github.com/MauroPello/stop-the-slop

Check it out and let me know what you think! What features would you like to see next?
```

---

### 1.4 r/InternetIsBeautiful
- **Target URL**: https://www.reddit.com/r/InternetIsBeautiful/submit
- **Post Title**:
  > Stop the Slop: A free, open-source browser tool that reveals whether a YouTube video is reading an AI-generated script
- **Link URL**: https://mauropello.github.io/stop-the-slop/
- **Top Comment / Context**:
```markdown
I built this tool to help people spot automated content farms on YouTube. It reads public video captions, calculates AI probability, highlights robotic sentences, and shows badges right on thumbnails. Free, MIT licensed, with zero tracking or accounts required.
```

---

### 1.5 r/artificial & r/ArtificialIntelligence
- **Target URL**: https://www.reddit.com/r/ArtificialIntelligence/submit
- **Flair**: `Discussion` / `Project`
- **Post Title**:
  > We're hitting peak "AI Slop" on YouTube — so I built an open-source detector to analyze video scripts in real time
- **Post Body**:
```markdown
The barrier to generating automated video content has collapsed to near zero. Anyone can now string together an automated pipeline: scrape trending topics -> generate ChatGPT script -> generate synthetic voiceover -> auto-stitch stock clips -> upload 10x/day.

The issue isn't AI assistance itself; it's the sheer flood of low-effort, hallucination-prone filler flooding recommendations.

To counter this, I developed **Stop the Slop**, a browser extension for Chrome and Firefox.

### Technical approach:
- Non-intrusive transcript extraction directly from the player context.
- Evaluation via Sapling AI's linguistic classifier combined with heuristic detection of formulaic transition phrases and repetitive syntax patterns.
- Visual explainability: sentence-by-sentence heatmap with confidence levels so users can see the exact markers rather than trusting a black-box number.
- Global edge caching on Cloudflare D1 to enable instant thumbnail badging.

Everything is open source under the MIT License:
- **Chrome Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox Listing**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **GitHub**: https://github.com/MauroPello/stop-the-slop
- **Demo**: https://mauropello.github.io/stop-the-slop/

Curious to hear your thoughts on where the cat-and-mouse game between LLM generation and linguistic detection goes from here!
```

---

### 1.6 r/youtubers & r/NewTubers
- **Target URL**: https://www.reddit.com/r/youtubers/submit (or r/NewTubers)
- **Flair**: `Discussion` / `Tools`
- **Post Title**:
  > I made a free tool to help viewers distinguish human-written YouTube scripts from mass-produced AI content farms
- **Post Body**:
```markdown
Hey creators!

One of the biggest frustrations I hear from authentic YouTubers is having your researched, handcrafted videos buried next to automated AI channels publishing 5 ChatGPT-generated videos a day.

I built a free, open-source browser extension called **Stop the Slop** to help viewers identify genuine creator content and filter out low-effort synthetic churn.

### How it works:
- Evaluates video transcripts for robotic sentence structures, repetitive formulas, and typical AI linguistic markers.
- Displays an AI probability gauge and a sentence-by-sentence breakdown.
- Adds badges to video thumbnails across feeds.

It's completely free, MIT licensed, and has zero tracking:
- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox Add-on**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **Website & Interactive Demo**: https://mauropello.github.io/stop-the-slop/
- **GitHub**: https://github.com/MauroPello/stop-the-slop

I'd love feedback from creators: are there specific ways you script your videos that you'd like to make sure never get false-flagged?
```

---

### 1.7 r/firefox
- **Target URL**: https://www.reddit.com/r/firefox/submit
- **Flair**: `Add-on`
- **Post Title**:
  > Stop the Slop is now live on Firefox Add-ons (AMO): An open-source tool to detect AI-generated YouTube scripts
- **Post Body**:
```markdown
Hi Firefox users!

I've just published **Stop the Slop** to Mozilla Add-ons (AMO). It's a lightweight, privacy-respecting extension that detects AI-generated narration scripts and content farms on YouTube.

### Firefox First-Class Support:
- Full Manifest V3 compatibility with Firefox (`browser_specific_settings.gecko`).
- **Zero data collection**: Uses `data_collection_permissions: ["none"]`. No tracking, no analytics, no accounts.
- Sub-50ms thumbnail badges via Cloudflare D1 edge caching.
- Sentence-level heatmap explaining why a script was flagged.
- Fully MIT licensed.

- **Install on Firefox (AMO)**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **Chrome Web Store (Chromium)**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **GitHub Repo**: https://github.com/MauroPello/stop-the-slop
- **Landing Page**: https://mauropello.github.io/stop-the-slop/

Feedback, bug reports, and suggestions are warmly appreciated!
```

---

### 1.8 r/privacy
- **Target URL**: https://www.reddit.com/r/privacy/submit
- **Flair**: `Tool` / `Open Source`
- **Post Title**:
  > Stop the Slop: A zero-telemetry, open-source browser extension to detect AI scripts on YouTube
- **Post Body**:
```markdown
Many browser extensions that offer "content rating" or "AI detection" function as spyware—tracking your entire browsing history, injecting affiliate links, or requiring cloud accounts.

I built **Stop the Slop** with a strict privacy-first architecture:
1. **Zero personal data collection**: No telemetry, no fingerprinting, no cookies.
2. **Minimal permissions**: Only accesses YouTube video transcripts when analyzing.
3. **Transparent source code**: 100% open source under the MIT license on GitHub.
4. **Independent verification**: Compliant with Mozilla's strict `data_collection_permissions: ["none"]` policy.

- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox Add-on**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **Source Code**: https://github.com/MauroPello/stop-the-slop
- **Privacy Statement**: https://mauropello.github.io/stop-the-slop/privacy.html
- **Live Demo**: https://mauropello.github.io/stop-the-slop/

Feedback on our permissions scope and privacy model is very welcome!
```

---

### 1.9 r/coolgithubprojects
- **Target URL**: https://www.reddit.com/r/coolgithubprojects/submit
- **Post Title**:
  > Stop the Slop – Browser extension (Manifest V3 + Cloudflare Workers) that detects AI-generated YouTube scripts with sentence heatmaps
- **Post Link**: https://github.com/MauroPello/stop-the-slop
- **Top Comment**:
```markdown
Stop the Slop is an open-source (MIT) extension for Chrome and Firefox. It extracts YouTube captions, evaluates AI probabilities with edge caching on Cloudflare D1, and overlays instant badges on video thumbnails.

- Chrome Store: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- Firefox AMO: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- GitHub: https://github.com/MauroPello/stop-the-slop
- Live Demo: https://mauropello.github.io/stop-the-slop/
```

---

### 1.10 r/webdev
- **Target URL**: https://www.reddit.com/r/webdev/submit
- **Flair**: `Showoff Saturday` / `Project`
- **Post Title**:
  > How I built a fast, sub-50ms YouTube AI script detector using Manifest V3 and Cloudflare Workers
- **Post Body**:
```markdown
Hey r/webdev!

I wanted to share the architecture behind **Stop the Slop**, a browser extension I built to detect AI-generated video scripts on YouTube.

### The Engineering Challenge:
YouTube feeds render dozens of dynamic video thumbnails. If you make a fresh AI detection API call for every video on screen, you'll destroy performance and hit rate limits immediately.

### How I solved it:
1. **Context Isolation**: Transcript extraction happens in the `MAIN` world context to inspect subtitle endpoints without CORS hurdles, passing results back to the `ISOLATED` content script.
2. **Edge Cache (Cloudflare Workers + D1)**: Whenever a user analyzes a video, the verdict and score are cached in Cloudflare D1.
3. **Batch Thumbnail Lookups**: When your feed loads, the content script gathers visible video IDs and makes a single batch lookup to Cloudflare. Uncached videos display gracefully without lag; cached ones render instant badges in <50ms.
4. **Sentence Heatmap**: Sentence tokens are scored against Sapling AI and custom perplexity heuristic models, then rendered with a clean SVG gauge in the popup.

The whole project is vanilla JS + CSS with zero heavy frontend frameworks.

- **Chrome Web Store**: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
- **Firefox AMO**: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
- **GitHub (MIT)**: https://github.com/MauroPello/stop-the-slop
- **Live Simulator**: https://mauropello.github.io/stop-the-slop/

Happy to answer questions about Manifest V3 gotchas or Cloudflare Worker architectures!
```

---

## 2. X (Twitter) Campaign

### 2.1 Standalone Viral Hook Tweet
```
Tired of clicking on YouTube videos only to realize 30 seconds in that it’s a low-effort AI content farm reading a ChatGPT script? 🤖🚫

I built Stop the Slop: a free, open-source browser extension that flags AI scripts and puts badges on video thumbnails!

🔗 https://mauropello.github.io/stop-the-slop/
👇 (Thread)
```

### 2.2 Complete 5-Tweet Launch Thread

**Tweet 1 (Hook)**:
> YouTube is currently flooded with automated "faceless" channels: ChatGPT scripts + synthetic voiceovers + stock b-roll clips.
>
> I built **Stop the Slop** — a free, open-source browser extension to unmask AI-generated scripts in real time. 🧵👇
> [Attach marketing/2 22.03.03.png]

**Tweet 2 (Thumbnail Badges)**:
> 1/ 🏷️ **Instant Thumbnail Badges**
> Don't waste your time clicking. Stop the Slop overlays AI probability badges directly onto YouTube video thumbnails across your Home feed, Subscriptions, and Search results.

**Tweet 3 (Sentence Heatmap)**:
> 2/ 📊 **Sentence-Level Linguistic Heatmap**
> It doesn't just give you a random score. Open the extension popup to see an itemized breakdown of the exact robotic sentences and repetitive formulas that triggered the detection.

**Tweet 4 (Privacy & Speed)**:
> 3/ ⚡ **Built for Speed & Privacy**
> • Sub-50ms edge caching with Cloudflare Workers + D1
> • Zero user tracking, no accounts, no cookies
> • Pure vanilla JS & CSS on Manifest V3

**Tweet 5 (Links & Call to Action)**:
> 4/ Try it out or inspect the code:
>
> 🌐 Chrome Web Store: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
> 🦊 Firefox: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
> 🌐 Interactive Demo: https://mauropello.github.io/stop-the-slop/
> ⭐ Star on GitHub: https://github.com/MauroPello/stop-the-slop
>
> If you find it useful, RT to save someone from AI slop today! 🚀

---

## 3. LinkedIn Announcement Post

```
Generative AI has made content production frictionless—but it has also unleashed an unprecedented wave of "slop" across video platforms.

On YouTube, low-effort content farms now mass-produce dozens of automated videos daily: generic LLM scripts read by synthetic voices over random stock footage.

To help viewers identify genuine creator effort, I built and open-sourced **Stop the Slop** 🚫🎬.

It's a lightweight browser extension for Chrome and Firefox that:
✅ Extracts and evaluates video transcripts for LLM linguistic markers in real-time.
✅ Overlays instant AI probability badges directly onto YouTube video thumbnails.
✅ Provides a sentence-by-sentence heatmap explaining the verdict.
✅ Prioritizes user privacy with zero tracking, no accounts, and MIT-licensed source code.

Architecture highlights:
- Manifest V3 compliant frontend.
- Cloudflare Workers + D1 database edge caching for sub-50ms batch thumbnail lookups.
- Sapling AI API integration.

Check out the interactive demo and source code below:
🌐 Web Demo: https://mauropello.github.io/stop-the-slop/
📦 Chrome Web Store: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
🦊 Firefox Add-on: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
💻 GitHub (MIT): https://github.com/MauroPello/stop-the-slop

#OpenSource #ArtificialIntelligence #SoftwareEngineering #WebDevelopment #ChromeExtension #YouTube #Tech
```

---

## 4. Mastodon / Fosstodon Post

```
Tired of clicking YouTube videos only to realize they're low-effort AI content farms reading ChatGPT scripts? 🤖🚫

Introducing **Stop the Slop** — a 100% free, MIT-licensed browser extension for Firefox and Chromium.

✨ Highlights:
• Instant AI probability badges on video thumbnails
• Sentence-level linguistic heatmap
• Sub-50ms edge cache via Cloudflare Workers
• 🔒 Zero telemetry, no user tracking, no accounts

📦 Chrome Web Store: https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg
🦊 Firefox Add-on: https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/
💻 Source: https://github.com/MauroPello/stop-the-slop
🌐 Interactive Demo: https://mauropello.github.io/stop-the-slop/

#OpenSource #FOSS #Firefox #Privacy #AI #WebDev
```
