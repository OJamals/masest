/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */

const PRODUCTS = {
  hcr: {
    name: "VertKleen HCR",
    cat: "acid",
    replaces: "Replaces hydrochloric acid",
    hmis: "0-0-0",
    icon: "ph-flask",
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
    tag: "The world's only neutral pH-7 degreaser. Solvent-grade cutting power, safe on every surface and seal.",
    desc: "The world's only neutral pH-7 degreaser. All the cutting power of high-pH and solvent degreasers, with no flammability, no fumes, and no damage to surfaces or seals.",
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
    tag: "Multi-surface industrial cleaner. Powerful enough for industry, safe around kids and staff.",
    desc: "A versatile multi-surface cleaner for facilities, drains, concrete, and pressure-washing applications. Powerful enough for industry, safe around kids and staff.",
    uses: [
      "Concrete drains and hardscape cleaning",
      "Pressure-washing programs",
      "Facility, warehouse, and fulfillment-center maintenance",
      "Educational and healthcare environments"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Safe around kids, staff, and the environment"],
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
    name: "DBNPA Tablets",
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
    ["products.html", "Products"],
    ["industries.html", "Industries"],
    ["about.html", "About"],
    ["contact.html", "Contact"]
  ];
  const skip = document.createElement("a");
  skip.className = "skip-link";
  skip.href = "#main";
  skip.textContent = "Skip to content";
  const nav = document.createElement("header");
  nav.className = "nav";
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
  burger.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Elevate the nav once the page scrolls away from the top; while it
  // overlaps the dark story opener, switch it to a dark glass treatment
  const story = document.getElementById("story");
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
    if (story) nav.classList.toggle("over-dark", story.getBoundingClientRect().bottom > 66);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const foot = document.createElement("footer");
  foot.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <div class="foot-brand">MASEST VertKleen&trade;</div>
          <p>Safe, powerful, environmentally friendly alternatives to hazardous chemicals. Family-owned on Florida's Space Coast, trusted in 50+ countries.</p>
        </div>
        <div>
          <h4>Products</h4>
          <a href="products.html#acid">Acid Replacements</a>
          <a href="products.html#alkaline">Alkaline Replacements</a>
          <a href="products.html#water">Water Treatment</a>
        </div>
        <div>
          <h4>Company</h4>
          <a href="industries.html">Industries</a>
          <a href="about.html">About Us</a>
          <a href="contact.html">Contact</a>
        </div>
        <div>
          <h4>Contact</h4>
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
function initReveal() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  // dataset guard: initReveal may run again after late-injected content
  document.querySelectorAll(".reveal").forEach(el => {
    if (el.dataset.revealObserved) return;
    el.dataset.revealObserved = "1";
    io.observe(el);
  });
}

/* ---------- Product card renderer ---------- */
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

/* ---------- Quote form ----------
   No backend yet: submission opens a prefilled email to the sales
   team (mailto handoff) and says so honestly. The form stays
   recoverable: an Edit button returns the user to their answers. */
const SALES_EMAIL = "matthew@masest.co";

function smoothPref() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
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
    location.href = "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));

    form.style.display = "none";
    const ok = document.getElementById("formSuccess");
    ok.style.display = "block";
    ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
    const edit = document.getElementById("formEdit");
    if (edit) edit.onclick = () => {
      ok.style.display = "none";
      form.style.display = "";
      form.querySelector("input, select, textarea").focus();
    };
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initReveal();
});
