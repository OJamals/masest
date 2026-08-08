import { escapeHtml, renderMarkdown } from "../md.js?v=20260807f";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function attrValue(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function plainText(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function cleanMarkdown(value) {
  return String(value || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdown(html = "") {
  let source = String(html || "").replace(/\r\n?/g, "\n");
  source = source.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
    if (!/\bdata-md-card\b/i.test(match)) return match;
    const title = attrValue(attrs, "data-md-title") || plainText(inner);
    const href = attrValue(attrs, "href");
    const image = attrValue(attrs, "data-md-image");
    const alt = attrValue(attrs, "data-md-alt");
    return `[[card:title=${title}|href=${href}${image ? `|image=${image}` : ""}${alt ? `|alt=${alt}` : ""}]]`;
  });
  source = source.replace(/<img\b([^>]*)>/gi, (_match, attrs) => {
    const src = attrValue(attrs, "src");
    const alt = attrValue(attrs, "alt");
    return src ? `![${alt}](${src})` : alt;
  });
  source = source.replace(/<span\b([^>]*)data-md-size=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_match, _attrs, size, inner) => `[[size:${decodeEntities(size)}|${plainText(inner)}]]`);
  source = source.replace(/<span\b([^>]*)data-md-color=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_match, _attrs, color, inner) => `[[color:${decodeEntities(color)}|${plainText(inner)}]]`);
  source = source
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => `**${plainText(inner)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => `*${plainText(inner)}*`)
    .replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_match, inner) => `++${plainText(inner)}++`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner) => `\`${plainText(inner)}\``)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(p|div|section|article|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<\/(p|div|section|article|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return cleanMarkdown(decodeEntities(source));
}

export function markdownToEditorHtml(markdown = "") {
  return renderMarkdown(markdown || "");
}

export function richEditorTemplate({ key, label = "Body", value = "", textareaAttrs = "", minHeight = 260 } = {}) {
  const safeKey = escapeHtml(key || "body");
  return `
    <div class="adm-rich-editor" data-rich-editor data-rich-editor-key="${safeKey}">
      <span class="adm-rich-label">${escapeHtml(label)}</span>
      <div class="adm-md-tools adm-rich-editor-toolbar" role="toolbar" aria-label="Visual editor tools">
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="format_bold" aria-label="Bold" title="Bold"><i class="ph ph-text-b" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="format_italic" aria-label="Italic" title="Italic"><i class="ph ph-text-italic" aria-hidden="true"></i></button>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="format_underline" aria-label="Underline" title="Underline"><i class="ph ph-text-underline" aria-hidden="true"></i></button>
        <select class="adm-select adm-select-sm" data-editor-action="format_size" data-editor-format-size aria-label="Text size">
          <option value="">Size</option>
          <option value="16">16</option>
          <option value="20">20</option>
          <option value="24">24</option>
        </select>
        <input class="adm-input" type="color" value="#0e7c86" data-editor-format-color aria-label="Text color">
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="format_color">Color</button>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="insert_image"><i class="ph ph-image" aria-hidden="true"></i> Image</button>
        <button type="button" class="btn btn-ghost btn-sm" data-editor-action="open_reference"><i class="ph ph-link-simple" aria-hidden="true"></i> Insert reference</button>
      </div>
      <div class="adm-rich-editor-surface adm-rich-surface blog-body" data-rich-editor-surface contenteditable="true" role="textbox" aria-multiline="true" aria-label="${escapeHtml(label)} editor" spellcheck="true" style="min-height:${Number(minHeight) || 260}px">${markdownToEditorHtml(value)}</div>
      <textarea ${textareaAttrs} data-rich-editor-output="${safeKey}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

export function referencePickerTemplate({ prefix, admEmpty }) {
  const safePrefix = escapeHtml(prefix || "content");
  return `
    <div id="${safePrefix}ReferencePicker" class="adm-card adm-rich-reference-picker" hidden>
      <div class="adm-panel-header">
        <div>
          <h2 id="${safePrefix}ReferenceTitle">Insert reference</h2>
          <p class="muted">Choose a product, service, or program to insert as a thumbnail link.</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-editor-action="close_reference">
          <i class="ph ph-x" aria-hidden="true"></i> Close
        </button>
      </div>
      <div id="${safePrefix}ReferenceRows" class="adm-list" aria-live="polite">
        ${admEmpty ? admEmpty("ph-link-simple", "No references", "Load products, services, or programs to insert a link card.") : ""}
      </div>
    </div>
  `;
}

export function insertMarkdownIntoRichEditor(editor, markdown, onChange) {
  if (!editor) return false;
  const surface = editor.querySelector("[data-rich-editor-surface]");
  const output = editor.querySelector("[data-rich-editor-output]");
  if (!surface || !output) return false;
  insertHtmlAtSelection(surface, markdownToEditorHtml(markdown));
  syncOutput(surface, output, onChange);
  return true;
}

export function refreshRichTextEditor(editor) {
  if (!editor) return false;
  const surface = editor.querySelector("[data-rich-editor-surface]");
  const output = editor.querySelector("[data-rich-editor-output]");
  if (!surface || !output) return false;
  surface.innerHTML = markdownToEditorHtml(output.value || "");
  return true;
}

function selectedRange(surface, fallbackRange) {
  const selection = window.getSelection?.();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (surface.contains(range.commonAncestorContainer)) return range;
  }
  if (fallbackRange && surface.contains(fallbackRange.commonAncestorContainer)) return fallbackRange;
  return null;
}

function wrapSelection(surface, htmlForText, fallbackRange) {
  const range = selectedRange(surface, fallbackRange);
  if (!range) return;
  const text = range.toString().trim();
  if (!text) return;
  const wrapper = document.createElement("span");
  wrapper.innerHTML = htmlForText(text);
  range.deleteContents();
  range.insertNode(wrapper.firstElementChild || document.createTextNode(text));
  window.getSelection?.()?.removeAllRanges();
}

function insertHtmlAtSelection(surface, html) {
  surface.focus();
  const selection = window.getSelection?.();
  if (selection && selection.rangeCount && surface.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    const range = selection.getRangeAt(0);
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    range.deleteContents();
    range.insertNode(fragment);
    selection.removeAllRanges();
  } else {
    surface.insertAdjacentHTML("beforeend", html);
  }
}

function appendMarkdownBlock(surface, markdown) {
  surface.insertAdjacentHTML("beforeend", `<p>${markdownToEditorHtml(markdown)}</p>`);
}

function syncOutput(surface, output, onChange) {
  if (!surface || !output) return;
  output.value = htmlToMarkdown(surface.innerHTML);
  onChange?.(output.value, output);
  output.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

function productPath(product = {}) {
  const slug = String(product.slug || product.sku || product.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/products/${slug || "product"}`;
}

function cardMarkdown(item = {}) {
  return `[[card:title=${item.title}|href=${item.href}${item.image ? `|image=${item.image}` : ""}${item.alt ? `|alt=${item.alt}` : ""}]]`;
}

function referenceButton(item) {
  return `
    <button class="adm-content-entry-row" type="button" data-editor-reference-path="${escapeHtml(item.href)}" data-editor-reference-md="${escapeHtml(cardMarkdown(item))}">
      <span class="adm-content-entry-main">
        <span class="adm-content-title">${escapeHtml(item.title)}</span>
        <span class="adm-content-meta">${escapeHtml(item.href)}</span>
      </span>
    </button>
  `;
}

function referenceRows(groups = []) {
  return groups.map((group) => `
    <details class="adm-rich-reference-group" open>
      <summary>${escapeHtml(group.title)}</summary>
      <div class="adm-list">
        ${(group.items || []).map((item) => item.items ? `
          <details class="adm-rich-reference-group">
            <summary>${escapeHtml(item.title)}</summary>
            <div class="adm-list">${item.items.map(referenceButton).join("")}</div>
          </details>
        ` : referenceButton(item)).join("")}
      </div>
    </details>
  `).join("");
}

function productReferenceGroups(products = []) {
  const groups = new Map();
  products.filter((product) => product.active !== false).forEach((product) => {
    const key = String(product.group_key || "Products").trim() || "Products";
    const productItem = {
      title: product.name || product.title || product.sku || "Product",
      href: productPath(product),
      image: product.image_url || product.photo_url || product.image || "",
      alt: product.photo_alt || product.image_alt || product.name || "",
    };
    const variants = (product.product_variants || product.variants || [])
      .filter((variant) => variant.active !== false)
      .map((variant) => ({
        ...productItem,
        title: `${productItem.title} — ${variant.label || variant.vsku || "Variant"}`,
      }));
    const items = groups.get(key) || [];
    items.push(variants.length ? { ...productItem, items: [productItem, ...variants] } : productItem);
    groups.set(key, items);
  });
  return [...groups].map(([title, items]) => ({ title, items }));
}

function contentReferenceItems(entries = [], fallbackTitle, href) {
  return entries.map((entry) => ({
    title: entry.title || entry.slug || "Service",
    href,
    image: entry.payload?.image || entry.payload?.hero || "",
    alt: entry.payload?.image_alt || entry.title || "",
  }));
}

async function loadReferenceGroups(api) {
  const request = (path) => api ? api(path) : fetch(path, { cache: "no-store" }).then((response) => response.ok ? response.json() : {});
  const [products, services] = await Promise.all([
    request("/api/admin/products"),
    request("/api/admin/content?type=service&status=published"),
  ]);
  return [
    { title: "Products", items: productReferenceGroups(products.products || []) },
    { title: "Services", items: contentReferenceItems(services.entries || [], "Service", "/services") },
    {
      title: "Programs",
      items: [
        { title: "Programs & Pricing", href: "/programs", image: "img/site/scenes/water-treatment-program.webp", alt: "Water-treatment program" },
        { title: "Bronze — Essentials", href: "/contact?type=quote&product=Full%20Cooling%20Tower%20Program&message=Cooling%20tower%20program%20quote%20%E2%80%94%20Bronze%20tier.", image: "", alt: "" },
        { title: "Silver — Standard", href: "/contact?type=quote&product=Full%20Cooling%20Tower%20Program&message=Cooling%20tower%20program%20quote%20%E2%80%94%20Silver%20tier.", image: "", alt: "" },
        { title: "Gold — Premium", href: "/contact?type=quote&product=Full%20Cooling%20Tower%20Program&message=Cooling%20tower%20program%20quote%20%E2%80%94%20Gold%20tier.", image: "", alt: "" },
        { title: "Platinum — Full Lifecycle", href: "/contact?type=quote&product=Full%20Cooling%20Tower%20Program&message=Cooling%20tower%20program%20quote%20%E2%80%94%20Platinum%20tier.", image: "", alt: "" },
      ],
    },
  ];
}

export function createRichTextEditor(editor, options = {}) {
  if (!editor || editor.dataset.richEditorReady === "1") return null;
  const root = options.root || editor.closest(".adm-card") || document;
  const key = editor.dataset.richEditorKey || "body";
  const output = options.output || root.querySelector(`[data-rich-editor-output="${key}"]`) || root.querySelector(`[data-content-payload-field="${key}"]`);
  const surface = editor.querySelector("[data-rich-editor-surface]");
  if (!surface || !output) return null;
  editor.dataset.richEditorReady = "1";
  output.dataset.richEditorOutput = key;
  surface.innerHTML = markdownToEditorHtml(output.value || "");

  const picker = options.referencePicker || root.querySelector(options.referencePickerSelector || "#contentReferencePicker");
  const rows = options.referenceRows || root.querySelector(options.referenceRowsSelector || "#contentReferenceRows");
  let lastSelectionRange = null;
  const rememberSelection = () => {
    const range = selectedRange(surface);
    lastSelectionRange = range?.cloneRange() || lastSelectionRange;
  };

  surface.addEventListener("input", () => {
    rememberSelection();
    syncOutput(surface, output, options.onChange);
  });
  surface.addEventListener("keyup", rememberSelection);
  surface.addEventListener("mouseup", rememberSelection);
  editor.addEventListener("mousedown", (event) => {
    if (event.target.closest("button[data-editor-action]")) event.preventDefault();
  });
  editor.addEventListener("change", (event) => {
    if (event.target.matches("[data-editor-format-size]")) {
      const size = event.target.value;
      if (size) wrapSelection(surface, (text) => `<span data-md-size="${escapeHtml(size)}">${escapeHtml(text)}</span>`, lastSelectionRange);
      syncOutput(surface, output, options.onChange);
    }
  });
  editor.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-editor-action]");
    if (!button) return;
    const action = button.dataset.editorAction;
    if (action === "format_bold") document.execCommand("bold");
    if (action === "format_italic") document.execCommand("italic");
    if (action === "format_underline") document.execCommand("underline");
    if (action === "format_size") {
      const size = editor.querySelector("[data-editor-format-size]")?.value || "20";
      wrapSelection(surface, (text) => `<span data-md-size="${escapeHtml(size)}">${escapeHtml(text)}</span>`, lastSelectionRange);
    }
    if (action === "format_color") {
      const color = editor.querySelector("[data-editor-format-color]")?.value || "#0e7c86";
      wrapSelection(surface, (text) => `<span data-md-color="${escapeHtml(color)}">${escapeHtml(text)}</span>`);
    }
    if (action === "insert_image") {
      if (options.onInsertImage) {
        options.onInsertImage(key, {
          button,
          editor,
          surface,
          insertMarkdown: (markdown) => {
            insertHtmlAtSelection(surface, markdownToEditorHtml(markdown));
            syncOutput(surface, output, options.onChange);
          },
        });
        return;
      }
      const url = window.prompt?.("Image URL") || "";
      if (url) insertHtmlAtSelection(surface, `<img src="${escapeHtml(url)}" alt="" width="1200" height="675" loading="lazy">`);
    }
    if (action === "close_reference" && picker) {
      picker.hidden = true;
      return;
    }
    if (action === "open_reference" && picker && rows) {
      picker.hidden = false;
      rows.innerHTML = '<p class="adm-status">Loading references…</p>';
      rows.__richEditorInsert = (markdown) => {
        appendMarkdownBlock(surface, markdown);
        syncOutput(surface, output, options.onChange);
        picker.hidden = true;
      };
      const groups = await loadReferenceGroups(options.api).catch(() => []);
      rows.innerHTML = groups.length ? referenceRows(groups) : '<p class="adm-status" data-state="warn">No references found.</p>';
    }
    syncOutput(surface, output, options.onChange);
  });
  if (rows && !rows.dataset.richEditorReferenceWired) {
    rows.dataset.richEditorReferenceWired = "1";
    rows.addEventListener("click", (event) => {
      const button = event.target.closest("[data-editor-reference-md]");
      if (!button) return;
      rows.__richEditorInsert?.(button.dataset.editorReferenceMd || "");
    });
  }
  return { surface, output, sync: () => syncOutput(surface, output) };
}
