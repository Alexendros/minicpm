# Progreso — Plan backend 02

## Sesión 2026-08-18
- [x] Copiado `02-backend-funcionalidad-capacidades.md` a `docs/`.
- [x] Creado `docs/task_plan.md` (9 fases) y `docs/findings.md`.
- [x] Fase 1 (Capa 0): env.sh + config.py + /api/meta + frontend
- [x] Fase 2 (Capa 1): flock + estados + mutex
- [x] Fase 3 (Capa 3): abort SSE, /v1, sampling, reasoning
- [x] Fase 4 (Capa 4): RAG
- [x] Fase 5 (Capa 5): runtime unificado
- [x] Fase 6 (Capa 6): correo
- [x] Fase 7 (Capa 7): observabilidad
- [ ] Fase 8 (Capa 8): pruebas
- [ ] Fase 9 (Capa 2+9): slot + systemd

## Sesión 2026-08-18 (cont.) — Fase 3 verificada
- [x] `AbortController` + botón Cancelar en `index.html`; servidor cierra `httpx.stream` al disconnect (probado cortando SSE a 1.5 s, GUI sigue respondiendo).
- [x] `POST /v1/chat/completions` en 8090: validada X-Api-Key (401 sin header / header malo, 200 con clave), shape OpenAI (id, object, created, model, choices, usage), streaming y no-stream.
- [x] Sampling por petición: `_sampling()` (temp/top_p/max_tokens); `no_think=false` + 8b → temp 0.9 (THINK_TEMP).
- [x] Sesión guarda `content` + `reasoning_content` diferenciados (verificado con 5-1b: content vacío, reasoning 185 chars guardado; segundo turno acumula 2 mensajes).
- Nota: condición de guardado corregida a `(content or reason)` porque 5-1B a veces solo emite reasoning.
## Sesión 2026-08-18 (cont.) — Fase 4 verificada
- [x] Hash SHA-256 binario en `api_upload`; duplicados → 409 (probado re-subiendo mismo txt).
- [x] Metadatos por chunk: `chunk_text_meta()` devuelve `{text, page, char_start, char_end}`; columnas nuevas via `_ensure_columns` (ALTER TABLE); `fill_document()` inserta con metadatos.
- [x] Formatos docx (python-docx) y html/htm (html2text) indexados OK; PDF por página con `page=i`.
- [x] Ingestión async con `BackgroundTasks` → `{"id", "state":"indexing"}`; `_ingest_document` embebe en background y marca `status: error` si falla.
- [x] `top_k_retrieve=12` / `top_k_rerank=4`; rerank caído → `rerank: false` y orden por cosine.
- [x] Umbral cosine 0.15: consulta ajena (best 0.107) → "No hay contexto suficiente…" sin llamar al 8B.
- [x] Streaming `/api/rag` SSE: eventos `sources` → `delta` (content/reasoning) → `done` → `[DONE]`; también cubierto el caso sin contexto por SSE.
- [x] `sources[].chunk_id` presente; idioma forzado con `lang` (prompt añade "Responde en español.").
- [x] Limpieza: docs de prueba 2/8/9/10 borrados vía DELETE; chunk huérfano (doc_id 1, previo a sesión) eliminado por SQL; `kb.db` a 0 docs / 0 chunks.
- Nota: embeddings de la consulta "paella" dieron best 0.1599 (>0.15) → pasa umbral correctamente.
## Sesión 2026-08-18 (cont.) — Fase 5 verificada
- [x] `scripts/rag_runtime.py` unificado: carga embed + rerank en un proceso; `POST /embed`, `POST /rerank`, `GET /health {ok, embed, rerank, device}`.
- [x] Un puerto (8002): `SERVICES` de main.py con embed y rerank compartiendo port/script/pidfile; `_is_alive` lee el flag del health unificado; eliminados `embed_api.py`, `rerank_api.py`, `start-embed.sh`, `start-rerank.sh`; `start-rag.sh` nuevo.
- [x] `/api/services` verificado: embed y rerank con el mismo pid (98688) en 8002; `/api/meta` con ambos en 8002; health `{"ok":true,"embed":true,"rerank":true,"device":"cpu"}`.
- [x] Embed cosine 0.7094; rerank beijing (0.9999) > shanghai (0.2665) vía 8002.
- [x] `smoke_test.sh`: SMOKE: TODOS OK. RAG añade polling de `status=='ready'` tras el upload (ingesta async) antes de consultar; respuesta con `[Fuente 1]` y sources>0.
- [x] README actualizado: 4 procesos, tabla de servicios con "Embeddings + reranker | 8002".
- Nota: `chmod +x` aplicado a todos los `.sh` (env.sh/lib.sh quedan sin +x, se invocan con `.`).

## Sesión 2026-08-18 (cont.) — Fase 6 verificada
- [x] `LIST` carpetas vía Bridge: 30 carpetas (INBOX, Sent, Archive, All Mail, Drafts, Spam, Trash, Starred, Labels/*, Folders/*...). Selector de carpeta en la GUI (`#mail-folder`) que recarga `loadMailUnread` y aplica `folder` a unread/search/fetch/mark/attachment.
- [x] Adjuntos: metadatos `{part, filename, ctype, size}` en fetch (uid 617: publickey .asc application/pgp-keys 731 B); `GET /api/mail/attachment?uid=&part=` devuelve FileResponse a disco temporal 0600 borrado con BackgroundTask. Descarga PGP key real OK.
- [x] Responder: `mail.send(to, subject, body, in_reply_to, references)` añade cabeceras In-Reply-To/References; botón Responder en GUI setea contexto de hilo. Correo "Prueba Fase 6: hilo" enviado; el Bridge de Proton normaliza las cabeceras al entregar (asigna su propio internalid), por lo que el hilo se conserva pero con id interno — comportamiento del Bridge, no del código.
- [x] Rate limit: `_throttle_fetch()` 200 ms mínimo entre FETCH completos (medido 0.278 s entre dos fetch).
- [x] Bug corregido: el Bridge de Proton no soporta CHARSET `UTF-8` en `UID SEARCH` (error BAD "unknown search key 'utf'"). Fix: search siempre filtra en Python (SEARCH IMAP solo con criterios ASCII UNSEEN/SINCE/ALL, luego filtro local por from_/subject/text). Eliminadas helpers `_has_non_ascii` y `_quoted`.

## Sesión 2026-08-18 (cont.) — Fase 7 verificada
- [x] `GET /api/host` → `{load_avg: [1m, 5m, 15m], uptime_h}` desde `/proc/loadavg` (probado: `{"load_avg":[1.6,2.2,2.37],"uptime_h":2.74}`).
- [x] `tokens_per_s` en `/api/services`: parsea el log llama buscando el último "X tokens per second" de las líneas `slot print_timing: ... eval time` (probado: 5-1b → 80.12, 8b → 38.16; embed/rerank → null por no ser llm).
- [x] Rotación de logs: `rotate_log()` en `lib.sh` (tamaño 10 MiB × 3 copias, rota `log → log.1 → log.2 → log.3`); invocada en start-minicpm4-8b, start-minicpm5-1b, start-rag y start-gui antes de redirigir.
- Nota: para `/api/host` se reubicó `_boot_time`/`_boot_time_cache` (eliminada copia duplicada) y se añadió `_boot_time_runtime()`. GUI reiniciada (PID 110646) con la Fase 7 cargada.

## Sesión 2026-08-18 (cont.) — Fase 8 verificada
- [x] `requirements-rag.txt` pinado completo con versiones instaladas en venv-rag (transformers 4.37.2, fastapi 0.141.1, uvicorn 0.52.3, httpx 0.28.1, pypdf 6.16.1, python-multipart 0.0.32, sentencepiece 0.2.2, protobuf 7.35.1, numpy 2.5.2, python-docx 1.2.0, html2text 2025.4.15). torch aparte (2.13.0+cpu, index CPU).
- [x] Fixture `tests/fixtures/rtx5060.txt` con 2 líneas (KB vectorial sqlite y RTX 5060 8 GB VRAM).
- [x] `smoke_test.sh` reorganizado en 3 casos: (1) Healths 8080/8081/8002/8090 + flags embed/rerank del health unificado; (2) Chat SSE: 8080 "1+1=?" contiene 2, 8081 "Di hola /no_think" genera texto, SSE 8090 /api/chat; (3) RAG con cita: cosine 8002, rerank beijing>shanghai, upload fixture → polling ready → RAG "¿qué VRAM tiene la RTX 5060?" → "La RTX 5060 tiene 8 GB de VRAM. [Fuente 1]" con sources>0 → DELETE.
- [x] `scripts/download.sh` (opcional): `hf download` de los 4 modelos (2 GGUF Q4_K_M + embed + rerank), detecta `hf` en venv-llm o venv-rag.
- [x] `smoke_test.sh` completo → `SMOKE: TODOS OK` (3/3 casos). kb.db limpia tras DELETE.

## Sesión 2026-08-18 (cont.) — Fase 9 verificada
- [x] `POST /api/slot` con enumerado none/8b/v45/mcp: valores v45/mcp → 503 ("no disponible en esta versión"), valor inválido → 400, GET devuelve ocupante actual.
- [x] Swap de slot verificado: POST {"occupant":"none"} para el 8B y espera VRAM < 1500 MiB antes de arrancar el nuevo (POST {"occupant":"8b"} → running, chat OK).
- [x] systemd user units en `systemd/`: 4 units (minicpm-8b, minicpm-5b, minicpm-rag, minicpm-gui) con Type=forking + PIDFile por el patrón nohup+pidfile, Restart=on-failure, RestartSec=3, EnvironmentFile=scripts/env.list, Wants/After encadenados. `systemd-analyze --user verify` OK; instaladas, habilitadas y `is-active` inactive (stack actual sigue con flock).
- [x] `scripts/env.list` dotenv con rutas absolutas (MINICPM_HOME, puertos, CTX, NGL, sampling, EMBED_DIR, RERANK_DIR).
- [x] README: sección "Arranque automático (systemd user)", filas de API actualizadas (v1/chat/completions, mail, host, slot) y subsección "Agentes / OpenCode" (curl a /v1 con X-Api-Key; Notion MCP sigue siendo el servidor MCP oficial).
- Nota: 4 units en vez de 5 por el runtime unificado de Fase 5 (rag engloba embed+rerank); enable sin `--now` para no tocar el stack activo.
