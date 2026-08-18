#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
acquire_lock gui || { echo "gui: ya corriendo"; exit 0; }
cd "$BASE"
mkdir -p "$BASE/logs"
rotate_log "$BASE/logs/gui.log"
nohup "$BASE/venv-rag/bin/python" -m uvicorn main:app --app-dir "$BASE/app" --host 127.0.0.1 --port "$MINICPM_GUI_PORT" --log-level warning > "$BASE/logs/gui.log" 2>&1 &
echo $! > "$BASE/logs/gui.pid"
echo "GUI arrancada en http://127.0.0.1:$MINICPM_GUI_PORT (PID $!)"