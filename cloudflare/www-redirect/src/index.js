const SOURCE_HOST = "www.masest.co";
const CANONICAL_HOST = "masest.co";

function canonicalUrl(requestUrl) {
  const url = new URL(requestUrl);
  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return url.toString();
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.hostname.toLowerCase() !== SOURCE_HOST) {
      return new Response("Not Found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    return new Response(null, {
      status: 301,
      headers: { location: canonicalUrl(url) },
    });
  },
};
