#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"

acquire_lock rag || { echo "rag: ya corriendo"; exit 0; }

PY="$BASE/venv-rag/bin/python"
LOG="$BASE/logs/rag.log"
PIDFILE="$BASE/logs/rag.pid"
mkdir -p "$BASE/logs"
rotate_log "$LOG"

OMP_NUM_THREADS=4 TOKENIZERS_PARALLELISM=false nice -n 5 nohup "$PY" -m uvicorn rag_runtime:app --app-dir "$BASE/scripts" --host 127.0.0.1 --port "$MINICPM_EMBED_PORT" --log-level warning >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "RAG Runtime (embed+rerank, CPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:$MINICPM_EMBED_PORT (log: $LOG)"