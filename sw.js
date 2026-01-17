const CACHE_NAME = "racetimer-v101";
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
  "./docs/kalman.md",
  "./docs/plots/gain-q-length.svg",
  "./docs/plots/gain-speed-scale.svg",
  "./docs/plots/gain-gravity-alpha.svg",
  "./manifest.json",
  "./boat.svg",
  "./icon.svg",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
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

      if (bypassCache) {
        try {
          return await fetch(event.request, { cache: "reload" });
        } catch {
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
