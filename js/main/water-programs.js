import { loadPricingData } from "./pricing-data.js?v=20261002a";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Chemical bundles in older pricing content are not application instructions.
// Keep commercial service features from the pricing owner; select chemicals by job.
export function waterProgramFeatures(features) {
  return (Array.isArray(features) ? features : [])
    .filter((feature) => typeof feature === "string" && !/WaterSafe|Purgo|DBNPA|\bHCR\b|\bCR\b|Neutral|Descaler|MultiWash|AlumiBrite/i.test(feature))
    .map((feature) => feature.replace(/^Everything in (Bronze|Silver|Gold), plus /i, "Adds "));
}

export function renderWaterPrograms(tiers) {
  return tiers.map((tier) => {
    const name = String(tier.name || tier.title || tier.slug || "");
    const href = new URL("/contact", "https://masest.co");
    href.searchParams.set("type", "program");
    href.searchParams.set("industry", "HVAC & Water Systems");
    href.searchParams.set("message", `Water-treatment service level: ${name}\nSystem type/count:\nWater analysis:\nService location:\nRequired visits/support:`);
    return `<article class="system-plan"><span class="eyebrow">${escapeHtml(tier.badge || tier.tier || "Service level")}</span><h3>${escapeHtml(name)}</h3>
      <p class="system-plan-price">${escapeHtml(tier.price || "Quoted")}<small>${tier.price ? " " + escapeHtml(tier.price_unit || "/ month") : ""}</small></p>
      <ul>${waterProgramFeatures(tier.features).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
      <a class="btn btn-secondary btn-sm" href="${escapeHtml(href.pathname + href.search)}">Scope ${escapeHtml(name)}</a></article>`;
  }).join("");
}

export async function initWaterPrograms() {
  const mount = document.querySelector("[data-water-programs]");
  if (!mount) return;
  const status = document.querySelector("[data-water-program-status]");
  try {
    const data = await loadPricingData();
    const tiers = (Array.isArray(data.pricing_tiers) ? data.pricing_tiers : [])
      .filter((tier) => tier && tier.active !== false && (tier.name || tier.title || tier.slug))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    if (!tiers.length) throw new Error("water_programs_unavailable");
    mount.innerHTML = renderWaterPrograms(tiers);
    if (status) status.textContent = "Current published service levels. Your site proposal confirms the final scope.";
  } catch {
    if (status) status.textContent = "Service levels are unavailable online right now. Request the current comparison and a site-specific quote.";
  }
}

export function initSystemGuides() {
  const openTarget = () => {
    const id = window.location.hash.slice(1);
    const guide = document.getElementById(id);
    if (guide?.matches("details.system-guide")) {
      guide.open = true;
      guide.scrollIntoView({ block: "start" });
    } else if (guide?.closest("details.system-technical")) {
      guide.closest("details.system-technical").open = true;
      guide.scrollIntoView({ block: "start" });
    }
  };
  openTarget();
  window.addEventListener("hashchange", openTarget);
}
