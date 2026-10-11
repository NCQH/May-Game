const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(__dirname, "..");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".wasm": "application/wasm",
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = path.posix.normalize(pathname).replace(/^\/+/, "");
    let file = path.resolve(root, relative || "index.html");
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    const stream = fs.createReadStream(file);
    stream.on("open", () => {
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(file)] || "application/octet-stream" });
    });
    stream.on("error", (error) => {
      if (response.headersSent) return response.destroy(error);
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
    });
    await pipeline(stream, response);
  } catch (error) {
    if (!response.headersSent) response.writeHead(error.code === "ENOENT" ? 404 : 400);
    if (!response.destroyed) response.end(error.code === "ENOENT" ? "Not found" : "Bad request");
  }
});

server.listen(4173, "127.0.0.1");
