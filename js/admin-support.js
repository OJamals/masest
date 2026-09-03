const POLL_MS = 15_000;
const MAX_POLL_MS = 60_000;
const PRESENCE_HEARTBEAT_MS = 30_000;

export function createSupportPoller({
  isHidden,
  isOpen,
  loadSummary,
  loadThreads,
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

  const clear = () => {
    if (timerId === null) return;
    clearTimer(timerId);
    timerId = null;
  };
  const schedule = () => {
    clear();
    if (stopped || isHidden()) return;
    const delay = Math.min(maxDelay, baseDelay * (2 ** failures));
    timerId = setTimer(() => {
      timerId = null;
      return refresh();
    }, delay);
  };
  const refresh = async () => {
    stopped = false;
    clear();
    if (isHidden()) return false;
    const current = ++generation;
    try {
      const result = isOpen() ? await loadThreads() : await loadSummary();
      if (result === false) throw new Error("support_refresh_failed");
      if (current !== generation) return false;
      if (isOpen()) await heartbeat();
      failures = 0;
      return true;
    } catch {
      if (current === generation) failures += 1;
      return false;
    } finally {
      if (current === generation) schedule();
    }
  };
  const stop = () => {
    stopped = true;
    generation += 1;
    clear();
  };
  const visibilityChanged = () => {
    if (isHidden()) {
      stop();
      return Promise.resolve(false);
    }
    return refresh();
  };

  return { refresh, stop, visibilityChanged };
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
};

const routeSuppressesSupport = () => (
  /(?:^|\/)dashboard(?:\.html)?$/.test(location.pathname)
  && location.hash.replace(/^#/, "") === "messages"
) || document.body.classList.contains("support-suppressed");

export function filterSupportThreads(threads, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  if (!needle) return threads;
  return threads.filter((thread) => `${thread.participant?.full_name ?? ""}\n${thread.participant?.email ?? ""}\n${thread.company_name ?? ""}\n${thread.last_body ?? ""}`
    .toLocaleLowerCase()
    .includes(needle));
}

// Staff notification prefs. These used to live on their own admin page, which
// the drawer covered on a phone the moment the gear navigated there — so they
// are a view of the console now, not a page you leave the console for. The ids
// are kept from that page so deep-linked tooling still finds them.
const SUPPORT_PREFS = [
  ["adminNotifySupportRequests", "notify_admin_support_requests", "New support requests",
    "Email me when a buyer starts or reopens a support thread."],
  ["adminNotifyMessages", "notify_admin_messages", "Follow-up messages while away",
    "Email me when a buyer follows up while my support drawer is closed or inactive."],
];

export function initAdminSupport({ auth, root = "", staff = null, openContext = null } = {}) {
  // One console per document. admin.html used to ship its own static drawer +
  // launcher and this bailed there; both surfaces now mount this same console.
  if (document.getElementById("adminSupportConsole") || !auth?.api) return null;

  if (!document.querySelector('link[data-masest-admin-support="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${root}css/admin-support.css?v=20260903b`;
    stylesheet.dataset.masestAdminSupport = "true";
    document.head.append(stylesheet);
  }

  const canWrite = staff?.role !== "read_only";
  const shell = document.createElement("aside");
  shell.id = "adminSupportConsole";
  shell.className = "site-support";
  shell.hidden = routeSuppressesSupport();
  shell.innerHTML = `
    <section class="site-support__drawer" role="dialog" aria-modal="false" aria-labelledby="siteSupportTitle" data-view="inbox" data-thread-selected="false" hidden>
      <div class="site-support__list-pane">
        <header class="site-support__header">
          <div><p>Customer support</p><h2 id="siteSupportTitle">Open chats</h2><span data-support-summary>Loading…</span></div>
          <div class="site-support__header-actions">
            ${canWrite ? '<button type="button" data-support-new-chat aria-label="Start new customer chat" title="Start new customer chat"><i class="ph ph-plus" aria-hidden="true"></i></button>' : ""}
            <button type="button" data-support-settings-toggle aria-label="Customer support settings" title="Customer support settings" aria-expanded="false" aria-controls="siteSupportSettings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg></button>
          </div>
        </header>
        <div class="site-support__filters" role="group" aria-label="Conversation status">
          <button type="button" data-support-filter="open" aria-pressed="true">Open</button>
          <button type="button" data-support-filter="complete" aria-pressed="false">Resolved</button>
        </div>
        <div class="site-support__search">
          <label for="siteSupportSearch">Search customer chats</label>
          <input id="siteSupportSearch" name="support_search" type="search" autocomplete="off" placeholder="Customer or recent message…" aria-controls="siteSupportThreads" data-support-search>
          <p data-support-results role="status" aria-live="polite"></p>
        </div>
        <div class="site-support__threads" id="siteSupportThreads" aria-label="Open customer chats"></div>
      </div>
      <div class="site-support__conversation">
        <header class="site-support__conversation-toolbar">
          <div class="site-support__toolbar-lead">
            <button type="button" data-support-back aria-label="Back to conversations" title="Back to conversations" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg></button>
            <p data-support-view-label>Customer inbox</p>
          </div>
          <button type="button" data-support-close aria-label="Close support menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
        </header>
        <div class="site-support__conversation-body"><div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div></div>
        <button type="submit" form="siteSupportNewChatForm" data-support-compose-submit hidden>Start chat</button>
        <div class="site-support__settings" id="siteSupportSettings" hidden>
          <p class="site-support__settings-intro">Choose when you get support email alerts. These apply to your staff account only.</p>
          ${SUPPORT_PREFS.map(([id, key, title, help]) => `<label><input id="${id}" name="support_${key}" type="checkbox" data-support-pref="${key}"><span><b>${title}</b><small>${help}</small></span></label>`).join("")}
          <p class="site-support__settings-status" id="adminSupportSettingsStatus" role="status" aria-live="polite"></p>
        </div>
      </div>
    </section>
    <button class="site-support__launcher" type="button" title="Customer support" aria-label="Open customer support" aria-expanded="false" aria-controls="adminSupportConsole"><i class="ph ph-lifebuoy" aria-hidden="true"></i><span>Customer support</span><b data-support-count hidden>0</b></button>`;
  document.body.append(shell);

  document.querySelectorAll("[data-customer-chat-open]").forEach((link) => {
    link.textContent = "Customer support";
    link.setAttribute("href", "#adminSupportConsole");
    link.setAttribute("aria-label", "Open customer support");
  });

  const drawer = shell.querySelector(".site-support__drawer");
  const launcher = shell.querySelector(".site-support__launcher");
  const close = shell.querySelector("[data-support-close]");
  const launcherIcon = launcher.querySelector("i");
  const list = shell.querySelector(".site-support__threads");
  const listTitle = shell.querySelector("#siteSupportTitle");
  const filters = shell.querySelector(".site-support__filters");
  const search = shell.querySelector("[data-support-search]");
  const searchResults = shell.querySelector("[data-support-results]");
  const view = shell.querySelector(".site-support__conversation-body");
  const summary = shell.querySelector("[data-support-summary]");
  const counter = shell.querySelector("[data-support-count]");
  const settings = shell.querySelector(".site-support__settings");
  const settingsStatus = shell.querySelector(".site-support__settings-status");
  const settingsToggle = shell.querySelector("[data-support-settings-toggle]");
  const newChat = shell.querySelector("[data-support-new-chat]");
  const back = shell.querySelector("[data-support-back]");
  const viewLabel = shell.querySelector("[data-support-view-label]");
  const composeSubmit = shell.querySelector("[data-support-compose-submit]");
  let prefsLoaded = false;
  let threadFilter = "open";
  let threads = [];
  let threadsLoaded = false;
  const drafts = new Map();
  let selected = null;
  let activeOrderId = null;
  let messages = [];
  let page = { has_more: false, next_before: null };
  let threadRequestId = 0;
  let threadsRequestId = 0;
  let summaryRequestId = 0;
  let newChatRequestId = 0;
  let pendingNewChatOrderId = null;
  let poller = null;
  let presenceOpen = false;
  let lastPresencePing = 0;
  let presenceRequest = Promise.resolve();
  const draftKey = (threadId, companyId = null, orderId = activeOrderId) => (
    `${threadId || `company-${companyId || "none"}`}:${orderId || "all"}`
  );

  const setPresence = async (open, { force = false, keepalive = false } = {}) => {
    if (!force && presenceOpen === open) return;
    presenceOpen = open;
    presenceRequest = presenceRequest.catch(() => {}).then(() => auth.api("/api/admin/message-settings", {
      method: "POST", body: { action: "inbox_presence", inbox_open: open }, keepalive,
    })).then(() => { if (open) lastPresencePing = Date.now(); });
    try { await presenceRequest; }
    catch { if (presenceOpen === open) presenceOpen = !open; }
  };

  const prefInputs = () => [...settings.querySelectorAll("[data-support-pref]")];

  // Fetched the first time the settings view is opened rather than at mount:
  // this console loads on every staff page view, and most of them never ask.
  const loadPrefs = async () => {
    if (prefsLoaded) return;
    try {
      const data = await auth.api("/api/admin/message-settings");
      prefInputs().forEach((input) => { input.checked = data[input.dataset.supportPref] === true; });
      prefsLoaded = true;
      settingsStatus.textContent = "";
    } catch { settingsStatus.textContent = "Could not load settings."; }
  };

  const savePrefs = async () => {
    settingsStatus.textContent = "Saving…";
    try {
      await auth.api("/api/admin/message-settings", {
        method: "PATCH",
        body: Object.fromEntries(prefInputs().map((input) => [input.dataset.supportPref, input.checked])),
      });
      settingsStatus.textContent = "Saved.";
    } catch { settingsStatus.textContent = "Could not save settings."; }
  };

  const setView = (next) => {
    const isSettings = next === "settings";
    const isCompose = next === "compose";
    drawer.dataset.view = isSettings ? "settings" : isCompose ? "compose" : "inbox";
    settings.hidden = !isSettings;
    view.hidden = isSettings;
    back.hidden = !(isSettings || isCompose || selected);
    viewLabel.textContent = isSettings ? "Support settings" : isCompose ? "New chat" : selected ? "Conversation" : "Customer inbox";
    if (!isCompose) {
      composeSubmit.hidden = true;
      composeSubmit.disabled = false;
      composeSubmit.textContent = "Start chat";
    }
    settingsToggle.setAttribute("aria-expanded", String(isSettings));
    if (isSettings) void loadPrefs();
  };

  const setOpen = (open, { restoreFocus = true, focus = null } = {}) => {
    drawer.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close customer support" : "Open customer support");
    launcherIcon.className = open ? "ph ph-x" : "ph ph-lifebuoy";
    if (open) {
      summaryRequestId += 1;
      void setPresence(true);
      void poller?.refresh();
      requestAnimationFrame(() => (focus || search || close).focus());
    } else {
      threadsRequestId += 1;
      void setPresence(false);
      if (drawer.dataset.view === "compose") {
        newChatRequestId += 1;
        selected = null;
        activeOrderId = null;
        messages = [];
        page = { has_more: false, next_before: null };
        drawer.dataset.threadSelected = "false";
        view.innerHTML = '<div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div>';
      }
      // Reopening lands on conversations; settings is somewhere you go, not a state
      // the console gets stuck in.
      setView("inbox");
      if (restoreFocus) launcher.focus();
      void poller?.refresh();
    }
  };

  const openSettings = () => {
    setView("settings");
    setOpen(true, { focus: prefInputs()[0] || back });
  };

  // Leaving settings hands focus back to the gear that opened them — except at
  // phone width, where the pane holding that gear is not on screen.
  const leaveSettings = () => {
    setView("inbox");
    const target = settingsToggle.offsetParent
      ? settingsToggle
      : back.offsetParent
        ? back
        : list.querySelector("button") || close;
    target.focus();
  };
  const syncRouteVisibility = () => {
    const suppressed = routeSuppressesSupport();
    if (suppressed && !drawer.hidden) setOpen(false, { restoreFocus: false });
    shell.hidden = suppressed;
  };

  const renderSummary = ({ open = 0, unanswered = 0 } = {}) => {
    counter.hidden = unanswered === 0;
    counter.textContent = String(unanswered);
    summary.textContent = unanswered === 1 ? "1 chat needs a reply" : unanswered
      ? `${unanswered} chats need a reply`
      : open ? "No chats need a reply" : "Inbox clear";
  };

  const renderThreads = () => {
    const resolvedView = threadFilter === "complete";
    const ordered = [...threads].sort((a, b) => Number(b.unanswered) - Number(a.unanswered) || String(b.last_at).localeCompare(String(a.last_at)));
    const visible = filterSupportThreads(ordered, search.value);
    const unanswered = ordered.filter((thread) => thread.unanswered).length;
    listTitle.textContent = resolvedView ? "Resolved chats" : "Open chats";
    list.setAttribute("aria-label", resolvedView ? "Resolved customer chats" : "Open customer chats");
    if (resolvedView) summary.textContent = `${ordered.length} resolved ${ordered.length === 1 ? "chat" : "chats"}`;
    else renderSummary({ open: ordered.length, unanswered });
    if (!ordered.length) {
      searchResults.textContent = resolvedView ? "No resolved chats" : "No open chats";
      // A directly opened Company/order conversation can be valid before the
      // cached inbox list arrives (or while that list is empty). List rendering
      // must not erase the independently loaded conversation.
      if (!selected && drawer.dataset.view !== "compose") {
        drawer.dataset.threadSelected = "false";
        view.innerHTML = '<div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div>';
      }
      list.innerHTML = resolvedView
        ? '<div class="site-support__empty"><i class="ph ph-check-circle" aria-hidden="true"></i><div><strong>No resolved chats</strong><p>Resolved conversations appear here for later review.</p></div></div>'
        : '<div class="site-support__empty"><i class="ph ph-lifebuoy" aria-hidden="true"></i><div><strong>Inbox clear</strong><p>No open customer conversations.</p></div></div>';
      return;
    }
    const hasQuery = search.value.trim().length > 0;
    searchResults.textContent = hasQuery
      ? (visible.length ? `${visible.length} of ${ordered.length} chats shown` : "No chats match your search")
      : `${ordered.length} ${resolvedView ? "resolved" : "open"} ${ordered.length === 1 ? "chat" : "chats"}`;
    if (!visible.length) {
      list.innerHTML = '<div class="site-support__empty"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><div><strong>No matching chats</strong><p>Try a customer name or words from the latest message.</p></div></div>';
      return;
    }
    list.innerHTML = visible.map((thread) => {
      const hasDraft = [...drafts.entries()].some(([key, value]) => (
        key.startsWith(`${thread.thread_id}:`) && value.trim()
      ));
      const badges = `${thread.status === "escalated" ? "<em>Escalated</em>" : ""}${hasDraft ? "<em>Draft</em>" : ""}${thread.unanswered ? "<b>Needs reply</b>" : ""}`;
      const customer = thread.participant?.full_name || thread.participant?.email
        || thread.company_name || "Customer";
      const label = thread.order ? `[Order ${thread.order.reference}] / ${customer}` : customer;
      const context = thread.participant && thread.company_name ? ` · ${thread.company_name}`
        : thread.scope === "company" ? " · Business conversation" : "";
      const preview = `${(thread.last_body || "").slice(0, 90)}${context}`;
      const selectedThread = thread.thread_id === selected?.thread_id;
      return `<button type="button" class="site-support__thread${thread.unanswered ? " is-unanswered" : ""}${selectedThread ? " is-selected" : ""}" data-support-thread-id="${escapeHtml(thread.thread_id)}" aria-pressed="${selectedThread}"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(preview)}</small></span><span class="site-support__meta"><time datetime="${escapeHtml(thread.last_at)}">${escapeHtml(date(thread.last_at))}</time>${badges}</span></button>`;
    }).join("");
  };

  const setThreadFilter = async (next) => {
    if (!['open', 'complete'].includes(next) || next === threadFilter) return;
    threadRequestId += 1;
    newChatRequestId += 1;
    threadsRequestId += 1;
    threadFilter = next;
    threads = [];
    threadsLoaded = false;
    selected = null;
    activeOrderId = null;
    messages = [];
    page = { has_more: false, next_before: null };
    search.value = "";
    drawer.dataset.threadSelected = "false";
    setView("inbox");
    filters.querySelectorAll("[data-support-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.supportFilter === threadFilter));
    });
    listTitle.textContent = threadFilter === "complete" ? "Resolved chats" : "Open chats";
    view.innerHTML = '<div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div>';
    await loadThreads();
  };

  const clearThreadSelection = () => {
    threadRequestId += 1;
    newChatRequestId += 1;
    selected = null;
    activeOrderId = null;
    messages = [];
    page = { has_more: false, next_before: null };
    drawer.dataset.threadSelected = "false";
    renderThreads();
    view.innerHTML = '<div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div>';
    setView("inbox");
    requestAnimationFrame(() => (list.querySelector("button") || search || close).focus());
  };

  const renderConversation = () => {
    if (!selected) return;
    const threadId = String(selected.thread_id || "").trim() || null;
    const companyId = String(selected.company_id || "").trim() || null;
    const resolved = selected.status === "complete";
    const escalated = selected.status === "escalated";
    const activeOrder = selected.order_scope
      || (activeOrderId ? messages.find((message) => message.order_id === activeOrderId)?.order : null)
      || null;
    const linkedOrder = activeOrder || [...messages].reverse().find((message) => message.order)?.order || null;
    const participant = selected.participant || [...messages].reverse().find((message) => message.participant)?.participant || null;
    const participantThread = Boolean(selected.participant_user_id);
    const participantName = participant?.full_name || participant?.email || "Customer";
    const participantMeta = participant
      ? [
          participant.email && participant.email !== participantName ? participant.email : null,
          selected.company_name || null,
        ].filter(Boolean)
      : [];
    const participantDetail = participant
      ? `<span class="site-support__conversation-party">Chat with ${escapeHtml(participantName)}${participantMeta.length ? ` · ${participantMeta.map(escapeHtml).join(" · ")}` : ""}</span>`
      : selected.company_name
        ? '<span class="site-support__conversation-party">Business conversation</span>'
        : "";
    const contextLinks = `<nav class="site-support__context" aria-label="Customer context">
      ${companyId ? `<a href="${escapeHtml(`${root}admin.html#companies`)}" data-support-context="company" data-context-id="${escapeHtml(companyId)}"><i class="ph ph-buildings" aria-hidden="true"></i>View account</a>` : ""}
      ${linkedOrder ? `<a href="${escapeHtml(linkedOrder.admin_url || `${root}admin.html?order=${encodeURIComponent(linkedOrder.id)}#orders`)}" data-support-context="order" data-context-id="${escapeHtml(linkedOrder.id)}"><i class="ph ph-package" aria-hidden="true"></i>View order ${escapeHtml(linkedOrder.reference)}</a>` : ""}
    </nav>`;
    const orderScope = activeOrder ? `<div class="site-support__order-scope"><span><i class="ph ph-package" aria-hidden="true"></i>Replying about <b>order ${escapeHtml(activeOrder.reference)}</b>${activeOrder.status ? ` · ${escapeHtml(activeOrder.status.replaceAll("_", " "))}` : ""}</span><button type="button" data-support-full-thread>Full conversation</button></div>` : "";
    const controls = canWrite && threadId
      ? `<div class="site-support__controls">${resolved
        ? '<button type="button" data-status="open">Reopen</button>'
        : `<button type="button" data-status="complete">Mark resolved</button><button type="button" data-status="${escalated ? "open" : "escalated"}">${escalated ? "Return to open" : "Escalate"}</button>`}</div>`
      : "";
    const messageList = messages.map((message) => {
      const messageParticipant = message.participant?.full_name || message.participant?.email || "Customer";
      const direction = message.sender_role === "staff" ? `Team → ${messageParticipant}` : `${messageParticipant} → Team`;
      return `<article data-role="${escapeHtml(message.sender_role)}">${message.order ? `<a class="site-support__message-order" href="${escapeHtml(message.order.admin_url)}" data-support-context="order" data-context-id="${escapeHtml(message.order.id)}">Order ${escapeHtml(message.order.reference)}</a>` : ""}<p>${escapeHtml(message.body)}</p><time datetime="${escapeHtml(message.created_at)}">${escapeHtml(direction)} · ${escapeHtml(date(message.created_at))}</time></article>`;
    }).join("");
    const reply = canWrite && !resolved && participantThread
      ? `<form class="site-support__reply"><label for="siteSupportReply">${activeOrder ? `Reply about order ${escapeHtml(activeOrder.reference)}` : "Reply"} <small id="siteSupportReplyHint">⌘/Ctrl + Enter sends</small></label><textarea id="siteSupportReply" name="support_message" autocomplete="off" maxlength="4000" aria-describedby="siteSupportReplyHint" required></textarea><div><span role="status" aria-live="polite"></span><button type="submit">Send reply</button></div></form>`
      : `<p class="site-support__notice">${resolved
        ? "Reopen this conversation before replying."
        : !canWrite
          ? "Your staff role has read-only access."
          : 'Business-level history has no single email recipient. Start a customer chat to reply by chat and email. <button type="button" data-support-start-customer>Start customer chat</button>'}</p>`;
    const conversationName = participantName !== "Customer" ? participantName : selected.company_name || "Customer";
    view.innerHTML = `<header class="site-support__conversation-head"><div><p>${resolved ? "Resolved" : escalated ? "Escalated" : "Open"} conversation</p><h3>${escapeHtml(conversationName)}</h3>${participantDetail}</div>${controls}</header>${contextLinks}${orderScope}${page.has_more ? '<button class="site-support__older" type="button">Load earlier messages</button>' : ""}<div class="site-support__messages">${messageList}</div>${reply}`;

    view.querySelectorAll("[data-support-context]").forEach((link) => link.addEventListener("click", async (event) => {
      if (typeof openContext !== "function") return;
      event.preventDefault();
      setOpen(false, { restoreFocus: false });
      try {
        const result = await openContext({ type: link.dataset.supportContext, id: link.dataset.contextId });
        if (result?.cancelled) setOpen(true);
      } catch { setOpen(true); }
    }));
    view.querySelector("[data-support-full-thread]")?.addEventListener("click", () => {
      void openThread(threadId, { companyId, orderId: null });
    });
    view.querySelector("[data-support-start-customer]")?.addEventListener("click", () => {
      openNewChat({ orderId: activeOrder?.id || activeOrderId || null });
    });
    view.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      const actionRequestId = threadRequestId;
      try {
        const nextStatus = button.dataset.status;
        await auth.api("/api/admin/messages", { method: "PATCH", body: { thread_id: threadId, status: nextStatus } });
        if (actionRequestId !== threadRequestId || selected?.thread_id !== threadId) return;
        if (nextStatus === "open" && threadFilter === "complete") {
          await setThreadFilter("open");
          await openThread(threadId, { companyId, orderId: activeOrderId });
          return;
        }
        if (nextStatus === "complete" && threadFilter === "open") {
          await loadThreads();
          if (actionRequestId === threadRequestId && selected?.thread_id === threadId) clearThreadSelection();
          return;
        }
        await openThread(threadId, { companyId, orderId: activeOrderId });
        await loadThreads();
      } catch { button.disabled = false; }
    }));
    view.querySelector(".site-support__older")?.addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      void openThread(threadId, { companyId, orderId: activeOrderId, before: page.next_before, older: true });
    });
    const replyForm = view.querySelector(".site-support__reply");
    const replyTextarea = replyForm?.querySelector("textarea");
    if (replyTextarea) {
      const key = draftKey(threadId, companyId);
      replyTextarea.value = drafts.get(key) || "";
      replyTextarea.addEventListener("input", () => {
        if (replyTextarea.value) drafts.set(key, replyTextarea.value);
        else drafts.delete(key);
      });
      replyTextarea.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        replyForm.requestSubmit();
      });
    }
    replyForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector("textarea");
      const status = event.currentTarget.querySelector('[role="status"]');
      const send = event.currentTarget.querySelector('[type="submit"]');
      const body = textarea.value.trim();
      if (!body || send.disabled) return;
      send.disabled = true;
      status.textContent = "Sending…";
      const actionRequestId = threadRequestId;
      try {
        await auth.api("/api/admin/messages", {
          method: "POST",
          body: {
            thread_id: threadId,
            ...(companyId ? { company_id: companyId } : {}),
            ...(selected.participant?.id ? { recipient_user_id: selected.participant.id } : {}),
            body,
            order_id: activeOrderId,
          },
        });
        drafts.delete(draftKey(threadId, companyId));
        if (actionRequestId === threadRequestId && selected?.thread_id === threadId) {
          await openThread(threadId, { companyId, orderId: activeOrderId });
        }
        await loadThreads();
      } catch (error) {
        status.textContent = error?.data?.message || "Could not send reply.";
        send.disabled = false;
      }
    });
  };

  const openThread = async (threadId, {
    companyId = null,
    orderId = activeOrderId,
    before = null,
    older = false,
  } = {}) => {
    newChatRequestId += 1;
    const requestId = ++threadRequestId;
    activeOrderId = String(orderId || "").trim() || null;
    if (!older) view.innerHTML = '<p class="site-support__placeholder">Loading…</p>';
    try {
      const suffix = `${activeOrderId ? `&order_id=${encodeURIComponent(activeOrderId)}` : ""}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
      const target = threadId
        ? `thread_id=${encodeURIComponent(threadId)}`
        : `company_id=${encodeURIComponent(companyId || "")}`;
      const result = await auth.api(`/api/admin/messages?${target}${suffix}`);
      if (requestId !== threadRequestId) return;
      if (!older || !selected) {
        selected = result.thread
          || threads.find((thread) => thread.thread_id === threadId)
          || { thread_id: threadId, company_id: companyId, company_name: "Customer", status: "open" };
      }
      messages = older ? [...(result.messages || []), ...messages] : (result.messages || []);
      page = { has_more: result.has_more === true, next_before: result.next_before || null };
      drawer.dataset.threadSelected = "true";
      setView("inbox");
      renderThreads();
      renderConversation();
      if (!older) view.querySelector(".site-support__messages")?.scrollTo({ top: 999999, behavior: "instant" });
    } catch {
      if (requestId === threadRequestId) view.innerHTML = '<p class="site-support__error">Could not load this conversation.</p>';
    }
  };

  const loadThreads = async () => {
    const requestId = ++threadsRequestId;
    if (!threadsLoaded) list.innerHTML = '<div class="site-support__skeleton" aria-label="Loading customer conversations"><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div></div>';
    try {
      const result = await auth.api(threadFilter === "complete" ? "/api/admin/messages?status=complete" : "/api/admin/messages");
      if (requestId !== threadsRequestId) return;
      threads = result.threads || [];
      threadsLoaded = true;
      renderThreads();
      return true;
    } catch {
      if (requestId !== threadsRequestId) return;
      threadsLoaded = true;
      list.innerHTML = '<div class="site-support__error" role="alert"><p>Could not load support.</p><button type="button" data-support-retry aria-label="Retry loading support">Retry</button></div>';
      return false;
    }
  };

  const loadSummary = async () => {
    const requestId = ++summaryRequestId;
    try {
      const result = await auth.api("/api/admin/messages?summary=1");
      if (requestId !== summaryRequestId) return false;
      renderSummary(result.summary || result);
      return true;
    } catch {
      return false;
    }
  };

  const renderNewChatSearch = ({ query = "", customers = null, loading = false, error = "" } = {}) => {
    if (drawer.dataset.view !== "compose") return;
    composeSubmit.hidden = true;
    composeSubmit.disabled = false;
    composeSubmit.textContent = "Start chat";
    const users = Array.isArray(customers)
      ? customers.filter((customer) => customer.id)
      : [];
    let results = '<p class="site-support__new-chat-status">Search by customer name, email, or business.</p>';
    if (loading) results = '<p class="site-support__new-chat-status" role="status">Loading customers…</p>';
    else if (error) results = `<p class="site-support__new-chat-status site-support__error" role="alert">${escapeHtml(error)}</p>`;
    else if (Array.isArray(customers) && users.length) {
      results = users.map((customer) => {
        const name = customer.full_name || customer.email || "Customer";
        const companyStatus = customer.company_status
          ? ` · ${String(customer.company_status).replaceAll("_", " ")}` : "";
        return `<button type="button" class="site-support__account-option" data-support-user-id="${escapeHtml(customer.id)}"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(customer.email || "No email available")}</small></span><em>${escapeHtml(customer.company_name || "No business linked")}${escapeHtml(companyStatus)}</em></button>`;
      }).join("");
    } else if (Array.isArray(customers)) {
      results = `<p class="site-support__new-chat-status">${query ? "No customers match that search." : "No customers are available."}</p>`;
    }

    view.innerHTML = `<section class="site-support__new-chat" aria-labelledby="siteSupportNewChatTitle">
      <header class="site-support__new-chat-head"><p>New customer conversation</p><h3 id="siteSupportNewChatTitle">Choose a customer</h3><span>The selected person receives the message in their own support history.</span></header>
      <form class="site-support__account-search" role="search"><label for="siteSupportAccountSearch">Customer</label><div><input id="siteSupportAccountSearch" name="customer_search" type="search" value="${escapeHtml(query)}" autocomplete="off" placeholder="Name, email, or business…"><button type="submit">Search</button></div></form>
      <div class="site-support__account-results" aria-live="polite">${results}</div>
    </section>`;
    const searchForm = view.querySelector(".site-support__account-search");
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = searchForm.querySelector("input");
      void loadNewChatUsers(input.value);
    });
    view.querySelectorAll("[data-support-user-id]").forEach((button) => button.addEventListener("click", () => {
      void loadNewChatUser(button.dataset.supportUserId, { orderId: pendingNewChatOrderId });
    }));
  };

  const loadNewChatUsers = async (query = "") => {
    const cleanQuery = String(query || "").trim();
    const requestId = ++newChatRequestId;
    renderNewChatSearch({ query: cleanQuery, loading: true });
    try {
      const endpoint = `/api/admin/customers?limit=20${cleanQuery ? `&q=${encodeURIComponent(cleanQuery)}` : ""}`;
      const result = await auth.api(endpoint);
      if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
      renderNewChatSearch({ query: cleanQuery, customers: result.customers || [] });
      requestAnimationFrame(() => view.querySelector("#siteSupportAccountSearch")?.focus());
    } catch (requestError) {
      if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
      renderNewChatSearch({
        query: cleanQuery,
        error: requestError?.data?.message || "Could not load customers.",
      });
    }
  };

  const renderNewChatComposer = ({ profile, company, orders = [], selectedOrderId = null } = {}) => {
    if (drawer.dataset.view !== "compose" || !profile?.id) return;
    const companyStatus = company?.status ? String(company.status).replaceAll("_", " ") : "";
    const accountContext = company?.id
      ? `${company.name || "Customer account"}${companyStatus ? ` · ${companyStatus}` : ""}`
      : "No business linked";
    const orderOptions = orders.map((order) => {
      const reference = String(order.order_number || order.id);
      const status = String(order.status || "").replaceAll("_", " ");
      const selectedOption = String(order.id) === String(selectedOrderId || "") ? " selected" : "";
      return `<option value="${escapeHtml(order.id)}"${selectedOption}>Order ${escapeHtml(reference)}${status ? ` · ${escapeHtml(status)}` : ""}</option>`;
    }).join("");

    view.innerHTML = `<section class="site-support__new-chat" aria-labelledby="siteSupportNewChatTitle">
      <header class="site-support__new-chat-head"><p>New customer conversation</p><h3 id="siteSupportNewChatTitle" tabindex="-1">Write first message</h3><span>Message enters same support thread customers use in their dashboard.</span></header>
      <div class="site-support__new-chat-selected"><span><strong>${escapeHtml(profile.full_name || profile.email || "Customer")}</strong><small>${escapeHtml(profile.email || "No email available")} · ${escapeHtml(accountContext)}</small></span><button type="button" data-support-change-customer>Change customer</button></div>
      <form class="site-support__new-chat-form" id="siteSupportNewChatForm">
        <label for="siteSupportNewChatOrder">Order reference <small>Optional</small></label>
        <select id="siteSupportNewChatOrder" name="order_id"><option value="">General conversation</option>${orderOptions}</select>
        <label for="siteSupportNewChatMessage">Message <small id="siteSupportNewChatHint">⌘/Ctrl + Enter sends</small></label>
        <textarea id="siteSupportNewChatMessage" name="support_message" maxlength="4000" autocomplete="off" aria-describedby="siteSupportNewChatHint" required></textarea>
        <p class="site-support__new-chat-status" role="status" aria-live="polite"></p>
      </form>
    </section>`;

    composeSubmit.hidden = false;
    composeSubmit.disabled = false;
    composeSubmit.textContent = "Start chat";

    view.querySelector("[data-support-change-customer]").addEventListener("click", () => {
      void loadNewChatUsers("");
    });
    const form = view.querySelector(".site-support__new-chat-form");
    const orderSelect = form.elements.order_id;
    const textarea = form.querySelector("textarea");
    orderSelect.addEventListener("change", () => {
      pendingNewChatOrderId = orderSelect.value || null;
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      form.requestSubmit();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      const orderId = form.elements.order_id.value || null;
      const send = composeSubmit;
      const status = form.querySelector('[role="status"]');
      if (!body || send.disabled) return;
      send.disabled = true;
      send.textContent = "Sending…";
      status.textContent = "Sending…";
      const requestId = newChatRequestId;
      try {
        const created = await auth.api("/api/admin/messages", {
          method: "POST",
          body: {
            ...(company?.id ? { company_id: company.id } : {}),
            recipient_user_id: profile.id,
            body,
            order_id: orderId,
            start_thread: true,
          },
        });
        if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
        if (threadFilter !== "open") await setThreadFilter("open");
        else {
          threadsLoaded = false;
          await loadThreads();
        }
        const threadId = created.thread_id
          || threads.find((thread) => thread.participant_user_id === profile.id)?.thread_id
          || null;
        await openThread(threadId, { companyId: company?.id || null, orderId });
      } catch (requestError) {
        if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
        status.textContent = requestError?.data?.message || "Could not start chat.";
        send.disabled = false;
        send.textContent = "Start chat";
      }
    });
    view.scrollTop = 0;
    requestAnimationFrame(() => {
      const title = view.querySelector("#siteSupportNewChatTitle");
      if (window.matchMedia("(max-width: 720px)").matches) title?.focus({ preventScroll: true });
      else textarea.focus();
    });
  };

  const loadNewChatUser = async (userId, { orderId = null } = {}) => {
    const requestId = ++newChatRequestId;
    const status = view.querySelector(".site-support__new-chat-status");
    if (status) status.textContent = "Loading customer…";
    view.querySelectorAll("[data-support-user-id]").forEach((button) => { button.disabled = true; });
    try {
      const result = await auth.api(`/api/admin/users?detail=${encodeURIComponent(userId)}`);
      if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
      renderNewChatComposer({ ...result, selectedOrderId: orderId });
    } catch (requestError) {
      if (requestId !== newChatRequestId || drawer.dataset.view !== "compose") return;
      if (status) status.textContent = requestError?.data?.message || "Could not load this customer.";
      view.querySelectorAll("[data-support-user-id]").forEach((button) => { button.disabled = false; });
    }
  };

  const openNewChat = ({ userId = null, orderId = null } = {}) => {
    if (!canWrite) return;
    threadRequestId += 1;
    pendingNewChatOrderId = String(orderId || "").trim() || null;
    selected = null;
    activeOrderId = null;
    messages = [];
    page = { has_more: false, next_before: null };
    drawer.dataset.threadSelected = "false";
    setView("compose");
    renderNewChatSearch({ loading: true });
    setOpen(true, { focus: view.querySelector("#siteSupportAccountSearch") });
    if (userId) void loadNewChatUser(userId, { orderId: pendingNewChatOrderId });
    else void loadNewChatUsers("");
  };

  list.addEventListener("click", (event) => {
    const retry = event.target.closest("[data-support-retry]");
    if (retry) {
      retry.disabled = true;
      threadsLoaded = false;
      void loadThreads();
      return;
    }
    const button = event.target.closest("[data-support-thread-id]");
    if (!button) return;
    setView("inbox");
    void openThread(button.dataset.supportThreadId, { orderId: null });
  });
  filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-support-filter]");
    if (button) void setThreadFilter(button.dataset.supportFilter);
  });
  search.addEventListener("input", renderThreads);
  launcher.addEventListener("click", () => setOpen(drawer.hidden));
  close.addEventListener("click", () => setOpen(false));
  newChat?.addEventListener("click", () => openNewChat());
  settingsToggle.addEventListener("click", () => setView(drawer.dataset.view === "settings" ? "inbox" : "settings"));
  back.addEventListener("click", () => {
    if (drawer.dataset.view === "settings") leaveSettings();
    else clearThreadSelection();
  });
  settings.addEventListener("change", (event) => { if (event.target.matches("[data-support-pref]")) void savePrefs(); });

  // Staff menus and emailed alerts open this console where staff already are.
  // Their href is a real fallback: on a route that suppresses the console the
  // click is left alone and the browser navigates to admin.html instead.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-support-open]");
    if (!trigger || shell.hidden) return;
    event.preventDefault();
    trigger.closest("details[open]")?.removeAttribute("open");
    if (trigger.dataset.supportOpen === "settings") openSettings();
    else { setView("inbox"); setOpen(true); }
  });
  document.addEventListener("masest:support-route", syncRouteVisibility);
  window.addEventListener("hashchange", syncRouteVisibility);
  // Escape backs out one level, so it does not throw away the drawer from a view
  // the staff member only meant to leave.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || drawer.hidden) return;
    if (drawer.dataset.view === "settings") leaveSettings();
    else if (drawer.dataset.view === "compose" || selected) clearThreadSelection();
    else setOpen(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (!drawer.hidden) void setPresence(!document.hidden, { force: true, keepalive: document.hidden });
    void poller?.visibilityChanged();
  });
  window.addEventListener("pagehide", () => {
    poller?.stop();
    if (!drawer.hidden) void setPresence(false, { force: true, keepalive: true });
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void poller?.visibilityChanged();
  });
  poller = createSupportPoller({
    isHidden: () => document.hidden,
    isOpen: () => !drawer.hidden,
    loadSummary,
    loadThreads,
    heartbeat: () => Date.now() - lastPresencePing > PRESENCE_HEARTBEAT_MS
      ? setPresence(true, { force: true })
      : Promise.resolve(),
  });
  void poller.refresh();

  // Returned so the admin console can open a specific company thread from the
  // Accounts tab instead of shipping a second inbox implementation.
  return {
    openThread: (companyId, { orderId = null } = {}) => {
      setView("inbox");
      setOpen(true);
      return openThread(null, { companyId, orderId });
    },
    openNewChat: (options = {}) => openNewChat(options),
    open: () => { setView("inbox"); setOpen(true); },
    openSettings,
    refresh: () => poller.refresh(),
  };
}
