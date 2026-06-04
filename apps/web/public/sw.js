// Service worker for offline support.
//
// Strategy:
//   · /_next/static/**         → CACHE-FIRST (assets are content-addressed
//     and immutable; once cached they can be served forever).
//   · navigations / HTML       → NETWORK-FIRST, fall back to cache only if
//     offline; this guarantees the HTML always references the LATEST chunk
//     hashes after a deploy, fixing the "404 on /_next/static/..." problem
//     that bites pure cache-first strategies after a redeploy.
//   · cross-origin & non-GET   → pass-through.
//
// Cache name is bumped to v2 so the old "stocks-portfolio-report-v1" entries
// from previous versions get wiped on activate.

const STATIC_CACHE = "spr-static-v2";
const HTML_FALLBACK = "/";

self.addEventListener("install", (event) => {
  // Don't pre-cache anything — let real navigations fill the cache. This
  // avoids the install step polluting the cache with a stale HTML version.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch cross-origin (Vercel insights, third-party CDNs, etc.).
  if (url.origin !== self.location.origin) return;

  // ─── Hashed static assets: cache-first (immutable filenames) ─────────────
  // Next.js puts everything under /_next/static with content-addressed names,
  // so a hit is always correct. Misses fetch + populate the cache.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }),
        ),
      ),
    );
    return;
  }

  // ─── HTML / everything else: network-first, cache for offline fallback ──
  // The browser MUST hit the network first so the HTML always references the
  // latest chunk hashes. If offline, fall back to cached HTML (last seen).
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful HTML responses so the app keeps working offline.
        const isHtml =
          req.mode === "navigate" ||
          req.destination === "document" ||
          (res.headers.get("content-type") || "").includes("text/html");
        if (res && res.ok && isHtml) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match(HTML_FALLBACK)),
      ),
  );
});
