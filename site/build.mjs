// Renders labs.abclegacyllc.com from two sources and nothing else:
//   var/projects/*/realized.json the projects — what `labs sync` / `labs deploy` made true
//   platform/*/capability.json   the platform — what Labs runs for projects
//
//   node site/build.mjs   (usually via `labs render`)
//     → site/dist/index.html          the catalog
//     → site/dist/<id>/index.html     one page per listed project, archived ones included —
//                                     it is where a 410 from the gateway sends people
//     → site/dist/index.json          the public, machine-readable index: what `labs import`
//                                     resolves an id against. No ports, no paths on disk.
//
// The page is written for a stranger, not for us: one obvious action per project,
// the taxonomy carried as a quiet label rather than as headings and essays. The
// vocabulary of the contract — rents, capabilities, surfaces — belongs in the
// documentation; a visitor gets "Install", "Connect", "Import".
//
// Zero dependencies on purpose. Edit the sources or this file — never dist/.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_FORMATS, CATEGORIES, KINDS, LABS_DIR, STATUS_TEXT, SURFACES, alphaBy, kindOf, npxCommand, overdue, projectUrl, readPlatform,
  readRealized, site as readSite, tierOf,
} from "../lib/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = readSite();
const npx = npxCommand(site);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kindOfEntry = (p) => p.kind ?? kindOf(p.category); // written since the kind field became required; derived for anything older
const status = (s) => `<span class="status status-${esc(s)}" title="${esc(STATUS_TEXT[s] ?? "")}">${esc(s)}</span>`;
const importCmd = (p) => `${npx} import ${p.id}`;

// What a visitor does with each surface: a link they can click, or a command
// they can copy. One shape per surface, so a card never has to explain itself.
function affordance(p, name, def) {
  const spec = SURFACES[name] ?? {};
  const label = spec.action ?? name;
  switch (name) {
    case "mcp": return p.rented?.mcp ? { kind: "cmd", label, cmd: `claude mcp add --transport http abc-${p.id} ${p.rented.mcp.endpoint}`, note: `Or paste <code>${esc(p.rented.mcp.endpoint)}</code> into Claude.ai → Connectors.` } : null;
    case "ai": {
      const fmt = AI_FORMATS[def.format];
      return { kind: "cmd", label, cmd: importCmd(p), note: fmt ? `${esc(fmt.name)} — runs in ${esc(fmt.hosts)}.` : "" };
    }
    case "import": return { kind: "cmd", label, cmd: importCmd(p), note: `Lands in <code>${esc(LABS_DIR)}/${esc(p.id)}/</code>, pinned in <code>${esc(LABS_DIR)}/labs.lock.json</code>.` };
    case "cli":
    case "package": return { kind: "cmd", label, cmd: def.command, note: def.registry ? `From ${esc(def.registry)}.` : "" };
    case "extension": return { kind: "link", label: `${label}${def.host ? ` for ${def.host}` : ""}`, href: def.url };
    // A project renting `web` writes no URL: Labs assigns the origin, so the
    // card and the page take it from what was actually provisioned.
    case "app": {
      const href = def.url ?? p.rented?.web?.origin;
      return href ? { kind: "link", label: def.platform && def.platform !== "web" ? `${label} (${def.platform})` : label, href } : null;
    }
    default: return def.url ? { kind: "link", label, href: def.url } : null;
  }
}
const affordances = (p) => Object.keys(SURFACES)
  .filter((s) => p.surfaces?.[s])
  // `ai` and `import` are one act — files vendored into abc-labs/<id>/ — plus one
  // extra fact: which AI reads them. Both would print the same command twice.
  .filter((s) => !(s === "import" && p.surfaces.ai))
  .map((s) => affordance(p, s, p.surfaces[s]))
  .filter(Boolean);

const copyBtn = (cmd, label) => `<div class="cmd"><code>${esc(cmd)}</code><button type="button" data-copy="${esc(cmd)}" aria-label="Copy: ${esc(label)}">Copy</button></div>`;

// ── the catalog card ─────────────────────────────────────────────────────────
function projectCard(p) {
  const acts = affordances(p);
  const links = acts.filter((a) => a.kind === "link");
  const cmd = acts.find((a) => a.kind === "cmd");
  const late = overdue(p);
  return `
      <article class="card" id="${esc(p.id)}" data-kind="${esc(kindOfEntry(p))}" data-category="${esc(p.category)}" data-tags="${esc((p.tags ?? []).join(" "))}" data-text="${esc([p.name, p.tagline, p.id, CATEGORIES[p.category]?.one, ...(p.tags ?? [])].join(" ").toLowerCase())}">
        <div class="card-top">
          <div>
            <h3><a href="/${esc(p.id)}/">${esc(p.name)}</a></h3>
            <p class="role">${esc(CATEGORIES[p.category]?.one ?? p.category)}</p>
          </div>
          ${status(p.status)}
        </div>
        <p class="tagline">${esc(p.tagline)}</p>
        ${p.status === "building"
          ? `<p class="role${late ? " overdue" : ""}">${late ? "Overdue —" : "Not ready yet —"} due <time datetime="${esc(alphaBy(p.started))}">${esc(alphaBy(p.started))}</time>.</p>`
          : cmd ? `${copyBtn(cmd.cmd, cmd.label)}${cmd.note ? `<p class="role">${cmd.note}</p>` : ""}` : ""}
        ${links.length ? `<div class="actions">${links.map((a, i) => `<a class="btn ${i === 0 && !cmd ? "btn-primary" : "btn-quiet"}" href="${esc(a.href)}">${esc(a.label)}</a>`).join("")}</div>` : ""}
        ${p.tags?.length ? `<div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="card-foot">
          <a href="/${esc(p.id)}/">Details</a>
          <a href="${esc(p.repo)}">Source</a>
          ${p.links?.docs ? `<a href="${esc(p.links.docs)}">Docs</a>` : ""}
          <span class="spacer">since <time datetime="${esc(p.started)}">${esc(p.started)}</time></span>
        </div>
      </article>`;
}

// ── the project page ─────────────────────────────────────────────────────────
function whereBlock(p, name, def) {
  const a = affordance(p, name, def);
  const spec = SURFACES[name] ?? {};
  if (!a) return "";
  const body = a.kind === "cmd" ? copyBtn(a.cmd, a.label) : `<div class="actions"><a class="btn btn-primary" href="${esc(a.href)}">${esc(a.label)}</a></div>`;
  return `<div class="where">
          <p class="label">${esc(a.label)}</p>
          ${body}
          <p class="hint">${a.note || esc(spec.where ?? "")}</p>
        </div>`;
}

function projectPage(p) {
  const rows = [
    ["Status", `${status(p.status)} <span class="hint">${esc(STATUS_TEXT[p.status] ?? "")}</span>`],
    ["What it is", `${esc(CATEGORIES[p.category]?.one ?? p.category)} — ${esc(CATEGORIES[p.category]?.test ?? "")}`],
    p.tags?.length ? ["Tags", `<div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`] : null,
    ["Started", `<time datetime="${esc(p.started)}">${esc(p.started)}</time>${p.status === "building" ? ` — due <time datetime="${esc(alphaBy(p.started))}">${esc(alphaBy(p.started))}</time>` : ""}`],
    p.rented?.web ? ["Live at", `<a href="${esc(p.rented.web.origin)}">${esc(p.rented.web.origin.replace(/^https:\/\//, ""))}</a>`] : null,
    p.rented?.mcp ? ["Endpoint", `<code>${esc(p.rented.mcp.endpoint)}</code>`] : null,
    p.rented?.mcp && !tierOf(p).unlimited ? ["Rate limit", `${tierOf(p).client.rpm}/min per caller, ${tierOf(p).concurrent.client} at once`] : null,
    Object.keys(p.rented ?? {}).length ? ["Runs on", Object.keys(p.rented).map((r) => `<a href="/#platform-${esc(r)}">${esc(r)}</a>`).join(", ")] : null,
    p.license ? ["License", esc(p.license)] : null,
    p.commit ? ["Deployed", `<code>${esc(p.commit)}</code>${p.deployedAt ? ` on <time datetime="${esc(p.deployedAt)}">${esc(p.deployedAt.slice(0, 10))}</time>` : ""}`] : null,
    ["Source", `<a href="${esc(p.repo)}">${esc(p.repo.replace(/^https:\/\//, ""))}</a>`],
    ["Feedback", `<a href="${esc(p.links?.feedback ?? `${p.repo}/issues`)}">Report something</a>`],
  ].filter(Boolean);

  const wheres = Object.keys(SURFACES).filter((s) => p.surfaces?.[s] && !(s === "import" && p.surfaces.ai))
    .map((s) => whereBlock(p, s, p.surfaces[s])).join("\n        ");

  return shell({
    here: "projects",
    title: `${p.name} — ${site.name}`,
    description: p.tagline,
    body: `
    <header class="page-hero wrap">
      <p class="eyebrow"><a href="${esc(site.companyUrl)}">${esc(site.company)}</a><span class="sep">/</span><a href="/">Labs</a><span class="sep">/</span>${esc(p.id)}</p>
      <h1>${esc(p.name)}</h1>
      <p class="lede">${esc(p.tagline)}</p>
    </header>
    <main class="wrap">
      ${p.status === "archived" ? `<div class="panel"><h2>Retired</h2><p class="note">${p.note ? esc(p.note) : "This project has been archived. Its endpoint answers 410 Gone."}</p></div>` : ""}
      ${p.status === "building"
        ? `<div class="panel"><h2>Not ready yet</h2><p class="note">${overdue(p) ? "Overdue." : "Due"} <time datetime="${esc(alphaBy(p.started))}">${esc(alphaBy(p.started))}</time> — fourteen days from the day it started.</p></div>`
        : wheres ? `<div class="panel"><h2>How to use it</h2>\n        ${wheres}\n      </div>` : ""}
      ${p.note && p.status !== "archived" ? `<div class="panel"><h2>Note</h2><p class="note">${esc(p.note)}</p></div>` : ""}
      <div class="panel"><h2>Facts</h2>
        <dl class="facts">
${rows.map(([k, v]) => `          <dt>${esc(k)}</dt><dd>${v}</dd>`).join("\n")}
        </dl>
      </div>
    </main>`,
  });
}

function capabilityCard(c) {
  const required = Object.fromEntries(Object.entries(c.options ?? {}).filter(([, v]) => /^required/.test(v)).map(([k]) => [k, "…"]));
  return `
      <article class="cap" id="platform-${esc(c.id)}">
        <h3>${esc(c.name)} ${status(c.status)}</h3>
        <p>${esc(c.summary)}</p>
        <p class="rent">A project rents it with <code>"uses": { "${esc(c.id)}": ${esc(JSON.stringify(required))} }</code></p>
      </article>`;
}

const topbar = (here = "") => `
    <div class="topbar">
      <nav class="wrap">
        <a class="wordmark" href="/"><span>${esc(site.company)}</span> Labs</a>
        <span class="topbar-links">
          <a href="/#projects"${here === "projects" ? ' aria-current="page"' : ""}>Projects</a>
          <a href="/#platform"${here === "platform" ? ' aria-current="page"' : ""}>Platform</a>
          <a href="${esc(site.repo)}/blob/main/JOIN.md">Bring a project</a>
          <a href="${esc(site.repo)}">Source</a>
        </span>
      </nav>
    </div>`;

function shell({ title, description, body, here }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Space+Grotesk:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css">
<script>document.documentElement.className = "js";</script>
</head>
<body>${topbar(here)}${body}
<footer class="colophon wrap">
  <p>© ${new Date().getUTCFullYear()} <a href="${esc(site.companyUrl)}">${esc(site.company)}</a> · <a href="${esc(site.repo)}">Source</a> · <a href="${esc(site.feedback)}">Feedback</a></p>
  <p>Everything here is an experiment. Read the status before you depend on it.</p>
</footer>
<script>
// Copy buttons. The command is already on the page, so this is a convenience,
// not a dependency: with JavaScript off the text is still selectable.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => {
    const was = b.textContent;
    b.textContent = "Copied"; b.dataset.copied = "1";
    setTimeout(() => { b.textContent = was; delete b.dataset.copied; }, 1400);
  });
});

// Filtering. It lives in the URL, so a filtered view can be linked and the back
// button undoes a click. Nothing is fetched and nothing is rendered: the cards
// are already on the page and this only hides them.
(() => {
  const q = document.getElementById("q");
  if (!q) return;
  const chips = document.getElementById("chips");
  const count = document.getElementById("count");
  const noMatch = document.getElementById("no-match");
  const cards = [...document.querySelectorAll(".card[data-kind]")];
  const sections = [...document.querySelectorAll(".section[id]")].filter((s) => s.querySelector(".card[data-kind]"));
  let state = { text: "", kind: "", tag: "" };

  const apply = (push) => {
    const text = state.text.trim().toLowerCase();
    let shown = 0;
    for (const c of cards) {
      const ok = (!text || c.dataset.text.includes(text))
        && (!state.kind || c.dataset.kind === state.kind)
        && (!state.tag || c.dataset.tags.split(" ").includes(state.tag));
      c.hidden = !ok;
      if (ok) shown++;
    }
    for (const s of sections) s.hidden = !s.querySelector(".card[data-kind]:not([hidden])");
    const filtered = text || state.kind || state.tag;
    count.textContent = filtered ? shown + " of " + cards.length : "";
    noMatch.hidden = shown > 0;
    for (const b of chips.querySelectorAll(".chip-btn")) {
      const on = b.dataset.filter === "all" ? !state.kind && !state.tag
        : b.dataset.filter === "kind" ? state.kind === b.dataset.value : state.tag === b.dataset.value;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    if (push) {
      const u = new URL(location.href);
      for (const [k, v] of Object.entries({ q: text, kind: state.kind, tag: state.tag })) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
      history.replaceState(null, "", u);
    }
  };

  const read = () => {
    const u = new URLSearchParams(location.search);
    state = { text: u.get("q") ?? "", kind: u.get("kind") ?? "", tag: u.get("tag") ?? "" };
    q.value = state.text;
    apply(false);
  };

  q.addEventListener("input", () => { state.text = q.value; apply(true); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    if (b.dataset.filter === "all") state = { text: state.text, kind: "", tag: "" };
    // A second click on the same chip is how you take a filter off again.
    else if (b.dataset.filter === "kind") state.kind = state.kind === b.dataset.value ? "" : b.dataset.value;
    else if (b.dataset.filter === "tag") state.tag = state.tag === b.dataset.value ? "" : b.dataset.value;
    apply(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    if (e.key === "Escape" && document.activeElement === q) { q.value = ""; state.text = ""; apply(true); q.blur(); }
  });
  window.addEventListener("popstate", read);
  read();
})();
</script>
</body>
</html>
`;
}

const all = readRealized();
const listed = all.filter((p) => p.status !== "archived");
const platform = readPlatform();

// Grouped by kind, because that is the difference a visitor feels: something
// that does work, or something you take. The category rides along on the card.
const sections = Object.entries(KINDS)
  .map(([kind, k]) => [kind, k, listed.filter((p) => kindOfEntry(p) === kind)])
  .filter(([, , ps]) => ps.length)
  .map(([kind, k, ps]) => `
    <section class="section" id="${esc(kind)}">
      <div class="section-head"><h2>${esc(k.name)}</h2><p>${esc(k.summary)}</p></div>
      <div class="grid">${ps.map(projectCard).join("")}
      </div>
    </section>`).join("");

// The filter row describes the catalogue as it is, not a list someone has to
// remember to update. A tag earns a chip only once more than one project carries
// it — a filter that can only ever return one card is a button, not a filter —
// and the row is capped so it stays a row.
const tagCounts = new Map();
for (const p of listed) for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
const tags = [...tagCounts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t]) => t);

// Controls, not decoration: they are hidden unless JavaScript is running, so a
// page without it shows every project rather than a row of dead buttons.
const filters = `
      <div class="filters" role="search">
        <label class="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="q" placeholder="Search experiments" autocomplete="off" aria-label="Search experiments">
          <kbd>/</kbd>
        </label>
        <div class="chips" id="chips">
          <button type="button" class="chip-btn is-on" data-filter="all">All</button>
${Object.entries(KINDS).filter(([k]) => listed.some((p) => kindOfEntry(p) === k)).map(([k, v]) => `          <button type="button" class="chip-btn" data-filter="kind" data-value="${esc(k)}">${esc(v.name)}</button>`).join("\n")}
${tags.map((t) => `          <button type="button" class="chip-btn chip-tag" data-filter="tag" data-value="${esc(t)}">${esc(t)}</button>`).join("\n")}
        </div>
        <p class="count" id="count" aria-live="polite"></p>
      </div>`;

const indexHtml = shell({
  here: "projects",
  title: `${site.name} — experiments from ${site.company}`,
  description: site.tagline,
  body: `
    <header class="masthead wrap">
      <p class="eyebrow"><a href="${esc(site.companyUrl)}">${esc(site.company)}</a><span class="sep">/</span>Labs</p>
      <h1>${esc(site.name)}</h1>
      <p class="lede">Small tools we build for our own work, released early and kept in the open — each one either grows up or is shut down within weeks.</p>
      <div class="masthead-meta">
        <span>MCP index <code>${esc(site.mcpUrl)}</code></span>
        <a href="${esc(site.repo)}">Source</a>
        <a href="${esc(site.repo)}/blob/main/JOIN.md">Bring a project</a>
      </div>
    </header>
    <main class="wrap" id="projects">
${listed.length ? filters : ""}
${sections || `      <p class="empty">Nothing listed yet.</p>`}
      <p class="empty" id="no-match" hidden>Nothing matches. <button type="button" class="btn btn-quiet" data-filter="all">Clear filters</button></p>

      <section class="section" id="platform">
        <div class="section-head"><h2>What Labs runs</h2><p>So a small project does not have to</p></div>
        <div class="platform">${platform.map(capabilityCard).join("")}
        </div>
      </section>

      <section class="legend">
        <div class="section-head"><h2>What the labels mean</h2></div>
        <dl>
${Object.entries(STATUS_TEXT).map(([k, v]) => `          <dt>${status(k)}</dt><dd>${esc(v)}</dd>`).join("\n")}
        </dl>
      </section>
    </main>`,
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
console.log(`site/dist — ${listed.length} project(s) in ${sections ? new Set(listed.map(kindOfEntry)).size : 0} section(s), ${platform.length} platform capabilit${platform.length === 1 ? "y" : "ies"}; ${all.length} page(s)`);
