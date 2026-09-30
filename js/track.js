/* MASEST - first-party pageview + funnel-event beacon. Privacy-light: random per-session id,
 * no cookies, no PII. Include site-wide with <script src="js/track.js?v=20260929e" defer></script>.
 * Exposes window.mtrack(event), window.masestUtm(), and window.masestAttribution().
 * Silently no-ops if the /api/track function isn't deployed. */
(function () {
  try {
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname)) return;
    var VKEY = 'masest_vid', UKEY = 'masest_utm', RKEY = 'masest_referrer', LKEY = 'masest_landing';

    var vid = sessionStorage.getItem(VKEY);
    var newSession = !vid;
    if (!vid) {
      vid = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : String(Date.now()) + Math.round(Math.random() * 1e9);
      sessionStorage.setItem(VKEY, vid);
    }
    var landing = sessionStorage.getItem(LKEY);
    var upgradedSession = !newSession && landing === null;
    if (landing === null) {
      // An older tracker may already have started this session. Do not invent its
      // original landing page during a release or when storage is only partial.
      landing = newSession ? location.pathname : '';
      sessionStorage.setItem(LKEY, landing);
    }

    // Preserve the entry referrer across internal navigation. Store only the origin:
    // external URLs can contain email addresses, search terms, and capability tokens.
    var referrer = sessionStorage.getItem(RKEY);
    if (referrer === null) {
      referrer = '';
      try {
        var ref = new URL(document.referrer);
        if (/^https?:$/.test(ref.protocol) && ref.hostname !== 'masest.co' && !ref.hostname.endsWith('.masest.co')) referrer = ref.origin;
      } catch (e) { /* direct or unavailable referrer */ }
      sessionStorage.setItem(RKEY, referrer);
    }

    // First-touch UTM: capture from the URL once per session, then reuse for every beacon.
    var storedUtm = sessionStorage.getItem(UKEY), utm = {};
    if (upgradedSession) {
      // Old trackers could capture a campaign later in the visit. Its entry-page
      // provenance is uncertain, so an upgrade must not promote it to entry data.
      storedUtm = '{}';
      sessionStorage.setItem(UKEY, storedUtm);
    }
    try { utm = JSON.parse(storedUtm || '{}'); } catch (e) { utm = {}; }
    if (storedUtm === null) {
      if (newSession) {
        var q = new URLSearchParams(location.search);
        ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
          var v = q.get(k);
          if (v) utm[k] = String(v).slice(0, 120);
        });
      }
      // Empty is a captured entry too; later internal links cannot supply its source.
      sessionStorage.setItem(UKEY, JSON.stringify(utm));
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
        // Durable quote IDs are used only for local retry deduplication, never sent.
        var dedupeKey = detail && detail.dedupe_key ? 'masest_event:' + cleanPart(event, 40) + ':' + cleanPart(detail.dedupe_key, 128) : '';
        if (dedupeKey && sessionStorage.getItem(dedupeKey)) return;
        var payload = JSON.stringify({
          // Query strings can contain checkout capabilities, auth codes, unsubscribe
          // tokens, or email addresses. Attribution is captured separately above.
          path: location.pathname + eventContext(detail),
          referrer: referrer,
          visitor: vid,
          event: cleanPart(event || 'pageview', 40),
          utm: utm,
        });
        if (navigator.sendBeacon) {
          if (navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }))) {
            if (dedupeKey) sessionStorage.setItem(dedupeKey, '1');
            return;
          }
        }
        // sendBeacon can reject a full queue; fetch is the fallback in that case too.
        fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        if (dedupeKey) sessionStorage.setItem(dedupeKey, '1');
      } catch (e) { /* never affect the page */ }
    }

    window.mtrack = beacon;                          // funnel events: mtrack('quote_submit', { industry: 'Data Centers' })
    window.masestUtm = function () { return utm; };  // forms attach attribution to submissions
    window.masestAttribution = function () {
      return Object.assign({ landing_path: landing, referrer_origin: referrer }, utm);
    };
    beacon('pageview');
  } catch (e) { /* never affect the page */ }
})();
