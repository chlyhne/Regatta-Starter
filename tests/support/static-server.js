const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const rootDir = path.resolve(__dirname, "..", "..");
const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function resolvePath(requestPath) {
  const cleaned = requestPath.replace(/^\/+/, "");
  return path.join(rootDir, cleaned);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }

  const parsed = url.parse(req.url || "/");
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname || "/";
  const filePath = resolvePath(decodeURIComponent(pathname));

  if (!filePath.startsWith(rootPrefix)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      res.statusCode = 500;
      res.end("Server Error");
    });
    stream.pipe(res);
  });
});

server.listen(port, host, () => {
  process.stdout.write(`Static server running at ${host}:${port}\n`);
});
