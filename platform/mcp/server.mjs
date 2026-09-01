// The mcp capability's own process — the gateway behind mcp.abclegacyllc.com.
//
// Everything about the DOMAIN rather than one project: the index of callable
// servers, /healthz, 410 for retired paths, and later the OAuth discovery
// documents (/.well-known/oauth-protected-resource) plus forward_auth for Caddy.
// Project paths never reach this process: Caddy routes them (var/routes/mcp.caddy)
// straight to the project's port.
//
// Reads var/registry.d — the same files the catalog is built from — with a short
// cache, so a deploy shows up here within seconds and nothing restarts.
import { createServer } from "node:http";
import { CALLABLE, projectUrl, readRealized, site as readSite } from "../../lib/registry.mjs";

const site = readSite();
const port = Number(process.env.GATEWAY_PORT ?? 8800);
const host = process.env.HOST ?? "127.0.0.1";

let cache = { at: 0, entries: [] };
function entries() {
  if (Date.now() - cache.at > 10_000) cache = { at: Date.now(), entries: readRealized().filter((e) => e.rented?.mcp) };
  return cache.entries;
}

function index() {
  return {
    name: site.name,
    description: site.tagline,
    catalog: site.labsUrl,
    source: site.repo,
    feedback: site.feedback,
    servers: entries()
      .filter((e) => CALLABLE.has(e.status))
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.tagline,
        status: e.status,
        transport: "streamable-http",
        endpoint: e.rented.mcp.endpoint,
        auth: "none",
        docs: projectUrl(site, e.id),
        source: e.repo,
      })),
  };
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(json);
}

createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/";
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method_not_allowed" });
  if (path === "/") return send(res, 200, index());
  if (path === "/healthz") return send(res, 200, { ok: true });
  // A retired project keeps its URL so an old client config gets an answer, not a mystery.
  const top = "/" + path.split("/")[1];
  const gone = entries().find((e) => e.status === "archived" && e.rented.mcp.path === top);
  if (gone) return send(res, 410, { error: "gone", id: gone.id, note: projectUrl(site, gone.id) });
  return send(res, 404, { error: "not_found", index: site.mcpUrl });
}).listen(port, host, () => {
  console.log(`mcp gateway on http://${host}:${port} — ${index().servers.length} callable server(s)`);
});
