/*
 * Registers the service worker so the app can be installed and used offline
 * for a moment of patchy signal. Safe to include on every page.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed:', err.message);
    });
  });
}
