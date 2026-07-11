/* MASEST commerce integrations shared by the public-site chrome. */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cleanString(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

export async function subscribeNewsletter(email, context = {}) {
  const clean = cleanString(email, 254).toLowerCase();
  if (!EMAIL_RE.test(clean)) throw new Error("invalid_email");
  const payload = { email: clean };
  ["source", "source_path", "source_page", "page_title", "industry", "document"].forEach((key) => {
    const max = key === "source_path" ? 300 : 180;
    const value = cleanString(context[key], max);
    if (value) payload[key] = value;
  });
  if (context.document_notify === true) payload.document_notify = true;
  const response = await fetch("/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(out.error || "subscribe_failed");
  return out;
}

if (typeof window !== "undefined") {
  window.MASEST = Object.assign(window.MASEST || {}, { subscribeNewsletter });
}
