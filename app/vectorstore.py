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
    return conn


def _pack(emb):
    return struct.pack(f"<{len(emb)}f", *emb)


def _unpack(blob):
    return np.frombuffer(blob, dtype=np.float32)


def _split_long(par: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+|\n", par)
    out, cur = [], ""
    for s in sentences:
        if len(s) > CHUNK_CHARS:
            if cur:
                out.append(cur)
                cur = ""
            for i in range(0, len(s), CHUNK_CHARS):
                out.append(s[i : i + CHUNK_CHARS])
        elif cur and len(cur) + len(s) + 1 > CHUNK_CHARS:
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def chunk_text(text: str):
    text = text.strip()
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, carry = [], ""
    for p in paras:
        pieces = _split_long(p) if len(p) > CHUNK_CHARS else [p]
        for piece in pieces:
            if carry and len(carry) + len(piece) + 1 > CHUNK_CHARS:
                chunks.append(carry)
                carry = carry[-OVERLAP_CHARS:] + "\n" + piece
            elif not carry:
                carry = piece
            else:
                carry = f"{carry}\n{piece}"
    if carry:
        chunks.append(carry)
    return [c for c in chunks if c.strip()]


def add_document(filename: str, chunks: list[str], embeddings: np.ndarray):
    conn = _conn()
    cur = conn.execute("INSERT INTO documents (filename, n_chunks) VALUES (?, ?)", (filename, len(chunks)))
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
    rows = conn.execute("SELECT id, filename, created_at, n_chunks FROM documents ORDER BY id DESC").fetchall()
    total = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    conn.close()
    docs = [{"id": r[0], "filename": r[1], "created_at": r[2], "n_chunks": r[3]} for r in rows]
    return {"documents": docs, "n_chunks": total}


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