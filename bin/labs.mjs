#!/usr/bin/env node
// The Labs CLI. Two families of verbs.
//
// Platform verbs — run in the Labs checkout, on the Labs server:
//   labs sync [id]                 every allowlisted repo's abc-labs/labs.json → var/projects/<id>/, then render
//   labs deploy <id> [--dry-run]   clone/pull a project renting host or web, provision what it rents, start it
//   labs remove <id>               stop it, and delete var/projects/<id>/ — everything Labs held about it
//   labs render [--no-reload]      var/projects/*/ → routes/*.caddy + site/dist (catalog, pages, index.json), caddy reload
//   labs list                      what is listed, where it runs, what it rents
//
// Repository verbs — run in ANY repository (yours, a stranger's), from its root:
//   labs export [path]             validate this repo's abc-labs/labs.json — what Labs will see
//   labs import <id> [ref]         take a Labs project: copy its files into abc-labs/<id>/, pin it in labs.lock.json
//   labs update [id]               re-import at the pinned ref; report old → new commit
//   (`install` is an alias of `import`, `validate` of `export`)
//
// Zero dependencies. `fetch`, `spawnSync` and the filesystem are all it needs.
// Runnable from the repository itself: npx github:abclegacyllc/labs import <id>
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  DEFAULT_TIER, DIRS, LABS_DIR, LOCK_PATH, MANIFEST_PATH, MCP_TIERS, ROOT, VAR, ensureDirs, hosted, hostOf, kindOf, npxCommand, overdue,
  projectDir, projectEnv, projectRepo, projectUnit, projectUnitFile, readAllowlist, readJSON, readPlatform, readRealized, removeProjectDir,
  removeRealized, site, validateManifest, writeJSON, writeRealized,
} from "../lib/registry.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--") && !a.includes("=")));
const opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const args = rest.filter((a) => !a.startsWith("--"));
const dry = flags.has("--dry-run");
const noReload = flags.has("--no-reload");
const CWD = process.cwd();

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`labs: ${msg}`); process.exit(1); };
const usage = () => readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");

function sh(bin, argv, opts = {}) {
  const r = spawnSync(bin, argv, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts });
  if (r.error) fail(`${bin}: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) fail(`${bin} ${argv.join(" ")} exited ${r.status}${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
  return r;
}

// ───────────────────────── platform ─────────────────────────

function allowlisted(id) {
  const p = readAllowlist().projects.find((p) => p.id === id);
  if (!p) fail(`"${id}" is not in registry.json — Labs decides who is in; add it there first`);
  checkTier(p);
  return p;
}
// What a project may consume lives in Labs's own file, because a manifest lives
// in a repository Labs does not control. A typo here must not silently pass.
function checkTier(p) {
  if (p.mcp?.tier !== undefined && !MCP_TIERS[p.mcp.tier]) {
    fail(`registry.json: "${p.id}" asks for mcp tier "${p.mcp.tier}" — Labs offers: ${Object.keys(MCP_TIERS).join(", ")}`);
  }
}

function rawManifestUrl(repo) {
  const m = repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/${MANIFEST_PATH}` : null;
}

// A hosted project's manifest is read from its checkout; a listed-only project's from
// GitHub; a repo given as a local path (tests, a mirror) straight from disk.
async function fetchManifest(p) {
  for (const local of [join(projectRepo(p.id), MANIFEST_PATH), join(p.repo, MANIFEST_PATH)]) {
    if (existsSync(local)) return { manifest: readJSON(local), source: local };
  }
  const url = rawManifestUrl(p.repo);
  if (!url) return { error: `cannot derive a raw URL from ${p.repo}` };
  let res;
  try { res = await fetch(url, { headers: { "user-agent": "abc-legacy-labs" } }); }
  catch (e) { return { error: `${url}: ${e.message}` }; }
  if (!res.ok) return { error: `${url} → ${res.status}` };
  try { return { manifest: await res.json(), source: url }; }
  catch { return { error: `${url}: not valid JSON` }; }
}

// export ⊕ what only Labs knows: the repo it was allowlisted under, what was assigned, when.
function realize(p, ex, previous) {
  return {
    ...ex,
    id: p.id,
    repo: p.repo,
    tier: p.mcp?.tier ?? DEFAULT_TIER,
    assigned: previous?.assigned ?? {},
    rented: previous?.rented ?? {},
    commit: previous?.commit,
    deployedAt: previous?.deployedAt,
    syncedAt: new Date().toISOString(),
  };
}

async function sync(only) {
  ensureDirs();
  const platform = readPlatform();
  const realized = readRealized();
  const prev = new Map(realized.map((e) => [e.id, e]));
  const allowlist = readAllowlist();
  if (!only) {
    const allowed = new Set(allowlist.projects.map((p) => p.id));
    for (const old of realized) {
      if (!allowed.has(old.id)) {
        // Out of the allowlist is Labs's decision, so its process stops now; the
        // folder stays until `labs remove` so nothing is deleted by a timer.
        stopUnit(old.id);
        removeRealized(old.id);
        log(`  unlist ${old.id} — no longer in registry.json; its process is stopped. \`labs remove ${old.id}\` deletes var/projects/${old.id}/`);
      }
    }
  }
  let ok = 0, skipped = 0;
  for (const p of readAllowlist().projects) {
    if (only && p.id !== only) continue;
    checkTier(p);
    const r = await fetchManifest(p);
    if (r.error) { log(`  skip ${p.id} — no ${MANIFEST_PATH} yet (${r.error})`); skipped++; continue; }
    const errors = validateManifest(r.manifest, p.id, platform);
    if (errors.length) {
      removeRealized(p.id);
      log(`  unlist ${p.id} — invalid labs.json (relisted by the next sync that finds it valid):\n    ${errors.join("\n    ")}`);
      skipped++;
      continue;
    }
    if (!r.manifest.export) {
      removeRealized(p.id);
      log(`  unlist ${p.id} — labs.json has no "export": it takes from Labs but is not a Labs project`);
      skipped++;
      continue;
    }
    const entry = realize(p, r.manifest.export, prev.get(p.id));
    // A project served elsewhere still needs its route: provision mcp on sync when it
    // names an upstream — deploy never runs for it, there is nothing to run here.
    const up = r.manifest.export.uses?.mcp?.upstream;
    if (up && !hosted(r.manifest.export)) {
      const { default: provision } = await import(join(platform.find((s) => s.id === "mcp").dir, "provision.mjs"));
      entry.rented.mcp = (await provision({ id: p.id, manifest: r.manifest.export, options: r.manifest.export.uses.mcp, entry, all: [], site: site(), dry: false })).rented;
    }
    writeRealized(entry);
    log(`  ok   ${p.id} ← ${r.source}`);
    ok++;
  }
  log(`sync: ${ok} listed, ${skipped} skipped`);
  await render();
}

async function deploy(id) {
  if (!id) fail("usage: labs deploy <id> [--dry-run]");
  const p = allowlisted(id);
  ensureDirs();
  const dir = projectRepo(id);
  mkdirSync(projectDir(id), { recursive: true });
  if (existsSync(join(dir, ".git"))) { log(`pull ${id}`); sh("git", ["-C", dir, "pull", "--ff-only"]); }
  else { log(`clone ${id} ← ${p.repo}`); sh("git", ["clone", p.repo, dir]); }
  const commit = sh("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { quiet: true }).stdout.trim();

  const manifestPath = join(dir, MANIFEST_PATH);
  if (!existsSync(manifestPath)) fail(`${id}: no ${MANIFEST_PATH} in the repository — see CONTRACT.md`);
  const manifest = readJSON(manifestPath);
  const platform = readPlatform();
  const errors = validateManifest(manifest, id, platform);
  if (errors.length) fail(`${id}: invalid labs.json:\n  ${errors.join("\n  ")}`);
  const ex = manifest.export;
  if (!ex) fail(`${id}: labs.json has no "export" — nothing to deploy`);
  // Two reasons to have a checkout on this machine: a process to run, or files
  // to serve. A project with neither is listed, not deployed.
  const runs = hosted(ex);
  if (!runs && !ex.uses?.web?.dist) fail(`${id}: rents neither "host" nor "web" with a "dist" — this project is listed, not run here; \`labs sync\` is all it needs`);

  const all = readRealized();
  const entry = realize(p, ex, all.find((e) => e.id === id));
  entry.commit = commit;
  entry.assigned.dir = dir;

  // What every project gets, then what each rented capability adds. `host` goes
  // first because it assigns the port other capabilities (mcp) describe.
  const env = { LABS_ID: id, NODE_ENV: "production" };
  entry.rented = {};
  const uses = Object.entries(ex.uses ?? {}).sort(([a], [b]) => (a === "host" ? -1 : b === "host" ? 1 : 0));
  for (const [svcId, options] of uses) {
    const svc = platform.find((s) => s.id === svcId);
    const mod = join(svc.dir, "provision.mjs");
    if (!existsSync(mod)) { entry.rented[svcId] = { options: options ?? {} }; log(`  ${svcId}: listed, nothing to provision`); continue; }
    const { default: provision } = await import(mod);
    const out = await provision({ id, manifest: ex, options: options ?? {}, entry, all, site: site(), dry });
    Object.assign(env, out.env ?? {});
    entry.rented[svcId] = out.rented ?? {};
    log(`  ${svcId}: ${out.summary ?? "provisioned"}`);
  }

  const { install, start } = ex.uses.host ?? {};
  if (install) {
    log(`install: ${install}`);
    if (!dry) sh("sh", ["-c", install], { cwd: dir });
  }

  if (!runs) {
    // Nothing to start: Caddy serves the files straight from the checkout.
    entry.deployedAt = new Date().toISOString();
    writeRealized(entry);
    log(`deploy: ${id} @ ${commit} — static, no process${dry ? " (dry-run)" : ""}`);
    return render();
  }

  // The env file is written by Labs, KEY=value only, so systemd's EnvironmentFile
  // reads it exactly as written. Mode 600: a service may put a token in here.
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || /[\s'"#\\]/.test(v)) fail(`env ${k}: a value systemd would misread — capabilities must hand out plain tokens`);
  }
  const envFile = projectEnv(id);
  writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(envFile, 0o600);
  entry.assigned.envFile = envFile;

  // The unit file lives in the project's folder; systemd sees it through a
  // symlink in its own directory. Delete the folder and nothing is orphaned.
  const unitName = projectUnit(id);
  const unitFile = projectUnitFile(id);
  const vars = { id, repo: p.repo, dir, envfile: envFile, start: start.replace(/'/g, "'\\''") };
  const unit = readFileSync(join(ROOT, "infra", "systemd", "project.service.tmpl"), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? fail(`project.service.tmpl: unknown {{${k}}}`));
  entry.assigned.unit = unitName;
  if (dry) {
    log(`dry-run: would write ${unitFile}, link it into ${UNIT_DIR} and restart it:\n${unit.replace(/^/gm, "    ")}`);
  } else {
    writeFileSync(unitFile, unit);
    mkdirSync(UNIT_DIR, { recursive: true });
    const link = join(UNIT_DIR, unitName);
    if (lexists(link)) unlinkSync(link);
    symlinkSync(unitFile, link);
    sh("systemctl", ["--user", "daemon-reload"]);
    sh("systemctl", ["--user", "enable", "--now", unitName]);
    sh("systemctl", ["--user", "restart", unitName]);
  }
  entry.deployedAt = new Date().toISOString();
  writeRealized(entry);
  log(`deploy: ${id} @ ${commit} → 127.0.0.1:${entry.assigned.port}${dry ? " (dry-run)" : ""}`);
  await render();
}

const UNIT_DIR = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME, ".config"), "systemd", "user");

// Stop a project's process and take its unit out of systemd's sight. Safe to call
// for a project that never had one.
function stopUnit(id) {
  const link = join(UNIT_DIR, projectUnit(id));
  if (!lexists(link)) return false;
  // A unit whose file is a symlink out of the search path is "linked", and
  // `disable` removes that link itself — so the removal below must tolerate it
  // already being gone.
  spawnSync("systemctl", ["--user", "disable", "--now", projectUnit(id)], { stdio: "ignore" });
  rmSync(link, { force: true });
  spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  return true;
}

// Everything Labs holds about a project is one folder, so removing a project is
// removing that folder — after its process is stopped and its unit unlinked.
async function remove(id) {
  if (!id) fail("usage: labs remove <id>");
  if (!existsSync(projectDir(id))) fail(`${id}: nothing here — var/projects/${id}/ does not exist`);
  const had = stopUnit(id);
  removeProjectDir(id);
  log(`remove: ${id} — ${had ? "process stopped, unit unlinked, " : ""}var/projects/${id}/ deleted${readAllowlist().projects.some((p) => p.id === id) ? `; still in registry.json, so the next sync relists it (without a checkout)` : ""}`);
  await render();
}

async function render() {
  ensureDirs();
  const entries = readRealized();
  const st = site();
  // A capability that no longer generates routes must not leave its last file
  // behind — Caddy would keep importing it, and it would keep being wrong.
  const wants = new Set();
  for (const svc of readPlatform()) {
    const mod = join(svc.dir, "routes.mjs");
    if (!existsSync(mod)) continue;
    const { default: routes } = await import(mod);
    writeFileSync(join(DIRS.routes, `${svc.id}.caddy`), routes(entries, st));
    wants.add(`${svc.id}.caddy`);
  }
  for (const f of readdirSync(DIRS.routes)) if (f.endsWith(".caddy") && !wants.has(f)) rmSync(join(DIRS.routes, f));
  sh("node", [join(ROOT, "site", "build.mjs")]);

  // The Caddyfile is rendered too: where this checkout sits and what the two
  // hostnames are belong to this machine and to registry.json, not to a file in
  // git that every deployment would have to edit.
  const vars = { root: ROOT, labsHost: hostOf(st.labsUrl), mcpHost: hostOf(st.mcpUrl), gatewayPort: process.env.GATEWAY_PORT ?? "8800" };
  const caddyfile = join(VAR, "Caddyfile");
  writeFileSync(caddyfile, readFileSync(join(ROOT, "infra", "Caddyfile.tmpl"), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? fail(`Caddyfile.tmpl: unknown {{${k}}}`)));

  if (dry || noReload) return;
  // Reload only where Labs is actually wired into Caddy — never poke a Caddy that is serving something else.
  const main = "/etc/caddy/Caddyfile";
  const wired = existsSync(main) && readFileSync(main, "utf8").includes(caddyfile);
  if (!wired) { log(`caddy: not reloaded — ${main} does not import ${caddyfile} (see README, Deploy)`); return; }
  const r = spawnSync("caddy", ["reload", "--config", main], { encoding: "utf8" });
  if (r.status === 0) log("caddy: reloaded");
  else log(`caddy: reload failed — ${(r.stderr || r.error?.message || "").trim().split("\n").pop()}`);
}

function list() {
  const entries = readRealized();
  if (!entries.length) return log("nothing listed yet — run: labs sync");
  for (const e of entries) {
    const where = e.assigned?.port ? `127.0.0.1:${e.assigned.port}` : "not hosted";
    const rents = Object.keys(e.rented ?? {}).join(",") || "-";
    log(`${e.id.padEnd(16)} ${`${e.kind ?? kindOf(e.category)}/${e.category}`.padEnd(20)} ${e.status.padEnd(10)} ${(overdue(e) ? "OVERDUE" : "").padEnd(8)} ${where.padEnd(16)} ${Object.keys(e.surfaces ?? {}).join(",").padEnd(22)} rents: ${rents.padEnd(9)} ${e.repo}`);
  }
}

// ───────────────────────── repository ─────────────────────────

function exportCheck(path) {
  const file = path ?? MANIFEST_PATH;
  if (!existsSync(file)) fail(`no ${file} here — this command runs from a repository root (or give a path)`);
  const m = readJSON(file);
  const errors = validateManifest(m, null, readPlatform());
  if (errors.length) { console.error(`${file}:\n${errors.map((e) => `  ${e}`).join("\n")}`); process.exit(1); }
  const parts = [];
  // When run against the repository's own abc-labs/labs.json, show what
  // `install.include` actually matches: a glob that catches files instead of
  // their folders leaves nested resources behind, and no schema can see that —
  // only a listing can.
  const repoRoot = resolve(dirname(file), "..");
  if (m.export?.install?.include && resolve(file) === join(repoRoot, MANIFEST_PATH)) {
    const got = listIncluded(repoRoot, m.export.install.include);
    if (!got.length) console.error(`  warning: install.include ${JSON.stringify(m.export.install.include)} matches NOTHING here — an import would fail`);
    else {
      const files = got.reduce((n, g) => n + g.files, 0);
      log(`  install.include → ${got.length} entr${got.length === 1 ? "y" : "ies"}, ${files} file${files === 1 ? "" : "s"} travel with an import:`);
      for (const g of got) log(`    ${g.path}${g.dir ? "/" : ""}${g.dir && g.files > 1 ? `  (${g.files} files)` : ""}`);
      const fileOnly = got.filter((g) => !g.dir && readdirSync(join(repoRoot, dirname(g.path))).length > 1);
      if (fileOnly.length) console.error(`  warning: ${fileOnly.length} match${fileOnly.length === 1 ? " is a file" : "es are files"} with siblings left behind (e.g. ${fileOnly[0].path}) — match the folder, so references/, tools/ and the like travel too`);
    }
  }
  if (m.export) parts.push(`exports "${m.export.id}" — ${m.export.kind ?? kindOf(m.export.category)}/${m.export.category}, met as ${Object.keys(m.export.surfaces ?? {}).join(", ")}${hosted(m.export) ? " (run here)" : ""}${m.export.uses ? `, rents ${Object.keys(m.export.uses).join(", ")}` : ""}${m.export.tags?.length ? `, tags ${m.export.tags.join(" ")}` : ""}`);
  if (m.import) parts.push(`imports ${Object.entries(m.import).map(([k, v]) => `${k}@${v}`).join(", ")}`);
  log(`${file}: valid — ${parts.join("; ")}`);
}

// The public index is what `labs render` publishes at <labsUrl>/index.json. A local
// path or another URL can stand in for it: --index=… or LABS_INDEX=…
async function loadIndex() {
  const src = opt("index") ?? process.env.LABS_INDEX ?? `${site().labsUrl}/index.json`;
  if (existsSync(src)) return readJSON(src);
  let res;
  try { res = await fetch(src, { headers: { "user-agent": "abc-legacy-labs" } }); }
  catch (e) { fail(`cannot reach the Labs index at ${src}: ${e.message}`); }
  if (!res.ok) fail(`cannot read the Labs index at ${src} (${res.status})`);
  return res.json();
}

function cloneAt(repo, ref) {
  const tmp = mkdtempSync(join(tmpdir(), "labs-import-"));
  const isSha = /^[0-9a-f]{7,40}$/.test(ref) && ref !== "*";
  if (ref === "*") sh("git", ["clone", "--quiet", "--depth", "1", repo, tmp], { quiet: true });
  else if (!isSha) sh("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, repo, tmp], { quiet: true });
  else { sh("git", ["clone", "--quiet", repo, tmp], { quiet: true }); sh("git", ["-C", tmp, "checkout", "--quiet", ref], { quiet: true }); }
  const commit = sh("git", ["-C", tmp, "rev-parse", "--short=12", "HEAD"], { quiet: true }).stdout.trim();
  return { commit, tmp };
}

// "ux-audit-*" matches a top-level entry and everything under it; "**" spans directories.
function globToRe(pattern) {
  const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = pattern.replace(/\/+$/, "").split("**").map((part) => part.split("*").map(esc).join("[^/]*")).join(".*");
  return new RegExp(`^${body}$`);
}
// Every entry the patterns match, relative to src. A matched directory stops the
// walk — it travels whole, nested files included — so the result is the list of
// top-level things an importer receives, each tagged with how many files it holds.
function listIncluded(src, patterns) {
  const res = patterns.map(globToRe);
  const out = [];
  const countFiles = (abs) => readdirSync(abs, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(join(abs, e.name)) : 1), 0);
  const walk = (rel) => {
    for (const ent of readdirSync(rel ? join(src, rel) : src, { withFileTypes: true })) {
      if (ent.name === ".git" || (rel === "" && ent.name === LABS_DIR)) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (res.some((re) => re.test(r))) out.push({ path: r, dir: ent.isDirectory(), files: ent.isDirectory() ? countFiles(join(src, r)) : 1 });
      else if (ent.isDirectory()) walk(r);
    }
  };
  walk("");
  return out;
}
function copyIncluded(src, dest, patterns) {
  const matches = listIncluded(src, patterns);
  rmSync(dest, { recursive: true, force: true });
  for (const m of matches) {
    mkdirSync(dirname(join(dest, m.path)), { recursive: true });
    cpSync(join(src, m.path), join(dest, m.path), { recursive: true });
  }
  return matches.map((m) => m.path);
}
const lexists = (p) => { try { lstatSync(p); return true; } catch { return false; } };
function applyLinks(link, dest) {
  let n = 0;
  for (const [dTmpl, sTmpl] of Object.entries(link)) {
    for (const name of readdirSync(dest)) {
      const d = resolve(CWD, dTmpl.replaceAll("{name}", name));
      const s = resolve(CWD, sTmpl.replaceAll("{name}", name));
      if (!d.startsWith(CWD + "/") || !s.startsWith(CWD + "/")) fail(`install.link escapes the repository: ${dTmpl} → ${sTmpl}`);
      if (!existsSync(s)) continue;
      if (lexists(d)) {
        if (lstatSync(d).isSymbolicLink()) rmSync(d);
        else { log(`  keep ${relative(CWD, d)} — exists and is not a symlink, not touching it`); continue; }
      }
      mkdirSync(dirname(d), { recursive: true });
      symlinkSync(relative(dirname(d), s), d);
      n++;
    }
  }
  return n;
}

async function importProject(id, refArg, { quiet = false } = {}) {
  if (!id) fail("usage: labs import <id> [ref]   — run from the root of the repository that takes it");
  const index = await loadIndex();
  const proj = (index.projects ?? []).find((p) => p.id === id);
  if (!proj) fail(`"${id}" is not in the Labs index${index.projects?.length ? ` — it lists: ${index.projects.map((p) => p.id).join(", ")}` : " (it is empty)"}`);
  if (!proj.install) fail(`"${id}" is connect-only — it exports no install spec. Reach it at ${proj.mcp?.endpoint ?? proj.links?.url ?? proj.repo}`);
  if (proj.status === "archived") log(`warning: "${id}" is archived — importing what is left of it`);
  const mPath = join(CWD, MANIFEST_PATH), lPath = join(CWD, LOCK_PATH);
  const manifest = existsSync(mPath) ? readJSON(mPath) : { labs: 1 };
  const lock = existsSync(lPath) ? readJSON(lPath) : { labs: 1, imports: {} };
  const ref = refArg ?? manifest.import?.[id] ?? "*";
  const before = lock.imports?.[id]?.commit;
  const { commit, tmp } = cloneAt(proj.repo, ref);
  let staging;
  try {
    const dest = join(CWD, LABS_DIR, id);
    mkdirSync(join(CWD, LABS_DIR), { recursive: true });
    staging = mkdtempSync(join(CWD, LABS_DIR, `.${id}.staging-`));
    const copied = copyIncluded(tmp, staging, proj.install.include);
    if (!copied.length) {
      rmSync(staging, { recursive: true, force: true });
      staging = undefined;
      rmSync(tmp, { recursive: true, force: true });
      fail(`"${id}": nothing in ${proj.repo}@${commit} matched ${JSON.stringify(proj.install.include)}`);
    }
    // Publish only after copying and matching have succeeded. Existing files are
    // kept until the new tree is ready, so a failed update cannot erase a good one.
    const backup = `${dest}.backup-${process.pid}`;
    if (lexists(dest)) renameSync(dest, backup);
    try { renameSync(staging, dest); staging = undefined; }
    catch (e) { if (lexists(backup)) renameSync(backup, dest); throw e; }
    let links;
    try { links = applyLinks(proj.install.link ?? {}, dest); }
    catch (e) {
      rmSync(dest, { recursive: true, force: true });
      if (lexists(backup)) renameSync(backup, dest);
      throw e;
    }
    if (lexists(backup)) rmSync(backup, { recursive: true, force: true });
    manifest.import = { ...(manifest.import ?? {}), [id]: ref };
    writeJSON(mPath, manifest);
    lock.imports = { ...(lock.imports ?? {}), [id]: { repo: proj.repo, ref, commit, installedAt: new Date().toISOString() } };
    writeJSON(lPath, lock);
    if (!quiet) log(`import: ${id}@${ref} → ${LABS_DIR}/${id}/ (${copied.length} entr${copied.length === 1 ? "y" : "ies"}${links ? `, ${links} link${links === 1 ? "" : "s"}` : ""}) pinned at ${commit}${before && before !== commit ? ` (was ${before})` : before ? " (unchanged)" : ""}`);
  } finally {
    if (staging && lexists(staging)) rmSync(staging, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  return { before, commit };
}

async function update(only) {
  const mPath = join(CWD, MANIFEST_PATH);
  if (!existsSync(mPath)) fail(`no ${MANIFEST_PATH} here — run \`labs import <id>\` first`);
  const m = readJSON(mPath);
  const ids = Object.keys(m.import ?? {}).filter((i) => !only || i === only);
  if (!ids.length) fail(only ? `"${only}" is not imported here` : "nothing imported here yet");
  for (const id of ids) await importProject(id, m.import[id]);
}

switch (cmd) {
  case "sync": await sync(args[0]); break;
  case "deploy": await deploy(args[0]); break;
  case "remove": await remove(args[0]); break;
  case "render": await render(); break;
  case "list": list(); break;
  case "export": case "validate": exportCheck(args[0]); break;
  case "import": case "install": await importProject(args[0], args[1]); break;
  case "update": await update(args[0]); break;
  default:
    log(usage());
    process.exit(cmd ? 1 : 0);
}
