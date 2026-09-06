#!/usr/bin/env bash
# Deploys the PLATFORM — Labs itself. Runs on the server, as the user Labs runs as:
#
#     cd ~/labs && ./infra/deploy.sh
#
# Guest projects are deployed separately, one at a time: `make deploy ID=<id>`.
# Idempotent, no sudo: user units under lingering, caddy reload via the admin API.
#
# Everything here that could also be typed by hand IS the Makefile — one copy of
# each step, so `make install` on the server and a deploy from CI cannot drift.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

before=$(git rev-parse HEAD)
git pull --ff-only
echo "platform: $before → $(git rev-parse HEAD)"

make install

# Listings may have changed upstream (a project edited its abc-labs/labs.json);
# routes and the catalog are re-rendered either way. sync needs the network, so
# it may fail; that must not stop the deploy.
make sync || echo "sync failed — listings kept as they were"
make render

echo "platform: done"
