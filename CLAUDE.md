# Working on ABC Legacy Labs with Claude Code

The incubator of ABC LEGACY LLC: platform capabilities a small project rents, and the projects
renting them. This repository is the **platform** — no project code lives here.
Read the four rules first; every later section is a consequence of one of them.

## The four rules

1. **A secret never enters git.** Values live in `.env` (platform) or
   `var/projects/<id>/env` (written by `labs deploy`) on the server, nowhere else.
   Every committed file — Caddyfile, unit, workflow, code — refers to a secret by
   *name*. This repo is public: a leaked token is leaked to everyone, forever.

2. **`mcp.abclegacyllc.com/<id>` is a promise.** It is written into other
   people's Claude and Cursor configs and stays there for years. The path *is*
   the id — not configurable, never renamed, never reused; a breaking change is a
   new id with the old one kept alive; a retired project answers `410 Gone` with
   a note. The catalog at `labs.` may be redesigned any afternoon; the endpoint
   may not. That is why they are separate hosts. Two corollaries: a project is
   named for what it is, never for a capability it rents (`hello`, not `hello-mcp`
   — the capability is in the hostname); and `registry.json` lists only repositories
   that exist — never a planned one, never a placeholder, never an assumed name.

3. **Two layers, and every link points outward.** The platform (capabilities:
   host, mcp, …) is Labs's and lives here; projects are guests in their own
   repositories. A repository's whole relation to Labs is `abc-labs/labs.json`
   with two halves — `export` (what it gives: listed, renting capabilities) and
   `import` (what it takes: other Labs projects, vendored and pinned in
   `labs.lock.json`). Nothing ties a repo to Labs being up: capabilities reach
   it as environment variables, imports as copies it owns. Words are single-use:
   *service* is a project **kind** (does work), never the platform layer. Three files answer three questions and nothing is typed twice:
   `registry.json` (*who may be here*), the repo's `abc-labs/labs.json` (*what it
   gives and takes*), `var/projects/<id>/realized.json` (*what is actually
   deployed*). The catalog, the pages, `index.json` and the MCP index read only
   the last.

4. **An experiment has a clock.** `started` + 14 days = `alphaBy`, computed by
   Labs, never declared by the project. Past it, a `building` card reads
   *overdue*; two more weeks and it is archived. Status is one of `building`,
   `alpha`, `beta`, `graduated`, `archived` — no other words.

## The three axes

`kind` (typed, `service` | `resource`) and `category` (typed, one of seven) are
two fields and one decision: **both are required, and the validator refuses a
pair that disagrees** — the author states the shelf and the role, and drift is
impossible because it is an error, not a comment. `surfaces` (typed, ≥1, closed
list with per-surface fields). `tags` (typed, open, ≤5).

The tables live in `lib/registry.mjs` (`KINDS`, `CATEGORIES`, `SURFACES`) and
nowhere else — the validator, the catalog and `index.json` all read them. Adding
a category or a surface is a line there plus a `whereRow` case in the renderer;
never let a surface name double as a category name (`ai` is a surface, `agent` a
category, on purpose). Readers get `entry.kind ?? kindOf(entry.category)` so
entries written before the field became required still render. Tags are where a
future axis incubates: promote one only when you want a shelf or a validation
rule for it. When a table changes, JOIN.md and CONTRACT.md change in the same
commit — `npm run check` fails otherwise.

## What lives where

```
registry.json        site metadata + allowlist: { id, repo } per project
JOIN.md              what an agent in a guest repo reads to produce abc-labs/labs.json alone — template with
                     every option inline, decision tables, validate, hand-back. Written so no question comes back
CONTRACT.md          the reference behind JOIN.md — keep both true before anything else
tools/check-docs.mjs drift check: every category, surface, status in lib must be named in JOIN.md and CONTRACT.md
lib/registry.mjs     paths, vocabulary (STATUSES, CATEGORIES, SURFACES, KINDS, MANIFEST_PATH), validateManifest
bin/labs.mjs         the CLI: platform verbs write var/; repository verbs (export/import/update) act on process.cwd()
                     and write only inside that repo's abc-labs/ (+ declared links). npx github:… runs it anywhere
platform/<id>/       capability.json (+ provision.mjs, routes.mjs, server.mjs) — see platform/README.md
                     host = runs the process (port for life)
                     mcp  = the WHOLE mcp. host: Caddy → gateway → project. Limits per project and per caller live
                            there, and later OAuth; tiers come from registry.json, never from a project's manifest
site/build.mjs       renderer: var/projects/*/realized.json + platform/*/capability.json → site/dist/{index.html, <id>/, index.json}
                     index.json is a PROJECTION — never leak assigned ports, dirs, env paths into it
infra/Caddyfile.tmpl rendered by `labs render` to var/Caddyfile with {{root}} and the hosts from registry.json —
                     nothing in git names a machine; /etc/caddy/Caddyfile imports var/Caddyfile once, by hand
infra/systemd/       labs-*.service = platform processes; labs-sync.timer fires labs-sync.service nightly (a
                     one-shot — the Makefile installs it but never enables it alone); project.service.tmpl = what guests get
Makefile             the daily commands, and the only place systemd is driven — infra/deploy.sh calls it rather
                     than copying it, so a deploy from CI and a deploy by hand cannot drift
infra/deploy.sh      the platform's own deploy: pull, then make install / sync / render
tools/requirements.sh what a machine needs (node >= 22, git, caddy, lingering) — reports, installs on ask
docs/examples/       the three shapes of labs.json (hello / toolkit / consumer) — documentation, never hosted
docs/direction.md    catalog vs console vs community — read before adding a framework, a login or a database
var/                 gitignored realized state; never commit, never hand-edit. PROJECT-CENTRED: everything Labs
                     holds about a project is var/projects/<id>/ — realized.json (the listing), repo/ (checkout),
                     env, the unit file (symlinked into systemd's dir), later cached icon/readme. `labs remove <id>`
                     deletes that one folder and nothing is left behind. Only aggregates (var/routes, var/Caddyfile)
                     live outside it
```

## Running it here

```bash
npm run check                      # syntax, the three examples, a render, caddy validate — no network
bin/labs sync                      # reads the allowlisted repos' abc-labs/labs.json from GitHub
bin/labs deploy <id> --dry-run     # everything except install, systemctl and caddy
GATEWAY_PORT=18800 node platform/mcp/server.mjs   # then curl localhost:18800/
# import against a local index, from a scratch directory:
LABS_INDEX=$PWD/site/dist/index.json TMPDIR=<scratch> node bin/labs.mjs import <id>
```

`fetchManifest` also reads a repo given as a local path — that is how the import
path is tested without GitHub: a scratch producer repo in the allowlist, `sync`,
`render`, then `import` from a scratch consumer directory. Set `TMPDIR` to the
scratchpad; `cloneAt` uses `os.tmpdir()` because on a user's machine that is right.

`sync` on the dev box is honest: it fetches real manifests and skips repos that
have none yet, saying so. `render` never reloads Caddy unless
`/etc/caddy/Caddyfile` imports this checkout's Caddyfile — the dev box's Caddy is
serving something else.

## Adding a platform capability

`platform/<id>/capability.json` with `id`, `name`, `summary`, `status`, `provides`,
`options`. Then, as needed: `provision.mjs` (default export
`({ id, manifest, options, entry, all, site, dry }) → { env, rented, summary }`,
idempotent — deploys repeat), `routes.mjs` (`(entries, site) → Caddy text`),
`server.mjs` + `infra/systemd/labs-<id>.service` if it is a process. Everything a
tenant receives goes through `env`, as plain tokens; that is the contract in
platform/README.md — a tenant must be able to replace you with its own instance
by changing variables. Document graduation before shipping. Before adding one,
apply the test in platform/README.md: *who is the customer?* Something Labs
consumes to run itself (monitoring, alerts to the operator) is infra — the
company map already does it — not a capability, and gets no card and no token.

## Deploying a guest

`labs deploy <id>` = allowlist check → clone/pull into `var/projects/<id>/repo` →
validate `abc-labs/labs.json` → provision each capability in `uses`, `host` first (it keeps
or assigns the port — stable per id, from 8801 — so `mcp` can describe it) →
`uses.host.install` → write `var/projects/<id>/env` (0600) → render
`project.service.tmpl` into `var/projects/<id>/labs-project-<id>.service`, symlink
it into `~/.config/systemd/user/` → `systemctl --user enable --now` → write
`var/projects/<id>/realized.json` → `render`. `labs remove <id>` reverses all of
it by stopping the unit, unlinking it and deleting the folder. A sync that finds a
manifest invalid only *unlists* (deletes realized.json; the process keeps running,
the next good sync relists); leaving the allowlist also stops the process. Hosting is a capability like any
other: a project that does not rent `host` is listed, not run, and needs only
`sync` — which also routes `mcp` for a project that names an `upstream`. A
project's other `uses` changes take effect on its next deploy, not on sync.

## Limits

`MCP_TIERS` in `lib/registry.mjs`, enforced in `platform/mcp/limits.mjs`, applied
in the gateway. Two dimensions on purpose — per project protects the machine, per
caller protects the project — plus a concurrency cap, which is the only one that
catches a held-open SSE stream. The caller's identity is the **last**
`X-Forwarded-For` hop (the one Caddy saw); taking the first would let anyone
reset their own bucket. Tiers are set in `registry.json` because a manifest lives
in a repository Labs does not control. When auth arrives, `clientOf` returns the
token subject and IP becomes the fallback — one function, nothing else changes.

## Auth

Optional in the MCP spec, and the principle here: **a server asks who you are
only when a tool needs to know.** Read-only tools over public data run with no
auth plus rate limiting at the gateway — for beta too. When identity is needed,
the whole domain gets it once, in the mcp capability: `/.well-known/oauth-protected-resource`
(RFC 9728) → one authorization server (RFC 8414, dynamic client registration RFC
7591, PKCE, resource indicators RFC 8707), `401` + `WWW-Authenticate`, and Caddy
`forward_auth` so projects receive an identity header and implement nothing.
Claude.ai's custom-connector dialog offers OAuth (optional client id/secret) or
nothing — there is no API-key field. A bearer-header scheme reaches Claude Code
and Cursor users only; do not ship one thinking it covers everyone.

## Deploy

Labs runs from wherever it is checked out; `var/Caddyfile` carries that path.
Root is needed exactly twice per machine — `chmod o+x` on the parent directory so
Caddy can traverse to `site/dist`, and the `import` line in `/etc/caddy/Caddyfile`
(`make caddy` prints both). Everything else is sudo-free: user units under
lingering, `caddy reload` through the local admin API.

A dedicated `labs` user is the stronger arrangement — a guest project then runs
outside the home directory of whoever owns the rest of the machine — but it is
not required, and this deployment does not use one: guests run as the same user
as everything else here. Keep that in mind before adding anything that reads
`$HOME` or trusts a local path. `make`, `bin/labs` and `infra/deploy.sh` must stay runnable by
that user with nothing but node, git and make — no npm install, ever: the CLI,
the gateway and the site builder have no dependencies, and that is what makes a
bare server one `git clone` away from serving.

This machine has no GitHub push credential and no git identity configured. Commit
locally when asked; the human pushes. Do not add credentials to fix that.

## This checkout is live

`labs.abclegacyllc.com` and `mcp.abclegacyllc.com` are served from **this**
directory — `var/Caddyfile`, `site/dist`, `var/projects/`, the running units.
Anything that writes `var/` here changes the public site within seconds. So:
`npm run check` is safe (it renders, but from the real registry); `sync`,
`deploy` and `import` round-trips against scratch repositories are **not** — run
them in a throwaway copy (`git clone . /tmp/…/labs-test && cd there`), never in
this checkout. If a test did touch `var/projects/` here, delete the entry it
wrote and `make render` — the catalog is only as honest as that directory.

## Before finishing a change

```bash
npm run check
```

If you touched `lib/registry.mjs`, `bin/labs.mjs` or `platform/mcp/*`, also run
a dry-run deploy against a scratch repo (a directory with `git init`, a
`abc-labs/labs.json` and a `server.mjs`, pointed at from a temporary copy of
`registry.json`) and read `var/routes/web.caddy`, `var/projects/<id>/env` and the
rendered card; and an import round-trip (producer with `install` → `sync` →
`import` from a scratch consumer → `update` after a producer commit). Restore
`registry.json` and delete `var/` afterwards. If you changed CONTRACT.md, the
three examples under docs/examples/ must still pass `bin/labs export` — they are
the contract's tests.
