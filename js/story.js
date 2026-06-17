/*
  MASEST / VertKleen scrollybook showpiece
  One pinned GSAP master timeline. Native browser scroll only.
*/
(function () {
  var story = document.getElementById("story");
  if (!story || !window.gsap || !window.ScrollTrigger) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });
  ScrollTrigger.saveStyles(".story-copy, .story-layer, .field-card, .chem-card, .zero-mark b, .story-canvas");

  var motionBudget = story.getAttribute("data-motion-budget") || "balanced";
  var pin = story.querySelector(".story-pin");
  var scroll = story.querySelector(".story-scroll");
  var canvas = story.querySelector(".story-canvas");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var cue = story.querySelector(".scroll-cue");
  var railBtns = gsap.utils.toArray(story.querySelectorAll(".rail-btn"));
  var copies = gsap.utils.toArray(story.querySelectorAll(".story-copy"));
  var layers = gsap.utils.toArray(story.querySelectorAll(".story-layer"));
  var cards = gsap.utils.toArray(story.querySelectorAll(".field-card"));
  var chemCards = gsap.utils.toArray(story.querySelectorAll(".chem-card"));
  var labels = ["field", "buildup", "hmis", "legacy", "zero"];
  var activeLabel = "field";
  var canvasState = { label: "field", progress: 0, safe: 0 };
  var clamp01 = gsap.utils.clamp(0, 1);
  var mapProgress = gsap.utils.mapRange(0, 1, 0, 100);
  var snapProgress = gsap.utils.snap(0.001);
  var mm = gsap.matchMedia();

  if (!pin || !scroll) return;

  story.classList.add("story-ready");

  var railFill = railBtns.map(function (btn) {
    return gsap.quickSetter(btn, "scale", "number");
  });
  var setCueOpacity = cue ? gsap.quickSetter(cue, "opacity") : function () {};

  function layer(name) {
    return story.querySelector('[data-scene="' + name + '"].story-layer');
  }

  function copy(name) {
    return story.querySelector('[data-scene="' + name + '"].story-copy');
  }

  function setActiveLabel(label) {
    if (label === activeLabel) return;
    activeLabel = label;
    canvasState.label = label;
    railBtns.forEach(function (btn) {
      var on = btn.getAttribute("data-story-label") === label;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-current", on ? "step" : "false");
    });
  }

  function nearestLabel(tl) {
    var time = tl.time();
    var best = labels[0];
    var dist = Infinity;
    labels.forEach(function (name) {
      var d = Math.abs(time - tl.labels[name]);
      if (d < dist) {
        dist = d;
        best = name;
      }
    });
    return best;
  }

  function buildMasterTimeline(opts) {
    var isMobile = opts.isMobile;
    var scrub = opts.scrub;
    var tl = gsap.timeline({
      defaults: { duration: 0.72, ease: "power3.out" }
    });

    gsap.set(copies.concat(layers), { autoAlpha: 0, y: 26 });
    gsap.set(cards, { autoAlpha: 0, y: 28, scale: 0.94, rotation: 0 });
    gsap.set(chemCards, { autoAlpha: 0, y: 34, scale: 0.96 });
    gsap.set(".zero-mark b", { y: 34, autoAlpha: 0, scale: 0.82 });
    gsap.set([copy("field"), layer("field")], { autoAlpha: 1, y: 0 });
    gsap.set(cards[0], { autoAlpha: 1, y: 0, scale: 1, rotation: isMobile ? 0 : -3 });

    sceneField(tl, isMobile);
    sceneBuildup(tl, isMobile);
    sceneHmis(tl, isMobile);
    sceneLegacy(tl, isMobile);
    sceneZero(tl, isMobile);
    var majorStops = labels.map(function (name) { return tl.labels[name] / tl.duration(); });
    story.dataset.snapStops = majorStops.map(function (stop) { return stop.toFixed(3); }).join(",");
    ScrollTrigger.create({
      id: "story-master",
      trigger: scroll,
      animation: tl,
      pin: pin,
      start: "top top",
      end: function () { return "+=" + Math.round(window.innerHeight * (isMobile ? 5.6 : 6.4)); },
      scrub: scrub,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: function (self) {
        canvasState.progress = snapProgress(self.progress);
        setCueOpacity(Math.max(0, 1 - self.progress * 12));
        setActiveLabel(nearestLabel(tl));
        updateRail(tl);
      },
      onScrubComplete: function () {
        setActiveLabel(nearestLabel(tl));
        updateRail(tl);
      }
    });

    return tl;
  }

  function showCopy(tl, name, at) {
    tl.to(copy(name), { autoAlpha: 1, y: 0, duration: 0.56 }, at);
  }

  function hideCopy(tl, name, at) {
    tl.to(copy(name), { autoAlpha: 0, y: -22, duration: 0.38, ease: "power2.in" }, at);
  }

  function sceneField(tl, isMobile) {
    tl.addLabel("field", 0);
    tl.set([copy("field"), layer("field")], { autoAlpha: 1, y: 0 }, "field");
    tl.to(cards, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      rotation: function (i) { return isMobile ? 0 : [-3, 2, -1, 3][i]; },
      stagger: 0.1,
      duration: 0.72
    }, "field+=0.12");
    tl.to(cards, {
      xPercent: function (i) { return isMobile ? 0 : [-10, 4, -4, 9][i]; },
      yPercent: function (i) { return isMobile ? i * 4 : [-8, 5, 11, -2][i]; },
      scale: function (i) { return i === 0 ? 1 : 0.92; },
      autoAlpha: function (i) { return i === 0 ? 1 : 0.7; },
      stagger: 0.04,
      duration: 0.9
    }, "field+=0.72");
    tl.to({}, { duration: 0.36, onStart: function () { canvasState.safe = 0; } }, "field+=0.2");
  }

  function sceneBuildup(tl, isMobile) {
    tl.addLabel("buildupIntro", 1.45);
    hideCopy(tl, "field", "buildupIntro-=0.34");
    tl.to(layer("field"), { autoAlpha: 0, scale: 0.92, x: isMobile ? 0 : -80, duration: 0.5 }, "buildupIntro-=0.28");
    showCopy(tl, "buildup", "buildupIntro");
    tl.to(layer("buildup"), { autoAlpha: 1, y: 0, duration: 0.62 }, "buildupIntro+=0.06");
    tl.fromTo(".pipe-run", { scale: 0.86, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.62 }, "buildupIntro+=0.1");
    tl.fromTo(".clog", { autoAlpha: 0, y: 18, scale: 0.86 }, { autoAlpha: 1, y: 0, scale: 1, stagger: 0.1, duration: 0.48 }, "buildupIntro+=0.42");
    tl.addLabel("buildup", "buildupIntro+=0.88");
  }

  function sceneHmis(tl, isMobile) {
    tl.addLabel("hmisIntro", 2.85);
    hideCopy(tl, "buildup", "hmisIntro-=0.34");
    tl.to(layer("buildup"), { autoAlpha: 0, scale: 0.92, x: isMobile ? 0 : 70, duration: 0.5 }, "hmisIntro-=0.28");
    showCopy(tl, "hmis", "hmisIntro");
    tl.to(layer("hmis"), { autoAlpha: 1, y: 0, duration: 0.62 }, "hmisIntro+=0.05");
    tl.fromTo(".hmis-needle", { rotation: -118 }, { rotation: 54, duration: 0.86, ease: "power3.inOut" }, "hmisIntro+=0.18");
    tl.fromTo(".hmis-bars i", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, stagger: 0.11, duration: 0.52 }, "hmisIntro+=0.28");
    tl.addLabel("hmis", "hmisIntro+=0.9");
  }

  function sceneLegacy(tl, isMobile) {
    tl.addLabel("legacyIntro", 4.2);
    hideCopy(tl, "hmis", "legacyIntro-=0.34");
    tl.to(layer("hmis"), { autoAlpha: 0, scale: 0.94, x: isMobile ? 0 : -70, duration: 0.5 }, "legacyIntro-=0.28");
    showCopy(tl, "legacy", "legacyIntro");
    tl.to(layer("legacy"), { autoAlpha: 1, y: 0, duration: 0.58 }, "legacyIntro+=0.05");
    tl.to(chemCards, { autoAlpha: 1, y: 0, scale: 1, stagger: 0.1, duration: 0.48 }, "legacyIntro+=0.22");
    tl.to(".chem-card", { boxShadow: "0 30px 80px -50px rgba(255,118,95,.85)", stagger: 0.06, duration: 0.38 }, "legacyIntro+=0.64");
    tl.addLabel("legacy", "legacyIntro+=0.92");
  }

  function sceneZero(tl, isMobile) {
    tl.addLabel("zeroIntro", 5.72);
    hideCopy(tl, "legacy", "zeroIntro-=0.36");
    tl.to(layer("legacy"), { autoAlpha: 0, y: 28, scale: 0.9, duration: 0.46 }, "zeroIntro-=0.3");
    showCopy(tl, "zero", "zeroIntro");
    tl.to(layer("zero"), { autoAlpha: 1, y: 0, duration: 0.54 }, "zeroIntro+=0.05");
    tl.to(".zero-mark b", { autoAlpha: 1, y: 0, scale: 1, stagger: 0.08, duration: 0.48, ease: "power4.out" }, "zeroIntro+=0.12");
    tl.fromTo(".proof-strip figure", { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.42 }, "zeroIntro+=0.38");
    tl.fromTo(".savior-procurement, .savior-ctas", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.42 }, "zeroIntro+=0.62");
    tl.to(canvasState, { safe: 1, duration: 0.75, ease: "power2.out" }, "zeroIntro+=0.05");
    tl.addLabel("zero", "zeroIntro+=1.08");
  }

  function updateRail(tl) {
    var duration = tl.duration() || 1;
    var percent = mapProgress(tl.time() / duration);
    labels.forEach(function (label, i) {
      var next = labels[i + 1] ? tl.labels[labels[i + 1]] : duration;
      var current = tl.labels[label];
      var local = clamp01((tl.time() - current) / Math.max(0.001, next - current));
      railFill[i](1 + local * 0.08);
    });
    story.style.setProperty("--story-progress", percent.toFixed(2));
  }

  function setupCanvas() {
    if (!canvas || !ctx) return function () {};
    var dpr = 1;
    function resize() {
      var nextDpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.2 : 1.45);
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width * nextDpr));
      var h = Math.max(1, Math.round(rect.height * nextDpr));
      if (canvas.width !== w || canvas.height !== h || dpr !== nextDpr) {
        dpr = nextDpr;
        canvas.width = w;
        canvas.height = h;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    resize();
    return resize;
  }

  function drawCanvas(time) {
    if (!ctx || !canvasState.label) return;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    var safe = canvasState.safe;
    var redAlpha = 0.16 * (1 - safe);
    var safeAlpha = 0.2 + safe * 0.26;
    drawCurrent(w, h, time, "rgba(255,118,95," + redAlpha.toFixed(3) + ")", -1);
    drawCurrent(w, h, time * 0.82, "rgba(9,166,149," + safeAlpha.toFixed(3) + ")", 1);
  }

  function drawCurrent(w, h, time, stroke, dir) {
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = stroke;
    for (var i = 0; i < 18; i++) {
      var y = (h * (i + 1)) / 19;
      var drift = Math.sin(time * 0.45 + i * 0.7) * 24 * dir;
      ctx.beginPath();
      ctx.moveTo(-60, y + drift);
      for (var x = -60; x <= w + 80; x += 90) {
        var wave = Math.sin(x * 0.009 + time + i) * 18;
        ctx.lineTo(x, y + wave + drift);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function bindRail(tl) {
    railBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var label = btn.getAttribute("data-story-label");
        var st = tl.scrollTrigger;
        if (!st || !(label in tl.labels)) return;
        var ratio = tl.labels[label] / tl.duration();
        var top = st.start + (st.end - st.start) * ratio;
        window.scrollTo({ top: top });
      });
    });
  }

  var resizeCanvas = setupCanvas();

  mm.add({
    isDesktop: "(min-width: 901px)",
    isMobile: "(max-width: 900px)",
    reduceMotion: "(prefers-reduced-motion: reduce)"
  }, function (context) {
    if (context.conditions.reduceMotion) return;
    story.dataset.motionActive = motionBudget;
    var tl = buildMasterTimeline({
      isMobile: context.conditions.isMobile,
      scrub: motionBudget === "lean" ? 0.34 : 0.64
    });
    bindRail(tl);
    return function () {
      tl.kill();
    };
  });

  gsap.ticker.add(drawCanvas);
  window.addEventListener("resize", function () {
    resizeCanvas();
    ScrollTrigger.refresh();
  }, { passive: true });
})();
