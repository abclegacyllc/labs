#!/usr/bin/env bash
# What this machine needs to run Labs, and how to get it.
#
#   tools/requirements.sh check     report only — safe anywhere  (make requirements)
#   tools/requirements.sh install   install what is missing      (make setup)
#
# Labs itself has no dependencies: the CLI, the gateway and the site builder are
# plain node with nothing from npm. What a machine needs is node, git, caddy, and
# — for anything to survive a reboot — systemd lingering.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

NODE_MIN=22
missing=()
notes=()

green() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

check_node() {
  if ! have node; then red "node — not installed (need $NODE_MIN or newer)"; missing+=(node); return; fi
  local v; v=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$v" -lt "$NODE_MIN" ]; then red "node $(node -v) — too old, need $NODE_MIN or newer"; missing+=(node)
  else green "node $(node -v)"; fi
}

check_simple() { # name, human note
  if have "$1"; then green "$1 $("$1" --version 2>/dev/null | head -1 | cut -c1-40)"
  else red "$1 — $2"; missing+=("$1"); fi
}

echo
echo "  Required"
check_node
check_simple git "not installed"
check_simple caddy "not installed — it terminates TLS and routes both hostnames"

echo
echo "  The machine"
if have systemctl && systemctl --user is-system-running >/dev/null 2>&1; then green "systemd --user is running"
else warn "systemd --user is not fully running — units will not work here"; fi

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then green "lingering is on — units start at boot"
else warn "lingering is off — units will NOT start at boot"; notes+=("sudo loginctl enable-linger $USER"); fi

if [ -f .env ]; then green ".env present"
else warn ".env not present — defaults are used (see .env.example)"; notes+=("cp .env.example .env"); fi

main=/etc/caddy/Caddyfile
line="import $PWD/var/Caddyfile"
imports=$(grep -cxF "$line" "$main" 2>/dev/null || true)
if [ "${imports:-0}" -eq 1 ]; then green "caddy imports $PWD/var/Caddyfile"
elif [ "${imports:-0}" -gt 1 ]; then
  red "caddy imports it $imports times — the config on disk is INVALID (ambiguous site definition)"
  red "  it is serving whatever it loaded first; the next restart would fail"
  notes+=("sudo sed -i '\\|^$line\$|d' $main && echo '$line' | sudo tee -a $main")
  notes+=("caddy validate --adapter caddyfile --config $main && sudo systemctl reload caddy")
else
  warn "caddy does not import this checkout's Caddyfile — the public hostnames will not be served"
  notes+=("make render   # writes var/Caddyfile")
  notes+=("echo '$line' | sudo tee -a $main && sudo systemctl reload caddy")
fi

# What is actually on the air, which can differ from the file after a failed reload.
if command -v curl >/dev/null 2>&1; then
  live=$(curl -s --max-time 2 http://127.0.0.1:2019/config/apps/http/servers 2>/dev/null)
  case "$live" in
    *"$(node -p 'new URL(process.env.LABS_URL||require("./registry.json").site.labsUrl).host' 2>/dev/null)"*)
      green "the running caddy is serving the Labs hostnames" ;;
    "") warn "caddy admin API not answering on 127.0.0.1:2019 — cannot tell what is on the air" ;;
    *)  warn "the running caddy does NOT serve the Labs hostnames yet — reload it" ;;
  esac
fi

# Caddy runs as its own user and must be able to walk down to site/dist. o+x on
# the home directory grants traversal only — the directory still cannot be listed.
home=$(dirname "$PWD")
if [ "$(stat -c '%A' "$home" | cut -c10)" = x ]; then green "$home is traversable by caddy"
else warn "$home is not traversable by caddy — the catalog would answer 403"
  notes+=("sudo chmod o+x $home   # traversal only; the directory still cannot be listed"); fi

if [ ${#notes[@]} -gt 0 ]; then
  echo
  echo "  To fix by hand"
  for n in "${notes[@]}"; do echo "    $n"; done
fi

action="${1:-check}"
if [ "$action" != install ]; then
  echo
  if [ ${#missing[@]} -eq 0 ]; then echo "  Nothing required is missing."
  else echo "  Missing: ${missing[*]}   →  make setup"; fi
  echo
  exit 0
fi

if [ ${#missing[@]} -eq 0 ]; then echo; echo "  Nothing to install."; echo; exit 0; fi

echo
echo "  About to install: ${missing[*]}"
echo "  This uses sudo and adds the Node and Caddy repositories."
read -r -p "  Continue? [y/N] " a
[ "$a" = y ] || [ "$a" = Y ] || { echo "  cancelled"; exit 1; }

for m in "${missing[@]}"; do
  case "$m" in
    node)
      echo "  installing node $NODE_MIN.x"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN}.x" | sudo -E bash - || exit 1
      sudo apt-get install -y nodejs || exit 1
      ;;
    git) sudo apt-get install -y git || exit 1 ;;
    caddy)
      echo "  installing caddy"
      sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl || exit 1
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg || exit 1
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null || exit 1
      sudo apt-get update && sudo apt-get install -y caddy || exit 1
      ;;
  esac
done

echo
"$0" check
