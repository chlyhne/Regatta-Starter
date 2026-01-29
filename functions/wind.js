const UPSTREAM_URL = "http://kblvejr.dk/clientraw.txt";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

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

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin") || "*";
  const headers = corsHeaders(origin);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  try {
    const upstream = await fetch(`${UPSTREAM_URL}?nocache=${Date.now()}`, {
      headers: { "User-Agent": "RaceTimerWind/1.0" },
      cf: { cacheTtl: 5, cacheEverything: false },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "upstream_error" }), {
        status: 502,
        headers: {
          ...headers,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
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
          "cache-control": "no-store",
        },
      });
    }

    const payload = {
      ...parsed,
      source: "kblvejr.dk",
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        ...headers,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed" }), {
      status: 502,
      headers: {
        ...headers,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }
}
