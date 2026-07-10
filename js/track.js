/* MASEST - first-party pageview + funnel-event beacon. Privacy-light: random per-session id,
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

    function cleanPart(value, max) {
      return String(value || '').trim().slice(0, max || 120);
    }

    function eventContext(detail) {
      var parts = [];
      detail = detail || {};
      [
        ['document', detail.document],
        ['industry', detail.industry],
        ['request_type', detail.request_type],
        ['product', detail.product],
        ['source', detail.source]
      ].forEach(function (entry) {
        var value = cleanPart(entry[1], 120);
        if (value) parts.push(entry[0] + '=' + encodeURIComponent(value));
      });
      return parts.length ? '#' + parts.join('&') : '';
    }

    function beacon(event, detail) {
      try {
        var payload = JSON.stringify({
          // Query strings can contain checkout capabilities, auth codes, unsubscribe
          // tokens, or email addresses. Attribution is captured separately above.
          path: location.pathname + eventContext(detail),
          referrer: document.referrer || '',
          visitor: vid,
          event: cleanPart(event || 'pageview', 40),
          utm: utm,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      } catch (e) { /* never affect the page */ }
    }

    window.mtrack = beacon;                          // funnel events: mtrack('quote_submit', { industry: 'Data Centers' })
    window.masestUtm = function () { return utm; };  // forms attach attribution to submissions
    beacon('pageview');
  } catch (e) { /* never affect the page */ }
})();
