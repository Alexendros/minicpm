import json
import subprocess
import threading
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import mail
from vectorstore import (
    add_document,
    append_session_messages,
    chunk_text,
    create_session,
    delete_document,
    delete_session,
    get_session_messages,
    list_documents,
    list_sessions,
    search,
)

BASE = Path(__file__).parent.parent
SCRIPTS = BASE / "scripts"
LOGS = BASE / "logs"
STATIC = Path(__file__).parent / "static"

SERVICES = {
    "5-1b": {"port": 8080, "script": "start-minicpm5-1b.sh", "log": "minicpm5-1b.log", "kind": "llm"},
    "8b": {"port": 8081, "script": "start-minicpm4-8b.sh", "log": "minicpm4-8b.log", "kind": "llm"},
    "embed": {"port": 8002, "script": "start-embed.sh", "log": "embed.log", "kind": "health"},
    "rerank": {"port": 8003, "script": "start-rerank.sh", "log": "rerank.log", "kind": "health"},
}
EMBED_URL = "http://127.0.0.1:8002"
RERANK_URL = "http://127.0.0.1:8003"

app = FastAPI(title="MiniCPM Desktop")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _svc_url(name: str):
    return f"http://127.0.0.1:{SERVICES[name]['port']}"


def _is_alive(name: str) -> bool:
    svc = SERVICES[name]
    path = "/v1/models" if svc["kind"] == "llm" else "/health"
    try:
        r = httpx.get(_svc_url(name) + path, timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/services")
def api_services():
    out = {}
    for name, svc in SERVICES.items():
        out[name] = {"port": svc["port"], "running": _is_alive(name)}
    return out


_start_lock = threading.Lock()


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
        return {"ok": True, "running": True}
    with _start_lock:
        if _is_alive(name):
            return {"ok": True, "running": True}
        subprocess.Popen([str(SCRIPTS / SERVICES[name]["script"])], start_new_session=True)
    if wait:
        deadline = time.monotonic() + (180 if name == "8b" else 60)
        if not _wait_alive(name, deadline):
            raise HTTPException(504, f"servicio {name} no arrancó a tiempo")
    return {"ok": True, "running": True}


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
    return {"ok": True}


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
    body = {"model": req.model, "messages": msgs, "stream": True, "max_tokens": 2048}

    def gen():
        content = ""
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
                                content += j["choices"][0]["delta"].get("content") or ""
                        except Exception:
                            pass
        finally:
            if req.session_id is not None and content:
                saved = [dict(m) for m in req.messages[-1:]]
                saved.append({"role": "assistant", "content": content})
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
        from pypdf import PdfReader

        import io

        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    raise HTTPException(400, f"formato no soportado: .{ext} (usa txt, md, json o pdf)")


@app.post("/api/documents")
async def api_upload(file: UploadFile):
    if not _is_alive("embed"):
        raise HTTPException(503, "servicio embed no está corriendo")
    data = await file.read()
    text = _extract_text(file.filename, data)
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(400, "el documento no tiene contenido extraíble")
    embs = _embed_corpus(chunks)
    import numpy as np

    doc_id = add_document(file.filename, chunks, np.array(embs, dtype=np.float32))
    return {"id": doc_id, "filename": file.filename, "n_chunks": len(chunks)}


@app.get("/api/documents")
def api_documents():
    return list_documents()


@app.delete("/api/documents/{doc_id}")
def api_delete(doc_id: int):
    delete_document(doc_id)
    return {"ok": True}


@app.get("/api/search")
def api_search(query: str, top_k: int = 5, rerank: bool = True):
    if not _is_alive("embed"):
        raise HTTPException(503, "servicio embed no está corriendo")
    import numpy as np

    q = np.array(_embed_query(query), dtype=np.float32)
    hits = search(q, top_k * 3 if rerank else top_k)
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
    return results


class RagReq(BaseModel):
    query: str
    top_k: int = 4
    model: str = "8b"
    no_think: bool = True


@app.post("/api/rag")
def api_rag(req: RagReq):
    results = api_search(req.query, top_k=req.top_k)
    if not results:
        return {"answer": "No hay documentos en la base de conocimiento que respondan a la consulta.", "sources": []}
    if not _is_alive(req.model):
        raise HTTPException(503, f"servicio {req.model} no está corriendo")
    context = "\n\n".join(f"[Fuente {i + 1}] {r['text']}" for i, r in enumerate(results))
    prompt = (
        "Responde a la pregunta usando ÚNICAMENTE el contexto proporcionado. "
        "Si el contexto no contiene la respuesta, di que no la tienes. "
        "Cita las fuentes como [Fuente N].\n\n"
        f"CONTEXTO:\n{context}\n\n"
        f"PREGUNTA: {req.query}"
    )
    msgs = [{"role": "user", "content": prompt}]
    body = {"model": req.model, "messages": _chat_payload(req.model, msgs, req.no_think), "stream": False, "max_tokens": 1024}
    r = httpx.post(_svc_url(req.model) + "/v1/chat/completions", json=body, timeout=600)
    r.raise_for_status()
    data = r.json()
    content = data["choices"][0]["message"].get("content") or ""
    reasoning = data["choices"][0]["message"].get("reasoning_content") or ""
    return {
        "answer": content.strip() or reasoning.strip(),
        "reasoning": reasoning,
        "sources": [{"filename": s["filename"], "text": s["text"], "score": s.get("rerank_score", s["cosine"])} for s in results],
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


@app.get("/api/mail/unread")
def api_mail_unread(limit: int = 50):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.unread(limit)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


@app.get("/api/mail/search")
def api_mail_search(from_: str | None = None, subject: str | None = None,
                    text: str | None = None, since: str | None = None,
                    unread: bool = False, limit: int = 50):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.search(from_, subject, text, since, unread, limit)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


@app.get("/api/mail/fetch")
def api_mail_fetch(uid: int):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.fetch(uid)
    except Exception as e:
        raise HTTPException(404, f"error IMAP: {e}")


class MailMarkReq(BaseModel):
    uid: int
    read: bool


@app.post("/api/mail/mark")
def api_mail_mark(req: MailMarkReq):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.mark(req.uid, req.read)
    except Exception as e:
        raise HTTPException(401, f"error IMAP: {e}")


class MailSendReq(BaseModel):
    to: str
    subject: str
    body: str


@app.post("/api/mail/send")
def api_mail_send(req: MailSendReq):
    if not mail.bridge_up():
        raise HTTPException(502, "Proton Mail Bridge no responde (puertos 1143/1025)")
    try:
        return mail.send(req.to, req.subject, req.body)
    except Exception as e:
        raise HTTPException(401, f"error SMTP: {e}")