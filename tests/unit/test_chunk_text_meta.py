import vectorstore


def test_empty_text_returns_no_chunks():
    assert vectorstore.chunk_text_meta("") == []
    assert vectorstore.chunk_text_meta("   \n\t  ") == []


def test_short_text_single_chunk():
    text = "Hola mundo. Este es un texto corto."
    chunks = vectorstore.chunk_text_meta(text)
    assert len(chunks) == 1
    assert chunks[0]["text"] == text
    assert chunks[0]["page"] is None
    assert chunks[0]["char_start"] == 0
    assert chunks[0]["char_end"] == len(text)


def test_page_propagates_to_chunks():
    chunks = vectorstore.chunk_text_meta("Texto de la página 3.", page=3)
    assert len(chunks) == 1
    assert chunks[0]["page"] == 3


def test_long_text_splits_with_overlap():
    text = "a" * 3000
    chunks = vectorstore.chunk_text_meta(text)
    assert len(chunks) >= 3
    assert chunks[0]["char_start"] == 0
    assert chunks[0]["char_end"] == vectorstore.CHUNK_CHARS
    for i, c in enumerate(chunks):
        assert c["text"] == text[c["char_start"] : c["char_end"]]
        if i > 0:
            assert c["char_start"] <= chunks[i - 1]["char_end"] - vectorstore.OVERLAP_CHARS
    last = chunks[-1]
    assert last["char_end"] == len(text)


def test_sentence_boundary_splitting():
    text = "x" * 700 + ". " + "y" * 3000
    chunks = vectorstore.chunk_text_meta(text)
    assert chunks[0]["text"].endswith(".")
    assert chunks[0]["char_end"] == 702
    assert chunks[0]["char_start"] == 0


def test_chunk_text_returns_only_texts():
    text = "a" * 3000
    assert vectorstore.chunk_text(text) == [c["text"] for c in vectorstore.chunk_text_meta(text)]