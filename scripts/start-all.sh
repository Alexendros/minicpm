#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"

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

wait_http() {
  local url="$1" tries="$2"
  for _ in $(seq 1 "$tries"); do
    if curl -s -o /dev/null --max-time 1 "$url" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_one minicpm4-8b
wait_http "http://127.0.0.1:8081/v1/models" 60 || echo "aviso: 8B no responde aún, continúo"
start_one minicpm5-1b
wait_http "http://127.0.0.1:8080/v1/models" 45 || echo "aviso: 1B no responde aún, continúo"
start_one embed
wait_http "http://127.0.0.1:8002/health" 45 || echo "aviso: embed no responde aún, continúo"
start_one rerank
wait_http "http://127.0.0.1:8003/health" 45 || echo "aviso: rerank no responde aún, continúo"
start_one gui
wait_http "http://127.0.0.1:8090/" 30 || echo "aviso: GUI no responde aún"
echo "Todo listo: GUI en http://127.0.0.1:8090"