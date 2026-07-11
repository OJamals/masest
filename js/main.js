/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */
import { CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_CATALOG_COPY, PRODUCT_GALLERY, PRODUCTS, QUOTE_FIRST_IDS, REPLACEMENT_MAP } from "./main/catalog-data.js?v=20260710f";
import { renderChrome } from "./main/chrome.js?v=20260711w";
import { initResponsiveTables, initReveal } from "./main/effects.js";
import { initServiceCatalog } from "./main/service-catalog.js?v=20260711w";
import {
  catalogCard,
  initCartButtons,
  initShop,
  isLocalStaticCommerceSuppressed,
  loadCommerceCatalog,
  productCard,
  refreshCommerceActions,
} from "./main/commerce-ui.js?v=20260710f";
import { initBeforeAfter, initProofFilters, initQuoteForm } from "./main/engagement.js";
import { initImageFallbacks, initIndustryProducts, initLightbox } from "./main/media.js?v=20260710f";
import { initDataVisualizations } from "./main/data-visuals.js";
import { initContentSnapshots } from "./main/content-snapshots.js";

window.MASESTMain = {
  CATALOG_GROUPS,
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCT_GALLERY,
  PRODUCTS,
  QUOTE_FIRST_IDS,
  REPLACEMENT_MAP,
  catalogCard,
  initReveal,
  isLocalStaticCommerceSuppressed,
  loadCommerceCatalog,
  productCard,
  refreshCommerceActions,
};

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initIndustryProducts();
  initImageFallbacks();
  initBeforeAfter();
  initProofFilters();
  initResponsiveTables();
  initReveal();
  initLightbox();
  initCartButtons();
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(() => refreshCommerceActions(document));
  initShop();
  initServiceCatalog();
  // Run the proof-coverage viz AFTER the CMS snapshot inject resolves so it counts
  // the live [data-proof-card] set, not the pre-injection fallback DOM.
  Promise.resolve(initContentSnapshots()).finally(() => { initDataVisualizations(); });
});
