const PROOF_LABELS = {
  hvac: "HVAC & Water",
  food: "Food & Beverage",
  industrial: "Industrial",
  marine: "Marine",
  distribution: "Distribution",
  facility: "Facilities"
};

const SERVICE_LABELS = {
  "Lab Testing - Water Analysis": "Water analysis",
  "Lab Testing - Biological": "Biological",
  "Lab Testing - Materials": "Materials",
  "Testing - Materials": "Materials",
  "Consulting Services": "Consulting",
  "Bid Support": "Bid support",
  "Field Services": "Field services",
  "Water Management Plan": "Water plan",
  "Service Packages": "Packages"
};

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeCategory(value) {
  const clean = String(value || "")
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  return clean === "Testing - Materials" ? "Lab Testing - Materials" : clean;
}

function percent(count, total) {
  if (!total) return 0;
  return Math.max(4, Math.round((count / total) * 100));
}

function activeProofKind() {
  return document.querySelector("[data-proof-filter].active")?.dataset.proofFilter || "all";
}

function renderProofCoverage(root, cards) {
  const counts = cards.reduce((acc, card) => {
    const kind = card.dataset.proofKind;
    if (!kind) return acc;
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(PROOF_LABELS).filter(([kind]) => counts[kind]);
  const total = entries.reduce((sum, [kind]) => sum + counts[kind], 0);

  root.innerHTML = `
    <div class="viz-copy">
      <span class="eyebrow">Proof coverage</span>
      <h3>Evidence spans ${total} field case files across ${entries.length} sectors.</h3>
      <p data-proof-coverage-note>${activeProofKind() === "all" ? "Showing the full case record." : `Filtered to ${PROOF_LABELS[activeProofKind()]}.`}</p>
    </div>
    <div class="viz-stack" role="group" aria-label="Filter proof cases by sector">
      ${entries.map(([kind], index) => `
        <button
          class="viz-segment viz-tone-${index + 1}"
          type="button"
          style="--share:${percent(counts[kind], total)}"
          data-proof-viz-filter="${htmlEscape(kind)}"
          aria-pressed="${kind === activeProofKind() ? "true" : "false"}"
          aria-label="${htmlEscape(PROOF_LABELS[kind])}: ${counts[kind]} case files"
        >
          <b>${counts[kind]}</b>
          <span>${htmlEscape(PROOF_LABELS[kind])}</span>
        </button>
      `).join("")}
    </div>
    <div class="viz-key" aria-label="Proof sector counts">
      ${entries.map(([kind]) => `<span data-proof-viz-key="${htmlEscape(kind)}"><b>${counts[kind]}</b>${htmlEscape(PROOF_LABELS[kind])}</span>`).join("")}
    </div>
  `;

  const sync = () => {
    const kind = activeProofKind();
    root.querySelector("[data-proof-coverage-note]").textContent = kind === "all"
      ? "Showing the full case record."
      : `Filtered to ${PROOF_LABELS[kind] || kind}.`;
    root.querySelectorAll("[data-proof-viz-filter], [data-proof-viz-key]").forEach((item) => {
      const selected = kind !== "all" && (
        item.dataset.proofVizFilter === kind ||
        item.dataset.proofVizKey === kind
      );
      item.classList.toggle("active", selected);
      if (item.hasAttribute("data-proof-viz-filter")) item.setAttribute("aria-pressed", String(selected));
    });
  };

  root.querySelectorAll("[data-proof-viz-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`[data-proof-filter="${button.dataset.proofVizFilter}"]`)?.click();
      sync();
    });
  });
  document.querySelectorAll("[data-proof-filter]").forEach((button) => button.addEventListener("click", sync));
  sync();
}

function renderServiceMix(root, catalog) {
  const items = [
    ...(Array.isArray(catalog?.services) ? catalog.services : []),
    ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
  ].filter((item) => item && item.active !== false);
  const counts = items.reduce((acc, item) => {
    const category = normalizeCategory(item.category);
    if (!category) return acc;
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const largest = entries.slice(0, 2).map(([category]) => SERVICE_LABELS[category] || category).join(" and ");

  root.innerHTML = `
    <div class="viz-copy">
      <span class="eyebrow">Service mix</span>
      <h3>${largest || "Service categories"} carry the broadest quote coverage.</h3>
      <p>${total} catalog entries, including services and packages, grouped by buyer task.</p>
    </div>
    <div class="viz-stack service-mix-stack" role="list" aria-label="Service catalog entries by category">
      ${entries.map(([category, count], index) => `
        <span
          class="viz-segment viz-tone-${(index % 6) + 1}"
          role="listitem"
          style="--share:${percent(count, total)}"
          aria-label="${htmlEscape(SERVICE_LABELS[category] || category)}: ${count} catalog entries"
        >
          <b>${count}</b>
          <span>${htmlEscape(SERVICE_LABELS[category] || category)}</span>
        </span>
      `).join("")}
    </div>
    <div class="viz-key" aria-label="Service category counts">
      ${entries.map(([category, count]) => `<span><b>${count}</b>${htmlEscape(SERVICE_LABELS[category] || category)}</span>`).join("")}
    </div>
  `;
}

export function initDataVisualizations() {
  const proofRoot = document.querySelector("[data-proof-coverage]");
  if (proofRoot) {
    const cards = Array.from(document.querySelectorAll("[data-proof-card]"));
    if (cards.length) renderProofCoverage(proofRoot, cards);
  }

  const serviceRoot = document.querySelector("[data-service-mix-viz]");
  if (serviceRoot) {
    fetch("data/services.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("services_visual_unavailable");
        return response.json();
      })
      .then((catalog) => renderServiceMix(serviceRoot, catalog))
      .catch(() => {
        serviceRoot.innerHTML = `<p class="viz-fallback">Service mix loads from the same catalog as the pricing table. Browse the catalog below for the current scoped line items.</p>`;
      });
  }
}
