/*
  Lightweight story polish:
  marks the chapter closest to the viewport center so CSS can render
  a single persistent chapter watermark during scrub gaps.
*/
(function () {
  var story = document.getElementById("story");
  if (!story || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var acts = Array.prototype.slice.call(story.querySelectorAll(".act"));
  if (!acts.length) return;

  var ticking = false;

  function updateCurrentAct() {
    ticking = false;

    var target = window.innerHeight * 0.52;
    var current = 0;
    var best = Infinity;

    acts.forEach(function (act, index) {
      var rect = act.getBoundingClientRect();
      var center = rect.top + rect.height * 0.5;
      var distance = Math.abs(center - target);

      if (rect.top <= target && rect.bottom >= target) {
        distance *= 0.25;
      }

      if (distance < best) {
        best = distance;
        current = index;
      }
    });

    acts.forEach(function (act, index) {
      act.classList.toggle("is-story-current", index === current);
    });
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateCurrentAct);
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  updateCurrentAct();
})();
