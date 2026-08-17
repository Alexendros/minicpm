#!/usr/bin/env bash
set -euo pipefail
BASE="$HOME/minicpm"

start_one() {
  local s="$1"
  local pidfile="$BASE/logs/$s.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$s: ya corriendo"
    return 0
  fi
  echo "$s: iniciando…"
  "$BASE/scripts/start-$s.sh" >/dev/null
}

wait_port() {
  local port="$1" tries="$2"
  for _ in $(seq 1 "$tries"); do
    if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_one minicpm4-8b
wait_port 8081 60 || echo "aviso: 8B no responde aún, continúo"
start_one minicpm5-1b
wait_port 8080 45 || echo "aviso: 1B no responde aún, continúo"
start_one embed
wait_port 8002 45 || echo "aviso: embed no responde aún, continúo"
start_one rerank
wait_port 8003 45 || echo "aviso: rerank no responde aún, continúo"
start_one gui
echo "Todo listo: GUI en http://127.0.0.1:8090"