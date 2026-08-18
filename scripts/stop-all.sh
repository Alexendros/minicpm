#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/env.sh"
BASE="${MINICPM_HOME:-$HOME/minicpm}"
for pidfile in "$BASE"/logs/*.pid; do
  [ -f "$pidfile" ] || continue
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "$name: parado"
  else
    echo "$name: no estaba corriendo"
  fi
  rm -f "$pidfile"
done
echo "Stack detenido"