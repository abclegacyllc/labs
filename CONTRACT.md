# The contract — a repository and Labs

> Preparing a repository right now? [JOIN.md](JOIN.md) is the procedure — a
> template with every allowed value, the decisions, the validate command. This
> page is the reference behind it.

Labs has two layers. The **platform** is Labs's own — capabilities run for
everyone, rented by the line. **Projects** are guests: your repository, your
release cycle, your rules. And Labs has two directions: a repository can
**export** — be listed as a Labs project, rent capabilities — and **import** —
take Labs projects into itself. Both live in one folder, `abc-labs/`, and one
file, `abc-labs/labs.json`.

## The `abc-labs/` folder

Everything about Labs inside a repository lives here, so the boundary is visible
at a glance — *this is the Labs integration; the rest is the project*:

```
<your repo>/
  abc-labs/
    labs.json        written by you:  "export" — what this repo gives Labs
                                      "import" — what it takes from Labs
    README.md        optional — rendered on your project page as "About"
    CHANGELOG.md     optional — its newest section is shown as "What's new"
    icon.svg|png     optional — your icon, ≤ 64 KB, served as an <img>
    labs.lock.json   written by the CLI: the exact commit behind every import
    <id>/            files of each imported project
  src/ …             the project itself
```

Labs reads **this folder and nothing else** in your repository, and only by these
fixed names — never a path your manifest points at. That is what keeps Labs from
learning your layout: reorganise the rest of the repo and nothing here notices.

Four rules keep the folder from becoming a dependency:

1. **One path, no fallback.** Labs reads `abc-labs/labs.json` and nothing else —
   not the repo root, not a second location. Two places would be two truths.
2. **Metadata and vendored files, never a runtime link.** Your code does not
   import from `abc-labs/` anything that ties it to Labs being up. Imported
   projects are *copies you own*; your only live link to Labs is the environment
   variables a rented capability hands you — so leaving stays a config change.
3. **Labs never commits into your repository.** The CLI runs on *your* machine
   and writes only inside `abc-labs/` (plus the links an import declares); on
   the server Labs writes only into its own `var/`.
4. **The folder is a marker.** Its presence says "this repository gives to Labs,
   takes from Labs, or both".

## `abc-labs/labs.json`

Two halves, at least one present. `labs` is the contract version, always `1`.

```json
{
  "labs": 1,
  "export": { … what this repo gives Labs … },
  "import": { "<id>": "<git ref or *>", … }
}
```

Three shapes, worked out in [docs/examples/](docs/examples/README.md): a hosted
MCP project that also imports (`hello`), a skill pack others import (`toolkit`),
and a plain repository that only imports (`consumer` — not a Labs project at all).

Check it: `npx github:abclegacyllc/labs export` from your repository root (or
`bin/labs export` in a Labs checkout).

## `export` — being a Labs project

```json
"export": {
  "id": "hello",
  "name": "Hello",
  "tagline": "One sentence a stranger understands.",
  "kind": "service",
  "category": "api",
  "surfaces": { "mcp": {} },
  "tags": ["design", "svg"],
  "license": "MIT",
  "status": "building",
  "started": "2026-09-01",
  "uses": { "host": { "install": "npm ci --omit=dev", "start": "node server.mjs" }, "mcp": {} },
  "links": { "docs": "…", "feedback": "…" },
  "note": "…"
}
```

| Field | | |
|---|---|---|
| `id` | required | `^[a-z][a-z0-9-]{1,30}$`; your URL path on every host and your folder name in every importing repo, so it never changes. Name the project for **what it is**, never for a capability it rents: `hello`, not `hello-mcp` |
| `name`, `tagline` | required | what the card shows; the name may change, the id may not |
| `kind` | required | `service` (it does work) or `resource` (it is material) — must agree with `category`. Below |
| `category` | required | one of seven — *what does the taking project get?* Below |
| `surfaces` | required | one or more — *where is it met?* Below |
| `tags` | optional | up to five lowercase slugs — *what is it about?* `ux`, `3d`, `telematics` |
| `license` | optional | an SPDX identifier: `MIT`, `Apache-2.0`, `CC0-1.0` |
| `version` | optional | the version that is live, `1.2.3`-shaped. Have your release script write it; Labs shows it, never bumps it |
| `requires` | optional | up to eight short phrases a user needs first — `["Tampermonkey", "Chrome or Edge"]` |
| `status` | required | `building` · `alpha` · `beta` · `graduated` · `archived` — you set it, Labs enforces the clock |
| `started` | required | `YYYY-MM-DD`; `alphaBy` is computed as `started + 14 days` |
| `uses` | optional | platform capabilities you rent, keyed by id — [platform/](platform/README.md) |
| `install` | optional | what an importing repository receives — below |
| `links` | optional | `docs`, `feedback`. Where people *meet* you is a surface, not a link |
| `note` | optional | shown on your page; when you archive, the `410` sends people here — say why, and where to go |

### The three axes

**`kind` — does it do work, or is it material?** Two answers, and every project is
one of them:

| `kind` | | the test |
|---|---|---|
| `service` | *does work* | Running, called, operated, embedded — something happens because of it |
| `resource` | *is material* | It does nothing by itself; someone or something else uses it |

**`category` — what does a project that takes you *get*?** Seven answers, each
belonging to one kind. Both fields are written, and a pair that disagrees is
refused — the error names which half to change:

| kind | | `category` | the test | met as |
|---|---|---|---|---|
| **service** | *does work* | `api` | You send a request and get a result, without owning how | `mcp` `app` `cli` `package` `bot` |
| | | `tool` | You operate it yourself to do your own work faster | `userscript` `extension` `app` `cli` `package` `mcp` |
| | | `agent` | You hand it a goal; it works out the steps | `mcp` `app` `cli` `package` `bot` |
| | | `component` | It becomes a part of your product | `package` `import` |
| **resource** | *is material* | `knowledge` | It makes you, or your agent, know something: how, what, why | `ai` `import` `download` |
| | | `asset` | Material you take and use as it is; it does nothing by itself | `download` `import` `package` |
| | | `template` | You start your own thing from it | `import` `app` `download` |

One category per project — the one most people would name. A design system that
is tokens, components and docs picks a primary and tags the rest, or becomes
three projects. Neither field changes with the channel: a UI inspector is a
`service`/`tool` whether it arrives as a userscript or, one day, over MCP. And a
pack of AI skills is `resource`/`knowledge`, not a service — the skills do
nothing on their own; the AI that reads them is what works. That AI is the
`ai` surface, below.

**`surfaces` — where is it met?** One or more; each carries what a visitor needs:

| surface | where | fields |
|---|---|---|
| `mcp` | an AI client, over MCP | — (requires `uses.mcp`) |
| `ai` | an AI reads it, in the format you name | `format`: `agent-skill` · `agents-md` · `cursor-rules` · `prompt`; requires `install` |
| `import` | `abc-labs/<id>/` in a repository, vendored | — (requires `install`) |
| `userscript` | the browser, via Tampermonkey | `url` |
| `extension` | inside another application | `url`, `host` (chrome, firefox, figma, vscode, …) |
| `app` | an application you open | `url`, optional `platform` (web, ios, android, desktop) |
| `cli` | a terminal | `command` |
| `package` | a package registry | `command`, optional `registry` (npm, pip, docker, actions, …) |
| `bot` | a chat | `url` |
| `download` | a file you fetch | `url` |

All surface and link URLs must be absolute HTTPS URLs. `javascript:`, `data:`, local
files, credentials and control characters are rejected. List only surfaces that
work today. A planned one is a sentence in your README; when it ships, it is one
more line here and the card grows a row.

The `ai` surface names a **format**, not a host: `agent-skill` (a folder with
`SKILL.md`) runs in Claude Code, claude.ai and the Claude API; `agents-md` in any
agent that reads `AGENTS.md`; `cursor-rules` in Cursor; `prompt` anywhere. Which
clients read which format is Labs's fact to keep current, not yours to maintain
in every manifest.

**`tags` — what is it about?** Open, optional, lowercase, at most five. Tags are
where a future axis incubates: if Labs ever needs a shelf or a rule for one, it is
promoted.

Labs decides *who* is in: a pull request adding one line to
[`registry.json`](registry.json), **after** the repository exists — nothing is
listed ahead of its repo. You decide *what* your card says: Labs re-reads your
`export` from GitHub on every `labs sync` (each platform deploy, plus nightly).

### What every exporting project gets, for free

A page, `https://labs.abclegacyllc.com/<id>`; a card on the catalog while you are
not archived; an entry in the public index at `labs.abclegacyllc.com/index.json`.
Nothing runs on our machine unless you rent `host`.

### Renting `host` — Labs runs your process

`labs deploy <id>` clones your repo into `var/projects/<id>/repo/`, runs
`uses.host.install`, provisions every capability in `uses`, writes one systemd
user unit, starts `uses.host.start` in your checkout. Your process receives:

| Env | |
|---|---|
| `PORT`, `HOST` | listen here (`HOST` is `127.0.0.1`) — Caddy is the only thing that talks to you; the port is yours for the life of the id |
| `LABS_ID` | your id |
| `NODE_ENV` | `production` |
| + whatever each other rented capability provides | below |

Your own secrets are *your* `.env` inside your checkout, which Labs never reads
and never commits. The generated unit applies a baseline systemd sandbox: private
tmp/devices, a read-only host filesystem except the project checkout, and no
new privileges. For full separation between guest code and the operator home, run
Labs under a dedicated Linux user or a rootless container. Logs: `journalctl --user -u labs-project-<id>`.

### Renting `mcp` — an endpoint on the MCP domain

`"uses": { "mcp": {} }` plus `"surfaces": { "mcp": {} }` (with `host`, or with
`upstream`) and you receive:

| Env | |
|---|---|
| `MCP_PATH` | `/<id>` — serve the Streamable HTTP MCP endpoint **at this path**, not at `/`; Caddy does not strip it |
| `MCP_PUBLIC_URL` | `https://mcp.abclegacyllc.com/<id>` — what users paste into Claude |

Labs adds the route, TLS, the entry in the public index (once your status is
callable), and `410 Gone` pointing at your page after you archive.

**Rate limiting happens at the gateway; you implement none of it.** Every request
to your path passes through it and is counted twice: once against *you* (so one
tenant cannot take the machine) and once against *the caller* (so one caller
cannot take you). Over either limit the caller gets `429` with `Retry-After`, and
your process never sees the request. Your tier — how much you may consume — is
set by Labs in its allowlist, not by this file; ask for a bigger one in an issue
and say what you expect. Your process receives the real caller in
`X-Forwarded-For`, which the gateway sets and a caller cannot forge. If a tool
ever needs to know *who* is asking, OAuth lands in the same place.

**The promise (rule 2):** `/<id>` is written into other people's configs. Once
`alpha`, it is never renamed or reused. A breaking change is a new id (`hello2`)
with the old one kept alive for a deprecation window. Running somewhere else?
`"uses": { "mcp": { "upstream": "https://your-host" } }` and Labs proxies to you
— also how a graduated project keeps its endpoint. The upstream must be an
external HTTPS host; loopback/private addresses and control characters are rejected.

### Renting `web` — a live app on an origin of your own

```json
"uses": { "web": { "dist": "dist" } },
"surfaces": { "app": {} }
```

You get `https://<id>.labs.abclegacyllc.com` — your own origin, so anyone can try
the experiment in a browser with nothing to install, and your page can never read
another project's cookies or storage. The `app` surface needs no `url`: Labs
assigns the origin and fills it in, and your card grows an **Open** button.

| Env | |
|---|---|
| `WEB_PUBLIC_URL` | your origin, if your process needs to know it |

`dist` is a directory of built files **in your repository** — build it in your own
CI and commit the result; the Labs server never runs npm for you. React, Vue,
Svelte, plain HTML: Labs serves files and has no opinion about what produced
them. Unknown paths fall back to `index.html` so a client-routed app survives a
refresh; set `"spa": false` for a plain multi-page site.

With no `dist`, the origin is proxied to the process you run under `host` — for
an app with a backend. That shape is not rate limited yet, so prefer `dist`.

### `install` — letting other repositories take you

```json
"install": {
  "include": ["ux-audit-*", "ux-sourcing-component"],
  "link":    { ".claude/skills/{name}": "abc-labs/toolkit/{name}" }
}
```

| | |
|---|---|
| `include` | required — paths or globs in *your* repo (`*` within a segment, `**` across); a matched directory is copied whole. They land in the importer's `abc-labs/<id>/`, same relative paths |
| `link` | optional — symlinks the importer's tools expect, `{name}` = each top-level entry that landed. Sources must be inside `abc-labs/<id>/`; destinations inside the importer's repo. An existing *real* file or directory at a destination is left alone |

`install` goes with an `ai` or `import` surface — that is how the card knows to
show `npx github:abclegacyllc/labs import <id>`. Without it, your project is met
only where its other surfaces say.

## `import` — taking Labs projects

From the root of any repository — a Labs project, a company product, a
stranger's — with node ≥ 22 installed:

```bash
npx github:abclegacyllc/labs import toolkit          # default branch
npx github:abclegacyllc/labs import toolkit v1.6.0   # a tag, a branch, or a commit
npx github:abclegacyllc/labs update                  # every import, at its pinned ref
npx github:abclegacyllc/labs update toolkit
```

`import` resolves the id against the public index, clones the project's
repository at the ref, copies what its `install.include` names into
`abc-labs/<id>/`, creates its `install.link`s, records `"<id>": "<ref>"` in
`labs.json` and the exact commit in `labs.lock.json`. **Commit all of it** — the
files are yours now: they build offline, survive Labs going away, and a later
`update` shows up as a reviewable diff.

| | |
|---|---|
| `abc-labs/labs.json` `import` | `{"toolkit": "*"}` — what you take, at which ref. Edit by hand or via the CLI |
| `abc-labs/labs.lock.json` | `{"toolkit": {"repo", "ref", "commit", "installedAt"}}` — the CLI's, never by hand |
| `abc-labs/<id>/` | the files. Re-created atomically on every `update`; do not edit in place — send the change upstream |

Trust: an import runs nothing, it copies. What it copies is pinned to a commit
you can read in the lock, from a repository the Labs allowlist vouches for, into
a folder your own git diff shows you.

## The clock (rule 4)

`building` + 14 days without flipping to `alpha` — a real endpoint or URL an
outsider can use — and your card reads **overdue**; another two weeks and Labs
archives it. Labs would rather list five things that work than fifty that might.

## Graduation

Every dependency on Labs is an environment variable or a vendored copy, so
leaving is: run your own instance of a capability (open source, in this repo) or
a vendor, change the variables, set `status: graduated`. Your `mcp` endpoint keeps
answering via `upstream` or a redirect for as long as the capability's
graduation note says; your page stays; repositories that imported you keep what
they have.

## Deploying an exporting project

Ask the Labs owner to run `bin/labs deploy <id>`, or — once you have a key for
the `labs` user — from your own GitHub Action:

```yaml
- run: ssh labs@<server> 'cd ~/labs && bin/labs deploy <id>'
```

A webhook receiver that removes the need for SSH keys in project repos is on the
list; it is not here yet.
