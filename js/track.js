/* MASEST — first-party pageview beacon. Privacy-light: random per-session id, no cookies, no PII.
 * Include site-wide with <script src="js/track.js" defer></script>. Safe to load anywhere;
 * silently no-ops if the /api/track function isn't deployed. */
(function () {
  try {
    var KEY = 'masest_vid';
    var vid = sessionStorage.getItem(KEY);
    if (!vid) {
      vid = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.round(Math.random() * 1e9);
      sessionStorage.setItem(KEY, vid);
    }
    var payload = JSON.stringify({
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      visitor: vid,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
        .catch(function () {});
    }
  } catch (e) { /* never affect the page */ }
})();
