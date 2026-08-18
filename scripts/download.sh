#!/usr/bin/env bash
set -euo pipefail
BASE="${MINICPM_HOME:-$HOME/minicpm}"
MODELS="$BASE/models"
cd "$BASE"

HF=""
for c in "$BASE/venv-llm/bin/hf" "$BASE/venv-rag/bin/hf"; do
  if [ -x "$c" ]; then HF="$c"; break; fi
done
if [ -z "$HF" ]; then
  echo "error: no hay cliente 'hf' en venv-llm ni venv-rag" >&2
  exit 1
fi

echo "== Descargando modelos con $HF =="
mkdir -p "$MODELS/embed" "$MODELS/rerank"

echo "== MiniCPM5-1B (llama.cpp GGUF) =="
"$HF" download openbmb/MiniCPM5-1B-GGUF MiniCPM5-1B-Q4_K_M.gguf --local-dir "$MODELS"

echo "== MiniCPM4.1-8B (llama.cpp GGUF) =="
"$HF" download openbmb/MiniCPM4.1-8B-GGUF MiniCPM4.1-8B-Q4_K_M.gguf --local-dir "$MODELS"

echo "== MiniCPM-Embedding-Light =="
"$HF" download openbmb/MiniCPM-Embedding-Light --local-dir "$MODELS/embed"

echo "== MiniCPM-Reranker-Light =="
"$HF" download openbmb/MiniCPM-Reranker-Light --local-dir "$MODELS/rerank"

echo "Descarga completada en $MODELS"