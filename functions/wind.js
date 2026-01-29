const WORKER_DEFAULT = "https://racetimer-wind.hummesse.workers.dev/wind";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function buildUpstreamUrl(requestUrl, workerBase) {
  const upstream = new URL(workerBase);
  const incoming = new URL(requestUrl);
  incoming.searchParams.forEach((value, key) => {
    upstream.searchParams.set(key, value);
  });
  return upstream.toString();
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

  const workerBase = context.env.WIND_WORKER_URL || WORKER_DEFAULT;
  const upstreamUrl = buildUpstreamUrl(context.request.url, workerBase);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { "User-Agent": "RaceTimerWindProxy/1.0" },
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

    const body = await upstream.text();
    return new Response(body, {
      headers: {
        ...headers,
        "content-type": upstream.headers.get("content-type") || "application/json",
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
