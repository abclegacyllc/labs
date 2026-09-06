// The one place that knows where things are and what the words mean.
// Used by bin/labs, site/build.mjs and every service.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Realized state lives under var/ (gitignored): what is true on THIS machine,
// as opposed to registry.json (who is allowed in) and a project's abc-labs/labs.json
// (what it says about itself).
export const VAR = join(ROOT, "var");
// Project-centred on purpose. EVERYTHING Labs holds about one project lives in
// var/projects/<id>/ — its listing, its checkout, its env, its unit file, later
// its cached icon and readme — so a project is removed by removing one folder,
// and nothing about it can be left behind in a corner of Labs. Only aggregates
// that span all projects (the generated Caddy routes) live outside it.
export const DIRS = {
  projects: join(VAR, "projects"),   // var/projects/<id>/ — see projectDir
  routes: join(VAR, "routes"),       // <capability>.caddy, generated from ALL projects; imported by var/Caddyfile
};
export const REALIZED = "realized.json";           // the listing: manifest ⊕ what Labs assigned
export const projectDir = (id) => join(DIRS.projects, id);
export const projectRepo = (id) => join(projectDir(id), "repo");
export const projectEnv = (id) => join(projectDir(id), "env");
export const projectUnit = (id) => `labs-project-${id}.service`;
export const projectUnitFile = (id) => join(projectDir(id), projectUnit(id));

// Everything Labs-related inside ANY repository lives in one folder. Two files:
//   labs.json       written by people — "export": what this repo gives Labs,
//                                       "import": what it takes from Labs
//   labs.lock.json  written by the CLI — the exact commit behind every import
// Labs reads exactly one path from a guest repo. No fallback to the repo root:
// two places, two truths.
// The hostname a public URL is served on — the Caddyfile is rendered from these,
// so the site metadata is the only place either name is written.
export const hostOf = (url) => new URL(url).host;

export const LABS_DIR = "abc-labs";
export const MANIFEST_PATH = `${LABS_DIR}/labs.json`;
export const LOCK_PATH = `${LABS_DIR}/labs.lock.json`;

export const STATUSES = ["building", "alpha", "beta", "graduated", "archived"];
export const CALLABLE = new Set(["alpha", "beta", "graduated"]);
export const CLOCK_DAYS = 14;
export const STATUS_TEXT = {
  building: `Not callable yet. ${CLOCK_DAYS} days from "started" to alpha, or archived.`,
  alpha: "Callable. May break, may change, may vanish. Feedback wanted.",
  beta: "Callable and stable in shape. Breaking changes get a deprecation window.",
  graduated: "Left Labs for a home of its own. The endpoint keeps working.",
  archived: "Retired. The endpoint returns 410 Gone and points to the note explaining why.",
};
export const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function ensureDirs() {
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
}
export function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
export function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
export function readAllowlist() {
  return readJSON(join(ROOT, "registry.json"));
}
export function site() {
  const s = readAllowlist().site;
  return { ...s, labsUrl: process.env.LABS_URL ?? s.labsUrl, mcpUrl: process.env.MCP_URL ?? s.mcpUrl };
}
// A project is LISTED when its folder holds a realized.json. The catalog, the
// index and the routes read only these.
export function readRealized() {
  if (!existsSync(DIRS.projects)) return [];
  return readdirSync(DIRS.projects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(DIRS.projects, d.name, REALIZED)))
    .map((d) => readJSON(join(DIRS.projects, d.name, REALIZED)))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function writeRealized(entry) {
  writeJSON(join(projectDir(entry.id), REALIZED), entry);
}
// Unlist: the project leaves the catalog, the index and the routes, but its
// folder — checkout, env, unit — stays, so a process keeps running and the next
// good sync relists it. Removing the folder is a separate, explicit act.
export function removeRealized(id) {
  rmSync(join(projectDir(id), REALIZED), { force: true });
}
export function removeProjectDir(id) {
  rmSync(projectDir(id), { recursive: true, force: true });
}
// The platform layer: capabilities Labs runs multi-tenant and a project rents via
// `uses` — host, mcp, later notify. Not to be confused with the project kind
// "service" (an API, a tool, an agent, a component — things that do work).
export function readPlatform() {
  const dir = join(ROOT, "platform");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "capability.json")))
    .map((d) => ({ dir: join(dir, d.name), ...readJSON(join(dir, d.name, "capability.json")) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── The three axes of a project ──────────────────────────────────────────────
// kind      WHAT SORT of thing it is — service (does work) or resource (is material).
//           Written in the manifest and checked against the category: an author states
//           both, and a pair that disagrees is an error. Two fields, one truth, enforced.
// category  what the taking project GETS — seven universal roles, one per project.
// surfaces  WHERE a user meets it — delivery channels, one or more, each with its fields.
// tags      what it is ABOUT — open, optional. Tags are where future axes incubate.
export const KINDS = {
  service: { name: "Services", summary: "Things that do work: call them, operate them, delegate to them, embed them." },
  resource: { name: "Resources", summary: "Things you take: knowledge, material, starting points. They do nothing by themselves." },
};
export const CATEGORIES = {
  api:       { kind: "service",  name: "APIs", one: "API",       test: "You send a request and get a result, without owning how.",        surfaces: ["mcp", "app", "cli", "package", "bot"] },
  tool:      { kind: "service",  name: "Tools", one: "Tool",      test: "You operate it yourself to do your own work faster.",             surfaces: ["userscript", "extension", "app", "cli", "package", "mcp"] },
  agent:     { kind: "service",  name: "Agents", one: "Agent",     test: "You hand it a goal; it works out the steps.",                     surfaces: ["mcp", "app", "cli", "package", "bot"] },
  component: { kind: "service",  name: "Components", one: "Component", test: "It becomes a part of your product.",                              surfaces: ["package", "import"] },
  knowledge: { kind: "resource", name: "Knowledge", one: "Knowledge",  test: "It makes you, or your agent, know something: how, what, why.",    surfaces: ["ai", "import", "download"] },
  asset:     { kind: "resource", name: "Assets", one: "Asset",     test: "Material you take and use as it is; it does nothing by itself.",  surfaces: ["download", "import", "package"] },
  template:  { kind: "resource", name: "Templates", one: "Template",  test: "You start your own thing from it.",                               surfaces: ["import", "app", "download"] },
};
export const kindOf = (category) => CATEGORIES[category]?.kind;
// fields: required | optional. `needs`: the export field that must accompany the surface.
// `action` is what the button on a card says — the one thing a visitor is meant
// to do with this surface. `copy` marks the surfaces whose action is a command
// rather than a link.
export const SURFACES = {
  mcp:        { where: "an AI client, over MCP",                    action: "Connect over MCP",   copy: true,  fields: {},                                          needs: "uses.mcp" },
  ai:         { where: "an AI that reads its format",              action: "Add to your AI",     copy: true,  fields: { format: "required" },                      needs: "install" },
  import:     { where: "abc-labs/<id>/ in a repository, vendored",  action: "Import into a repo", copy: true,  fields: {},                                          needs: "install" },
  userscript: { where: "the browser, via Tampermonkey",             action: "Install userscript", fields: { url: "required" } },
  extension:  { where: "inside another application",                action: "Get the extension",  fields: { url: "required", host: "required" } },
  app:        { where: "an application you open",                   action: "Open",               fields: { url: "required", platform: "optional" } },
  cli:        { where: "a terminal",                                action: "Run it",             copy: true,  fields: { command: "required" } },
  package:    { where: "a package registry",                        action: "Install",            copy: true,  fields: { command: "required", registry: "optional" } },
  bot:        { where: "a chat",                                    action: "Open in chat",       fields: { url: "required" } },
  download:   { where: "a file you fetch",                          action: "Download",           fields: { url: "required" } },
};
// What an `ai` surface declares is the FORMAT it is written in — not a host.
// Which assistants read a format is a fact about the ecosystem, so Labs keeps it
// here, in one place, instead of every manifest naming clients that change.
export const AI_FORMATS = {
  "agent-skill": { name: "Agent Skills (SKILL.md)", hosts: "Claude Code, claude.ai and the Claude API" },
  "agents-md": { name: "AGENTS.md", hosts: "any agent that reads AGENTS.md" },
  "cursor-rules": { name: "Cursor rules", hosts: "Cursor" },
  "prompt": { name: "Prompt pack", hosts: "any assistant — pasted or referenced" },
};

// What a project renting `mcp` is allowed to consume. Set by LABS, in
// registry.json — never by the project's own manifest, which lives in a
// repository Labs does not control and could raise its own ceiling.
// Two dimensions, because they protect different things: `project` keeps one
// tenant from taking the machine, `client` keeps one caller from taking a tenant.
// `concurrent` is the one that catches held-open streams, which a per-minute
// rate never sees.
export const MCP_TIERS = {
  default:  { client: { rpm: 60,  burst: 20 }, project: { rpm: 600,  burst: 120 }, concurrent: { client: 4,  project: 20 } },
  heavy:    { client: { rpm: 120, burst: 40 }, project: { rpm: 3000, burst: 400 }, concurrent: { client: 8,  project: 60 } },
  internal: { unlimited: true },
};
export const DEFAULT_TIER = "default";
export const tierOf = (entry) => MCP_TIERS[entry?.tier] ?? MCP_TIERS[DEFAULT_TIER];

export const TAG_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
export const MAX_TAGS = 5;

// Rule 4 is Labs's rule, so Labs does the arithmetic — a project never declares its own deadline.
export function alphaBy(started) {
  const d = new Date(`${started}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CLOCK_DAYS);
  return d.toISOString().slice(0, 10);
}
export function overdue(entry, today = new Date().toISOString().slice(0, 10)) {
  return entry.status === "building" && alphaBy(entry.started) < today;
}

export const hosted = (ex) => ex?.uses?.host !== undefined;
export const projectUrl = (site, id) => `${site.labsUrl}/${id}`;
// A project's own origin under the catalog's domain. A subdomain, never a path:
// the browser's isolation boundary is the origin, and one experiment must not be
// able to read another's storage. Covered by one wildcard DNS record.
export const webOrigin = (site, id) => `${new URL(site.labsUrl).protocol}//${id}.${new URL(site.labsUrl).host}`;
// `npx github:<owner>/<repo>` runs this CLI straight from the repository — no publish step.
export function npxCommand(site) {
  const m = site.repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `npx github:${m[1]}/${m[2]}` : "bin/labs";
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
// A path inside the repository: relative, no escaping upwards, no tricks.
const safeRel = (p) => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("\\");

// URLs become browser links or generated Caddy configuration. Reject controls
// before URL parsing because WHATWG URL strips newlines and tabs.
export function normalizeHttpUrl(value, { allowHttp = false, externalOnly = false, field = "URL" } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty URL`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} contains control characters`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${field} is not a valid URL`); }
  const protocols = allowHttp ? ["http:", "https:"] : ["https:"];
  if (!protocols.includes(url.protocol)) throw new Error(`${field} must use ${allowHttp ? "http or https" : "https"}`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  if (externalOnly) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const parts = host.split(".").map(Number);
    const privateIpv4 = isIP(host) === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
    if (host === "localhost" || host.endsWith(".localhost") || privateIpv4 || (isIP(host) === 6 && (host === "::1" || host === "::"))) {
      throw new Error(`${field} must not point to a private or loopback host`);
    }
  }
  return url.toString();
}

function urlField(value, field, errors, options = {}) {
  if (value === undefined) return;
  try { normalizeHttpUrl(value, { ...options, field }); }
  catch (e) { errors.push(`export: ${e.message}`); }
}

// abc-labs/labs.json, contract version 1. Returns a list of human-readable
// problems; empty means valid. The file has two halves and needs at least one.
export function validateManifest(m, expectId, platform) {
  if (!isObj(m)) return ["labs.json must be a JSON object"];
  const errors = [];
  if (m.labs !== 1) errors.push(`"labs" is the contract version and must be 1`);
  const stray = ["id", "name", "tagline", "status", "started", "uses", "links", "note", "run", "install"].filter((k) => m[k] !== undefined);
  if (stray.length) errors.push(`${stray.map((k) => `"${k}"`).join(", ")} belong inside "export" — labs.json has two halves: "export" (what this repo gives Labs) and "import" (what it takes from Labs)`);
  if (m.export === undefined && m.import === undefined) errors.push(`nothing here: add "export" to be listed, "import" to take Labs projects, or both`);
  if (m.export !== undefined) errors.push(...validateExport(m.export, expectId, platform));
  if (m.import !== undefined) errors.push(...validateImport(m.import));
  return errors;
}

export function validateExport(ex, expectId, platform) {
  if (!isObj(ex)) return [`"export" must be an object`];
  const errors = [];
  const need = (k, type) => {
    if (ex[k] === undefined) errors.push(`export: missing "${k}"`);
    else if (typeof ex[k] !== type) errors.push(`export: "${k}" must be a ${type}`);
  };
  need("id", "string");
  if (typeof ex.id === "string" && !ID_RE.test(ex.id)) errors.push(`export: "id" — this project's id, the one YOU choose — must match ${ID_RE}; it becomes the URL path Labs publishes you at`);
  if (expectId && ex.id !== expectId) errors.push(`export: this project's id is "${ex.id}" but Labs's allowlist has this repository as "${expectId}" — one of the two has to change`);
  need("name", "string");
  need("tagline", "string");
  need("status", "string");
  if (typeof ex.status === "string" && !STATUSES.includes(ex.status)) errors.push(`export: "status" must be one of: ${STATUSES.join(", ")}`);
  need("started", "string");
  if (typeof ex.started === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(ex.started)) errors.push(`export: "started" must be YYYY-MM-DD`);

  // Axis 1 — kind and category, both written, and they must agree.
  need("kind", "string");
  need("category", "string");
  if (typeof ex.kind === "string" && !KINDS[ex.kind]) {
    errors.push(`export: "kind" must be "service" (it does work) or "resource" (it is material)`);
  }
  if (typeof ex.category === "string" && !CATEGORIES[ex.category]) {
    errors.push(`export: "category" must be one of: ${Object.entries(CATEGORIES).map(([c, v]) => `${c} (${v.kind})`).join(", ")}`);
  } else if (typeof ex.category === "string" && typeof ex.kind === "string" && KINDS[ex.kind] && kindOf(ex.category) !== ex.kind) {
    errors.push(`export: "kind" says "${ex.kind}" but "${ex.category}" is a ${kindOf(ex.category)} — ${CATEGORIES[ex.category].test} Change whichever one is wrong.`);
  }

  // Axis 2 — surfaces, each with its fields, each allowed for the category.
  if (ex.surfaces === undefined) errors.push(`export: missing "surfaces" — where does a user meet this? one or more of: ${Object.keys(SURFACES).join(", ")}`);
  else if (!isObj(ex.surfaces) || !Object.keys(ex.surfaces).length) errors.push(`export: "surfaces" must be a non-empty object, e.g. {"mcp": {}} or {"userscript": {"url": "…"}}`);
  else {
    const allowed = CATEGORIES[ex.category]?.surfaces;
    for (const [name, def] of Object.entries(ex.surfaces)) {
      const spec = SURFACES[name];
      if (!spec) { errors.push(`export: unknown surface "${name}" — known: ${Object.keys(SURFACES).join(", ")}`); continue; }
      if (allowed && !allowed.includes(name)) errors.push(`export: a "${ex.category}" is not met as "${name}" — a ${ex.category} reaches people through: ${allowed.join(", ")}`);
      if (!isObj(def)) { errors.push(`export: surfaces.${name} must be an object`); continue; }
      // A project renting `web` has no URL to write: Labs assigns the origin.
      const suppliedByLabs = name === "app" && ex.uses?.web !== undefined;
      for (const [f, rule] of Object.entries(spec.fields)) {
        if (rule === "required" && !(suppliedByLabs && f === "url") && (typeof def[f] !== "string" || !def[f].trim())) errors.push(`export: surfaces.${name} needs "${f}"`);
        if (def[f] !== undefined && typeof def[f] !== "string") errors.push(`export: surfaces.${name}.${f} must be a string`);
        if (f === "url" && typeof def[f] === "string") urlField(def[f], `surfaces.${name}.url`, errors);
      }
      for (const f of Object.keys(def)) if (!(f in spec.fields)) errors.push(`export: surfaces.${name} has no field "${f}" — it takes: ${Object.keys(spec.fields).join(", ") || "nothing"}`);
      if (name === "ai" && typeof def.format === "string" && !AI_FORMATS[def.format]) {
        errors.push(`export: surfaces.ai.format must be one of: ${Object.entries(AI_FORMATS).map(([k, v]) => `${k} (${v.hosts})`).join(", ")}`);
      }
    }
    // Surfaces and mechanics must agree in both directions.
    if (ex.surfaces.mcp && ex.uses?.mcp === undefined) errors.push(`export: surface "mcp" needs "uses.mcp" — the mcp capability is what puts you on mcp.abclegacyllc.com`);
    if (ex.uses?.mcp !== undefined && !ex.surfaces.mcp) errors.push(`export: you rent "mcp" but list no "mcp" surface — where do users meet it?`);
    const vendored = ex.surfaces.ai || ex.surfaces.import;
    if (vendored && ex.install === undefined) errors.push(`export: surface "${ex.surfaces.ai ? "ai" : "import"}" needs "install" — what gets copied?`);
    if (ex.install !== undefined && !vendored) errors.push(`export: "install" without an "ai" or "import" surface — which one lands in the taking repo?`);
  }

  // Axis 3 — tags, open and optional.
  if (ex.tags !== undefined) {
    if (!Array.isArray(ex.tags) || ex.tags.some((t) => typeof t !== "string" || !TAG_RE.test(t))) errors.push(`export: "tags" must be a list of lowercase slugs (${TAG_RE})`);
    else if (ex.tags.length > MAX_TAGS) errors.push(`export: at most ${MAX_TAGS} tags — pick the ones people would filter by`);
  }
  if (ex.license !== undefined && (typeof ex.license !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(ex.license))) errors.push(`export: "license" must be an SPDX identifier, e.g. MIT, Apache-2.0`);
  if (ex.uses !== undefined) {
    if (!isObj(ex.uses)) errors.push(`export: "uses" must be an object keyed by service id, e.g. {"mcp": {}}`);
    else {
      const known = new Set(platform.map((s) => s.id));
      for (const k of Object.keys(ex.uses)) if (!known.has(k)) errors.push(`export: "uses" names unknown platform capability "${k}" — Labs offers: ${[...known].join(", ")}`);
      if (ex.uses.mcp !== undefined && !isObj(ex.uses.mcp)) errors.push(`export: "uses.mcp" must be an object`);
    }
  }
  if (ex.run !== undefined) errors.push(`export: "run" is not a field — hosting is a service: "uses": {"host": {"start": "..."}}`);
  const web = ex.uses?.web;
  if (web !== undefined) {
    if (!isObj(web)) errors.push(`export: "uses.web" must be an object`);
    else {
      if (web.dist !== undefined && !safeRel(web.dist)) errors.push(`export: "uses.web.dist" must be a relative directory inside your repository, e.g. "dist"`);
      if (web.spa !== undefined && typeof web.spa !== "boolean") errors.push(`export: "uses.web.spa" must be true or false`);
      if (web.dist === undefined && ex.uses?.host === undefined) errors.push(`export: renting "web" with no "dist" proxies the origin to your process, so you must also rent "host"`);
      if (!ex.surfaces?.app) errors.push(`export: you rent "web" but list no "app" surface — that is what puts the Open button on your card`);
    }
  }
  const host = ex.uses?.host;
  if (host !== undefined) {
    if (!isObj(host) || typeof host.start !== "string" || !host.start.trim()) errors.push(`export: "uses.host" needs a "start" command`);
    else if (host.install !== undefined && typeof host.install !== "string") errors.push(`export: "uses.host.install" must be a string`);
  }
  if (ex.uses?.mcp !== undefined && host === undefined && !ex.uses.mcp?.upstream) {
    errors.push(`export: renting "mcp" needs either "uses.host" (run here) or "uses.mcp.upstream" (served elsewhere)`);
  }
  if (isObj(ex.uses?.mcp) && ex.uses.mcp.upstream !== undefined) {
    try { normalizeHttpUrl(ex.uses.mcp.upstream, { externalOnly: true, field: "export: uses.mcp.upstream" }); }
    catch (e) { errors.push(e.message); }
  }
  if (ex.links !== undefined && !isObj(ex.links)) errors.push(`export: "links" must be an object`);
  if (isObj(ex.links)) {
    urlField(ex.links.docs, "links.docs", errors);
    urlField(ex.links.feedback, "links.feedback", errors);
  }
  if (ex.links?.url !== undefined) errors.push(`export: "links.url" is gone — where people meet you is a surface: "surfaces": {"app": {"url": "…"}} (or userscript, extension, bot, download)`);
  if (ex.note !== undefined && typeof ex.note !== "string") errors.push(`export: "note" must be a string`);
  if (ex.install !== undefined) {
    const ins = ex.install;
    if (!isObj(ins)) errors.push(`export: "install" must be an object`);
    else {
      if (!Array.isArray(ins.include) || !ins.include.length || !ins.include.every(safeRel)) errors.push(`export: "install.include" must be a non-empty list of relative paths or globs inside the repo`);
      if (ins.link !== undefined) {
        if (!isObj(ins.link)) errors.push(`export: "install.link" must be an object of {"<dest>": "<source>"}`);
        else for (const [d, s] of Object.entries(ins.link)) {
          if (!safeRel(d) || !safeRel(s)) errors.push(`export: install.link "${d}" → "${s}" must both be relative paths inside the importing repo`);
          if (!s.startsWith(`${LABS_DIR}/${ex.id}/`)) errors.push(`export: install.link source "${s}" must point inside ${LABS_DIR}/${ex.id}/ — that is where your files land`);
        }
      }
    }
  }
  return errors;
}

export function validateImport(im) {
  if (!isObj(im)) return [`"import" must be an object of {"<id>": "<git ref or *>"}`];
  const errors = [];
  for (const [id, ref] of Object.entries(im)) {
    if (!ID_RE.test(id)) errors.push(`import: "${id}" is not a Labs id`);
    if (typeof ref !== "string" || !ref.trim()) errors.push(`import: "${id}" must be a git ref — a branch, a tag, a commit — or "*" for the default branch`);
  }
  return errors;
}
