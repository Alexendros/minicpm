import json
import re
import sqlite3
import struct
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "kb.db"
CHUNK_CHARS = 1200
OVERLAP_CHARS = 180


def _conn():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "filename TEXT NOT NULL,"
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        "n_chunks INTEGER NOT NULL DEFAULT 0)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,"
        "idx INTEGER NOT NULL,"
        "text TEXT NOT NULL,"
        "emb BLOB NOT NULL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)")
    _ensure_columns(conn)
    return conn


def _ensure_columns(conn):
    doc_cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
    if "sha256" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN sha256 TEXT")
    if "status" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'")
    chunk_cols = {r[1] for r in conn.execute("PRAGMA table_info(chunks)")}
    if "page" not in chunk_cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN page INTEGER")
    if "char_start" not in chunk_cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN char_start INTEGER")
    if "char_end" not in chunk_cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN char_end INTEGER")
    conn.commit()


def _pack(emb):
    return struct.pack(f"<{len(emb)}f", *emb)


def _unpack(blob):
    return np.frombuffer(blob, dtype=np.float32)


def chunk_text_meta(text: str, page: int | None = None) -> list[dict]:
    text = text.strip()
    if not text:
        return []
    out = []
    n = len(text)
    start = 0
    while start < n:
        end = min(start + CHUNK_CHARS, n)
        if end < n:
            best = -1
            for m in re.finditer(r"[.!?]\s|\n", text[start:end]):
                best = m.end() - 1
            if best >= CHUNK_CHARS // 2:
                end = start + best + 1
        piece = text[start:end].strip()
        if piece:
            out.append({"text": piece, "page": page, "char_start": start, "char_end": end})
        if end >= n:
            break
        start = max(end - OVERLAP_CHARS, start + 1)
    return out


def chunk_text(text: str) -> list[str]:
    return [c["text"] for c in chunk_text_meta(text)]


def create_document(filename: str, sha256: str | None = None):
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO documents (filename, sha256, status, n_chunks) VALUES (?, ?, 'indexing', 0)",
        (filename, sha256),
    )
    conn.commit()
    conn.close()
    return cur.lastrowid


def fill_document(doc_id: int, chunks_meta: list[dict], embeddings: np.ndarray):
    conn = _conn()
    conn.executemany(
        "INSERT INTO chunks (doc_id, idx, text, emb, page, char_start, char_end) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (doc_id, i, c["text"], _pack(embeddings[i]), c.get("page"), c.get("char_start"), c.get("char_end"))
            for i, c in enumerate(chunks_meta)
        ],
    )
    conn.execute("UPDATE documents SET n_chunks = ?, status = 'ready' WHERE id = ?", (len(chunks_meta), doc_id))
    conn.commit()
    conn.close()


def mark_document_error(doc_id: int):
    conn = _conn()
    conn.execute("UPDATE documents SET status = 'error' WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()


def find_doc_by_sha(sha256: str):
    if not sha256:
        return None
    conn = _conn()
    row = conn.execute("SELECT id, filename FROM documents WHERE sha256 = ?", (sha256,)).fetchone()
    conn.close()
    return {"id": row[0], "filename": row[1]} if row else None


def count_chunks():
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    conn.close()
    return n


def add_document(filename: str, chunks: list[str], embeddings: np.ndarray, sha256: str | None = None):
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO documents (filename, sha256, status, n_chunks) VALUES (?, ?, 'ready', ?)",
        (filename, sha256, len(chunks)),
    )
    doc_id = cur.lastrowid
    conn.executemany(
        "INSERT INTO chunks (doc_id, idx, text, emb) VALUES (?, ?, ?, ?)",
        [(doc_id, i, chunks[i], _pack(embeddings[i])) for i in range(len(chunks))],
    )
    conn.commit()
    conn.close()
    return doc_id


def list_documents():
    conn = _conn()
    rows = conn.execute(
        "SELECT id, filename, created_at, n_chunks, status FROM documents ORDER BY id DESC"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    conn.close()
    docs = [{"id": r[0], "filename": r[1], "created_at": r[2], "n_chunks": r[3], "status": r[4]} for r in rows]
    return {"documents": docs, "n_chunks": total}


def count_documents():
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    conn.close()
    return n


def delete_document(doc_id: int):
    conn = _conn()
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()


def search(query_emb: np.ndarray, top_k: int = 5):
    conn = _conn()
    rows = conn.execute(
        "SELECT c.id, c.doc_id, d.filename, c.idx, c.text, c.emb "
        "FROM chunks c JOIN documents d ON d.id = c.doc_id"
    ).fetchall()
    conn.close()
    q = query_emb / (np.linalg.norm(query_emb) + 1e-9)
    scored = []
    for cid, doc_id, filename, idx, text, blob in rows:
        emb = _unpack(blob)
        emb = emb / (np.linalg.norm(emb) + 1e-9)
        scored.append((float(emb @ q), cid, doc_id, filename, idx, text))
    scored.sort(reverse=True, key=lambda r: r[0])
    return scored[:top_k]


def list_sessions():
    conn = _conn()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_sessions ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "name TEXT NOT NULL,"
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,"
        "messages TEXT NOT NULL DEFAULT '[]')"
    )
    rows = conn.execute(
        "SELECT id, name, created_at, updated_at, messages FROM chat_sessions ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [
        {"id": r[0], "name": r[1], "created_at": r[2], "updated_at": r[3], "n_messages": len(json.loads(r[4]))}
        for r in rows
    ]


def create_session(name: str = None):
    conn = _conn()
    if not name:
        count = conn.execute("SELECT COUNT(*) FROM chat_sessions").fetchone()[0]
        name = f"Sesión {count + 1}"
    cur = conn.execute("INSERT INTO chat_sessions (name) VALUES (?)", (name,))
    conn.commit()
    conn.close()
    return cur.lastrowid


def delete_session(session_id: int):
    conn = _conn()
    conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()


def get_session_messages(session_id: int):
    conn = _conn()
    row = conn.execute(
        "SELECT name, messages FROM chat_sessions WHERE id = ?", (session_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"name": row[0], "messages": json.loads(row[1])}


def append_session_messages(session_id: int, new_messages: list):
    conn = _conn()
    row = conn.execute("SELECT messages FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        conn.close()
        return False
    messages = json.loads(row[0]) + new_messages
    conn.execute(
        "UPDATE chat_sessions SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (json.dumps(messages, ensure_ascii=False), session_id),
    )
    conn.commit()
    conn.close()
    return True
