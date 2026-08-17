#!/usr/bin/env bash
set -euo pipefail
BASE="$HOME/minicpm"
PY="$BASE/venv-rag/bin/python"
LOG="$BASE/logs/rerank.log"
PIDFILE="$BASE/logs/rerank.pid"

mkdir -p "$BASE/logs"
OMP_NUM_THREADS=4 TOKENIZERS_PARALLELISM=false nice -n 5 nohup "$PY" -m uvicorn rerank_api:app --app-dir "$BASE/scripts" \
  --host 127.0.0.1 --port 8003 --log-level warning >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "Rerank API (CPU) PID $(cat "$PIDFILE") -> http://127.0.0.1:8003 (log: $LOG)"