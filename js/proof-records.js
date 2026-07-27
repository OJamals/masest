import { canonicalPublicImageUrl } from "./image-url.js?v=20260723a";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function proofCardHtml(card) {
  const chips = Array.isArray(card?.chips) ? card.chips : [];
  const image = canonicalPublicImageUrl(card?.image);
  const afterImage = canonicalPublicImageUrl(card?.image_after);
  const imageHtml = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(card.image_alt || card.title || "")}" loading="lazy" width="${escapeHtml(card.image_w || 1600)}" height="${escapeHtml(card.image_h || 900)}">`
    : "";
  const afterHtml = afterImage
    ? `<img src="${escapeHtml(afterImage)}" alt="${escapeHtml(card.image_after_alt || card.title || "")}" loading="lazy" width="${escapeHtml(card.image_after_w || 1600)}" height="${escapeHtml(card.image_after_h || 900)}">`
    : "";
  const media = imageHtml && afterHtml
    ? `<div class="case-ba"><figure>${imageHtml}<figcaption>Before</figcaption></figure><figure>${afterHtml}<figcaption>After</figcaption></figure></div>`
    : imageHtml ? `<figure class="case-media">${imageHtml}</figure>` : "";

  return `    <article id="${escapeHtml(card?.slug || "")}" class="case-card reveal" data-proof-card data-proof-kind="${escapeHtml(card?.kind || "all")}">
      ${media}
      <div class="case-body">
        <span class="case-eyebrow">${escapeHtml(card?.eyebrow || "Result")}</span>
        <h3>${escapeHtml(card?.title || "VertKlean result")}</h3>
        <p class="case-result">${escapeHtml(card?.result || "")}</p>
        ${chips.length ? `<div class="case-meta">${chips.map((chip) => `<span class="case-chip">${escapeHtml(chip)}</span>`).join("")}</div>` : ""}
        <details class="case-disclosure">
          <summary>View result details</summary>
          <div class="case-disclosure-body">
            ${card?.narrative ? `<p class="case-narrative">${escapeHtml(card.narrative)}</p>` : ""}
            ${card?.publication_scope ? `<span class="case-publication">${escapeHtml(card.publication_scope)}</span>` : ""}
            ${card?.source ? `<span class="case-source">${escapeHtml(card.source)}</span>` : ""}
          </div>
        </details>
      </div>
    </article>
`;
}

export function proofRecordsHtml(records) {
  return [...(records || [])]
    .sort((left, right) => Number(left?.sort_order || 0) - Number(right?.sort_order || 0))
    .map(proofCardHtml)
    .join("");
}
