# Platform — the layer projects rent

A **capability** is something Labs owns, runs for many projects at once, and hands
to a project through **environment variables only**. That last part is the whole
design: a project never imports Labs code, so the day it graduates, "leaving" is
pointing the same variables at its own instance — or at a vendor — and nothing
else changes.

> Words. This layer is the **platform**; its entries are **capabilities**; a
> project **rents** them with `uses`. The word *service* means something else in
> Labs: it is the **kind** of a project that does work (an API, a tool, an agent,
> a component) — as opposed to a *resource*, which is material. Platform
> capabilities are not projects and have no kind.

## Rent, or infra? One test

**Who is the customer?** If the *project* calls it and would have to replace it
on graduating → a **capability**: env vars, per-tenant token and quota, a card on
the catalog, a graduation note. If *Labs itself* consumes it to run the platform
and a tenant never sees it → **infra**: no manifest field, no card, no token. The
same tool can sit on both sides; the boundary is whose hand holds the token.

## The capabilities

| | What | Surface | Status |
|---|---|---|---|
| [`host`](host/) | runs the project's process: port for life, unit, restart, env, journal | `PORT`, `HOST`, `LABS_ID` | alpha |
| [`mcp`](mcp/) | a path on the MCP domain, TLS, the index, 410 on retirement, **rate limiting per project and per caller**; OAuth here too when a tool ever needs identity | `mcp.abclegacyllc.com/<id>` → `MCP_PATH`, `MCP_PUBLIC_URL` | alpha |
| [`web`](web/) | the project's own live app, on an origin of its own — anyone can try the experiment in a browser | `<id>.labs.abclegacyllc.com` → `WEB_PUBLIC_URL` | alpha |
| `notify` | the project sends messages to its users or owner: channels `telegram`, `webhook`, `email` | `NOTIFY_API_URL` + `NOTIFY_TOKEN`, loopback HTTP | when a project asks |

Not capabilities, on purpose: **the project page** (`labs.abclegacyllc.com/<id>`)
is free and automatic for every listed project; **monitoring** ("project down",
"overdue") goes to the Labs operator and is infra — the company map's monitor,
with Labs endpoints as targets, nothing to build. **Email is a channel of
`notify`**, not a capability of its own: one env pair, one quota, one
`POST /v1/send { channel, to, text }`; DKIM and bounces are the channel's problem.

Two decisions baked in: **URLs carry the id, never the display name** (rule 2),
and **project-served HTML never lives under `labs.abclegacyllc.com/…`** — one
origin would let one project's script read every other's storage, which is why
`*.vercel.app` and `*.github.io` exist, and why `web` hands out a subdomain.

### How `web` serves an app

Two shapes, and the first is the one to prefer:

| | |
|---|---|
| `"web": { "dist": "dist" }` | Caddy serves the built files straight from the checkout. No process, no port, nothing to keep alive — and a React/Vite/Tailwind build is exactly this. `spa` (default true) serves `index.html` for unknown paths so a client-routed app survives a refresh. |
| `"web": {}` with `host` | the origin is proxied to the project's own process, for an app with a backend. **Not rate limited yet** — unlike `mcp`, whose gateway counts every request. Prefer `dist` until that is built. |

The project builds `dist/` in its **own** CI and commits it; the Labs server never
runs npm on a guest's behalf. One wildcard record — `*.labs` → the server — covers
every future id, and Caddy takes a certificate per subdomain by itself (proved:
a fresh subdomain went from nothing to a valid Let''s Encrypt certificate in nine
seconds). A project''s stack is its own business: Labs serves files and proxies
ports, and has no opinion about the framework that produced them.

A project rents a capability with one entry in its `abc-labs/labs.json`:
`"uses": { "host": { "start": "node server.mjs" }, "mcp": {} }`.

## What a capability directory contains

```
platform/<id>/
  capability.json  id, name, summary, status, what env it provides, what options it accepts
  provision.mjs    optional — called by `labs deploy` for each renting project; returns {env, rented, summary}
  routes.mjs       optional — called by `labs render`; returns Caddy text for var/routes/<id>.caddy
  server.mjs       optional — the capability's own process, one user unit in infra/systemd/labs-<id>.service
```

### Why the mcp gateway is in the traffic path

Caddy hands the whole `mcp.` host to `platform/mcp/server.mjs`, which limits and
then proxies to the project — it does not route projects itself. That is the only
place a limit can be held *per project and per caller at once*, and later the only
place that has to understand OAuth; a project implements neither. The cost is
stated plainly: if the gateway is down, every MCP endpoint is down. It stays
small, keeps no state worth losing, and systemd restarts it.

What a project may consume is a **tier**, and a tier is set in `registry.json`,
which is Labs's file — never in the project's manifest, which lives in a
repository Labs does not control and could raise its own ceiling:

```json
{ "id": "svg", "repo": "https://github.com/…", "mcp": { "tier": "heavy" } }
```

`default` · `heavy` · `internal` are defined in `lib/registry.mjs` (`MCP_TIERS`)
and described on the capability card. A project may ask for a tier in its README
or an issue; only the allowlist grants one.

`provision` receives `{ id, manifest, options, entry, all, site, dry }` and may
allocate resources (a port, a path, a token, a database) — idempotently, because
deploys repeat. `host` is always provisioned first, so later capabilities can read
`entry.assigned.port`. Whatever `provision` returns in `env` is written to
`var/projects/<id>/env` and injected into the project's unit; values must be plain
tokens (no spaces, quotes, `#`). `mcp` is also provisioned on `sync` for a
project that names an `upstream` and rents no `host` — it runs elsewhere, but its
route is ours.

## Rules for a capability

- **Rent through an interface the tenant can later own.** Env vars in, HTTP on
  loopback or a public URL out. No SDK, no shared module, no database the
  project reaches into directly.
- **Multi-tenant by construction**: everything is keyed by project id — tokens,
  quotas, from-addresses, paths, ports. One tenant can never see another's.
- **Graduation is a first-class operation**, documented per capability: what the
  project takes with it and how long Labs keeps the old surface alive.
- **Built when the first project asks**, on the same fourteen-day clock as a
  project. `web` and `notify` are designed above and not built, on purpose.
- Capabilities live in this repository because they are few, long-lived and share
  the contract. When one wants its own release cycle, `git subtree split` gives
  it a repo of its own without losing history.
