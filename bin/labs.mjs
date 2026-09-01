#!/usr/bin/env node
// The Labs CLI. Two families of verbs.
//
// Platform verbs — run in the Labs checkout, on the Labs server:
//   labs sync [id]                 every allowlisted repo's abc-labs/labs.json → var/registry.d, then render
//   labs deploy <id> [--dry-run]   clone/pull a project renting host, provision what it rents, write its unit, start it
//   labs render [--no-reload]      registry.d → routes/*.caddy + site/dist (catalog, pages, index.json), caddy reload
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
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  DIRS, LABS_DIR, LOCK_PATH, MANIFEST_PATH, ROOT, ensureDirs, hosted, kindOf, npxCommand, overdue, readAllowlist, readJSON, readPlatform,
  readRealized, site, validateManifest, writeJSON, writeRealized,
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
  return p;
}

function rawManifestUrl(repo) {
  const m = repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/${MANIFEST_PATH}` : null;
}

// A hosted project's manifest is read from its checkout; a listed-only project's from
// GitHub; a repo given as a local path (tests, a mirror) straight from disk.
async function fetchManifest(p) {
  for (const local of [join(DIRS.projects, p.id, MANIFEST_PATH), join(p.repo, MANIFEST_PATH)]) {
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
  const prev = new Map(readRealized().map((e) => [e.id, e]));
  let ok = 0, skipped = 0;
  for (const p of readAllowlist().projects) {
    if (only && p.id !== only) continue;
    const r = await fetchManifest(p);
    if (r.error) { log(`  skip ${p.id} — no ${MANIFEST_PATH} yet (${r.error})`); skipped++; continue; }
    const errors = validateManifest(r.manifest, p.id, platform);
    if (errors.length) { log(`  skip ${p.id} — invalid labs.json:\n    ${errors.join("\n    ")}`); skipped++; continue; }
    if (!r.manifest.export) { log(`  skip ${p.id} — labs.json has no "export": it takes from Labs but is not a Labs project`); skipped++; continue; }
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
  const dir = join(DIRS.projects, id);
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
  if (!hosted(ex)) fail(`${id}: does not rent "host" — this project is listed, not run here; \`labs sync\` is all it needs`);

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

  const { install, start } = ex.uses.host;
  if (install) {
    log(`install: ${install}`);
    if (!dry) sh("sh", ["-c", install], { cwd: dir });
  }

  // The env file is written by Labs, KEY=value only, so systemd's EnvironmentFile
  // reads it exactly as written. Mode 600: a service may put a token in here.
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || /[\s'"#\\]/.test(v)) fail(`env ${k}: a value systemd would misread — capabilities must hand out plain tokens`);
  }
  const envFile = join(DIRS.env, `${id}.env`);
  writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(envFile, 0o600);
  entry.assigned.envFile = envFile;

  const unitName = `labs-project-${id}.service`;
  const vars = { id, repo: p.repo, dir, envfile: envFile, start: start.replace(/'/g, "'\\''") };
  const unit = readFileSync(join(ROOT, "infra", "systemd", "project.service.tmpl"), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? fail(`project.service.tmpl: unknown {{${k}}}`));
  const unitDir = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME, ".config"), "systemd", "user");
  entry.assigned.unit = unitName;
  if (dry) {
    log(`dry-run: would write ${join(unitDir, unitName)} and restart it:\n${unit.replace(/^/gm, "    ")}`);
  } else {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(join(unitDir, unitName), unit);
    sh("systemctl", ["--user", "daemon-reload"]);
    sh("systemctl", ["--user", "enable", "--now", unitName]);
    sh("systemctl", ["--user", "restart", unitName]);
  }
  entry.deployedAt = new Date().toISOString();
  writeRealized(entry);
  log(`deploy: ${id} @ ${commit} → 127.0.0.1:${entry.assigned.port}${dry ? " (dry-run)" : ""}`);
  await render();
}

async function render() {
  ensureDirs();
  const entries = readRealized();
  const st = site();
  for (const svc of readPlatform()) {
    const mod = join(svc.dir, "routes.mjs");
    if (!existsSync(mod)) continue;
    const { default: routes } = await import(mod);
    writeFileSync(join(DIRS.routes, `${svc.id}.caddy`), routes(entries, st));
  }
  sh("node", [join(ROOT, "site", "build.mjs")]);
  if (dry || noReload) return;
  // Reload only where Labs is actually wired into Caddy — never poke a Caddy that is serving something else.
  const main = "/etc/caddy/Caddyfile";
  const wired = existsSync(main) && readFileSync(main, "utf8").includes(join(ROOT, "infra", "Caddyfile"));
  if (!wired) { log(`caddy: not reloaded — ${main} does not import ${join(ROOT, "infra", "Caddyfile")} (see README, Deploy)`); return; }
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
function copyIncluded(src, dest, patterns) {
  const res = patterns.map(globToRe);
  rmSync(dest, { recursive: true, force: true });
  const copied = [];
  const walk = (rel) => {
    for (const ent of readdirSync(rel ? join(src, rel) : src, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (res.some((re) => re.test(r))) {
        mkdirSync(dirname(join(dest, r)), { recursive: true });
        cpSync(join(src, r), join(dest, r), { recursive: true });
        copied.push(r);
      } else if (ent.isDirectory()) walk(r);
    }
  };
  walk("");
  return copied;
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
  try {
    const dest = join(CWD, LABS_DIR, id);
    const copied = copyIncluded(tmp, dest, proj.install.include);
    if (!copied.length) fail(`"${id}": nothing in ${proj.repo}@${commit} matched ${JSON.stringify(proj.install.include)}`);
    const links = applyLinks(proj.install.link ?? {}, dest);
    manifest.import = { ...(manifest.import ?? {}), [id]: ref };
    writeJSON(mPath, manifest);
    lock.imports = { ...(lock.imports ?? {}), [id]: { repo: proj.repo, ref, commit, installedAt: new Date().toISOString() } };
    writeJSON(lPath, lock);
    if (!quiet) log(`import: ${id}@${ref} → ${LABS_DIR}/${id}/ (${copied.length} entr${copied.length === 1 ? "y" : "ies"}${links ? `, ${links} link${links === 1 ? "" : "s"}` : ""}) pinned at ${commit}${before && before !== commit ? ` (was ${before})` : before ? " (unchanged)" : ""}`);
  } finally {
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
  case "render": await render(); break;
  case "list": list(); break;
  case "export": case "validate": exportCheck(args[0]); break;
  case "import": case "install": await importProject(args[0], args[1]); break;
  case "update": await update(args[0]); break;
  default:
    log(usage());
    process.exit(cmd ? 1 : 0);
}
