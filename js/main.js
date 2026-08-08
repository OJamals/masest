/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */
import { renderChrome } from "./main/chrome.js?v=20260807h";
import { initResponsiveTables, initReveal } from "./main/effects.js";
import { initServiceCatalog } from "./main/service-catalog.js?v=20260807h";
import {
  initCartButtons,
  initShop,
  isLocalStaticCommerceSuppressed,
  loadCommerceCatalog,
  productCard,
  refreshCommerceActions,
} from "./main/commerce-ui.js?v=20260807h";
import {
  initBeforeAfter,
  initIndustryDiscovery,
  initProofFilters,
  initQuoteForm,
} from "./main/engagement.js?v=20260807h";
import { initImageFallbacks, initIndustryProducts, initLightbox } from "./main/media.js?v=20260807h";
import { initDataVisualizations } from "./main/data-visuals.js";
import { initContentSnapshots } from "./main/content-snapshots.js?v=20260807h";
import { initPricingBindings } from "./main/pricing-data.js?v=20260807h";

window.MASESTMain = {
  initReveal,
  productCard,
};

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initIndustryProducts();
  initImageFallbacks();
  initBeforeAfter();
  initIndustryDiscovery();
  initProofFilters();
  initResponsiveTables();
  initReveal();
  initLightbox();
  initCartButtons();
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(() => refreshCommerceActions(document));
  initShop();
  initServiceCatalog();
  initPricingBindings();
  // Run the proof-coverage viz AFTER the CMS snapshot inject resolves so it counts
  // the live [data-proof-card] set, not the pre-injection fallback DOM.
  Promise.resolve(initContentSnapshots()).finally(() => { initDataVisualizations(); });
});
