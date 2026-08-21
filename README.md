# Stop the Slop 🚫 🎬

> **AI Script Detector for YouTube** — A lightweight, privacy-friendly browser extension that analyzes YouTube video transcripts in real-time to detect AI-generated scripts.

[![Live Website](https://img.shields.io/badge/Website-GitHub%20Pages-6366f1?style=flat-square)](https://mauropello.github.io/stop-the-slop/)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-10b981?style=flat-square)](https://mauropello.github.io/stop-the-slop/privacy.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 🌐 Live Landing Page & Privacy Policy
- **Website & Interactive Demo:** [https://mauropello.github.io/stop-the-slop/](https://mauropello.github.io/stop-the-slop/)
- **Official Privacy Policy:** [https://mauropello.github.io/stop-the-slop/privacy.html](https://mauropello.github.io/stop-the-slop/privacy.html)

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
