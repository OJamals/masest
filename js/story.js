/* ============================================================
   MASEST / VertKleen - Scrollytelling engine v5
   NATIVE browser scroll. One GSAP timeline per act, driven by
   ScrollTrigger scrub (the single smoothing layer - no Lenis,
   no wheel multipliers, no custom damping). Wheel feel is the
   browser's own; animations catch up over ~0.3s.
   Act 1: curated field-photo reel (canvas fumes). Act 2: SVG
   pipe - scroll-driven buildup on the walls, CSS-animated flow
   (no canvas, no per-frame SVG filter). Act 3: the conventional
   hazard ledger builds line by line, then the injury total counts
   up. Act 4 mirrors the same ledger with VertKleen at 0-0-0.
   Act 5: close + CTAs (canvas motes). Degrades to a stacked,
   fully-visible layout without JS, when CDN libs fail, or under
   reduced-motion.
   ============================================================ */
(function () {
  "use strict";
  var story = document.getElementById("story");
  if (!story) return;

  var deferredStoryImages = Array.prototype.slice.call(story.querySelectorAll("img[data-reel-src]"));
  function loadStoryImage(img) {
    if (!img || !img.dataset.reelSrc) return;
    img.src = img.dataset.reelSrc;
    delete img.dataset.reelSrc;
  }
  function loadAllStoryImages() {
    deferredStoryImages.forEach(loadStoryImage);
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !window.gsap || !window.ScrollTrigger) {
    /* index.html may have applied .story-ready pre-paint (CLS guard); undo it so
       the CSS fallback layout shows when we're not driving the animation. */
    story.classList.remove("story-ready");
    loadAllStoryImages();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  /* Mobile URL-bar show/hide resizes the viewport vertically on scroll; without
     this, every such resize refreshes ScrollTrigger and the triggers jump. */
  ScrollTrigger.config({ ignoreMobileResize: true });
  story.classList.add("story-ready");

  var clamp = gsap.utils.clamp;
  var smooth = function (t) { t = clamp(0, 1, t); return t * t * (3 - 2 * t); };
  function stickyOffset() {
    var nav = document.querySelector(".nav");
    var h = nav ? nav.getBoundingClientRect().height : 0;
    return Math.round(h || 67);
  }
  function storyStart() { return "top " + stickyOffset() + "px"; }

  /* ============================================================
     ACTS: each gets one timeline, scrubbed by its own scroll
     road. Beats are timeline positions (1 beat = 1 time unit):
     data-at="n" enters at beat n; data-out="m" exits at beat m.
     A 1.2-unit hold keeps the finished composition on stage
     until the act unpins and slides away naturally.
     ============================================================ */
var BEAT_IN = 0.64, BEAT_OUT = 0.26, HOLD = 1.35;
  var acts = gsap.utils.toArray(story.querySelectorAll(".act"));
  var firstAct = acts[0];

  var states = acts.map(function (act, i) {
    var maxAt = 0;
    var els = Array.prototype.slice.call(act.querySelectorAll("[data-at]"));
    var focusables = Array.prototype.slice.call(act.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"));
    els.forEach(function (el) {
      el._at = parseFloat(el.getAttribute("data-at")) || 0;
      el._out = el.hasAttribute("data-out") ? parseFloat(el.getAttribute("data-out")) : -1;
      if (el._at > maxAt) maxAt = el._at;
      if (el._out > maxAt) maxAt = el._out;
    });
    focusables.forEach(function (el) {
      el.dataset.storyTabindex = el.getAttribute("tabindex") || "";
    });
    return { act: act, stage: act.querySelector(".stage"), i: i, p: 0, active: false, fx: null, maxAt: maxAt, els: els, focusables: focusables, focusVisible: null, T: maxAt + BEAT_IN + HOLD };
  });
  function syncStoryFocus(currentIdx) {
    var visibleIdx = typeof currentIdx === "number" ? currentIdx : currentActIdx();
    states.forEach(function (st) {
      var visible = st.i === visibleIdx;
      if (visible === st.focusVisible) return;
      st.focusVisible = visible;
      st.act.setAttribute("aria-hidden", visible ? "false" : "true");
      st.focusables.forEach(function (el) {
        if (visible) {
          if (el.dataset.storyTabindex) el.setAttribute("tabindex", el.dataset.storyTabindex);
          else el.removeAttribute("tabindex");
        } else {
          el.setAttribute("tabindex", "-1");
        }
      });
    });
  }

states.forEach(function (st) {
  var tl = gsap.timeline({
    defaults: { ease: "power2.out" },
    scrollTrigger: {
      trigger: st.act,
        /* One entry model for every act: the scrub begins as the stage pins
           just under the nav, so each act's [data-at] beats reveal while it's
           held on screen - not during the slide-up, where they're missed.
           (The opener is already at the page top on load; same start applies.) */
        start: storyStart,
        end: "bottom bottom",
        scrub: 0.42,
        invalidateOnRefresh: true,        /* re-record tween endpoints at the new size */
        onToggle: function (self) {
          st.active = self.isActive;
          if (self.isActive) resizeFx(st);
          var idx = reassertAlpha(true);
          updateRail(idx);
          syncStoryFocus(idx);
        }
      },
      onUpdate: function () {
        st.p = tl.totalProgress();
        onActScrub(st);
      }
    });
    st.tl = tl;

    st.els.forEach(function (el) {
    if (st.act === firstAct && el._at === 0) {        /* opening line: visible on load */
      gsap.set(el, { autoAlpha: 1, y: 0, scale: 1 });
    } else {
      tl.fromTo(el,
        { autoAlpha: 0, y: 30, scale: 0.985 },
        { autoAlpha: 1, y: 0, scale: 1, duration: BEAT_IN },
        el._at);
    }
      if (el._out >= 0) {
        tl.to(el, { autoAlpha: 0, y: -16, duration: BEAT_OUT, ease: "power2.in" }, Math.max(0, el._out - BEAT_OUT));
      }
    });
    tl.set({}, {}, st.T);                               /* endcap: hold before unpin */
  });

  /* Beat n as a fraction of the act's scrubbed progress */
  function beatFrac(st, n) { return n / st.T; }
  var INW = function (st) { return BEAT_IN / st.T; };

  /* ============================================================
     SCRUB-DRIVEN EXTRAS (run inside each act's timeline update)
     ============================================================ */
  function onActScrub(st) {
    if (st.i === 0) {
      updateReel(st);
    }
    if (st.act === pipeAct) updateChips2(st);
    if (st.act === hmisAct) updateInjuryTotal(st);
    if (st.act === costAct) updateZeroLedger(st);
  }

  /* ---- ACT 2: caption chips ignite as their debris type accumulates ---- */
  var pipeAct = story.querySelector('.act[data-act="2"]');
  var pipeChips = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".chip")) : [];
  var pipeFlowPaths = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".pipe-flow")) : [];
  var pipeBuildupPaths = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".pipe-buildup")) : [];
  pipeChips.forEach(function (c) {
    var callout = c.closest ? c.closest(".pipe-callout") : null;
    c._callout = callout;
    c._beat = parseInt(c.getAttribute("data-at") || (callout && callout.getAttribute("data-at")), 10) || 1;
    c._burning = false;
  });
  pipeBuildupPaths.forEach(function (p) { p._beat = parseInt(p.getAttribute("data-at"), 10) || 1; });

  function updateChips2(st) {
    if (!pipeChips.length) return;
    var win = INW(st) * 1.6;                              /* ramp the ignite over ~1.6 beats */
    for (var k = 0; k < pipeChips.length; k++) {
      var c = pipeChips[k];
      var b = smooth((st.p - beatFrac(st, c._beat)) / win);
      c.style.setProperty("--burn", b.toFixed(3));
      if (c._callout) c._callout.style.setProperty("--burn", b.toFixed(3));
      var on = b > 0.5;
      if (on !== c._burning) { c._burning = on; c.classList.toggle("is-burning", on); }
    }
    updatePipeDiagram(st, win);
  }

  function updatePipeDiagram(st, win) {
    if (!pipeAct) return;
    /* Flow streaks slide as the act is scrubbed - cheap dashoffset writes with no
       SVG filter behind them (the glow is now layered strokes, not a feGaussianBlur),
       so this no longer re-rasterizes a blur region every frame. */
    var travel = -240 - st.p * 420;
    for (var f = 0; f < pipeFlowPaths.length; f++) {
      pipeFlowPaths[f].style.strokeDashoffset = (travel - f * 62).toFixed(1);
    }
    for (var i = 0; i < pipeBuildupPaths.length; i++) {
      var path = pipeBuildupPaths[i];
      var b = smooth((st.p - beatFrac(st, path._beat)) / win);
      path.style.setProperty("--build", b.toFixed(3));
    }
  }

  /* ---- ACT 1: field-photo reel crossfade ---- */
  var reel = story.querySelector(".reel");
  var reelSlides = reel ? gsap.utils.toArray(reel.querySelectorAll(".reel-slide")) : [];
  var reelIdx = reel ? reel.querySelector(".reel-idx") : null;
  var reelCur = -1;
  var REEL_A = 0.10, REEL_B = 0.94;

  function loadReelSlide(index) {
    loadStoryImage(reelSlides[index]?.querySelector("img[data-reel-src]"));
  }

  function updateReel(st) {
    if (!reelSlides.length) return;
    var n = reelSlides.length;
    var seg = (REEL_B - REEL_A) / n;
    var fade = seg * 0.24;
    var current = 0, best = -1;
    for (var i = 0; i < n; i++) {
      var s0 = REEL_A + i * seg, s1 = s0 + seg;
      var inT = (i === 0) ? 1 : smooth((st.p - s0) / fade);
      var outT = (i === n - 1) ? 0 : smooth((st.p - (s1 - fade * 0.4)) / fade);
      var o = inT * (1 - outT);
      var el = reelSlides[i];
      el.style.opacity = o;
      el.style.transform = "translateY(" + ((1 - inT) * 26 - outT * 20) + "px) scale(" + (0.965 + inT * 0.035) + ")";
      el.style.zIndex = Math.round(o * 10);
      if (o > best) { best = o; current = i; }          /* most-visible slide wins */
    }
    loadReelSlide(current);
    var currentEnd = REEL_A + (current + 1) * seg;
    if (st.p > currentEnd - fade * 2) loadReelSlide(current + 1);
    if (reelIdx && current !== reelCur) { reelCur = current; reelIdx.textContent = "Photo " + (current + 1) + " of " + n; }
  }

  /* ---- ACT 3: the "+ one workplace injury" total counts up as its
     ledger strip lands (beats ~5.5 -> 6.4). Act 4's mirror ledger is
     plain data-at reveals - no scrub extras, no pre-reveal ghosting. */
  var hmisAct = story.querySelector(".act-hmis");
  var costNum = hmisAct ? hmisAct.querySelector(".cost-num") : null;
  var COST_TARGET = costNum ? (parseInt(costNum.getAttribute("data-target"), 10) || 0) : 0;
  function setTxt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  function fmtCost(n) { return Math.round(n).toLocaleString("en-US"); }
  function updateInjuryTotal(st) {
    if (!costNum) return;
    var a = beatFrac(st, 5.5), b = beatFrac(st, 6.4);
    var compact = window.innerWidth <= 760;
    var ramp = compact ? 1 : smooth(clamp(0, 1, (st.p - a) / (b - a)));
    setTxt(costNum, fmtCost(COST_TARGET * ramp));
  }

  /* ---- ACT 4: the mirror ledger animates as it lands - each old burden
     title gets struck off ("every hazard line gone") just after its row
     reveals, and the documented saving counts up as the proof strip lands
     (beats ~4.8 -> 5.6). Compact / no-JS: strikes stay 0, total shows full. */
  var costAct = story.querySelector(".act-cost");
  var saveNum = costAct ? costAct.querySelector(".cost-num") : null;
  var SAVE_TARGET = saveNum ? (parseInt(saveNum.getAttribute("data-target"), 10) || 0) : 0;
  var zeroBurdens = costAct ? gsap.utils.toArray(costAct.querySelectorAll(".ledger-zero .ledger-burden b")) : [];
  zeroBurdens.forEach(function (b) {
    var row = b.closest ? b.closest(".ledger-row") : null;
    b._beat = row ? (parseFloat(row.getAttribute("data-at")) || 0) : 0;
  });
  function updateZeroLedger(st) {
    var compact = window.innerWidth <= 760;
    var win = (BEAT_IN / st.T) * 1.4;
    for (var i = 0; i < zeroBurdens.length; i++) {
      var b = zeroBurdens[i];
      var s = compact ? 1 : smooth(clamp(0, 1, (st.p - beatFrac(st, b._beat + 0.25)) / win));
      b.style.setProperty("--strike", s.toFixed(3));
    }
    if (saveNum) {
      var a = beatFrac(st, 4.8), c = beatFrac(st, 5.6);
      var ramp = compact ? 1 : smooth(clamp(0, 1, (st.p - a) / (c - a)));
      setTxt(saveNum, fmtCost(SAVE_TARGET * ramp));
    }
  }

  /* ============================================================
     CANVAS SYSTEMS (ambient physics on gsap.ticker; scroll only
     sets intensity via st.p - never blocks or smooths input)
     ============================================================ */
  function makeSprite(r, rgb) {
    var cv = document.createElement("canvas");
    cv.width = cv.height = r * 2;
    var x = cv.getContext("2d");
    var g = x.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, "rgba(" + rgb + ",1)");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2);
    return cv;
  }
  var SPR_FUME = makeSprite(48, "255,106,69");
  var SPR_MOTE = makeSprite(8, "52,224,200");

  function setupCanvas(cv) {
    var ctx = cv.getContext("2d");
    var lastW = 0, lastH = 0;
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.25 : 1.5);
      var r = cv.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (w === lastW && h === lastH) return false;
      lastW = w; lastH = h;
      cv.width = w;
      cv.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    resize();
    return { ctx: ctx, resize: resize, w: function () { return cv.clientWidth; }, h: function () { return cv.clientHeight; } };
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function flowAngle(x, y, t) {
    return Math.sin(x * 0.0028 + t * 0.45) + Math.cos(y * 0.0035 - t * 0.3) + Math.sin((x + y) * 0.0012 + t * 0.2);
  }

  /* --- ACT 1: faint fumes drifting behind the reel --- */
  function fxFumes(st, c, dt, time) {
    var ctx = c.ctx, w = c.w(), h = c.h();
    ctx.clearRect(0, 0, w, h);
    if (!st.parts) {
      st.parts = [];
      for (var i = 0; i < 30; i++) st.parts.push({
        x: rnd(0, w), y: rnd(h * 0.3, h * 1.1),
        vx: 0, vy: rnd(-0.35, -0.08), r: rnd(24, 60), a: rnd(0.03, 0.08), spin: rnd(0, 6.28)
      });
    }
    for (var j = 0; j < st.parts.length; j++) {
      var p = st.parts[j];
      var ang = flowAngle(p.x, p.y, time) * 1.7 + p.spin;
      p.vx += Math.cos(ang) * 0.01;
      p.vy += Math.sin(ang) * 0.007 - 0.012;
      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
      if (p.y < -p.r || p.x < -p.r || p.x > w + p.r) { p.x = rnd(0, w); p.y = h + p.r; p.vx = 0; p.vy = rnd(-0.35, -0.08); }
      ctx.globalAlpha = Math.max(0, p.a * (1.2 - p.y / h * 0.6));
      ctx.drawImage(SPR_FUME, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /* --- ACT 4: clean teal motes drifting up --- */
  function fxMotes(st, c, dt, time) {
    var ctx = c.ctx, w = c.w(), h = c.h();
    ctx.clearRect(0, 0, w, h);
    if (!st.motes) {
      st.motes = [];
      for (var i = 0; i < 36; i++) st.motes.push({ x: rnd(0, w), y: rnd(0, h), v: rnd(0.12, 0.4), r: rnd(2, 6), ph: rnd(0, 6.28) });
    }
    for (var j = 0; j < st.motes.length; j++) {
      var m = st.motes[j];
      m.y -= m.v * dt * 60;
      m.x += Math.sin(time * 0.7 + m.ph) * 0.18;
      if (m.y < -10) { m.y = h + 10; m.x = rnd(0, w); }
      ctx.globalAlpha = Math.max(0, (0.25 + 0.2 * Math.sin(time + m.ph)) * smooth(st.p * 3));
      ctx.drawImage(SPR_MOTE, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  var FX = { fumes: fxFumes, motes: fxMotes };
  states.forEach(function (st) {
    var type = st.act.getAttribute("data-fx");
    var cv = st.act.querySelector(".fx-canvas");
    if (type && cv && FX[type]) st.fx = { draw: FX[type], c: setupCanvas(cv) };
  });
  function resizeFx(st) {
    if (!st.fx) return;
    if (st.fx.c.resize()) {                            /* geometry changed */
      st.parts = null; st.motes = null; st.deb = null; /* rebuild for new geometry */
    }
  }
  var visibleActIndex = 0;
  var alphaIdx = -1;

  /* Ambient canvas loop: draws only the act on stage */
  gsap.ticker.add(function (time, deltaMS) {
    var dt = Math.min(deltaMS / 1000, 0.05);
    for (var i = 0; i < states.length; i++) {
      var st = states[i];
      if (st.fx && (st.active || Math.abs(st.i - visibleActIndex) <= 1)) st.fx.draw(st, st.fx.c, dt, time);
    }
  });

  /* ============================================================
     CHAPTER RAIL
     ============================================================ */
  var railBtns = Array.prototype.slice.call(story.querySelectorAll(".rail-btn"));
  var railCurrent = -1;
  var railTicking = false;
  function syncStoryPageState() {
    var rect = story.getBoundingClientRect();
    var inView = rect.bottom > stickyOffset() && rect.top < window.innerHeight;
    document.body.classList.toggle("story-in-view", inView);
  }
  function nearestRailIndex() {
    var anchor = window.scrollY + Math.max(stickyOffset() + 2, window.innerHeight * 0.2);
    var firstTop = states.length ? states[0].act.getBoundingClientRect().top + window.scrollY : 0;
    var current = 0;
    for (var i = 0; i < states.length; i++) {
      var top = states[i].act.getBoundingClientRect().top + window.scrollY;
      var bottom = top + states[i].act.offsetHeight;
      if (anchor >= top && anchor < bottom) return i;
      if (anchor >= top) current = i;
    }
    return anchor < firstTop ? 0 : current;
  }
  function updateRailProgress(current) {
    for (var j = 0; j < railBtns.length; j++) {
      var progress = j < current ? 1 : j === current ? states[j].p : 0;
      var next = progress.toFixed(3);
      if (railBtns[j]._storyProgress === next) continue;
      railBtns[j]._storyProgress = next;
      railBtns[j].style.setProperty("--p", next);
    }
  }
  function updateRail(current) {
    if (!railBtns.length) return;
    if (typeof current !== "number") current = currentActIdx();
    updateRailProgress(current);
    if (current === railCurrent) return;
    railCurrent = current;
    for (var j = 0; j < railBtns.length; j++) {
      railBtns[j].classList.toggle("is-on", j === current);
      railBtns[j].classList.toggle("safe", current === states.length - 1);
    }
  }
  /* ============================================================
     AUTHORITATIVE VISIBILITY - derived from scroll geometry, not
     from directional-callback history. Exactly one act's sticky
     stage owns the viewport; it shows, the rest hide. Because this
     is a pure function of position, a resize / window-move / the
     browser's scrollY-clamp on a now-shorter page cannot strand a
     stage at visibility:hidden - the next frame (or refresh) snaps
     it back to the truth. The onEnter/onLeave alpha sets above are
     now just hints; this is the source of truth.
     ============================================================ */
  function currentActIdx() {
    return nearestRailIndex();
  }
  /* autoAlpha = opacity + visibility, both compositor-only (no reflow). Cache
     the visible index during ordinary scroll, force a full reassert after
     trigger toggles/refreshes. */
  function reassertAlpha(force) {
    var idx = currentActIdx();
    visibleActIndex = idx;
    if (!force && idx === alphaIdx) return idx;
    alphaIdx = idx;
    for (var k = 0; k < states.length; k++) {
      /* Neighbors stay visible so act boundaries hand off by geometry (the
         incoming opaque stage slides over the outgoing one) instead of a
         hard cut into a black gap between scenes. */
      if (states[k].stage) gsap.set(states[k].stage, { autoAlpha: Math.abs(k - idx) <= 1 ? 1 : 0 });
    }
    return idx;
  }
  /* Full re-assert after a geometry change: fix alpha, then repaint the on-stage
     act's canvas + scrub-driven extras at the new size. */
  function reassertVisibility() {
    syncStoryPageState();
    var on = states[reassertAlpha(true)];
    if (on) { resizeFx(on); onActScrub(on); }
  }
  ScrollTrigger.addEventListener("refresh", reassertVisibility);

  function scheduleRailUpdate() {
    if (railTicking) return;
    railTicking = true;
    requestAnimationFrame(function () {
      railTicking = false;
      var idx = reassertAlpha();
      updateRail(idx);
      syncStoryFocus(idx);
      syncStoryPageState();
    });
  }
  window.addEventListener("scroll", scheduleRailUpdate, { passive: true });
  updateRail();
  syncStoryFocus();
  syncStoryPageState();

  /* Paint the opening act at rest so the first field photo and the
     parallax backdrop are visible on load, before any scroll - without
     this the reel sits at its CSS opacity:0 until the first scroll. */
  if (states[0]) { states[0].p = 0; onActScrub(states[0]); }
  reassertVisibility();

  /* Let GSAP own refresh timing: debounce resize into a single refresh (which
     invalidates tween endpoints AND fires reassertVisibility) instead of racing
     a separate canvas-only timer against GSAP's own un-debounced auto-refresh. */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { ScrollTrigger.refresh(); }, 150);
  });

  /* Window dragged between displays of different pixel density: refresh so the
     canvas re-rasterizes at the new DPR (its backing size folds devicePixelRatio)
     and visibility re-asserts. Re-arms after each change - the query is DPR-specific. */
  function watchDpr() {
    var mq = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
    var onChange = function () { mq.removeEventListener("change", onChange); ScrollTrigger.refresh(); watchDpr(); };
    mq.addEventListener("change", onChange);
  }
  watchDpr();

  /* Late layout shifts move the document under the story: #featuredProducts
     injects on DOMContentLoaded, web fonts swap after first paint. Refresh so
     each trigger's start/end track the final geometry. */
  function refreshAfterLayout() {
    requestAnimationFrame(function () { ScrollTrigger.refresh(); });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshAfterLayout, { once: true });
  } else {
    refreshAfterLayout();
  }
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
})();
