function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Content-Encoding, X-Device-Id",
    "Access-Control-Max-Age": "86400",
  };
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

    const deviceId = request.headers.get("X-Device-Id") || "unknown";
    const now = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${deviceId}/${now}.ndjson.gz`;

    await env.DIAG_BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType:
          request.headers.get("Content-Type") || "application/x-ndjson",
        contentEncoding: request.headers.get("Content-Encoding") || "gzip",
      },
    });

    return new Response("OK", { status: 200, headers });
  },
};
