/* ==========================================================================
   Stop the Slop: Interactive Client Scripts
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
    verdict: 'High AI probability (88%)',
    verdictClass: 'verdict-ai'
  },
  human: {
    score: 14,
    verdict: 'Likely human script (14%)',
    verdictClass: 'verdict-human'
  },
  custom: {
    score: 62,
    verdict: 'Mixed signals (62%)',
    verdictClass: 'verdict-mixed'
  }
};

function initSimulator() {
  const needle = document.getElementById('sim-needle');
  const scoreDisplay = document.getElementById('sim-score');
  const verdictBanner = document.getElementById('sim-verdict');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const previewCard = document.querySelector('.simulator-card') || document.getElementById('demo');

  const PRESET_KEYS = ['ai', 'human', 'custom'];
  let currentPresetIndex = 0;
  const ROTATE_INTERVAL = 5000;
  let autoTimer = null;
  let isHovered = false;
  let isFocused = false;
  let touchResumeTimeout = null;

  function applyPreset(presetKey) {
    const data = SIM_PRESETS[presetKey] || SIM_PRESETS.ai;
    
    // Rotate needle: -90deg (0%) to +90deg (100%) => angle = -90 + (score / 100) * 180
    const angle = -90 + (data.score / 100) * 180;
    if (needle) {
      needle.style.transform = `rotate(${angle}deg)`;
    }

    // Update score counter with smooth count
    if (scoreDisplay) {
      animateValue(scoreDisplay, parseInt(scoreDisplay.innerText, 10) || 0, data.score, 400);
    }

    // Update verdict with clean status dot
    if (verdictBanner) {
      verdictBanner.className = `sim-verdict-banner ${data.verdictClass}`;
      verdictBanner.innerHTML = `<span class="verdict-dot"></span> <span>${data.verdict}</span>`;
    }
  }

  function selectPreset(presetKey) {
    const idx = PRESET_KEYS.indexOf(presetKey);
    if (idx !== -1) {
      currentPresetIndex = idx;
    }
    presetBtns.forEach(b => {
      const isCurrent = b.getAttribute('data-preset') === presetKey;
      b.classList.toggle('active', isCurrent);
    });
    applyPreset(presetKey);
  }

  function startAutoSwitch() {
    stopAutoSwitch();
    autoTimer = setInterval(() => {
      currentPresetIndex = (currentPresetIndex + 1) % PRESET_KEYS.length;
      selectPreset(PRESET_KEYS[currentPresetIndex]);
    }, ROTATE_INTERVAL);
  }

  function stopAutoSwitch() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function pauseInteraction() {
    stopAutoSwitch();
    if (touchResumeTimeout) {
      clearTimeout(touchResumeTimeout);
      touchResumeTimeout = null;
    }
  }

  function resumeInteraction() {
    if (!isHovered && !isFocused && !document.hidden) {
      startAutoSwitch();
    }
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      selectPreset(preset);
      pauseInteraction();
      if (!isHovered && !isFocused) {
        touchResumeTimeout = setTimeout(() => {
          resumeInteraction();
        }, ROTATE_INTERVAL);
      }
    });
  });

  if (previewCard) {
    previewCard.addEventListener('mouseenter', () => {
      isHovered = true;
      pauseInteraction();
    });

    previewCard.addEventListener('mouseleave', () => {
      isHovered = false;
      resumeInteraction();
    });

    previewCard.addEventListener('focusin', () => {
      isFocused = true;
      pauseInteraction();
    });

    previewCard.addEventListener('focusout', (e) => {
      if (!previewCard.contains(e.relatedTarget)) {
        isFocused = false;
        resumeInteraction();
      }
    });

    previewCard.addEventListener('touchstart', () => {
      pauseInteraction();
    }, { passive: true });

    previewCard.addEventListener('touchend', () => {
      if (touchResumeTimeout) clearTimeout(touchResumeTimeout);
      touchResumeTimeout = setTimeout(() => {
        resumeInteraction();
      }, ROTATE_INTERVAL);
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoSwitch();
    } else {
      resumeInteraction();
    }
  });

  // Run initial AI preset on page load and start timer
  setTimeout(() => {
    applyPreset('ai');
    startAutoSwitch();
  }, 200);
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
        btn.innerText = 'Copied';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#15803d';
        btn.style.backgroundColor = '#15803d';
        
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.color = '';
          btn.style.borderColor = '';
          btn.style.backgroundColor = '';
        }, 1800);
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
