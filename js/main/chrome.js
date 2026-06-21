/* MASEST shared chrome/nav/footer rendering. */

function pageName() {
  return location.pathname.split("/").pop() || "index.html";
}
export function renderChrome() {
  document.querySelector(".nojs-nav")?.setAttribute("hidden", "");
  const page = pageName();
  // Pages under /industries/ sit one level deep; prefix chrome links with the
  // right root so the shared nav/footer resolve from any directory depth.
  const root = /\/industries\//.test(location.pathname) ? "../" : "";
  const links = [
    { href: "products.html", label: "Products" },
    { href: "services.html", label: "Services" },
    {
      key: "useCases",
      label: "Use Cases",
      children: [
        { href: "industries.html", label: "Industries" },
        { href: "proof.html", label: "Field Results" }
      ]
    },
    { href: "resources.html", label: "Resources" }
  ];
  const isActive = (href) => {
    if (page === href) return true;
    if (href === "products.html" && page === "product.html") return true;
    if (href === "industries.html" && /\/industries\//.test(location.pathname)) return true;
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
      <a class="nav-logo" href="${root}index.html" aria-label="MASEST home"><img class="logo-image logo-ink" src="${root}img/masest-logo-ink.png" alt="MASEST" width="469" height="585"><img class="logo-image logo-grad" src="${root}img/masest-logo.png" alt="" aria-hidden="true" width="469" height="585"></a>
      <nav class="nav-links" id="navLinks">
        ${links.map(navItem).join("")}
      </nav>
        <div class="nav-actions">
          <a class="nav-auth-placeholder nav-signin" href="${root}account.html"><span>Sign in</span></a>
          <a class="nav-cart" href="${root}cart.html" aria-label="Open cart"><i class="ph ph-shopping-cart-simple" aria-hidden="true"></i><b class="cart-count" data-cart-count hidden>0</b></a>
          <button class="nav-burger" id="navBurger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><span></span><span></span><span></span></button>
        </div>
    </div>`;
  document.body.prepend(nav);
  document.body.prepend(skip);
  const leadBarPages = new Set([
    "products.html",
    "product.html",
    "services.html",
    "programs.html",
    "proof.html",
    "resources.html",
    "industries.html",
    "about.html",
    "",
  ]);
  const isIndustryDetail = /\/industries\/[^/]+\.html$/.test(location.pathname);
  if (leadBarPages.has(page) || isIndustryDetail) {
    const leadBar = document.createElement("div");
    leadBar.className = "lead-action-bar";
    leadBar.setAttribute("role", "group");
    leadBar.setAttribute("aria-label", "Primary request actions");
    leadBar.innerHTML = `
      <a href="${root}contact.html?type=audit"><i class="ph ph-map-trifold" aria-hidden="true"></i><span>Map chemical</span></a>
      <a href="${root}contact.html?type=quote"><i class="ph ph-tag" aria-hidden="true"></i><span>Get quote</span></a>
    `;
    document.body.append(leadBar);
    const leadSentinel = document.createElement("div");
    leadSentinel.className = "lead-action-sentinel";
    leadSentinel.setAttribute("aria-hidden", "true");
    document.body.append(leadSentinel);
    const setLeadVisible = visible => leadBar.classList.toggle("is-visible", visible);
    if ("IntersectionObserver" in window) {
      setLeadVisible(false);
      const leadObserver = new IntersectionObserver(entries => {
        setLeadVisible(!entries[0]?.isIntersecting);
      });
      leadObserver.observe(leadSentinel);
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
  // Account control: login button when logged out, account dropdown when signed in.
  import("/js/account-nav.js").then((m) => m.initAccountNav && m.initAccountNav({ nav, root })).catch(() => {});
  const setMenuOpen = open => {
    navLinks.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Close menu" : "Menu");
  };
  burger.addEventListener("click", () => {
    setMenuOpen(!navLinks.classList.contains("open"));
  });
  const closeMenu = () => {
    setMenuOpen(false);
  };
  navLinks.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMenu();
  });

  // Elevate the nav once the page scrolls away from the top.
  const useDarkNav = document.body.dataset.nav === "dark";
  let scrollRAF = 0;
  const applyScroll = () => {
    scrollRAF = 0;
    nav.classList.toggle("scrolled", window.scrollY > 8);
    nav.classList.toggle("over-dark", useDarkNav || (story && story.getBoundingClientRect().bottom > 66));
  };
  const onScroll = () => { if (!scrollRAF) scrollRAF = requestAnimationFrame(applyScroll); };
  applyScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const foot = document.createElement("footer");
  foot.className = "reveal";
  foot.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="foot-logo-link" href="${root}index.html" aria-label="MASEST home"><img class="foot-logo" src="${root}img/masest-logo.png" alt="MASEST" width="469" height="585"></a>
          <div class="foot-brand">MASEST VertKleen&trade;</div>
          <p>HMIS 0-0-0 replacement chemistry with field proof, SDS routing, and quote support from Florida's Space Coast.</p>
          <div class="foot-kicker">Procurement routes</div>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Product Categories</div>
          <a href="${root}products.html#cat-descale">Rust &amp; Scale</a>
          <a href="${root}products.html#cat-degrease">Grease &amp; Grime</a>
          <a href="${root}products.html#cat-water">Water Treatment</a>
          <a href="${root}products.html#cat-exterior">Exterior &amp; Specialty</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Resources + SDS</div>
          <a href="${root}resources.html">Resources &amp; SDS</a>
          <a href="${root}programs.html">Programs &amp; Pricing</a>
          <a href="${root}proof.html">Proof &amp; Case Studies</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Company</div>
          <a href="${root}industries.html">Industries</a>
          <a href="${root}about.html">Company</a>
          <a href="${root}contact.html">Contact</a>
        </div>
        <div>
          <div class="foot-title">Contact</div>
          <a href="mailto:matthew@masest.co">matthew@masest.co</a>
          <a href="tel:+18134063852">(813) 406-3852</a>
          <a href="${root}contact.html" data-crisp-open data-crisp-message="Hi, I need help matching VertKleen to an application.">Live chat</a>
          <p style="margin-top:10px;font-size:.8rem;line-height:1.7">CAGE 0B2Q3<br>NAICS 424690<br>SAM.gov registered<br>Minority-owned (self-certified)</p>
        </div>
      </div>
      <div class="foot-news">
        <div class="foot-news-copy">
          <div class="foot-title">VertKleen Briefing</div>
          <p>Field results, document-gated SKUs, and program notes. No spam. Unsubscribe anytime.</p>
        </div>
        <form class="foot-news-form" id="footNews" novalidate>
          <input type="email" name="email" id="footNewsEmail" placeholder="you@company.com" aria-label="Email address" autocomplete="email" required>
          <input type="text" name="company" class="foot-news-gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button type="submit" class="btn btn-primary" id="footNewsBtn">Subscribe</button>
          <p class="foot-news-status" id="footNewsStatus" role="status" aria-live="polite"></p>
        </form>
      </div>
      <div class="foot-bottom">
        <span>&copy; ${new Date().getFullYear()} MASEST Consulting LLC. All rights reserved.</span>
        <span>VertKleen, SynTech and SynClean are trademarks of MASEST Consulting LLC.</span>
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
        await window.MASEST.subscribeNewsletter(email);
        status.dataset.state = "ok"; status.textContent = "Check your inbox to confirm."; news.reset();
      } catch (err) {
        status.dataset.state = "err"; status.textContent = "Could not subscribe. Try again later.";
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Load public config + integrations (Crisp chat, newsletter helper) once per page.
  if (!window.__masestIntegrations) {
    window.__masestIntegrations = true;
    const cfg = document.createElement("script");
    cfg.src = `${root}js/config.js`;
    cfg.onload = () => {
      const mod = document.createElement("script");
      mod.type = "module";
      mod.src = `${root}js/integrations.js`;
      document.head.appendChild(mod);
    };
    document.head.appendChild(cfg);
  }
}

/* ---------- Scroll reveal (IntersectionObserver, reduced-motion safe) ---------- */
