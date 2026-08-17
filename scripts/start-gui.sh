#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
nohup venv-rag/bin/python -m uvicorn main:app --app-dir app --host 127.0.0.1 --port 8090 --log-level warning > logs/gui.log 2>&1 &
echo $! > logs/gui.pid
echo "GUI arrancada en http://127.0.0.1:8090 (PID $!)"