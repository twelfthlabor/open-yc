"""Vercel entry point for the public, read-only console demo.

Runs the real collector handler (ask, guard check, alerts, weekly report, fleet and device views) over
the synthetic fleet in aiwarden.demo. Uploads are refused. vercel.json routes /api/* here; the console
itself is served as static files.
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aiwarden.demo import DEMO_CONFIG, populate  # noqa: E402
from aiwarden.server import Store, make_handler  # noqa: E402

# The demo token is public on purpose: it is baked into the demo console build (VITE_DEMO_TOKEN).
TOKEN = os.environ.get("AIWARDEN_DEMO_TOKEN", "aiwarden-public-demo")

_db = Path(tempfile.gettempdir()) / f"aiwarden-demo-{os.getpid()}.db"
_db.unlink(missing_ok=True)
_store = Store(_db)
populate(_store)

_Collector = make_handler(_store, TOKEN, config=DEMO_CONFIG, read_only=True)


class handler(_Collector):  # Vercel looks for a top-level class named `handler`
    pass
