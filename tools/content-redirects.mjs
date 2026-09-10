#!/usr/bin/env node
/**
 * Repo-owned 301 map for retired content URLs (blog posts consolidated into
 * comparisons, industries and product pillars).
 *
 * Deliberately separate from renderIndustryRedirects() in build-industry-pages.mjs.
 * That function emits exactly the industries-to-industries set and is asserted to
 * equal it byte for byte (tests/industry-pages.test.mjs:128). Widening it would
 * break that assertion for no gain; cf-build.mjs concatenates the two instead.
 *
 * The two differ in one invariant that matters. An industries redirect requires its
 * source file to be GONE — the industries test asserts `existsSync(from.html) ===
 * false`. A content redirect's source file is still present, because blog bodies are
 * Supabase-authoritative and cannot be retired from the repo. Cloudflare Pages applies
 * _redirects "regardless of whether or not an asset matches the incoming request", so
 * the 301 still wins. Do not copy the stale-page assertion into this module's tests.
 */

/** Path segment: lowercase alphanumeric, single interior hyphens. */
const segmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Destination fragment: same shape, after a single `#`. */
const fragmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ALLOWED_STATUS = new Set([301, 308]);

function parsePath(value, label) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error(`${label}: must be a root-absolute path, got ${JSON.stringify(value)}`);
  }
  // Reject anything that could break out of its own _redirects line, or smuggle a
  // second rule in. The industries emitter is tested against exactly this attack
  // ('safe\n/injected'); the same guard belongs here.
  if (/[\s"'\\]/.test(value)) {
    throw new Error(`${label}: whitespace or quoting in path ${JSON.stringify(value)}`);
  }
  const [pathname, fragment, ...rest] = value.slice(1).split('#');
  if (rest.length) {
    throw new Error(`${label}: more than one '#' in ${value}`);
  }
  const segments = pathname.split('/');
  if (!segments.length || segments.some((segment) => !segmentPattern.test(segment))) {
    throw new Error(`${label}: invalid path ${value}`);
  }
  if (fragment !== undefined && !fragmentPattern.test(fragment)) {
    throw new Error(`${label}: invalid fragment in ${value}`);
  }
  return { pathname: `/${pathname}`, fragment };
}

/**
 * @param {{ redirects?: Array<{from: string, to: string, status?: number, reason?: string}> }} config
 * @param {{ exists?: (pathname: string) => boolean }} [options]
 *   `exists` receives a destination pathname (fragment stripped) and should report
 *   whether the target page is present. Omit it to skip target resolution — the build
 *   passes it, so a redirect to a page nobody generated fails the build rather than
 *   shipping a 301 into a 404.
 * @returns {string} `_redirects` lines, newline-terminated, or '' when empty.
 */
export function renderContentRedirects(config, { exists } = {}) {
  const entries = config?.redirects ?? [];
  if (!Array.isArray(entries)) {
    throw new Error('content redirects: `redirects` must be an array');
  }

  const sources = new Set();
  const destinations = new Set();
  const lines = [];

  for (const entry of entries) {
    const { from, to, status = 301, reason } = entry ?? {};
    const source = parsePath(from, 'redirect source');
    const target = parsePath(to, `${from}: redirect target`);

    if (source.fragment !== undefined) {
      throw new Error(`${from}: fragments are evaluated by the browser, never sent — drop it from the source`);
    }
    if (!ALLOWED_STATUS.has(status)) {
      throw new Error(`${from}: status ${status} is not a permanent redirect`);
    }
    if (!reason || typeof reason !== 'string') {
      throw new Error(`${from}: every redirect needs a \`reason\`, so a later reader can tell intent from accident`);
    }
    if (source.pathname === target.pathname) {
      throw new Error(`${from}: redirects to itself`);
    }
    if (sources.has(source.pathname)) {
      throw new Error(`${from}: duplicate redirect source`);
    }
    if (exists && !exists(target.pathname)) {
      throw new Error(`${from}: redirect target ${target.pathname} does not exist`);
    }

    sources.add(source.pathname);
    destinations.add(target.pathname);
    lines.push(`${source.pathname} ${to} ${status}`);
  }

  // A chain (A->B, B->C) costs an extra round trip and loses PageRank at each hop;
  // a cycle hangs the client. Both are caught by the same check.
  for (const destination of destinations) {
    if (sources.has(destination)) {
      throw new Error(`${destination}: is both a redirect source and a redirect target — collapse the chain`);
    }
  }

  return lines.sort().join('\n') + (lines.length ? '\n' : '');
}
