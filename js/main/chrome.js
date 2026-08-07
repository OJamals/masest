/* MASEST shared chrome/nav/footer rendering. */

const CUSTOMER_CHAT_OBSTRUCTION_EVENT = "masest:customer-chat-obstruction-change";

function pageName() {
  // Normalize away ".html" so the active-nav match works on raw file URLs
  // (local preview) as well as the clean URLs production serves.
  return (location.pathname.split("/").pop() || "index").replace(/\.html$/, "") || "index";
}

// Mobile card layout hides each cmp-table's thead and labels every cell via
// CSS `content: attr(data-label)`. Stamp those labels from the table's own
// column headers so every table — 3, 4, or 5 columns — labels correctly.
function initCmpTableLabels() {
  document.querySelectorAll("table.cmp-table").forEach((table) => {
    const headers = Array.from(table.querySelectorAll("thead th"), (th) => th.textContent.trim());
    if (!headers.length) return;
    table.querySelectorAll("tbody tr").forEach((row) => {
      Array.from(row.children).forEach((cell, i) => {
        if (headers[i] && !cell.dataset.label) cell.dataset.label = headers[i];
      });
    });
  });
}

function wireDashboardSidebarScrollRelease() {
  document.querySelectorAll(".dash-sidebar, .adm-sidebar.adm-tabs-wrap").forEach((rail) => {
    rail.addEventListener("wheel", (event) => {
      if (event.defaultPrevented || event.ctrlKey || !event.deltaY) return;

      const maxScrollTop = rail.scrollHeight - rail.clientHeight;
      if (maxScrollTop <= 0) return;

      const atTop = rail.scrollTop <= 1;
      const atBottom = rail.scrollTop >= maxScrollTop - 1;
      if (!(event.deltaY < 0 && atTop) && !(event.deltaY > 0 && atBottom)) return;

      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? parseFloat(getComputedStyle(rail).lineHeight) || 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
      event.preventDefault();
      window.scrollBy({ top: event.deltaY * unit, behavior: "instant" });
    }, { passive: false });
  });
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
}

function industryFromPath() {
  if (!/\/industries\/[^/]+/.test(location.pathname)) return "";
  return (document.title.split("|")[0] || "").trim();
}

function newsletterSourceContext(extra = {}) {
  return {
    source: extra.source || "footer_newsletter",
    source_path: window.location.pathname + window.location.search,
    source_page: pageName(),
    page_title: document.title,
    industry: industryFromPath(),
    ...extra,
  };
}

function postNewsletterCapture(payload) {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/newsletter", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch (err) { /* fall through to fetch */ }
  fetch("/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function documentRequestReturnPath() {
  let path = location.pathname.replace(/^\/+/, "");
  if (!path) path = "index.html";
  else if (path.endsWith("/")) path += "index.html";
  else if (!/\.[a-z0-9]+$/i.test(path)) path += ".html";
  return `${path}${location.search}${location.hash}`;
}

function documentRegistrationHref() {
  const params = new URLSearchParams({
    mode: "register",
    return: documentRequestReturnPath(),
  });
  return `/account.html?${params}`;
}

function setDocumentRequestState(control, text, state = "") {
  const label = control.querySelector("[data-document-request-label]");
  if (label) label.textContent = text;
  control.dataset.requestState = state;
}

function wireDocumentRoomCapture(authModule) {
  if (document.__masestDocumentCapture) return;
  const controls = [...document.querySelectorAll("[data-document-download], [data-document-request]")];
  if (!controls.length) return;
  document.__masestDocumentCapture = true;
  import(authModule).then(async ({ getToken }) => {
    const registered = Boolean(await getToken().catch(() => null));
    document.querySelectorAll("[data-document-request]").forEach((control) => {
      setDocumentRequestState(control, registered ? "Request access" : "Register to request");
    });
  }).catch(() => {});
  document.addEventListener("click", async (event) => {
    const requestControl = event.target?.closest?.("[data-document-request]");
    if (requestControl) {
      event.preventDefault();
      if (requestControl.disabled) return;
      requestControl.disabled = true;
      const documentId = requestControl.dataset.documentId || "";
      const documentRevision = requestControl.dataset.documentRevision || "";
      const docName = requestControl.dataset.documentName || requestControl.textContent || "Technical document";
      try {
        const { api, getToken } = await import(authModule);
        if (!await getToken()) {
          location.assign(documentRegistrationHref());
          return;
        }
        const result = await api("/api/account/document-requests", {
          method: "POST",
          body: {
            document_id: documentId,
            document_revision: documentRevision,
            requested_from: `${location.pathname}${location.search}`,
          },
        });
        if (result.request?.status === "approved") {
          const access = await api(`/api/account/document-requests?download=${encodeURIComponent(documentId)}`);
          if (access.url) location.assign(access.url);
          return;
        }
        setDocumentRequestState(requestControl, "Request pending", "pending");
        try {
          if (typeof window.mtrack === "function") window.mtrack("document_request", { document: docName });
        } catch (err) { /* analytics is best-effort */ }
      } catch (error) {
        if (error?.status === 401) {
          location.assign(documentRegistrationHref());
          return;
        }
        setDocumentRequestState(requestControl,
          error?.status === 409 ? "Document updated - refresh" : "Request failed - retry",
          "error");
      } finally {
        requestControl.disabled = false;
      }
      return;
    }

    const link = event.target?.closest?.("[data-document-download]");
    if (!link) return;
    const docName = link.dataset.documentName || link.getAttribute("aria-label") || link.textContent || "Document";
    try {
      if (typeof window.mtrack === "function") window.mtrack("document_download", { document: docName });
    } catch (err) { /* analytics is best-effort */ }

    const email = document.getElementById("docNotifyEmail")?.value?.trim() || "";
    const optIn = document.getElementById("docNotifyOptIn")?.checked === true;
    if (!optIn || !validEmail(email)) return;
    const payload = {
      email,
      ...newsletterSourceContext({
        source: "document_room",
        document: docName,
        document_notify: true,
      }),
    };
    if (window.MASEST?.subscribeNewsletter) {
      window.MASEST.subscribeNewsletter(email, payload).catch(() => {});
    } else {
      postNewsletterCapture(payload);
    }
  }, true);
}

export function renderChrome({
  authModule = "/js/auth.js?v=20260711w",
  resolveSession = false,
} = {}) {
  initCmpTableLabels();
  document.querySelector(".nojs-nav")?.setAttribute("hidden", "");
  const page = pageName();
  // Pages under /industries/ sit one level deep; prefix chrome links with the
  // right root so the shared nav/footer resolve from any directory depth.
  const root = /\/(?:industries|products|comparisons|blog)\//.test(location.pathname) ? "../" : "";
  const homeHref = root || "./";
  const isProductDetail = /\/products\/[^/]+(?:\.html)?$/.test(location.pathname);
  const links = [
    { href: "products", label: "Products" },
    { href: "services", label: "Services" },
    { href: "programs", label: "Programs" },
    {
      key: "useCases",
      label: "Use Cases",
      children: [
        { href: "industries", label: "Industries" },
        { href: "proof", label: "Proof" }
      ]
    },
    { href: "resources", label: "Resources" },
    { href: "blog", label: "Blog" },
    { href: "about", label: "Company" }
  ];
  const isActive = (href) => {
    if (page === href) return true;
    if (href === "products" && (page === "product" || isProductDetail)) return true;
    if (href === "industries" && /\/industries\//.test(location.pathname)) return true;
    if (href === "blog" && /\/blog(\/|$)/.test(location.pathname)) return true;
    return false;
  };
  const navItem = item => {
    if (!item.children) {
      return `<a href="${root}${item.href}"${isActive(item.href) ? ' class="active" aria-current="page"' : ""}>${item.label}</a>`;
    }
    const active = item.children.some(child => isActive(child.href));
    return `<details class="nav-group${active ? " active" : ""}">
      <summary${active ? ' class="active" aria-current="page"' : ""}><span class="nav-group-label">${item.label}</span></summary>
      <div class="nav-menu">
        ${item.children.map(child =>
          `<a href="${root}${child.href}"${isActive(child.href) ? ' class="active" aria-current="page"' : ""}>${child.label}</a>`).join("")}
      </div>
    </details>`;
  };
  const skip = document.querySelector('.skip-link[href="#main"]') || document.createElement("a");
  skip.classList.add("skip-link");
  skip.href = "#main";
  if (!skip.textContent.trim()) skip.textContent = "Skip to content";
  const nav = document.createElement("header");
  // Start in the dark-glass treatment when this page opens on the dark story,
  // so the first paint matches the backdrop (no white-bar flash before onScroll).
  const story = document.getElementById("story");
  nav.className = story || document.body.dataset.nav === "dark" ? "nav over-dark" : "nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-logo" href="${homeHref}" aria-label="MASEST home"><img class="logo-image logo-ink" src="/img/masest-logo-ink.png" alt="MASEST" width="469" height="585"><img class="logo-image logo-grad" src="/img/masest-logo.png" alt="" aria-hidden="true" width="469" height="585"></a>
      <nav class="nav-links" id="navLinks" aria-label="Primary">
        ${links.map(navItem).join("")}
      </nav>
        <div class="nav-actions">
          <span class="nav-auth-placeholder" aria-hidden="true" style="display:block;width:92px;height:44px;align-self:center"></span>
          <a class="nav-cart" href="${root}cart" aria-label="Open cart"><i class="ph ph-shopping-cart-simple" aria-hidden="true"></i><b class="cart-count" data-cart-count hidden>0</b></a>
          <button class="nav-burger" id="navBurger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><span></span><span></span><span></span></button>
        </div>
    </div>`;
  // If the page ships a static nav-height reserve (#nav-reserve, e.g. the story
  // homepage where a late-injected nav would shove the full-viewport #story down
  // ~59px = ~0.16 CLS), swap it for the real nav atomically: same box, same
  // height, so nothing reflows. Other pages just prepend as before.
  const navReserve = document.getElementById("nav-reserve");
  if (navReserve) navReserve.replaceWith(nav);
  else document.body.prepend(nav);
  document.body.prepend(skip);
 const leadBarPages = new Set([
 "products",
 "products.html",
 "services",
 "services.html",
 "programs",
 "programs.html",
 "proof",
 "proof.html",
 "resources",
 "resources.html",
 "industries",
 "industries.html",
 "about",
 "about.html",
 "",
 ]);
  const isIndustryDetail = /\/industries\/[^/]+(?:\.html)?$/.test(location.pathname);
  if (leadBarPages.has(page) || isIndustryDetail || isProductDetail) {
    const leadBar = document.createElement("div");
    leadBar.className = "lead-action-bar";
    leadBar.setAttribute("data-customer-chat-obstruction", "");
    leadBar.setAttribute("role", "group");
    leadBar.setAttribute("aria-label", "Primary request actions");
    leadBar.innerHTML = `
      <a href="${root}contact?type=audit"><i class="ph ph-map-trifold" aria-hidden="true"></i><span>Map chemical</span></a>
      <a href="${root}contact?type=quote"><i class="ph ph-tag" aria-hidden="true"></i><span>Get quote</span></a>
    `;
    document.body.append(leadBar);
    const leadSentinel = document.createElement("div");
    leadSentinel.className = "lead-action-sentinel";
    leadSentinel.setAttribute("aria-hidden", "true");
    document.body.append(leadSentinel);
    let leadVisible = false;
    let leadSuppressed = false;
    let leadObstructionState = "";
    const announceLeadObstruction = () => {
      const nextState = `${leadVisible ? "visible" : "hidden"}:${leadSuppressed ? "suppressed" : "available"}`;
      if (leadObstructionState === nextState) return;
      leadObstructionState = nextState;
      leadBar.dataset.customerChatObstructionActive = String(leadVisible && !leadSuppressed);
      leadBar.dispatchEvent(new CustomEvent(CUSTOMER_CHAT_OBSTRUCTION_EVENT, {
        bubbles: true,
        detail: { visible: leadVisible, suppressed: leadSuppressed },
      }));
    };
    const setLeadVisible = (visible) => {
      leadVisible = Boolean(visible);
      leadBar.classList.toggle("is-visible", leadVisible);
      announceLeadObstruction();
    };
    const setLeadSuppressed = (suppressed) => {
      leadSuppressed = Boolean(suppressed);
      leadBar.classList.toggle("is-suppressed", leadSuppressed);
      announceLeadObstruction();
    };
    if ("IntersectionObserver" in window) {
      setLeadVisible(false);
      const leadObserver = new IntersectionObserver(entries => {
        setLeadVisible(!entries[0]?.isIntersecting);
      });
      leadObserver.observe(leadSentinel);
      const shopGrid = document.getElementById("shopGrid");
      if (shopGrid) {
        const shopObserver = new IntersectionObserver(entries => {
          setLeadSuppressed(entries.some(entry => entry.isIntersecting));
        }, { rootMargin: "0px 0px -96px 0px", threshold: 0.01 });
        shopObserver.observe(shopGrid);
      }
    } else {
      setLeadVisible(true);
    }
  }

  const burger = document.getElementById("navBurger");
  const navLinks = document.getElementById("navLinks");
  const cartCount = nav.querySelector("[data-cart-count]");
  const updateCartCount = () => {
    if (!cartCount) return;
    let total = 0;
    try {
      const cart = JSON.parse(localStorage.getItem("masest_cart") || "{}");
      total = Object.values(cart).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
    } catch (err) {
      total = 0;
    }
    cartCount.textContent = String(total);
    cartCount.hidden = total === 0;
  };
  updateCartCount();
  window.addEventListener("storage", updateCartCount);
  document.addEventListener("cart:updated", updateCartCount);
  document.addEventListener("masest:cart", updateCartCount);
  // Account control stays neutral while auth resolves, then becomes Sign in or the account dropdown.
  import("/js/account-nav.js?v=20260807e").then((m) => (
    m.initAccountNav && m.initAccountNav({ nav, root, authModule, resolveSession })
  )).catch(() => {});
  const setMenuOpen = open => {
    navLinks.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Close menu" : "Menu");
  };
  burger.addEventListener("click", () => {
    const open = !navLinks.classList.contains("open");
    setMenuOpen(open);
    if (open) navLinks.querySelector("a[href], summary, button")?.focus();
  });
  const navGroups = Array.from(navLinks.querySelectorAll(".nav-group"));
  const closeNavGroups = () => {
    navGroups.forEach(group => { group.open = false; });
  };
  const closeMenu = () => {
    setMenuOpen(false);
    closeNavGroups();
  };
  navLinks.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMenu));
  document.addEventListener("click", e => {
    if (!nav.contains(e.target)) closeNavGroups();
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const menuWasOpen = navLinks.classList.contains("open");
    closeMenu();
    if (menuWasOpen) {
      e.preventDefault();
      burger.focus();
    }
  });

  // Elevate the nav once the page scrolls away from the top.
  const useDarkNav = document.body.dataset.nav === "dark";
  let scrollRAF = 0;
  const applyScroll = () => {
    scrollRAF = 0;
    nav.classList.toggle("scrolled", window.scrollY > 8);
    nav.classList.toggle("over-dark", useDarkNav || (story && story.getBoundingClientRect().bottom > 66));
    if (!navLinks.classList.contains("open")) closeNavGroups();
  };
  const onScroll = () => { if (!scrollRAF) scrollRAF = requestAnimationFrame(applyScroll); };
  applyScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  wireDashboardSidebarScrollRelease();

  const foot = document.createElement("footer");
  foot.className = "";
  foot.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="foot-logo-link" href="${homeHref}" aria-label="MASEST home"><img class="foot-logo" src="/img/masest-logo.png" alt="MASEST" width="469" height="585"></a>
          <div class="foot-brand" translate="no">MASEST VertKleen&trade;</div>
          <p>Industrial cleaning candidates with current-SDS routing, controlled-trial planning, and quote support from Florida's Space Coast.</p>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Product Categories</div>
          <a href="${root}products#cat-descale">Rust &amp; Scale</a>
          <a href="${root}products#cat-degrease">Grease &amp; Grime</a>
          <a href="${root}products#cat-water">Water Treatment</a>
          <a href="${root}products#cat-exterior">Exterior &amp; Specialty</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Resources + SDS</div>
          <a href="${root}resources">Resources &amp; SDS</a>
          <a href="${root}programs">Programs &amp; Pricing</a>
          <a href="${root}proof">Proof</a>
          <a href="${root}blog">Blog</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Company</div>
          <a href="${root}industries">Industries</a>
          <a href="${root}about">Company</a>
          <a href="${root}contact">Contact</a>
        </div>
        <div>
          <div class="foot-title">Contact</div>
          <a href="mailto:matthew@masest.co">matthew@masest.co</a>
          <a href="tel:+18134063852">(813) 406-3852</a>
          <a href="#customerChat" data-customer-chat-open>Customer chat</a>
          <p style="margin-top:10px;font-size:.8rem;line-height:1.7">Public-sector sourcing and bid support for registered buyers.</p>
        </div>
      </div>
      ${page === "newsletter" ? "" : `<div class="foot-news">
        <div class="foot-news-copy">
          <div class="foot-title">VertKleen Briefing</div>
          <p>Mechanisms, field results, and practical cleaning wins. No spam. Unsubscribe anytime.</p>
        </div>
        <form class="foot-news-form" id="footNews" novalidate>
          <input type="email" name="email" id="footNewsEmail" autocomplete="email" spellcheck="false" placeholder="you@company.com…" aria-label="Email address" required>
          <input type="text" name="company" class="foot-news-gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button type="submit" class="btn btn-primary" id="footNewsBtn">Subscribe</button>
          <p class="foot-news-status" id="footNewsStatus" role="status" aria-live="polite"></p>
        </form>
      </div>`}
      <div class="foot-bottom">
        <span>&copy; ${new Date().getFullYear()} MASEST Consulting LLC. All rights reserved.</span>
        <span class="foot-legal"><a href="${root}privacy">Privacy</a><a href="${root}terms">Terms</a><a href="${root}eula">EULA</a></span>
        <span translate="no">VertKleen is a trademark of MASEST Consulting LLC.</span>
      </div>
    </div>`;
  document.body.append(foot);

  // Newsletter signup → Klaviyo (via window.MASEST.subscribeNewsletter from integrations.js).
  const news = foot.querySelector("#footNews");
  if (news) {
    news.addEventListener("submit", async e => {
      e.preventDefault();
      const email = foot.querySelector("#footNewsEmail").value.trim();
      const honey = foot.querySelector(".foot-news-gotcha").value;
      const btn = foot.querySelector("#footNewsBtn");
      const status = foot.querySelector("#footNewsStatus");
      if (honey) return; // bot trap
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        status.dataset.state = "err"; status.textContent = "Enter a valid email."; return;
      }
      btn.disabled = true; status.dataset.state = ""; status.textContent = "Subscribing…";
      try {
        if (!window.MASEST?.subscribeNewsletter) throw new Error("unavailable");
        await window.MASEST.subscribeNewsletter(email, newsletterSourceContext());
        status.dataset.state = "ok"; status.textContent = "Check your inbox to confirm."; news.reset();
      } catch (err) {
        status.dataset.state = "err"; status.textContent = "Could not subscribe. Try again later.";
      } finally {
        btn.disabled = false;
      }
    });
  }
  wireDocumentRoomCapture(authModule);

  // Load public config + first-party integrations once per page.
  if (!window.__masestIntegrations) {
    window.__masestIntegrations = true;
    window.MASEST = Object.assign(window.MASEST || {}, { chatRoot: root, authModule });
    const cfg = document.createElement("script");
    cfg.src = `${root}js/config.js?v=20260711b`;
    cfg.onload = () => {
      ["integrations.js?v=20260711b", "customer-chat.js?v=20260807e"].forEach((src) => {
        const mod = document.createElement("script");
        mod.type = "module";
        mod.src = `${root}js/${src}`;
        document.head.appendChild(mod);
      });
    };
    document.head.appendChild(cfg);
  }

  document.addEventListener("click", (event) => {
    const opener = event.target?.closest?.("[data-customer-chat-open]");
    if (!opener) return;
    event.preventDefault();
    document.querySelector(".site-support__launcher, .customer-chat__toggle")?.click();
  });
}

/* ---------- Scroll reveal (IntersectionObserver, reduced-motion safe) ---------- */
