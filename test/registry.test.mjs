import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeHttpUrl, readPlatform, validateManifest } from "../lib/registry.mjs";
import routes from "../platform/mcp/routes.mjs";

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

test("URLs are normalized before they reach generated Caddy config", () => {
  // A loopback upstream would turn a public path into a door to Caddy's own admin API.
  assert.throws(() => routes([{ id: "demo", status: "alpha", rented: { mcp: { path: "/demo", upstream: "https://127.0.0.1:2019" } } }]));
  assert.equal(normalizeHttpUrl("https://example.com"), "https://example.com/");
  const dirty = "https://example.com" + String.fromCharCode(10) + "#bad";
  assert.throws(() => routes([{ id: "demo", status: "alpha", rented: { mcp: { path: "/demo", upstream: dirty } } }]));
  const config = routes([{ id: "demo", status: "alpha", rented: { mcp: { path: "/demo", upstream: "https://example.com" } } }]);
  // The origin, not the normalized URL: Caddy refuses an upstream with a path, and "/" is one.
  assert.ok(config.includes("reverse_proxy https://example.com {"));
  assert.ok(!config.includes("https://example.com/"));
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
