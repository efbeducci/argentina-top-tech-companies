// Local dev server: mimics vercel.json rewrites without needing the Vercel CLI.
// Usage: npm run dev  (PORT env var optional, default 3000)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 3000;

const handlers = {
  data: (await import("../api/data.js")).default,
  company: (await import("../api/company.js")).default,
  mcp: (await import("../api/mcp.js")).default,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Route table mirroring vercel.json rewrites.
function route(pathname, query) {
  if (pathname === "/mcp" || pathname === "/api/mcp") return ["mcp", query];
  if (pathname === "/api/v1/data.json" || pathname === "/api/data") return ["data", query];
  const m = pathname.match(/^\/api\/v1\/companies\/(.+)\.json$/);
  if (m) return ["company", { ...query, name: decodeURIComponent(m[1]) }];
  if (pathname === "/api/company") return ["company", query];
  return null;
}

// Add the Vercel-style helpers the handlers use.
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => { res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); return res; };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function serveStatic(pathname, res) {
  const file = pathname === "/" ? "/web/index.html" : pathname;
  const full = normalize(join(ROOT, file));
  if (!full.startsWith(join(ROOT, "web")) && !full.startsWith(join(ROOT, "data"))) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const body = await readFile(full);
    res.setHeader("Content-Type", MIME[extname(full)] ?? "application/octet-stream");
    res.status(200).send(body);
  } catch {
    res.status(404).send("Not found");
  }
}

createServer(async (req, res) => {
  decorate(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  const match = route(url.pathname, query);
  try {
    if (match) {
      const [name, q] = match;
      req.query = q;
      if (req.method === "POST") req.body = await readBody(req);
      await handlers[name](req, res);
    } else {
      await serveStatic(url.pathname, res);
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
  console.log(`${req.method} ${url.pathname} -> ${res.statusCode}`);
}).listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`);
  console.log(`MCP:        http://localhost:${PORT}/mcp`);
});
