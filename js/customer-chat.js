/* First-party customer chat. Authenticated customer messages use the existing
 * company support thread, so they appear in Admin → Messages without a vendor bridge. */

const POLL_MS = 30_000;
const OBSTRUCTION_EVENT = "masest:customer-chat-obstruction-change";
const OBSTRUCTION_SELECTOR = "[data-customer-chat-obstruction]";

function pageRoot() {
  return window.MASEST?.chatRoot || "";
}

function routeSuppressesSupport() {
  const dashboardMessages = /(?:^|\/)dashboard(?:\.html)?$/.test(location.pathname)
    && location.hash.replace(/^#/, "") === "messages";
  return dashboardMessages || document.body.classList.contains("support-suppressed");
}

function makeMessage(message) {
  const item = document.createElement("article");
  item.className = `customer-chat__message customer-chat__message--${message.sender_role === "staff" ? "staff" : "buyer"}`;
  if (message.order?.id) {
    const order = document.createElement("a");
    order.className = "customer-chat__message-order";
    order.href = message.order.buyer_url || `/dashboard.html?order=${encodeURIComponent(message.order.id)}#orders`;
    order.textContent = `Order ${message.order.reference || message.order.id}`;
    item.append(order);
  }
  const body = document.createElement("p");
  body.textContent = message.body || "";
  const meta = document.createElement("time");
  meta.dateTime = message.created_at || "";
  meta.textContent = message.sender_role === "staff" ? "MASEST" : "You";
  item.append(body, meta);
  return item;
}

export async function initCustomerChat() {
  if (document.getElementById("customerChat")) return;

  const root = pageRoot();
  let pendingSupportOrder = null;
  let openSupportOrder = null;
  const handleSupportOrderRequest = (event) => {
    const order = event.detail?.order || event.detail;
    if (!order?.id) return;
    if (openSupportOrder) openSupportOrder(order);
    else pendingSupportOrder = order;
  };
  // Orders can render before auth capability lookup finishes. Listen before that
  // await so an immediate "Message about this order" click cannot be lost.
  document.addEventListener("masest:open-support-order", handleSupportOrderRequest);
  let authModule;
  const auth = async () => {
    authModule ||= import(window.MASEST?.authModule || "./auth.js?v=20260711w");
    return authModule;
  };
  try {
    const session = await auth();
    if (await session.getToken()) {
      const account = await session.me();
      if (account?.can_admin) {
        document.removeEventListener("masest:open-support-order", handleSupportOrderRequest);
        const { initAdminSupport } = await import("./admin-support.js?v=20260908d");
        initAdminSupport({ auth: session, root, staff: account.staff });
        return;
      }
    }
  } catch {
    // The buyer launcher remains available if account capability cannot be resolved.
  }
  let stylesheetReady = Promise.resolve();
  if (!document.querySelector('link[data-masest-customer-chat="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheetReady = new Promise((resolve) => {
      stylesheet.addEventListener("load", resolve, { once: true });
      stylesheet.addEventListener("error", resolve, { once: true });
    });
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${root}css/customer-chat.css?v=20260907a`;
    stylesheet.dataset.masestCustomerChat = "true";
    document.head.append(stylesheet);
  }
  const shell = document.createElement("aside");
  shell.id = "customerChat";
  shell.className = "customer-chat";
  shell.hidden = routeSuppressesSupport();
  shell.innerHTML = `
    <section class="customer-chat__panel" role="dialog" aria-labelledby="customerChatTitle" hidden>
      <header class="customer-chat__header">
        <div><p class="customer-chat__eyebrow">MASEST support</p><h2 id="customerChatTitle">Customer chat</h2></div>
        <button class="customer-chat__close" type="button" aria-label="Close customer chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
      </header>
      <div class="customer-chat__guest" hidden>
        <p>Sign in or create an account to send a secure message to the MASEST team.</p>
        <a class="btn btn-primary" href="${root}account.html">Sign up / Log in</a>
        <a class="customer-chat__quote-link" href="${root}contact.html">Get a quote with this info</a>
      </div>
      <div class="customer-chat__thread" hidden>
        <div class="customer-chat__messages" aria-live="polite" aria-label="Messages"></div>
        <form class="customer-chat__form">
          <div class="customer-chat__ticket-bar">
            <span class="customer-chat__ticket" data-customer-chat-ticket hidden><i class="ph ph-ticket" aria-hidden="true"></i> <b data-customer-chat-ticket-number></b><span data-customer-chat-ticket-status></span></span>
            <button class="customer-chat__new-ticket" type="button" data-customer-chat-new-ticket>Start a new issue</button>
          </div>
          <div class="customer-chat__new-ticket-fields" data-customer-chat-new-ticket-fields hidden>
            <div class="customer-chat__new-ticket-grid">
              <div><label for="customerChatSubject">Subject</label><input id="customerChatSubject" name="ticket_subject" maxlength="200" placeholder="What do you need help with?"></div>
              <div><label for="customerChatCategory">Category</label><select id="customerChatCategory" name="ticket_category"><option value="general">General</option><option value="product">Product</option><option value="order">Order</option><option value="shipping">Shipping</option><option value="billing">Billing</option><option value="account">Account</option><option value="technical">Technical</option></select></div>
            </div>
          </div>
          <div class="customer-chat__order-context" hidden>
            <span><i class="ph ph-package" aria-hidden="true"></i> About <b data-customer-chat-order></b></span>
            <button type="button" data-customer-chat-order-clear aria-label="Return to all support messages">Clear</button>
          </div>
          <label class="sr-only" for="customerChatBody">Message</label>
          <textarea id="customerChatBody" name="chat_message" autocomplete="off" maxlength="4000" required placeholder="Ask about VertKleen, an order, or your account…"></textarea>
          <div class="customer-chat__form-row"><p class="customer-chat__status" role="status" aria-live="polite"></p><button class="btn btn-primary" type="submit">Send</button></div>
          <a class="customer-chat__inbox-link" href="${root}dashboard.html#messages">Open full message inbox</a>
          <a class="customer-chat__quote-link" href="${root}contact.html">Get a quote with this info</a>
        </form>
      </div>
    </section>
    <button class="customer-chat__toggle" type="button" aria-label="Open customer chat" aria-expanded="false" aria-controls="customerChat"><svg class="customer-chat__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.3-.65L4 20l1.4-4A7.4 7.4 0 0 1 4 11.5a8 8 0 0 1 16 0Z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg><span>Chat</span></button>`;
  document.body.append(shell);

  const panel = shell.querySelector(".customer-chat__panel");
  const toggle = shell.querySelector(".customer-chat__toggle");
  const close = shell.querySelector(".customer-chat__close");
  const guest = shell.querySelector(".customer-chat__guest");
  const guestAction = guest.querySelector(".btn-primary");
  const thread = shell.querySelector(".customer-chat__thread");
  const list = shell.querySelector(".customer-chat__messages");
  const form = shell.querySelector(".customer-chat__form");
  const body = shell.querySelector("#customerChatBody");
  const status = shell.querySelector(".customer-chat__status");
  const orderContext = shell.querySelector(".customer-chat__order-context");
  const orderLabel = shell.querySelector("[data-customer-chat-order]");
  const orderClear = shell.querySelector("[data-customer-chat-order-clear]");
  const inboxLink = shell.querySelector(".customer-chat__inbox-link");
  const ticket = shell.querySelector("[data-customer-chat-ticket]");
  const ticketNumber = shell.querySelector("[data-customer-chat-ticket-number]");
  const ticketStatus = shell.querySelector("[data-customer-chat-ticket-status]");
  const newTicketButton = shell.querySelector("[data-customer-chat-new-ticket]");
  const newTicketFields = shell.querySelector("[data-customer-chat-new-ticket-fields]");
  const ticketSubject = shell.querySelector("#customerChatSubject");
  const ticketCategory = shell.querySelector("#customerChatCategory");
  const quoteActions = [...shell.querySelectorAll(".customer-chat__quote-link")];
  let activeOrder = null;
  let activeTicket = null;
  let newTicketMode = false;
  let messageFetchGeneration = 0;
  let messageContextGeneration = 0;
  let messageRequestController = null;
  const chatDrafts = new Map();
  const chatDraftRevisions = new Map();
  let nextChatDraftRevision = 0;
  let authenticated = false;
  let pollId = 0;
  let chatPresenceOpen = false;
  let lastPresencePing = 0;
  let presenceRequest = Promise.resolve();
  let dockFrame = 0;
  let requestContextModule;
  let cartModule;

  const updateQuoteHref = async () => {
    try {
      [requestContextModule, cartModule] = await Promise.all([
        requestContextModule || import("./request-context.js?v=20260719c"),
        cartModule || import("./cart.js?v=20260719c"),
      ]);
      const href = requestContextModule.buildRequestContextHref({
        pageUrl: location.href,
        product: document.body.dataset.productSku || "",
        cartItems: cartModule.items(),
        quoteUrl: `${root}contact.html`,
      });
      if (href) quoteActions.forEach((action) => { action.href = href; });
    } catch {
      quoteActions.forEach((action) => { action.href = `${root}contact.html`; });
    }
  };

  const updateDockAvoidance = () => {
    dockFrame = 0;
    const currentLift = Number.parseFloat(shell.style.getPropertyValue("--customer-chat-avoid")) || 0;
    const renderedLauncher = toggle.getBoundingClientRect();
    const launcher = {
      left: renderedLauncher.left,
      right: renderedLauncher.right,
      top: renderedLauncher.top + currentLift,
      bottom: renderedLauncher.bottom + currentLift,
      height: renderedLauncher.height,
    };
    let lift = 0;
    const obstructionRects = [...document.querySelectorAll(OBSTRUCTION_SELECTOR)].flatMap((obstruction) => {
      if (obstruction.dataset.customerChatObstructionActive === "false") return [];
      const style = getComputedStyle(obstruction);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return [];
      const rect = obstruction.getBoundingClientRect();
      return rect.width < 1 || rect.height < 1 ? [] : [rect];
    });
    for (let pass = 0; pass < 12; pass++) {
      const docked = { left: launcher.left, right: launcher.right, top: launcher.top - lift, bottom: launcher.bottom - lift };
      const collided = obstructionRects.filter((rect) => (
        docked.left < rect.right && docked.right > rect.left
          && docked.top < rect.bottom && docked.bottom > rect.top
      ));
      if (!collided.length) break;
      const nextLift = Math.max(...collided.map((rect) => launcher.bottom - rect.top + 12));
      if (nextLift <= lift) break;
      lift = nextLift;
    }
    const maxLift = Math.max(0, window.innerHeight - launcher.height - 24);
    shell.style.setProperty("--customer-chat-avoid", `${Math.min(Math.ceil(lift), maxLift)}px`);
  };
  const scheduleDockAvoidance = () => {
    if (!dockFrame) dockFrame = requestAnimationFrame(updateDockAvoidance);
  };

  const setStatus = (text = "", state = "") => {
    status.textContent = text;
    status.dataset.state = state;
  };
  const chatDraftKey = (ticketId = activeTicket?.id || null, orderId = activeOrder?.id || null, mode = newTicketMode) => `${mode ? "new" : (ticketId || "inbox")}:${orderId || "all"}`;
  const saveChatDraft = (key = chatDraftKey()) => {
    const value = body.value || "";
    if (value) {
      if (chatDrafts.get(key) !== value || !chatDraftRevisions.has(key)) {
        chatDrafts.set(key, value);
        chatDraftRevisions.set(key, ++nextChatDraftRevision);
      }
    } else {
      chatDrafts.delete(key);
      chatDraftRevisions.delete(key);
    }
  };
  const restoreChatDraft = (key = chatDraftKey()) => { body.value = chatDrafts.get(key) || ""; };
  const renderTicket = () => {
    ticket.hidden = !activeTicket;
    ticketNumber.textContent = activeTicket?.number || "";
    ticketStatus.textContent = activeTicket ? ` · ${ticketStatusLabel(activeTicket.status)}` : "";
    newTicketButton.textContent = newTicketMode
      ? (activeTicket ? "Use active issue" : "Cancel new issue")
      : (activeTicket ? "New issue" : "Start a new issue");
  };
  const setOrderContext = (order) => {
    const id = String(order?.id || "").trim();
    const previousId = activeOrder?.id || null;
    if (previousId !== (id || null)) {
      saveChatDraft(chatDraftKey(activeTicket?.id || null, previousId));
      activeOrder = id ? {
        id,
        reference: String(order?.reference || order?.order_number || id).trim(),
        status: order?.status || null,
      } : null;
      activeTicket = null;
      messageContextGeneration += 1;
      list.innerHTML = '<p class="customer-chat__empty">Loading messages…</p>';
      setStatus();
      renderTicket();
      restoreChatDraft();
    } else if (id) {
      activeOrder = {
        id,
        reference: String(order?.reference || order?.order_number || id).trim(),
        status: order?.status || null,
      };
    } else activeOrder = null;
    orderContext.hidden = !activeOrder;
    orderLabel.textContent = activeOrder ? `order ${activeOrder.reference}` : "";
    inboxLink.href = activeOrder
      ? `${root}dashboard.html?order=${encodeURIComponent(activeOrder.id)}#messages`
      : `${root}dashboard.html#messages`;
  };
  const ticketStatusLabel = (value) => ({
    open: "Open",
    waiting_on_customer: "Waiting for your reply",
    resolved: "Resolved",
  }[value] || "Support issue");
  const setTicket = (value) => {
    const nextTicket = value?.id ? {
      id: String(value.id),
      number: String(value.display_number || value.ticket_number || "Support issue"),
      status: String(value.status || "open"),
    } : null;
    const previousId = activeTicket?.id || null;
    const nextId = nextTicket?.id || null;
    if (previousId !== nextId) {
      saveChatDraft(chatDraftKey(previousId));
      activeTicket = nextTicket;
      messageContextGeneration += 1;
      restoreChatDraft();
    } else activeTicket = nextTicket;
    renderTicket();
  };
  const setNewTicketMode = (enabled) => {
    if (newTicketMode === Boolean(enabled)) return;
    saveChatDraft();
    newTicketMode = Boolean(enabled);
    messageContextGeneration += 1;
    newTicketFields.hidden = !newTicketMode;
    newTicketButton.textContent = newTicketMode
      ? (activeTicket ? "Use active issue" : "Cancel new issue")
      : (activeTicket ? "New issue" : "Start a new issue");
    if (!newTicketMode) {
      ticketSubject.value = "";
      ticketCategory.value = "general";
    }
    restoreChatDraft();
  };
  const setChatPresence = async (open, { force = false, keepalive = false } = {}) => {
    if (!authenticated || (!force && chatPresenceOpen === open)) return;
    chatPresenceOpen = open;
    presenceRequest = presenceRequest.catch(() => {}).then(async () => {
      const { api } = await auth();
      await api("/api/account/messages", {
        method: "POST",
        body: { action: "chat_presence", chat_open: open },
        keepalive,
      });
      if (open) lastPresencePing = Date.now();
    });
    try { await presenceRequest; }
    catch { if (chatPresenceOpen === open) chatPresenceOpen = !open; }
  };
  const setOpen = (open, { restoreFocus = true } = {}) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close customer chat" : "Open customer chat");
    scheduleDockAvoidance();
    if (!open) {
      window.clearInterval(pollId);
      pollId = 0;
      void setChatPresence(false);
      if (restoreFocus) toggle.focus();
    }
  };
  const syncRouteVisibility = () => {
    const suppressed = routeSuppressesSupport();
    if (suppressed && !panel.hidden) setOpen(false, { restoreFocus: false });
    shell.hidden = suppressed;
    if (!suppressed) scheduleDockAvoidance();
  };
  const showGuest = () => {
    if (authenticated) void setChatPresence(false);
    authenticated = false;
    guest.hidden = false;
    thread.hidden = true;
    setStatus();
  };
  const showThread = () => {
    authenticated = true;
    guest.hidden = true;
    thread.hidden = false;
  };
  const needsCompany = (error) => error.status === 403 && error.message === "no_company";
  const startPolling = () => {
    if (pollId || panel.hidden || !authenticated) return;
    pollId = window.setInterval(() => {
      if (!document.hidden) {
        loadMessages({ quiet: true });
        if (Date.now() - lastPresencePing > 30_000) void setChatPresence(true, { force: true });
      }
    }, POLL_MS);
  };
  const renderMessages = (messages) => {
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "customer-chat__empty";
      empty.textContent = "Send a message and the MASEST team will reply here.";
      list.append(empty);
      return;
    }
    messages.forEach((message) => list.append(makeMessage(message)));
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  };
  const loadMessages = async ({ quiet = false } = {}) => {
    if (!authenticated) return;
    const fetchGeneration = ++messageFetchGeneration;
    const contextGeneration = messageContextGeneration;
    const orderId = activeOrder?.id || null;
    messageRequestController?.abort();
    const controller = new AbortController();
    messageRequestController = controller;
    try {
      const { api } = await auth();
      const params = new URLSearchParams();
      if (orderId) params.set("order_id", orderId);
      const suffix = params.size ? `?${params}` : "";
      const result = await api(`/api/account/messages${suffix}`);
      if (controller.signal.aborted || fetchGeneration !== messageFetchGeneration || contextGeneration !== messageContextGeneration || orderId !== (activeOrder?.id || null)) return;
      if (Object.prototype.hasOwnProperty.call(result, "order_scope")) setOrderContext(result.order_scope);
      setTicket(result.ticket || null);
      renderMessages(result.messages || []);
      if (!quiet) setStatus();
    } catch (error) {
      if (controller.signal.aborted || fetchGeneration !== messageFetchGeneration || contextGeneration !== messageContextGeneration || orderId !== (activeOrder?.id || null)) return;
      if (error.status === 401) return showGuest();
      setStatus(needsCompany(error) ? "Finish business setup in your dashboard before messaging support." : "Could not load messages. Retry shortly.", "err");
    }
  };
  const refresh = async () => {
    try {
      const { getToken } = await auth();
      if (!await getToken()) return showGuest();
      showThread();
      await loadMessages();
      void setChatPresence(true);
      startPolling();
    } catch {
      showGuest();
    }
  };
  const open = async () => {
    setOpen(true);
    void updateQuoteHref();
    await refresh();
    (authenticated ? (newTicketMode ? ticketSubject : body) : guestAction).focus();
  };
  openSupportOrder = (order) => {
    setOrderContext(order);
    void open();
  };
  if (pendingSupportOrder) {
    openSupportOrder(pendingSupportOrder);
    pendingSupportOrder = null;
  }

  toggle.addEventListener("click", () => panel.hidden ? void open() : setOpen(false));
  close.addEventListener("click", () => setOpen(false));
  newTicketButton.addEventListener("click", () => {
    setNewTicketMode(!newTicketMode);
    (newTicketMode ? ticketSubject : body).focus();
  });
  orderClear.addEventListener("click", () => {
    setOrderContext(null);
    void loadMessages();
    body.focus();
  });
  list.addEventListener("wheel", (event) => {
    if (list.scrollHeight <= list.clientHeight) return;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1;
    const before = list.scrollTop;
    list.scrollTop += event.deltaY * scale;
    if (list.scrollTop !== before) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
  document.addEventListener("masest:auth", () => { if (!panel.hidden) void refresh(); });
  document.addEventListener("masest:session-expired", () => { if (!panel.hidden) showGuest(); });
  document.addEventListener("cart:updated", () => { if (!panel.hidden) void updateQuoteHref(); });
  document.addEventListener("masest:support-route", syncRouteVisibility);
  document.addEventListener(OBSTRUCTION_EVENT, scheduleDockAvoidance);
  window.addEventListener("hashchange", syncRouteVisibility);
  window.addEventListener("resize", scheduleDockAvoidance, { passive: true });
  // A fixed obstruction (the lead bar) holds its position relative to the launcher, so resize
  // is enough. An in-flow one — a purchase CTA — only enters the launcher's corner partway
  // down the page, so it needs a scroll-time re-check. Read the distinction off computed
  // layout rather than an attribute value, so a future in-flow obstruction is covered without
  // anyone having to remember to declare it.
  const inFlowObstruction = [...document.querySelectorAll(OBSTRUCTION_SELECTOR)]
    .some((obstruction) => getComputedStyle(obstruction).position !== "fixed");
  if (inFlowObstruction) window.addEventListener("scroll", scheduleDockAvoidance, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (panel.hidden || !authenticated) return;
    void setChatPresence(!document.hidden, { force: true, keepalive: document.hidden });
  });
  window.addEventListener("pagehide", () => { if (!panel.hidden) void setChatPresence(false, { force: true, keepalive: true }); });
  body.addEventListener("input", () => saveChatDraft());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawText = body.value;
    const text = rawText.trim();
    if (!text || !authenticated) return;
    const mutationContextGeneration = messageContextGeneration;
    const mutationOrderId = activeOrder?.id || null;
    const mutationTicketId = activeTicket?.id || null;
    const mutationNewTicketMode = newTicketMode;
    const mutationSubject = ticketSubject.value.trim()
      || text.split(/\r?\n/).find(Boolean)?.slice(0, 120)
      || "Support request";
    const mutationCategory = ticketCategory.value || "general";
    const mutationDraftKey = chatDraftKey(mutationTicketId, mutationOrderId, mutationNewTicketMode);
    saveChatDraft(mutationDraftKey);
    const mutationDraftRevision = chatDraftRevisions.get(mutationDraftKey);
    const send = form.querySelector('[type="submit"]');
    send.disabled = true;
    setStatus("Sending…");
    try {
      const { api } = await auth();
      const payload = { body: text, source: "customer_chat", order_id: mutationOrderId };
      if (mutationNewTicketMode) {
        payload.action = "start_ticket";
        payload.subject = mutationSubject;
        payload.category = mutationCategory;
      } else if (mutationTicketId) {
        payload.ticket_id = mutationTicketId;
      }
      const response = await api("/api/account/messages", {
        method: "POST",
        body: payload,
      });
      const draftUnchanged = chatDraftRevisions.get(mutationDraftKey) === mutationDraftRevision
        && chatDrafts.get(mutationDraftKey) === rawText;
      const newerDraft = draftUnchanged ? null : (chatDrafts.get(mutationDraftKey) ?? body.value);
      const newerDraftRevision = draftUnchanged ? null : chatDraftRevisions.get(mutationDraftKey);
      if (draftUnchanged) {
        chatDrafts.delete(mutationDraftKey);
        chatDraftRevisions.delete(mutationDraftKey);
        if (chatDraftKey() === mutationDraftKey && body.value === rawText) body.value = "";
      }
      if (mutationContextGeneration !== messageContextGeneration
        || mutationOrderId !== (activeOrder?.id || null)
        || mutationTicketId !== (activeTicket?.id || null)) return;
      if (response?.ticket) setTicket(response.ticket);
      setNewTicketMode(false);
      if (newerDraft !== null) {
        const nextDraftKey = chatDraftKey(response?.ticket?.id || activeTicket?.id || null, mutationOrderId, false);
        if (newerDraft) {
          chatDrafts.set(nextDraftKey, newerDraft);
          chatDraftRevisions.set(nextDraftKey, ++nextChatDraftRevision);
        } else {
          chatDrafts.delete(nextDraftKey);
          chatDraftRevisions.delete(nextDraftKey);
        }
        if (nextDraftKey !== mutationDraftKey
          && chatDraftRevisions.get(mutationDraftKey) === newerDraftRevision
          && chatDrafts.get(mutationDraftKey) === newerDraft) {
          chatDrafts.delete(mutationDraftKey);
          chatDraftRevisions.delete(mutationDraftKey);
        }
        body.value = newerDraft;
      }
      setStatus("Sent.", "ok");
      await loadMessages({ quiet: true });
    } catch (error) {
      const sameContext = mutationContextGeneration === messageContextGeneration
        && mutationOrderId === (activeOrder?.id || null)
        && mutationTicketId === (activeTicket?.id || null);
      if (error.status === 401) showGuest();
      else if (sameContext) setStatus(
        error.status === 429 ? "Too many messages. Wait a minute, then retry."
          : needsCompany(error) ? "Finish business setup in your dashboard before messaging support."
            : "Could not send. Retry shortly.",
        "err",
      );
    } finally {
      send.disabled = false;
    }
  });
  scheduleDockAvoidance();
  void stylesheetReady.then(scheduleDockAvoidance);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCustomerChat, { once: true });
else initCustomerChat();
