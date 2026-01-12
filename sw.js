const CACHE_NAME = "racetimer-v38";
const ASSETS = [
  "./",
  "./index.html",
  "./map.html",
  "./style.css",
  "./map.css",
  "./app.js",
  "./settings.js",
  "./state.js",
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
  "./manifest.json",
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
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).catch(() => {
          return caches.match("./index.html");
        })
      );
    })
  );
});
