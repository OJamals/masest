/* ============================================================
   MASEST / VertKleen - Scrollytelling engine v5
   NATIVE browser scroll. One GSAP timeline per act, driven by
   ScrollTrigger scrub (the single smoothing layer - no Lenis,
   no wheel multipliers, no custom damping). Wheel feel is the
   browser's own; animations catch up over ~0.3s.
   Act 1: curated field-photo reel. Act 2: debris accumulation
   inside a pipe (sticking physics). Act 3: HMIS factor by
   factor. Act 4: chemicals dropped onto the hazard scale, then
   zeroed. Degrades to a stacked, fully-visible layout without
   JS, when CDN libs fail, or under prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";
  var story = document.getElementById("story");
  if (!story) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !window.gsap || !window.ScrollTrigger) return; /* CSS fallback shows everything */

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
      var isHmisChemical = el.classList && el.classList.contains("hmis-chemical");
      var enterAt = isHmisChemical ? Math.max(0, el._at - BEAT_OUT) : el._at;
      var enterDuration = isHmisChemical ? Math.max(0.36, BEAT_IN - 0.1) : BEAT_IN;
      tl.fromTo(el,
        { autoAlpha: 0, y: 30, scale: 0.985 },
        { autoAlpha: 1, y: 0, scale: 1, duration: enterDuration },
        enterAt);
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
  var cue = story.querySelector(".scroll-cue");

  function onActScrub(st) {
    if (st.i === 0) {
      updateReel(st);
      if (cue) cue.style.opacity = Math.max(0, 1 - st.p * 8);
    }
    if (st.act === pipeAct) updateChips2(st);
    if (st.act === hmisAct) updateHmis(st);
    if (st.act === costAct) updateCost(st);
  }

  /* ---- ACT 2: caption chips ignite as their debris type accumulates ---- */
  var pipeAct = story.querySelector('.act[data-act="2"]');
  var pipeChips = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".chip")) : [];
  var pipeFlowPaths = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".pipe-flow")) : [];
  var pipeBuildupPaths = pipeAct ? gsap.utils.toArray(pipeAct.querySelectorAll(".pipe-buildup")) : [];
  pipeChips.forEach(function (c) { c._beat = parseInt(c.getAttribute("data-at"), 10) || 1; c._burning = false; });
  pipeBuildupPaths.forEach(function (p) { p._beat = parseInt(p.getAttribute("data-at"), 10) || 1; });

  function updateChips2(st) {
    if (!pipeChips.length) return;
    var win = INW(st) * 1.6;                              /* ramp the ignite over ~1.6 beats */
    for (var k = 0; k < pipeChips.length; k++) {
      var c = pipeChips[k];
      var b = smooth((st.p - beatFrac(st, c._beat)) / win);
      c.style.setProperty("--burn", b.toFixed(3));
      var on = b > 0.5;
      if (on !== c._burning) { c._burning = on; c.classList.toggle("is-burning", on); }
    }
    updatePipeDiagram(st, win);
  }

  function updatePipeDiagram(st, win) {
    if (!pipeAct) return;
    var travel = -240 - st.p * 420;
    for (var f = 0; f < pipeFlowPaths.length; f++) {
      pipeFlowPaths[f].style.strokeDashoffset = (travel - f * 62).toFixed(1);
    }
    for (var i = 0; i < pipeBuildupPaths.length; i++) {
      var path = pipeBuildupPaths[i];
      var b = smooth((st.p - beatFrac(st, path._beat)) / win);
      path.style.setProperty("--build", b.toFixed(3));
      path.style.strokeDashoffset = (1 - b).toFixed(3);
    }
  }

  /* ---- ACT 1: field-photo reel crossfade ---- */
  var reel = story.querySelector(".reel");
  var reelSlides = reel ? gsap.utils.toArray(reel.querySelectorAll(".reel-slide")) : [];
  var reelIdx = reel ? reel.querySelector(".reel-idx") : null;
  var reelCur = -1;
  var REEL_A = 0.10, REEL_B = 0.94;

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
    if (reelIdx && current !== reelCur) { reelCur = current; reelIdx.textContent = "Photo " + (current + 1) + " of " + n; }
  }

  /* ---- ACT 3: HMIS hazard diamond - cycle the four legacy chemicals ----
     The diamond + label are driven entirely here (no [data-at] on the rig);
     numbers count up on the first chemical, then the rig dips at each boundary
     so the swap to the next chemical reads as a crossfade. Data + the no-JS
     fallback both live in the .hmis-legacy list. */
  var hmisAct = story.querySelector(".act-hmis");
  var hmisStack = hmisAct ? hmisAct.querySelector(".hmis-stack") : null;
  var hmisDiamond = hmisAct ? hmisAct.querySelector(".hmis-diamond") : null;
  var dmH = hmisAct ? hmisAct.querySelector(".dm-hnum") : null;
  var dmF = hmisAct ? hmisAct.querySelector(".dm-fnum") : null;
  var dmR = hmisAct ? hmisAct.querySelector(".dm-rnum") : null;
  var dmPicto = hmisAct ? hmisAct.querySelector(".dm-picto") : null;
  var hcType = hmisAct ? hmisAct.querySelector(".hc-type") : null;
  var hcName = hmisAct ? hmisAct.querySelector(".hc-name") : null;
  var hcDesc = hmisAct ? hmisAct.querySelector(".hc-desc") : null;
  var hmisDots = hmisAct ? Array.prototype.slice.call(hmisAct.querySelectorAll(".hc-dots i")) : [];
  var lgH = hmisAct ? hmisAct.querySelector(".lg-h") : null;
  var lgF = hmisAct ? hmisAct.querySelector(".lg-f") : null;
  var lgR = hmisAct ? hmisAct.querySelector(".lg-r") : null;
  var chems = hmisAct ? Array.prototype.slice.call(hmisAct.querySelectorAll(".hmis-legacy li")).map(function (li) {
    var d = li.dataset;
    return { h: +d.h, f: +d.f, r: +d.r, type: d.type, picto: d.picto, name: d.name, desc: d.desc };
  }) : [];
  var hmisCur = -1;
  var HM_A = 0.12, HM_B = 0.9;                          /* fraction of the act's scrub spent cycling */
  function setTxt(el, v) { if (el && el.textContent !== v) el.textContent = v; }

  function updateHmis(st) {
    if (!chems.length) return;
    var n = chems.length;
    var enter = smooth(clamp(0, 1, st.p / 0.07));        /* whole rig fades in as the act takes the stage */
    var pos = clamp(0, n - 0.0001, (st.p - HM_A) / (HM_B - HM_A) * n);
    var idx = pos | 0;
    var local = pos - idx;                               /* 0..1 within the current chemical */
    var c = chems[idx];
    var ramp = idx === 0 ? smooth(clamp(0, 1, local / 0.4)) : 1;   /* first chemical counts 0->value */
    setTxt(dmH, "" + Math.round(c.h * ramp));
    setTxt(dmF, "" + Math.round(c.f * ramp));
    setTxt(dmR, "" + Math.round(c.r * ramp));
    if (idx !== hmisCur) {
      hmisCur = idx;
      setTxt(hcType, c.type); setTxt(hcName, c.name); setTxt(hcDesc, c.desc);
      setTxt(lgH, "" + c.h); setTxt(lgF, "" + c.f); setTxt(lgR, "" + c.r);
      if (dmPicto) { dmPicto.setAttribute("href", "#ico-" + c.picto); dmPicto.setAttribute("xlink:href", "#ico-" + c.picto); }
      for (var d = 0; d < hmisDots.length; d++) hmisDots[d].classList.toggle("is-on", d === idx);
      if (hmisDiamond) hmisDiamond.setAttribute("aria-label",
        "Hazard diamond for " + c.name + ": health " + c.h + ", flammability " + c.f + ", reactivity " + c.r + ", " + c.type.toLowerCase());
    }
    /* dip at internal boundaries only - full at the first chemical's start and the last one's hold */
    var edgeIn = idx === 0 ? 1 : smooth(clamp(0, 1, local / 0.12));
    var edgeOut = idx === n - 1 ? 1 : smooth(clamp(0, 1, (1 - local) / 0.12));
    if (hmisStack) hmisStack.style.opacity = (enter * Math.min(edgeIn, edgeOut)).toFixed(3);
  }

  /* ---- ACT 4: legacy cost meter counts up; VertKleen stays at zero ---- */
  var costAct = story.querySelector(".act-cost");
  var costNum = costAct ? costAct.querySelector(".cost-num") : null;
  var costVert = costAct ? costAct.querySelector(".cost-vert") : null;
  var COST_TARGET = costNum ? (parseInt(costNum.getAttribute("data-target"), 10) || 0) : 0;
  /* VertKleen card starts hidden and is faded in by updateCost once the legacy
     total has climbed. This runs only under motion (the reduced-motion / no-GSAP
     path returns early above), so the CSS fallback still shows the card. */
  if (costVert) gsap.set(costVert, { autoAlpha: 0, y: 18 });
  function fmtCost(n) { return Math.round(n).toLocaleString("en-US"); }
  function updateCost(st) {
    if (!costNum) return;
    /* ramp the count-up across the incident reveal (beat 4.4 -> 5.0) */
    var a = beatFrac(st, 4.4), b = beatFrac(st, 5.0);
    var compactCost = window.innerWidth <= 760;
    var ramp = compactCost ? 1 : smooth(clamp(0, 1, (st.p - a) / (b - a)));
    setTxt(costNum, fmtCost(COST_TARGET * ramp));
    if (costVert) {
      /* Foreshadow the counterpoint before the incident total peaks so the
         split screen reads as comparison, not a one-sided warning. */
      var reveal = Math.max(0.42, smooth(clamp(0, 1, (st.p - beatFrac(st, 2.45)) / (beatFrac(st, 4.25) - beatFrac(st, 2.45)))));
      gsap.set(costVert, { autoAlpha: reveal, y: (1 - reveal) * 18 });
      costVert.classList.toggle("is-on", reveal > 0.5);
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
  function seededRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = Math.imul(1664525, s) + 1013904223 >>> 0;
      return s / 4294967296;
    };
  }
  function rndWith(rng, a, b) { return a + rng() * (b - a); }
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

  /* --- ACT 2: DEBRIS - falls into a vertical zig-zag pipe ---
     The pipe is a polyline that descends through elbows. Debris is
     advected along the pipe's arc length (gravity biases it toward the
     down-wall), and crust accumulates per arc-length bucket - heaviest
     at the elbows, where real systems clog first. Each enemy type favors
     a home stretch of the run, matching the four chips. The bore visibly
     narrows and flow speeds through the chokes (continuity preserved). */
  var DEB_TYPES = [
    { c: "201,212,208", hs: 0.08 },  /* scale   - top horizontal run */
    { c: "194,85,58",   hs: 0.34 },  /* rust    - right vertical     */
    { c: "194,160,78",  hs: 0.58 },  /* grease  - middle bend        */
    { c: "111,168,99",  hs: 0.84 }   /* biofilm - lower run / exit   */
  ];
  /* normalized centerline (fractions of the stage). The chip CSS
     positions in story.css are hand-aligned to these points. */
  /* Routed below the centered headline + paragraph, but kept fully in-frame.
     The previous path ran to 1.08h, which clipped the lower pipe on ordinary
     desktop viewports and made the scene read like a broken staircase. */
  var PIPE_N = [
    [0.10, 0.45], [0.25, 0.45], [0.25, 0.55], [0.44, 0.55],
    [0.44, 0.65], [0.63, 0.65], [0.63, 0.75], [0.84, 0.75], [0.84, 0.90]
  ];
  var BUCKET_N = 64;

  function buildPipe(w, h) {
    var compact = w < 760;
    var bore = clamp(compact ? 34 : 38, compact ? 62 : 82, h * (compact ? 0.085 : 0.108));
    var pts = PIPE_N.map(function (p) {
      var x = compact ? (0.05 + p[0] * 0.9) : p[0];
      return { x: x * w, y: p[1] * h };
    });
    var segs = [], cum = [0], L = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      var tx = dx / len, ty = dy / len;
      segs.push({ a: a, b: b, len: len, tx: tx, ty: ty, nx: -ty, ny: tx });
      L += len; cum.push(L);
    }
    return { pts: pts, segs: segs, cum: cum, L: L, bore: bore };
  }
  /* arc position s -> world point + tangent + normal of its segment
     (gp = normal·gravity, i.e. how much "down" pushes along +normal) */
  function atS(P, s) {
    s = clamp(0, P.L, s);
    var i = P.segs.length - 1;
    for (var k = 0; k < P.segs.length; k++) { if (s <= P.cum[k + 1]) { i = k; break; } }
    var sg = P.segs[i], t = (s - P.cum[i]) / sg.len;
    return {
      x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t,
      nx: sg.nx, ny: sg.ny, gp: sg.ny
    };
  }
  function strokePipe(ctx, P) {
    ctx.beginPath();
    ctx.moveTo(P.pts[0].x, P.pts[0].y);
    for (var i = 1; i < P.pts.length; i++) ctx.lineTo(P.pts[i].x, P.pts[i].y);
    ctx.stroke();
  }
  function spawnPart(D, s) {
    var rng = D.rng || Math.random;
    var t = DEB_TYPES[(rng() * (D.unlocked || 1)) | 0];
    if (s == null && D.P) s = clamp(0, D.P.L * 0.96, t.hs * D.P.L + rndWith(rng, -D.P.bore * 2.4, D.P.bore * 0.8));
    D.parts.push({ t: t, s: s, o: rndWith(rng, -D.half * 0.4, D.half * 0.4), v: rndWith(rng, 0.9, 1.8), r: rndWith(rng, 2.2, 4.4) });
  }

  function unlockedDebrisTypes(st) {
    var n = 1;
    if (st.p >= beatFrac(st, 2) - INW(st) * 0.2) n = 2;
    if (st.p >= beatFrac(st, 3) - INW(st) * 0.2) n = 3;
    if (st.p >= beatFrac(st, 4) - INW(st) * 0.2) n = 4;
    return n;
  }
  function depositDebris(D, s, side, t, r) {
    var b = Math.max(0, Math.min(BUCKET_N, (s / D.bs) | 0));
    var arr = D.crust[side], col = D.ccol[side];
    arr[b] = Math.min(D.maxCrust, arr[b] + r * 1.5);
    col[b] = t.c;
    if (b > 0) { arr[b - 1] = Math.min(D.maxCrust, arr[b - 1] + r * 0.6); if (!col[b - 1]) col[b - 1] = t.c; }
    if (b < BUCKET_N) { arr[b + 1] = Math.min(D.maxCrust, arr[b + 1] + r * 0.6); if (!col[b + 1]) col[b + 1] = t.c; }
  }

  function fxDebris(st, c, dt, time) {
    var ctx = c.ctx, w = c.w(), h = c.h();
    ctx.clearRect(0, 0, w, h);

    if (!st.deb || st.deb.w !== w || st.deb.h !== h) {
      var P = buildPipe(w, h);
      var half = P.bore / 2, maxCrust = half * 0.9, bs = P.L / BUCKET_N;
      st.deb = {
        w: w, h: h, P: P, half: half, maxCrust: maxCrust, bs: bs,
        crust: [new Float32Array(BUCKET_N + 1), new Float32Array(BUCKET_N + 1)], /* thickness, side 0:+normal 1:-normal */
        ccol: [new Array(BUCKET_N + 1), new Array(BUCKET_N + 1)],                 /* dominant enemy color per bucket */
        parts: [], flow: [],
        rng: seededRng((w * 73856093 ^ h * 19349663 ^ 0x2d2a2d) >>> 0)
      };
      st.deb.unlocked = unlockedDebrisTypes(st);
      for (var fi = 0; fi < 22; fi++) st.deb.flow.push({ s: rndWith(st.deb.rng, 0, P.L), o: rndWith(st.deb.rng, -half * 0.5, half * 0.5), len: rndWith(st.deb.rng, 20, 46) });
      /* pre-seed crust to scroll progress, so a mid-act jump still shows
         the buildup story so far (heaviest near each enemy's home) */
      var seed = Math.floor(smooth(st.p) * 160);
      for (var sd = 0; sd < seed; sd++) {
        var ty0 = DEB_TYPES[(st.deb.rng() * st.deb.unlocked) | 0];
        var ss = clamp(0, P.L, (ty0.hs + rndWith(st.deb.rng, -0.08, 0.08)) * P.L);
        depositDebris(st.deb, ss, st.deb.rng() < 0.5 ? 0 : 1, ty0, rndWith(st.deb.rng, 2.2, 4.4));
      }
      for (var ip = 0; ip < 26; ip++) spawnPart(st.deb, null);
    }
    var D = st.deb, P = D.P, half = D.half;
    D.unlocked = unlockedDebrisTypes(st);
    function bkt(s) { return Math.max(0, Math.min(BUCKET_N, (s / D.bs) | 0)); }
    function crustAt(side, s) { return D.crust[side][bkt(s)]; }
    function openAt(s) { return Math.max(12, (half - crustAt(0, s)) + (half - crustAt(1, s))); }
    function flowSpeed(s) { return clamp(1, 3.2, P.bore / openAt(s)); }
    /* elbow proximity 0..1 (higher = nearer a bend) boosts deposition -
       real systems clog at the bends first */
    function elbowBoost(s) {
      var best = 0;
      for (var e = 1; e < P.cum.length - 1; e++) {
        var f = 1 - Math.abs(s - P.cum[e]) / (P.bore * 1.7);
        if (f > best) best = f;
      }
      return best < 0 ? 0 : best;
    }

    /* ---- casing: outer wall, dark bore, flanged elbows (not clipped) ---- */
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = P.bore + 10; strokePipe(ctx, P);
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = P.bore + 2;  strokePipe(ctx, P);
    ctx.strokeStyle = "rgba(8,10,14,0.55)";     ctx.lineWidth = P.bore;      strokePipe(ctx, P);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (var jt = 1; jt < P.pts.length - 1; jt++) {
      var pj = P.pts[jt];
      ctx.fillRect(pj.x - (half + 7), pj.y - 5, P.bore + 14, 10);
      ctx.fillRect(pj.x - 5, pj.y - (half + 7), 10, P.bore + 14);
    }

    /* ---- clip moving parts to the pipe interior (offset polygon) ---- */
    ctx.save();
    ctx.beginPath();
    for (var lp = 0; lp < P.pts.length; lp++) {
      var sgl = P.segs[Math.min(lp, P.segs.length - 1)];
      var lx = P.pts[lp].x + sgl.nx * half, ly = P.pts[lp].y + sgl.ny * half;
      lp === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly);
    }
    for (var rp = P.pts.length - 1; rp >= 0; rp--) {
      var sgr = P.segs[Math.min(rp, P.segs.length - 1)];
      ctx.lineTo(P.pts[rp].x - sgr.nx * half, P.pts[rp].y - sgr.ny * half);
    }
    ctx.closePath(); ctx.clip();

    /* flow streaks: faster where the bore is choked */
    ctx.strokeStyle = "rgba(244,246,248,0.12)"; ctx.lineWidth = 1.2;
    for (var f = 0; f < D.flow.length; f++) {
      var fl = D.flow[f];
      fl.s += (0.9 + flowSpeed(fl.s)) * dt * 60;
      if (fl.s > P.L) { fl.s = rnd(0, 30); fl.o = rnd(-half * 0.5, half * 0.5); }
      var a0 = atS(P, fl.s - fl.len), a1 = atS(P, fl.s);
      ctx.beginPath();
      ctx.moveTo(a0.x + a0.nx * fl.o, a0.y + a0.ny * fl.o);
      ctx.lineTo(a1.x + a1.nx * fl.o, a1.y + a1.ny * fl.o);
      ctx.stroke();
    }

    /* spawn + advect debris down the run */
    var stickBase = 0.02 + st.p * 0.10;
    while (D.parts.length < 30) spawnPart(D, null);
    ctx.globalAlpha = 0.9;
    for (var k = D.parts.length - 1; k >= 0; k--) {
      var d = D.parts[k];
      var here = atS(P, d.s);
      d.s += d.v * flowSpeed(d.s) * dt * 60;
      if (d.s > P.L) { D.parts.splice(k, 1); continue; }
      /* gravity (projected onto the segment normal) pulls toward the
         down-wall; add a little jitter */
      d.o += here.gp * 0.5 + Math.sin(time * 1.2 + d.s * 0.05) * 0.18;
      var side = d.o >= 0 ? 0 : 1;
      var openSide = half - crustAt(side, d.s);
      if (d.o > openSide) d.o = openSide; if (d.o < -(half - crustAt(1, d.s))) d.o = -(half - crustAt(1, d.s));
      var homeNear = 1 - Math.min(1, Math.abs(d.s / P.L - d.t.hs) * 2.2);
      var stickP = homeNear < 0.18 ? 0 : stickBase * (0.5 + elbowBoost(d.s) * 1.8) * (homeNear * homeNear);
      if (Math.abs(d.o) > (half - crustAt(side, d.s)) - 3 && Math.random() < stickP) {
        depositDebris(D, d.s, side, d.t, d.r);
        D.parts.splice(k, 1); continue;
      }
      ctx.fillStyle = "rgb(" + d.t.c + ")";
      ctx.beginPath(); ctx.arc(here.x + here.nx * d.o, here.y + here.ny * d.o, d.r, 0, 6.2832); ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    /* Wall deposits sit on the pipe surface, not inside the flow channel. */
    drawCrustPatches(ctx, D);
  }

  function drawCrustPatches(ctx, D) {
    var P = D.P, half = D.half, bs = D.bs;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var side = 0; side < 2; side++) {
      var sign = side === 0 ? 1 : -1, arr = D.crust[side], col = D.ccol[side];
      for (var b = 0; b < BUCKET_N; b += 2) {
        var t = (arr[b] + arr[b + 1]) * 0.5;
        if (t < 0.6) continue;
        var s0 = b * bs, s1 = Math.min(P.L, (b + 1.35) * bs);
        var a0 = atS(P, s0), a1 = atS(P, s1);
        var width = clamp(3.2, half * 0.38, t * 0.72);
        var inset = half + width * 0.06;
        ctx.globalAlpha = clamp(0.28, 0.82, 0.28 + t / D.maxCrust * 0.54);
        ctx.strokeStyle = "rgb(" + (col[b] || col[b + 1] || "201,212,208") + ")";
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(a0.x + a0.nx * sign * inset, a0.y + a0.ny * sign * inset);
        ctx.lineTo(a1.x + a1.nx * sign * inset, a1.y + a1.ny * sign * inset);
        ctx.stroke();
        if (b % 6 === 0) {
          var m = atS(P, (s0 + s1) * 0.5);
          ctx.beginPath();
          ctx.arc(m.x + m.nx * sign * inset, m.y + m.ny * sign * inset, Math.max(1.6, width * 0.42), 0, 6.2832);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* Legacy filled-band renderer. The live scene uses drawCrustPatches above:
     wall deposits read as buildup, while this filled band made triangular sheets.
     closes toward the chokes. One quad per bucket, colored by the enemy
     that built it. */
  function drawCrust(ctx, D) {
    var P = D.P, half = D.half, bs = D.bs;
    for (var side = 0; side < 2; side++) {
      var sign = side === 0 ? 1 : -1, arr = D.crust[side], col = D.ccol[side];
      for (var b = 0; b < BUCKET_N; b++) {
        var t0 = arr[b], t1 = arr[b + 1];
        if (t0 < 0.6 && t1 < 0.6) continue;
        var a0 = atS(P, b * bs), a1 = atS(P, (b + 1) * bs);
        ctx.fillStyle = "rgb(" + (col[b] || "201,212,208") + ")";
        ctx.beginPath();
        ctx.moveTo(a0.x + a0.nx * sign * half, a0.y + a0.ny * sign * half);
        ctx.lineTo(a0.x + a0.nx * sign * (half - t0), a0.y + a0.ny * sign * (half - t0));
        ctx.lineTo(a1.x + a1.nx * sign * (half - t1), a1.y + a1.ny * sign * (half - t1));
        ctx.lineTo(a1.x + a1.nx * sign * half, a1.y + a1.ny * sign * half);
        ctx.closePath();
        ctx.fill();
      }
    }
    /* darken the inner lip for depth */
    ctx.strokeStyle = "rgba(8,10,14,0.5)"; ctx.lineWidth = 1.5;
    for (var sd = 0; sd < 2; sd++) {
      var sg = sd === 0 ? 1 : -1, a = D.crust[sd];
      ctx.beginPath();
      var started = false;
      for (var bb = 0; bb <= BUCKET_N; bb++) {
        if (a[bb] < 0.6) { started = false; continue; }
        var pp = atS(P, bb * bs);
        var ix = pp.x + pp.nx * sg * (half - a[bb]), iy = pp.y + pp.ny * sg * (half - a[bb]);
        started ? ctx.lineTo(ix, iy) : ctx.moveTo(ix, iy);
        started = true;
      }
      ctx.stroke();
    }
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

  var FX = { fumes: fxFumes, debris: fxDebris, motes: fxMotes };
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
      if (st.fx && (st.active || st.i === visibleActIndex)) st.fx.draw(st, st.fx.c, dt, time);
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
      if (states[k].stage) gsap.set(states[k].stage, { autoAlpha: k === idx ? 1 : 0 });
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
