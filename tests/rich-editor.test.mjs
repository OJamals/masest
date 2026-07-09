import assert from "node:assert/strict";
import test from "node:test";
import { htmlToMarkdown, markdownToEditorHtml } from "../js/admin/rich-editor.js";

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
