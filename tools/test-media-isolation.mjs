const TRUE_FLAGS = new Set(["1", "true", "yes"]);

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const SUPABASE_STORAGE_GLOB = "https://*.supabase.co/storage/v1/object/**";
export const R2_MEDIA_GLOB = "https://media.masest.co/**";
export const MEDIA_ROUTE_GLOBS = [SUPABASE_STORAGE_GLOB, R2_MEDIA_GLOB];

const STORAGE_PREFIX = "/storage/v1/object/";
const MANAGED_CONTENT_PREFIX = "/storage/v1/object/public/content-assets/";
const R2_MANAGED_PREFIXES = ["/site/", "/cms/"];

function enabled(value) {
  return TRUE_FLAGS.has(String(value || "").trim().toLowerCase());
}

export function liveMediaEnabled(env = process.env) {
  return enabled(env.MASEST_LIVE_MEDIA) && !enabled(env.CI);
}

export function mediaRequestAction(rawUrl, method = "GET") {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "pass";
  }

  const requestMethod = String(method || "GET").toUpperCase();
  const readable = requestMethod === "GET" || requestMethod === "HEAD";
  if (url.protocol === "https:" && url.hostname === "media.masest.co") {
    const managed = R2_MANAGED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    if (!managed) return "block";
    return readable ? "placeholder" : "block";
  }
  if (
    url.protocol === "https:"
    && url.hostname.endsWith(".supabase.co")
    && url.pathname.startsWith(STORAGE_PREFIX)
  ) {
    const managed = url.pathname.startsWith(MANAGED_CONTENT_PREFIX);
    if (managed && readable) return "placeholder";
    return "block";
  }
  return "pass";
}

function placeholderResponse(method) {
  return {
    status: 200,
    contentType: "image/png",
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: String(method).toUpperCase() === "HEAD" ? Buffer.alloc(0) : TRANSPARENT_PNG,
  };
}

export function createMediaIsolation({ env = process.env } = {}) {
  const unexpected = new Set();

  return {
    async install(target) {
      if (liveMediaEnabled(env)) return false;
      if (!target || typeof target.route !== "function") {
        throw new TypeError("media isolation target must expose route()");
      }

      const handler = async (route) => {
        const request = route.request();
        const method = request.method();
        const url = request.url();
        const action = mediaRequestAction(url, method);

        if (action === "placeholder") {
          await route.fulfill(placeholderResponse(method));
          return;
        }

        unexpected.add(`${method} ${url}`);
        await route.abort("blockedbyclient");
      };
      for (const pattern of MEDIA_ROUTE_GLOBS) await target.route(pattern, handler);
      return true;
    },

    assertNoUnexpected() {
      if (!unexpected.size) return;
      throw new Error(`Blocked unexpected managed media requests:\n${[...unexpected].sort().join("\n")}`);
    },
  };
}

export function wrapBrowserWithMediaIsolation(browser, {
  env = process.env,
  close = () => browser.close(),
} = {}) {
  const isolation = createMediaIsolation({ env });
  let closed = false;

  async function isolatedTarget(factory, args) {
    const target = await factory(...args);
    try {
      await isolation.install(target);
      return target;
    } catch (error) {
      await target.close?.().catch(() => {});
      throw error;
    }
  }

  return {
    newContext: (...args) => isolatedTarget(browser.newContext.bind(browser), args),
    newPage: (...args) => isolatedTarget(browser.newPage.bind(browser), args),
    async close() {
      if (closed) return;
      closed = true;

      let closeError;
      try {
        await close();
      } catch (error) {
        closeError = error;
      }

      let isolationError;
      try {
        isolation.assertNoUnexpected();
      } catch (error) {
        isolationError = error;
      }

      if (closeError && isolationError) {
        throw new AggregateError([closeError, isolationError], "browser cleanup and media isolation failed");
      }
      if (closeError) throw closeError;
      if (isolationError) throw isolationError;
    },
  };
}
