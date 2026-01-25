# RaceTools

Static web app with two race-day tools:

- RaceStarter (race start timing + line setup)
- RacePerformance (VMG Hunter)

## Kalman filter (GPS smoothing)

RaceStarter uses a small Kalman filter to smooth GPS position and estimate a steady velocity
vector for the start-line calculations. Measurement noise is taken from reported GPS accuracy,
and the process noise is gain-scheduled using boat-length scaling arguments and recent-max
speed behavior.

Details: `docs/master.tex`

## Docs (LaTeX)

- Build: `latexmk -cd -pdf docs/master.tex`
- VS Code: open `docs/master.tex` and use LaTeX Workshop’s PDF tab viewer (SyncTeX is enabled).

## Run locally

Open `index.html` in a browser, or serve the folder with any static server.

## Files

- `index.html` – main UI
- `app.js` – logic
- `style.css` – styles
- `map.html` / `map.js` – map view
- `vendor/` – Leaflet assets
- `manifest.json` / `sw.js` – PWA assets
