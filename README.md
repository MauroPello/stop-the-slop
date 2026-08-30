# Stop the Slop 🚫 🎬

> **AI Script Detector for YouTube** — A lightweight, privacy-friendly browser extension that analyzes YouTube video transcripts in real-time to detect AI-generated scripts.

[![Live Website](https://img.shields.io/badge/Website-GitHub%20Pages-6366f1?style=flat-square)](https://mauropello.github.io/stop-the-slop/)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--ons-FF7139?style=flat-square&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/)
[![Product Hunt](https://img.shields.io/badge/Product_Hunt-Featured-DA552F?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/stop-the-slop-2)
[![AlternativeTo](https://img.shields.io/badge/AlternativeTo-Listed-0088CC?style=flat-square&logo=alternativeto&logoColor=white)](https://alternativeto.net/software/stop-the-slop/about/)
[![SourceForge](https://img.shields.io/badge/SourceForge-Project-EE5922?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/stop-the-slop/)
[![Peerlist](https://img.shields.io/badge/Peerlist-Spotlight-00AA4F?style=flat-square)](https://peerlist.io/mpellonara/project/stop-the-slop)
[![DEV.to](https://img.shields.io/badge/DEV.to-Article-0A0A0A?style=flat-square&logo=devdotto&logoColor=white)](https://dev.to/mpellonara/how-i-built-an-open-source-browser-extension-to-detect-ai-slop-on-youtube-2pc1)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-10b981?style=flat-square)](https://mauropello.github.io/stop-the-slop/privacy.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 🌐 Official Store Listings & Website
- **Chrome Web Store (Official):** [Install for Chrome, Brave & Edge](https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg)
- **Firefox Add-on (Official AMO):** [Install for Firefox](https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/)
- **Interactive Web Demo & Site:** [https://mauropello.github.io/stop-the-slop/](https://mauropello.github.io/stop-the-slop/)
- **Official Privacy Policy:** [https://mauropello.github.io/stop-the-slop/privacy.html](https://mauropello.github.io/stop-the-slop/privacy.html)

---

## 🌟 Featured On & Community Listings
- **Product Hunt:** [Stop the Slop on Product Hunt](https://www.producthunt.com/products/stop-the-slop-2) — Join the launch discussion & share maker feedback.
- **AlternativeTo:** [Stop the Slop on AlternativeTo](https://alternativeto.net/software/stop-the-slop/about/) — Crowdsourced software directory & open-source reviews.
- **SourceForge:** [Stop the Slop on SourceForge](https://sourceforge.net/projects/stop-the-slop/) — Open-source software directory & mirror.
- **Peerlist:** [Stop the Slop on Peerlist](https://peerlist.io/mpellonara/project/stop-the-slop) — Maker project spotlight & community timeline.
- **DEV Community:** [How I Built an Open-Source Browser Extension to Detect AI Slop on YouTube](https://dev.to/mpellonara/how-i-built-an-open-source-browser-extension-to-detect-ai-slop-on-youtube-2pc1) — In-depth technical architecture writeup.

---

## ✨ Features
- **Video Thumbnail AI Badges:** Displays instant AI probability ratings directly on YouTube video thumbnails across Home feeds, Subscriptions, Search, and Recommendations before you even click!
- **In-Player Detection & Toolbar Badge:** Real-time AI probability score in the popup and toolbar action icon.
- **Sentence-Level Heatmap:** Pinpoints exactly which sentences triggered robotic AI markers.
- **High-Speed Edge & Local Cache:** Sub-50ms batch lookups for video thumbnails via Cloudflare Workers + D1 and local storage with zero redundant requests.
- **Privacy-First:** Zero personal data tracking, no analytics cookies, no user accounts required.
- **Adaptive Dark / Light Theme:** Seamlessly integrates with YouTube's interface.

---

## 📁 Repository Structure
```
├── docs/                 # GitHub Pages website & Privacy Policy
│   ├── index.html        # Landing page with interactive live simulator
│   ├── privacy.html      # Official Store-compliant privacy policy
│   ├── style.css         # Modern vanilla CSS design system
│   ├── app.js            # Live interactive demo & theme toggle logic
│   └── icons/            # App icons and assets
├── extension-chrome/     # Chrome / Chromium (Manifest V3) extension
├── extension-firefox/    # Mozilla Firefox (Manifest V3) extension
└── worker/               # Cloudflare Worker API & Sapling AI integration
```

---

## 🚀 Quick Install (Developer Mode)

### Chrome / Brave / Edge
1. Clone this repository:
   ```bash
   git clone https://github.com/MauroPello/stop-the-slop.git
   ```
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** (top right switch).
4. Click **Load unpacked** and select the `extension-chrome` directory.
5. Open any YouTube video with captions!

### Firefox
1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**.
3. Select `extension-firefox/manifest.json`.

---

## 🔒 Privacy & Permissions
See [Privacy Policy](https://mauropello.github.io/stop-the-slop/privacy.html) for complete details on required permissions (`tabs`, `storage`, `scripting`, `https://www.youtube.com/*`).

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
