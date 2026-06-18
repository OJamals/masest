/* Before/after sliders, proof filters, and quote form handling. */

export function initBeforeAfter() {
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
  // Attach first-touch UTM attribution to the submission (best-effort; stored in quotes.payload).
  try {
    if (typeof window.masestUtm === "function" && data instanceof FormData) {
      const utm = window.masestUtm() || {};
      Object.keys(utm).forEach((k) => { if (utm[k]) data.append(k, utm[k]); });
    }
  } catch (e) { /* attribution is best-effort */ }
  // Abort a hung endpoint so the user is never stranded on a disabled button.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: data,
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("Request failed");
    try { if (typeof window.mtrack === "function") window.mtrack("quote_submit"); } catch (e) { /* funnel event best-effort */ }
    return { fallbackOnly: false };
  } finally {
    clearTimeout(timer);
  }
}

export function initProofFilters() {
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

export function initQuoteForm() {
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
  const messageParam = params.get("message");
  if (messageParam) {
    const msg = form.querySelector('[name="message"]');
    if (msg && !msg.value) msg.value = messageParam;
  }
  const emailParam = params.get("email");
  if (emailParam) {
    const email = form.querySelector('#fEmail[name="email"]');
    if (email && !email.value) email.value = emailParam;
  }
  const indParam = params.get("industry");
  if (indParam) {
    const isel = form.querySelector('[name="industry"]');
    if (isel) [...isel.options].forEach(o => { if (o.value === indParam || o.text === indParam) isel.value = o.value || o.text; });
  }

  // ── Adaptive request type: the chooser swaps which field set is required/shown ──
  const typeInput = form.querySelector('[name="type"]');
  const groups = [...form.querySelectorAll("[data-intent-group]")];
  const choices = [...form.querySelectorAll(".cta-choice")];
  const INTENTS = ["quote", "audit", "sample", "distributor"];
  function applyIntent(intent) {
    if (!INTENTS.includes(intent)) intent = "quote";
    if (typeInput) typeInput.value = intent;
    choices.forEach(b => {
      const on = b.dataset.intent === intent;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    groups.forEach(g => {
      const on = g.dataset.intentGroup === intent;
      g.hidden = !on;
      g.querySelectorAll("[data-req]").forEach(el => { el.required = on; if (!on) setErr(el, ""); });
    });
  }
  choices.forEach(b => b.addEventListener("click", () => applyIntent(b.dataset.intent)));
  // Initial intent: a chooser type (?type or a prior set value) wins; otherwise default to quote
  // while preserving non-chooser types (technical/government) on the hidden input.
  const reqType = params.get("type") || (typeInput ? typeInput.value : "");
  if (INTENTS.includes(reqType)) applyIntent(reqType);
  else { applyIntent("quote"); if (typeInput && reqType) typeInput.value = reqType; }

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
      if (el.closest("[data-intent-group][hidden]")) { setErr(el, ""); return; }
      let text = "";
      if (el.required && !el.value.trim()) text = "This field is required.";
      else if (el.type === "email" && el.value && !el.checkValidity()) text = "Enter a valid email address.";
      setErr(el, text);
      if (text && !firstBad) firstBad = el;
    });
    const sampleGroup = form.querySelector('[data-intent-group="sample"]');
    if (sampleGroup && !sampleGroup.hidden) {
      const picks = sampleGroup.querySelectorAll('input[name="samples"]:checked').length;
      const hint = document.getElementById("sampleHint");
      const okPicks = picks >= 3 && picks <= 5;
      if (hint) {
        hint.textContent = okPicks ? "3 to 5 products selected." : "Select 3 to 5 products (you have " + picks + ").";
        hint.classList.toggle("err", !okPicks);
      }
      if (!okPicks && !firstBad) firstBad = sampleGroup.querySelector('input[name="samples"]');
    }
    return firstBad;
  }
  form.addEventListener("input", e => setErr(e.target, ""));

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) { bad.focus(); bad.scrollIntoView({ behavior: smoothPref(), block: "center" }); return; }

    const data = new FormData(form);
    const labels = {
      name: "Name", company: "Company", email: "Email", phone: "Phone", type: "Request type",
      product: "Product", industry: "Industry", volume: "Volume", location: "Location",
      timeline: "Timeline", system: "System / asset", audit_timeframe: "Preferred timeframe",
      samples: "Sample products", ship_to: "Ship-to address", company_type: "Company type",
      territory: "Territory / region", message: "Notes"
    };
    const lines = [];
    for (const [k, v] of data.entries()) if (String(v).trim()) lines.push((labels[k] || k) + ": " + v);
    const reqLabel = (data.get("type") || "quote").replace(/^./, c => c.toUpperCase());
    const subject = reqLabel + " request: " + (data.get("product") || data.get("industry") || "VertKleen") + " (" + (data.get("company") || data.get("name")) + ")";
    const mailto = "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
    const fallback = document.getElementById("mailtoFallback");
    if (fallback) fallback.href = mailto;

    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit ? submit.textContent : "";
    if (submit) { submit.disabled = true; submit.textContent = "Sending…"; }

    // One outcome panel for every ending. accepted=true → the endpoint took it;
    // accepted=false → no endpoint or the request failed/timed out, so the
    // prepared email is the real path. No alert, no form-plus-panel double view.
    const showOutcome = (accepted) => {
      form.style.display = "none";
      const ok = document.getElementById("formSuccess");
      const title = document.getElementById("formSuccessTitle");
      const copy = document.getElementById("formSuccessCopy");
      const mail = document.getElementById("mailtoFallback");
      if (title) title.textContent = accepted ? "Request received." : "Almost there: send the request.";
      if (copy) {
        copy.innerHTML = accepted
          ? "MASEST has received your request. A sales or technical contact will review the details and follow up directly."
          : 'We couldn’t submit automatically. Use the prepared email link below, then hit send in your email app. If your device blocks email links, email <a href="mailto:matthew@masest.co" style="font-weight:700;color:var(--accent-ink)">matthew@masest.co</a> or call <a href="tel:+18134063852" style="font-weight:700;color:var(--accent-ink)">(813) 406-3852</a>.';
      }
      if (mail) mail.hidden = accepted;
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
      if (title) title.focus();
      const edit = document.getElementById("formEdit");
      if (edit) edit.onclick = () => {
        ok.style.display = "none";
        form.style.display = "";
        if (submit) { submit.disabled = false; submit.textContent = submitLabel; }
        form.querySelector("input, select, textarea").focus();
      };
    };

    submitRequest(form, data)
      .then((result) => showOutcome(!result.fallbackOnly))
      .catch(() => showOutcome(false));
  });
}
