/* MASEST — first-party pageview + funnel-event beacon. Privacy-light: random per-session id,
 * no cookies, no PII. Include site-wide with <script src="js/track.js" defer></script>.
 * Exposes window.mtrack(event) for funnel events and window.masestUtm() for forms.
 * Silently no-ops if the /api/track function isn't deployed. */
(function () {
  try {
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname)) return;
    var VKEY = 'masest_vid', UKEY = 'masest_utm';

    var vid = sessionStorage.getItem(VKEY);
    if (!vid) {
      vid = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.round(Math.random() * 1e9);
      sessionStorage.setItem(VKEY, vid);
    }

    // First-touch UTM: capture from the URL once per session, then reuse for every beacon.
    var utm = {};
    try { utm = JSON.parse(sessionStorage.getItem(UKEY) || '{}'); } catch (e) { utm = {}; }
    if (!utm.utm_source) {
      var q = new URLSearchParams(location.search);
      var got = {};
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
        var v = q.get(k);
        if (v) got[k] = String(v).slice(0, 120);
      });
      if (got.utm_source) { utm = got; sessionStorage.setItem(UKEY, JSON.stringify(utm)); }
    }

    function beacon(event) {
      try {
        var payload = JSON.stringify({
          path: location.pathname + location.search,
          referrer: document.referrer || '',
          visitor: vid,
          event: event || 'pageview',
          utm: utm,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      } catch (e) { /* never affect the page */ }
    }

    window.mtrack = beacon;                          // funnel events: mtrack('quote_submit')
    window.masestUtm = function () { return utm; };  // forms attach attribution to submissions
    beacon('pageview');
  } catch (e) { /* never affect the page */ }
})();
