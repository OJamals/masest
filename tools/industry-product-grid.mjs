/* Server-rendered recommended-product grid for /industries/<slug>.

   The grid used to ship as an empty <div data-ind-products="..."> that
   initIndustryProducts() filled at runtime, so 25 of 26 industry pages carried no
   product name in their HTML at all. Googlebot renders JavaScript; GPTBot,
   PerplexityBot and every plain text extractor do not, which left each page's
   single most commercial section invisible to them.

   The cards are rendered here from the same productCard() the client uses, so the
   two can never drift. js/main/media.js skips a grid that already has cards and
   keeps hydrating live price and buy controls through refreshCommerceActions(),
   which walks the whole document and does not care who rendered the slots.
*/
import { PRODUCTS } from "../js/main/catalog-data.js";
import { productCard } from "../js/main/commerce-ui.js";

// productCard() emits root-absolute hrefs but repo-relative image sources, because
// it also serves pages at the site root. Industry pages live one level deep, so the
// image sources need the same "../" that initIndustryProducts() used to apply after
// injecting them. cf-build then rewrites registered paths to the R2 media host.
function resolveFromIndustries(card) {
  return card.replace(/(\ssrc=")(?!https?:|data:|#|\.\.\/|\/)/g, "$1../");
}

export function industryProductIds(ids) {
  return (Array.isArray(ids) ? ids : String(ids || "").split(/\s+/))
    .map((id) => String(id || "").trim())
    .filter((id) => id && PRODUCTS[id]);
}

export function industryProductCards(ids) {
  return industryProductIds(ids)
    .map((id) => resolveFromIndustries(productCard(id)).trim())
    .join("\n      ");
}

export function industryProductGrid(ids) {
  const resolved = industryProductIds(ids);
  const cards = industryProductCards(resolved);
  return `<div class="prod-grid prod-grid-rec" data-ind-products="${resolved.join(" ")}">
      ${cards}
      </div>`;
}

const GRID_OPEN = /<div class="prod-grid prod-grid-rec" data-ind-products="[^"]*"\s*>/;

// Replaces the whole grid element, children included, so a rebuild cannot leave
// stale cards sitting behind a freshly rewritten data-ind-products attribute.
// A non-greedy regex cannot do this: the cards contain nested <div>s, so it would
// close on the first inner </div>. Walk the tags and match the depth instead.
export function replaceIndustryProductGrid(html, ids) {
  const open = html.match(GRID_OPEN);
  if (!open) return null;
  const start = open.index;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tag.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return `${html.slice(0, start)}${industryProductGrid(ids)}${html.slice(match.index + match[0].length)}`;
    }
  }
  throw new Error("Unclosed recommended-product grid");
}
