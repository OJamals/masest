/* ============================================================
   MASEST / VertKleen — Scrollytelling engine v5
   NATIVE browser scroll. One GSAP timeline per act, driven by
   ScrollTrigger scrub (the single smoothing layer — no Lenis,
   no wheel multipliers, no custom damping). Wheel feel is the
   browser's own; animations catch up over ~0.5s.
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
  story.classList.add("story-ready");

  var clamp = gsap.utils.clamp;
  var smooth = function (t) { t = clamp(0, 1, t); return t * t * (3 - 2 * t); };

  /* ============================================================
     ACTS: each gets one timeline, scrubbed by its own scroll
     road. Beats are timeline positions (1 beat = 1 time unit):
     data-at="n" enters at beat n; data-out="m" exits at beat m.
     A 1.2-unit hold keeps the finished composition on stage
     until the act unpins and slides away naturally.
     ============================================================ */
  var BEAT_IN = 0.65, BEAT_OUT = 0.25, HOLD = 1.65;
  var acts = gsap.utils.toArray(story.querySelectorAll(".act"));
  var firstAct = acts[0];

  var states = acts.map(function (act, i) {
    var maxAt = 0;
    var els = Array.prototype.slice.call(act.querySelectorAll("[data-at]"));
    els.forEach(function (el) {
      el._at = parseInt(el.getAttribute("data-at"), 10) || 0;
      el._out = el.hasAttribute("data-out") ? parseInt(el.getAttribute("data-out"), 10) : -1;
      if (el._at > maxAt) maxAt = el._at;
      if (el._out > maxAt) maxAt = el._out;
    });
    return { act: act, stage: act.querySelector(".stage"), i: i, p: 0, active: false, fx: null, maxAt: maxAt, els: els, T: maxAt + BEAT_IN + HOLD };
  });

  function syncStoryFocus() {
    states.forEach(function (st) {
      var visible = st.active || st.act === firstAct && window.scrollY < st.act.offsetHeight;
      var focusables = st.act.querySelectorAll("a[href], button, input, select, textarea, [tabindex]");
      st.act.setAttribute("aria-hidden", visible ? "false" : "true");
      focusables.forEach(function (el) {
        if (!el.dataset.storyTabindexSet) {
          el.dataset.storyTabindexSet = "1";
          el.dataset.storyTabindex = el.getAttribute("tabindex") || "";
        }
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
  var startsPinned = st.act === firstAct || st.act.classList.contains("act-chems");
  var tl = gsap.timeline({
    defaults: { ease: "power2.out" },
    scrollTrigger: {
      trigger: st.act,
      start: startsPinned ? "top 67px" : "top bottom",
        end: "bottom bottom",
        scrub: 0.5,
        onEnter: function () { if (st.stage) gsap.set(st.stage, { autoAlpha: 1 }); },
        onEnterBack: function () { if (st.stage) gsap.set(st.stage, { autoAlpha: 1 }); },
        onLeave: function () { if (st.stage) gsap.set(st.stage, { autoAlpha: 0 }); },
        onLeaveBack: function () { if (st.stage) gsap.set(st.stage, { autoAlpha: 1 }); },
        onToggle: function (self) {
          st.active = self.isActive;
          if (self.isActive) resizeFx(st);
          updateRail();
          syncStoryFocus();
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
  var cue = story.querySelector(".scroll-cue");

  function onActScrub(st) {
    updateBd(st);
    if (st.i === 0) {
      updateReel(st);
      if (cue) cue.style.opacity = Math.max(0, 1 - st.p * 8);
    }
    if (st.act === chemAct) updateChems(st);
  }

  /* Backdrop parallax */
  function updateBd(st) {
    var img = st.bd === undefined ? (st.bd = st.act.querySelector(".bd")) : st.bd;
    if (!img) return;
    img.style.transform = "translateY(" + ((st.p - 0.5) * -36) + "px) scale(" + (1.06 - st.p * 0.04) + ")";
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
    if (reelIdx && current !== reelCur) { reelCur = current; reelIdx.textContent = (current + 1) + " / " + n; }
  }

  /* ---- ACT 4: chemical dots land with their cards, then zero ---- */
  var chemAct = story.querySelector(".act-chems");
  var chemScale = chemAct ? chemAct.querySelector(".chem-scale") : null;
  var cdots = chemAct ? gsap.utils.toArray(chemAct.querySelectorAll(".cdot")) : [];

  function updateChems(st) {
    if (!cdots.length) return;
    var z = smooth((st.p - beatFrac(st, 6)) / INW(st));
    for (var k = 0; k < cdots.length; k++) {
      var inT = smooth((st.p - beatFrac(st, k + 1)) / INW(st));
      cdots[k].style.opacity = inT;
      cdots[k].style.setProperty("--v", 3 * (1 - z));
    }
    if (chemScale) chemScale.classList.toggle("safe", z > 0.12);
  }

  /* ============================================================
     CANVAS SYSTEMS (ambient physics on gsap.ticker; scroll only
     sets intensity via st.p — never blocks or smooths input)
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
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  /* --- ACT 2: DEBRIS — carried by flow, sticking to the pipe walls ---
     Four debris types claim four wall regions, matching the chips:
     scale (top-left), rust (bottom-left), grease (top-right), biofilm
     (bottom-right). Crust accumulates; the channel visibly narrows
     and the flow speeds up through the choke (continuity). */
  var DEB_TYPES = [
    { c: "201,212,208", wall: 0, x0: 0.08, x1: 0.44 },  /* scale  */
    { c: "156,74,45",  wall: 1, x0: 0.10, x1: 0.48 },   /* rust   */
    { c: "169,138,63", wall: 0, x0: 0.54, x1: 0.92 },   /* grease */
    { c: "93,138,82",  wall: 1, x0: 0.52, x1: 0.90 }    /* biofilm*/
  ];
  var BUCKET = 14;

  function fxDebris(st, c, dt, time) {
    var ctx = c.ctx, w = c.w(), h = c.h();
    ctx.clearRect(0, 0, w, h);
    var topY = h * 0.58, botY = h * 0.88;       /* pipe sits in the lower third, clear of the copy */
    var px0 = w * 0.10, px1 = w * 0.95;          /* inset pipe segment, clear of the chapter rail */
    var pw = px1 - px0;
    var maxCrust = (botY - topY) * 0.30;
    function bandX(ty) { return [px0 + ty.x0 * pw, px0 + ty.x1 * pw]; }

    if (!st.deb) {
      var nb = Math.ceil(w / BUCKET) + 1;
      st.deb = {
        crust: [new Float32Array(nb), new Float32Array(nb)],
        stuck: [], parts: [], flow: []
      };
      for (var i = 0; i < 26; i++) st.deb.flow.push({ x: rnd(px0, px1), y: rnd(topY + 10, botY - 10), v: rnd(1.4, 2.6), len: rnd(26, 60) });
      /* pre-seed crust to match scroll progress, so a mid-act jump
         (or fast scroll) still shows the buildup story so far */
      var seed = Math.floor(smooth(st.p) * 380);
      for (var sd = 0; sd < seed; sd++) {
        var ty0 = DEB_TYPES[(Math.random() * 4) | 0];
        var bx0 = bandX(ty0);
        var sx = rnd(bx0[0], bx0[1]);
        var arr0 = st.deb.crust[ty0.wall];
        var b0 = (sx / BUCKET) | 0;
        if (b0 < 0 || b0 >= arr0.length) continue;
        var sr = rnd(2.2, 4.6);
        var sy = ty0.wall === 0 ? topY + arr0[b0] + sr * 0.4 : botY - arr0[b0] - sr * 0.4;
        st.deb.stuck.push({ x: sx, y: sy, r: sr, c: ty0.c });
        arr0[b0] = Math.min(maxCrust, arr0[b0] + sr * 0.85);
        if (b0 > 0) arr0[b0 - 1] = Math.min(maxCrust, arr0[b0 - 1] + sr * 0.4);
        if (b0 < arr0.length - 1) arr0[b0 + 1] = Math.min(maxCrust, arr0[b0 + 1] + sr * 0.4);
      }
      /* populate the channel immediately (no empty-pipe cold start) */
      for (var ip = 0; ip < 36; ip++) {
        var ty1 = DEB_TYPES[(Math.random() * 4) | 0];
        st.deb.parts.push({ t: ty1, x: rnd(px0, px1), y: rnd(topY + 14, botY - 14), vx: rnd(1.0, 2.0), vy: 0, r: rnd(2.2, 4.6) });
      }
    }
    var D = st.deb;
    function crustAt(side, x) { return D.crust[side][Math.max(0, Math.min(D.crust[side].length - 1, (x / BUCKET) | 0))]; }

    /* pipe casing: solid walls, soft interior, flanged ends */
    var grad = ctx.createLinearGradient(0, topY, 0, botY);
    grad.addColorStop(0, "rgba(255,255,255,0.07)");
    grad.addColorStop(0.2, "rgba(255,255,255,0.025)");
    grad.addColorStop(0.8, "rgba(255,255,255,0.025)");
    grad.addColorStop(1, "rgba(255,255,255,0.07)");
    ctx.fillStyle = grad;
    ctx.fillRect(px0, topY, pw, botY - topY);
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.fillRect(px0, topY - 4, pw, 4);
    ctx.fillRect(px0, botY, pw, 4);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(px0, topY - 13, pw, 8);
    ctx.fillRect(px0, botY + 5, pw, 8);
    /* flanges */
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(px0 - 7, topY - 20, 7, botY - topY + 40);
    ctx.fillRect(px1, topY - 20, 7, botY - topY + 40);

    /* clip everything moving to the pipe interior */
    ctx.save();
    ctx.beginPath();
    ctx.rect(px0, topY, pw, botY - topY);
    ctx.clip();

    /* flow streaks: confined to the open channel, faster where narrow */
    ctx.strokeStyle = "rgba(244,246,248,0.13)";
    ctx.lineWidth = 1.2;
    for (var f = 0; f < D.flow.length; f++) {
      var fl = D.flow[f];
      var cT = crustAt(0, fl.x), cB = crustAt(1, fl.x);
      var open = (botY - cB) - (topY + cT);
      var speedUp = clamp(1, 3, (botY - topY) / Math.max(40, open));
      fl.x += fl.v * speedUp * dt * 60;
      if (fl.x - fl.len > px1) { fl.x = px0 - fl.len + 10; fl.y = rnd(topY + 10, botY - 10); }
      var yC = clamp(topY + cT + 6, botY - cB - 6, fl.y + Math.sin(time * 1.3 + fl.x * 0.01) * 4);
      ctx.beginPath(); ctx.moveTo(fl.x - fl.len, yC); ctx.lineTo(fl.x, yC); ctx.stroke();
    }

    /* spawn + advect debris */
    var stickP = 0.03 + st.p * 0.16;
    while (D.parts.length < 44) {
      var ty = DEB_TYPES[(Math.random() * 4) | 0];
      D.parts.push({ t: ty, x: px0 + rnd(-50, -6), y: rnd(topY + 14, botY - 14), vx: rnd(1.0, 2.0), vy: 0, r: rnd(2.2, 4.6) });
    }
    for (var k = D.parts.length - 1; k >= 0; k--) {
      var d = D.parts[k];
      var wallY = d.t.wall === 0 ? topY + crustAt(0, d.x) : botY - crustAt(1, d.x);
      var bx = bandX(d.t);
      var inBand = d.x > bx[0] && d.x < bx[1];
      /* steer toward home wall while in its band; drift otherwise */
      d.vy += inBand ? (wallY - d.y) * 0.0024 : Math.sin(time + d.x * 0.02) * 0.004;
      d.vy *= 0.97;
      d.x += d.vx * dt * 60; d.y += d.vy * dt * 60;
      d.y = clamp(topY + 3, botY - 3, d.y);
      if (d.x > px1 + 20) { D.parts.splice(k, 1); continue; }
      /* stick when touching the crust surface inside the band */
      if (inBand && Math.abs(d.y - wallY) < 5 && Math.random() < stickP) {
        if (D.stuck.length < 1000) {
          D.stuck.push({ x: d.x, y: wallY + (d.t.wall === 0 ? d.r * 0.4 : -d.r * 0.4), r: d.r, c: d.t.c });
          var b = (d.x / BUCKET) | 0;
          var arr = D.crust[d.t.wall];
          if (b >= 0 && b < arr.length) {
            arr[b] = Math.min(maxCrust, arr[b] + d.r * 0.85);
            if (b > 0) arr[b - 1] = Math.min(maxCrust, arr[b - 1] + d.r * 0.4);
            if (b < arr.length - 1) arr[b + 1] = Math.min(maxCrust, arr[b + 1] + d.r * 0.4);
          }
        }
        D.parts.splice(k, 1);
        continue;
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgb(" + d.t.c + ")";
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.fill();
    }

    /* accumulated crust: one batched path per debris color */
    ctx.globalAlpha = 0.92;
    for (var t = 0; t < DEB_TYPES.length; t++) {
      var col = DEB_TYPES[t].c;
      ctx.fillStyle = "rgb(" + col + ")";
      ctx.beginPath();
      for (var s = 0; s < D.stuck.length; s++) {
        var q = D.stuck[s];
        if (q.c !== col) continue;
        ctx.moveTo(q.x + q.r, q.y);
        ctx.arc(q.x, q.y, q.r, 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* --- ACT 5: clean teal motes drifting up --- */
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

  /* Ambient canvas loop: draws only the act on stage */
  gsap.ticker.add(function (time, deltaMS) {
    var dt = Math.min(deltaMS / 1000, 0.05);
    for (var i = 0; i < states.length; i++) {
      var st = states[i];
      if (st.fx && st.active) st.fx.draw(st, st.fx.c, dt, time);
    }
  });

  /* ============================================================
     CHAPTER RAIL
     ============================================================ */
  var railBtns = Array.prototype.slice.call(story.querySelectorAll(".rail-btn"));
  railBtns.forEach(function (btn, i) {
    btn.addEventListener("click", function () {
      var target = acts[i];
      if (!target) return;
      var top = target.getBoundingClientRect().top + window.scrollY;
      var y = top + (target.offsetHeight - window.innerHeight) * 0.5;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  });
  var railCurrent = -1;
  var railTicking = false;
  function nearestRailIndex() {
    var y = window.scrollY + window.innerHeight * 0.5;
    var current = 0;
    var best = Infinity;
    for (var i = 0; i < states.length; i++) {
      var top = states[i].act.getBoundingClientRect().top + window.scrollY;
      var mid = top + states[i].act.offsetHeight * 0.5;
      var dist = Math.abs(y - mid);
      if (dist < best) {
        best = dist;
        current = i;
      }
    }
    return current;
  }
  function updateRail() {
    if (!railBtns.length) return;
    var current = -1;
    for (var i = 0; i < states.length; i++) if (states[i].active) { current = i; }
    if (current < 0) current = nearestRailIndex();
    if (current === railCurrent) return;
    railCurrent = current;
    for (var j = 0; j < railBtns.length; j++) {
      railBtns[j].classList.toggle("is-on", j === current);
      railBtns[j].classList.toggle("safe", current === states.length - 1);
    }
  }
  function scheduleRailUpdate() {
    if (railTicking) return;
    railTicking = true;
    requestAnimationFrame(function () {
      railTicking = false;
      updateRail();
      syncStoryFocus();
    });
  }
  window.addEventListener("scroll", scheduleRailUpdate, { passive: true });
  updateRail();
  syncStoryFocus();

  /* Paint the opening act at rest so the first field photo and the
     parallax backdrop are visible on load, before any scroll — without
     this the reel sits at its CSS opacity:0 until the first scroll. */
  if (states[0]) { states[0].p = 0; onActScrub(states[0]); }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { states.forEach(resizeFx); }, 150);
  });
})();
