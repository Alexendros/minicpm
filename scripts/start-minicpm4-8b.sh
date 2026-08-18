#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
acquire_lock minicpm4-8b || { echo "minicpm4-8b: ya corriendo"; exit 0; }
BIN="$BASE/bin/llama-server"
MODEL="$BASE/models/MiniCPM4.1-8B-Q4_K_M.gguf"
LOG="$BASE/logs/minicpm4-8b.log"
PIDFILE="$BASE/logs/minicpm4-8b.pid"

mkdir -p "$BASE/logs"
rotate_log "$LOG"
nohup "$BIN" -m "$MODEL" --host 127.0.0.1 --port "$MINICPM_8B_PORT" \
  -ngl "$MINICPM_NGL_8B" -fa on -c "$MINICPM_CTX" "${LLAMA_COMMON[@]}" >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "MiniCPM4.1-8B (GPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:$MINICPM_8B_PORT (log: $LOG)"