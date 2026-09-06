# Where this is going, and what is deliberately not built yet

Written down so the decision is made once. If you are about to add a framework, a
login, or a database to Labs, read this first — it may already say why, or say
that the moment has arrived.

## Three surfaces, not one

What looks like "the Labs site" is three things with different obligations. The
mistake to avoid is building them as one, because then the cheapest one inherits
the constraints of the most expensive.

| | who it is for | what it must do | what it is built with |
|---|---|---|---|
| **Catalog** `labs.abclegacyllc.com` | a stranger, and a search engine | load fast, be indexable, work with JavaScript off, and keep working when everything else is down | static HTML rendered at deploy time from `var/registry.d`, plain CSS, a little progressive JavaScript |
| **Console** `console.labs.abclegacyllc.com` | the Labs operator, and project owners | show live state, edit configuration, sit behind a login | a single-page app — React, Vite and Tailwind are the expected choice, matching abclegacyllc.com. **Not built** |
| **Community** profiles, preferences, feedback | people who use the experiments | identity, storage, and everything that follows from holding user data | the console's stack plus a database and sessions. **Not built** |

This is the shape Google Labs has — `labs.google` is a catalog page, each
experiment is its own app — and the shape Vercel has, and GitHub: the marketing
surface is rendered, the dashboard is an app. It is not a compromise; it is what
lets the shop window stay open while the workshop is being rebuilt.

## The foundation that already exists

"Prepare for the future" usually means *fewer* assumptions, not more machinery.
What makes the next thing cheap is already here:

- **`labs.abclegacyllc.com/index.json`** — the whole catalog as data, framework-free.
  The console will read it. So can anything else. This is the most portable thing
  Labs owns, and nothing may be added to the catalog that is not in it.
- **Everything renders from data.** `var/registry.d` plus the tables in
  `lib/registry.mjs` produce the pages, the routes, the MCP index. A new field or
  a new view is a change in one place, not a hunt through markup.
- **Origins are already separated.** Every project gets
  `<id>.labs.abclegacyllc.com` under one wildcard record. The console will be one
  more origin under the same rule — and it will be served by the same `web`
  capability every guest uses, not by special infrastructure.
- **There is one place for authorization to land.** The mcp gateway is already in
  the traffic path and already holds per-project and per-caller limits. Machine
  identity (OAuth for MCP) and human identity (a session for the console) both
  belong there, and `clientOf()` is the single function that decides who is asking.

## What is deliberately not built

Not out of laziness — each of these is cheaper to build once its requirement can
be stated, and more expensive to *change* once built against a guess.

| | the trigger that would make it worth building |
|---|---|
| A framework for the catalog | the catalog stops being a list and starts holding state a visitor changes. Filtering and search did not need one; a saved view or a personal library would |
| The console | the first thing an operator has to do that `make` cannot: approving a project, changing a tier, reading a project's logs from a browser |
| Login, accounts, preferences | the first feature that is meaningless without knowing who is asking. Until then, no user data means no user data to lose |
| A database | when `var/registry.d` — files rendered from repositories — can no longer answer the question. It answers every question asked so far |
| Rate limiting on `web` | a proxied project that gets enough traffic to matter. Static `dist` sites are served by Caddy and need none |

## Rules that outlive any of this

1. **A project's stack is its own business.** Labs serves files and proxies ports.
   It has no opinion about React, Svelte, Three.js or a shell script, and it never
   gains one. The moment Labs dictates a framework it stops being a platform.
2. **The Labs server runs `npm install` for nobody.** Guests build in their own
   CI and commit the result; the platform's own code has no dependencies. That is
   what keeps a bare machine one `git clone` away from serving.
3. **The catalog must survive everything else being broken.** It is static files
   on disk. No API call, no database, no login stands between a visitor and the
   list of experiments.
4. **New surfaces get new origins.** Never a path under an existing one — the
   browser's isolation boundary is the origin, and the blast radius of one
   mistake should be one project.
