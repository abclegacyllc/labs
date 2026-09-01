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

# Every unit this repository owns, platform first.
PLATFORM_UNITS := $(notdir $(wildcard infra/systemd/labs-*.service))
UNIT_DIR       := $(if $(XDG_CONFIG_HOME),$(XDG_CONFIG_HOME),$(HOME)/.config)/systemd/user
PROJECT_UNITS   = $(shell systemctl --user list-unit-files 'labs-project-*.service' --no-legend 2>/dev/null | awk '{print $$1}')
UNITS           = $(PLATFORM_UNITS) $(PROJECT_UNITS)
GATEWAY_PORT   ?= 8800

.DEFAULT_GOAL := help
.PHONY: help requirements setup install uninstall start stop restart status logs tail \
        sync deploy render list check dev clean nuke platform-start platform-stop

help:
	@echo ''
	@echo '  ABC Legacy Labs'
	@echo ''
	@echo '  Running it'
	@echo '    make install         hand the platform units to systemd — survive reboots and crashes'
	@echo '    make start           start the platform and every deployed project'
	@echo '    make stop            stop them'
	@echo '    make restart         stop, then start'
	@echo '    make status          what is up, what is listed, and is the gateway answering'
	@echo '    make logs            last 40 lines from each unit'
	@echo '    make tail            follow every unit live (ctrl-c to leave)'
	@echo ''
	@echo '  The catalog and the projects'
	@echo '    make sync            read every allowlisted repo'"'"'s abc-labs/labs.json, then render'
	@echo '    make deploy ID=<id>  clone/pull one guest project, provision, start it'
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

# ── the units ─────────────────────────────────────────────────

# Copies the platform units into the user's systemd directory and enables them.
# Project units are written by `labs deploy` and are already enabled; they are
# left alone here.
install:
	@mkdir -p '$(UNIT_DIR)'
	@for u in $(PLATFORM_UNITS); do cp infra/systemd/$$u '$(UNIT_DIR)'/$$u && echo "  $$u"; done
	@systemctl --user daemon-reload
	@systemctl --user enable --now $(PLATFORM_UNITS)
	@if [ "$$(loginctl show-user "$$USER" -p Linger --value 2>/dev/null)" != yes ]; then \
		echo; echo "  NOTE: lingering is off — these will NOT start at boot."; \
		echo "        Once, as root:  loginctl enable-linger $$USER"; \
	fi
	@$(MAKE) --no-print-directory status

# Hands the platform back. Deployed projects keep running: they are separate
# units, and stopping someone else's project is never a side effect here.
uninstall:
	@systemctl --user disable --now $(PLATFORM_UNITS) 2>&1 | sed 's/^/  /' || true
	@for u in $(PLATFORM_UNITS); do rm -f '$(UNIT_DIR)'/$$u; done
	@systemctl --user daemon-reload
	@echo "  platform units removed. Projects were left running — make stop to stop everything."

# ── running ───────────────────────────────────────────────────

start:
	@systemctl --user start $(UNITS) 2>&1 | sed 's/^/  /' || true
	@$(MAKE) --no-print-directory status

stop:
	@systemctl --user stop $(UNITS) 2>&1 | sed 's/^/  /' || true
	@echo "  stopped: $(words $(UNITS)) unit(s)"

restart:
	@systemctl --user restart $(UNITS) 2>&1 | sed 's/^/  /' || true
	@$(MAKE) --no-print-directory status

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

# Removes the realized state: checkouts, listings, routes, env files. The
# platform units and the allowlist survive; `make sync` and `make deploy` rebuild
# the rest. Asks first, because var/env holds tokens handed to projects.
nuke:
	@read -p "  remove var/ (project checkouts, listings, routes, env files)? [y/N] " a; \
		if [ "$$a" = y ] || [ "$$a" = Y ]; then rm -rf var site/dist && echo "  gone. make sync to start again."; else echo "  left alone"; fi
