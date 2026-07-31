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

export function initAdminSupport({ auth, root = "", staff = null } = {}) {
  if (document.getElementById("adminSupportConsole") || document.getElementById("adminSupportLauncher") || !auth?.api) return;

  if (!document.querySelector('link[data-masest-admin-support="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${root}css/admin-support.css?v=20260711e`;
    stylesheet.dataset.masestAdminSupport = "true";
    document.head.append(stylesheet);
  }

  const canWrite = staff?.role !== "read_only";
  const shell = document.createElement("aside");
  shell.id = "adminSupportConsole";
  shell.className = "site-support";
  shell.hidden = routeSuppressesSupport();
  shell.innerHTML = `
    <section class="site-support__drawer" role="dialog" aria-modal="false" aria-labelledby="siteSupportTitle" hidden>
      <div class="site-support__list-pane">
        <header class="site-support__header">
          <div><p>Customer support</p><h2 id="siteSupportTitle">Open chats</h2><span data-support-summary>Loading…</span></div>
          <div class="site-support__header-actions">
            <a href="${root}admin.html#support-settings" aria-label="Customer support settings" title="Customer support settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg></a>
            <button type="button" aria-label="Close support menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
          </div>
        </header>
        <div class="site-support__threads" aria-label="Open customer chats"></div>
      </div>
      <div class="site-support__conversation"><header class="site-support__conversation-toolbar"><p>Customer inbox</p><a href="${root}admin.html#support-settings" aria-label="Customer support settings" title="Customer support settings"><i class="ph ph-gear-six" aria-hidden="true"></i></a></header><div class="site-support__conversation-body"><div class="site-support__conversation-empty"><i class="ph ph-chat-centered-text" aria-hidden="true"></i><h3>No conversation selected</h3><p>Choose a customer conversation to read and reply.</p></div></div></div>
    </section>
    <button class="site-support__launcher" type="button" aria-label="Open admin support" aria-expanded="false" aria-controls="adminSupportConsole"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H8l-4 3V5Z"/><path d="M8 9h8M8 13h5"/></svg><span>Support</span><b data-support-count hidden>0</b></button>`;
  document.body.append(shell);

  document.querySelectorAll("[data-customer-chat-open]").forEach((link) => {
    link.textContent = "Customer support";
    link.setAttribute("href", "#adminSupportConsole");
    link.setAttribute("aria-label", "Open admin support");
  });

  const drawer = shell.querySelector(".site-support__drawer");
  const launcher = shell.querySelector(".site-support__launcher");
  const close = shell.querySelector('[aria-label="Close support menu"]');
  const list = shell.querySelector(".site-support__threads");
  const view = shell.querySelector(".site-support__conversation-body");
  const summary = shell.querySelector("[data-support-summary]");
  const counter = shell.querySelector("[data-support-count]");
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

  const setOpen = (open, { restoreFocus = true } = {}) => {
    drawer.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close admin support" : "Open admin support");
    if (open) {
      void setPresence(true);
      void loadThreads();
      requestAnimationFrame(() => (list.querySelector("button") || close).focus());
    } else {
      void setPresence(false);
      if (restoreFocus) launcher.focus();
    }
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
    if (button) void openThread(button.dataset.companyId);
  });
  launcher.addEventListener("click", () => setOpen(drawer.hidden));
  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("masest:support-route", syncRouteVisibility);
  window.addEventListener("hashchange", syncRouteVisibility);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !drawer.hidden) setOpen(false); });
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
}
