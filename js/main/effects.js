/* Common responsive and reveal effects for static pages. */

export function initResponsiveTables() {
  document.querySelectorAll(".cmp-table").forEach(table => {
    const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
      th.textContent.trim().replace(/\s+/g, " ")
    );
    if (!headers.length) return;

    table.querySelectorAll("tbody tr").forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (headers[index]) cell.dataset.label = headers[index];
      });
    });
    table.classList.add("responsive-labels");
  });
}

export function initReveal() {
  const revealState = window.__masestReveal || (window.__masestReveal = {});
  const syncRevealFocus = (el, visible) => {
    const focusables = [];
    const selector = "a[href], button, input, select, textarea, [tabindex], .table-scroll";
    if (el.matches(selector)) focusables.push(el);
    focusables.push(...el.querySelectorAll(selector));
    focusables.forEach(focusable => {
      if (!focusable.dataset.revealTabindexSet) {
        focusable.dataset.revealTabindexSet = "1";
        focusable.dataset.revealTabindex = focusable.getAttribute("tabindex") || "";
      }
      if (visible) {
        if (focusable.dataset.revealTabindex) focusable.setAttribute("tabindex", focusable.dataset.revealTabindex);
        else focusable.removeAttribute("tabindex");
      } else {
        focusable.setAttribute("tabindex", "-1");
      }
    });
  };
  const revealElement = el => {
    if (el.classList.contains("in")) return;
    el.classList.add("in");
    syncRevealFocus(el, true);
    revealState.observer?.unobserve(el);
  };
  const nearViewport = el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0
      && rect.height > 0
      && rect.top < window.innerHeight + 96
      && rect.bottom > -96;
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach(el => {
      el.classList.add("in");
      syncRevealFocus(el, true);
    });
    return;
  }

  document.body.classList.add("reveal-ready");
  revealState.revealVisible = () => {
    document.querySelectorAll(".reveal:not(.in)").forEach(el => {
      if (nearViewport(el)) revealElement(el);
    });
  };
  const scheduleRevealScan = () => {
    if (revealState.scanFrame) return;
    revealState.scanFrame = requestAnimationFrame(() => {
      revealState.scanFrame = 0;
      revealState.revealVisible?.();
    });
  };
  if (!revealState.observer) {
    revealState.observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) revealElement(e.target);
      });
    }, { rootMargin: "0px 0px 96px 0px", threshold: 0 });
  }
  const io = revealState.observer;

  document.querySelectorAll(".reveal").forEach(el => {
    if (el.dataset.revealObserved) return;
    el.dataset.revealObserved = "1";
    syncRevealFocus(el, el.classList.contains("in"));
    io.observe(el);
  });
  if (!revealState.listenersBound) {
    revealState.listenersBound = true;
    window.addEventListener("scroll", scheduleRevealScan, { passive: true });
    window.addEventListener("resize", scheduleRevealScan);
    window.addEventListener("pageshow", scheduleRevealScan);
  }
  scheduleRevealScan();
  setTimeout(() => revealState.revealVisible?.(), 250);
}
