import { normalizeHttpUrl } from "../../lib/registry.mjs";

// Renting mcp: the project gets exactly one path — /<id> — and nothing to choose.
// The path IS the id (rule 2: it is written into other people's configs and never
// moves), so there is nothing to allocate that could collide. Caddy learns about
// it in routes.mjs; the project learns about it through MCP_PATH.
export default function provision({ id, options, entry, site }) {
  const path = `/${id}`;
  const endpoint = site.mcpUrl + path;
  const upstream = options.upstream ? normalizeHttpUrl(options.upstream, { field: `mcp upstream for ${id}` }) : null;
  return {
    env: { MCP_PATH: path, MCP_PUBLIC_URL: endpoint },
    rented: { path, endpoint, upstream },
    summary: `${endpoint} → ${upstream ?? `127.0.0.1:${entry.assigned.port}`}`,
  };
}
