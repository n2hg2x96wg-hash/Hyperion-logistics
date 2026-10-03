// Local development server: serves the static site and mounts the /api handlers (mirrors Vercel routing).
// Usage: STORE=memory ADMIN_PASSWORD=... node dev-server.js     (npm run dev)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".zip": "application/zip" };
const BLOCK = /^\/(test|node_modules|\.git)(\/|$)|^\/(dev-server\.js|package(-lock)?\.json|firestore\.rules)$/;

export function createServer({ seed = false } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const file = path.join(root, url.pathname.replace(/\/$/, "") + ".js");
        if (!file.startsWith(path.join(root, "api")) || path.basename(path.dirname(file)).startsWith("_") || path.basename(file).startsWith("_") || !fs.existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
        const mod = await import(pathToFileURL(file).href);
        return await mod.default(req, res);
      }
      if (BLOCK.test(url.pathname)) { res.statusCode = 404; return res.end("Not found"); }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    } catch (err) { console.error(err); res.statusCode = 500; res.end("error"); }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.STORE = process.env.STORE || "memory";
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "dev-password";
  const port = Number(process.env.PORT) || 3000;
  if (process.env.STORE === "memory") {
    const { __seedDemo } = await import("./test/seed.js");
    await __seedDemo();
  }
  createServer().listen(port, () => console.log(`Hyperion dev server: http://localhost:${port}  (store=${process.env.STORE}, admin password from ADMIN_PASSWORD)`));
}
