import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_DIR = REPO_ROOT / "app"

os.environ.setdefault("MINICPM_HOME", str(Path(tempfile.gettempdir()) / "minicpm-test-home"))

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))