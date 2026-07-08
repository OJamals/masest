/* Client-side category filter for /blog. Progressive: all cards render
   server-side; this only shows/hides. */
(() => {
  const root = document.querySelector("[data-blog-filter]");
  if (!root) return;
  const chips = Array.from(root.querySelectorAll(".blog-chip"));
  const cards = Array.from(root.querySelectorAll(".blog-card"));
  const empty = root.querySelector(".blog-empty");
  const apply = (cat) => {
    let visible = 0;
    cards.forEach((card) => {
      const show = cat === "all" || card.dataset.category === cat;
      card.hidden = !show;
      if (show) visible++;
    });
    if (empty) empty.hidden = visible !== 0;
  };
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle("is-active", active);
        c.setAttribute("aria-pressed", active ? "true" : "false");
      });
      apply(chip.dataset.filterCat);
    });
  });
})();
