function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Content-Encoding, X-Device-Id, X-Session-Id, X-Chunk-Id, X-Chunk-Index, X-Chunk-Kind, X-Chunk-Bytes, X-Chunk-First-Ts, X-Chunk-Last-Ts",
    "Access-Control-Max-Age": "86400",
  };
}

function sanitizeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9-_]/g, "_") || "unknown";
}

async function loadManifest(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return await object.json();
  } catch (err) {
    console.warn("Manifest parse failed", err);
    return null;
  }
}

async function saveManifest(bucket, key, manifest) {
  await bucket.put(key, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (env.UPLOAD_TOKEN && token !== env.UPLOAD_TOKEN) {
      return new Response("Unauthorized", { status: 401, headers });
    }

    const deviceIdHeader = request.headers.get("X-Device-Id") || "unknown";
    const sessionIdHeader = request.headers.get("X-Session-Id") || "";
    const chunkIdHeader = request.headers.get("X-Chunk-Id") || "";
    const contentEncoding = request.headers.get("Content-Encoding") || "";
    const hasGzip = contentEncoding.toLowerCase().includes("gzip");
    const deviceId = sanitizeId(deviceIdHeader);
    const sessionId = sanitizeId(sessionIdHeader);
    const chunkId = sanitizeId(chunkIdHeader);
    const nowIso = new Date().toISOString();

    if (sessionIdHeader && chunkIdHeader) {
      const chunkIndexRaw = request.headers.get("X-Chunk-Index") || "0";
      const chunkIndex = Number.parseInt(chunkIndexRaw, 10);
      const chunkKind =
        (request.headers.get("X-Chunk-Kind") || "data").toLowerCase();
      const chunkBytes = Number.parseInt(
        request.headers.get("X-Chunk-Bytes") || "0",
        10
      );
      const firstTs = Number.parseInt(
        request.headers.get("X-Chunk-First-Ts") || "0",
        10
      );
      const lastTs = Number.parseInt(
        request.headers.get("X-Chunk-Last-Ts") || "0",
        10
      );
      const paddedIndex = String(Number.isFinite(chunkIndex) ? chunkIndex : 0).padStart(
        6,
        "0"
      );
      const suffix = hasGzip ? ".ndjson.gz" : ".ndjson";
      const chunkKey = `${deviceId}/${sessionId}/chunks/${paddedIndex}-${chunkId}-${chunkKind}${suffix}`;

      await env.DIAG_BUCKET.put(chunkKey, request.body, {
        httpMetadata: {
          contentType:
            request.headers.get("Content-Type") || "application/x-ndjson",
          ...(contentEncoding ? { contentEncoding } : {}),
        },
      });

      const manifestKey = `${deviceId}/${sessionId}/manifest.json`;
      const manifest = (await loadManifest(env.DIAG_BUCKET, manifestKey)) || {
        deviceId,
        sessionId,
        createdAt: nowIso,
        chunks: [],
      };
      if (!Array.isArray(manifest.chunks)) {
        manifest.chunks = [];
      }
      const exists = manifest.chunks.some((entry) => entry.id === chunkId);
      if (!exists) {
        manifest.chunks.push({
          id: chunkId,
          index: Number.isFinite(chunkIndex) ? chunkIndex : 0,
          kind: chunkKind,
          bytes: Number.isFinite(chunkBytes) ? chunkBytes : 0,
          firstTs: Number.isFinite(firstTs) && firstTs > 0 ? firstTs : null,
          lastTs: Number.isFinite(lastTs) && lastTs > 0 ? lastTs : null,
          key: chunkKey,
          receivedAt: nowIso,
        });
        manifest.chunks.sort((a, b) => (a.index || 0) - (b.index || 0));
      }
      manifest.updatedAt = nowIso;
      if (chunkKind === "final") {
        manifest.completedAt = nowIso;
      }
      await saveManifest(env.DIAG_BUCKET, manifestKey, manifest);

      return new Response("OK", { status: 200, headers });
    }

    const now = nowIso.replace(/[:.]/g, "-");
    const key = `${deviceId}/${now}.ndjson${hasGzip ? ".gz" : ""}`;

    await env.DIAG_BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType:
          request.headers.get("Content-Type") || "application/x-ndjson",
        ...(contentEncoding ? { contentEncoding } : {}),
      },
    });

    return new Response("OK", { status: 200, headers });
  },
};
