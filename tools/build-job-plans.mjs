import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { validateUpdateBundleReview } from "./update-bundle-policy.mjs";

const START = "<!-- job-plans:auto -->";
const END = "<!-- /job-plans:auto -->";
const DEFAULT_MEDIA_REVIEW = JSON.parse(
  readFileSync(new URL("../data/update-media-review.json", import.meta.url), "utf8"),
);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const renderComponent = (component) => {
  return `<li class="job-plan-component">
              <span>${escapeHtml(component.source_name)}</span>
              <small>${escapeHtml(component.variant_sku)} · 1 gal jug</small>
            </li>`;
};

const money = (minor) => `$${(minor / 100).toFixed(2)}`;
const savingsPercent = (plan) => Math.round(
  (plan.source_stated_savings_minor / plan.source_separate_price_minor) * 100,
);

const publicMediaByPlacement = (mediaReview) => new Map(
  (mediaReview?.candidate_media || [])
    .filter((record) => record.status === "approved_for_public_use" && record.placement_key)
    .map((record) => [record.placement_key, record]),
);

const renderMedia = (record, className) => record
  ? `<figure class="${className}">
            <img src="${escapeHtml(record.public_url)}" width="${record.public_width}" height="${record.public_height}" loading="lazy" decoding="async" alt="${escapeHtml(record.caption)}">
          </figure>`
  : "";

export function renderJobPlans(review, mediaReview = DEFAULT_MEDIA_REVIEW) {
  const plans = validateUpdateBundleReview(review);
  const media = publicMediaByPlacement(mediaReview);
  const cards = plans.map((plan) => {
    const quoteMessage = `I'd like to order the ${plan.name} bundle (${plan.bundle_sku}).`;
    const quoteParams = new URLSearchParams({
      type: "quote",
      product: plan.bundle_sku,
      message: quoteMessage,
    });
    const quoteHref = `contact?${escapeHtml(quoteParams.toString())}#quoteForm`;
    const cardMedia = plan.slug === "hvac-plumbing"
      ? renderMedia(media.get("bundle_hvac_plumbing"), "job-plan-card-media")
      : "";
    const cardMediaHtml = cardMedia ? `${cardMedia}\n          ` : "";
    return `<article class="job-plan-card reveal" data-job-plan="${escapeHtml(plan.slug)}" data-bundle-sku="${escapeHtml(plan.bundle_sku)}" data-bundle-price-minor="${plan.approved_price_minor}">
          ${cardMediaHtml}<span class="job-plan-card-kicker">4 × 1 gal bundle</span>
          <h3>${escapeHtml(plan.name)}</h3>
          <p>${escapeHtml(plan.public_summary)}</p>
          <div class="job-plan-offer">
            <div><span>Bundle price</span><strong>${money(plan.approved_price_minor)}</strong></div>
            <div><s>${money(plan.source_separate_price_minor)} separately</s><span class="job-plan-savings">Save ${savingsPercent(plan)}%</span></div>
          </div>
          <p class="job-plan-sku"><span>Order code</span><code>${escapeHtml(plan.bundle_sku)}</code></p>
          <ul aria-label="${escapeHtml(plan.name)} products">
            ${plan.source_components.map(renderComponent).join("\n            ")}
          </ul>
          <a class="btn btn-secondary btn-sm" href="${quoteHref}">Order this kit</a>
        </article>`;
  }).join("\n        ");

  return `<section class="section job-plans" aria-labelledby="job-plans-title">
    <div class="wrap">
      <div class="job-plans-head reveal">
        <div>
          <span class="catalog-label">Ready-made cleaning kits</span>
          <h2 class="headline" id="job-plans-title">Four products. One job. One better price.</h2>
        </div>
        <p>Each kit includes four one-gallon VertKleen products, one clear price, and built-in savings.</p>
      </div>
      ${renderMedia(media.get("bundle_overview"), "job-plans-media reveal")}
      <div class="job-plan-grid">
        ${cards}
      </div>
      <p class="job-plan-boundary reveal">Shipping and tax are added to your quote. Your quote confirms what is in stock and the best shipping option before you pay.</p>
    </div>
  </section>`;
}

export function buildJobPlans(root = process.cwd()) {
  const reviewPath = join(root, "data", "update-bundle-review.json");
  const productsPath = join(root, "products.html");
  const review = JSON.parse(readFileSync(reviewPath, "utf8"));
  const source = readFileSync(productsPath, "utf8");
  const startAt = source.indexOf(START);
  const endAt = source.indexOf(END, startAt + START.length);
  if (startAt === -1 || endAt === -1) {
    throw new Error("products.html: job-plan generation markers missing");
  }
  const rendered = `${START}\n  ${renderJobPlans(review)}\n  ${END}`;
  const html = `${source.slice(0, startAt)}${rendered}${source.slice(endAt + END.length)}`;
  writeFileSync(productsPath, html);
  return review.bundle_concepts.length;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const count = buildJobPlans();
  console.log(`build-job-plans: rendered ${count} priced bundle quote offers`);
}
