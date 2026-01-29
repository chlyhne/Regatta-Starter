var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var UPSTREAM_URL = "http://kblvejr.dk/clientraw.txt";
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function parseClientRaw(text) {
  if (typeof text !== "string") return null;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const windSpeed = Number.parseFloat(parts[1]);
  const windGust = Number.parseFloat(parts[2]);
  const windDirDeg = Number.parseFloat(parts[3]);
  if (!Number.isFinite(windSpeed) && !Number.isFinite(windGust) && !Number.isFinite(windDirDeg)) {
    return null;
  }
  return { windSpeed, windGust, windDirDeg };
}
__name(parseClientRaw, "parseClientRaw");
var index_default = {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "*";
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/wind" && url.pathname !== "/") {
      return new Response("Not Found", { status: 404, headers });
    }
    const upstreamUrl = `${UPSTREAM_URL}?nocache=${Date.now()}`;
    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "RaceTimerWind/1.0" },
        cf: { cacheTtl: 5, cacheEverything: false }
      });
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: "upstream_error" }), {
          status: 502,
          headers: {
            ...headers,
            "content-type": "application/json",
            "cache-control": "no-store"
          }
        });
      }
      const text = await upstream.text();
      const parsed = parseClientRaw(text);
      if (!parsed) {
        return new Response(JSON.stringify({ error: "parse_error" }), {
          status: 502,
          headers: {
            ...headers,
            "content-type": "application/json",
            "cache-control": "no-store"
          }
        });
      }
      const payload = {
        ...parsed,
        source: "kblvejr.dk",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      return new Response(JSON.stringify(payload), {
        headers: {
          ...headers,
          "content-type": "application/json",
          "cache-control": "no-store"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "fetch_failed" }), {
        status: 502,
        headers: {
          ...headers,
          "content-type": "application/json",
          "cache-control": "no-store"
        }
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
