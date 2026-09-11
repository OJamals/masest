/*
 * MASEST landing field-result story.
 * Native page scroll selects six R2-backed image pairs. GSAP maps desktop
 * scene progress to the reveal; a native range input can override every pair.
 */
(function () {
  "use strict";

  var story = document.getElementById("story");
  if (!story) return;

  var acts = Array.prototype.slice.call(story.querySelectorAll(".act"));
  var railLinks = Array.prototype.slice.call(story.querySelectorAll(".rail-btn"));
  var storyActions = story.querySelector(".story-actions");
  var actionContext = story.querySelector(".story-actions__match small");
  var actionProduct = story.querySelector(".story-actions__match b");
  var shopAction = story.querySelector(".story-actions__shop");
  var trialAction = story.querySelector(".story-actions__trial");
  var objectCard = story.querySelector(".story-object__card");
  var comparisonMedia = story.querySelector(".story-object__media");
  var beforeImage = story.querySelector(".story-object__before");
  var afterImage = story.querySelector(".story-object__after img");
  var comparisonRange = story.querySelector(".story-object__range");
  var objectStatus = story.querySelector(".story-object__status");
  var objectTitle = story.querySelector("#storyObjectTitle");
  var objectDetail = story.querySelector("#storyObjectDetail");
  var productImage = story.querySelector(".story-object__product img");
  var productName = story.querySelector(".story-object__product b");
  var mediaQuery = window.matchMedia("(max-width: 760px)");
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = motionQuery.matches;
  var compact = mediaQuery.matches;
  var activeState = null;
  var scrollFrame = 0;
  var mediaRequest = 0;
  var teardownMode = function () {};
  var imageLoads = new Map();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function imageConfig(dataset, prefix) {
    return {
      src: dataset[prefix + "Src"],
      width: number(dataset[prefix + "Width"], 1),
      height: number(dataset[prefix + "Height"], 1),
      position: dataset[prefix + "Position"] || "50% 50%",
      scale: number(dataset[prefix + "Scale"], 1),
      rotate: number(dataset[prefix + "Rotate"], 0)
    };
  }

  function sceneConfig(act) {
    var dataset = act.dataset;
    return {
      id: dataset.scene,
      before: imageConfig(dataset, "before"),
      after: imageConfig(dataset, "after"),
      title: dataset.objectTitle,
      detail: dataset.objectDetail,
      status: dataset.status,
      actionContext: dataset.actionContext,
      product: {
        name: dataset.productName,
        short: dataset.productShort,
        href: dataset.productHref,
        trialHref: dataset.trialHref,
        src: dataset.productSrc,
        width: number(dataset.productWidth, 1),
        height: number(dataset.productHeight, 1)
      }
    };
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
      config: sceneConfig(act),
      manualReveal: null,
      elements: Array.prototype.slice.call(act.querySelectorAll("[data-at]")),
      focusables: focusables,
      timeline: null
    };
  });

  function stateById(id) {
    for (var i = 0; i < states.length; i += 1) {
      if (states[i].config.id === id) return states[i];
    }
    return states[0];
  }

  function preloadImage(src) {
    if (!src) return Promise.resolve(false);
    if (imageLoads.has(src)) return imageLoads.get(src);
    var load = new Promise(function (resolveLoad) {
      var image = new Image();
      image.decoding = "async";
      image.onload = function () { resolveLoad(true); };
      image.onerror = function () { resolveLoad(false); };
      image.src = src;
      if (image.complete && image.naturalWidth) resolveLoad(true);
    });
    imageLoads.set(src, load);
    return load;
  }

  function setImage(image, config) {
    if (!image || !config.src) return;
    if (image.getAttribute("src") !== config.src) image.setAttribute("src", config.src);
    image.setAttribute("width", String(config.width));
    image.setAttribute("height", String(config.height));
  }

  function applySceneStyles(st) {
    var config = st.config;
    comparisonMedia.style.setProperty("--story-before-position", config.before.position);
    comparisonMedia.style.setProperty("--story-before-scale", String(config.before.scale));
    comparisonMedia.style.setProperty("--story-after-position", config.after.position);
    comparisonMedia.style.setProperty("--story-after-scale", String(config.after.scale));
    comparisonMedia.style.setProperty("--story-after-rotate", config.after.rotate + "deg");
  }

  function applySceneMetadata(st) {
    var config = st.config;
    objectStatus.textContent = config.status;
    objectTitle.textContent = config.title;
    objectDetail.textContent = config.detail;
    productName.textContent = config.product.name;
    actionContext.textContent = config.actionContext;
    actionProduct.textContent = config.product.name;
    shopAction.href = config.product.href;
    shopAction.textContent = "Shop " + config.product.short;
    shopAction.setAttribute("aria-label", "Shop " + config.product.name);
    trialAction.href = config.product.trialHref;
    trialAction.setAttribute("aria-label", "Try " + config.product.name + " on my cleaning job");
  }

  function waitForSceneFade() {
    if (reduce) return Promise.resolve();
    return new Promise(function (resolveFade) {
      window.requestAnimationFrame(function () {
        window.setTimeout(resolveFade, 180);
      });
    });
  }

  function activateSceneMedia(st) {
    var request = ++mediaRequest;
    var config = st.config;
    var needsSwap = beforeImage.getAttribute("src") !== config.before.src
      || afterImage.getAttribute("src") !== config.after.src;
    applySceneStyles(st);
    applySceneMetadata(st);
    objectCard.classList.toggle("is-swapping", needsSwap);

    Promise.all([
      preloadImage(config.before.src),
      preloadImage(config.after.src),
      preloadImage(config.product.src),
      needsSwap ? waitForSceneFade() : Promise.resolve()
    ]).then(function (loaded) {
      if (request !== mediaRequest || activeState !== st) return;
      if (!loaded[0] || !loaded[1]) {
        objectCard.classList.remove("is-swapping");
        objectCard.classList.add("has-media-error");
        return;
      }
      setImage(beforeImage, config.before);
      setImage(afterImage, config.after);
      if (loaded[2]) setImage(productImage, config.product);
      objectCard.classList.remove("has-media-error");
      window.requestAnimationFrame(function () {
        if (request === mediaRequest) objectCard.classList.remove("is-swapping");
      });
    });
  }

  // Speculative bytes for a scene nobody has scrolled to must never compete with the hero
  // image, which is this page's LCP element. requestIdleCallback's 1200ms timeout fires
  // during load on a slow connection -- "idle" on a busy main thread is not the same as
  // "the network is free" -- so hold the request until load and let the idle scheduling
  // apply unchanged after that. Only the newest scene is held: scrolling through several
  // acts before load must not queue a preload for each one.
  var heldPreload = null;
  function releaseHeldPreload() {
    var run = heldPreload;
    heldPreload = null;
    if (run) run();
  }

  function preloadNextScene(st) {
    var next = states[st.index + 1];
    if (!next) return;
    var preload = function () {
      preloadImage(next.config.before.src);
      preloadImage(next.config.after.src);
      preloadImage(next.config.product.src);
    };
    var schedule = function () {
      if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 1200 });
      else window.setTimeout(preload, 240);
    };
    if (document.readyState === "complete") {
      schedule();
      return;
    }
    if (!heldPreload) window.addEventListener("load", releaseHeldPreload, { once: true });
    heldPreload = schedule;
  }

  function automaticReveal(progress) {
    return 8 + clamp(progress, 0, 1) * 84;
  }

  function setReveal(value) {
    var reveal = Math.round(clamp(number(value, 50), 0, 100));
    comparisonMedia.style.setProperty("--story-reveal", reveal + "%");
    comparisonRange.value = String(reveal);
    comparisonRange.setAttribute("aria-valuetext", reveal + "% after image revealed");
  }

  function renderScene(st) {
    var reveal = st.manualReveal === null ? automaticReveal(st.p) : st.manualReveal;
    setReveal(reveal);
  }

  comparisonRange.addEventListener("input", function () {
    if (!activeState) return;
    activeState.manualReveal = clamp(number(comparisonRange.value, 50), 0, 100);
    renderScene(activeState);
  });

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
    var changed = activeState !== st;
    activeState = st;
    story.dataset.activeScene = st.config.id;
    updateRail(st);
    if (desktop) syncDesktopAccessibility(st);
    if (changed) {
      activateSceneMedia(st);
      preloadNextScene(st);
    }
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
    var presenceFrame = 0;

    function updateStoryExit() {
      presenceFrame = 0;
      if (!storyActions) return;
      var storyBottom = story.getBoundingClientRect().bottom;
      var navHeight = parseFloat(
        window.getComputedStyle(story).getPropertyValue("--story-nav-h")
      ) || 59;
      var actionHeight = storyActions.offsetHeight || 0;
      story.classList.toggle(
        "story-exiting",
        storyBottom <= navHeight + actionHeight * 2
      );
    }

    function scheduleStoryExit() {
      if (presenceFrame) return;
      presenceFrame = window.requestAnimationFrame(updateStoryExit);
    }

    updateStoryExit();
    window.addEventListener("scroll", scheduleStoryExit, { passive: true });
    window.addEventListener("resize", scheduleStoryExit, { passive: true });

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
    states[0].p = .5;
    activeState = null;
    activateState(states[0], false);
  }

  function initCompactStory() {
    story.classList.remove("story-ready");
    story.classList.add("story-mobile-ready");
    resetStoryPresentation();
    states[0].act.classList.add("is-mobile-visible");
    states[0].p = 0;
    activeState = null;
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
          start: "top center",
          end: "bottom center",
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

    activeState = null;
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
    scenes: states.map(function (st) { return st.config.id; }),
    active: function () { return activeState ? activeState.config.id : null; },
    render: function (sceneId, progress) {
      var st = stateById(sceneId);
      st.p = clamp(progress, 0, 1);
      activateState(st, false);
    },
    reveal: function () { return Number(comparisonRange.value); }
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
