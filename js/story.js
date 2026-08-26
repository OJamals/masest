/*
 * MASEST landing story
 * Native page scroll remains the input. GSAP only maps desktop scroll progress
 * to four small scene renderers. Compact screens use IntersectionObserver.
 */
(function () {
  "use strict";

  var story = document.getElementById("story");
  if (!story) return;

  var acts = Array.prototype.slice.call(story.querySelectorAll(".act"));
  var railLinks = Array.prototype.slice.call(story.querySelectorAll(".rail-btn"));
  var objectStatus = story.querySelector(".story-object__status");
  var mediaQuery = window.matchMedia("(max-width: 760px)");
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = motionQuery.matches;
  var compact = mediaQuery.matches;
  var activeState = null;
  var scrollFrame = 0;
  var teardownMode = function () {};

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setVisualState(config) {
    if (objectStatus && objectStatus.textContent !== config.status) {
      objectStatus.textContent = config.status;
    }
  }

  function renderDiagnose(progress) {
    setVisualState({
      status: "Field condition"
    });
  }

  function renderBurden(progress) {
    setVisualState({
      status: "36-hour attempt · incomplete"
    });
  }

  function renderSwitch(progress) {
    setVisualState({
      status: "Matched to VertKleen HCR"
    });
  }

  function renderProve(progress) {
    var p = clamp(progress, 0, 1);
    setVisualState({
      status: p > .84 ? "Field result" : "Result check"
    });
  }

  var SCENE_DEFS = [
    { id: "diagnose", label: "Diagnose", render: renderDiagnose },
    { id: "burden", label: "Measure the burden", render: renderBurden },
    { id: "switch", label: "Match the cleaner", render: renderSwitch },
    { id: "prove", label: "Prove the result", render: renderProve }
  ];

  function sceneDefinition(id) {
    for (var i = 0; i < SCENE_DEFS.length; i += 1) {
      if (SCENE_DEFS[i].id === id) return SCENE_DEFS[i];
    }
    return SCENE_DEFS[0];
  }

  var states = acts.map(function (act, index) {
    var focusables = Array.prototype.slice.call(
      act.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")
    );
    focusables.forEach(function (element) {
      element.dataset.storyOriginalTabindex = element.getAttribute("tabindex") || "";
      var reveal = element.closest("[data-at]");
      var revealAt = reveal
        ? clamp(parseFloat(reveal.getAttribute("data-at")) || 0, 0, .82)
        : 0;
      element.dataset.storyRevealAt = String(reveal ? Math.min(1, revealAt + .1) : 0);
    });
    return {
      act: act,
      index: index,
      p: 0,
      sceneDef: sceneDefinition(act.dataset.scene),
      elements: Array.prototype.slice.call(act.querySelectorAll("[data-at]")),
      focusables: focusables,
      timeline: null
    };
  });

  function renderScene(st) {
    var sceneDef = st.sceneDef;
    sceneDef.render(st.p, st);
  }

  function restoreFocusable(element) {
    if (element.dataset.storyOriginalTabindex) {
      element.setAttribute("tabindex", element.dataset.storyOriginalTabindex);
    } else {
      element.removeAttribute("tabindex");
    }
  }

  function syncDesktopAccessibility(current) {
    states.forEach(function (st) {
      var visible = st === current;
      st.act.setAttribute("aria-hidden", visible ? "false" : "true");
      st.focusables.forEach(function (element) {
        var revealed = st.p >= Number(element.dataset.storyRevealAt || 0);
        if (visible && revealed) restoreFocusable(element);
        else element.setAttribute("tabindex", "-1");
      });
    });
  }

  function restoreStaticAccessibility() {
    states.forEach(function (st) {
      st.act.removeAttribute("aria-hidden");
      st.focusables.forEach(restoreFocusable);
    });
  }

  function resetStoryPresentation() {
    if (scrollFrame) {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    }
    states.forEach(function (st) {
      st.p = 0;
      st.act.classList.remove("is-mobile-visible");
      st.elements.forEach(function (element) {
        element.style.removeProperty("opacity");
        element.style.removeProperty("visibility");
        element.style.removeProperty("transform");
      });
    });
    restoreStaticAccessibility();
  }

  function updateRail(current) {
    railLinks.forEach(function (link, index) {
      if (index === current.index) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
  }

  function activateState(st, desktop) {
    if (!st) return;
    activeState = st;
    story.dataset.activeScene = st.sceneDef.id;
    updateRail(st);
    if (desktop) syncDesktopAccessibility(st);
    renderScene(st);
  }

  function stateAtViewport() {
    var marker = window.innerHeight * .42;
    var found = states[0];
    states.some(function (st) {
      var rect = st.act.getBoundingClientRect();
      if (rect.top <= marker && rect.bottom >= marker) {
        found = st;
        return true;
      }
      return false;
    });
    return found;
  }

  function storyFillsViewport() {
    var rect = story.getBoundingClientRect();
    return rect.top <= 0 && rect.bottom >= window.innerHeight;
  }

  function initStoryPresence() {
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          document.body.classList.toggle("story-in-view", entry.isIntersecting);
        });
      }, { threshold: 0 });
      observer.observe(story);
      return;
    }

    function updateFallbackPresence() {
      document.body.classList.toggle("story-in-view", storyFillsViewport());
    }
    updateFallbackPresence();
    window.addEventListener("scroll", updateFallbackPresence, { passive: true });
    window.addEventListener("resize", updateFallbackPresence, { passive: true });
  }

  function renderStaticStory() {
    story.classList.remove("story-ready", "story-mobile-ready");
    resetStoryPresentation();
    states.forEach(function (st) {
      st.act.classList.add("is-mobile-visible");
    });
    activeState = states[states.length - 1];
    story.dataset.activeScene = "prove";
    renderProve(1);
  }

  function initCompactStory() {
    story.classList.remove("story-ready");
    story.classList.add("story-mobile-ready");
    resetStoryPresentation();
    states[0].act.classList.add("is-mobile-visible");
    states[0].p = 0;
    activateState(states[0], false);

    var disposed = false;
    var observer = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(function (entries) {
        if (disposed) return;
        var candidate = null;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-mobile-visible");
          var st = states[Number(entry.target.dataset.act) - 1];
          if (!candidate || entry.intersectionRatio > candidate.ratio) {
            candidate = { state: st, ratio: entry.intersectionRatio };
          }
        });
        if (candidate) activateState(candidate.state, false);
      }, {
        root: null,
        rootMargin: "-32% 0px -46% 0px",
        threshold: [0, .08, .3, .65]
      });

      states.forEach(function (st) {
        observer.observe(st.act);
      });
    } else {
      states.forEach(function (st) {
        st.act.classList.add("is-mobile-visible");
      });
    }

    function updateCompactProgress() {
      if (disposed) return;
      scrollFrame = 0;
      var current = stateAtViewport();
      var rect = current.act.getBoundingClientRect();
      var travel = window.innerHeight + rect.height;
      current.p = clamp((window.innerHeight - rect.top) / travel, 0, 1);
      current.act.classList.add("is-mobile-visible");
      if (current !== activeState) activateState(current, false);
      else renderScene(current);
    }

    function onCompactScroll() {
      if (disposed || scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(updateCompactProgress);
    }

    window.addEventListener("scroll", onCompactScroll, { passive: true });
    window.addEventListener("resize", onCompactScroll, { passive: true });
    updateCompactProgress();

    return function () {
      disposed = true;
      observer?.takeRecords();
      observer?.disconnect();
      window.removeEventListener("scroll", onCompactScroll);
      window.removeEventListener("resize", onCompactScroll);
      story.classList.remove("story-mobile-ready");
      resetStoryPresentation();
    };
  }

  function initDesktopStory() {
    var disposed = false;
    var refreshFrame = 0;
    window.gsap.registerPlugin(window.ScrollTrigger);
    window.ScrollTrigger.config({ ignoreMobileResize: true });
    story.classList.remove("story-mobile-ready");
    story.classList.add("story-ready");

    states.forEach(function (st) {
      var timeline = window.gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: st.act,
          start: "top top+=59",
          end: "bottom bottom",
          scrub: .24,
          invalidateOnRefresh: true,
          onEnter: function () { if (!disposed) activateState(st, true); },
          onEnterBack: function () { if (!disposed) activateState(st, true); }
        },
        onUpdate: function () {
          if (disposed) return;
          st.p = timeline.totalProgress();
          if (activeState === st) {
            syncDesktopAccessibility(st);
            renderScene(st);
          }
        }
      });

      st.elements.forEach(function (element) {
        var at = clamp(parseFloat(element.getAttribute("data-at")) || 0, 0, .82);
        if (st.index === 0 && at === 0) {
          window.gsap.set(element, { autoAlpha: 1, y: 0 });
          return;
        }
        timeline.fromTo(
          element,
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: .18 },
          at
        );
      });

      timeline.to({}, { duration: .001 }, 1);
      st.timeline = timeline;
    });

    activateState(stateAtViewport(), true);

    var resizeTimer = 0;
    function onDesktopResize() {
      if (disposed) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        if (disposed) return;
        window.ScrollTrigger.refresh();
        activateState(stateAtViewport(), true);
      }, 120);
    }
    window.addEventListener("resize", onDesktopResize, { passive: true });

    function refreshAfterLayout() {
      if (disposed) return;
      refreshFrame = window.requestAnimationFrame(function () {
        refreshFrame = 0;
        if (disposed) return;
        window.ScrollTrigger.refresh();
        activateState(stateAtViewport(), true);
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", refreshAfterLayout, { once: true });
    } else {
      refreshAfterLayout();
    }
    window.addEventListener("load", refreshAfterLayout, { once: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refreshAfterLayout);
    }

    return function () {
      disposed = true;
      window.clearTimeout(resizeTimer);
      if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
      document.removeEventListener("DOMContentLoaded", refreshAfterLayout);
      window.removeEventListener("load", refreshAfterLayout);
      window.removeEventListener("resize", onDesktopResize);
      states.forEach(function (st) {
        if (!st.timeline) return;
        st.timeline.scrollTrigger?.kill();
        st.timeline.kill();
        st.timeline = null;
      });
      story.classList.remove("story-ready");
      resetStoryPresentation();
    };
  }

  function startStoryMode() {
    teardownMode();
    teardownMode = function () {};
    compact = mediaQuery.matches;
    reduce = motionQuery.matches;

    if (reduce || !window.gsap || !window.ScrollTrigger) {
      renderStaticStory();
      return;
    }

    if (compact) {
      teardownMode = initCompactStory();
      return;
    }

    teardownMode = initDesktopStory();
  }

  window.__MASESTStory = {
    scenes: SCENE_DEFS.map(function (scene) { return scene.id; }),
    active: function () { return activeState ? activeState.sceneDef.id : null; },
    render: function (sceneId, progress) {
      sceneDefinition(sceneId).render(clamp(progress, 0, 1));
    }
  };

  initStoryPresence();

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", startStoryMode);
    motionQuery.addEventListener("change", startStoryMode);
  } else {
    mediaQuery.addListener(startStoryMode);
    motionQuery.addListener(startStoryMode);
  }
  startStoryMode();
})();
