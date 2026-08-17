#!/usr/bin/env bash
set -euo pipefail
BASE="$HOME/minicpm"
for pidfile in "$BASE"/logs/*.pid; do
  [ -f "$pidfile" ] || continue
  name=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" && echo "$name: parado"
  else
    echo "$name: no estaba corriendo"
  fi
done
echo "Stack detenido"