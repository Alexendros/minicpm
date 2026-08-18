import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field

import mail
from vectorstore import (
    append_session_messages,
    chunk_text_meta,
    count_chunks,
    count_documents,
    create_document,
    create_session,
    delete_document,
    delete_session,
    fill_document,
    find_doc_by_sha,
    get_session_messages,
    list_documents,
    list_sessions,
    mark_document_error,
    search,
)
import config

BASE = config.HOME
SCRIPTS = BASE / "scripts"
LOGS = BASE / "logs"
STATIC = Path(__file__).parent / "static"

SERVICES = {
    "5-1b": {"port": config.PORT_5B, "script": "start-minicpm5-1b.sh", "log": "minicpm5-1b.log", "kind": "llm", "device": "cpu", "model": "MiniCPM5-1B"},
    "8b": {"port": config.PORT_8B, "script": "start-minicpm4-8b.sh", "log": "minicpm4-8b.log", "kind": "llm", "device": "gpu", "model": "MiniCPM4.1-8B"},
    "embed": {"port": config.EMBED_PORT, "script": "start-rag.sh", "log": "rag.log", "kind": "health", "device": "cpu", "model": config.EMBED_DIR.rsplit("/", 1)[-1]},
    "rerank": {"port": config.EMBED_PORT, "script": "start-rag.sh", "log": "rag.log", "kind": "health", "device": "cpu", "model": config.RERANK_DIR.rsplit("/", 1)[-1]},
}
EMBED_URL = f"http://127.0.0.1:{config.EMBED_PORT}"
RERANK_URL = f"http://127.0.0.1:{config.EMBED_PORT}"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_DOCS = 100
MAX_CHUNKS = 3000
RETRIEVE_TOP_K = 12
RERANK_TOP_K = 4
COSINE_THRESHOLD = 0.15

_NO_CONTEXT_RE = re.compile(
    r"(no contexto|no tengo|no contiene|no lo s|no puedo|no se menciona|"
    r"no se proporciona|sin informaci|i don't|cannot answer|no information|"
    r"not in the|no encuentro)",
    re.IGNORECASE,
)

app = FastAPI(title="MiniCPM Desktop")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _svc_url(name: str):
    return f"http://127.0.0.1:{SERVICES[name]['port']}"


def _is_alive(name: str) -> bool:
    svc = SERVICES[name]
    path = "/v1/models" if svc["kind"] == "llm" else "/health"
    try:
        r = httpx.get(_svc_url(name) + path, timeout=2.0)
        if r.status_code != 200:
            return False
        if svc["kind"] == "llm":
            return True
        return bool(r.json().get(name))
    except Exception:
        return False


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/services")
def api_services():
    out = {}
    for name, svc in SERVICES.items():
        out[name] = _service_state(name)
    return out


_service_meta: dict = {}


def _read_pid(name: str) -> int | None:
    path = LOGS / f"{SERVICES[name]['log'].removesuffix('.log')}.pid"
    if not path.exists():
        return None
    try:
        return int(path.read_text().strip())
    except Exception:
        return None


def _pid_running(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _uptime_seconds(pid: int | None) -> int | None:
    if not pid:
        return None
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as f:
            fields = f.read().split()
        start_ticks = int(fields[21])
        clk_tck = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
        start_epoch = _boot_time() + start_ticks / clk_tck
        return max(0, int(time.time() - start_epoch))
    except Exception:
        return None


def _service_state(name: str) -> dict:
    svc = SERVICES[name]
    pid = _read_pid(name)
    pid_alive = _pid_running(pid)
    healthy = _is_alive(name)
    meta = _service_meta.get(name, {})
    state = meta.get("state", "stopped")
    if healthy:
        state = "running"
    elif pid_alive:
        if state in ("starting", "running"):
            state = "starting"
        else:
            state = "error"
    else:
        state = "stopped"
    _service_meta[name] = {**meta, "state": state}
    return {
        "port": svc["port"],
        "state": state,
        "pid": pid,
        "uptime_s": _uptime_seconds(pid) if pid_alive else None,
        "ready": healthy,
        "tokens_per_s": _tokens_per_second(name),
    }


def _tokens_per_second(name: str) -> float | None:
    if SERVICES[name]["kind"] != "llm":
        return None
    path = LOGS / SERVICES[name]["log"]
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            last = None
            for line in f:
                if "tokens per second" in line:
                    try:
                        last = float(line.split("tokens per second")[0].rsplit(",", 1)[-1].strip())
                    except Exception:
                        pass
        return last
    except Exception:
        return None


@app.get("/api/host")
def api_host():
    try:
        with open("/proc/loadavg", encoding="utf-8") as f:
            parts = f.read().split()
        return {
            "load_avg": [float(v) for v in parts[:3]],
            "uptime_h": _boot_time_runtime(),
        }
    except Exception:
        return {"load_avg": [_load_avg()], "uptime_h": None}


_boot_time_cache = {}


def _boot_time() -> float:
    if "t" in _boot_time_cache:
        return _boot_time_cache["t"]
    try:
        with open("/proc/stat", encoding="utf-8") as f:
            for line in f:
                if line.startswith("btime "):
                    _boot_time_cache["t"] = float(line.split()[1])
                    return _boot_time_cache["t"]
    except Exception:
        pass
    _boot_time_cache["t"] = time.time()
    return _boot_time_cache["t"]


def _boot_time_runtime() -> float | None:
    try:
        return round((time.time() - _boot_time()) / 3600, 2)
    except Exception:
        return None


@app.get("/api/meta")
def api_meta():
    return {
        "home": str(BASE),
        "ctx": config.CTX,
        "services": {
            name: {"port": svc["port"], "device": svc["device"], "model": svc["model"]}
            for name, svc in SERVICES.items()
        },
        "sampling": {"temp": config.TEMP, "top_p": config.TOP_P, "think_temp": config.THINK_TEMP},
    }


_start_lock = threading.Lock()
_last_llm_start = 0.0


def _load_avg() -> float:
    try:
        return os.getloadavg()[0]
    except Exception:
        return 0.0


def _wait_alive(name: str, deadline: float) -> bool:
    while time.monotonic() < deadline:
        if _is_alive(name):
            return True
        time.sleep(1)
    return False


@app.post("/api/services/{name}/start")
def api_start(name: str, wait: bool = True):
    if name not in SERVICES:
        raise HTTPException(404, "servicio desconocido")
    if _is_alive(name):
        return {"ok": True, "state": "running"}
    global _last_llm_start
    if SERVICES[name]["kind"] == "llm":
        now = time.monotonic()
        if _load_avg() > 12 and now - _last_llm_start < 30:
            raise HTTPException(503, "carga alta; espera antes de arrancar otro modelo")
        _last_llm_start = now
    with _start_lock:
        if _is_alive(name):
            return {"ok": True, "state": "running"}
        _service_meta[name] = {**_service_meta.get(name, {}), "state": "starting"}
        subprocess.Popen([str(SCRIPTS / SERVICES[name]["script"])], start_new_session=True)
    if wait:
        deadline = time.monotonic() + (180 if name == "8b" else 60)
        if not _wait_alive(name, deadline):
            _service_meta[name] = {**_service_meta.get(name, {}), "state": "error"}
            raise HTTPException(504, f"servicio {name} no arrancó a tiempo")
    return {"ok": True, "state": "running"}


@app.post("/api/services/{name}/stop")
def api_stop(name: str):
    if name not in SERVICES:
        raise HTTPException(404, "servicio desconocido")
    pid_file = LOGS / f"{SERVICES[name]['log'].removesuffix('.log')}.pid"
    if pid_file.exists():
        try:
            subprocess.run(["kill", pid_file.read_text().strip()], check=False)
        except Exception:
            pass
        pid_file.unlink(missing_ok=True)
    _service_meta[name] = {**_service_meta.get(name, {}), "state": "stopped"}
    return {"ok": True, "state": "stopped"}


@app.get("/api/gpu")
def api_gpu():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        name, used, total, util = [v.strip() for v in out.split(",")]
        return {"name": name, "used_mib": int(used), "total_mib": int(total), "util_pct": int(util)}
    except Exception:
        return None


SLOT_VALUES = ("none", "8b", "v45", "mcp")
SLOT_VRAM_IDLE_MIB = 1500
SLOT_POLL_SECONDS = 1
SLOT_POLL_TIMEOUT = 120


def _gpu_used_mib() -> int | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip()
        return int(out.splitlines()[0].strip())
    except Exception:
        return None


def _slot_occupant() -> str:
    return "8b" if _is_alive("8b") else "none"


@app.get("/api/slot")
def api_slot_get():
    return {"occupant": _slot_occupant()}


class SlotReq(BaseModel):
    occupant: str


@app.post("/api/slot")
def api_slot(req: SlotReq):
    target = req.occupant.strip()
    if target not in SLOT_VALUES:
        raise HTTPException(400, f"occupant inválido: {target} (usa none, 8b, v45 o mcp)")
    if target in ("v45", "mcp"):
        raise HTTPException(503, f"slot para '{target}' no disponible en esta versión")
    current = _slot_occupant()
    if target == current:
        return {"ok": True, "occupant": target, "state": "running" if target == "8b" else "stopped", "changed": False}
    if current == "8b":
        api_stop("8b")
    if target == "8b":
        deadline = time.monotonic() + SLOT_POLL_TIMEOUT
        while time.monotonic() < deadline:
            used = _gpu_used_mib()
            if used is None or used < SLOT_VRAM_IDLE_MIB:
                break
            time.sleep(SLOT_POLL_SECONDS)
        api_start("8b", wait=True)
    return {"ok": True, "occupant": target, "state": "running" if target == "8b" else "stopped", "changed": True}


@app.get("/api/logs/{name}")
def api_logs(name: str):
    if name not in SERVICES:
        raise HTTPException(404, "servicio desconocido")
    path = LOGS / SERVICES[name]["log"]
    if not path.exists():
        return {"lines": []}
    lines = path.read_text(errors="replace").splitlines()
    return {"lines": lines[-40:]}


def _chat_payload(model: str, messages: list, no_think: bool):
    if model == "8b" and no_think and messages:
        msgs = [dict(m) for m in messages]
        msgs[-1] = dict(messages[-1])
        msgs[-1]["content"] = msgs[-1]["content"].rstrip() + " /no_think"
        return msgs
    return messages


class ChatReq(BaseModel):
    model: str
    messages: list = Field(min_length=1)
    no_think: bool = False
    session_id: int | None = Field(default=None, ge=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)


def _sampling(model: str, no_think: bool, temperature: float | None, top_p: float | None) -> dict:
    if temperature is None:
        temperature = config.THINK_TEMP if (model == "8b" and not no_think) else config.TEMP
    if top_p is None:
        top_p = config.TOP_P
    return {"temperature": temperature, "top_p": top_p}


def _trim_turns(messages: list, max_turns: int = 24) -> list:
    limit = max_turns * 2
    return messages if len(messages) <= limit else messages[-limit:]


def _messages_for_model(req: ChatReq) -> list:
    if req.session_id is None:
        return req.messages
    s = get_session_messages(req.session_id)
    if not s:
        raise HTTPException(404, "sesión no encontrada")
    return _trim_turns(s["messages"] + req.messages)


@app.get("/api/sessions")
def api_sessions():
    return list_sessions()


class SessionReq(BaseModel):
    name: str | None = None


@app.post("/api/sessions")
def api_session_create(req: SessionReq):
    return {"id": create_session(req.name)}


@app.get("/api/sessions/{session_id}")
def api_session_get(session_id: int):
    s = get_session_messages(session_id)
    if not s:
        raise HTTPException(404, "sesión no encontrada")
    return s


@app.delete("/api/sessions/{session_id}")
def api_session_delete(session_id: int):
    delete_session(session_id)
    return {"ok": True}


@app.post("/api/chat")
def api_chat(req: ChatReq):
    if req.model not in ("5-1b", "8b"):
        raise HTTPException(400, "modelo no válido")
    if not _is_alive(req.model):
        raise HTTPException(503, f"servicio {req.model} no está corriendo")
    msgs = _messages_for_model(req)
    body = {
        "model": req.model,
        "messages": msgs,
        "stream": True,
        "max_tokens": req.max_tokens or 2048,
        **_sampling(req.model, req.no_think, req.temperature, req.top_p),
    }

    def gen():
        content = ""
        reason = ""
        try:
            with httpx.stream("POST", _svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line:
                        continue
                    yield line + "\n\n"
                    if line.startswith("data:") and line != "data: [DONE]":
                        try:
                            delta = line[5:].strip()
                            if delta != "[DONE]":
                                j = json.loads(delta)
                                d = j["choices"][0]["delta"]
                                content += d.get("content") or ""
                                reason += d.get("reasoning_content") or ""
                        except Exception:
                            pass
        finally:
            if req.session_id is not None and (content or reason):
                saved = [dict(m) for m in req.messages[-1:]]
                assistant = {"role": "assistant", "content": content}
                if reason:
                    assistant["reasoning_content"] = reason
                saved.append(assistant)
                append_session_messages(req.session_id, saved)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _check_api_key(request: Request):
    if not config.API_KEY:
        return
    if request.headers.get("X-Api-Key") != config.API_KEY:
        raise HTTPException(401, "X-Api-Key inválida")


class OpenAIReq(BaseModel):
    model: str
    messages: list = Field(min_length=1)
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)


@app.post("/v1/chat/completions")
def api_openai_chat(req: OpenAIReq, request: Request):
    _check_api_key(request)
    if req.model not in ("5-1b", "8b"):
        raise HTTPException(400, "modelo no válido")
    if not _is_alive(req.model):
        raise HTTPException(503, f"servicio {req.model} no está corriendo")
    body = {
        "model": req.model,
        "messages": req.messages,
        "max_tokens": req.max_tokens or 2048,
        **_sampling(req.model, False, req.temperature, req.top_p),
    }
    if req.stream:
        def gen():
            with httpx.stream("POST", _svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    if not line:
                        continue
                    yield line + "\n\n"
        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
    r = httpx.post(_svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600)
    r.raise_for_status()
    data = r.json()
    choice = data["choices"][0]
    return {
        "id": data.get("id") or f"chatcmpl-{int(time.time())}",
        "object": "chat.completion",
        "created": data.get("created") or int(time.time()),
        "model": req.model,
        "choices": [{"index": 0, "message": choice["message"], "finish_reason": choice.get("finish_reason") or "stop"}],
        "usage": data.get("usage"),
    }


def _embed_query(text: str):
    r = httpx.post(EMBED_URL + "/embed", json={"texts": [text], "query": True}, timeout=120)
    r.raise_for_status()
    return r.json()["vectors"][0]


def _embed_corpus(texts: list[str]):
    out = []
    for i in range(0, len(texts), 8):
        batch = texts[i : i + 8]
        r = httpx.post(EMBED_URL + "/embed", json={"texts": batch, "query": False}, timeout=120)
        r.raise_for_status()
        out.extend(r.json()["vectors"])
    return out


def _extract_text(filename: str, data: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("txt", "md", "json"):
        return data.decode("utf-8", errors="replace")
    if ext == "pdf":
        return "\n".join(_extract_pages(data))
    if ext == "docx":
        import io

        from docx import Document

        doc = Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in doc.paragraphs)
    if ext in ("html", "htm"):
        import html2text

        h = html2text.HTML2Text()
        h.ignore_links = True
        h.ignore_images = True
        return h.handle(data.decode("utf-8", errors="replace"))
    raise HTTPException(400, f"formato no soportado: .{ext} (usa txt, md, json, pdf, docx o html)")


def _extract_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader

    import io

    reader = PdfReader(io.BytesIO(data))
    return [page.extract_text() or "" for page in reader.pages]


def _chunk_document(filename: str, data: bytes) -> list[dict]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        chunks = []
        for i, page in enumerate(_extract_pages(data)):
            chunks.extend(chunk_text_meta(page, page=i))
        return chunks
    return chunk_text_meta(_extract_text(filename, data))


def _safe_filename(name: str) -> str:
    base = Path(name.replace("\\", "/")).name.strip()
    if not base or base in (".", ".."):
        raise HTTPException(400, "nombre de fichero inválido")
    return base[:255]


@app.post("/api/documents")
async def api_upload(file: UploadFile, background_tasks: BackgroundTasks):
    if not _is_alive("embed"):
        raise HTTPException(503, "servicio embed no está corriendo")
    if count_documents() >= MAX_DOCS:
        raise HTTPException(413, f"límite de {MAX_DOCS} documentos alcanzado; borra alguno antes de subir")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"fichero demasiado grande: máximo {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    filename = _safe_filename(file.filename)
    sha = hashlib.sha256(data).hexdigest()
    dup = find_doc_by_sha(sha)
    if dup:
        raise HTTPException(409, f"documento duplicado: ya existe '{dup['filename']}' con el mismo contenido")
    chunks = _chunk_document(filename, data)
    if not chunks:
        raise HTTPException(400, "el documento no tiene contenido extraíble")
    if count_chunks() + len(chunks) > MAX_CHUNKS:
        raise HTTPException(413, f"límite de {MAX_CHUNKS} chunks alcanzado; borra documentos antes de subir")
    doc_id = create_document(filename, sha)
    background_tasks.add_task(_ingest_document, doc_id, chunks)
    return {"id": doc_id, "state": "indexing"}


def _ingest_document(doc_id: int, chunks_meta: list[dict]):
    try:
        embs = _embed_corpus([c["text"] for c in chunks_meta])
        import numpy as np

        fill_document(doc_id, chunks_meta, np.array(embs, dtype=np.float32))
    except Exception:
        mark_document_error(doc_id)
        raise


@app.get("/api/documents")
def api_documents():
    return list_documents()


@app.delete("/api/documents/{doc_id}")
def api_delete(doc_id: int):
    delete_document(doc_id)
    return {"ok": True}


def _search_results(query: str, top_k: int, rerank: bool = True):
    if not _is_alive("embed"):
        raise HTTPException(503, "servicio embed no está corriendo")
    import numpy as np

    q = np.array(_embed_query(query), dtype=np.float32)
    retrieve = max(RETRIEVE_TOP_K, top_k)
    hits = search(q, retrieve if rerank else top_k)
    results = [
        {
            "chunk_id": h[1],
            "doc_id": h[2],
            "filename": h[3],
            "chunk_idx": h[4],
            "text": h[5][:500],
            "cosine": round(h[0], 4),
        }
        for h in hits
    ]
    rerank_used = False
    if rerank and results and _is_alive("rerank"):
        docs = [r["text"] for r in results]
        r = httpx.post(
            RERANK_URL + "/rerank", json={"query": query, "docs": docs}, timeout=120
        )
        if r.status_code == 200:
            scores = r.json()["scores"]
            for res, s in zip(results, scores):
                res["rerank_score"] = round(s, 4)
            results.sort(key=lambda x: x["rerank_score"], reverse=True)
            results = results[:top_k]
            rerank_used = True
    return results, rerank_used


@app.get("/api/search")
def api_search(query: str, top_k: int = 5, rerank: bool = True):
    results, _ = _search_results(query, top_k, rerank)
    return results


class RagReq(BaseModel):
    query: str
    top_k: int = 4
    model: str = "8b"
    no_think: bool = True
    stream: bool = False
    lang: str = "es"


@app.post("/api/rag")
def api_rag(req: RagReq):
    if not _is_alive(req.model):
        raise HTTPException(503, f"servicio {req.model} no está corriendo")
    results, rerank_used = _search_results(req.query, req.top_k, rerank=True)
    best = max((r["cosine"] for r in results), default=0.0)
    if not results or best < COSINE_THRESHOLD:
        msg = "No hay contexto suficiente en la base de conocimiento que responda a la consulta."

        def gen_empty():
            yield "data: " + json.dumps({"type": "sources", "sources": []}) + "\n\n"
            yield "data: " + json.dumps({"type": "done", "answer": msg, "reasoning": "", "forced_8b": False, "rerank": rerank_used}) + "\n\n"
            yield "data: [DONE]\n\n"

        if req.stream:
            return StreamingResponse(
                gen_empty(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                    "Connection": "keep-alive",
                },
            )
        return {"answer": msg, "reasoning": "", "forced_8b": False, "rerank": rerank_used, "sources": []}

    sources_out = [
        {
            "chunk_id": s["chunk_id"],
            "filename": s["filename"],
            "text": s["text"],
            "score": s.get("rerank_score", s["cosine"]),
        }
        for s in results
    ]
    context = "\n\n".join(f"[Fuente {i + 1}] {r['text']}" for i, r in enumerate(results))
    lang_hint = "Responde en español.\n\n" if req.lang == "es" else ""
    prompt = (
        "Responde a la pregunta usando ÚNICAMENTE el contexto proporcionado. "
        "Si el contexto no contiene la respuesta, di que no la tienes. "
        "Cita las fuentes como [Fuente N].\n\n"
        f"{lang_hint}CONTEXTO:\n{context}\n\n"
        f"PREGUNTA: {req.query}"
    )
    msgs = [{"role": "user", "content": prompt}]

    if req.stream:
        def gen():
            yield "data: " + json.dumps({"type": "sources", "sources": sources_out}) + "\n\n"
            reasoning_total = ""
            body = {
                "model": req.model,
                "messages": _chat_payload(req.model, msgs, req.no_think),
                "stream": True,
                "max_tokens": 1024,
                **_sampling(req.model, req.no_think, None, None),
            }
            try:
                with httpx.stream("POST", _svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600) as r:
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            j = json.loads(payload)
                            delta = j["choices"][0].get("delta", {})
                            cont = delta.get("content") or ""
                            reas = delta.get("reasoning_content") or ""
                            if reas:
                                reasoning_total += reas
                            if cont or reas:
                                yield "data: " + json.dumps({"type": "delta", "content": cont, "reasoning": reas}) + "\n\n"
                        except Exception:
                            pass
            except httpx.HTTPStatusError:
                yield "data: " + json.dumps({"type": "error", "detail": "error al generar con el modelo"}) + "\n\n"
            finally:
                yield "data: " + json.dumps({"type": "done", "reasoning": reasoning_total, "forced_8b": False, "rerank": rerank_used}) + "\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    body = {
        "model": req.model,
        "messages": _chat_payload(req.model, msgs, req.no_think),
        "stream": False,
        "max_tokens": 1024,
        **_sampling(req.model, req.no_think, None, None),
    }
    r = httpx.post(_svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600)
    r.raise_for_status()
    data = r.json()
    content = data["choices"][0]["message"].get("content") or ""
    reasoning = data["choices"][0]["message"].get("reasoning_content") or ""
    answer = content.strip() or reasoning.strip()
    forced_8b = False
    if req.model == "5-1b" and _NO_CONTEXT_RE.search(answer) and _is_alive("8b"):
        body["model"] = "8b"
        r = httpx.post(_svc_url("8b") + "/v1/chat/completions", json=body, timeout=600)
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"].get("content") or ""
        reasoning = data["choices"][0]["message"].get("reasoning_content") or ""
        answer = content.strip() or reasoning.strip()
        forced_8b = True
    return {
        "answer": answer,
        "reasoning": reasoning,
        "forced_8b": forced_8b,
        "rerank": rerank_used,
        "sources": sources_out,
    }


class MailConfigReq(BaseModel):
    user: str
    password: str


@app.get("/api/mail/status")
def api_mail_status():
    return mail.status()


@app.post("/api/mail/config")
def api_mail_config(req: MailConfigReq):
    mail.save_creds(req.user, req.password)
    try:
        mail.unread(1)
    except Exception as e:
        mail.clear_creds()
        raise HTTPException(401, f"credenciales rechazadas por Bridge: {e}")
    return {"ok": True, "user": req.user}


@app.get("/api/mail/folders")
def api_mail_folders():
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.folders()
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


@app.get("/api/mail/unread")
def api_mail_unread(limit: int = 50, folder: str = "INBOX"):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.unread(limit, folder)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


@app.get("/api/mail/search")
def api_mail_search(from_: str | None = None, subject: str | None = None,
                    text: str | None = None, since: str | None = None,
                    unread: bool = False, limit: int = 50, folder: str = "INBOX"):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.search(from_, subject, text, since, unread, limit, folder)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


@app.get("/api/mail/fetch")
def api_mail_fetch(uid: int, folder: str = "INBOX"):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.fetch(uid, folder)
    except Exception as e:
        raise HTTPException(404, f"error IMAP: {e}")


@app.get("/api/mail/attachment")
def api_mail_attachment(uid: int, part: int, folder: str = "INBOX"):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        att = mail.fetch_attachment(uid, part, folder)
    except Exception as e:
        raise HTTPException(404, f"error IMAP: {e}")
    fd, path = tempfile.mkstemp(prefix="minicpm-att-", suffix=".bin")
    os.close(fd)
    os.chmod(path, 0o600)
    with open(path, "wb") as f:
        f.write(att["data"])
    return FileResponse(path, media_type=att["ctype"], filename=att["filename"],
                        background=BackgroundTask(os.unlink, path))


class MailMarkReq(BaseModel):
    uid: int
    read: bool
    folder: str = "INBOX"


@app.post("/api/mail/mark")
def api_mail_mark(req: MailMarkReq):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.mark(req.uid, req.read, req.folder)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


class MailSendReq(BaseModel):
    to: str
    subject: str
    body: str
    in_reply_to: str | None = None
    references: str | None = None


@app.post("/api/mail/send")
def api_mail_send(req: MailSendReq):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.send(req.to, req.subject, req.body, req.in_reply_to, req.references)
    except Exception as e:
        raise HTTPException(401, f"error SMTP: {e}")