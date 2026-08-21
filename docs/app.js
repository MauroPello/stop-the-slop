/* ==========================================================================
   Stop the Slop — Interactive Client Scripts
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initSimulator();
  initTabs();
  initCopyButtons();
  initMobileNav();
});

/* --------------------------------------------------------------------------
   Interactive Live Simulator
   -------------------------------------------------------------------------- */
const SIM_PRESETS = {
  ai: {
    score: 88,
    verdict: 'High AI Probability (88%)',
    verdictClass: 'verdict-ai',
    verdictEmoji: '🤖',
    transcript: `
      <p><span class="highlight-ai">In today's fast-paced digital era, the landscape of technology is evolving at an unprecedented pace.</span></p>
      <p>Many individuals often wonder how these modern innovations can transform our daily routines.</p>
      <p><span class="highlight-ai">Furthermore, it is important to remember that efficiency and productivity remain key pillars of modern success.</span></p>
      <p><span class="highlight-ai">In conclusion, by harnessing the full potential of these tools, one can effortlessly maximize their overall output.</span></p>
    `
  },
  human: {
    score: 14,
    verdict: 'Likely Human Script (14%)',
    verdictClass: 'verdict-human',
    verdictEmoji: '✨',
    transcript: `
      <p>I spent three weeks in Tokyo trying to find the best ramen spot that tourists don't know about.</p>
      <p>On my fourth night, getting caught in the rain near Shinjuku, I stumbled into this tiny four-seat basement bar.</p>
      <p>The owner didn't speak any English, but made the most incredible rich tonkotsu broth I've ever tasted in my entire life.</p>
      <p>Here's exactly why mainstream food bloggers got this neighborhood completely wrong.</p>
    `
  },
  custom: {
    score: 62,
    verdict: 'Mixed / Moderate AI Signals (62%)',
    verdictClass: 'verdict-ai',
    verdictEmoji: '⚠️',
    transcript: `
      <p><span class="highlight-ai">In this comprehensive guide, we will delve deep into the step-by-step nuances of modern web architecture.</span></p>
      <p>We built our background worker using Cloudflare edge functions for sub-50ms latency across global clusters.</p>
      <p><span class="highlight-ai">It is crucial to emphasize that scalability cannot be overlooked under any circumstances.</span></p>
    `
  }
};

function initSimulator() {
  const needle = document.getElementById('sim-needle');
  const scoreDisplay = document.getElementById('sim-score');
  const verdictBanner = document.getElementById('sim-verdict');
  const transcriptBox = document.getElementById('sim-transcript');
  const presetBtns = document.querySelectorAll('.preset-btn');

  function applyPreset(presetKey) {
    const data = SIM_PRESETS[presetKey] || SIM_PRESETS.ai;
    
    // Rotate needle: -90deg (0%) to +90deg (100%) => angle = -90 + (score / 100) * 180
    const angle = -90 + (data.score / 100) * 180;
    if (needle) {
      needle.style.transform = `rotate(${angle}deg)`;
    }

    // Update score counter with smooth count
    if (scoreDisplay) {
      animateValue(scoreDisplay, parseInt(scoreDisplay.innerText) || 0, data.score, 600);
    }

    // Update verdict
    if (verdictBanner) {
      verdictBanner.className = `sim-verdict-banner ${data.verdictClass}`;
      verdictBanner.innerHTML = `<span>${data.verdictEmoji}</span> <span>${data.verdict}</span>`;
    }

    // Update transcript text
    if (transcriptBox) {
      transcriptBox.innerHTML = data.transcript;
    }
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.getAttribute('data-preset');
      applyPreset(preset);
    });
  });

  // Run initial AI preset on page load
  setTimeout(() => {
    applyPreset('ai');
  }, 300);
}

function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start) + '%';
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

/* --------------------------------------------------------------------------
   Installation Tabs Switcher
   -------------------------------------------------------------------------- */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Copy to Clipboard
   -------------------------------------------------------------------------- */
function initCopyButtons() {
  const copyButtons = document.querySelectorAll('.copy-btn');

  copyButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetSelector = btn.getAttribute('data-clipboard-target');
      const codeElement = document.querySelector(targetSelector);
      if (!codeElement) return;

      try {
        await navigator.clipboard.writeText(codeElement.innerText.trim());
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.color = 'var(--accent-emerald)';
        btn.style.borderColor = 'var(--accent-emerald)';
        
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Mobile Navigation Toggle
   -------------------------------------------------------------------------- */
function initMobileNav() {
  const toggleBtn = document.getElementById('mobile-nav-toggle');
  const navLinks = document.getElementById('nav-links');

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const isExpanded = navLinks.classList.contains('open');
      toggleBtn.setAttribute('aria-expanded', isExpanded);
    });

    // Close when clicking any nav item
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
  }
}
