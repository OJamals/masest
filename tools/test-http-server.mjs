const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function waitForHttpServer(url, {
  attempts = 40,
  delayMs = 125,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      const ready = response.ok;
      await response.arrayBuffer();
      if (ready) return;
    } catch {
      // Server connection or response body is not ready yet.
    }

    if (attempt < attempts - 1) await sleepImpl(delayMs);
  }

  throw new Error("static server did not start");
}
