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

# Exactly what a human types after changing anything: unit files, listings,
# build, processes. One copy of those steps, in the Makefile, so a deploy from
# CI and a deploy by hand cannot drift.
make restart

echo "platform: done"
