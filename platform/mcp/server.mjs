// The mcp capability's process: everything on mcp.abclegacyllc.com goes through
// here. Caddy terminates TLS and hands the whole host to this one port.
//
//   /                       the public index of callable servers
//   /healthz                is the gateway itself alive
//   /<id>...                a project — rate limited, then proxied to it
//   /<id>... (archived)     410 Gone, pointing at the project's page
//   anything else           404 with the index address
//
// Being in the path is deliberate. It is the only place that can hold a limit
// per project AND per caller, and later the only place that has to understand
// OAuth — a project implements neither. The cost is honest: if this process is
// down, every MCP endpoint is down, which is why it stays small, keeps no state
// worth losing, and is restarted by systemd.
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { CALLABLE, projectUrl, readRealized, site as readSite, tierOf } from "../../lib/registry.mjs";
import { clientOf, createLimiter } from "./limits.mjs";

const site = readSite();
const port = Number(process.env.GATEWAY_PORT ?? 8800);
const host = process.env.HOST ?? "127.0.0.1";
const limiter = createLimiter();

// var/registry.d is re-read on a short cycle, so a deploy or a sync shows up
// here within seconds and nothing has to restart.
let cache = { at: 0, entries: [] };
function entries() {
  if (Date.now() - cache.at > 10_000) cache = { at: Date.now(), entries: readRealized().filter((e) => e.rented?.mcp) };
  return cache.entries;
}
const bySegment = (path) => {
  const top = "/" + path.split("/")[1];
  return entries().find((e) => e.rented.mcp.path === top);
};

function index() {
  return {
    name: site.name,
    description: site.tagline,
    catalog: site.labsUrl,
    source: site.repo,
    feedback: site.feedback,
    servers: entries().filter((e) => CALLABLE.has(e.status)).map((e) => ({
      id: e.id,
      name: e.name,
      description: e.tagline,
      status: e.status,
      transport: "streamable-http",
      endpoint: e.rented.mcp.endpoint,
      auth: "none",
      limits: tierOf(e).unlimited ? null : { requestsPerMinute: tierOf(e).client.rpm, concurrent: tierOf(e).concurrent.client },
      docs: projectUrl(site, e.id),
      source: e.repo,
    })),
  };
}

function send(res, status, body, extra = {}) {
  const json = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(json);
}

// Hop-by-hop headers belong to one connection and must not be forwarded (RFC 9110).
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function proxy(req, res, target, client, done) {
  let url;
  try { url = new URL(target); } catch { return done(), send(res, 502, { error: "bad_upstream" }); }
  const secure = url.protocol === "https:";
  const headers = { ...req.headers };
  for (const h of Object.keys(headers)) if (HOP.has(h.toLowerCase())) delete headers[h];
  // The project sees who is calling and through what — one hop, appended, never
  // trusted from the caller (see clientOf).
  headers["x-forwarded-for"] = client;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers.host = url.host;

  const call = secure ? httpsRequest : httpRequest;
  const upstream = call({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (secure ? 443 : 80),
    method: req.method,
    path: req.url,
    headers,
  });

  let settled = false;
  const fail = (status, error) => {
    if (settled) return; settled = true; done();
    if (!res.headersSent) send(res, status, { error });
    else res.destroy();
  };
  // No timeout on the response: MCP streams over Server-Sent Events and a live
  // stream is silent for as long as the tool takes. The connect attempt is
  // bounded instead, and a dead peer is caught by the socket erroring.
  upstream.setTimeout(10_000, () => { if (!res.headersSent) fail(504, "upstream_timeout"); });
  upstream.on("socket", (s) => s.once("connect", () => upstream.setTimeout(0)));
  upstream.on("error", () => fail(502, "upstream_unreachable"));

  upstream.on("response", (up) => {
    const out = { ...up.headers };
    for (const h of Object.keys(out)) if (HOP.has(h.toLowerCase())) delete out[h];
    res.writeHead(up.statusCode ?? 502, out);
    // Nothing between the two sockets buffers, so an SSE frame written by the
    // project reaches the client as it is written.
    res.flushHeaders?.();
    up.pipe(res);
    up.on("error", () => fail(502, "upstream_error"));
    res.on("close", () => { if (!settled) { settled = true; done(); } up.destroy(); });
  });

  req.pipe(upstream);
  req.on("aborted", () => upstream.destroy());
}

createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/";
  const client = clientOf(req);

  if (path === "/healthz") return send(res, 200, { ok: true });
  if (path === "/") {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method_not_allowed" });
    return send(res, 200, index());
  }

  const entry = bySegment(path);
  if (!entry) return send(res, 404, { error: "not_found", index: site.mcpUrl });
  // A retired project keeps its URL so an old client config gets an answer.
  if (entry.status === "archived") return send(res, 410, { error: "gone", id: entry.id, note: projectUrl(site, entry.id) });

  const target = entry.rented.mcp.upstream ?? (entry.assigned?.port ? `http://127.0.0.1:${entry.assigned.port}` : null);
  if (!target) return send(res, 503, { error: "not_deployed", id: entry.id, note: projectUrl(site, entry.id) });

  const seat = limiter.admit(entry, client);
  if (!seat.ok) {
    return send(res, 429, { error: "rate_limited", scope: seat.scope, reason: seat.reason, id: entry.id, retryAfter: seat.retryAfter, note: projectUrl(site, entry.id) },
      { "retry-after": String(seat.retryAfter), "ratelimit-limit": String(seat.limit), "ratelimit-remaining": "0", "ratelimit-reset": String(seat.retryAfter) });
  }
  if (!seat.unlimited) {
    res.setHeader("RateLimit-Limit", String(seat.limit));
    res.setHeader("RateLimit-Remaining", String(seat.remaining));
  }
  proxy(req, res, target, client, seat.release);
}).listen(port, host, () => {
  console.log(`mcp gateway on http://${host}:${port} — ${index().servers.length} callable, ${entries().length} routed`);
});
