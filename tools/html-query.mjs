/* Structural queries over shipped HTML, backed by parse5.
 *
 * Tests here used to locate an element by regex and then find its end by walking <div>
 * tags and counting depth. Both halves are avoidable: a non-greedy pattern closes on the
 * first inner </div> and silently reports one card per grid, and a hand-rolled depth walk
 * starts wherever its anchor matched, which is mid-tag if the anchor was an attribute.
 * parse5 has been a devDependency since a269b45b and does this correctly.
 *
 * Node has no DOM, so these are the few helpers the suite actually needs rather than a
 * querySelector shim.
 */
import { parse, parseFragment, serialize } from "parse5";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

export function parseHtml(html, { locations = false } = {}) {
  const source = String(html);
  const options = locations ? { sourceCodeLocationInfo: true } : undefined;
  return source.includes("<html") ? parse(source, options) : parseFragment(source, options);
}

// Exact source bytes for a node, so a test can compare shipped markup verbatim instead of
// re-serialising it. Requires parseHtml(..., { locations: true }).
export function rawOf(html, node) {
  const at = node?.sourceCodeLocation;
  if (!at) throw new Error("rawOf needs a tree parsed with { locations: true }");
  return String(html).slice(at.startOffset, at.endOffset);
}

export function elements(node, out = []) {
  if (node?.tagName) out.push(node);
  for (const child of node?.childNodes || []) elements(child, out);
  return out;
}

export function attr(node, name) {
  return node?.attrs?.find((candidate) => candidate.name === name)?.value ?? null;
}

export function classList(node) {
  return String(attr(node, "class") || "").split(/\s+/).filter(Boolean);
}

// Matches on tag, every class in `classes`, and every attribute in `attrs` (a null value
// means "present with any value").
export function findAll(html, { tag, classes = [], attrs = {} } = {}, options = {}) {
  const root = typeof html === "string" ? parseHtml(html, options) : html;
  return elements(root).filter((node) => {
    if (tag && node.tagName !== tag) return false;
    const owned = classList(node);
    if (!classes.every((name) => owned.includes(name))) return false;
    return Object.entries(attrs).every(([name, value]) => {
      const actual = attr(node, name);
      return value === null ? actual !== null : actual === value;
    });
  });
}

export function find(html, selector, options = {}) {
  return findAll(html, selector, options)[0] || null;
}

export function textOf(node) {
  if (!node) return "";
  let text = "";
  const visit = (current) => {
    if (current.nodeName === "#text") text += current.value;
    if (current.tagName && VOID.has(current.tagName)) return;
    for (const child of current.childNodes || []) visit(child);
  };
  visit(node);
  return text.replace(/\s+/g, " ").trim();
}

export function htmlOf(node) {
  return node ? serialize(node) : "";
}
