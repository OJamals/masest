/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */

const PRODUCTS = {
  hcr: {
    name: "VertKleen HCR",
    cat: "acid",
    replaces: "Replaces hydrochloric acid",
    hmis: "0-0-0",
    icon: "ph-flask",
    image: "img/products/hvac-hcr.webp",
    tag: "Biodegradable acid replacement for descaling, rust removal, and passivation. No fumes, no burns, no hazmat handling.",
    desc: "A biodegradable, SynTec-powered acid replacement for descaling, rust removal, passivation, and acid cleaning. No fumes, no burns, no hazmat handling.",
    uses: [
      "Cooling tower fill and heat-exchanger descaling",
      "Rust removal: restored diamond-plated stainless steel stained for years",
      "Acid cleaning and passivation with the building occupied",
      "Concrete, equipment, and pipeline scale removal"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-atom", "SynTec powered", "Patented technology matching legacy acid performance"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, BOD, nitrates and phosphates"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "Cooling Tower Case Study: Brevard County Schools"]
  },
  cr: {
    name: "VertKleen CR",
    cat: "alkaline",
    replaces: "Replaces caustic soda and sodium hydroxide",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/hvac-cr.webp",
    tag: "NSF/ANSI 60 caustic replacement and pH adjuster. High-pH cleaning power at a zero hazard rating.",
    desc: "An NSF/ANSI 60 caustic replacement and pH adjuster covering high-pH alkaline needs: degreasing, hood filters, floors, and pH control, all at a zero hazard rating.",
    uses: [
      "pH adjustment in water treatment programs",
      "Hood filters and floors at busy commercial kitchens",
      "High-pH alkaline cleaning without burn risk",
      "Caustic replacement across industrial CIP"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Safe on skin and eyes, non-fuming, non-corrosive"],
      ["ph-seal-check", "NSF/ANSI 60", "Certified for drinking-water system chemicals"],
      ["ph-atom", "SynTec powered", "Replaces sodium and potassium hydroxide"],
      ["ph-leaf", "Eco-friendly discharge", "Effortless wastewater discharge profile"]
    ],
    docs: ["Safety Data Sheet (SDS)", "NSF/ANSI 60 Certification", "Technical Application Sheet"]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Replaces caustic and solvent degreasers",
    hmis: "0-0-0",
    icon: "ph-drop",
    tag: "Neutral pH-7 degreaser with solvent-grade cutting power for sensitive surfaces and seals.",
    desc: "A neutral pH-7 degreaser with the cutting power expected from high-pH and solvent degreasers, without flammability, harsh fumes, or surface damage.",
    uses: [
      "Heavy equipment and machinery degreasing",
      "Marine, oil and gas, and aviation surfaces",
      "Sensitive metals and seals: non-corrosive",
      "Facility and fleet maintenance"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero hazard, replaces flammable solvent degreasers"],
      ["ph-scales", "True pH 7", "Neutral chemistry, safe on any equipment and seals"],
      ["ph-atom", "SynClean powered", "Patented degreasing technology"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, easy discharge"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "alkaline",
    replaces: "Replaces general-purpose caustic cleaners",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    tag: "Multi-surface industrial cleaner for occupied facilities, drains, concrete, and pressure-washing programs.",
    desc: "A versatile multi-surface cleaner for facilities, drains, concrete, and pressure-washing applications, with a handling profile suited to occupied campuses.",
    uses: [
      "Concrete drains and hardscape cleaning",
      "Pressure-washing programs",
      "Facility, warehouse, and fulfillment-center maintenance",
      "Educational and healthcare environments"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-atom", "SynClean powered", "Patented cleaning technology"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, BOD, nitrates and phosphates"],
      ["ph-truck", "Non-hazmat shipping", "Lower freight cost worldwide"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  watersafe60: {
    name: "WaterSafe60",
    cat: "water",
    replaces: "Replaces phosphate, zinc, and molybdate blends",
    hmis: "0-0-0",
    icon: "ph-waves",
    tag: "NSF/ANSI 60 scale and corrosion inhibitor with no heavy metals.",
    desc: "An NSF/ANSI 60 scale and corrosion inhibitor with no heavy metals: no zinc, no molybdate, no chromate. Equivalent asset protection at a zero hazard rating.",
    uses: [
      "Cooling tower scale and corrosion control",
      "Closed-loop and chilled-water systems",
      "ASHRAE 188 and Legionella risk-management programs",
      "Campus, hospital, and government facilities"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Replaces blends rated up to HMIS 2-0-0"],
      ["ph-seal-check", "NSF/ANSI 60", "Certified inhibitor chemistry"],
      ["ph-prohibit", "No heavy metals", "No chromate, zinc, or molybdate"],
      ["ph-clipboard-text", "Full documentation", "ASHRAE 188 program support"]
    ],
    docs: ["Safety Data Sheet (SDS)", "NSF/ANSI 60 Certification", "Cooling Tower Program Brochure"]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Replaces bromine and sodium hypochlorite",
    hmis: "0-0-0",
    icon: "ph-shield-plus",
    tag: "FIFRA 25(b) minimum-risk oxidizing biocide for microbiological and Legionella-risk control.",
    desc: "A FIFRA 25(b) minimum-risk oxidizing biocide replacing stabilized bromine and bleach (HMIS 3-0-1) for microbiological and Legionella-risk control.",
    uses: [
      "Cooling tower microbiological control",
      "Legionella risk management (ASHRAE 188)",
      "Occupied-campus water treatment",
      "General-use: no restricted-use applicator license required"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Replaces bromine and bleach rated 3-0-1"],
      ["ph-seal-check", "FIFRA 25(b)", "Minimum-risk classification"],
      ["ph-buildings", "Occupied-site safe", "No evacuations, no fume exposure"],
      ["ph-certificate", "No license barrier", "General-use in Florida, no FDACS license needed"]
    ],
    docs: ["Safety Data Sheet (SDS)", "FIFRA 25(b) Documentation", "Cooling Tower Program Brochure"]
  },
  dbnpa: {
    name: "DBNPA Tablet",
    cat: "water",
    replaces: "Replaces glutaraldehyde 50%",
    hmis: "Low hazard",
    icon: "ph-pill",
    tag: "Controlled-release non-oxidizing biocide. One tablet per quarter.",
    desc: "EPA-registered, general-use controlled-release tablets, dosed at one tablet per quarter, satisfying the non-oxidizing biocide rotation without flammable, toxic glutaraldehyde.",
    uses: [
      "Quarterly non-oxidizing biocide rotation",
      "Cooling tower microbiological programs",
      "Low-dose, controlled-release dosing"
    ],
    specs: [
      ["ph-arrow-down", "Low dose", "One controlled-release tablet per quarter"],
      ["ph-seal-check", "EPA-registered", "General-use classification"],
      ["ph-fire-simple", "Non-flammable", "Replaces glutaraldehyde rated HMIS 3-2-0"],
      ["ph-info", "Program note", "The program's one mild-hazard product. Every other VertKleen product is HMIS 0-0-0."]
    ],
    docs: ["Safety Data Sheet (SDS)", "EPA Registration Documentation"]
  },
  crhd: {
    name: "VertKleen CRHD",
    cat: "alkaline",
    replaces: "Replaces Simple Green, Zep, and solvent degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
    image: "img/products/crhd.webp",
    tag: "High-detergency alkaline degreaser, about 50% active and low-foam, for floors, equipment, drains, and engine bays.",
    desc: "A high-detergency, low-foam alkaline degreaser at roughly 50% active strength, built to replace solvent and butyl degreasers on the heaviest grease without flammability or harsh fumes.",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Field-proven replacing Simple Green at Walmart distribution centers"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-gauge", "About 50% active", "Higher active strength than common 15% degreasers"],
      ["ph-seal-check", "OEM cleared", "Approved by Crown Forklift and Plug Power; meets Boeing and Airbus cleaning specs"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "Case Study: Walmart Distribution Centers"]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Replaces muriatic acid, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
    image: "img/products/descaler.webp",
    tag: "Acid-free descaler for coils, towers, and plumbing. Fin-safe on aluminum and copper, with a fraction of the corrosion of conventional acids.",
    desc: "An acid-free descaler (marketed as CRS in the dealership channel) that clears calcium, rust, and scale from coils, cooling towers, plumbing, and fire pumps. Fin-safe on aluminum and copper, chloride-free, and safe to municipal drains.",
    uses: [
      "Aluminum and copper coil descaling, fin-safe",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Refrigeration systems: chloride-free, safe on the ammonia charge"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero hazard rating, no NFPA pictograms"],
      ["ph-trend-down", "Far less corrosion", "0.59 mpy versus hydrochloric at 609 mpy in VertKleen testing"],
      ["ph-snowflake", "Fin-safe and chloride-free", "Protects aluminum, copper, steel, and stainless"],
      ["ph-drop", "Municipal-drain safe", "No acid neutralization or special disposal"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Descaler vs Acids Corrosion Data", "Case Study: Walmart Refrigeration Systems"]
  },
  alumibrite: {
    name: "VertKleen AlumiBrite",
    cat: "specialty",
    replaces: "Replaces hydrofluoric and hydrochloric aluminum brighteners",
    hmis: "0-0-0",
    icon: "ph-car",
    tag: "Synthetic-acid aluminum brightener with no hydrofluoric or hydrochloric acid, for wheels, trim, and aluminum restoration.",
    desc: "A synthetic-acid aluminum brightener that restores wheels, trim, and marine aluminum without hydrofluoric or hydrochloric acid, the standard brighteners that burn skin and pit metal.",
    uses: [
      "Wheels, trim, and aluminum restoration",
      "Fleet, RV, and marine aluminum",
      "Detailing and dealership reconditioning",
      "Field-proven on a commercial tourist airboat"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "No hydrofluoric or hydrochloric acid"],
      ["ph-atom", "Synthetic acid", "SynTec brightening without the burn and fume risk"],
      ["ph-chart-line-up", "Brightening Index 90.1", "Outperformed hydrochloric acid at 86.3 in VertKleen testing"],
      ["ph-leaf", "Biodegradable", "Low-impact discharge profile"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  torque: {
    name: "VertKleen Torque",
    cat: "specialty",
    replaces: "Replaces separate wash, wax, and bug removers",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    tag: "All-in-one wash and wax for vehicles, fleet, RV, and marine, formulated to stay OEM warranty-safe.",
    desc: "An all-in-one wash and wax that cleans and protects in a single step across vehicles, fleet, RV, and marine, formulated to stay within OEM finish-care requirements.",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Field-proven on a 43-foot Yellowfin vessel"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-sparkle", "Wash and wax in one", "Cleans and protects in a single pass"],
      ["ph-seal-check", "OEM warranty-safe", "Formulated to meet finish-care requirements"],
      ["ph-leaf", "Biodegradable", "Low VOC, easy discharge"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  lam3: {
    name: "VertKleen LAM3",
    cat: "specialty",
    replaces: "Replaces Wet & Forget and bleach roof cleaners",
    hmis: "0-0-0",
    icon: "ph-house-line",
    tag: "Spray-and-walk-away remover for lichen, algae, moss, mold, and mildew on roofs, pavers, stucco, and siding.",
    desc: "A neutral, spray-and-walk-away treatment that clears lichen, algae, moss, mold, and mildew from roofs, pavers, stucco, siding, and concrete, with no bleach and no harm to surrounding plants.",
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Pond and fountain algae",
      "Field-proven clearing mildew from a painted column over two weeks"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Neutral pH, no bleach, no fumes"],
      ["ph-plant", "Plant and pet safe", "No harm to flora or fauna around the work area"],
      ["ph-timer", "Spray and walk away", "Keeps working up to a month; reapply about every six months"],
      ["ph-leaf", "100% biodegradable", "Non-skin-irritant in OECD 404 testing"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Data Sheet (TDS)", "Front and Back Label"]
  }
};

/* ---------- Nav / footer injection ---------- */
function pageName() {
  return location.pathname.split("/").pop() || "index.html";
}
function renderChrome() {
  const page = pageName();
  const links = [
    ["index.html", "Home"],
    ["why-vertkleen.html", "Why VertKleen"],
    ["products.html", "Products"],
    ["programs.html", "Programs"],
    ["proof.html", "Proof"],
    ["industries.html", "Industries"],
    ["about.html", "About"],
    ["contact.html", "Contact"]
  ];
  const skip = document.createElement("a");
  skip.className = "skip-link";
  skip.href = "#main";
  skip.textContent = "Skip to content";
  const nav = document.createElement("header");
  // Start in the dark-glass treatment when this page opens on the dark story,
  // so the first paint matches the backdrop (no white-bar flash before onScroll).
  const story = document.getElementById("story");
  nav.className = story || document.body.dataset.nav === "dark" ? "nav over-dark" : "nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-logo" href="index.html"><span class="logo-mark"><span>M</span></span>MASEST</a>
      <nav class="nav-links" id="navLinks">
        ${links.map(([href, label]) =>
          `<a href="${href}"${page === href ? ' class="active"' : ""}>${label}</a>`).join("")}
      </nav>
      <div style="display:flex;align-items:center;gap:12px">
        <a class="nav-cta" href="contact.html">Request a Quote</a>
        <button class="nav-burger" id="navBurger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><span></span><span></span><span></span></button>
      </div>
    </div>`;
  document.body.prepend(nav);
  document.body.prepend(skip);
  const burger = document.getElementById("navBurger");
  const navLinks = document.getElementById("navLinks");
  const navCta = nav.querySelector(".nav-cta");
  const syncNavCtaLabel = () => {
    navCta.textContent = window.matchMedia("(max-width: 360px)").matches ? "Quote" : "Request a Quote";
  };
  syncNavCtaLabel();
  window.addEventListener("resize", syncNavCtaLabel);
  const setMenuOpen = open => {
    navLinks.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
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
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
    nav.classList.toggle("over-dark", useDarkNav || (story && story.getBoundingClientRect().bottom > 66));
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const foot = document.createElement("footer");
  foot.className = "reveal";
  foot.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <div class="foot-brand">MASEST VertKleen&trade;</div>
          <p>Safe, powerful, environmentally friendly alternatives to hazardous chemicals. Family-owned on Florida's Space Coast, trusted in 50+ countries.</p>
        </div>
        <div>
          <div class="foot-title">Products</div>
          <a href="products.html#acid">Acid Replacements</a>
          <a href="products.html#alkaline">Alkaline Replacements</a>
          <a href="products.html#water">Water Treatment</a>
          <a href="products.html#specialty">Specialty &amp; Exterior</a>
          <a href="resources.html">Resources &amp; SDS</a>
        </div>
        <div>
          <div class="foot-title">Company</div>
          <a href="why-vertkleen.html">Why VertKleen</a>
          <a href="programs.html">Programs &amp; Pricing</a>
          <a href="proof.html">Proof &amp; Case Studies</a>
          <a href="industries.html">Industries</a>
          <a href="about.html">About Us</a>
          <a href="contact.html">Contact</a>
        </div>
        <div>
          <div class="foot-title">Contact</div>
          <a href="mailto:matthew@masest.co">matthew@masest.co</a>
          <a href="tel:+18134063852">(813) 406-3852</a>
          <p style="margin-top:10px;font-size:.8rem;line-height:1.7">CAGE 0B2Q3<br>NAICS 424690<br>SAM.gov registered<br>Minority-owned (self-certified)</p>
        </div>
      </div>
      <div class="foot-bottom">
        <span>&copy; ${new Date().getFullYear()} MASEST Consulting LLC. All rights reserved.</span>
        <span>VertKleen, SynTec and SynClean are trademarks of MASEST Consulting LLC.</span>
      </div>
    </div>`;
  document.body.append(foot);
}

/* ---------- Scroll reveal (IntersectionObserver, reduced-motion safe) ---------- */
function initResponsiveTables() {
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

function initReveal() {
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

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach(el => {
      el.classList.add("in");
      syncRevealFocus(el, true);
    });
    return;
  }

  document.body.classList.add("reveal-ready");
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        syncRevealFocus(e.target, true);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(".reveal").forEach(el => {
    if (el.dataset.revealObserved) return;
    el.dataset.revealObserved = "1";
    syncRevealFocus(el, el.classList.contains("in"));
    io.observe(el);
  });
}
function productCard(id, heroCard = false) {
  const p = PRODUCTS[id];
  const badge = p.hmis === "0-0-0"
    ? '<span class="hmis-badge">HMIS 0-0-0</span>'
    : '<span class="hmis-badge note">LOW HAZARD</span>';
  return `
  <div class="prod-card${heroCard ? " hero-card" : ""} reveal">
    <div class="prod-top"><i class="ph ${p.icon}" aria-hidden="true"></i>${badge}</div>
    <span class="replaces">${p.replaces}</span>
    <h3>${p.name}</h3>
    <p>${p.tag}</p>
    <div class="prod-actions">
      <a class="btn btn-ink btn-sm" href="product.html?id=${id}">View Details</a>
      <a class="btn btn-ghost btn-sm" href="contact.html?product=${encodeURIComponent(p.name)}">Request a Quote</a>
    </div>
  </div>`;
}

/* ---------- Before/after slider (drag, keyboard, reduced-motion safe) ----------
   Markup: <div class="ba" data-ba> with .ba-after img, .ba-before > img,
   an input[type=range].ba-range, and a .ba-handle. The range drives reveal. */
function initBeforeAfter() {
  document.querySelectorAll("[data-ba]").forEach(ba => {
    const range = ba.querySelector(".ba-range");
    const handle = ba.querySelector(".ba-handle");
    if (!range) return;
    const apply = () => {
      const v = range.value;
      ba.style.setProperty("--pos", v + "%");
      if (handle) handle.style.left = v + "%";
      range.setAttribute("aria-valuenow", v);
    };
    range.addEventListener("input", apply);
    apply();
  });
}

/* ---------- Quote form ----------
   No backend yet: submission opens a prefilled email to the sales
   team (mailto handoff) and says so honestly. The form stays
   recoverable: an Edit button returns the user to their answers. */
const SALES_EMAIL = "matthew@masest.co";

function smoothPref() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

async function submitRequest(form, data) {
  const endpoint = form.dataset.endpoint;
  if (!endpoint) return { fallbackOnly: true };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Accept": "application/json" },
    body: data
  });
  if (!res.ok) throw new Error("Request failed");
  return { fallbackOnly: false };
}

function initProofFilters() {
  const filters = [...document.querySelectorAll("[data-proof-filter]")];
  const cards = [...document.querySelectorAll("[data-proof-card]")];
  if (!filters.length || !cards.length) return;

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const kind = filter.dataset.proofFilter;
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      cards.forEach((card) => {
        const visible = kind === "all" || card.dataset.proofKind === kind;
        card.hidden = !visible;
      });
    });
  });
}

function initQuoteForm() {
  const form = document.getElementById("quoteForm");
  if (!form) return;
  const params = new URLSearchParams(location.search);

  // Prefill from URL params (?product=, ?doc=)
  const pre = params.get("product");
  if (pre) {
    const sel = form.querySelector('[name="product"]');
    if (sel) [...sel.options].forEach(o => { if (o.value === pre || o.text === pre) sel.value = o.value || o.text; });
  }
  const doc = params.get("doc");
  if (doc) {
    const msg = form.querySelector('[name="message"]');
    const type = form.querySelector('[name="type"]');
    if (msg && !msg.value) msg.value = "Please send the " + doc + (pre ? " for " + pre : "") + ".";
    if (type) type.value = "technical";
  }

  // Inline validation: per-field messages instead of browser bubbles only
  form.setAttribute("novalidate", "");
  function setErr(el, text) {
    const field = el.closest(".field");
    if (!field) return;
    let err = field.querySelector(".field-err");
    if (!text) { if (err) err.remove(); el.removeAttribute("aria-invalid"); return; }
    if (!err) {
      err = document.createElement("span");
      err.className = "field-err";
      err.id = el.id + "Err";
      field.append(err);
    }
    err.textContent = text;
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", err.id);
  }
  function validate() {
    let firstBad = null;
    form.querySelectorAll("input, select, textarea").forEach(el => {
      let text = "";
      if (el.required && !el.value.trim()) text = "This field is required.";
      else if (el.type === "email" && el.value && !el.checkValidity()) text = "Enter a valid email address.";
      setErr(el, text);
      if (text && !firstBad) firstBad = el;
    });
    return firstBad;
  }
  form.addEventListener("input", e => setErr(e.target, ""));

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) { bad.focus(); bad.scrollIntoView({ behavior: smoothPref(), block: "center" }); return; }

    const data = new FormData(form);
    const labels = {
      name: "Name", company: "Company", email: "Email", phone: "Phone", type: "Inquiry type",
      product: "Product", industry: "Industry", volume: "Volume", location: "Location",
      timeline: "Timeline", message: "Message"
    };
    const lines = [];
    for (const [k, v] of data.entries()) if (String(v).trim()) lines.push((labels[k] || k) + ": " + v);
    const subject = "Quote request: " + (data.get("product") || "VertKleen") + " (" + (data.get("company") || data.get("name")) + ")";
    const mailto = "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
    const fallback = document.getElementById("mailtoFallback");
    if (fallback) fallback.href = mailto;

    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    submitRequest(form, data).then((result) => {
      form.style.display = "none";
      const ok = document.getElementById("formSuccess");
      const title = document.getElementById("formSuccessTitle");
      const copy = document.getElementById("formSuccessCopy");
      const mail = document.getElementById("mailtoFallback");
      const accepted = !result.fallbackOnly;
      if (title) title.textContent = accepted ? "Request received." : "Almost there: send the request.";
      if (copy) {
        copy.innerHTML = accepted
          ? "MASEST has received your quote request. A sales or technical contact will review the details and follow up directly."
          : 'Use the prepared email link below, then hit send in your email app. If your device blocks email links, email <a href="mailto:matthew@masest.co" style="font-weight:700;color:var(--accent-ink)">matthew@masest.co</a> or call <a href="tel:+18134063852" style="font-weight:700;color:var(--accent-ink)">(813) 406-3852</a>.';
      }
      if (mail) mail.style.display = accepted ? "none" : "";
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
      const edit = document.getElementById("formEdit");
      if (edit) edit.onclick = () => {
        ok.style.display = "none";
        form.style.display = "";
        if (submit) submit.disabled = false;
        form.querySelector("input, select, textarea").focus();
      };
    }).catch(() => {
      if (submit) submit.disabled = false;
      alert("We could not send this request automatically. Please use the prepared email link below.");
      const ok = document.getElementById("formSuccess");
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initBeforeAfter();
  initProofFilters();
  initResponsiveTables();
  initReveal();
});
