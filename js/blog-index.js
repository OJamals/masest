/* Progressive blog discovery. Every card remains server-rendered; this module
   composes category + text filters and keeps the selection shareable in the URL. */

const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase();

export function filterBlogPosts(posts, { category = "all", query = "" } = {}) {
  const activeCategory = normalized(category) || "all";
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return posts.filter((post) => {
    if (activeCategory !== "all" && normalized(post.category) !== activeCategory) return false;
    if (!terms.length) return true;
    const tags = Array.isArray(post.tags) ? post.tags.join(" ") : post.tags;
    const haystack = normalized([
      post.title,
      post.excerpt,
      post.category,
      tags,
      post.searchText,
    ].filter(Boolean).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

export function initBlogIndex(doc = document, win = window) {
  const root = doc.querySelector("[data-blog-filter]");
  if (!root) return null;

  const chips = [...root.querySelectorAll(".blog-chip")];
  const cards = [...root.querySelectorAll(".blog-card")];
  const search = root.querySelector("[data-blog-query]");
  const results = root.querySelector("[data-blog-results]");
  const empty = root.querySelector(".blog-empty");
  if (!search || !results || !empty) return null;

  const posts = cards.map((card) => ({
    card,
    category: card.dataset.category,
    tags: card.dataset.tags,
    searchText: card.textContent,
  }));
  let activeCategory = "all";

  const setCategory = (category) => {
    activeCategory = chips.some((chip) => chip.dataset.filterCat === category) ? category : "all";
    chips.forEach((chip) => {
      const active = chip.dataset.filterCat === activeCategory;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  };

  const syncUrl = () => {
    const url = new URL(win.location.href);
    const query = search.value.trim();
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (activeCategory !== "all") url.searchParams.set("category", activeCategory);
    else url.searchParams.delete("category");
    win.history.replaceState(win.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const apply = ({ updateUrl = true } = {}) => {
    const query = search.value.trim();
    const visible = new Set(filterBlogPosts(posts, { category: activeCategory, query }).map((post) => post.card));
    cards.forEach((card) => { card.hidden = !visible.has(card); });

    const count = visible.size;
    const filtered = Boolean(query) || activeCategory !== "all";
    results.textContent = count === 0
      ? (query ? "No articles match your search" : "No articles in this category")
      : (filtered ? `${count} of ${cards.length} articles` : `${count} articles`);
    empty.textContent = query
      ? "Try fewer words or a different category."
      : "Choose another category to see more articles.";
    empty.hidden = count !== 0;
    if (updateUrl) syncUrl();
  };

  const params = new URLSearchParams(win.location.search);
  search.value = params.get("q") || "";
  setCategory(params.get("category") || "all");
  apply({ updateUrl: false });

  chips.forEach((chip) => chip.addEventListener("click", () => {
    setCategory(chip.dataset.filterCat);
    apply();
  }));
  search.addEventListener("input", () => apply());
  root.querySelector("[data-blog-search]")?.addEventListener("submit", (event) => event.preventDefault());

  return { apply, setCategory };
}

if (typeof document !== "undefined") initBlogIndex();
