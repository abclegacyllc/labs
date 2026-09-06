import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeHttpUrl, readPlatform, validateManifest } from "../lib/registry.mjs";
import { clientOf, createLimiter } from "../platform/mcp/limits.mjs";
import { latestSection, renderMarkdown } from "../lib/markdown.mjs";

const base = (surface = { app: { url: "https://example.com/app" } }) => ({
  labs: 1,
  export: { id: "demo", name: "Demo", tagline: "A demo", status: "alpha", started: "2025-01-01", kind: "service", category: "api", surfaces: surface }
});

test("external surface URLs must be HTTPS", () => {
  const errors = validateManifest(base({ app: { url: "javascript:alert(1)" } }), null, readPlatform());
  assert.ok(errors.some((e) => e.includes("must use https")));
  assert.equal(validateManifest(base(), null, readPlatform()).length, 0);
});

test("upstreams reject controls, invalid schemes, and private hosts", () => {
  const withUpstream = (upstream) => ({ ...base({ mcp: {} }), export: { ...base({ mcp: {} }).export, uses: { mcp: { upstream } } } });
  const dirty = "https://example.com" + String.fromCharCode(10) + "#bad";
  assert.ok(validateManifest(withUpstream(dirty), null, readPlatform()).some((e) => e.includes("control characters")));
  assert.ok(validateManifest(withUpstream("http://example.com"), null, readPlatform()).some((e) => e.includes("must use https")));
  assert.ok(validateManifest(withUpstream("https://127.0.0.1:2019"), null, readPlatform()).some((e) => e.includes("private or loopback")));
});

test("URLs are normalized before they reach the gateway", () => {
  assert.equal(normalizeHttpUrl("https://example.com"), "https://example.com/");
});

test("failed import preserves the existing vendored tree", () => {
  const root = mkdtempSync(join(tmpdir(), "labs-test-"));
  const repo = join(root, "source");
  const dest = join(root, "abc-labs", "demo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(repo, "present.txt"), "new\\n");
  writeFileSync(join(dest, "old.txt"), "old\\n");
  execFileSync("git", ["-C", repo, "init", "--quiet"]);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Labs Test", "-c", "user.email=labs@example.test", "commit", "--quiet", "-m", "fixture"]);
  const index = join(root, "index.json");
  writeFileSync(index, JSON.stringify({ projects: [{ id: "demo", repo, status: "alpha", install: { include: ["does-not-exist"] } }] }));
  const result = spawnSync(process.execPath, [join(process.cwd(), "bin/labs.mjs"), "import", "demo", "--index=" + index], { cwd: root, encoding: "utf8" });
  try {
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(dest, "old.txt"), "utf8"), "old\\n");
    assert.deepEqual(readdirSync(join(root, "abc-labs")).filter((name) => name.includes("staging")), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the caller identity is the hop Caddy saw, not the one the caller sent", () => {
  const req = (xff, remote = "10.0.0.9") => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } });
  // Caddy appends; a client that forges a header only adds an entry in front of its own.
  assert.equal(clientOf(req("1.2.3.4, 203.0.113.7")), "203.0.113.7");
  assert.equal(clientOf(req("203.0.113.7")), "203.0.113.7");
  assert.equal(clientOf(req(undefined)), "10.0.0.9");
});

test("limits hold per caller and per project, and refill over time", () => {
  let now = 0;
  const limiter = createLimiter({ now: () => now });
  const entry = { id: "demo", tier: "default" }; // 60/min per caller, burst 20

  const seats = [];
  for (let i = 0; i < 20; i++) {
    const s = limiter.admit(entry, "a");
    assert.ok(s.ok, `request ${i} should pass`);
    s.release(); // release concurrency so only the rate is under test
    seats.push(s);
  }
  const denied = limiter.admit(entry, "a");
  assert.equal(denied.ok, false);
  assert.equal(denied.scope, "client");
  assert.ok(denied.retryAfter >= 1);

  // A different caller is unaffected: the buckets are per identity.
  assert.ok(limiter.admit(entry, "b").ok);

  // One minute later the caller's bucket is full again.
  now += 60_000;
  assert.ok(limiter.admit(entry, "a").ok);
  limiter.stop();
});

test("concurrency is bounded per caller, and released seats come back", () => {
  const limiter = createLimiter({ now: () => 0 });
  const entry = { id: "demo", tier: "default" }; // 4 concurrent per caller
  const held = [];
  for (let i = 0; i < 4; i++) { const s = limiter.admit(entry, "a"); assert.ok(s.ok); held.push(s); }
  const blocked = limiter.admit(entry, "a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "too many requests in flight");
  held.pop().release();
  assert.ok(limiter.admit(entry, "a").ok, "a released seat is usable again");
  limiter.stop();
});

test("an internal tier is not limited at all", () => {
  const limiter = createLimiter({ now: () => 0 });
  const entry = { id: "labs", tier: "internal" };
  for (let i = 0; i < 500; i++) assert.ok(limiter.admit(entry, "a").ok);
  limiter.stop();
});

test("a project's README can describe an attack but not perform one", () => {
  const html = renderMarkdown("Hi <script>alert(1)</script> and <img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.b/c) `<b>`");
  assert.ok(!html.includes("<script"), "script tags are escaped");
  assert.ok(!html.includes("<img"), "no images at all");
  assert.ok(!html.includes('href="javascript'), "non-http links are not links");
  assert.ok(html.includes('<a href="https://a.b/c" rel="noopener">ok</a>'), "https links survive");
  assert.ok(html.includes("<code>&lt;b&gt;</code>"), "code spans are escaped");
});

test("the changelog's newest section is found under a document title", () => {
  const md = "# Changelog\n\nAll notable changes.\n\n## 3.8.173 — 2026-09-04\n- fixed x\n\n## 3.8.172\n- old";
  const l = latestSection(md);
  assert.equal(l.title, "3.8.173 — 2026-09-04");
  assert.equal(l.body, "- fixed x");
  assert.equal(latestSection("no headings"), null);
});

test("version and requires are checked for shape", () => {
  const ex = (extra) => ({ labs: 1, export: { id: "demo", name: "D", tagline: "t", kind: "service", category: "tool", surfaces: { cli: { command: "x" } }, status: "alpha", started: "2026-01-01", ...extra } });
  assert.equal(validateManifest(ex({ version: "3.8.173", requires: ["Tampermonkey"] }), null, readPlatform()).length, 0);
  assert.equal(validateManifest(ex({ version: "v1.2.3-beta.1" }), null, readPlatform()).length, 0);
  assert.ok(validateManifest(ex({ version: "latest" }), null, readPlatform()).some((e) => e.includes("version")));
  assert.ok(validateManifest(ex({ requires: "Tampermonkey" }), null, readPlatform()).some((e) => e.includes("requires")));
  assert.ok(validateManifest(ex({ requires: Array(9).fill("x") }), null, readPlatform()).some((e) => e.includes("requires")));
});
