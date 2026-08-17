#!/usr/bin/env bash
set -euo pipefail
BASE="$HOME/minicpm"
BIN="$BASE/bin/llama-server"
MODEL="$BASE/models/MiniCPM4.1-8B-Q4_K_M.gguf"
LOG="$BASE/logs/minicpm4-8b.log"
PIDFILE="$BASE/logs/minicpm4-8b.pid"

mkdir -p "$BASE/logs"
nohup "$BIN" -m "$MODEL" --host 127.0.0.1 --port 8081 \
  -ngl 99 -fa on -c 4096 >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "MiniCPM4.1-8B (GPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:8081 (log: $LOG)"