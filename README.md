# ABC Legacy Labs

The incubator of [ABC LEGACY LLC](https://abclegacyllc.com), in two layers:

- **Platform** — capabilities Labs runs for everyone so a small project does not
  have to: hosting and MCP today; a web origin per project and notifications
  (Telegram, webhook, email) when the first project asks. A project rents one
  with a line in its manifest and leaves, when it grows up, by changing an
  environment variable.
- **Projects** — the experiments. Each in its own repository with its own
  release cycle; Labs lists it, hosts it if asked, and holds it to a clock:
  fourteen days from `building` to a callable `alpha`, or archived.

Every project is described on three axes, and the catalog is arranged by them:

| axis | question | values |
|---|---|---|
| `kind` + `category` | *what sort of thing is it*, and what does the taking project *get*? | **`service`** — it does work: `api` · `tool` · `agent` · `component`. **`resource`** — it is material: `knowledge` · `asset` · `template`. Both are written and must agree |
| `surfaces` | *where* is it met? | `mcp` · `ai` · `import` · `userscript` · `extension` · `app` · `cli` · `package` · `bot` · `download` — one or more |
| `tags` | what is it *about*? | open, optional — `ux`, `3d`, `telematics`, … |

Universal on purpose: a 3D engine, an AI worker, a dataset and a skill pack all
land on one of seven shelves without a new shelf being invented for them.

And Labs has two directions. A repository can **export** — be listed as a Labs
project and rent capabilities — or **import**: take a Labs project into itself as
vendored files, pinned to a commit, with one command. `skills` into a product
repo, for instance. Any repository, ABC's or not; Labs is open source.

This repository is the platform: the catalog, the capabilities, and the CLI that
deploys guests and performs imports. **No project code lives here.**

| Host | What | Backed by |
|---|---|---|
| `labs.abclegacyllc.com` | the catalog — kind › category › project, then the platform | a static directory, rendered by `labs render` |
| `labs.abclegacyllc.com/<id>` | a project's page — status, how to connect, its note; where a `410` sends people | the same render, one directory per project |
| `mcp.abclegacyllc.com` | index of callable MCP servers, health, retirement notices | `platform/mcp/server.mjs` |
| `mcp.abclegacyllc.com/<id>` | a project's MCP server | that project's own process, routed by Caddy |

## Connect to a project

```bash
# Claude Code
claude mcp add --transport http abc-<id> https://mcp.abclegacyllc.com/<id>

# Claude.ai / Claude Desktop
# Settings → Connectors → Add custom connector → paste the endpoint
```

`https://mcp.abclegacyllc.com/` lists everything callable right now, with status.

## Take a project

From the root of any repository, with node ≥ 22:

```bash
npx github:abclegacyllc/labs import <id>     # files → abc-labs/<id>/, pinned in abc-labs/labs.lock.json
npx github:abclegacyllc/labs update          # re-import everything at its pinned ref
```

Only projects that export an `install` spec can be imported; the card says so.
Commit what lands — it is yours, it works offline, and updates arrive as diffs.

## Bring a project

Point whoever prepares the repository — a person or the AI working in it — at
[JOIN.md](JOIN.md): a fill-in template with every allowed value listed, the
seven questions that pick a category, and the one command that validates the
result. No conversation needed. [CONTRACT.md](CONTRACT.md) is the reference
behind it. In short: add `abc-labs/labs.json` with an
`export` half to your repo, open a PR adding one line to
[`registry.json`](registry.json), and you are listed, with a page at
`labs.abclegacyllc.com/<id>`. Rent `host` and Labs runs your process; rent `mcp`
and you have an endpoint; add `install` and other repositories can take you.
Which platform capabilities exist, which are only designed, and what counts as
one at all: [platform/](platform/README.md).

| status | |
|---|---|
| `building` | not callable yet; `alphaBy` = `started` + 14 days, after which the card reads **overdue** |
| `alpha` | callable; may break, change, or vanish — feedback wanted |
| `beta` | callable; shape is stable; breaking changes get a deprecation window |
| `graduated` | left Labs; the endpoint keeps working (via `upstream` or a redirect) |
| `archived` | retired; the endpoint returns `410 Gone` and points to the note |

## Layout

```
Makefile               start · stop · status · logs · sync · deploy · requirements — the daily commands
registry.json          who is in: site metadata + the allowlist of project repos
JOIN.md                for whoever prepares a repository (human or agent): template, decisions, validate, hand back
CONTRACT.md            the repository ↔ Labs contract: abc-labs/labs.json, the three axes, export, import, env
platform/<id>/         a capability: capability.json, provision.mjs, routes.mjs, server.mjs
bin/labs               the CLI: sync · deploy · render · list (platform) — export · import · update (any repo)
lib/registry.mjs       paths, vocabulary, manifest validation — shared by everything
site/                  the catalog renderer (zero dependencies)
infra/                 Caddyfile, platform units, the project unit template, deploy.sh
tools/                 requirements.sh (what a machine needs), check-docs.mjs (drift + format)
var/                   gitignored — what is actually true on this machine (see below)
```

Three files, three questions: `registry.json` — *who may be here?* `abc-labs/labs.json`
(in the project's repo) — *what does it give, what does it take?*
`var/registry.d/<id>.json` — *what is actually deployed?* The catalog, the
public `index.json` and the MCP index read only the last.

```
var/projects/<id>/      guest checkouts          var/registry.d/<id>.json  listings
var/routes/*.caddy      generated Caddy routes   var/env/<id>.env          env injected into units
```

## Running it

```bash
make                 # the list
make requirements    # what this box has and what it is missing   (make setup installs it)
make install         # hand the platform units to systemd — start at boot, restart on crash
make start           # start the platform and every deployed project   (stop, restart, status)
make status          # units, whether the gateway answers, what is listed
make logs            # last 40 lines from each unit   (make tail to follow)
make sync            # read every allowlisted repo, then render
make deploy ID=<id>  # clone/pull one guest project, provision, start it
make dev             # the gateway in the foreground on port 18800, for poking with curl
```

Platform and projects are separate units — `labs-mcp.service` and one
`labs-project-<id>.service` per guest — so `make platform-stop` leaves the
projects running, and a project restarting never touches the gateway.

## The CLI

`make` covers the daily commands; the CLI underneath does the rest.

```bash
# platform — in the Labs checkout
bin/labs sync                 # every allowlisted repo's abc-labs/labs.json → var/registry.d, then render
bin/labs deploy <id>          # clone/pull, provision capabilities, write unit, start, render   (--dry-run)
bin/labs render               # registry.d → routes + catalog + pages + index.json, caddy reload if wired in
bin/labs list

# any repository — from its root; `npx github:abclegacyllc/labs …` runs the same file
labs export                   # validate abc-labs/labs.json: what Labs will see, what you take
labs import <id> [ref]        # take a Labs project into abc-labs/<id>/, pin it      (alias: install)
labs update [id]              # re-import at the pinned ref, report old → new commit
```

`--index=<url|path>` (or `LABS_INDEX`) points `import` at another index — a
local `site/dist/index.json` while developing.

Zero dependencies — node ≥ 22 is the whole toolchain. `npm run check` runs the
syntax checks, a render, and `caddy validate`.

## Deploy

Production is a Linux user of its own, `labs`, on the same server as the rest of
the company, behind the Caddy that is already there. Once, as root:

```bash
sudo adduser --disabled-password --gecos "" labs
sudo loginctl enable-linger labs                     # user units start at boot
sudo chmod o+x /home/labs                            # Caddy may traverse to site/dist (no listing)
sudo -u labs -H git clone https://github.com/abclegacyllc/labs.git /home/labs/labs
echo 'import /home/labs/labs/infra/Caddyfile' | sudo tee -a /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then, as `labs`, no sudo — the platform:

```bash
cd ~/labs && make requirements        # is anything missing?
./infra/deploy.sh                     # pull, units, sync, render — the same steps as make
```

and each hosted guest, when its author asks:

```bash
make deploy ID=<id>
```

DNS: `A labs.abclegacyllc.com` and `A mcp.abclegacyllc.com` → the server. Caddy
obtains and renews certificates by itself. Pushes to `main` can run
`infra/deploy.sh` over SSH — [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
lists the four secrets and the one variable that switch it on. The server needs
no GitHub credential: the repository is public and `git pull` is plain https.

Not there yet, in order: per-IP rate limiting at the gateway; each project's
`/healthz` as a target in the company map's monitor (that is infra, not a
capability — nothing new to build); Terms and Privacy pages before the first
`beta`; a webhook so project repos can deploy without SSH keys; the `web` and
`notify` capabilities, each when a project first asks.

## Feedback

[Issues](https://github.com/abclegacyllc/labs/issues) for the platform; each
project's card links to its own.
