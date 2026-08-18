# MiniCPM Desktop — Backend, funcionalidad y capacidades

Propuesta de evolución sobre [Alexendros/minicpm](https://github.com/Alexendros/minicpm). Parte del código actual (`app/main.py`, `vectorstore.py`, `mail.py`, `scripts/*`) y de las fichas oficiales MiniCPM4.1 / MiniCPM5 / RAG Suite.

No introduce YAML. Contratos en JSON, orquestación en bash, lógica en Python.

---

## Estado actual del backend

Cinco procesos independientes, sin supervisor, unidos por HTTP localhost.

| Proceso | Puerto | Runtime | Persistencia |
|---|---|---|---|
| MiniCPM5-1B Q4 | 8080 | llama-server, `-ngl 0 -c 4096` | ninguna |
| MiniCPM4.1-8B Q4 | 8081 | llama-server, `-ngl 99 -fa -c 4096` | ninguna |
| Embedding-Light | 8002 | uvicorn + transformers 4.37.2 CPU | ninguna |
| Reranker-Light | 8003 | uvicorn + transformers 4.37.2 CPU | ninguna |
| GUI / orquestador | 8090 | FastAPI `main:app` | `app/data/kb.db`, `mail_creds.json` |

Fortalezas a conservar:

- Bind exclusivo a `127.0.0.1`.
- Separación `venv-llm` (descargas) / `venv-rag` (runtime CPU, torch CPU).
- Arranque en cascada en `start-all.sh` para no congelar GNOME.
- RAG con citas `[Fuente N]` y rerank opcional.
- Correo solo vía Proton Bridge local.

Techo de hardware (Aero X16, 8 GB VRAM): un único slot 8B en GPU. El 1B, embed y rerank permanecen en CPU/RAM (32 GiB).

---

## Capa 0 — Configuración única

Hoy puertos, rutas y flags están copiados en bash, Python y JS. Un solo origen:

`scripts/env.sh` (sourced por todos los start-*.sh):

```bash
export MINICPM_HOME="${MINICPM_HOME:-$HOME/minicpm}"
export MINICPM_GUI_PORT=8090
export MINICPM_5B_PORT=8080
export MINICPM_8B_PORT=8081
export MINICPM_EMBED_PORT=8002
export MINICPM_RERANK_PORT=8003
export MINICPM_CTX=4096
export MINICPM_NGL_8B=99
export MINICPM_NGL_5B=0
export MINICPM_TEMP=0.7
export MINICPM_TOP_P=0.95
export MINICPM_EMBED_DIR="$MINICPM_HOME/models/embed"
export MINICPM_RERANK_DIR="$MINICPM_HOME/models/rerank"
```

`app/config.py` lee las mismas variables. El front obtiene puertos de `GET /api/meta` (no hardcodear `RTX 5060` ni puertos en `app.js`).

Contrato `GET /api/meta`:

```json
{
  "home": "/home/USUARIO/minicpm",
  "ctx": 4096,
  "services": {
    "5-1b": {"port": 8080, "device": "cpu", "model": "MiniCPM5-1B-Q4_K_M.gguf"},
    "8b": {"port": 8081, "device": "cuda", "model": "MiniCPM4.1-8B-Q4_K_M.gguf"},
    "embed": {"port": 8002, "device": "cpu"},
    "rerank": {"port": 8003, "device": "cpu"}
  },
  "sampling": {"temperature": 0.7, "top_p": 0.95, "think_temperature": 0.9}
}
```

---

## Capa 1 — Supervisor

`nohup` + pidfiles no cubren reboot, OOM de la 5060 ni logs rotados.

Objetivo: unidades de usuario systemd (INI, no YAML). Nombres:

- `minicpm-8b.service`
- `minicpm-5b.service`
- `minicpm-embed.service`
- `minicpm-rerank.service`
- `minicpm-gui.service`

Propiedades mínimas por unidad:

- `Type=simple`
- `Restart=on-failure`
- `RestartSec=3`
- `After=network-online.target`
- `minicpm-gui` After los cuatro (o `Wants=` sin bloquear si el 8B tarda)
- `EnvironmentFile=%h/minicpm/scripts/env.sh` no es nativo; exportar un `env.list` `KEY=VAL` (formato dotenv, no YAML)

Hasta entonces, `flock -n "$MINICPM_HOME/logs/$name.lock"` en cada `start-*.sh` para impedir doble spawn.

`GET /api/services` debe devolver máquina de estados, no un bool:

```json
{
  "8b": {
    "state": "starting",
    "port": 8081,
    "pid": 14221,
    "uptime_s": 12,
    "ready": false
  }
}
```

Estados: `stopped`, `starting`, `running`, `error`. Transición a `running` solo con healthcheck (`/v1/models` o `/health`).

Mutex de arranque: no permitir `POST /api/services/8b/start` y `5-1b/start` en la misma ventana de 30 s si `load_average > 12` (el README ya documenta el freeze de GNOME).

---

## Capa 2 — Slot GPU

La 5060 Laptop tiene 8 GB. Política:

| Contenido del slot | VRAM aprox. | Cuándo |
|---|---|---|
| MiniCPM4.1-8B Q4_K_M | ~5 GB + KV (`-c 4096` ~1 GB) | Chat calidad, RAG, redacción |
| Vacío | 0 | Ahorro / iGPU only |
| Futuro: MiniCPM-V 4.5 INT4 | ~6–7 GB | PDF escaneado / captura (swap, no coexistir) |
| Futuro: MiniCPM4-MCP | ~5 GB | Notion/FS/docs vía MCP (swap) |

API:

```http
POST /api/slot
Content-Type: application/json

{"occupant": "8b"}
```

Valores: `none`, `8b`, `v45`, `mcp`. El orquestador para el ocupante anterior, espera VRAM `< 1500 MiB`, arranca el nuevo, espera health.

No implementar V/MCP en el primer sprint; dejar el enumerado y un `503` con mensaje claro.

Subir `-c` del 8B a 8192 solo si `memory.used + estimado_kv < 0.85 * total`. Estimación KV Q4 8B: ~0,5–1,0 MiB por token de contexto (medir en esta máquina y fijar constante en `config.py`).

---

## Capa 3 — Chat y compatibilidad OpenAI

Hoy `/api/chat` es un proxy SSE incompleto (ver documento de fallos). Objetivo de capacidad:

1. Reinyectar historial de sesión recortado.
2. `max_tokens` 2048 (chat) / 1024 (RAG).
3. Abortar: `AbortController` en el cliente + cerrar el `httpx.stream` al disconnect (`request.is_disconnected` en FastAPI).
4. Exponer también:

```http
POST /v1/chat/completions
```

en `:8090`, para OpenCode / otros agentes, con `model` ∈ `5-1b` | `8b`. Cabecera opcional `X-Api-Key` leída de `MINICPM_API_KEY` (aunque el bind sea localhost: un túnel futuro no debe quedar abierto).

5. Sampling por petición:

```json
{
  "model": "8b",
  "messages": [{"role": "user", "content": "…"}],
  "no_think": true,
  "session_id": 3,
  "temperature": 0.7,
  "top_p": 0.95,
  "max_tokens": 2048
}
```

Si `no_think=false` y `model=8b`, forzar `temperature=0.9` salvo override explícito, y no añadir `/no_think`.

6. Diferenciar `content` y `reasoning_content` en el guardado de sesión (ahora se pierde el razonamiento).

---

## Capa 4 — RAG (prioridad del usuario)

Pipeline actual: upload → `chunk_text` 1200 chars → embed lote 8 → SQLite blob → cosine Python → rerank opcional → prompt extractivo.

### Ingestión

- Formatos: txt, md, json, pdf (ya). Añadir docx (`python-docx`) y HTML→texto (`trafilatura` o `html2text`).
- Un documento = hash SHA-256 del binario; rechazar duplicados.
- Metadatos por chunk: `doc_id`, `filename`, `chunk_idx`, `page` (PDF), `char_start`, `char_end`.
- Overlap 180 caracteres. Partir por párrafo, luego por frase, luego por ventana.
- Cola: la subida actual bloquea el worker uvicorn. Pasar a `BackgroundTasks` o un proceso `scripts/ingest_worker.py` y devolver `{"id", "state":"indexing"}`.

### Recuperación

- `top_k_retrieve = 12`, `top_k_rerank = 4` (hoy `top_k * 3` si rerank).
- Prefijo `Query:` solo en encode_query (ya en `embed_api.py`). No prefixar el corpus.
- Si rerank está caído, degradar a cosine y marcar `rerank: false` en la respuesta (hoy se silencia el fallo).
- Umbral: si el mejor cosine `< 0.15` (calibrar), responder “no hay contexto” **antes** de llamar al 8B.

### Generación

- Streaming en `/api/rag` (mismo enmarcado SSE que el chat).
- Prompt: conservar el extractivo. Añadir idioma forzado `Responde en español.` si la UI está en `es`.
- Modelo por defecto `8b`. Si piden `5-1b`, advertir (el README ya documenta que el 1B falla en prompts largos) o recortar contexto a 2 fuentes.
- Citas: devolver `sources[].chunk_id` para que la UI enlace al chunk completo, no solo 500 caracteres.

### Índice

Fase A (ahora): WAL + FK + tope 3000 chunks.
Fase B: `sqlite-vec` virtual table en la misma `kb.db`.
Fase C: usearch si se supera 50k vectores.

### Correo → KB

Acción `POST /api/documents/from-mail` `{"uid": 123}`: body texto + asunto + from como metadatos. No indexar HTML crudo.

---

## Capa 5 — Embed y rerank en un solo proceso

Dos procesos transformers 4.37.2 duplican import time y RAM (~2–4 GiB extra). Unificar:

`scripts/rag_runtime.py`

- `POST /embed` (igual que ahora)
- `POST /rerank`
- `GET /health` → `{"embed": true, "rerank": true, "device": "cpu"}`

Cargar ambos modelos al arrancar. `OMP_NUM_THREADS=4` global. `nice -n 5`. Torch CPU only.

Mantener puertos 8002/8003 detrás de un proxy interno o un único `8002` y actualizar `main.py`. Preferible un puerto (`8002`) para simplificar `SERVICES`.

---

## Capa 6 — Correo

Además de UID SEARCH/FETCH/STORE (documento de fallos):

- Listar carpetas (`LIST`) y seleccionar `INBOX`, `Sent`, etc.
- Adjuntos: metadatos (`filename`, `ctype`, `size`), no volcar binarios a la GUI. `GET /api/mail/attachment?uid=&part=` solo a disco temporal 0600 si se pide.
- Responder: cabeceras `In-Reply-To` y `References` con el `Message-ID` original (hoy el compose es un mail nuevo).
- Rate limit: máximo 1 FETCH completo cada 200 ms para no tumbar Bridge.
- Secretos: `secret-tool` / libsecret; API `POST /api/mail/config` no debe persistir si `secret-tool` está disponible.

No es un cliente Proton completo. Alcance: leer, buscar, marcar, enviar texto, indexar a RAG.

---

## Capa 7 — Observabilidad

| Señal | Origen | Exposición |
|---|---|---|
| VRAM used/total/util | `nvidia-smi` (ya) | `/api/gpu` + nombre GPU |
| Load average | `/proc/loadavg` | `/api/host` |
| Tokens/s | parsear log llama o `timings` de la API | `/api/services/{name}` |
| Health | probes | `/api/services` |
| Errores GUI | log uvicorn | `logs/gui.log` rotado |

Rotación: `savelog` o tamaño 10 MiB × 3 copias en cada `start-*.sh` antes del nohup.

No scrapear Prometheus en v1. Un JSON cada 5 s basta.

---

## Capa 8 — Pruebas y suministro

`requirements-rag.txt` (pinado, generado desde el venv que ya funciona):

```text
transformers==4.37.2
fastapi
uvicorn
httpx
pypdf
python-multipart
sentencepiece
protobuf
numpy
torch
```

Instalar torch con el index CPU, como el README.

`scripts/smoke_test.sh` debe ganar tres casos:

1. Los cuatro health (ya).
2. `POST http://127.0.0.1:8090/api/chat` SSE → contenido no vacío.
3. Fixture `tests/fixtures/rtx5060.txt` → upload → `/api/rag` contiene una cita.

Opcional: `scripts/download.sh` con `hf download` de los cuatro artefactos oficiales (nombres de fichero exactos).

---

## Capa 9 — Integración OpenCode / MCP

El usuario ya tiene `.agents/` y `mcp/index.md`. El Desktop no debe convertirse en un host MCP todavía.

Puente mínimo:

- `8090/v1/chat/completions` para que un agente use el 8B/1B local.
- Documentar en README que Notion MCP sigue siendo el servidor oficial; MiniCPM4-MCP (swap de slot) es fase posterior.
- No mezclar tool-calls XML de MiniCPM5 con `/think` de 4.1 en el mismo parser.

---

## Hoja de ruta

| Sprint | Entrega | Criterio |
|---|---|---|
| 0 | P0 del documento de fallos (SSE, jinja, historial) | Chat en 8090 pinta tokens |
| 1 | `env.sh` + `/api/meta` + health states + flock | Un solo origen de puertos |
| 2 | RAG: overlap, hash, umbral, streaming, sources.chunk_id | Fixture RAG estable |
| 3 | Runtime único embed+rerank | −1 proceso, smoke igual |
| 4 | Slot API + systemd user | Reboot recupera el stack |
| 5 | `/v1/chat/completions` + API key + mail UID/reply headers | OpenCode habla con 8090 |
| 6 | sqlite-vec + correo→KB + docx | KB usable de verdad |

Fuera de alcance hasta que el slot esté vacío de forma fiable: MiniCPM-V 4.5, MiniCPM4-MCP, InfLLM/CPM.cu, `-c 131072`.
