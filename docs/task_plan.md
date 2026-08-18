# Plan de trabajo — Backend, funcionalidad y capacidades

Fuente: `docs/02-backend-funcionalidad-capacidades.md` (copiado de `~/Descargas`).
Proyecto: [Alexendros/minicpm](https://github.com/Alexendros/minicpm).
Cada fase se cierra con verificación (`scripts/smoke_test.sh`) y commit al repo.

## Objetivo

Evolucionar el backend del Desktop: configuración única, supervisor con estados,
chat/OpenAI-compatible, RAG robusto, runtime unificado, correo completo,
observabilidad y suministro. Respetar el techo de hardware (8 GB VRAM, un slot 8B).

## Fases

### Fase 1 — Capa 0: Configuración única
- Status: complete
- [x] `scripts/env.sh` con todas las variables (MINICPM_HOME, puertos, ctx, ngl, sampling, dirs)
- [x] `app/config.py` leyendo las mismas variables
- [x] `GET /api/meta` devolviendo home, ctx, services, sampling
- [x] Frontend `app.js` lee puertos de `/api/meta` (quitar RTX 5060 y puertos hardcodeados)
- Criterio: `GET /api/meta` responde y `curl /api/services` usa las mismas vars

### Fase 2 — Capa 1: Supervisor
- Status: complete
- [x] `flock -n` en cada start-*.sh (impedir doble spawn)
- [x] `/api/services` con máquina de estados: stopped, starting, running, error + pid, uptime_s, ready
- [x] Transición a `running` solo con healthcheck (`/v1/models` o `/health`)
- [x] Mutex de arranque: no dos LLM en ventana de 30 s si load_average > 12
- Criterio: doble `start` no duplica proceso; estado `running` solo con health OK

### Fase 3 — Capa 3: Chat y compatibilidad OpenAI
- Status: complete
- [x] Abortar SSE: `AbortController` en cliente + cerrar `httpx.stream` al disconnect
- [x] `POST /v1/chat/completions` en 8090 (model ∈ 5-1b | 8b), cabecera opcional `X-Api-Key` desde `MINICPM_API_KEY`
- [x] Sampling por petición: temperature, top_p, max_tokens; `no_think=false` → temp 0.9 en 8b
- [x] Guardar `reasoning_content` y `content` diferenciados en sesión
- Criterio: SSE abortable; OpenCode habla con 8090/v1 con clave; sesión conserva razonamiento

### Fase 4 — Capa 4: RAG
- Status: complete
- [x] Hash SHA-256 del binario; rechazar duplicados
- [x] Metadatos por chunk: doc_id, filename, chunk_idx, page (PDF), char_start, char_end
- [x] Formatos docx (`python-docx`) y HTML→texto
- [x] Ingestión en background (`BackgroundTasks` o `scripts/ingest_worker.py`) → `{"id", "state":"indexing"}`
- [x] `top_k_retrieve=12`, `top_k_rerank=4`
- [x] Umbral: mejor cosine < 0.15 → "no hay contexto" antes de llamar al 8B
- [x] Streaming en `/api/rag` (SSE)
- [x] Idioma forzado "Responde en español." si UI en es
- [x] `sources[].chunk_id` para enlazar al chunk completo
- [x] Rerank caído → degradar a cosine con `rerank: false` en respuesta
- Criterio: fixture RAG estable; subida no bloquea worker; duplicados rechazados

### Fase 5 — Capa 5: Runtime único embed+rerank
- Status: complete
- [x] `scripts/rag_runtime.py` con `POST /embed`, `POST /rerank`, `GET /health`
- [x] Un puerto (8002); actualizar `main.py`, start scripts y smoke
- Criterio: smoke_test idéntico con 1 proceso menos

### Fase 6 — Capa 6: Correo
- Status: complete
- [x] Listar carpetas (`LIST`) y seleccionar INBOX, Sent, etc.
- [x] Adjuntos: metadatos (filename, ctype, size); `GET /api/mail/attachment?uid=&part=` a disco temporal 0600
- [x] Responder: cabeceras `In-Reply-To` y `References` con Message-ID original
- [x] Rate limit: máx 1 FETCH completo cada 200 ms
- Criterio: responder genera hilo; adjunto solo bajo demanda

### Fase 7 — Capa 7: Observabilidad
- Status: complete
- [x] `GET /api/host` (load average desde /proc/loadavg)
- [x] Tokens/s en `/api/services/{name}` (parsear log llama o timings)
- [x] Rotación de logs: 10 MiB × 3 copias en start-*.sh (savelog o tamaño)
- Criterio: señales en JSON; logs rotan

### Fase 8 — Capa 8: Pruebas y suministro
- Status: complete
- [x] `requirements-rag.txt` pinado completo
- [x] Fixture `tests/fixtures/rtx5060.txt`
- [x] `smoke_test.sh` con 3 casos: healths, SSE chat, RAG con cita
- [x] Opcional: `scripts/download.sh` con `hf download`
- Criterio: `SMOKE: TODOS OK`

### Fase 9 — Capa 2 + Capa 9 (dependencias posteriores)
- Status: complete
- [x] `POST /api/slot` con enumerado none/8b/v45/mcp y 503 para V/MCP
- [x] Swap de slot: parar ocupante, esperar VRAM < 1500 MiB, arrancar nuevo
- [x] systemd user units (minicpm-*.service) + env.list
- [x] Documentar integración OpenCode vía `/v1` en README
- Criterio: reboot recupera el stack

## Fuera de alcance

MiniCPM-V 4.5, MiniCPM4-MCP, InfLLM/CPM.cu, `-c 131072`, Prometheus, host MCP completo.

## Next Step

Plan completo (Fases 1-9) ejecutado y verificado.