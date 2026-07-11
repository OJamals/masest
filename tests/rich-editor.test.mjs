import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { htmlToMarkdown, markdownToEditorHtml, referencePickerTemplate, richEditorTemplate } from "../js/admin/rich-editor.js";

test("rich editor serializes visual formatting to markdown", () => {
  const html = '<p><strong>Scale</strong> <em>cleanup</em> <u>now</u></p>';

  assert.equal(htmlToMarkdown(html), "**Scale** *cleanup* ++now++");
});

test("rich editor serializes safe size, color, image, and card markup", () => {
  const html = [
    '<p><span data-md-size="20">Large</span> <span data-md-color="#0e7c86">teal</span></p>',
    '<p><img src="img/blog/x.webp" alt="Heat exchanger"></p>',
    '<p><a class="md-card" href="/products/hcr" data-md-card data-md-image="img/products/hcr.webp" data-md-alt="HCR bottle"><strong>VertKleen HCR</strong></a></p>',
  ].join("");

  assert.equal(
    htmlToMarkdown(html),
    [
      "[[size:20|Large]] [[color:#0e7c86|teal]]",
      "![Heat exchanger](img/blog/x.webp)",
      "[[card:title=VertKleen HCR|href=/products/hcr|image=img/products/hcr.webp|alt=HCR bottle]]",
    ].join("\n\n"),
  );
});

test("rich editor renders stored markdown as visual editor HTML", () => {
  const html = markdownToEditorHtml("**Scale** ++cleanup++\n\n[[color:#0e7c86|teal]]");

  assert.match(html, /<strong>Scale<\/strong>/);
  assert.match(html, /<u>cleanup<\/u>/);
  assert.match(html, /data-md-color="#0e7c86"/);
});

test("rich editor exposes names and textbox semantics to assistive technology", () => {
  const html = richEditorTemplate({ key: "body", label: "Article body" });

  assert.match(html, /aria-label="Bold" title="Bold"/);
  assert.match(html, /aria-label="Italic" title="Italic"/);
  assert.match(html, /aria-label="Underline" title="Underline"/);
  assert.match(html, /contenteditable="true" role="textbox" aria-multiline="true" aria-label="Article body editor"/);
});

test("rich editor uses one expandable reference picker and an actionable text-size select", () => {
  const editor = richEditorTemplate({ key: "body" });
  const picker = referencePickerTemplate({ prefix: "content" });

  assert.match(editor, /<select[^>]+data-editor-action="format_size"[^>]+data-editor-format-size/);
  assert.match(editor, /data-editor-action="open_reference"/);
  assert.doesNotMatch(editor, /data-editor-action="reference_(product|service)"/);
  assert.match(picker, /product, service, or program/);
});

test("newsletter image dialog cancel bypasses required URL validation and closes", () => {
  const source = readFileSync(new URL("../js/admin/newsletter.js", import.meta.url), "utf8");

  assert.match(source, /data-nl-img-cancel>Cancel<\/button>/);
  assert.match(source, /data-nl-img-cancel\]'\)\?\.addEventListener\('click', \(\) => dlg\.close\('cancel'\)\)/);
});

test("newsletter image dialog groups fields and can browse registered site assets", () => {
  const source = readFileSync(new URL("../js/admin/newsletter.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/components.css", import.meta.url), "utf8");

  assert.match(source, /confirm-dialog-image/);
  assert.match(source, /data-nl-img-library-open/);
  assert.match(source, /\/api\/admin\/content-assets\?status=available/);
  assert.match(source, /data-nl-img-asset-url/);
  assert.match(css, /\.confirm-dialog-body\s*\{[^}]*display:\s*grid[^}]*gap:\s*16px/s);
  assert.match(css, /\.confirm-dialog-actions\s*\{[^}]*gap:\s*12px/s);
});
