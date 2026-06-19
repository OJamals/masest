/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */
import { CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_CATALOG_COPY, PRODUCT_GALLERY, PRODUCTS, REPLACEMENT_MAP } from "./main/catalog-data.js";
import { renderChrome } from "./main/chrome.js";
import { initResponsiveTables, initReveal } from "./main/effects.js";
import { initServiceCatalog } from "./main/service-catalog.js";
import {
  catalogCard,
  initCartButtons,
  initShop,
  isLocalStaticCommerceSuppressed,
  loadCommerceCatalog,
  productCard,
  refreshCommerceActions,
} from "./main/commerce-ui.js";
import { initBeforeAfter, initProofFilters, initQuoteForm } from "./main/engagement.js";
import { initImageFallbacks, initIndustryProducts, initLightbox } from "./main/media.js";

window.MASESTMain = {
  CATALOG_GROUPS,
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCT_GALLERY,
  PRODUCTS,
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
});
