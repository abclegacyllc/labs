// Renting web: the project gets an origin of its own, https://<id>.labs.…
//
// A subdomain rather than a path under the catalog, and this is the whole point:
// browsers isolate by ORIGIN, so a page at svg.labs.… cannot read the cookies,
// localStorage or service workers of the catalog or of any other project. A path
// would put every experiment in one blast radius — which is why *.vercel.app and
// *.github.io exist. The wildcard DNS record makes every future id work with no
// further setup, and Caddy takes a certificate per subdomain on its own.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { webOrigin } from "../../lib/registry.mjs";

export default function provision({ id, options, entry, site, dry }) {
  const origin = webOrigin(site, id);
  const dist = options.dist ?? null;
  let root = null;

  if (dist) {
    // The path has already been checked for shape by the validator; here it is
    // checked for truth — a typo would otherwise serve an empty directory.
    root = resolve(entry.assigned.dir, dist);
    if (!root.startsWith(entry.assigned.dir + "/")) throw new Error(`web: "dist" must stay inside the checkout, got ${dist}`);
    if (!dry && !existsSync(join(root, "index.html"))) {
      throw new Error(`web: ${dist}/index.html does not exist in the checkout — build it in your own CI and commit the result`);
    }
  } else if (!entry.assigned.port) {
    throw new Error(`web: with no "dist" the origin is proxied to your process, so you must also rent "host"`);
  }

  return {
    env: { WEB_PUBLIC_URL: origin },
    rented: { origin, dist, root, spa: dist ? options.spa !== false : false, port: dist ? null : entry.assigned.port },
    summary: `${origin} → ${dist ? `${dist}/ (static${options.spa === false ? "" : ", SPA fallback"})` : `127.0.0.1:${entry.assigned.port}`}`,
  };
}
