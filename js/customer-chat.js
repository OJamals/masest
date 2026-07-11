/* First-party customer chat. Authenticated customer messages use the existing
 * company support thread, so they appear in Admin → Messages without a vendor bridge. */

const POLL_MS = 30_000;

function pageRoot() {
  return window.MASEST?.chatRoot || "";
}

function makeMessage(message) {
  const item = document.createElement("article");
  item.className = `customer-chat__message customer-chat__message--${message.sender_role === "staff" ? "staff" : "buyer"}`;
  const body = document.createElement("p");
  body.textContent = message.body || "";
  const meta = document.createElement("time");
  meta.dateTime = message.created_at || "";
  meta.textContent = message.sender_role === "staff" ? "MASEST" : "You";
  item.append(body, meta);
  return item;
}

export function initCustomerChat() {
  if (document.getElementById("customerChat")) return;

  const root = pageRoot();
  if (!document.querySelector('link[data-masest-customer-chat="true"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = `${root}css/customer-chat.css?v=20260711a`;
    stylesheet.dataset.masestCustomerChat = "true";
    document.head.append(stylesheet);
  }
  const shell = document.createElement("aside");
  shell.id = "customerChat";
  shell.className = "customer-chat";
  shell.innerHTML = `
    <section class="customer-chat__panel" role="dialog" aria-labelledby="customerChatTitle" hidden>
      <header class="customer-chat__header">
        <div><p class="customer-chat__eyebrow">MASEST support</p><h2 id="customerChatTitle">Customer chat</h2></div>
        <button class="customer-chat__close" type="button" aria-label="Close customer chat"><i class="ph ph-x" aria-hidden="true"></i></button>
      </header>
      <div class="customer-chat__guest" hidden>
        <p>Sign in or create an account to send a secure message to the MASEST team.</p>
        <a class="btn btn-primary" href="${root}account.html">Sign up / Log in</a>
      </div>
      <div class="customer-chat__thread" hidden>
        <div class="customer-chat__messages" aria-live="polite" aria-label="Messages"></div>
        <form class="customer-chat__form">
          <label class="sr-only" for="customerChatBody">Message</label>
          <textarea id="customerChatBody" maxlength="4000" required placeholder="Ask about VertKleen, an order, or your account."></textarea>
          <div class="customer-chat__form-row"><p class="customer-chat__status" role="status" aria-live="polite"></p><button class="btn btn-primary" type="submit">Send</button></div>
        </form>
      </div>
    </section>
    <button class="customer-chat__toggle" type="button" aria-label="Open customer chat" aria-expanded="false" aria-controls="customerChat"><i class="ph ph-chat-circle-dots" aria-hidden="true"></i><span>Chat</span></button>`;
  document.body.append(shell);

  const panel = shell.querySelector(".customer-chat__panel");
  const toggle = shell.querySelector(".customer-chat__toggle");
  const close = shell.querySelector(".customer-chat__close");
  const guest = shell.querySelector(".customer-chat__guest");
  const thread = shell.querySelector(".customer-chat__thread");
  const list = shell.querySelector(".customer-chat__messages");
  const form = shell.querySelector(".customer-chat__form");
  const body = shell.querySelector("#customerChatBody");
  const status = shell.querySelector(".customer-chat__status");
  let authModule;
  let authenticated = false;
  let pollId = 0;

  const setStatus = (text = "", state = "") => {
    status.textContent = text;
    status.dataset.state = state;
  };
  const auth = async () => {
    authModule ||= import("./auth.js?v=20260711a");
    return authModule;
  };
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close customer chat" : "Open customer chat");
    if (!open) {
      window.clearInterval(pollId);
      pollId = 0;
      toggle.focus();
    }
  };
  const showGuest = () => {
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
      if (!document.hidden) loadMessages({ quiet: true });
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
    list.scrollTop = list.scrollHeight;
  };
  const loadMessages = async ({ quiet = false } = {}) => {
    if (!authenticated) return;
    try {
      const { api } = await auth();
      const result = await api("/api/account/messages");
      renderMessages(result.messages || []);
      if (!quiet) setStatus();
    } catch (error) {
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
      startPolling();
    } catch {
      showGuest();
    }
  };
  const open = async () => {
    setOpen(true);
    await refresh();
    if (authenticated) body.focus();
  };

  toggle.addEventListener("click", () => panel.hidden ? void open() : setOpen(false));
  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
  document.addEventListener("masest:auth", () => { if (!panel.hidden) void refresh(); });
  document.addEventListener("masest:session-expired", () => { if (!panel.hidden) showGuest(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = body.value.trim();
    if (!text || !authenticated) return;
    const send = form.querySelector('[type="submit"]');
    send.disabled = true;
    setStatus("Sending…");
    try {
      const { api } = await auth();
      await api("/api/account/messages", { method: "POST", body: { body: text, source: "customer_chat" } });
      body.value = "";
      setStatus("Sent.", "ok");
      await loadMessages({ quiet: true });
    } catch (error) {
      if (error.status === 401) showGuest();
      else setStatus(
        error.status === 429 ? "Too many messages. Wait a minute, then retry."
          : needsCompany(error) ? "Finish business setup in your dashboard before messaging support."
            : "Could not send. Retry shortly.",
        "err",
      );
    } finally {
      send.disabled = false;
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCustomerChat, { once: true });
else initCustomerChat();
