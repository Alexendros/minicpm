#!/usr/bin/env bash
set -uo pipefail
BASE="$HOME/minicpm"
FIX="$BASE/tests/fixtures/rtx5060.txt"
FAIL=0

if [ "${1:-}" = "--start" ]; then
  echo "== Arrancando stack =="
  "$BASE/scripts/start-all.sh"
fi

wait_http() {
  local url="$1" timeout="${2:-180}" i=0
  while [ "$i" -lt "$timeout" ]; do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 2; i=$((i + 2))
  done
  return 1
}

echo "== Caso 1/3: Healths =="
wait_http http://127.0.0.1:8080/v1/models 180 && echo "OK 8080 MiniCPM5-1B listo" || { echo "FAIL 8080 no responde"; FAIL=1; }
wait_http http://127.0.0.1:8081/v1/models 300 && echo "OK 8081 MiniCPM4.1-8B listo" || { echo "FAIL 8081 no responde"; FAIL=1; }
wait_http http://127.0.0.1:8002/health 120 && echo "OK 8002 rag (embed+rerank) listo" || { echo "FAIL 8002 no responde"; FAIL=1; }
wait_http http://127.0.0.1:8090/ 30 && echo "OK 8090 GUI listo" || { echo "FAIL 8090 GUI no responde"; FAIL=1; }
H=$(curl -s http://127.0.0.1:8002/health)
echo "health 8002: $H"
echo "$H" | grep -q '"embed":true' && echo "$H" | grep -q '"rerank":true' && echo "OK 8002 health embed+rerank" || { echo "FAIL 8002 health flags"; FAIL=1; }

echo "== Caso 2/3: Chat SSE =="
echo "-- Smoke 8080: 1+1=? --"
R1=$(curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"1+1=?"}],"max_tokens":64}')
echo "$R1" | head -c 400; echo
echo "$R1" | grep -q '2' && echo "OK 8080 responde con 2" || { echo "FAIL 8080 sin '2'"; FAIL=1; }

echo "-- Smoke 8081: Di hola /no_think --"
R2=$(curl -s http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Di hola /no_think"}],"max_tokens":128}')
echo "$R2" | head -c 500; echo
if echo "$R2" | grep -qiE '"content":"[^"]+"'; then echo "OK 8081 genera texto"; else { echo "FAIL 8081 sin texto"; FAIL=1; }; fi

echo "-- Smoke GUI 8090: SSE chat --"
SSE=$(python3 - <<'EOF'
import json, urllib.request
req = urllib.request.Request(
    "http://127.0.0.1:8090/api/chat",
    data=json.dumps({"model": "8b", "messages": [{"role": "user", "content": "1+1=?"}], "session_id": None}).encode(),
    headers={"Content-Type": "application/json"},
)
content = ""
with urllib.request.urlopen(req, timeout=120) as r:
    for raw in r:
        line = raw.decode().strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            delta = json.loads(payload)["choices"][0]["delta"].get("content") or ""
            content += delta
        except Exception:
            pass
print(content)
EOF
)
echo "content: ${SSE:0:120}..."
[ -n "$SSE" ] && echo "OK 8090 SSE pinta tokens ($(echo -n "$SSE" | wc -m) chars)" || { echo "FAIL 8090 SSE sin contenido"; FAIL=1; }

echo "== Caso 3/3: RAG con cita =="
echo "-- Embed cosine > 0 --"
R3=$(curl -s http://127.0.0.1:8002/embed -H 'Content-Type: application/json' \
  -d '{"query":true,"texts":["¿qué es una RTX 5060?"]}')
R3B=$(curl -s http://127.0.0.1:8002/embed -H 'Content-Type: application/json' \
  -d '{"query":false,"texts":["La RTX 5060 es una tarjeta gráfica NVIDIA con 8GB de VRAM."]}')
C=$(python3 - "$R3" "$R3B" <<'EOF'
import json, sys, math
v1 = json.loads(sys.argv[1])["vectors"][0]
v2 = json.loads(sys.argv[2])["vectors"][0]
dot = sum(a*b for a, b in zip(v1, v2))
n1 = math.sqrt(sum(a*a for a in v1)); n2 = math.sqrt(sum(a*a for a in v2))
print(dot / (n1*n2))
EOF
)
echo "cosine = $C"
python3 -c "exit(0 if float('$C') > 0 else 1)" && echo "OK 8002 cosine > 0" || { echo "FAIL 8002 cosine <= 0"; FAIL=1; }

echo "-- Rerank beijing > shanghai --"
R4=$(curl -s http://127.0.0.1:8002/rerank -H 'Content-Type: application/json' \
  -d '{"query":"capital de china","docs":["Beijing es la capital de China.","Shanghai es la ciudad más poblada de China."]}')
echo "$R4"
python3 - "$R4" <<'EOF'
import json, sys
s = json.loads(sys.argv[1])["scores"]
exit(0 if s[0] > s[1] else 1)
EOF
[ $? -eq 0 ] && echo "OK 8002 beijing > shanghai" || { echo "FAIL 8002 ranking invertido"; FAIL=1; }

echo "-- RAG con cita (fixture tests/fixtures/rtx5060.txt) --"
[ -f "$FIX" ] && echo "OK fixture existe" || { echo "FAIL fixture $FIX no existe"; FAIL=1; }
UP=$(curl -s -X POST http://127.0.0.1:8090/api/documents -F "file=@$FIX")
echo "upload: $UP"
DOC_ID=$(echo "$UP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id', 0))")
READY=0
for _ in $(seq 1 15); do
  ST=$(curl -s http://127.0.0.1:8090/api/documents)
  if echo "$ST" | python3 -c "import json,sys; sys.exit(0 if any(d.get('id')==$DOC_ID and d.get('status')=='ready' for d in json.load(sys.stdin).get('documents',[])) else 1)"; then
    READY=1; break
  fi
  sleep 2
done
[ "$READY" -eq 1 ] && echo "OK documento indexado (ready)" || { echo "FAIL documento no indexado a tiempo"; FAIL=1; }
RAG=$(curl -s -X POST http://127.0.0.1:8090/api/rag -H 'Content-Type: application/json' \
  -d '{"query":"¿qué VRAM tiene la RTX 5060?","top_k":4,"model":"8b","no_think":true}')
echo "rag: $(echo "$RAG" | head -c 300)"
python3 - "$RAG" <<'EOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
    ok = bool(d.get("answer")) and isinstance(d.get("sources"), list) and len(d["sources"]) > 0
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
EOF
[ $? -eq 0 ] && echo "OK RAG responde con fuentes" || { echo "FAIL RAG sin answer/sources"; FAIL=1; }
if [ -n "$DOC_ID" ] && [ "$DOC_ID" != "0" ]; then
  curl -s -X DELETE "http://127.0.0.1:8090/api/documents/$DOC_ID" >/dev/null || true
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "SMOKE: TODOS OK"; else echo "SMOKE: FALLOS DETECTADOS"; fi
exit "$FAIL"