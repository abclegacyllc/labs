// Renting host: a port, assigned once and kept for the life of the id — across
// restarts and redeploys, so nothing downstream (mcp routes, a bookmark in
// someone's notes) ever has to be updated. The unit, the env file and systemctl
// are the deploy's mechanics (bin/labs.mjs); this hook decides only WHERE the
// process listens and tells it so.
export default function provision({ id, options, entry, all }) {
  if (!entry.assigned.port) {
    const taken = new Set(all.filter((e) => e.id !== id).map((e) => e.assigned?.port).filter(Boolean));
    let port = 8801;
    while (taken.has(port)) port++;
    entry.assigned.port = port;
  }
  return {
    env: { HOST: "127.0.0.1", PORT: String(entry.assigned.port) },
    rented: { port: entry.assigned.port, start: options.start, install: options.install ?? null },
    summary: `127.0.0.1:${entry.assigned.port} — ${options.start}`,
  };
}
