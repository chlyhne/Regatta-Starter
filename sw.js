const CACHE_NAME = "racetimer-v122";
const ASSETS = [
  "./",
  "./index.html",
  "./map.html",
  "./style.css",
  "./map.css",
  "./app.js",
  "./settings.js",
  "./state.js",
  "./tuning.js",
  "./dom.js",
  "./audio.js",
  "./format.js",
  "./geo.js",
  "./build.js",
  "./gps-ui.js",
  "./gps-watch.js",
  "./race.js",
  "./track.js",
  "./race-fit.js",
  "./velocity.js",
  "./kalman.js",
  "./map.js",
  "./docs/kalman.tex",
  "./docs/tuning.tex",
  "./docs/master.tex",
  "./docs/preamble.tex",
  "./docs/intro.tex",
  "./docs/appendix.tex",
  "./docs/plots/gain-q-length.pdf",
  "./docs/plots/gain-speed-scale.pdf",
  "./docs/plots/gain-gravity-alpha.pdf",
  "./manifest.json",
  "./boat.svg",
  "./icon.svg",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
];

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      let bypassCache = false;
      const requestUrl = new URL(event.request.url);
      if (requestUrl.searchParams.has("nocache")) {
        bypassCache = true;
      } else if (event.clientId) {
        const client = await clients.get(event.clientId);
        if (client) {
          const clientUrl = new URL(client.url);
          bypassCache = clientUrl.searchParams.has("nocache");
        }
      }

      const stripNoCache = (request) => {
        const url = new URL(request.url);
        if (!url.searchParams.has("nocache")) return null;
        url.searchParams.delete("nocache");
        return new Request(url.toString(), request);
      };

      if (bypassCache) {
        try {
          return await fetch(event.request, { cache: "reload" });
        } catch {
          const stripped = stripNoCache(event.request);
          if (stripped) {
            const cachedStripped = await caches.match(stripped);
            if (cachedStripped) return cachedStripped;
          }
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const fallback = await caches.match("./index.html");
          return fallback || Response.error();
        }
      }

      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch {
        const fallback = await caches.match("./index.html");
        return fallback || Response.error();
      }
    })()
  );
});
