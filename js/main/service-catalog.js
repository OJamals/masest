/* Service pricing catalog rendering. */

const SERVICE_CATEGORY_COPY = {
  "Lab Testing — Water Analysis": {
    icon: "ph-drop",
    note: "Water chemistry, tower, closed-loop, pretreatment, and wastewater analysis."
  },
  "Lab Testing — Biological": {
    icon: "ph-test-tube",
    note: "Biological counts, Legionella PCR, and mold/air-quality lab work."
  },
  "Lab Testing — Materials": {
    icon: "ph-magnifying-glass",
    note: "Deposit, corrosion, particle, resin, and material identification."
  },
  "Bid Support": {
    icon: "ph-file-text",
    note: "Specification creation, review, and buyer-side bid interview support."
  },
  "Consulting Services": {
    icon: "ph-compass-tool",
    note: "General consulting, EHSS, investigation, training, and program support."
  },
  "Field Services": {
    icon: "ph-hard-hat",
    note: "On-site sample collection and billable field service time."
  },
  "Water Management Plan": {
    icon: "ph-clipboard-text",
    note: "ASHRAE 188 risk assessment, plan writing, audits, and recertification."
  },
  "Service Packages": {
    icon: "ph-package",
    note: "Bundled sampling, water-management setup, quarterly audit, and recertification packages."
  }
};

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2
  }).format(Number(n));
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

export function initServiceCatalog() {
  const roots = Array.from(document.querySelectorAll("[data-service-catalog]"));
  if (!roots.length) return;

  fetch("data/catalog.seed.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("catalog_seed_unavailable");
      return response.json();
    })
    .then((catalog) => {
      const rows = [
        ...(Array.isArray(catalog?.services) ? catalog.services : []),
        ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
      ].filter((item) => item?.active !== false);

      const groups = rows.reduce((map, item) => {
        const key = item.category || "Services";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
        return map;
      }, new Map());

      const markup = [...groups.entries()].map(([category, items]) => {
        const copy = SERVICE_CATEGORY_COPY[category] || { icon: "ph-briefcase", note: "Quote-confirmed technical service." };
        const sorted = items.slice().sort((a, b) => Number(a.public_price || 0) - Number(b.public_price || 0));
        const minimum = sorted.find((item) => Number.isFinite(Number(item.public_price)));
        const priceText = minimum ? `From ${fmtMoney(Number(minimum.public_price), "USD")}` : "Quoted";
        const preview = sorted.slice(0, 4).map((item) => `
          <li>
            <span>${htmlEscape(item.name)}</span>
            <b>${Number.isFinite(Number(item.public_price)) ? fmtMoney(Number(item.public_price), "USD") : "Quote"}</b>
          </li>
        `).join("");

        return `
          <article class="service-category">
            <div class="service-category-head">
              <i class="ph ${copy.icon}" aria-hidden="true"></i>
              <div>
                <h3>${htmlEscape(category)}</h3>
                <p>${htmlEscape(copy.note)}</p>
              </div>
            </div>
            <div class="service-category-meta">
              <span>${items.length} line ${items.length === 1 ? "item" : "items"}</span>
              <strong>${priceText}</strong>
            </div>
            <ul>${preview}</ul>
          </article>
        `;
      }).join("");
      roots.forEach((root) => { root.innerHTML = markup; });
    })
    .catch(() => {
      roots.forEach((root) => {
        root.innerHTML = '<p class="muted">Service pricing is available by quote. Contact MASEST for the latest workbook-backed scope.</p>';
      });
    });
}

/* ---------- Before/after slider (drag, keyboard, reduced-motion safe) ----------
   Markup: <div class="ba" data-ba> with .ba-after img, .ba-before > img,
   an input[type=range].ba-range, and a .ba-handle. The range drives reveal. */
