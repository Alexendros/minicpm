#!/usr/bin/env bash
set -euo pipefail
BASE="$HOME/minicpm"
BIN="$BASE/bin/llama-server"
MODEL="$BASE/models/MiniCPM5-1B-Q4_K_M.gguf"
LOG="$BASE/logs/minicpm5-1b.log"
PIDFILE="$BASE/logs/minicpm5-1b.pid"

mkdir -p "$BASE/logs"
nohup "$BIN" -m "$MODEL" --host 127.0.0.1 --port 8080 \
  -ngl 0 -c 4096 -t 8 >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "MiniCPM5-1B (CPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:8080 (log: $LOG)"