import os
from pathlib import Path

HOME = Path(os.environ.get("MINICPM_HOME", str(Path.home() / "minicpm")))
GUI_PORT = int(os.environ.get("MINICPM_GUI_PORT", "8090"))
PORT_5B = int(os.environ.get("MINICPM_5B_PORT", "8080"))
PORT_8B = int(os.environ.get("MINICPM_8B_PORT", "8081"))
EMBED_PORT = int(os.environ.get("MINICPM_EMBED_PORT", "8002"))
RERANK_PORT = int(os.environ.get("MINICPM_RERANK_PORT", "8003"))
CTX = int(os.environ.get("MINICPM_CTX", "4096"))
NGL_8B = int(os.environ.get("MINICPM_NGL_8B", "99"))
NGL_5B = int(os.environ.get("MINICPM_NGL_5B", "0"))
TEMP = float(os.environ.get("MINICPM_TEMP", "0.7"))
TOP_P = float(os.environ.get("MINICPM_TOP_P", "0.95"))
THINK_TEMP = float(os.environ.get("MINICPM_THINK_TEMP", "0.9"))
EMBED_DIR = os.environ.get("MINICPM_EMBED_DIR", str(HOME / "models" / "embed"))
RERANK_DIR = os.environ.get("MINICPM_RERANK_DIR", str(HOME / "models" / "rerank"))
API_KEY = os.environ.get("MINICPM_API_KEY", "")
