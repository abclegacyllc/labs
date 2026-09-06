# Examples — the three shapes of `abc-labs/labs.json`

Documentation, not projects: nothing here is deployed or listed. Each directory is
laid out as a repository would be — the whole Labs integration is the `abc-labs/`
folder, and the one file Labs reads is `abc-labs/labs.json`. It has two halves and
needs at least one:

| | `export` — gives to Labs | `import` — takes from Labs |
|---|---|---|
| [`hello/`](hello/abc-labs/labs.json) — an **api** met over **mcp**, hosted here, also using the toolkit; ships the whole folder: [README.md](hello/abc-labs/README.md), [CHANGELOG.md](hello/abc-labs/CHANGELOG.md), [icon.svg](hello/abc-labs/icon.svg), `version`, `requires` | rents `host` + `mcp` | `toolkit` |
| [`toolkit/`](toolkit/abc-labs/labs.json) — **knowledge** met through an **ai** that reads Agent Skills, imported by other repos | `install` spec, nothing hosted | — |
| [`consumer/`](consumer/abc-labs/labs.json) — any repository, ABC's or not | — | `toolkit` |

`hello/` is also the example of everything else `abc-labs/` can hold. Labs reads
these by **fixed name and nothing else in the repository**: `README.md` becomes the
project page's *About*, `CHANGELOG.md`'s newest section its *What's new*,
`icon.svg` (or `icon.png`, ≤ 64 KB) the card's icon, and `version` and
`requires` in `labs.json` the version badge and the *Needs* line. All optional.

Every export answers three questions — `kind` + `category` (*what sort of thing is
it, and what does the taking project get?* both written, and they must agree),
`surfaces` (*where is it met?*), `tags` (*what is it about?*). CONTRACT.md has
the full tables; [JOIN.md](../../JOIN.md) is the fill-in procedure.

`consumer/` is the important one: it is **not a Labs project**, is not in
`registry.json`, and Labs never reads it. It only takes. After
`npx github:abclegacyllc/labs import toolkit` it would also hold:

```
abc-labs/
  labs.json        "import": { "toolkit": "*" }          ← you, or the CLI on first import
  labs.lock.json   toolkit → repo, ref, commit, when      ← the CLI, never by hand
  toolkit/         the files matched by toolkit's install.include
.claude/skills/ux-audit-* → ../../abc-labs/toolkit/…      ← install.link
```

## Names

A project is named for **what it is**, never for the capability it rents. The id
`hello` gives, automatically:

| | |
|---|---|
| page | `https://labs.abclegacyllc.com/hello` |
| MCP endpoint (rents `mcp`) | `https://mcp.abclegacyllc.com/hello` |
| own web origin (would rent `web`) | `https://hello.labs.abclegacyllc.com` |
| files in an importing repo (if it exported `install`) | `abc-labs/hello/` |
| unit | `labs-project-hello.service` |

`hello-mcp` would be wrong twice: the capability is already in the hostname, and
the day the project rents a second capability the name is stale. The repository may be
called anything — `registry.json` maps id → repo — but `id` is the one name that
appears everywhere and never changes.

## What `hello`'s server must do, in Labs terms

- listen on `$HOST:$PORT`
- serve a Streamable HTTP MCP endpoint at `$MCP_PATH` (`/hello`) —
  `@modelcontextprotocol/sdk`, transport `StreamableHTTPServerTransport`
- answer `GET $MCP_PATH/healthz` with 200
- read-only tools over public data ⇒ no auth, correct for alpha *and* beta

Clock: `started` + 14 days to `alpha`, or archived.
