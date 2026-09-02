// Registers the service worker that makes the app work offline.
//
// Service workers only exist in a secure context (HTTPS or localhost). This app is explicitly
// meant to run from file:// and plain-http LAN too, where `navigator.serviceWorker` is simply
// absent — so every failure here is non-fatal and silent. Offline support is an enhancement;
// nothing about merging depends on it.
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // sw.js is written by scripts/generate-sw.mjs into the export, so it does not exist in dev.
  if (process.env.NODE_ENV !== 'production') return;

  const register = () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      /* unsupported, blocked, or served from somewhere a worker cannot be registered */
    });
  };

  // Registration is deferred to `load` so precaching does not compete with the first paint —
  // but by the time React runs an effect the load event has usually already fired, and
  // waiting for one that will never come again would silently disable offline support.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
