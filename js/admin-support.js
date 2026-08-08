const POLL_MS = 15_000;
const PRESENCE_HEARTBEAT_MS = 30_000;

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

export function initAdminSupport({ auth, root = "", staff = null } = {}) {
  // One console per document. admin.html used to ship its own static drawer +
  // launcher and this bailed there; both surfaces now mount this same console.
  if (document.getElementById("adminSupportConsole") || !auth?.api) return null;

  if (!document.querySelector('link[data-masest-admin-support="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${root}css/admin-support.css?v=20260807f`;
    stylesheet.dataset.masestAdminSupport = "true";
    document.head.append(stylesheet);
  }

  const canWrite = staff?.role !== "read_only";
  const shell = document.createElement("aside");
  shell.id = "adminSupportConsole";
  shell.className = "site-support";
  shell.hidden = routeSuppressesSupport();
  shell.innerHTML = `
    <section class="site-support__drawer" role="dialog" aria-modal="false" aria-labelledby="siteSupportTitle" data-view="inbox" hidden>
      <div class="site-support__list-pane">
        <header class="site-support__header">
          <div><p>Customer support</p><h2 id="siteSupportTitle">Open chats</h2><span data-support-summary>Loading…</span></div>
          <div class="site-support__header-actions">
            <button type="button" data-support-settings-toggle aria-label="Customer support settings" title="Customer support settings" aria-expanded="false" aria-controls="siteSupportSettings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg></button>
          </div>
        </header>
        <div class="site-support__threads" aria-label="Open customer chats"></div>
      </div>
      <div class="site-support__conversation">
        <header class="site-support__conversation-toolbar">
          <div class="site-support__toolbar-lead">
            <button type="button" data-support-back aria-label="Back to conversations" title="Back to conversations" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg></button>
            <p data-support-view-label>Customer inbox</p>
          </div>
          <button type="button" aria-label="Close support menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
        </header>
        <div class="site-support__conversation-body"><div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div></div>
        <div class="site-support__settings" id="siteSupportSettings" hidden>
          <p class="site-support__settings-intro">Choose when you get support email alerts. These apply to your staff account only.</p>
          ${SUPPORT_PREFS.map(([id, key, title, help]) => `<label><input id="${id}" type="checkbox" data-support-pref="${key}"><span><b>${title}</b><small>${help}</small></span></label>`).join("")}
          <p class="site-support__settings-status" id="adminSupportSettingsStatus" role="status" aria-live="polite"></p>
        </div>
      </div>
    </section>
    <button class="site-support__launcher" type="button" aria-label="Open customer support" aria-expanded="false" aria-controls="adminSupportConsole"><i class="ph ph-lifebuoy" aria-hidden="true"></i><span>Customer support</span><b data-support-count hidden>0</b></button>`;
  document.body.append(shell);

  document.querySelectorAll("[data-customer-chat-open]").forEach((link) => {
    link.textContent = "Customer support";
    link.setAttribute("href", "#adminSupportConsole");
    link.setAttribute("aria-label", "Open customer support");
  });

  const drawer = shell.querySelector(".site-support__drawer");
  const launcher = shell.querySelector(".site-support__launcher");
  const close = shell.querySelector('[aria-label="Close support menu"]');
  const list = shell.querySelector(".site-support__threads");
  const view = shell.querySelector(".site-support__conversation-body");
  const summary = shell.querySelector("[data-support-summary]");
  const counter = shell.querySelector("[data-support-count]");
  const settings = shell.querySelector(".site-support__settings");
  const settingsStatus = shell.querySelector(".site-support__settings-status");
  const settingsToggle = shell.querySelector("[data-support-settings-toggle]");
  const back = shell.querySelector("[data-support-back]");
  const viewLabel = shell.querySelector("[data-support-view-label]");
  let prefsLoaded = false;
  let threads = [];
  let threadsLoaded = false;
  let selected = null;
  let messages = [];
  let page = { has_more: false, next_before: null };
  let pollId = 0;
  let presenceOpen = false;
  let lastPresencePing = 0;
  let presenceRequest = Promise.resolve();

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
    drawer.dataset.view = isSettings ? "settings" : "inbox";
    settings.hidden = !isSettings;
    view.hidden = isSettings;
    back.hidden = !isSettings;
    viewLabel.textContent = isSettings ? "Support settings" : "Customer inbox";
    settingsToggle.setAttribute("aria-expanded", String(isSettings));
    if (isSettings) void loadPrefs();
  };

  const setOpen = (open, { restoreFocus = true, focus = null } = {}) => {
    drawer.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close customer support" : "Open customer support");
    if (open) {
      void setPresence(true);
      void loadThreads();
      requestAnimationFrame(() => (focus || list.querySelector("button") || close).focus());
    } else {
      void setPresence(false);
      // Reopening lands on conversations; settings is somewhere you go, not a state
      // the console gets stuck in.
      setView("inbox");
      if (restoreFocus) launcher.focus();
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
    (settingsToggle.offsetParent ? settingsToggle : list.querySelector("button") || close).focus();
  };
  const syncRouteVisibility = () => {
    const suppressed = routeSuppressesSupport();
    if (suppressed && !drawer.hidden) setOpen(false, { restoreFocus: false });
    shell.hidden = suppressed;
  };

  const renderThreads = () => {
    const ordered = [...threads].sort((a, b) => Number(b.unanswered) - Number(a.unanswered) || String(b.last_at).localeCompare(String(a.last_at)));
    const unanswered = ordered.filter((thread) => thread.unanswered).length;
    counter.hidden = unanswered === 0;
    counter.textContent = String(unanswered);
    summary.textContent = unanswered === 1 ? "1 chat needs a reply" : unanswered ? `${unanswered} chats need a reply` : "No chats need a reply";
    if (!ordered.length) {
      selected = null;
      view.innerHTML = '<div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div>';
      list.innerHTML = '<div class="site-support__empty"><i class="ph ph-lifebuoy" aria-hidden="true"></i><div><strong>Inbox clear</strong><p>No open customer conversations.</p></div></div>';
      return;
    }
    list.innerHTML = ordered.map((thread) => `<button type="button" class="site-support__thread${thread.unanswered ? " is-unanswered" : ""}${thread.company_id === selected?.company_id ? " is-selected" : ""}" data-company-id="${escapeHtml(thread.company_id)}" aria-pressed="${thread.company_id === selected?.company_id}"><span><strong>${escapeHtml(thread.company_name || "Customer")}</strong><small>${escapeHtml((thread.last_body || "").slice(0, 90))}</small></span><span class="site-support__meta"><em>${thread.status === "escalated" ? "Escalated" : "Open"}</em>${thread.unanswered ? "<b>Needs reply</b>" : ""}</span></button>`).join("");
  };

  const renderConversation = () => {
    if (!selected) return;
    const resolved = selected.status === "complete";
    const escalated = selected.status === "escalated";
    view.innerHTML = `<header class="site-support__conversation-head"><div><p>${resolved ? "Resolved" : escalated ? "Escalated" : "Open"} conversation</p><h3>${escapeHtml(selected.company_name || "Customer")}</h3></div>${canWrite ? `<div class="site-support__controls">${resolved ? '<button type="button" data-status="open">Reopen</button>' : `<button type="button" data-status="complete">Mark resolved</button><button type="button" data-status="${escalated ? "open" : "escalated"}">${escalated ? "Return to open" : "Escalate"}</button>`}</div>` : ""}</header>${page.has_more ? '<button class="site-support__older" type="button">Load earlier messages</button>' : ""}<div class="site-support__messages">${messages.map((message) => `<article data-role="${escapeHtml(message.sender_role)}"><p>${escapeHtml(message.body)}</p><time datetime="${escapeHtml(message.created_at)}">${message.sender_role === "staff" ? "Team" : "Customer"} · ${escapeHtml(date(message.created_at))}</time></article>`).join("")}</div>${canWrite && !resolved ? '<form class="site-support__reply"><label for="siteSupportReply">Reply</label><textarea id="siteSupportReply" name="support_message" autocomplete="off" maxlength="4000" required></textarea><div><span role="status" aria-live="polite"></span><button type="submit">Send reply</button></div></form>' : '<p class="site-support__notice">' + (resolved ? "Reopen this conversation before replying." : "Your staff role has read-only access.") + "</p>"}`;
    view.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await auth.api("/api/admin/messages", { method: "PATCH", body: { company_id: selected.company_id, status: button.dataset.status } });
        await openThread(selected.company_id);
        await loadThreads();
      } catch { button.disabled = false; }
    }));
    view.querySelector(".site-support__older")?.addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      void openThread(selected.company_id, { before: page.next_before, older: true });
    });
    view.querySelector(".site-support__reply")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector("textarea");
      const status = event.currentTarget.querySelector('[role="status"]');
      const send = event.currentTarget.querySelector('[type="submit"]');
      const body = textarea.value.trim();
      if (!body || send.disabled) return;
      send.disabled = true;
      status.textContent = "Sending…";
      try {
        await auth.api("/api/admin/messages", { method: "POST", body: { company_id: selected.company_id, body } });
        await openThread(selected.company_id);
        await loadThreads();
      } catch (error) {
        status.textContent = error?.data?.message || "Could not send reply.";
        send.disabled = false;
      }
    });
  };

  const openThread = async (companyId, { before = null, older = false } = {}) => {
    if (!older) view.innerHTML = '<p class="site-support__placeholder">Loading…</p>';
    try {
      const suffix = before ? `&before=${encodeURIComponent(before)}` : "";
      const result = await auth.api(`/api/admin/messages?company_id=${encodeURIComponent(companyId)}${suffix}`);
      selected = result.thread || selected || { company_id: companyId, company_name: "Customer", status: "open" };
      messages = older ? [...(result.messages || []), ...messages] : (result.messages || []);
      page = { has_more: result.has_more === true, next_before: result.next_before || null };
      renderThreads();
      renderConversation();
      if (!older) view.querySelector(".site-support__messages")?.scrollTo({ top: 999999, behavior: "instant" });
    } catch { view.innerHTML = '<p class="site-support__error">Could not load this conversation.</p>'; }
  };

  const loadThreads = async () => {
    if (!threadsLoaded) list.innerHTML = '<div class="site-support__skeleton" aria-label="Loading customer conversations"><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div></div>';
    try {
      threads = (await auth.api("/api/admin/messages")).threads || [];
      threadsLoaded = true;
      renderThreads();
    } catch {
      threadsLoaded = true;
      list.innerHTML = '<p class="site-support__error">Could not load support.</p>';
    }
  };

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-company-id]");
    if (!button) return;
    setView("inbox");
    void openThread(button.dataset.companyId);
  });
  launcher.addEventListener("click", () => setOpen(drawer.hidden));
  close.addEventListener("click", () => setOpen(false));
  settingsToggle.addEventListener("click", () => setView(drawer.dataset.view === "settings" ? "inbox" : "settings"));
  back.addEventListener("click", leaveSettings);
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
    else setOpen(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (drawer.hidden) return;
    void setPresence(!document.hidden, { force: true, keepalive: document.hidden });
    if (!document.hidden) void loadThreads();
  });
  window.addEventListener("pagehide", () => { if (!drawer.hidden) void setPresence(false, { force: true, keepalive: true }); });
  pollId = window.setInterval(() => {
    if (document.hidden) return;
    void loadThreads();
    if (!drawer.hidden && Date.now() - lastPresencePing > PRESENCE_HEARTBEAT_MS) void setPresence(true, { force: true });
  }, POLL_MS);
  void loadThreads();

  // Returned so the admin console can open a specific company thread from the
  // Accounts tab instead of shipping a second inbox implementation.
  return {
    openThread: (companyId) => { setView("inbox"); setOpen(true); return openThread(companyId); },
    open: () => { setView("inbox"); setOpen(true); },
    openSettings,
    refresh: () => loadThreads(),
  };
}
