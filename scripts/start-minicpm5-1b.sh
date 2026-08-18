#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
acquire_lock minicpm5-1b || { echo "minicpm5-1b: ya corriendo"; exit 0; }
BIN="$BASE/bin/llama-server"
MODEL="$BASE/models/MiniCPM5-1B-Q4_K_M.gguf"
LOG="$BASE/logs/minicpm5-1b.log"
PIDFILE="$BASE/logs/minicpm5-1b.pid"

mkdir -p "$BASE/logs"
rotate_log "$LOG"
nohup "$BIN" -m "$MODEL" --host 127.0.0.1 --port "$MINICPM_5B_PORT" \
  -ngl "$MINICPM_NGL_5B" -c "$MINICPM_CTX" -t 8 "${LLAMA_COMMON[@]}" >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "MiniCPM5-1B (CPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:$MINICPM_5B_PORT (log: $LOG)"