import os
import torch
from pathlib import Path
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoConfig, AutoModel, AutoModelForSequenceClassification, AutoTokenizer

BASE = Path(os.environ.get("MINICPM_HOME", str(Path.home() / "minicpm")))
EMBED_DIR = os.environ.get("MINICPM_EMBED_DIR", str(BASE / "models" / "embed"))
RERANK_DIR = os.environ.get("MINICPM_RERANK_DIR", str(BASE / "models" / "rerank"))
MAX_LEN = 8192

torch.set_num_threads(4)

embed_cfg = AutoConfig.from_pretrained(EMBED_DIR, trust_remote_code=True)
embed_cfg._name_or_path = EMBED_DIR
embed_model = AutoModel.from_pretrained(EMBED_DIR, config=embed_cfg, trust_remote_code=True)
embed_tok = AutoTokenizer.from_pretrained(EMBED_DIR, trust_remote_code=True)
embed_model.eval()

rerank_cfg = AutoConfig.from_pretrained(RERANK_DIR, trust_remote_code=True)
rerank_cfg._name_or_path = RERANK_DIR
rerank_model = AutoModelForSequenceClassification.from_pretrained(RERANK_DIR, config=rerank_cfg, trust_remote_code=True)
rerank_tok = AutoTokenizer.from_pretrained(RERANK_DIR, trust_remote_code=True)
rerank_model.eval()

app = FastAPI(title="MiniCPM RAG Runtime")


class EmbedRequest(BaseModel):
    texts: list[str]
    query: bool = False


class RerankRequest(BaseModel):
    query: str
    docs: list[str]


@app.get("/health")
def health():
    return {"ok": True, "embed": True, "rerank": True, "device": "cuda" if torch.cuda.is_available() else "cpu"}


@app.post("/embed")
def embed(req: EmbedRequest):
    if req.query:
        texts = [f"Query: {t}" for t in req.texts]
        out = embed_model.encode_query(texts, max_length=MAX_LEN)
    else:
        out = embed_model.encode_corpus(req.texts, max_length=MAX_LEN)
    dense = out[0] if isinstance(out, (tuple, list)) else out
    return {"vectors": dense.tolist()}


@app.post("/rerank")
def rerank(req: RerankRequest):
    pairs = [[f"Query: {req.query}", d] for d in req.docs]
    enc = rerank_tok(pairs, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
    with torch.no_grad():
        logits = rerank_model(**enc).logits.squeeze(-1)
        scores = torch.sigmoid(logits)
    return {"scores": scores.tolist()}
