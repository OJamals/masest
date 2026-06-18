/* Industry product blocks, lightbox, and image fallback helpers. */

import { PRODUCTS } from "./catalog-data.js";
import { productCard } from "./commerce-ui.js";

export function initIndustryProducts() {
  document.querySelectorAll("[data-ind-products]").forEach((box) => {
    const ids = (box.dataset.indProducts || "").split(/\s+/).filter((id) => PRODUCTS[id]);
    if (!ids.length) return;
    box.innerHTML = ids.map((id) => productCard(id)).join("");
    // Industry pages live one level deep; rewrite relative product assets and
    // links to resolve from /industries/.
    box.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (h && !/^(https?:|mailto:|tel:|#|\.\.\/|\/)/.test(h)) a.setAttribute("href", "../" + h);
    });
    box.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !/^(https?:|data:|#|\.\.\/|\/)/.test(src)) img.setAttribute("src", "../" + src);
    });
  });
}

// Click any content photo to view it full-size. Document previews (.doc-link) open their
// PDF instead, and before/after sliders ([data-ba]) keep their drag behavior — both excluded.
export function initLightbox() {
  const ZOOM_SCOPE = ".proof-card, .case-card, .ind-gallery, figure.photo";
  const dlg = document.createElement("dialog");
  dlg.id = "lightbox";
  dlg.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close">×</button>' +
    '<figure class="lb-fig"><img class="lb-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt=""><figcaption class="lb-cap"></figcaption></figure>';
  document.body.appendChild(dlg);
  const lbImg = dlg.querySelector(".lb-img");
  const lbCap = dlg.querySelector(".lb-cap");
  const close = () => { if (dlg.open) dlg.close(); };

  document.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img || !img.closest(ZOOM_SCOPE)) return;
    if (img.closest(".doc-link, [data-ba]")) return; // docs open PDF; sliders drag
    e.preventDefault();
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || "";
    lbCap.textContent = img.alt || "";
    if (typeof dlg.showModal === "function") dlg.showModal();
  });

  dlg.querySelector(".lb-close").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // backdrop
  dlg.addEventListener("close", () => { lbImg.removeAttribute("src"); });
}

export function initImageFallbacks() {
  const frameSelector = ".catalog-shelf-media, .product-media-card, .proof-card figure, .case-card figure, .ind-gallery figure, figure.photo, .proof-thumb, .row-thumb";
  const labelFor = (img) => {
    const figcaption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
    return figcaption || img.getAttribute("alt") || "Visual reference pending";
  };
  const showFallback = (img) => {
    const frame = img.closest(frameSelector);
    if (!frame || frame.classList.contains("media-fallback")) return;
    frame.classList.add("media-fallback");
    img.hidden = true;
    const label = document.createElement("span");
    label.className = "media-fallback-label";
    label.textContent = labelFor(img);
    frame.appendChild(label);
  };
  document.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => showFallback(img), { once: true });
    if (img.complete && img.naturalWidth === 0) showFallback(img);
  });
}
