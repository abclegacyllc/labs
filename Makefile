# Everything needed to run ABC Legacy Labs. Run `make` on its own for the list.
#
# Two things run on this machine and the Makefile keeps them apart:
#   the PLATFORM   labs-*.service          — Labs's own capabilities (the mcp gateway)
#   the PROJECTS   labs-project-*.service  — guests, one unit each, written by `labs deploy`
#
# All of them are systemd USER units, so nothing here needs sudo. `make setup` is
# the one exception: installing node, git or caddy is the machine's business, not
# Labs's, and it asks for sudo itself.

SHELL := /bin/bash
LABS  := bin/labs
REQ   := tools/requirements.sh

# Every unit this repository owns. A .timer's matching .service is a one-shot job
# the timer fires (labs-sync); it is installed but never enabled or started on
# its own — so it is kept out of PLATFORM_UNITS, which are the long-running ones.
PLATFORM_TIMERS  := $(notdir $(wildcard infra/systemd/labs-*.timer))
PLATFORM_ONESHOT := $(PLATFORM_TIMERS:.timer=.service)
PLATFORM_UNITS   := $(filter-out $(PLATFORM_ONESHOT),$(notdir $(wildcard infra/systemd/labs-*.service)))
UNIT_DIR         := $(if $(XDG_CONFIG_HOME),$(XDG_CONFIG_HOME),$(HOME)/.config)/systemd/user
PROJECT_UNITS     = $(shell systemctl --user list-unit-files 'labs-project-*.service' --no-legend 2>/dev/null | awk '{print $$1}')
UNITS             = $(PLATFORM_UNITS) $(PROJECT_UNITS)
GATEWAY_PORT   ?= 8800

.DEFAULT_GOAL := help
.PHONY: help requirements setup units install uninstall start stop restart bounce redeploy status logs tail \
        sync deploy remove render list check dev clean nuke platform-start platform-stop caddy

help:
	@echo ''
	@echo '  ABC Legacy Labs'
	@echo ''
	@echo '  Running it'
	@echo '    make install         hand the platform units to systemd — survive reboots and crashes'
	@echo '    make restart         THE one after any change: unit files, listings, build, processes'
	@echo '    make start           start the platform and every deployed project'
	@echo '    make stop            stop them'
	@echo '    make bounce          restart the processes only — no fetch, no build'
	@echo '    make status          what is up, what is listed, and is the gateway answering'
	@echo '    make logs            last 40 lines from each unit'
	@echo '    make tail            follow every unit live (ctrl-c to leave)'
	@echo ''
	@echo '  The catalog and the projects'
	@echo '    make sync            read every allowlisted repo'"'"'s abc-labs/labs.json, then render (also nightly, by timer)'
	@echo '    make deploy ID=<id>  clone/pull one guest project, provision, start it'
	@echo '    make redeploy        pull and redeploy every project Labs has a checkout of'
	@echo '    make remove ID=<id>  stop it and delete var/projects/<id>/ — everything Labs held about it'
	@echo '    make render          rebuild routes, catalog, pages and index.json'
	@echo '    make list            what is listed, where it runs, what it rents'
	@echo ''
	@echo '  While working on Labs itself'
	@echo '    make check           syntax, docs, the examples, a render, caddy validate'
	@echo '    make dev             run the mcp gateway in the foreground on port 18800'
	@echo '    make clean           remove site/dist'
	@echo ''
	@echo '  Setting up a machine'
	@echo '    make requirements    what this box has and what it is missing'
	@echo '    make setup           install whatever is missing (asks for sudo)'
	@echo '    make caddy           the two lines root types once to serve the public hostnames'
	@echo ''
	@echo '  Platform only, when a project must keep running: make platform-start, platform-stop'
	@echo ''

# ── setting up a machine ──────────────────────────────────────

# Reads only — safe anywhere, and the first thing to try when a fresh server
# behaves as though the code were broken.
requirements:
	@$(REQ) check

# Installs what `make requirements` found missing. Asks first, because it uses
# sudo and fetches from the Node and Caddy repositories.
setup:
	@$(REQ) install

# Everything after this is sudo-free; these two lines are the exception, and they
# are typed once per machine. `make render` writes var/Caddyfile; the system Caddy
# is told to import it, and from then on Labs reloads Caddy over its admin API.
caddy:
	@$(LABS) render --no-reload >/dev/null
	@main=/etc/caddy/Caddyfile; line="import $$PWD/var/Caddyfile"; \
	n=$$(grep -cxF "$$line" $$main 2>/dev/null || true); n=$${n:-0}; \
	echo ''; \
	if [ "$$n" = 1 ]; then \
		echo "  Already wired — $$main imports $$PWD/var/Caddyfile"; \
		echo '  Nothing to do here; changes reach Caddy through make render.'; \
	elif [ "$$n" -gt 1 ]; then \
		echo "  PROBLEM: that import appears $$n times in $$main."; \
		echo '  Caddy is running on the config it loaded first, but the file on disk is invalid'; \
		echo '  and the next restart or reboot would take every site on this machine down.'; \
		echo ''; \
		echo '  Fix, as root (idempotent — removes every copy, adds one):'; \
		echo ''; \
		echo "    sudo sed -i '\\|^$$line\$$|d' $$main"; \
		echo "    echo '$$line' | sudo tee -a $$main"; \
		echo "    caddy validate --adapter caddyfile --config $$main && sudo systemctl reload caddy"; \
	else \
		echo '  Once, as root:'; \
		echo ''; \
		echo "    sudo chmod o+x $$(dirname $$PWD)"; \
		echo "    echo '$$line' | sudo tee -a $$main"; \
		echo '    sudo systemctl reload caddy'; \
		echo ''; \
		echo '  Run it ONCE — appending it twice makes the config ambiguous and Caddy'; \
		echo '  refuses to start. `make caddy` again will tell you if that happened.'; \
		echo ''; \
		echo '  Then: make install && make sync'; \
	fi; \
	echo ''

# ── the units ─────────────────────────────────────────────────

# Copies the platform units into the user's systemd directory and enables them.
# Project units are written by `labs deploy` and are already enabled; they are
# left alone here.
# The unit files, copied and re-read. Shared by install and restart, because a
# unit that changed in git changes nothing until both of these have happened.
units:
	@mkdir -p '$(UNIT_DIR)'
	@for u in $(PLATFORM_UNITS) $(PLATFORM_ONESHOT) $(PLATFORM_TIMERS); do cp infra/systemd/$$u '$(UNIT_DIR)'/$$u; done
	@systemctl --user daemon-reload

install: units
	@for u in $(PLATFORM_UNITS) $(PLATFORM_ONESHOT) $(PLATFORM_TIMERS); do echo "  $$u"; done
	@systemctl --user enable --now $(PLATFORM_UNITS) $(PLATFORM_TIMERS)
	@# Copying a unit changes nothing until it restarts — that is how a broken
	@# hardening directive stayed invisible for three days.
	@systemctl --user restart $(PLATFORM_UNITS)
	@if [ "$$(loginctl show-user "$$USER" -p Linger --value 2>/dev/null)" != yes ]; then \
		echo; echo "  NOTE: lingering is off — these will NOT start at boot."; \
		echo "        Once, as root:  loginctl enable-linger $$USER"; \
	fi
	@$(MAKE) --no-print-directory status

# Hands the platform back. Deployed projects keep running: they are separate
# units, and stopping someone else's project is never a side effect here.
uninstall:
	@systemctl --user disable --now $(PLATFORM_UNITS) $(PLATFORM_TIMERS) 2>&1 | sed 's/^/  /' || true
	@for u in $(PLATFORM_UNITS) $(PLATFORM_ONESHOT) $(PLATFORM_TIMERS); do rm -f '$(UNIT_DIR)'/$$u; done
	@systemctl --user daemon-reload
	@echo "  platform units removed. Projects were left running — make stop to stop everything."

# ── running ───────────────────────────────────────────────────

start:
	@systemctl --user start $(UNITS) 2>&1 | sed 's/^/  /' || true
	@$(MAKE) --no-print-directory status

stop:
	@systemctl --user stop $(UNITS) 2>&1 | sed 's/^/  /' || true
	@echo "  stopped: $(words $(UNITS)) unit(s)"

# THE command after any change. Four steps, in the only order that works: a unit
# file is no use until systemd re-reads it; the listings decide what gets
# rendered; the render decides what Caddy serves; and only then is there a point
# in restarting a process. Every step is safe to repeat, so this is safe to run
# when you are not sure what changed — which is most of the time.
#
# It does NOT pull guest repositories: that would run install commands from
# somebody else's project as a side effect of restarting yours. `make redeploy`
# does that, on purpose and by itself.
restart:
	@echo ''
	@echo '  1/4  unit files → systemd'
	@$(MAKE) --no-print-directory units
	@echo '  2/4  listings ← every allowlisted repository'
	@$(LABS) sync --no-render 2>&1 | sed 's/^/       /' || echo '       sync failed — listings kept as they were'
	@echo '  3/4  routes, catalog, Caddyfile'
	@$(LABS) render 2>&1 | sed 's/^/       /'
	@echo '  4/4  processes'
	@systemctl --user restart $(UNITS) 2>&1 | sed 's/^/       /' || true
	@$(MAKE) --no-print-directory status

# Just the processes — no fetch, no build. For when you know that is all you want.
bounce:
	@systemctl --user restart $(UNITS) 2>&1 | sed 's/^/  /' || true
	@$(MAKE) --no-print-directory status

# Pull and redeploy every project Labs has a checkout of. Separate from restart
# because it runs each project's own install command.
redeploy:
	@$(LABS) deploy --all

platform-start:
	@systemctl --user start $(PLATFORM_UNITS) && $(MAKE) --no-print-directory status

platform-stop:
	@systemctl --user stop $(PLATFORM_UNITS) && echo "  platform stopped; projects untouched"

# What is up, what is listed, and does the gateway actually answer — the last
# part matters because a unit can be "active" while the process inside is wedged.
status:
	@echo ''
	@echo '  Units'
	@if [ -z "$(strip $(UNITS))" ]; then echo '    none installed — make install'; fi
	@for u in $(UNITS); do \
		state=$$(systemctl --user is-active $$u 2>/dev/null); \
		since=$$(systemctl --user show $$u -p ActiveEnterTimestamp --value 2>/dev/null | cut -d' ' -f2-3); \
		printf '    %-34s %-10s %s\n' "$$u" "$$state" "$$since"; \
	done
	@for t in $(PLATFORM_TIMERS); do \
		state=$$(systemctl --user is-active $$t 2>/dev/null); \
		next=$$(systemctl --user show $$t -p NextElapseUSecRealtime --value 2>/dev/null | cut -d' ' -f2-3); \
		last=$$(systemctl --user show $${t%.timer}.service -p ExecMainExitTimestamp --value 2>/dev/null | cut -d' ' -f2-3); \
		printf '    %-34s %-10s next %s%s\n' "$$t" "$$state" "$${next:-—}" "$${last:+  (last run $$last)}"; \
	done
	@echo ''
	@echo '  Gateway'
	@code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$(GATEWAY_PORT)/healthz 2>/dev/null); \
		if [ "$$code" = 200 ]; then echo "    127.0.0.1:$(GATEWAY_PORT)/healthz  ok"; \
		else echo "    127.0.0.1:$(GATEWAY_PORT)/healthz  no answer ($${code:-unreachable})"; fi
	@echo ''
	@echo '  Listed'
	@$(LABS) list 2>/dev/null | sed 's/^/    /' || echo '    nothing yet — make sync'
	@echo ''

logs:
	@for u in $(UNITS); do echo "── $$u"; journalctl --user -u $$u -n 40 --no-pager 2>/dev/null | sed 's/^/  /'; echo; done

tail:
	@journalctl --user $(foreach u,$(UNITS),-u $(u)) -f --no-pager

# ── the catalog and the projects ──────────────────────────────

sync:
	@$(LABS) sync

# make deploy ID=svg
deploy:
	@if [ -z "$(ID)" ]; then echo "usage: make deploy ID=<project id>   (make list to see them)"; exit 1; fi
	@$(LABS) deploy $(ID)

# make remove ID=svg
remove:
	@if [ -z "$(ID)" ]; then echo "usage: make remove ID=<project id>   (make list to see them)"; exit 1; fi
	@$(LABS) remove $(ID)

render:
	@$(LABS) render

list:
	@$(LABS) list

# ── working on Labs itself ────────────────────────────────────

check:
	@npm run check --silent

# The gateway in the foreground, on a port that cannot collide with the running
# one, so it can be poked with curl without touching what is deployed.
dev:
	@echo "  http://127.0.0.1:18800/   (ctrl-c to stop)"
	@GATEWAY_PORT=18800 node --env-file-if-exists=.env platform/mcp/server.mjs

clean:
	@rm -rf site/dist && echo "  site/dist removed — make render to rebuild"

# Removes ALL realized state — every var/projects/<id>/ folder and the generated
# routes. The platform units and the allowlist survive; `make sync` and
# `make deploy` rebuild the rest. Asks first: a project's env file may hold a
# token, and its unit symlink in systemd's directory is removed with it.
nuke:
	@for u in $(PROJECT_UNITS); do systemctl --user disable --now $$u 2>/dev/null; rm -f '$(UNIT_DIR)'/$$u; done; systemctl --user daemon-reload
	@read -p "  remove var/ (every project folder: checkout, listing, env, unit)? [y/N] " a; \
		if [ "$$a" = y ] || [ "$$a" = Y ]; then rm -rf var site/dist && echo "  gone. make sync to start again."; else echo "  left alone"; fi
