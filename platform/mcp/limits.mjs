// Two token buckets and two counters per request, and the identity they are
// keyed by. Kept separate from the server so it can be tested without a socket.
//
// The buckets are in memory: one gateway process, one machine. If Labs ever runs
// two gateways, this becomes a shared store — the interface does not change.
import { MCP_TIERS, tierOf } from "../../lib/registry.mjs";

// Who is calling. Caddy APPENDS the real address to any X-Forwarded-For the
// caller sent, so the LAST entry is the one Caddy saw and the only one a client
// cannot forge. Taking the first would let anyone reset their own bucket.
export function clientOf(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function createLimiter({ now = () => Date.now(), sweepEvery = 300_000 } = {}) {
  const buckets = new Map(); // key → { tokens, last }
  const live = new Map();    // key → in-flight count

  const take = (key, { rpm, burst }, t) => {
    const b = buckets.get(key) ?? { tokens: burst, last: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.last) / 60_000) * rpm);
    b.last = t;
    buckets.set(key, b);
    if (b.tokens < 1) return { ok: false, retryAfter: Math.max(1, Math.ceil(((1 - b.tokens) / rpm) * 60)) };
    b.tokens -= 1;
    return { ok: true, remaining: Math.floor(b.tokens) };
  };
  const bump = (key, max, delta) => {
    const n = (live.get(key) ?? 0) + delta;
    if (n <= 0) live.delete(key); else live.set(key, n);
    return delta > 0 && n > max;
  };

  // A bucket that has been full for a while is indistinguishable from a new one.
  const timer = setInterval(() => {
    const t = now();
    for (const [key, b] of buckets) if (t - b.last > sweepEvery && !live.has(key)) buckets.delete(key);
  }, sweepEvery);
  timer.unref?.();

  return {
    // Returns { ok, release } or { ok: false, scope, reason, retryAfter, limit }.
    admit(entry, client) {
      const tier = tierOf(entry);
      if (tier.unlimited) return { ok: true, release() {}, unlimited: true };
      const t = now();
      const pKey = `p:${entry.id}`, cKey = `c:${entry.id}|${client}`;

      if (bump(pKey, tier.concurrent.project, +1)) { bump(pKey, 0, -1); return { ok: false, scope: "project", reason: "too many requests in flight", retryAfter: 1, limit: tier.project.rpm }; }
      if (bump(cKey, tier.concurrent.client, +1)) { bump(cKey, 0, -1); bump(pKey, 0, -1); return { ok: false, scope: "client", reason: "too many requests in flight", retryAfter: 1, limit: tier.client.rpm }; }

      const release = () => { bump(pKey, 0, -1); bump(cKey, 0, -1); };
      const p = take(pKey, tier.project, t);
      if (!p.ok) { release(); return { ok: false, scope: "project", reason: "rate limit", retryAfter: p.retryAfter, limit: tier.project.rpm }; }
      const c = take(cKey, tier.client, t);
      if (!c.ok) { release(); return { ok: false, scope: "client", reason: "rate limit", retryAfter: c.retryAfter, limit: tier.client.rpm }; }

      return { ok: true, release, limit: tier.client.rpm, remaining: c.remaining };
    },
    stop() { clearInterval(timer); },
    get size() { return buckets.size; },
  };
}

export { MCP_TIERS };
