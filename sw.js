const CACHE_NAME = "racetimer-v149";
const ASSETS = [
  "./",
  "./index.html",
  "./map.html",
  "./style.css",
  "./map.css",
  "./app.js",
  "./build.js",
  "./replay/manifest.json",
  "./map.js",
  "./manifest.json",
  "./boat.svg",
  "./icon.svg",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./core/common.js",
  "./core/clock.js",
  "./core/heading.js",
  "./core/settings.js",
  "./core/state.js",
  "./core/tuning.js",
  "./core/audio.js",
  "./core/format.js",
  "./core/geo.js",
  "./core/recording.js",
  "./core/replay.js",
  "./core/units.js",
  "./core/gps-watch.js",
  "./core/velocity.js",
  "./core/kalman.js",
  "./ui/gps-ui.js",
  "./features/starter/starter.js",
  "./features/starter/race.js",
  "./features/starter/race-fit.js",
  "./features/starter/track.js",
  "./features/vmg/vmg.js",
  "./features/lifter/lifter.js",
  "./features/home/home.js",
  "./features/settings/settings-view.js",
  "./ui/app-shell.js",
  "./ui/dom.js",
  "./ui/navigation.js",
  "./ui/modals.view.js",
  "./features/home/home.view.js",
  "./features/starter/setup.view.js",
  "./features/starter/race.view.js",
  "./features/starter/coords.view.js",
  "./features/starter/location.view.js",
  "./features/starter/track.view.js",
  "./features/vmg/vmg.view.js",
  "./features/lifter/lifter.view.js",
  "./features/settings/settings.view.js",
  "./features/settings/boat.view.js",
  "./features/settings/info.view.js",
  "./docs/kalman.tex",
  "./docs/tuning.tex",
  "./docs/master.tex",
  "./docs/preamble.tex",
  "./docs/intro.tex",
  "./docs/racelifter.tex",
  "./docs/appendix.tex",
  "./docs/plots/gain-q-length.pdf",
  "./docs/plots/gain-speed-scale.pdf",
  "./docs/plots/gain-gravity-alpha.pdf",
  "./replay/2026-01-24T22-00-29-861Z.ndjson.gz",
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
