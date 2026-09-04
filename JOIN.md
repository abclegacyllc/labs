# Joining Labs — instructions for whoever prepares a repository

You are in a repository. It should become an **ABC Legacy Labs** project, **take**
Labs projects into itself, or both. This page is everything you need to do that
without asking anyone: decide from what the repository itself shows, write one
file, validate it, hand two lines back to the owner. The reference behind every
rule here is [CONTRACT.md](CONTRACT.md); read it only if something below is
unclear.

## 0. What you will produce

One folder, one file, at the repository root:

```
abc-labs/
  labs.json
```

Nothing else changes in the code. Never put a secret in it. Never make the code
import anything from `abc-labs/` — the folder is metadata and vendored files, not
a dependency.

## 1. Decide the direction

| If the repository… | then `labs.json` has… |
|---|---|
| is a thing people use — a server, a tool, a skill pack, an asset set, a starter | an **`export`** half |
| wants to take a Labs project into itself (skills, a template, a component) | an **`import`** half |
| both | both |

Most product repositories only `import`. Most Labs projects only `export`.

## 2. The template — copy, then replace every `<…>`

Every `<…>` lists its allowed values or says what to write. Remove the fields
marked *optional* if they do not apply. `kind` and `category` are two fields but
one decision: write both, and they must agree — the validator refuses a pair
that does not (§3).

```json
{
  "labs": 1,

  "export": {
    "id": "<lowercase-id: ^[a-z][a-z0-9-]{1,30}$ — becomes the URL path everywhere, never changes; name WHAT IT IS, never a capability it rents: hello, not hello-mcp>",
    "name": "<Display name — may change later>",
    "tagline": "<One sentence a stranger understands: what it does, not what it is built with>",

    "kind": "<service | resource — service if it DOES work, resource if it IS material; must match the category below>",
    "category": "<exactly one:  service → api | tool | agent | component  ·  resource → knowledge | asset | template  — see §3>",
    "surfaces": {
      "<mcp | ai | import | userscript | extension | app | cli | package | bot | download — see §4, one or more, only what works today>": {}
    },
    "tags": ["<optional: up to 5 lowercase slugs — what it is ABOUT: ux, 3d, telematics>"],
    "license": "<optional: SPDX id — MIT | Apache-2.0 | CC0-1.0 | …>",

    "status": "<building | alpha | beta | graduated | archived — see §5>",
    "started": "<YYYY-MM-DD — first commit date is a fine default>",

    "uses": {
      "<optional: host | mcp — see §6; remove the block if nothing is rented>": {}
    },
    "install": {
      "include": ["<only with an ai or import surface — paths or globs in THIS repo that get copied, see §7>"],
      "link": { "<optional: dest with {name}>": "abc-labs/<id>/{name}" }
    },
    "links": {
      "docs": "<optional: URL of the README or docs>",
      "feedback": "<optional: URL where people report problems — defaults to <repo>/issues>"
    },
    "note": "<optional: shown on the project page; required in spirit when archiving — say why and where to go>"
  },

  "import": {
    "<id of a Labs project that exports an install spec>": "<* for its default branch | a tag | a branch | a commit>"
  }
}
```

## 3. Choose `kind`, then `category`

Both go in the file, and they must agree — one is the shelf, the other the role
on it. Decide in this order.

**Step A — which `kind`?** One question: *does it do work, or is it material?*

| `kind` | if… | examples |
|---|---|---|
| `service` | it **does work**. Running, called, operated, embedded — something happens because of it | a server, an inspector, a worker, a 3D engine |
| `resource` | it **is material**. It does nothing by itself; someone or something else uses it | skills, icons, datasets, a starter repo |

The test that settles most cases: *if nobody and nothing runs it, does anything
happen?* No → `resource`.

**Step B — which `category` inside that kind?** Ask the questions in order and
take the first "yes". The category says what a project that *takes* this one
**gets**.

| `kind` | `category` | Say **yes** if… | Then the surfaces may be |
|---|---|---|---|
| `service` | `api` | you send it a request and get a result back, without owning how it is done | `mcp` `app` `cli` `package` `bot` |
| `service` | `tool` | you operate it yourself to do your own work faster | `userscript` `extension` `app` `cli` `package` `mcp` |
| `service` | `agent` | you hand it a goal and it works out the steps on its own | `mcp` `app` `cli` `package` `bot` |
| `service` | `component` | it becomes a part of your product (a UI component, a library, a 3D engine) | `package` `import` |
| `resource` | `knowledge` | it makes you — or your agent — *know* something: how, what, why (skills, playbooks, specs, courses) | `ai` `import` `download` |
| `resource` | `asset` | you take material and use it as it is; it does nothing by itself (icons, fonts, tokens, datasets, models) | `download` `import` `package` |
| `resource` | `template` | you start your own thing from it | `import` `app` `download` |

Three rules. **The pair must match** — `"kind": "resource"` with
`"category": "tool"` is refused, and the error names which half to change.
**One category**, the one most people would name; a bundle (tokens + components
+ docs) picks a primary and tags the rest, or becomes several projects. **The
channel does not change either field**: a UI inspector is a `service`/`tool`
whether it arrives as a userscript or, one day, over MCP.

A worked pair, because it is the one people get wrong: a pack of AI skills is
`resource`/`knowledge`, not a service — the skills do nothing on their own; the
AI that reads them is the thing that works. It is *met* through the `ai`
surface (§4), which is where the AI comes in.

## 4. Choose `surfaces` — where a stranger meets it, with what they need

List every surface that **works today**; a planned one is a sentence in the
README, not an entry. Surface and link URLs must be absolute HTTPS URLs (no
`javascript:`, `data:`, local files, credentials or control characters). Each
surface is a key with the fields shown:

| surface | where | write |
|---|---|---|
| `mcp` | an AI client connects over MCP | `{}` — and rent `mcp` in `uses` (§6) |
| `ai` | an AI reads it — skills, rules, prompt packs | `{ "format": "<see the formats table below>" }` — and fill `install` (§7) |
| `import` | `abc-labs/<id>/` in the taking repository | `{}` — and fill `install` (§7) |
| `userscript` | the browser, via Tampermonkey | `{ "url": "<install URL of the .user.js>" }` |
| `extension` | inside another application | `{ "url": "<install URL>", "host": "<chrome \| firefox \| figma \| vscode \| …>" }` |
| `app` | an application you open | `{ "url": "<URL>", "platform": "<optional: web \| ios \| android \| desktop>" }` |
| `cli` | a terminal | `{ "command": "<one line that installs or runs it>" }` |
| `package` | a package registry | `{ "command": "<npm i … \| pip install … \| docker pull …>", "registry": "<optional: npm \| pip \| docker \| actions>" }` |
| `bot` | a chat | `{ "url": "<t.me/… or the invite URL>" }` |
| `download` | a file you fetch | `{ "url": "<URL of the file or archive>" }` |

No other fields exist on a surface; the validator refuses unknown ones. Where
people meet you is always a surface — there is no `links.url`.

**The `ai` surface declares a format, never a host.** Which assistants read a
format is a fact about the ecosystem, and Labs keeps it — so your manifest does
not go stale when a new client adds support:

| `format` | what it is | Labs shows it as running in |
|---|---|---|
| `agent-skill` | Agent Skills — a folder with `SKILL.md` | Claude Code, claude.ai and the Claude API |
| `agents-md` | an `AGENTS.md` file | any agent that reads AGENTS.md |
| `cursor-rules` | Cursor rule files | Cursor |
| `prompt` | a pack of prompts | any assistant — pasted or referenced |

Your format missing? Open an issue on the Labs repository — it is one line
there, not a field in your file.

## 5. Choose `status`

| | |
|---|---|
| `building` | not usable by an outsider yet. The clock runs: 14 days from `started` to `alpha`, or archived |
| `alpha` | an outsider can use it; may break, change, vanish |
| `beta` | shape is stable; breaking changes get a deprecation window |
| `graduated` | left Labs for a home of its own; endpoints keep working |
| `archived` | retired; `mcp` answers `410 Gone` and points at `note` |

A repository that already ships to real users is `beta`, not `building`.

## 6. `uses` — rent a platform capability only if you need it

| rent | when | you receive |
|---|---|---|
| `host` | Labs should **run your process** on its server | `PORT`, `HOST` (`127.0.0.1`), `LABS_ID`, `NODE_ENV` — listen on `$HOST:$PORT` |
| `mcp` | you have an `mcp` surface | `MCP_PATH` (`/<id>` — serve the MCP endpoint **at this path**), `MCP_PUBLIC_URL` |

```json
"uses": {
  "host": { "install": "<optional: e.g. npm ci --omit=dev>", "start": "<required: e.g. node server.mjs>" },
  "mcp": {}
}
```

Served somewhere else already? `"mcp": { "upstream": "https://<your host>" }` and
no `host`. The upstream must be an external HTTPS host; private/loopback hosts
are rejected. A userscript, a skill pack, a dataset rent nothing — omit `uses`.

## 7. `install` — only with an `ai` or `import` surface

```json
"install": {
  "include": ["<path or glob in this repo>", "<'*' within a segment, '**' across; a matched directory is copied whole>"],
  "link":    { "<dest in the taking repo, {name} = each copied top-level entry>": "abc-labs/<id>/{name}" }
}
```

**Match folders, not the files inside them.** A matched folder travels whole —
`SKILL.md` *and* whatever sits next to it (`references/`, `tools/`, data). A glob
like `ux-*/SKILL.md` looks right and silently strips all of that. The validator
(§8) prints what your globs match and how many files travel; read that list and
make sure every nested resource is in it.

For an Agent Skills pack (`"ai": { "format": "agent-skill" }`) the link is almost
always `".claude/skills/{name}": "abc-labs/<id>/{name}"` — that is where Claude
Code looks; a claude.ai user uploads the same folder by hand. Sources must point inside
`abc-labs/<id>/`; an existing real file at a destination is never overwritten.

## 8. Validate — do not skip

From the repository root, with node ≥ 22:

```bash
npx github:abclegacyllc/labs export
```

Where the Labs repository is already on the machine — or has not been published
yet — the same check is `node <labs>/bin/labs.mjs export abc-labs/labs.json`,
run from anywhere.

Read every line it prints and fix the file until it says `valid`. Read the
summary line too: it names the kind, category and surfaces it understood, and
that is your last chance to notice it understood something you did not mean.
With an `install` block it also lists what your globs would hand an importer —
entries and file counts — and warns when the globs match files instead of their
folders.

**Where to run this.** JOIN.md, the validator and the Labs checkout live
together. If you are working *on the Labs server*, in the repository's own
checkout, everything above works as written. If you are somewhere else — a
claude.ai session, another machine — you cannot read `/home/…/labs/` and cannot
run its validator: either do the work from a Claude Code session on that server,
or wait until Labs is published and use the raw GitHub URL of this file and
`npx github:abclegacyllc/labs export`. Do not guess the tables from memory. It knows
things this page cannot repeat for every case (category ⇄ surface fit, `mcp` ⇄
`uses.mcp`, `install` ⇄ `ai`/`import`, field types).

## 9. Hand back

Commit `abc-labs/labs.json`. Then give the owner exactly this:

1. **For an `export`**: the one line for Labs's `registry.json` —
   `{ "id": "<id>", "repo": "<https://github.com/<owner>/<repo>>" }` — with a
   note that it goes in *after* the repository is public. Labs then runs
   `labs sync`; the card, the page at `labs.abclegacyllc.com/<id>` and the entry
   in `index.json` appear by themselves. If `host` is rented, the owner also runs
   `labs deploy <id>` on the Labs server.
2. **For an `import`**: nothing to hand back — run
   `npx github:abclegacyllc/labs import <id>` here, commit what lands in
   `abc-labs/` (the files, `labs.json`, `labs.lock.json`) and any links it made.

## Self-check before you finish

- [ ] `abc-labs/labs.json` is the only Labs-related change; no secrets in it
- [ ] `id` is lowercase, stable, and names what the project *is*
- [ ] `kind` and `category` agree (§3); exactly one category; every listed surface is allowed for it (§3, last column)
- [ ] every surface works today and carries its fields
- [ ] `mcp` surface ⇄ `uses.mcp`; `ai`/`import` surface ⇄ `install` — both present or both absent
- [ ] no `links.url`, no `run` (both were removed from the contract)
- [ ] `status` reflects reality; `started` is a real date
- [ ] `npx github:abclegacyllc/labs export` says `valid`

## Never

Never leave `kind` and `category` disagreeing — fix the file, not the error.
Never list a surface that is not live. Never name the project after a capability
(`-mcp`, `-skill`). Never make the code depend on
Labs being up — capabilities arrive as environment variables, imports as files
you own. Never add the repository to `registry.json` yourself; that is the
owner's pull request, after the repo exists.
