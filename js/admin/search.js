/* Cross-entity staff search.
 *
 * Every workspace has its own scoped search box, but nothing answered "show me
 * everything about Acme HVAC". This mounts one search in the staff chrome that
 * fans out across orders, quotes, accounts, people, and products, and routes the
 * chosen result into the workspace that owns it.
 *
 * Combobox pattern: input keeps focus, results are a listbox addressed through
 * aria-activedescendant, so arrow keys move the selection without moving focus.
 */

const TYPE_ICONS = {
  order: 'ph-package',
  quote: 'ph-clipboard-text',
  company: 'ph-buildings',
  contact: 'ph-address-book',
  product: 'ph-flask',
};

export function createAdminSearch({ api, esc, onSelect, debounce }) {
  let items = [];
  let activeIndex = -1;
  let seq = 0;
  let root;
  let input;
  let panel;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

  function close() {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function setActive(index) {
    const options = [...panel.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === activeIndex)));
    const active = options[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  function renderGroups(groups, query) {
    items = [];
    if (!groups.length) {
      panel.innerHTML = `<p class="adm-search-empty">No matches for “${esc(query)}”.</p>`;
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    panel.innerHTML = groups.map((group) => `
      <div class="adm-search-group" role="group" aria-label="${esc(group.label)}">
        <p class="adm-search-group-label">${esc(group.label)}</p>
        ${group.items.map((item) => {
          const index = items.push({ ...item, type: group.type }) - 1;
          return `<div class="adm-search-option" role="option" id="admSearchOption${index}" data-index="${index}" aria-selected="false">
            <i class="ph ${TYPE_ICONS[group.type] || 'ph-magnifying-glass'}" aria-hidden="true"></i>
            <span class="adm-search-option-copy"><b>${esc(item.title)}</b>${item.subtitle ? `<small>${esc(item.subtitle)}</small>` : ''}</span>
            ${item.meta ? `<span class="badge" data-s="${esc(item.meta)}">${esc(String(item.meta).replaceAll('_', ' '))}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('');
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  }

  async function run(query) {
    const token = ++seq;
    if (query.trim().length < 2) return close();
    panel.innerHTML = '<p class="adm-search-empty">Searching…</p>';
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    try {
      const result = await api(`/api/admin/search?q=${encodeURIComponent(query.trim())}`);
      if (token !== seq) return; // a newer keystroke already won
      renderGroups(result.groups || [], query);
    } catch {
      if (token !== seq) return;
      panel.innerHTML = '<p class="adm-search-empty">Search is unavailable. Retry.</p>';
    }
  }

  function choose(index) {
    const item = items[index];
    if (!item) return;
    close();
    input.value = '';
    input.blur();
    onSelect(item);
  }

  function mount(container) {
    root = document.createElement('div');
    root.className = 'adm-search-global';
    root.innerHTML = `
      <i class="ph ph-magnifying-glass adm-search-icon" aria-hidden="true"></i>
      <input id="admGlobalSearch" name="admin_search" class="adm-search-input" type="search" role="combobox" autocomplete="off"
        aria-expanded="false" aria-controls="admSearchResults" aria-autocomplete="list"
        aria-label="Search orders, quotes, accounts, people, and products"
        placeholder="Search orders, quotes, accounts…">
      <kbd class="adm-search-kbd" aria-hidden="true">${isMac ? '⌘' : 'Ctrl '}K</kbd>
      <div id="admSearchResults" class="adm-search-results" role="listbox" aria-label="Search results" hidden></div>`;
    container.append(root);
    input = root.querySelector('#admGlobalSearch');
    panel = root.querySelector('#admSearchResults');

    const search = debounce((value) => void run(value), 200);
    input.addEventListener('input', () => search(input.value));
    input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) panel.hidden = false; });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
      else if (event.key === 'Enter') { if (activeIndex >= 0) { event.preventDefault(); choose(activeIndex); } }
      else if (event.key === 'Escape') { close(); input.blur(); }
    });

    panel.addEventListener('mousedown', (event) => {
      // mousedown, not click: blur would close the panel before click lands.
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      event.preventDefault();
      choose(Number(option.dataset.index));
    });

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target)) close();
    });

    // ⌘K / Ctrl+K anywhere, and "/" when the user is not already typing.
    document.addEventListener('keydown', (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.focus();
        input.select();
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        input.focus();
      }
    });
  }

  return { mount };
}
