// Instant theme application before DOM render to prevent flash
try {
  const theme = localStorage.getItem('sts_theme') || 'system';
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
} catch (e) {}
