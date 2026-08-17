import os
import torch
from pathlib import Path

torch.set_num_threads(4)
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoConfig, AutoModel, AutoTokenizer

BASE = Path(os.environ.get("MINICPM_HOME", str(Path.home() / "minicpm")))
MODEL_DIR = os.environ.get("MINICPM_EMBED_DIR", str(BASE / "models" / "embed"))
MAX_LEN = 8192

cfg = AutoConfig.from_pretrained(MODEL_DIR, trust_remote_code=True)
cfg._name_or_path = MODEL_DIR
model = AutoModel.from_pretrained(MODEL_DIR, config=cfg, trust_remote_code=True)
tok = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
model.eval()

app = FastAPI(title="MiniCPM Embedding API")


class EmbedRequest(BaseModel):
    texts: list[str]
    query: bool = False


@app.post("/embed")
def embed(req: EmbedRequest):
    if req.query:
        texts = ["Query: " + t for t in req.texts]
        out = model.encode_query(texts, max_length=MAX_LEN)
    else:
        out = model.encode_corpus(req.texts, max_length=MAX_LEN)
    dense = out[0] if isinstance(out, (tuple, list)) else out
    return {"vectors": dense.tolist()}


@app.get("/health")
def health():
    return {"ok": True}