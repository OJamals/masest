import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, escapeHtml, readingTime } from "../tools/_md.mjs";

test("escapeHtml neutralizes HTML metacharacters", () => {
  assert.equal(escapeHtml(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
});

test("headings render at correct level", () => {
  assert.equal(renderMarkdown("# Title"), "<h1>Title</h1>");
  assert.equal(renderMarkdown("### Sub"), "<h3>Sub</h3>");
});

test("paragraphs join wrapped lines", () => {
  assert.equal(renderMarkdown("one\ntwo"), "<p>one two</p>");
});

test("bold, italic, inline code", () => {
  assert.equal(renderMarkdown("**b** *i* `c`"), "<p><strong>b</strong> <em>i</em> <code>c</code></p>");
});

test("unordered and ordered lists", () => {
  assert.equal(renderMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
});

test("links render with href", () => {
  assert.equal(renderMarkdown("[x](https://a.co)"), '<p><a href="https://a.co">x</a></p>');
});

test("fenced code block is escaped, not interpreted", () => {
  const out = renderMarkdown("```\n<script>\n```");
  assert.equal(out, "<pre><code>&lt;script&gt;</code></pre>");
});

test("XSS in body text is escaped", () => {
  assert.equal(renderMarkdown("hi <script>alert(1)</script>"),
    "<p>hi &lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

test("javascript: link scheme is neutralized to plain text", () => {
  assert.equal(renderMarkdown("[x](javascript:alert(1))"), "<p>x</p>");
});

test("blockquote and hr", () => {
  assert.equal(renderMarkdown("> quote"), "<blockquote>\n<p>quote</p></blockquote>");
  assert.equal(renderMarkdown("---"), "<hr>");
});

test("tables render with accessible column and row headers", () => {
  const out = renderMarkdown([
    "| Input | VertKleen | Comparator |",
    "| --- | --- | --- |",
    "| HMIS | **0-0-0** | Current SDS |",
  ].join("\n"));

  assert.equal(out, [
    '<div class="md-table-scroll" tabindex="0">',
    '<table><thead><tr><th scope="col">Input</th><th scope="col">VertKleen</th><th scope="col">Comparator</th></tr></thead>',
    '<tbody><tr><th scope="row">HMIS</th><td><strong>0-0-0</strong></td><td>Current SDS</td></tr></tbody></table>',
    "</div>",
  ].join("\n"));
});

test("table cells escape HTML", () => {
  const out = renderMarkdown("| Input | Result |\n| --- | --- |\n| <script> | safe |");
  assert.match(out, /&lt;script&gt;/);
  assert.doesNotMatch(out, /<script>/);
});

test("cards preserve declared intrinsic image dimensions", () => {
  const out = renderMarkdown("[[card:title=Result|href=/proof|image=/result.webp|alt=Result image|width=919|height=690]]");
  assert.match(out, /<img src="\/result\.webp" alt="Result image" width="919" height="690"/);
});

test("readingTime is at least 1 minute", () => {
  assert.equal(readingTime(""), 1);
  assert.equal(readingTime(new Array(400).fill("w").join(" ")), 2);
});
