// Two jobs, both run by `npm run check`.
//
// 1. Drift. The option lists live in lib/registry.mjs. The two documents that
//    repeat them for readers — JOIN.md (the procedure) and CONTRACT.md (the
//    reference) — must name every kind, category, surface and status, or an
//    agent following them will guess at the one that is missing.
//
// 2. Form. A malformed table or a dead link is a document that lies to whoever
//    reads it — and most readers here are agents that cannot see it is broken.
//    Every .md in the repository is checked: table rows all the same width,
//    relative links resolving to something, fenced JSON parsing (placeholder
//    examples excepted — they are templates, not data).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { AI_FORMATS, CATEGORIES, KINDS, LABS_FILES, ROOT, STATUSES, SURFACES } from "../lib/registry.mjs";

const problems = [];
const note = (file, line, msg) => problems.push(`${relative(ROOT, file)}${line ? `:${line}` : ""} — ${msg}`);

function markdownFiles(dir = ROOT) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "var" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownFiles(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

// ── 1. drift ────────────────────────────────────────────────────────────────
for (const doc of ["JOIN.md", "CONTRACT.md"]) {
  const text = readFileSync(join(ROOT, doc), "utf8");
  for (const [what, words] of [["kind", Object.keys(KINDS)], ["category", Object.keys(CATEGORIES)], ["surface", Object.keys(SURFACES)], ["ai format", Object.keys(AI_FORMATS)], ["status", STATUSES]]) {
    for (const w of words) if (!new RegExp(`\\b${w}\\b`).test(text)) note(join(ROOT, doc), 0, `${what} "${w}" is never mentioned`);
  }
  // The fixed file names Labs reads from abc-labs/ — an author must be able to find them.
  for (const f of [LABS_FILES.readme, LABS_FILES.changelog, ...LABS_FILES.icons]) if (!text.includes(f)) note(join(ROOT, doc), 0, `abc-labs file "${f}" is never mentioned`);
}

// ── 2. form ─────────────────────────────────────────────────────────────────
const cells = (row) => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;

for (const file of markdownFiles()) {
  const lines = readFileSync(file, "utf8").split("\n");
  let fence = null, table = null, json = null;

  lines.forEach((line, i) => {
    const no = i + 1;
    const fenceMatch = line.match(/^\s*```(\w*)/);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1];
        if (fence === "json") json = { start: no, text: [] };
      } else {
        // A fenced JSON block that is real data must parse. One with <…> placeholders
        // is a template — checked by eye and by `labs export` on the examples instead.
        if (json && !json.text.join("\n").includes("<")) {
          // A block may be a whole document or a fragment of one ("export": { … }).
          // Both must be syntactically sound; only the outer braces are optional.
          const text = json.text.join("\n");
          let ok = true;
          try { JSON.parse(text); } catch { try { JSON.parse(`{${text}}`); } catch (e) { ok = false; note(file, json.start, `fenced json does not parse, whole or as a fragment: ${e.message}`); } }
          void ok;
        }
        fence = null; json = null;
      }
      return;
    }
    if (json) { json.text.push(line); return; }
    if (fence !== null) return;

    if (/^\s*\|/.test(line)) {
      const width = cells(line);
      if (!table) table = { start: no, width, rows: 1, sep: false };
      else {
        table.rows++;
        if (/^[\s|:-]+$/.test(line)) table.sep = true;
        if (width !== table.width) note(file, no, `table row has ${width} cells, the header has ${table.width}`);
      }
    } else if (table) {
      if (!table.sep) note(file, table.start, `table has no |---| separator row`);
      table = null;
    }

    for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = decodeURI(target.split("#")[0]);
      if (!path) continue;
      const abs = path.startsWith("/") ? join(ROOT, path) : resolve(dirname(file), path);
      if (!existsSync(abs)) note(file, no, `link target does not exist: ${target}`);
    }
  });
  if (table && !table.sep) note(file, table.start, `table has no |---| separator row`);
}

// ── every .json in the repository is data and must parse ────────────────────
function jsonFiles(dir = ROOT) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "var" || e.name === "dist" || e.name === "package-lock.json") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonFiles(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}
for (const file of jsonFiles()) {
  try { JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { note(file, 0, `does not parse: ${e.message}`); }
}

if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("docs: every kind, category, surface, ai format, status and abc-labs file named; tables, links and json well formed");
