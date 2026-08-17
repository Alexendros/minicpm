import torch

torch.set_num_threads(4)
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoConfig, AutoModelForSequenceClassification, AutoTokenizer

MODEL_DIR = "/home/alexendros/minicpm/models/rerank"
MAX_LEN = 4096

cfg = AutoConfig.from_pretrained(MODEL_DIR, trust_remote_code=True)
cfg._name_or_path = MODEL_DIR
model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR, config=cfg, trust_remote_code=True)
tok = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
model.eval()

app = FastAPI(title="MiniCPM Rerank API")


class RerankRequest(BaseModel):
    query: str
    docs: list[str]


@app.post("/rerank")
def rerank(req: RerankRequest):
    pairs = [f"Query: {req.query} {d}" for d in req.docs]
    enc = tok(pairs, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
    with torch.no_grad():
        logits = model(**enc).logits.squeeze(-1)
    return {"scores": logits.tolist()}


@app.get("/health")
def health():
    return {"ok": True}