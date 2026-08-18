# MiniCPM Desktop

Stack **local-first** de modelos MiniCPM sobre llama.cpp con interfaz web propia: chat con dos modelos (rápido y de calidad), base de conocimiento RAG con fuentes citadas, gestión de servicios y correo de Proton Mail Bridge. **100% offline**: nada sale de tu máquina.

## Qué incluye

| Servicio | Puerto | Modelo | Función |
|---|---|---|---|
| LLM rápido | `8080` | MiniCPM5-1B Q4_K_M (CPU) | Chat rápido |
| LLM calidad | `8081` | MiniCPM4.1-8B Q4_K_M (GPU) | Chat + RAG |
| Embeddings | `8002` | MiniCPM-Embedding-Light (CPU) | Vectoriza documentos y consultas |
| Reranker | `8003` | MiniCPM-Reranker-Light (CPU) | Reordena resultados por relevancia |
| **GUI** | `8090` | — | Interfaz web: http://127.0.0.1:8090 |

## Requisitos

- **Hardware**: ~16 GiB RAM (29 GiB recomendados), GPU NVIDIA con ≥6 GiB VRAM para el 8B (opcional: sin GPU, el 8B va en CPU con `-ngl 0`)
- **Software**: Linux (probado en Ubuntu 26.04), Python 3.12, `cmake`, `git`, `curl`, driver NVIDIA + CUDA toolkit (solo para GPU)

## Instalación (una vez)

### 1. Estructura de carpetas

```bash
mkdir -p ~/minicpm/{models,bin,scripts,logs}
cd ~/minicpm
```

### 2. Python 3.12 + entornos virtuales

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install -y python3.12 python3.12-venv

python3.12 -m venv venv-llm    # descargas de HuggingFace
python3.12 -m venv venv-rag    # runtime de la GUI (CPU)

venv-llm/bin/pip install huggingface_hub
venv-rag/bin/pip install -r requirements-rag.txt
# torch SOLO CPU (deja la GPU al 8B):
venv-rag/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
```

### 3. llama.cpp (con soporte CUDA)

```bash
git clone --depth=1 https://github.com/ggerganov/llama.cpp.git src/llama.cpp
cmake -S src/llama.cpp -B src/llama.cpp/build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build src/llama.cpp/build -j$(nproc) --target llama-cli llama-server
ln -s src/llama.cpp/build/bin/llama-server bin/llama-server
ln -s src/llama.cpp/build/bin/llama-cli bin/llama-cli
```

### 4. Modelos

```bash
venv-llm/bin/hf download openbmb/MiniCPM5-1B-GGUF MiniCPM5-1B-Q4_K_M.gguf --local-dir models
venv-llm/bin/hf download openbmb/MiniCPM4.1-8B-GGUF MiniCPM4.1-8B-Q4_K_M.gguf --local-dir models
venv-llm/bin/hf download openbmb/MiniCPM-Embedding-Light --local-dir models/embed
venv-llm/bin/hf download openbmb/MiniCPM-Reranker-Light --local-dir models/rerank
```

### 5. Comprobar

```bash
bash scripts/smoke_test.sh
```

Debe terminar con `SMOKE: TODOS OK` (los 4 servicios tienen que estar corriendo, ver abajo).

## Arranque y parada

```bash
~/minicpm/scripts/start-all.sh    # arranca los 5 procesos en orden (tarda ~1 min en cargar el 8B)
~/minicpm/scripts/stop-all.sh     # detiene todo
bash ~/minicpm/scripts/smoke_test.sh   # revalida el sistema en cualquier momento
```

> **Importante**: usa siempre `start-all.sh`. Lanzar los servicios sueltos a la vez satura la CPU y puede congelar la interfaz gráfica del sistema (los hilos están limitados por servicio y el arranque es en cascada a propósito).

Abre la GUI: **http://127.0.0.1:8090**

## Uso de la GUI

### Pestaña Chat
1. Elige modelo: **8b** (calidad, GPU) o **5-1b** (rápido, CPU)
2. Marca **/no_think** para respuestas directas; si no, el razonamiento se muestra en un desplegable
3. **Sesiones**: el selector de arriba guarda cada conversación automáticamente (SQLite). Botones **Nueva** / **Borrar** — sobreviven a reinicios

### Pestaña Base de conocimiento
1. **Sube documentos** (txt, md, json, pdf) — se trocean por párrafos y se vectorizan
2. **Busca**: top-k por similitud; marca *rerank* para reordenar con el reranker
3. **Responder (RAG)**: pregunta con contexto del documento y respuesta **citando fuentes** `[Fuente N]` (desplegables con el texto usado)

### Pestaña Servicios
- GPU en vivo (MiB usados/total, % utilidad)
- Estado de los 5 procesos con botones **Iniciar/Parar**
- Logs de cada uno (últimas 40 líneas)

### Pestaña Correo (Proton Mail Bridge)
Requisito: Proton Mail Bridge corriendo en la máquina (IMAP `127.0.0.1:1143`, SMTP `127.0.0.1:1025`).

1. La primera vez, rellena el formulario: tu email Proton + **la contraseña generada por Bridge** (app Bridge → cuenta → «Detalles del buzón» — no es la contraseña de tu cuenta). Se guarda en el llavero del sistema con `secret-tool` (sin escribir contraseñas en disco; `app/data/mail_creds.json` solo se lee como respaldo de instalaciones antiguas)
2. **No leídos** carga la bandeja; los campos de búsqueda filtran por remitente/asunto/texto/fecha (con acentos incluidos)
3. Al abrir un correo: botones **leído/no leído**, **Responder** (pre-rellena destinatario y `Re:`)
4. **Redactar** envía por SMTP. La lista se refresca sola cada 60s

## API (para scripts propios)

| Endpoint | Descripción |
|---|---|
| `POST /api/chat` | Chat OpenAI-compatible, streaming SSE (`model`, `messages`, `no_think`, `session_id`) |
| `POST /api/documents` | Subir documento (multipart) |
| `GET /api/search?query=&top_k=&rerank=` | Búsqueda vectorial (+ rerank opcional) |
| `POST /api/rag` | Pregunta con contexto (`query`, `top_k`, `model`, `no_think`) |
| `GET/POST /api/sessions`, `DELETE /api/sessions/{id}` | Sesiones de chat |
| `GET /api/mail/status` · `/unread` · `/search` · `/fetch?uid=` · `POST /mark` · `/send` | Correo |
| `GET /api/services` · `POST /api/services/{name}/start\|stop` · `GET /api/gpu` · `GET /api/logs/{name}` | Gestión |

Los servicios base hablan OpenAI-compatible directamente en `8080`/`8081`.

## Estructura de directorios

```
~/minicpm/
├── app/            # GUI: main.py (orquestador), vectorstore.py, mail.py, static/ (frontend)
├── scripts/        # arranque/parada/smoke + APIs embed/rerank
├── models/         # GGUF y modelos HF (NO versionado)
├── venv-llm/       # descargas HF (NO versionado)
├── venv-rag/       # runtime GUI (NO versionado)
├── src/llama.cpp/  # build de llama.cpp (NO versionado)
├── bin/            # symlinks a llama-server/cli
└── logs/           # logs + PIDs (NO versionado)
```

## Privacidad

- Nada sale de tu máquina: los 5 servicios escuchan solo en `127.0.0.1`
- Tus documentos (`kb.db`) y credenciales de correo (en el llavero del sistema) **no** se versionan en git
- El cuerpo de los correos se muestra como **texto plano** extraído del HTML (sin iframe ni scripts)

## Solución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| RAG responde «No contexto proporcionado» con modelo 5-1b | El 1B es débil con prompts largos | Usa el modelo **8b** para RAG |
| La interfaz del sistema se congela al arrancar | Lanzamiento simultáneo de servicios (thrashing CPU) | `stop-all.sh` y luego `start-all.sh` |
| Login de correo rechazado | Se usa la contraseña de la cuenta Proton | Usa la **contraseña generada por Bridge** |
| Error de certificado TLS del Bridge | Certificado autofirmado (normal) | La verificación TLS se desactiva solo para el Bridge local (`127.0.0.1`); un host remoto produce un error explícito en `app/mail.py` |
| `Connection refused` en correo | Bridge parado o puertos cambiados | Arranca Bridge; revisa puertos en la app Bridge |

## Próximos planes

El fichero [`tasks.md`](tasks.md) pre-anuncia los 3 planes de trabajo por orden: **solución de errores**, **hardening backend** y **UI/UX**. Cada plan se ejecuta en su propia iteración y se cierra con verificación y commit.

## Mantenimiento (git)

El repo GitHub (privado) es la copia de control del código:

```bash
git -C ~/minicpm log --oneline      # historial
git -C ~/minicpm status             # cambios pendientes
```