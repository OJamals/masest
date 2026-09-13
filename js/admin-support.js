const POLL_MS = 15_000;
const MAX_POLL_MS = 60_000;
const PRESENCE_HEARTBEAT_MS = 30_000;
const SEARCH_DELAY_MS = 250;

export function createSupportPoller({
  isHidden,
  isOpen,
  loadSummary,
  loadTickets,
  heartbeat = async () => {},
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (id) => window.clearTimeout(id),
  baseDelay = POLL_MS,
  maxDelay = MAX_POLL_MS,
} = {}) {
  let timerId = null;
  let failures = 0;
  let generation = 0;
  let stopped = false;
  const clear = () => { if (timerId !== null) clearTimer(timerId); timerId = null; };
  const schedule = () => {
    clear();
    if (stopped || isHidden()) return;
    timerId = setTimer(() => { timerId = null; void refresh(); }, Math.min(maxDelay, baseDelay * (2 ** failures)));
  };
  const refresh = async () => {
    stopped = false;
    clear();
    if (isHidden()) return false;
    const current = ++generation;
    try {
      const result = isOpen() ? await loadTickets() : await loadSummary();
      if (result === false) throw new Error("support_refresh_failed");
      if (current !== generation) return false;
      if (isOpen()) await heartbeat();
      failures = 0;
      return true;
    } catch {
      if (current === generation) failures += 1;
      return false;
    } finally { if (current === generation) schedule(); }
  };
  return {
    refresh,
    stop: () => { stopped = true; generation += 1; clear(); },
    visibilityChanged: () => isHidden() ? (stopped = true, clear(), Promise.resolve(false)) : refresh(),
  };
}

const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
};
const errorText = (error, fallback) => error?.data?.message || error?.data?.error || error?.message || fallback;
const routeSuppressesSupport = () => (
  /(?:^|\/)dashboard(?:\.html)?$/.test(location.pathname)
  && location.hash.replace(/^#/, "") === "messages"
) || document.body.classList.contains("support-suppressed");

// Ticket queue mounted on every staff page. It uses the ticket contract only:
// no thread lifecycle or start-thread compatibility action is retained here.
export function initAdminSupport({ auth, root = "", staff = null, openContext = null } = {}) {
  if (document.getElementById("adminSupportConsole") || !auth?.api) return null;
  if (!document.querySelector('link[data-masest-admin-support="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = root + "css/admin-support.css?v=20260913a";
    stylesheet.dataset.masestAdminSupport = "true";
    document.head.append(stylesheet);
  }
  const canWrite = staff?.role !== "read_only";
  const shell = document.createElement("aside");
  shell.id = "adminSupportConsole";
  shell.className = "site-support";
  shell.hidden = routeSuppressesSupport();
  shell.innerHTML = [
    '<section class="site-support__drawer" role="dialog" aria-modal="false" aria-labelledby="siteSupportTitle" data-view="queue" data-ticket-selected="false" hidden>',
    '<section class="site-support__list-pane"><header class="site-support__header"><div><p>Support</p><h2 id="siteSupportTitle">Tickets</h2><span data-support-summary>Loading…</span></div><div class="site-support__header-actions">',
    canWrite ? '<button type="button" data-support-new-ticket aria-label="New ticket"><i class="ph ph-plus" aria-hidden="true"></i></button>' : "",
    '<button type="button" data-support-settings-toggle aria-label="Support settings"><i class="ph ph-gear" aria-hidden="true"></i></button></div></header>',
    '<div class="site-support__queues" role="tablist" aria-label="Ticket queues"><button type="button" role="tab" data-support-queue="needs_reply" aria-selected="true">Needs reply</button><button type="button" role="tab" data-support-queue="mine" aria-selected="false">Mine</button><button type="button" role="tab" data-support-queue="unassigned" aria-selected="false">Unassigned</button><button type="button" role="tab" data-support-queue="waiting" aria-selected="false">Waiting</button><button type="button" role="tab" data-support-queue="resolved" aria-selected="false">Resolved</button></div>',
    '<div class="site-support__filters"><label class="search-field" for="siteSupportSearch"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search tickets</span><input id="siteSupportSearch" name="search" type="search" autocomplete="off" placeholder="Search ticket, customer, order…" maxlength="120"></label><button type="button" class="site-support__popover-trigger" data-support-filters-toggle aria-expanded="false" aria-controls="siteSupportFilters" aria-haspopup="dialog"><i class="ph ph-funnel" aria-hidden="true"></i><span>Filters</span><b data-support-filter-count hidden>0</b></button><div id="siteSupportFilters" class="site-support__popover site-support__filter-popover" data-support-filters role="dialog" aria-label="Ticket filters" hidden><label>Priority<select name="priority" data-support-priority><option value="">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select></label><label>Category<select name="category" data-support-category><option value="">All categories</option><option value="general">General</option><option value="product">Product</option><option value="order">Order</option><option value="shipping">Shipping</option><option value="billing">Billing</option><option value="account">Account</option><option value="technical">Technical</option></select></label><label>Assignee<select name="assignee" data-support-assignee><option value="">All assignees</option><option value="mine">Mine</option><option value="unassigned">Unassigned</option></select></label><button type="button" class="site-support__filters-clear" data-support-filters-clear>Clear filters</button></div></div>',
    '<p class="site-support__results" data-support-results role="status" aria-live="polite"></p><div class="site-support__tickets" data-support-tickets></div><button type="button" class="site-support__load-more" data-support-load-more hidden>Load more tickets</button></section>',
    '<section class="site-support__detail"><header class="site-support__conversation-toolbar"><div class="site-support__toolbar-lead"><button type="button" data-support-back aria-label="Back to tickets" hidden><i class="ph ph-arrow-left" aria-hidden="true"></i></button><div class="site-support__ticket-head" data-support-ticket-head hidden><p data-support-ticket-number></p><h3 data-support-ticket-subject></h3><span><span data-support-ticket-person></span><a class="site-support__context" data-support-ticket-account href="" hidden>View account</a></span></div><p data-support-view-label>Support tickets</p></div><div class="site-support__ticket-actions"><button type="button" class="site-support__status-trigger" data-support-ticket-status hidden><i class="ph ph-circle" aria-hidden="true"></i><span data-support-ticket-status-label></span></button><button type="button" class="site-support__optional-action" data-support-ticket-assignee hidden></button><button type="button" class="site-support__optional-action" data-support-ticket-priority hidden></button><button type="button" class="site-support__properties-trigger" data-support-properties-toggle aria-label="Properties" aria-expanded="false" aria-controls="siteSupportProperties" aria-haspopup="dialog" hidden><i class="ph ph-sliders-horizontal" aria-hidden="true"></i><span>Properties</span></button><button type="button" data-support-close aria-label="Close support menu"><i class="ph ph-x" aria-hidden="true"></i></button></div><div id="siteSupportProperties" class="site-support__popover site-support__properties-popover" data-support-properties role="dialog" aria-label="Ticket properties" hidden></div></header><div class="site-support__conversation-body" data-support-detail><div class="site-support__empty"><i class="ph ph-ticket" aria-hidden="true"></i><div><strong>No ticket selected</strong><p>Choose a ticket to review its conversation.</p></div></div></div><section class="site-support__settings" hidden><h3>Support settings</h3><label><input id="adminNotifySupportRequests" name="notify_admin_support_requests" type="checkbox" data-support-pref="notify_admin_support_requests"><span><b>New support requests</b><small>Email me when a buyer starts or reopens support.</small></span></label><label><input id="adminNotifyMessages" name="notify_admin_messages" type="checkbox" data-support-pref="notify_admin_messages"><span><b>Follow-up messages while away</b><small>Email me when a buyer follows up while I am away.</small></span></label><p data-support-settings-status role="status" aria-live="polite"></p></section></section></section>',
    '<button class="site-support__launcher" type="button" title="Customer support" aria-label="Open support tickets" aria-expanded="false"><i class="ph ph-lifebuoy" aria-hidden="true"></i><span>Support</span><b data-support-count hidden>0</b></button>',
  ].join("");
  document.body.append(shell);
  const $ = (selector) => shell.querySelector(selector);
  const drawer = $(".site-support__drawer");
  const launcher = $(".site-support__launcher");
  const list = $("[data-support-tickets]");
  const detail = $("[data-support-detail]");
  const summary = $("[data-support-summary]");
  const results = $("[data-support-results]");
  const counter = $("[data-support-count]");
  const search = $("#siteSupportSearch");
  const filterToggle = $("[data-support-filters-toggle]");
  const filtersPanel = $("[data-support-filters]");
  const filterCount = $("[data-support-filter-count]");
  const priority = $("[data-support-priority]");
  const category = $("[data-support-category]");
  const assignee = $("[data-support-assignee]");
  const more = $("[data-support-load-more]");
  const settings = $(".site-support__settings");
  const back = $("[data-support-back]");
  const viewLabel = $("[data-support-view-label]");
  const ticketHead = $("[data-support-ticket-head]");
  const ticketNumber = $("[data-support-ticket-number]");
  const ticketSubject = $("[data-support-ticket-subject]");
  const ticketPerson = $("[data-support-ticket-person]");
  const ticketAccount = $("[data-support-ticket-account]");
  const ticketStatus = $("[data-support-ticket-status]");
  const ticketStatusLabel = $("[data-support-ticket-status-label]");
  const ticketAssignee = $("[data-support-ticket-assignee]");
  const ticketPriority = $("[data-support-ticket-priority]");
  const propertiesToggle = $("[data-support-properties-toggle]");
  const propertiesPanel = $("[data-support-properties]");
  const idOf = (ticket) => String(ticket?.id || ticket?.ticket_id || "");
  const numberOf = (ticket) => String(ticket?.display_number || (ticket?.ticket_number ? "MAS-" + String(ticket.ticket_number).padStart(6, "0") : "Support ticket"));
  const personOf = (ticket) => ticket?.thread?.participant?.full_name || ticket?.participant?.full_name || ticket?.participant?.name || ticket?.requester?.full_name || ticket?.customer_name || "Company support";
  const companyOf = (ticket) => ticket?.thread?.company_name || ticket?.company?.name || ticket?.company_name || "";
  const subjectOf = (ticket) => ticket?.subject || ticket?.last_message_body || "Support request";
  const orderOf = (ticket) => ticket?.order_scope || ticket?.order || ticket?.primary_order || null;
  const draftKey = (id, orderId) => "masest.support.ticketDraft:" + id + ":" + (orderId || "all");
  const getDraft = (id, orderId) => { try { return sessionStorage.getItem(draftKey(id, orderId)) || ""; } catch { return ""; } };
  const saveDraft = (id, orderId, value) => { try { if (value) sessionStorage.setItem(draftKey(id, orderId), value); else sessionStorage.removeItem(draftKey(id, orderId)); } catch {} };
  const api = (url, options = {}) => auth.api(url, options);
  let queue = "needs_reply";
  let tickets = [];
  let selected = null;
  let orderId = null;
  let messages = [];
  let nextCursor = null;
  let nextMessageCursor = null;
  let assignees = [];
  let listAbort = null;
  let detailAbort = null;
  let searchTimer = null;
  let listRequest = 0;
  let detailRequest = 0;
  let detailFeedback = "";
  let handoffRequest = 0;
  let scopedHandoff = 0;
  let settingsLoaded = false;
  let poller = null;
  let composerGeneration = 0;
  let presenceOpen = false;
  let lastPresencePing = 0;
  let presenceRequest = Promise.resolve();
  let activePopover = null;
  let propertyPatchLane = Promise.resolve();
  let pendingPropertyPatches = 0;
  let propertyContextGeneration = 0;
  let ticketContextReady = false;
  let listScope = { companyId: null, orderId: null };

  const humanize = (value) => String(value || "").replaceAll("_", " ");
  const assigneeName = (value) => assignees.find((person) => person.id === value)?.name || assignees.find((person) => person.id === value)?.role || (value ? "Assigned" : "Unassigned");
  const popoverParts = (kind) => kind === "filters"
    ? { panel: filtersPanel, trigger: filterToggle }
    : { panel: propertiesPanel, trigger: propertiesToggle };
  const closeSupportPopover = ({ restoreFocus = false } = {}) => {
    if (!activePopover) return false;
    const { panel, trigger } = popoverParts(activePopover);
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    activePopover = null;
    if (restoreFocus && trigger.isConnected) requestAnimationFrame(() => trigger.focus());
    return true;
  };
  const positionSupportPopover = (kind, panel, trigger) => {
    const margin = 12;
    const gap = 4;
    const triggerRect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const roomBelow = Math.max(0, window.innerHeight - margin - triggerRect.bottom - gap);
    const roomAbove = Math.max(0, triggerRect.top - margin - gap);
    const minimumUsefulHeight = Math.min(panel.scrollHeight, 176);
    const useBelow = roomBelow >= minimumUsefulHeight || roomBelow >= roomAbove;
    const height = Math.min(panel.scrollHeight, useBelow ? roomBelow : roomAbove);
    const preferredLeft = kind === "filters" ? triggerRect.left : triggerRect.right - width;
    panel.style.left = `${Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin))}px`;
    panel.style.top = `${useBelow ? triggerRect.bottom + gap : triggerRect.top - gap - height}px`;
    panel.style.maxHeight = `${height}px`;
  };
  const openSupportPopover = (kind, { focusField = null } = {}) => {
    const { panel, trigger } = popoverParts(kind);
    if (kind === "properties" && !selected) return;
    if (activePopover === kind && !panel.hidden) return void closeSupportPopover({ restoreFocus: true });
    closeSupportPopover();
    activePopover = kind;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    positionSupportPopover(kind, panel, trigger);
    requestAnimationFrame(() => {
      const target = focusField ? panel.querySelector(`[data-ticket-field="${focusField}"]`) : panel.querySelector("select, button, a, [tabindex]");
      target?.focus();
    });
  };
  const updateFilterCount = () => {
    const count = [priority, category, assignee].filter((input) => input.value).length;
    filterCount.hidden = count === 0;
    filterCount.textContent = String(count);
    filterToggle.setAttribute("aria-label", count ? `Filters, ${count} active` : "Filters");
  };
  const hideTicketChrome = () => {
    closeSupportPopover();
    ticketHead.hidden = true;
    [ticketStatus, ticketAssignee, ticketPriority, propertiesToggle].forEach((node) => { node.hidden = true; });
  };
  const invalidateTicketContext = ({ hideChrome = false } = {}) => {
    closeSupportPopover();
    propertyContextGeneration += 1;
    ticketContextReady = false;
    detailAbort?.abort();
    detailAbort = null;
    detailRequest += 1;
    if (hideChrome) hideTicketChrome();
  };

  // Serialize transitions: a delayed open must settle before a later close is
  // sent, otherwise the server can retain an active inbox after the drawer is
  // gone. The conditional rollback only applies if nothing newer superseded it.
  const setPresence = async (open, { force = false, keepalive = false } = {}) => {
    if (!force && presenceOpen === open) return;
    presenceOpen = open;
    presenceRequest = presenceRequest.catch(() => {}).then(() => auth.api("/api/admin/message-settings", {
      method: "POST", body: { action: "inbox_presence", inbox_open: open }, keepalive,
    })).then(() => { if (open) lastPresencePing = Date.now(); });
    try { await presenceRequest; }
    catch { if (presenceOpen === open) presenceOpen = !open; }
  };

  const setView = (view) => {
    closeSupportPopover();
    if (view === "settings" || view === "compose") invalidateTicketContext();
    drawer.dataset.view = view;
    settings.hidden = view !== "settings";
    detail.hidden = view === "settings";
    back.hidden = !(view === "settings" || view === "compose" || selected);
    viewLabel.textContent = view === "settings" ? "Support settings" : view === "compose" ? "New ticket" : selected ? "Ticket detail" : "Support tickets";
    const showTicket = Boolean(selected) && view !== "settings" && view !== "compose";
    viewLabel.hidden = showTicket;
    ticketHead.hidden = !showTicket;
    [ticketStatus, ticketAssignee, ticketPriority, propertiesToggle].forEach((node) => { node.hidden = !showTicket; });
    if (view === "settings") void loadSettings();
  };
  const setOpen = (open, focus = null) => {
    if (!open) invalidateTicketContext({ hideChrome: true });
    drawer.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) { void setPresence(true); void poller?.refresh();
      if (selected && !ticketContextReady && !["settings", "compose"].includes(drawer.dataset.view)) void loadTicket(idOf(selected), { scopedOrderId: orderId });
      requestAnimationFrame(() => (focus || search).focus());
    }
    else { void setPresence(false); setView("queue"); hideTicketChrome(); launcher.focus(); }
  };
  const openLinkedContext = async (event, type, id) => {
    if (typeof openContext !== "function") return;
    event.preventDefault();
    setOpen(false);
    try { if ((await openContext({ type, id }))?.cancelled) setOpen(true); }
    catch { setOpen(true); }
  };
  const renderSummary = (data = {}) => {
    const needsReply = Number(data.needs_reply ?? data.unanswered ?? 0);
    counter.hidden = needsReply === 0;
    counter.textContent = String(needsReply);
    summary.textContent = needsReply ? String(needsReply) + (needsReply === 1 ? " ticket needs reply" : " tickets need reply") : Number(data.open || 0) ? String(data.open) + " open tickets" : "Inbox clear";
  };
  const option = (label, value, selectedValue) => {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    node.selected = value === (selectedValue || "");
    return node;
  };
  const propertyFields = [
    ["Status", "status", ["open", "waiting_on_customer", "resolved"]],
    ["Priority", "priority", ["normal", "high", "urgent"]],
    ["Category", "category", ["general", "product", "order", "shipping", "billing", "account", "technical"]],
    ["Assignee", "assigned_to", []],
  ];
  const propertyValue = (field) => field === "assigned_to" ? assigneeName(selected?.assigned_to) : humanize(selected?.[field]);
  const renderProperties = () => {
    propertiesPanel.replaceChildren();
    if (!selected) return;
    const subject = subjectOf(selected);
    propertiesPanel.setAttribute("aria-label", `Ticket properties for ${subject}`);
    const title = document.createElement("h4"); title.className = "site-support__properties-title"; title.textContent = subject;
    propertiesPanel.append(title);
    const scopedOrder = orderOf(selected);
    if (scopedOrder) {
      const order = document.createElement("a"); order.className = "site-support__order-scope"; order.href = scopedOrder.admin_url || root + "admin.html?order=" + encodeURIComponent(scopedOrder.id) + "#orders"; order.textContent = "Order " + (scopedOrder.reference || scopedOrder.order_number || scopedOrder.id); order.dataset.supportOrderId = scopedOrder.id;
      order.addEventListener("click", (event) => void openLinkedContext(event, "order", scopedOrder.id));
      propertiesPanel.append(order);
    }
    if (!canWrite) {
      const values = document.createElement("dl");
      values.className = "site-support__property-values";
      propertyFields.forEach(([label, field]) => {
        const term = document.createElement("dt"); term.textContent = label;
        const value = document.createElement("dd"); value.textContent = propertyValue(field) || "Not set";
        values.append(term, value);
      });
      const notice = document.createElement("p"); notice.className = "site-support__notice"; notice.textContent = "Your staff role has read-only access.";
      propertiesPanel.append(values, notice);
      return;
    }
    propertyFields.forEach(([label, field, values]) => {
      const node = document.createElement("label"); node.textContent = label;
      const select = document.createElement("select"); select.dataset.ticketField = field;
      if (field === "assigned_to") {
        select.append(option("Unassigned", "", selected.assigned_to));
        assignees.forEach((person) => select.append(option(person.name || person.role || "Staff", person.id, selected.assigned_to)));
      } else values.forEach((value) => select.append(option(humanize(value), value, selected[field])));
      select.addEventListener("change", () => void patchTicket(field, select.value || null));
      node.append(select); propertiesPanel.append(node);
    });
  };
  const syncPropertyValues = () => {
    propertiesPanel.querySelectorAll("[data-ticket-field]").forEach((select) => {
      const field = select.dataset.ticketField;
      select.value = selected?.[field] || "";
    });
  };
  const syncTicketHeader = ({ rebuildProperties = true } = {}) => {
    if (!selected) return;
    const subject = subjectOf(selected);
    ticketHead.hidden = false;
    ticketNumber.textContent = numberOf(selected);
    ticketSubject.textContent = subject;
    ticketSubject.title = subject;
    const company = companyOf(selected);
    ticketPerson.textContent = personOf(selected) + (company ? " · " + company : "");
    const companyId = selected.thread?.company_id || selected.company?.id || selected.company_id || null;
    ticketAccount.hidden = !companyId;
    if (companyId) {
      ticketAccount.href = root + "admin.html#companies";
      ticketAccount.dataset.supportContext = "company";
      ticketAccount.dataset.contextId = companyId;
    }
    ticketStatus.hidden = false;
    const statusText = `Status: ${humanize(selected.status || "open")}`;
    ticketStatus.setAttribute("aria-label", statusText);
    ticketStatusLabel.textContent = humanize(selected.status || "open");
    ticketAssignee.hidden = false;
    ticketAssignee.textContent = `Assignee: ${assigneeName(selected.assigned_to)}`;
    const priorityValue = selected.priority || "normal";
    ticketPriority.hidden = priorityValue === "normal";
    ticketPriority.textContent = `Priority: ${humanize(priorityValue)}`;
    propertiesToggle.hidden = false;
    propertiesToggle.setAttribute("aria-label", "Properties");
    if (rebuildProperties) renderProperties();
    else syncPropertyValues();
  };
  const renderList = () => {
    list.replaceChildren();
    if (!tickets.length) {
      list.innerHTML = '<div class="site-support__empty"><i class="ph ph-ticket" aria-hidden="true"></i><div><strong>No tickets here</strong><p>Try another queue or filter.</p></div></div>';
      results.textContent = "No tickets";
    } else {
      results.textContent = String(tickets.length) + (tickets.length === 1 ? " ticket" : " tickets");
      tickets.forEach((ticket) => {
        const id = idOf(ticket);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "site-support__ticket" + (id === idOf(selected) ? " is-selected" : "");
        button.dataset.supportTicketId = id;
        button.setAttribute("aria-pressed", String(id === idOf(selected)));
        const title = document.createElement("span");
        title.className = "site-support__ticket-title";
        const number = document.createElement("small"); number.textContent = numberOf(ticket);
        const subject = document.createElement("strong"); subject.textContent = subjectOf(ticket);
        const company = companyOf(ticket);
        const person = document.createElement("em"); person.textContent = personOf(ticket) + (company ? " · " + company : "");
        title.append(number, subject, person);
        const meta = document.createElement("span"); meta.className = "site-support__ticket-meta";
        const dateNode = document.createElement("time"); dateNode.textContent = date(ticket.last_message_at || ticket.updated_at); meta.append(dateNode);
        ["priority", "category"].forEach((key) => {
          if (!ticket[key]) return;
          const badge = document.createElement("span"); badge.className = "badge" + (ticket[key] === "urgent" ? " badge-danger" : ticket[key] === "high" ? " badge-warning" : ""); badge.textContent = String(ticket[key]).replaceAll("_", " "); meta.append(badge);
        });
        if (getDraft(id, orderOf(ticket)?.id || ticket.order_id || ticket.primary_order_id)) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Draft"; meta.append(badge); }
        button.append(title, meta);
        list.append(button);
      });
    }
    more.hidden = !nextCursor;
    more.disabled = false;
  };
  const queryUrl = (cursor = null) => {
    const params = new URLSearchParams({ queue, limit: "50" });
    if (assignee.value) params.set("assignee", assignee.value);
    if (priority.value) params.set("priority", priority.value);
    if (category.value) params.set("category", category.value);
    if (search.value.trim()) params.set("search", search.value.trim().slice(0, 120));
    if (listScope.companyId) params.set("company_id", listScope.companyId);
    if (listScope.orderId) params.set("order_id", listScope.orderId);
    if (cursor) params.set("cursor", cursor);
    return "/api/admin/messages?" + params;
  };
  const loadTickets = async ({ append = false, cursor = null } = {}) => {
    if (scopedHandoff) return true;
    const pendingSearch = searchTimer !== null;
    if (pendingSearch) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (pendingSearch && append) {
      append = false;
      cursor = null;
    }
    listAbort?.abort();
    listAbort = new AbortController();
    const request = ++listRequest;
    if (!append) list.innerHTML = '<div class="site-support__skeleton" aria-label="Loading tickets"><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div></div>';
    try {
      const result = await api(queryUrl(cursor), { signal: listAbort.signal });
      if (request !== listRequest) return false;
      const seen = new Map((append ? tickets : []).map((ticket) => [idOf(ticket), ticket]));
      (result.tickets || []).forEach((ticket) => seen.set(idOf(ticket), ticket));
      tickets = [...seen.values()];
      nextCursor = result.has_more ? result.next_cursor || null : null;
      if (result.summary) renderSummary(result.summary);
      renderList();
      return true;
    } catch (error) {
      if (error?.name === "AbortError" || request !== listRequest) return false;
      list.innerHTML = '<div class="site-support__error" role="alert"><p>Could not load tickets.</p><button type="button" data-support-retry>Retry</button></div>';
      return false;
    }
  };
  const loadSummary = async () => {
    try { const result = await api("/api/admin/messages?summary=1"); renderSummary(result.summary || result); return true; } catch { return false; }
  };
  const loadAssignees = async () => {
    if (assignees.length) return;
    try {
      const result = await api("/api/admin/messages?view=assignees");
      assignees = result.assignees || [];
      assignees.forEach((person) => assignee.append(option(person.name || person.role || "Staff", person.id)));
      if (selected && ticketContextReady && !["settings", "compose"].includes(drawer.dataset.view)) { renderProperties(); syncTicketHeader({ rebuildProperties: false }); }
    } catch {}
  };
  const renderDetail = () => {
    if (!selected) return;
    detail.replaceChildren();
    syncTicketHeader();
    if (detailFeedback) {
      const feedback = document.createElement("p"); feedback.className = "site-support__feedback"; feedback.dataset.supportDetailFeedback = ""; feedback.setAttribute("role", "status"); feedback.textContent = detailFeedback; detail.append(feedback);
    }
    if (nextMessageCursor) { const older = document.createElement("button"); older.type = "button"; older.className = "site-support__older"; older.textContent = "Load earlier messages"; older.addEventListener("click", () => void loadTicket(idOf(selected), { older: true })); detail.append(older); }
    const history = document.createElement("div"); history.className = "site-support__messages";
    messages.forEach((message) => {
      const item = document.createElement("article"); item.dataset.role = message.sender_role || "buyer";
      if (message.order?.id) {
        const messageOrder = document.createElement("a");
        messageOrder.className = "site-support__message-order";
        messageOrder.href = message.order.admin_url || root + "admin.html?order=" + encodeURIComponent(message.order.id) + "#orders";
        messageOrder.textContent = "Order " + (message.order.reference || message.order.order_number || message.order.id);
        messageOrder.dataset.supportContext = "order";
        messageOrder.dataset.contextId = message.order.id;
        messageOrder.addEventListener("click", (event) => void openLinkedContext(event, "order", message.order.id));
        item.append(messageOrder);
      }
      const body = document.createElement("p"); body.textContent = message.body || ""; const dateNode = document.createElement("time"); dateNode.textContent = (message.sender_role === "staff" ? "Support" : personOf(selected)) + " · " + date(message.created_at); item.append(body, dateNode); history.append(item);
    });
    if (!messages.length) history.innerHTML = '<p class="site-support__notice">No messages yet.</p>';
    detail.append(history);
    if (canWrite && selected.status !== "resolved") {
      const form = document.createElement("form"); form.className = "site-support__reply";
      form.innerHTML = '<label for="siteSupportReply">Reply <small>⌘/Ctrl + Enter sends</small></label><textarea id="siteSupportReply" name="reply" maxlength="4000" required></textarea><div><span role="status" aria-live="polite"></span><button type="submit" class="btn btn-primary">Send reply</button></div>';
      const textarea = form.querySelector("textarea"); textarea.value = getDraft(idOf(selected), orderId);
      const selectedId = idOf(selected); const selectedOrderId = orderId;
      textarea.addEventListener("input", () => saveDraft(selectedId, selectedOrderId, textarea.value));
      textarea.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); } });
      form.addEventListener("submit", (event) => void reply(event));
      detail.append(form);
    } else if (selected.status === "resolved") detail.insertAdjacentHTML("beforeend", '<p class="site-support__notice">This ticket is resolved. Reopen it before replying.</p>');
  };
  const loadTicket = async (id, { older = false, scopedOrderId = null } = {}) => {
    const listTicket = tickets.find((ticket) => idOf(ticket) === id);
    const requestedOrderId = scopedOrderId || (older ? orderId : (orderOf(listTicket)?.id || listTicket?.order_id || listTicket?.primary_order_id || (idOf(selected) === id ? orderId : null)));
    if (!older) {
      propertyContextGeneration += 1;
      ticketContextReady = false;
      hideTicketChrome();
      viewLabel.hidden = false;
      viewLabel.textContent = "Loading ticket";
      detail.innerHTML = '<p class="site-support__placeholder">Loading ticket…</p>';
    }
    detailAbort?.abort();
    detailAbort = new AbortController();
    const request = ++detailRequest;
    const params = new URLSearchParams({ ticket_id: id });
    if (requestedOrderId) params.set("order_id", requestedOrderId);
    if (older && nextMessageCursor) params.set("message_cursor", nextMessageCursor);
    try {
      const result = await api("/api/admin/messages?" + params, { signal: detailAbort.signal });
      if (request !== detailRequest) return;
      selected = result.ticket
        ? { ...result.ticket, ...(result.thread ? { thread: result.thread } : {}), ...(result.order_scope ? { order_scope: result.order_scope } : {}) }
        : tickets.find((ticket) => idOf(ticket) === id) || selected;
      orderId = result.order_scope?.id || selected?.order?.id || selected?.order_id || selected?.primary_order_id || requestedOrderId || null;
      messages = older ? [...(result.messages || []), ...messages] : result.messages || [];
      nextMessageCursor = result.has_more ? result.next_message_cursor || null : null;
      ticketContextReady = true;
      drawer.dataset.ticketSelected = "true";
      setView("detail"); renderList(); renderDetail();
      if (!older) detail.querySelector(".site-support__messages")?.scrollTo({ top: 999999, behavior: "instant" });
    } catch (error) { if (error?.name !== "AbortError" && request === detailRequest) detail.innerHTML = '<p class="site-support__error">Could not load this ticket.</p>'; }
  };
  const renderDetailFeedback = () => {
    let feedback = detail.querySelector("[data-support-detail-feedback]");
    if (!detailFeedback) { feedback?.remove(); return; }
    if (!feedback) {
      feedback = document.createElement("p");
      feedback.className = "site-support__feedback";
      feedback.dataset.supportDetailFeedback = "";
      feedback.setAttribute("role", "status");
      detail.prepend(feedback);
    }
    feedback.textContent = detailFeedback;
  };
  const patchTicket = async (field, value) => {
    if (!selected || !ticketContextReady) return;
    const id = idOf(selected); const selectedOrderId = orderId; const propertyGeneration = propertyContextGeneration;
    pendingPropertyPatches += 1;
    propertiesPanel.setAttribute("aria-busy", "true");
    const update = propertyPatchLane.catch(() => {}).then(async () => {
      if (!ticketContextReady || propertyGeneration !== propertyContextGeneration || !selected || idOf(selected) !== id || orderId !== selectedOrderId) return;
      const version = selected.version; const selectionRequest = detailRequest;
      try {
        const result = await api("/api/admin/messages", { method: "PATCH", body: { ticket_id: id, version, [field]: value } });
        if (propertyGeneration !== propertyContextGeneration || selectionRequest !== detailRequest || idOf(selected) !== id || orderId !== selectedOrderId) return;
        detailFeedback = "";
        selected = result.ticket
          ? { ...selected, ...result.ticket, ...(selected.thread ? { thread: selected.thread } : {}), ...(selected.order_scope ? { order_scope: selected.order_scope } : {}) }
          : { ...selected, [field]: value, version: Number(selected.version || 0) + 1 };
        tickets = tickets.map((ticket) => idOf(ticket) === id ? { ...ticket, ...selected } : ticket);
        renderList();
        if (field === "status") {
          const previousHistory = detail.querySelector(".site-support__messages");
          const previousScrollTop = previousHistory?.scrollTop || 0;
          const wasAtBottom = previousHistory ? previousHistory.scrollHeight - previousHistory.clientHeight - previousHistory.scrollTop <= 4 : true;
          const focusedField = propertiesPanel.contains(document.activeElement) ? document.activeElement?.dataset?.ticketField : null;
          renderDetail();
          const nextHistory = detail.querySelector(".site-support__messages");
          if (nextHistory) nextHistory.scrollTop = wasAtBottom ? nextHistory.scrollHeight : previousScrollTop;
          if (activePopover === "properties" && !propertiesPanel.hidden) {
            positionSupportPopover("properties", propertiesPanel, propertiesToggle);
            requestAnimationFrame(() => (focusedField ? propertiesPanel.querySelector(`[data-ticket-field="${focusedField}"]`) : propertiesPanel.querySelector("select"))?.focus());
          }
        } else {
          syncTicketHeader({ rebuildProperties: false });
          renderDetailFeedback();
        }
      } catch (error) {
        if (propertyGeneration !== propertyContextGeneration || selectionRequest !== detailRequest || idOf(selected) !== id) return;
        const conflict = error?.status === 409 || /conflict|stale/i.test(String(error?.data?.error || error?.message || ""));
        detailFeedback = conflict ? "Ticket changed. Reloading the latest ticket." : errorText(error, "Could not update this ticket.");
        if (conflict) await loadTicket(id);
        else { syncTicketHeader({ rebuildProperties: false }); renderDetailFeedback(); }
      }
    });
    propertyPatchLane = update.catch(() => {});
    try { await update; }
    finally {
      pendingPropertyPatches -= 1;
      if (!pendingPropertyPatches) propertiesPanel.removeAttribute("aria-busy");
    }
  };
  const reply = async (event) => {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget; const textarea = form.querySelector("textarea"); const status = form.querySelector('[role="status"]'); const send = form.querySelector('[type="submit"]'); const body = textarea.value.trim();
    if (!body || send.disabled) return;
    send.disabled = true; status.textContent = "Sending…";
    const id = idOf(selected); const version = selected.version; const selectedOrderId = orderId; const selectionRequest = detailRequest; const submittedDraft = textarea.value;
    try {
      await api("/api/admin/messages", { method: "POST", body: { action: "reply", ticket_id: id, version, body, ...(selectedOrderId ? { order_id: selectedOrderId } : {}) } });
      // A successful send settles the submitted draft even if staff navigated away
      // while the request was in flight. Do not erase a newer edit made in place.
      if (getDraft(id, selectedOrderId) === submittedDraft) saveDraft(id, selectedOrderId, "");
      if (selectionRequest !== detailRequest || idOf(selected) !== id || orderId !== selectedOrderId) return;
      detailFeedback = "";
      await loadTicket(id); await loadTickets();
    } catch (error) {
      if (selectionRequest !== detailRequest || idOf(selected) !== id) return;
      const conflict = error?.status === 409 || /conflict|stale|resolved/i.test(String(error?.data?.error || error?.message || ""));
      detailFeedback = conflict ? "Ticket changed. Your draft is kept while the latest ticket reloads." : errorText(error, "Could not send reply. Your draft is kept.");
      status.textContent = detailFeedback;
      send.disabled = false;
      if (conflict) await loadTicket(id);
    }
  };
  const renderComposer = (profile = null, company = null, orders = []) => {
    const generation = ++composerGeneration;
    detail.innerHTML = '<header class="site-support__ticket-head"><div><p>Support</p><h3>New ticket</h3><span>Start a customer support ticket.</span></div></header><div data-support-recipient></div><form class="site-support__composer"><label>Subject<input name="subject" autocomplete="off" required maxlength="160" placeholder="What does the customer need?…"></label><label>Category<select name="category"><option value="general">General</option><option value="product">Product</option><option value="order">Order</option><option value="shipping">Shipping</option><option value="billing">Billing</option><option value="account">Account</option><option value="technical">Technical</option></select></label><label data-support-order hidden>Order<select name="order_id"></select></label><label>Message<textarea name="body" required maxlength="4000"></textarea></label><div><span role="status" aria-live="polite"></span><button class="btn btn-primary" type="submit" disabled>Start ticket</button></div></form>';
    const recipient = detail.querySelector("[data-support-recipient]");
    const form = detail.querySelector(".site-support__composer");
    const submit = form.querySelector('[type="submit"]');
    if (!profile) {
      recipient.innerHTML = '<label>Recipient<input name="recipient_search" type="search" data-support-recipient-search placeholder="Find a customer…" autocomplete="off"></label><div data-support-recipient-results></div>';
      recipient.querySelector("input").addEventListener("input", () => void searchRecipients(recipient.querySelector("input").value));
    } else {
      recipient.innerHTML = '<div class="site-support__recipient"><b></b><span></span></div>';
      recipient.querySelector("b").textContent = profile.full_name || profile.email;
      recipient.querySelector("span").textContent = company?.name || profile.email || "";
      const orderWrap = form.querySelector("[data-support-order]"); const select = form.elements.order_id; orderWrap.hidden = false;
      select.append(option("General support", ""));
      orders.forEach((order) => select.append(option((order.order_number || order.reference || order.id) + (order.status ? " · " + order.status : ""), order.id)));
      submit.disabled = false;
      form.addEventListener("submit", (event) => void startTicket(event, profile, generation));
      requestAnimationFrame(() => form.elements.subject.focus());
    }
  };
  const searchRecipients = async (query) => {
    const box = detail.querySelector("[data-support-recipient-results]");
    if (!box || !query.trim()) { if (box) box.replaceChildren(); return; }
    try {
      const result = await api("/api/admin/customers?limit=12&q=" + encodeURIComponent(query.trim().slice(0, 120)));
      box.replaceChildren();
      (result.customers || []).forEach((customer) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = (customer.full_name || customer.email) + (customer.company_name ? " · " + customer.company_name : ""); button.addEventListener("click", () => void loadRecipient(customer.id, orderId)); box.append(button);
      });
      if (!box.childElementCount) box.textContent = "No customers found.";
    } catch { box.textContent = "Could not search customers."; }
  };
  const loadRecipient = async (userId, selectedOrder = null) => {
    try { const result = await api("/api/admin/users?detail=" + encodeURIComponent(userId)); renderComposer(result.profile, result.company, result.orders || []); if (selectedOrder) detail.querySelector('[name="order_id"]').value = selectedOrder; }
    catch { detail.innerHTML = '<p class="site-support__error">Could not load this customer.</p>'; }
  };
  const startTicket = async (event, profile, generation) => {
    event.preventDefault();
    const form = event.currentTarget; const status = form.querySelector('[role="status"]'); const submit = form.querySelector('[type="submit"]'); const fields = [...form.elements];
    // Capture the intended request before disabling controls: disabled form
    // controls are deliberately omitted by FormData.
    const value = Object.fromEntries(new FormData(form));
    fields.forEach((field) => { field.disabled = true; }); status.textContent = "Starting…";
    try {
      const result = await api("/api/admin/messages", { method: "POST", body: { action: "start_ticket", recipient_user_id: profile.id, subject: value.subject, category: value.category, body: value.body, ...(value.order_id ? { order_id: value.order_id } : {}) } });
      // The ticket is durable server-side, but an old composer must never pull
      // staff away from a newer queue, detail, or account handoff.
      if (generation !== composerGeneration || drawer.dataset.view !== "compose" || !detail.contains(form)) return;
      queue = "needs_reply"; shell.querySelectorAll("[data-support-queue]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.supportQueue === queue)));
      await loadTickets();
      const id = idOf(result.ticket || result) || result.ticket_id;
      if (id) await loadTicket(id);
    } catch (error) {
      if (generation !== composerGeneration || drawer.dataset.view !== "compose" || !detail.contains(form)) return;
      status.textContent = errorText(error, "Could not start ticket."); fields.forEach((field) => { field.disabled = false; }); submit.disabled = false;
    }
  };
  const loadSettings = async () => {
    if (settingsLoaded) return;
    try { const data = await api("/api/admin/message-settings"); settings.querySelectorAll("[data-support-pref]").forEach((input) => { input.checked = data[input.dataset.supportPref] === true; }); settingsLoaded = true; }
    catch { $("[data-support-settings-status]").textContent = "Could not load settings."; }
  };
  const saveSettings = async () => {
    const status = $("[data-support-settings-status]"); status.textContent = "Saving…";
    try { await api("/api/admin/message-settings", { method: "PATCH", body: Object.fromEntries([...settings.querySelectorAll("[data-support-pref]")].map((input) => [input.dataset.supportPref, input.checked])) }); status.textContent = "Saved."; }
    catch { status.textContent = "Could not save settings."; }
  };
  const clearSelection = () => {
    invalidateTicketContext({ hideChrome: true }); selected = null; orderId = null; messages = []; nextMessageCursor = null; detailFeedback = ""; drawer.dataset.ticketSelected = "false"; setView("queue"); renderList(); detail.innerHTML = '<div class="site-support__empty"><i class="ph ph-ticket" aria-hidden="true"></i><div><strong>No ticket selected</strong><p>Choose a ticket to review its conversation.</p></div></div>';
  };
  const openQueue = async (next) => {
    handoffRequest += 1;
    scopedHandoff = 0;
    listScope = { companyId: null, orderId: null };
    queue = next; shell.querySelectorAll("[data-support-queue]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.supportQueue === queue))); clearSelection(); await loadTickets();
  };

  list.addEventListener("click", (event) => { const retry = event.target.closest("[data-support-retry]"); if (retry) return void loadTickets(); const ticket = event.target.closest("[data-support-ticket-id]"); if (ticket) void loadTicket(ticket.dataset.supportTicketId); });
  shell.querySelectorAll("[data-support-queue]").forEach((tab) => tab.addEventListener("click", () => void openQueue(tab.dataset.supportQueue)));
  [priority, category, assignee].forEach((input) => input.addEventListener("change", () => { updateFilterCount(); void loadTickets(); }));
  filterToggle.addEventListener("click", () => openSupportPopover("filters"));
  $("[data-support-filters-clear]").addEventListener("click", () => {
    priority.value = ""; category.value = ""; assignee.value = "";
    updateFilterCount();
    void loadTickets();
  });
  propertiesToggle.addEventListener("click", () => openSupportPopover("properties"));
  ticketStatus.addEventListener("click", () => openSupportPopover("properties", { focusField: "status" }));
  ticketAssignee.addEventListener("click", () => openSupportPopover("properties", { focusField: "assigned_to" }));
  ticketPriority.addEventListener("click", () => openSupportPopover("properties", { focusField: "priority" }));
  ticketAccount.addEventListener("click", (event) => {
    const companyId = ticketAccount.dataset.contextId;
    if (companyId) void openLinkedContext(event, "company", companyId);
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTimer = null; void loadTickets(); }, SEARCH_DELAY_MS);
  });
  more.addEventListener("click", () => { more.disabled = true; void loadTickets({ append: true, cursor: nextCursor }); });
  launcher.addEventListener("click", () => setOpen(drawer.hidden));
  $("[data-support-close]").addEventListener("click", () => setOpen(false));
  $("[data-support-new-ticket]")?.addEventListener("click", () => {
    handoffRequest += 1;
    scopedHandoff = 0;
    listScope = { companyId: null, orderId: null };
    selected = null;
    drawer.dataset.ticketSelected = "false";
    setView("compose");
    renderComposer();
    setOpen(true, detail.querySelector("[data-support-recipient-search]"));
  });
  const leaveSettings = () => {
    if (selected) return void loadTicket(idOf(selected), { scopedOrderId: orderId });
    setView("queue");
    requestAnimationFrame(() => shell.querySelector("[data-support-queue][aria-selected='true']")?.focus());
  };
  $("[data-support-settings-toggle]").addEventListener("click", () => {
    if (drawer.dataset.view === "settings") leaveSettings();
    else setView("settings");
    setOpen(true);
  });
  back.addEventListener("click", () => {
    if (drawer.dataset.view !== "settings") return clearSelection();
    leaveSettings();
  });
  settings.addEventListener("change", (event) => { if (event.target.matches("[data-support-pref]")) void saveSettings(); });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (activePopover && target) {
      const { panel, trigger: popoverTrigger } = popoverParts(activePopover);
      const propertyShortcut = activePopover === "properties" && target.closest("[data-support-ticket-status], [data-support-ticket-assignee], [data-support-ticket-priority]");
      if (!panel.contains(target) && !popoverTrigger.contains(target) && !propertyShortcut) closeSupportPopover();
    }
    const trigger = target?.closest("[data-support-open]");
    if (!trigger || shell.hidden) return;
    event.preventDefault();
    if (trigger.dataset.supportOpen === "settings") setView("settings");
    setOpen(true);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || drawer.hidden) return;
    if (activePopover) { event.preventDefault(); closeSupportPopover({ restoreFocus: true }); return; }
    if (drawer.dataset.view === "settings") leaveSettings();
    else setOpen(false);
  });
  window.addEventListener("resize", () => closeSupportPopover());
  const invalidateAuthContext = () => {
    if (!drawer.hidden) setOpen(false);
    else invalidateTicketContext({ hideChrome: true });
  };
  document.addEventListener("masest:session-expired", invalidateAuthContext);
  document.addEventListener("masest:auth", invalidateAuthContext);
  const syncRouteVisibility = () => { const suppressed = routeSuppressesSupport(); if (suppressed && !drawer.hidden) setOpen(false); shell.hidden = suppressed; };
  document.addEventListener("masest:support-route", syncRouteVisibility);
  window.addEventListener("hashchange", syncRouteVisibility);
  document.addEventListener("visibilitychange", () => {
    if (!drawer.hidden) void setPresence(!document.hidden, { force: true, keepalive: document.hidden });
    void poller?.visibilityChanged();
  });
  window.addEventListener("pagehide", () => {
    poller?.stop();
    if (!drawer.hidden) void setPresence(false, { force: true, keepalive: true });
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    if (!drawer.hidden && !document.hidden) void setPresence(true, { force: true });
    void poller?.visibilityChanged();
  });
  poller = createSupportPoller({
    isHidden: () => document.hidden,
    isOpen: () => !drawer.hidden,
    loadSummary,
    loadTickets,
    heartbeat: () => Date.now() - lastPresencePing > PRESENCE_HEARTBEAT_MS
      ? setPresence(true, { force: true })
      : Promise.resolve(),
  });
  void loadAssignees(); void poller.refresh();
  return {
    openThread: async (companyId, { orderId: requestedOrderId = null } = {}) => {
      const handoff = ++handoffRequest;
      scopedHandoff = handoff;
      listAbort?.abort();
      listRequest += 1;
      clearSelection();
      orderId = requestedOrderId || null;
      listScope = { companyId, orderId: requestedOrderId || null };
      setOpen(true);
      try {
        const params = new URLSearchParams({ queue: "all", company_id: companyId, limit: "100" });
        if (requestedOrderId) params.set("order_id", requestedOrderId);
        const scoped = await api("/api/admin/messages?" + params);
        if (handoff !== handoffRequest) return;
        scopedHandoff = 0;
        tickets = [...new Map((scoped.tickets || []).map((ticket) => [idOf(ticket), ticket])).values()];
        nextCursor = null;
        renderList();
        if (tickets[0]) await loadTicket(idOf(tickets[0]), { scopedOrderId: requestedOrderId });
        else { setView("compose"); renderComposer(); }
      } catch (error) {
        if (handoff !== handoffRequest) return;
        list.innerHTML = '<div class="site-support__error" role="alert"><p>Could not load tickets for this account.</p><button type="button" data-support-retry>Retry</button></div>';
      } finally {
        if (scopedHandoff === handoff) scopedHandoff = 0;
      }
    },
    openNewChat: async ({ userId = null, orderId: requestedOrderId = null } = {}) => { if (!canWrite) return; handoffRequest += 1; scopedHandoff = 0; listScope = { companyId: null, orderId: null }; clearSelection(); orderId = requestedOrderId || null; setOpen(true); setView("compose"); if (userId) await loadRecipient(userId, requestedOrderId); else renderComposer(); },
    open: () => setOpen(true),
    openSettings: () => { setView("settings"); setOpen(true); },
    refresh: () => poller.refresh(),
  };
}
