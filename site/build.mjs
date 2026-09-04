// Renders labs.abclegacyllc.com from two sources and nothing else:
//   var/registry.d/*.json        the projects — what `labs sync` / `labs deploy` made true
//   platform/*/capability.json   the platform — what Labs runs for projects
//
//   node site/build.mjs   (usually via `labs render`)
//     → site/dist/index.html          the catalog, three levels: kind › category › project
//     → site/dist/<id>/index.html     one page per listed project, archived ones included —
//                                     it is where a 410 from the gateway sends people
//     → site/dist/index.json          the public, machine-readable index: what `labs import`
//                                     resolves an id against. No ports, no paths on disk.
//
// Zero dependencies on purpose. Edit the sources or this file — never dist/.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_FORMATS, CALLABLE, CATEGORIES, KINDS, LABS_DIR, STATUS_TEXT, SURFACES, alphaBy, kindOf, npxCommand, overdue, projectUrl, readPlatform,
  readRealized, site as readSite,
} from "../lib/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = readSite();
const npx = npxCommand(site);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const badge = (status, title = STATUS_TEXT[status] ?? "") =>
  `<span class="status status-${esc(status)}" title="${esc(title)}">${esc(status)}</span>`;
const kindOfEntry = (p) => p.kind ?? kindOf(p.category); // written since the kind field became required; derived for anything older
const kindcat = (p) => `<a class="kindcat" href="/#${esc(p.category)}" title="${esc(CATEGORIES[p.category]?.test ?? "")}">${esc(kindOfEntry(p))} › ${esc(p.category)}</a>`;
const chips = (p) => Object.keys(p.surfaces ?? {}).map((s) => `<span class="chip" title="${esc(SURFACES[s]?.where ?? "")}">${esc(s)}</span>`).join(" ");
const tags = (p) => (p.tags ?? []).map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ");
const rentsOf = (p) => Object.keys(p.rented ?? {});
const link = (url, text = url) => `<a class="open" href="${esc(url)}">${esc(text)}</a>`;

// One "Where" row per surface — this is what the surfaces axis buys the visitor.
function whereRow(p, name, def) {
  const label = (t) => `<p class="label">${esc(t)}</p>`;
  switch (name) {
    case "mcp": {
      const mcp = p.rented?.mcp;
      if (!mcp) return `${label("MCP")}<p class="hint">Endpoint not routed yet.</p>`;
      return `${label("MCP endpoint")}
    <code class="endpoint">${esc(mcp.endpoint)}</code>
    <pre><code>claude mcp add --transport http abc-${esc(p.id)} ${esc(mcp.endpoint)}</code></pre>
    <p class="hint">Claude.ai / Desktop: Settings → Connectors → Add custom connector → paste the endpoint.</p>`;
    }
    case "ai":
    case "import": {
      const fmt = name === "ai" ? AI_FORMATS[def.format] : null;
      return `${label(fmt ? `For your AI — ${fmt.name}` : "Import into your repository")}
    ${fmt ? `<p class="hint">Runs in ${esc(fmt.hosts)}.</p>\n    ` : ""}<pre><code>${esc(npx)} import ${esc(p.id)}</code></pre>
    <p class="hint">Copies ${(p.install?.include ?? []).map((i) => `<code>${esc(i)}</code>`).join(", ")} into <code>${esc(LABS_DIR)}/${esc(p.id)}/</code>, pinned in <code>${esc(LABS_DIR)}/labs.lock.json</code>.</p>`;
    }
    case "userscript": return `${label("Userscript (Tampermonkey)")}<p>${link(def.url)}</p>`;
    case "extension": return `${label(`Extension for ${def.host}`)}<p>${link(def.url)}</p>`;
    case "app": return `${label(def.platform ? `App (${def.platform})` : "App")}<p>${link(def.url, "Open →")} <span class="hint">${esc(def.url)}</span></p>`;
    case "bot": return `${label("Bot")}<p>${link(def.url)}</p>`;
    case "download": return `${label("Download")}<p>${link(def.url)}</p>`;
    case "cli": return `${label("Terminal")}<pre><code>${esc(def.command)}</code></pre>`;
    case "package": return `${label(def.registry ? `Package (${def.registry})` : "Package")}<pre><code>${esc(def.command)}</code></pre>`;
    default: return "";
  }
}

function reach(p) {
  if (p.status === "building") {
    const late = overdue(p);
    return `<p class="soon${late ? " late" : ""}">${late ? "Overdue —" : "Not callable yet —"} alpha by <time datetime="${esc(alphaBy(p.started))}">${esc(alphaBy(p.started))}</time>.</p>`;
  }
  if (p.status === "archived") return `<p class="soon">Retired.${p.surfaces?.mcp ? " The endpoint answers <code>410 Gone</code>." : ""}</p>`;
  const rows = Object.keys(SURFACES)
    .filter((s) => p.surfaces?.[s])
    // `ai` and `import` are one act — files vendored into abc-labs/<id>/ — plus one
    // extra fact: which AI reads them. Both blocks would print the same command
    // twice, so the richer one stands for both.
    .filter((s) => !(s === "import" && p.surfaces.ai))
    .map((s) => whereRow(p, s, p.surfaces[s]));
  return rows.join("\n    ") || `<p class="hint">See the repository for how to use it.</p>`;
}

function projectFooter(p) {
  return `<footer>
      <a href="${esc(p.repo)}">Source</a>
      ${p.links?.docs ? `<a href="${esc(p.links.docs)}">Docs</a>` : ""}
      <a href="${esc(p.links?.feedback ?? `${p.repo}/issues`)}">Feedback</a>
      ${rentsOf(p).length ? `<span class="rents">rents ${rentsOf(p).map(esc).join(", ")}</span>` : ""}
      ${p.license ? `<span class="rents">${esc(p.license)}</span>` : ""}
      <span class="since">since <time datetime="${esc(p.started)}">${esc(p.started)}</time></span>
    </footer>`;
}

function projectCard(p) {
  return `
  <article class="card" id="${esc(p.id)}">
    <header>
      <h4><a href="/${esc(p.id)}/">${esc(p.name)}</a></h4>
      <span class="meta-badges">${chips(p)} ${badge(p.status)}</span>
    </header>
    <p class="tagline">${esc(p.tagline)}</p>
    ${reach(p)}
    ${p.tags?.length ? `<p class="tags">${tags(p)}</p>` : ""}
    ${projectFooter(p)}
  </article>`;
}

function capabilityCard(c) {
  const required = Object.fromEntries(Object.entries(c.options ?? {}).filter(([, v]) => /^required/.test(v)).map(([k]) => [k, "…"]));
  return `
  <article class="card capability" id="platform-${esc(c.id)}">
    <header>
      <h4><a href="#platform-${esc(c.id)}">${esc(c.name)}</a></h4>
      ${badge(c.status, `Capability status: ${c.status}`)}
    </header>
    <p class="tagline">${esc(c.summary)}</p>
    ${c.public ? `<p class="label">Public surface</p>\n    <code class="endpoint">${esc(c.public)}</code>` : ""}
    <p class="label">A project rents it with</p>
    <pre><code>"uses": { "${esc(c.id)}": ${esc(JSON.stringify(required))} }</code></pre>
    <footer>
      <a href="${esc(site.repo)}/tree/main/platform/${esc(c.id)}">How it works</a>
      <a href="${esc(site.repo)}/blob/main/CONTRACT.md">The contract</a>
      ${c.provides?.length ? `<span class="since">gives ${c.provides.map(esc).join(", ")}</span>` : ""}
    </footer>
  </article>`;
}

// kind › category › projects — only shelves with something on them.
function shelves(listed) {
  const out = [];
  for (const [kind, k] of Object.entries(KINDS)) {
    const cats = Object.entries(CATEGORIES).filter(([c, v]) => v.kind === kind && listed.some((p) => p.category === c && kindOfEntry(p) === kind));
    if (!cats.length) continue;
    out.push(`<section class="layer kind" id="${esc(kind)}">
  <h2>${esc(k.name)} <small>${esc(k.summary)}</small></h2>
${cats.map(([c, v]) => `  <section class="shelf" id="${esc(c)}">
    <h3>${esc(v.name)} <small>${esc(v.test)}</small></h3>
${listed.filter((p) => p.category === c).map(projectCard).join("\n")}
  </section>`).join("\n")}
</section>`);
  }
  return out.join("\n\n");
}

// The page every project gets: the card, expanded, plus the facts Labs knows.
function projectPage(p) {
  const rows = [
    ["Status", `${badge(p.status)} <span class="hint">${esc(STATUS_TEXT[p.status] ?? "")}</span>`],
    ["Kind › category", `${kindcat(p)} <span class="hint">${esc(CATEGORIES[p.category]?.test ?? "")}</span>`],
    ["Met as", Object.entries(p.surfaces ?? {}).map(([s, d]) => `<span class="chip">${esc(s)}</span> <span class="hint">${esc(s === "ai" && AI_FORMATS[d.format] ? `${AI_FORMATS[d.format].name} — runs in ${AI_FORMATS[d.format].hosts}` : SURFACES[s]?.where ?? "")}</span>`).join("<br>")],
    p.tags?.length ? ["Tags", tags(p)] : null,
    ["Started", `<time datetime="${esc(p.started)}">${esc(p.started)}</time>${p.status === "building" ? ` — alpha by <time datetime="${esc(alphaBy(p.started))}">${esc(alphaBy(p.started))}</time>` : ""}`],
    rentsOf(p).length ? ["Rents", rentsOf(p).map((r) => `<a href="/#platform-${esc(r)}">${esc(r)}</a>`).join(", ")] : null,
    p.rented?.mcp ? ["Endpoint", `<code>${esc(p.rented.mcp.endpoint)}</code>`] : null,
    p.install ? ["Import", `<code>${esc(npx)} import ${esc(p.id)}</code>`] : null,
    p.license ? ["License", esc(p.license)] : null,
    p.commit ? ["Deployed", `<code>${esc(p.commit)}</code>${p.deployedAt ? ` on <time datetime="${esc(p.deployedAt)}">${esc(p.deployedAt.slice(0, 10))}</time>` : ""}`] : null,
    ["Source", `<a href="${esc(p.repo)}">${esc(p.repo)}</a>`],
  ].filter(Boolean);
  return shell({
    title: `${p.name} — ${site.name}`,
    description: p.tagline,
    body: `
<header class="masthead">
  <p class="brand"><a href="${esc(site.companyUrl)}">${esc(site.company)}</a> / <a href="/">Labs</a> / ${kindcat(p)} / ${esc(p.id)}</p>
  <h1>${esc(p.name)} ${badge(p.status)}</h1>
  <p class="lede">${esc(p.tagline)}</p>
</header>
<main>
  <article class="card page" id="${esc(p.id)}">
    ${reach(p)}
    ${p.note ? `<p class="label">Note</p>\n    <p class="note">${esc(p.note)}</p>` : ""}
    <dl class="facts">
${rows.map(([k, v]) => `      <dt>${esc(k)}</dt><dd>${v}</dd>`).join("\n")}
    </dl>
    ${projectFooter(p)}
  </article>
</main>`,
  });
}

function shell({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/style.css">
</head>
<body>${body}
<footer class="colophon">
  <p>© ${new Date().getUTCFullYear()} ${esc(site.company)}. Everything here is experimental — read the status before you depend on it.</p>
</footer>
</body>
</html>
`;
}

const all = readRealized();
const listed = all.filter((p) => p.status !== "archived");
const platform = readPlatform();

const indexHtml = shell({
  title: site.name,
  description: site.tagline,
  body: `
<header class="masthead">
  <p class="brand"><a href="${esc(site.companyUrl)}">${esc(site.company)}</a> / Labs</p>
  <h1>${esc(site.name)}</h1>
  <p class="lede">${esc(site.tagline)}</p>
  <p class="meta">MCP index: <code>${esc(site.mcpUrl)}</code> · <a href="${esc(site.repo)}">Source</a> · <a href="${esc(site.repo)}/blob/main/CONTRACT.md">Bring a project</a></p>
</header>

<main>
${listed.length ? shelves(listed) : `<section class="layer"><p class="empty">Nothing listed yet.</p></section>`}

<section class="layer" id="platform">
  <h2>Platform <small>what Labs runs so a small project does not have to — rented by the line, left by changing a variable</small></h2>
${platform.map(capabilityCard).join("\n")}
</section>
</main>

<section class="legend">
  <h2>What the labels mean</h2>
  <dl>
${Object.entries(STATUS_TEXT).map(([k, v]) => `    <dt>${badge(k, "")}</dt><dd>${esc(v)}</dd>`).join("\n")}
  </dl>
</section>`,
});

const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true }); // a project that left must not leave a stale page behind
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), indexHtml);
for (const p of all) {
  mkdirSync(join(dist, p.id), { recursive: true });
  writeFileSync(join(dist, p.id, "index.html"), projectPage(p));
}
for (const f of readdirSync(join(here, "static"))) copyFileSync(join(here, "static", f), join(dist, f));

// The public index — a projection, never the realized entries themselves: nothing
// about this machine (ports, directories, env files) leaves it.
const publicIndex = {
  labs: 1,
  generatedAt: new Date().toISOString(),
  site: { name: site.name, url: site.labsUrl, mcp: site.mcpUrl, repo: site.repo, import: `${npx} import <id>` },
  kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.name])),
  categories: Object.fromEntries(Object.entries(CATEGORIES).map(([c, v]) => [c, { kind: v.kind, name: v.name }])),
  projects: all.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    kind: kindOfEntry(p),
    category: p.category,
    surfaces: p.surfaces ?? {},
    tags: p.tags ?? [],
    license: p.license ?? null,
    status: p.status,
    started: p.started,
    repo: p.repo,
    page: projectUrl(site, p.id),
    links: p.links ?? {},
    note: p.note ?? null,
    mcp: p.rented?.mcp ? { endpoint: p.rented.mcp.endpoint, transport: "streamable-http" } : null,
    install: p.install ?? null,
    commit: p.commit ?? null,
  })),
};
writeFileSync(join(dist, "index.json"), JSON.stringify(publicIndex, null, 2) + "\n");
console.log(`site/dist — ${listed.length} project(s) on ${new Set(listed.map((p) => p.category)).size} shelf(s), ${platform.length} platform capabilit${platform.length === 1 ? "y" : "ies"}; ${all.length} page(s) at ${projectUrl(site, "<id>")}`);
