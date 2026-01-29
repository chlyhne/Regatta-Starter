const UPSTREAM_URL = "http://kblvejr.dk/clientraw.txt";
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 15 * 1000;
const HISTORY_KEY = "wind:history";
const LATEST_KEY = "wind:latest";
const META_KEY = "wind:meta";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function pad2(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return null;
  return String(num).padStart(2, "0");
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
  let stationTime = null;
  if (parts.length > 31) {
    const hh = pad2(parts[29]);
    const mm = pad2(parts[30]);
    const ss = pad2(parts[31]);
    if (hh && mm && ss) {
      stationTime = `${hh}:${mm}:${ss}`;
    }
  }
  return { windSpeed, windGust, windDirDeg, stationTime };
}

async function fetchUpstream() {
  const upstreamUrl = `${UPSTREAM_URL}?nocache=${Date.now()}`;
  const upstream = await fetch(upstreamUrl, {
    headers: { "User-Agent": "RaceTimerWind/1.0" },
    cf: { cacheTtl: 5, cacheEverything: false },
  });
  if (!upstream.ok) {
    return { ok: false, status: upstream.status };
  }
  const text = await upstream.text();
  const parsed = parseClientRaw(text);
  if (!parsed) {
    return { ok: false, status: 502 };
  }
  const sampleHash = hashString(text);
  return {
    ok: true,
    parsed,
    sampleHash,
  };
}

function buildSample(parsed, sampleHash, timestampMs) {
  return {
    ts: timestampMs,
    windSpeed: Number.isFinite(parsed.windSpeed) ? parsed.windSpeed : null,
    windGust: Number.isFinite(parsed.windGust) ? parsed.windGust : null,
    windDirDeg: Number.isFinite(parsed.windDirDeg) ? parsed.windDirDeg : null,
    stationTime: parsed.stationTime || null,
    sampleHash,
  };
}

function trimHistory(history, cutoffMs) {
  if (!Array.isArray(history)) return [];
  return history.filter((sample) => sample && Number.isFinite(sample.ts) && sample.ts >= cutoffMs);
}

async function loadJson(env, key) {
  if (!env.WIND_KV) return null;
  return env.WIND_KV.get(key, { type: "json" });
}

async function saveJson(env, key, value) {
  if (!env.WIND_KV) return;
  await env.WIND_KV.put(key, JSON.stringify(value));
}

async function updateHistory(env) {
  const fetchedAt = Date.now();
  const upstream = await fetchUpstream();
  if (!upstream.ok) {
    return { ok: false, status: upstream.status || 502 };
  }
  const sample = buildSample(upstream.parsed, upstream.sampleHash, fetchedAt);
  const latest = await loadJson(env, LATEST_KEY);
  if (latest && latest.sampleHash === sample.sampleHash) {
    return { ok: true, stored: false, sample: latest };
  }
  const cutoff = fetchedAt - HISTORY_WINDOW_MS;
  const history = trimHistory((await loadJson(env, HISTORY_KEY)) || [], cutoff);
  history.push(sample);
  await Promise.all([
    saveJson(env, HISTORY_KEY, history),
    saveJson(env, LATEST_KEY, sample),
    saveJson(env, META_KEY, {
      lastSampleHash: sample.sampleHash,
      updatedAt: new Date(fetchedAt).toISOString(),
    }),
  ]);
  return { ok: true, stored: true, sample };
}

function buildPayload(sample, options = {}) {
  if (!sample) {
    return { error: "no_data" };
  }
  const payload = {
    windSpeed: sample.windSpeed,
    windGust: sample.windGust,
    windDirDeg: sample.windDirDeg,
    stationTime: sample.stationTime,
    sampleHash: sample.sampleHash || null,
    source: "kblvejr.dk",
    updatedAt: new Date(sample.ts).toISOString(),
  };
  if (Number.isFinite(options.ageSeconds)) {
    payload.ageSeconds = options.ageSeconds;
  }
  if (options.history) {
    payload.history = options.history.map((entry) => ({
      ts: entry.ts,
      windSpeed: entry.windSpeed,
      windGust: entry.windGust,
      windDirDeg: entry.windDirDeg,
      stationTime: entry.stationTime || null,
    }));
  }
  if (options.stale) {
    payload.stale = true;
  }
  return payload;
}

function getHistoryWindowMs(url) {
  const hoursRaw = url.searchParams.get("hours");
  if (!hoursRaw) return HISTORY_WINDOW_MS;
  const hours = Number.parseInt(hoursRaw, 10);
  if (!Number.isFinite(hours)) return HISTORY_WINDOW_MS;
  const clamped = Math.min(24, Math.max(1, hours));
  return clamped * 60 * 60 * 1000;
}

async function ensureSampler(env, ctx) {
  if (!env.WIND_SAMPLER) return;
  try {
    const id = env.WIND_SAMPLER.idFromName("wind");
    const stub = env.WIND_SAMPLER.get(id);
    const promise = stub.fetch("https://wind-sampler/start");
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(promise);
    } else {
      await promise;
    }
  } catch (err) {
    // Ignore sampler bootstrap errors to avoid blocking responses.
  }
}

class WindSampler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    await this.ensureAlarm();
    return new Response("ok");
  }

  async ensureAlarm() {
    const now = Date.now();
    const nextAlarm = await this.state.storage.get("nextAlarm");
    if (!Number.isFinite(nextAlarm) || nextAlarm <= now) {
      const nextAt = now + SAMPLE_INTERVAL_MS;
      await this.state.storage.put("nextAlarm", nextAt);
      await this.state.storage.setAlarm(nextAt);
    }
  }

  async alarm() {
    const now = Date.now();
    try {
      await updateHistory(this.env);
    } finally {
      const nextAt = now + SAMPLE_INTERVAL_MS;
      await this.state.storage.put("nextAlarm", nextAt);
      await this.state.storage.setAlarm(nextAt);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    await ensureSampler(env, ctx);
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

    const includeHistory = ["1", "true", "yes"].includes(
      (url.searchParams.get("history") || "").toLowerCase()
    );
    const forceRefresh = ["1", "true", "yes"].includes(
      (url.searchParams.get("refresh") || "").toLowerCase()
    );

    let latest = await loadJson(env, LATEST_KEY);
    let history = null;

    if (forceRefresh || !latest) {
      const updated = await updateHistory(env);
      if (updated.ok && updated.sample) {
        latest = updated.sample;
      }
    }

    if (includeHistory) {
      const windowMs = getHistoryWindowMs(url);
      const cutoff = Date.now() - windowMs;
      history = trimHistory((await loadJson(env, HISTORY_KEY)) || [], cutoff);
    }

    if (!latest) {
      try {
        const upstream = await fetchUpstream();
        if (upstream.ok) {
          const sample = buildSample(upstream.parsed, upstream.sampleHash, Date.now());
          const payload = buildPayload(sample, { history, stale: true });
          return new Response(JSON.stringify(payload), {
            headers: {
              ...headers,
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          });
        }
      } catch (err) {
        // fall through
      }
      return new Response(JSON.stringify({ error: "no_data" }), {
        status: 503,
        headers: {
          ...headers,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }

    const ageSeconds = Math.max(0, Math.round((Date.now() - latest.ts) / 1000));
    const payload = buildPayload(latest, { history, ageSeconds });

    return new Response(JSON.stringify(payload), {
      headers: {
        ...headers,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  },

  async scheduled(event, env, ctx) {
    if (!env.WIND_KV) return;
    ctx.waitUntil(updateHistory(env));
    ctx.waitUntil(ensureSampler(env, ctx));
  },
};

export { WindSampler };
