import numpy as np
import pytest

import vectorstore


@pytest.fixture
def vs(tmp_path, monkeypatch):
    monkeypatch.setattr(vectorstore, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(vectorstore, "DB_PATH", tmp_path / "data" / "kb.db")
    return vectorstore


def test_pack_unpack_roundtrip(vs):
    emb = np.array([0.1, -0.2, 0.3], dtype=np.float32)
    unpacked = vs._unpack(vs._pack(emb))
    assert unpacked.shape == emb.shape
    assert np.allclose(unpacked, emb)


def test_create_and_count_documents(vs):
    doc_id = vs.create_document("a.pdf", sha256="sha-a")
    assert isinstance(doc_id, int)
    assert vs.count_documents() == 1
    assert vs.find_doc_by_sha("sha-a") == {"id": doc_id, "filename": "a.pdf"}
    assert vs.find_doc_by_sha("") is None


def test_add_and_list_documents(vs):
    emb = np.zeros((2, 4), dtype=np.float32)
    doc_id = vs.add_document("b.txt", ["chunk uno", "chunk dos"], emb, sha256="sha-b")
    info = vs.list_documents()
    assert info["n_chunks"] == 2
    assert len(info["documents"]) == 1
    assert info["documents"][0]["filename"] == "b.txt"
    assert info["documents"][0]["status"] == "ready"
    assert info["documents"][0]["n_chunks"] == 2
    assert vs.count_chunks() == 2


def test_mark_document_error(vs):
    doc_id = vs.create_document("c.pdf")
    vs.mark_document_error(doc_id)
    assert vs.list_documents()["documents"][0]["status"] == "error"


def test_delete_document(vs):
    emb = np.zeros((1, 4), dtype=np.float32)
    doc_id = vs.add_document("d.txt", ["único"], emb)
    vs.delete_document(doc_id)
    assert vs.count_documents() == 0
    assert vs.count_chunks() == 0


def test_fill_document(vs):
    doc_id = vs.create_document("e.pdf")
    chunks_meta = [
        {"text": "uno", "page": 1, "char_start": 0, "char_end": 3},
        {"text": "dos", "page": 1, "char_start": 4, "char_end": 7},
    ]
    emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    vs.fill_document(doc_id, chunks_meta, emb)
    assert vs.count_chunks() == 2
    assert vs.list_documents()["documents"][0]["status"] == "ready"
    assert vs.list_documents()["documents"][0]["n_chunks"] == 2


def test_search_ranks_most_similar_first(vs):
    chunks = ["primero", "segundo", "tercero"]
    emb = np.array([[1.0, 0.0], [0.0, 1.0], [0.5, 0.5]], dtype=np.float32)
    vs.add_document("f.txt", chunks, emb, sha256="sha-f")
    query = np.array([0.0, 1.0], dtype=np.float32)
    results = vs.search(query, top_k=2)
    assert len(results) == 2
    assert results[0][4] == 1
    assert results[0][5] == "segundo"


def test_sessions_lifecycle(vs):
    vs.list_sessions()
    sid = vs.create_session()
    assert sid >= 1
    assert vs.create_session("Mi sesión") >= 1
    sessions = vs.list_sessions()
    assert len(sessions) >= 2
    named = next(s for s in sessions if s["name"] == "Mi sesión")
    assert vs.append_session_messages(named["id"], [{"role": "user", "content": "hola"}])
    msgs = vs.get_session_messages(named["id"])
    assert msgs["messages"][0]["content"] == "hola"
    vs.delete_session(named["id"])
    assert vs.get_session_messages(named["id"]) is None