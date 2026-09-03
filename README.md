# Stop the Slop

> **AI Script Detector for YouTube**: An open-source browser extension that analyzes YouTube video transcripts to flag AI-generated scripts and robotic narration.

[![Live Website](https://img.shields.io/badge/Website-GitHub%20Pages-0f172a?style=flat-square)](https://mauropello.github.io/stop-the-slop/)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--ons-FF7139?style=flat-square&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/)
[![Product Hunt](https://img.shields.io/badge/Product_Hunt-Featured-DA552F?style=flat-square&logo=producthunt&logoColor=white)](https://www.producthunt.com/products/stop-the-slop-2)
[![AlternativeTo](https://img.shields.io/badge/AlternativeTo-Listed-0088CC?style=flat-square&logo=alternativeto&logoColor=white)](https://alternativeto.net/software/stop-the-slop/about/)
[![SourceForge](https://img.shields.io/badge/SourceForge-Project-EE5922?style=flat-square&logo=sourceforge&logoColor=white)](https://sourceforge.net/projects/stop-the-slop/)
[![Peerlist](https://img.shields.io/badge/Peerlist-Spotlight-00AA4F?style=flat-square)](https://peerlist.io/mpellonara/project/stop-the-slop)
[![DEV.to](https://img.shields.io/badge/DEV.to-Article-0A0A0A?style=flat-square&logo=devdotto&logoColor=white)](https://dev.to/mpellonara/how-i-built-an-open-source-browser-extension-to-detect-ai-slop-on-youtube-2pc1)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-15803d?style=flat-square)](https://mauropello.github.io/stop-the-slop/privacy.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## Official Store Listings & Website
- **Chrome Web Store:** [Install for Chrome, Brave and Edge](https://chromewebstore.google.com/detail/stop-the-slop-%E2%80%94-ai-script/afifehnicpeokjjhpbicikfoalkemelg)
- **Firefox Add-ons:** [Install for Firefox](https://addons.mozilla.org/en-US/firefox/addon/stop-the-slop-ai-video-detect/)
- **Project Website:** [https://mauropello.github.io/stop-the-slop/](https://mauropello.github.io/stop-the-slop/)
- **Privacy Policy:** [https://mauropello.github.io/stop-the-slop/privacy.html](https://mauropello.github.io/stop-the-slop/privacy.html)

---

## Community & Directory Listings
- **Product Hunt:** [Stop the Slop on Product Hunt](https://www.producthunt.com/products/stop-the-slop-2): Community launch discussion and feedback.
- **AlternativeTo:** [Stop the Slop on AlternativeTo](https://alternativeto.net/software/stop-the-slop/about/): Directory listing and open-source reviews.
- **SourceForge:** [Stop the Slop on SourceForge](https://sourceforge.net/projects/stop-the-slop/): Open-source mirror.
- **Peerlist:** [Stop the Slop on Peerlist](https://peerlist.io/mpellonara/project/stop-the-slop): Project timeline and updates.
- **DEV Community:** [How I Built an Open-Source Browser Extension to Detect AI Slop on YouTube](https://dev.to/mpellonara/how-i-built-an-open-source-browser-extension-to-detect-ai-slop-on-youtube-2pc1): Architecture writeup.

---

## Features
- **Thumbnail AI Badges:** Displays AI probability ratings directly on video thumbnails across YouTube feeds before clicking.
- **In-Player Controls Badge:** Shows a native AI probability pill alongside the bottom-right video player controls (subtitles, settings, fullscreen) with an interactive verdict popover.
- **In-Player Detection:** Probability score gauge and sentence breakdown in the extension popup.
- **Sentence Breakdown:** Highlights specific sentences that triggered repetitive phrasing or AI markers.
- **Local & Edge Caching:** Caches evaluated videos to deliver fast verdicts without redundant network requests.
- **Privacy-First:** Zero personal data tracking, no analytics cookies, and no account required.
- **Adaptive Dark / Light Theme:** Matches YouTube's theme automatically.

---

## Repository Structure
```
├── docs/                 # GitHub Pages website and Privacy Policy
│   ├── index.html        # Landing page with interactive demo
│   ├── privacy.html      # Privacy policy
│   ├── style.css         # Stylesheet and UI tokens
│   ├── app.js            # Client-side scripts
│   └── icons/            # App icons and assets
├── extension-chrome/     # Chrome / Chromium (Manifest V3) extension
├── extension-firefox/    # Mozilla Firefox (Manifest V3) extension
└── worker/               # Cloudflare Worker API
```

---

## Installation (Developer Mode)

### Chrome / Brave / Edge
1. Clone this repository:
   ```bash
   git clone https://github.com/MauroPello/stop-the-slop.git
   ```
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension-chrome` directory.
5. Open any YouTube video with captions to test.

### Firefox
1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...**.
3. Select `extension-firefox/manifest.json`.

---

## Privacy & Permissions
See [Privacy Policy](https://mauropello.github.io/stop-the-slop/privacy.html) for details on permissions (`tabs`, `storage`, `scripting`, `https://www.youtube.com/*`).

---

## License
This project is licensed under the [MIT License](LICENSE).
