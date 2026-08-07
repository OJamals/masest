/* Shared spacing-regression detector.
 *
 * Catches the class of bug that kept recurring by hand: text jammed against a
 * card edge, text from two elements crowded together, and controls fused into
 * one another. It measures RENDERED geometry, so it catches a regression caused
 * by a CSS change anywhere — token, utility, or page override — not only the
 * selectors a hand-written assertion happens to name.
 *
 * It measures GLYPH rectangles (via Range), not element boxes. A block child
 * naturally spans its parent's full content width, so element-box math reports
 * a 0px inset on every ordinary block and drowns the real defects in noise.
 *
 * Runs in the page via page.evaluate(detectSpacingViolations, options).
 */

export const SPACING_LIMITS = {
  // Glyphs must not sit closer than this to the left/right edge of the painted
  // surface they are on. Horizontal is exact — no line-height leading involved.
  surfaceInsetX: 6,
  // Vertical is measured against line boxes, which already carry half-leading,
  // so only near-flush counts.
  surfaceInsetY: 2,
  // Text owned by two stacked elements must not actually collide. Range rects
  // are LINE boxes, so they overlap by up to the combined half-leading before a
  // single glyph does; that slack is subtracted before comparing. A stricter
  // limit would flag every headline+subhead pair, which is a deliberate
  // typographic pairing rather than a regression.
  textGap: 0,
  // Adjacent interactive controls need a visible seam.
  controlGap: 4,
};

/** Opt-out for genuinely joined UI (segmented controls, fused button groups). */
export const SPACING_OPT_OUT = 'data-spacing-joined';

export function detectSpacingViolations(options) {
  const { surfaceInsetX, surfaceInsetY, textGap, controlGap, optOut } = options;
  const violations = [];
  const CONTROL = 'button, input, select, textarea, .btn';
  const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };

  const joined = (el) => Boolean(el.closest(`[${optOut}]`));

  /** Rectangles of the text this element renders itself (not its children's). */
  const glyphRects = (el) => {
    const rects = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
      }
    }
    return rects;
  };

  const opaque = (color) => color && !TRANSPARENT.test(color.replace(/\s+/g, ' '));

  /** An ENCLOSING surface: a box whose edge wraps the content on every side.
   *  A one- or two-sided border is a divider, not a box — text sitting at the
   *  left edge of a border-top rule is normal, so those must not be treated as
   *  containers that owe an inset. */
  const surfaceOf = (el) => {
    const style = getComputedStyle(el);
    const painted = opaque(style.backgroundColor);
    const boxed = ['Top', 'Right', 'Bottom', 'Left'].every((side) => (
      parseFloat(style[`border${side}Width`]) > 0 && opaque(style[`border${side}Color`])
    ));
    if (!painted && !boxed) return null;
    // A background identical to the parent's paints no visible edge.
    if (painted && !boxed) {
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).backgroundColor === style.backgroundColor) return null;
    }
    return { style, painted, boxed };
  };

  const elements = [...document.querySelectorAll('body *')].filter(visible);

  // --- Rule A: glyphs jammed against the edge of their painted surface --------
  for (const surface of elements) {
    if (joined(surface) || surface.matches(CONTROL)) continue;
    const info = surfaceOf(surface);
    if (!info) continue;
    const { style } = info;
    // Clipping/scrolling regions legitimately run content to the edge.
    if (/auto|scroll|hidden/.test(style.overflowX + style.overflowY)) continue;

    const box = surface.getBoundingClientRect();
    const pad = {
      top: box.top + (parseFloat(style.borderTopWidth) || 0),
      left: box.left + (parseFloat(style.borderLeftWidth) || 0),
      right: box.right - (parseFloat(style.borderRightWidth) || 0),
      bottom: box.bottom - (parseFloat(style.borderBottomWidth) || 0),
    };

    for (const el of surface.querySelectorAll('*')) {
      if (!visible(el) || joined(el)) continue;
      // Out-of-flow elements (overlay badges, tooltips) are placed by explicit
      // coordinates, not by the container's padding.
      if (/absolute|fixed/.test(getComputedStyle(el).position)) continue;
      // The nearest enclosing surface or control owns this text's padding.
      let owner = el.parentElement;
      let ownedByNested = false;
      while (owner && owner !== surface) {
        if (surfaceOf(owner) || owner.matches(CONTROL)) { ownedByNested = true; break; }
        owner = owner.parentElement;
      }
      if (ownedByNested) continue;

      for (const rect of glyphRects(el)) {
        const gaps = {
          left: [rect.left - pad.left, surfaceInsetX],
          right: [pad.right - rect.right, surfaceInsetX],
          top: [rect.top - pad.top, surfaceInsetY],
          bottom: [pad.bottom - rect.bottom, surfaceInsetY],
        };
        for (const [side, [gap, limit]] of Object.entries(gaps)) {
          if (gap >= 0 && gap < limit) {
            violations.push({
              rule: 'surface-inset', side, gap: Math.round(gap * 10) / 10, limit,
              surface: describe(surface), text: describe(el),
              sample: el.textContent.trim().slice(0, 44),
            });
          }
        }
      }
    }
  }

  // --- Rule B: glyphs of two different elements crowded together --------------
  const textOwners = elements
    .filter((el) => !joined(el))
    .map((el) => ({ el, rects: glyphRects(el) }))
    .filter((entry) => entry.rects.length);

  /** How far a line box can sit from the ink inside it, per edge.
   *  line-height > font-size pads the box beyond the glyphs; line-height <
   *  font-size (tight display type) lets the glyphs spill past the box. Either
   *  way the magnitude is the uncertainty between box overlap and ink overlap,
   *  so it is the tolerance before an overlap can be called a collision. */
  const halfLeading = (el) => {
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    const fontSize = parseFloat(style.fontSize);
    if (!Number.isFinite(lineHeight) || !Number.isFinite(fontSize)) return 0;
    return Math.abs(lineHeight - fontSize) / 2;
  };

  for (const parent of elements) {
    const kids = textOwners.filter((entry) => entry.el.parentElement === parent);
    for (let i = 0; i < kids.length - 1; i += 1) {
      const a = kids[i].rects[kids[i].rects.length - 1];
      const b = kids[i + 1].rects[0];
      const overlapsX = b.left < a.right && a.left < b.right;
      if (!overlapsX) continue;
      // Inline siblings sharing a line are side by side, not stacked.
      const sharesLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
      if (sharesLine) continue;
      const slack = halfLeading(kids[i].el) + halfLeading(kids[i + 1].el);
      const gap = (b.top - a.bottom) + slack;
      if (gap < textGap) {
        violations.push({
          rule: 'text-gap', gap: Math.round(gap * 10) / 10, limit: textGap,
          surface: describe(parent), text: `${describe(kids[i].el)} + ${describe(kids[i + 1].el)}`,
          sample: kids[i].el.textContent.trim().slice(0, 44),
        });
      }
    }
  }

  // --- Rule C: interactive controls fused together -----------------------------
  for (const parent of elements) {
    const controls = [...parent.children].filter((el) => visible(el) && el.matches(CONTROL) && !joined(el));
    for (let i = 0; i < controls.length - 1; i += 1) {
      const a = controls[i].getBoundingClientRect();
      const b = controls[i + 1].getBoundingClientRect();
      const sameRow = Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;
      const gap = sameRow ? b.left - a.right : b.top - a.bottom;
      if (gap >= 0 && gap < controlGap) {
        violations.push({
          rule: 'control-gap', side: sameRow ? 'x' : 'y', gap: Math.round(gap * 10) / 10, limit: controlGap,
          surface: describe(parent), text: `${describe(controls[i])} + ${describe(controls[i + 1])}`,
          sample: controls[i].textContent.trim().slice(0, 44),
        });
      }
    }
  }

  return violations;
}
