"""Run a collector filled with a synthetic six-device fleet, for UI development, screenshots and e2e.

    python scripts/demo.py [--port 8765] [--token demo-token-123] [--db PATH] [--empty]

Everything here is made up (hosts, users, tokens, findings). Nothing on this machine is scanned.
The collector stores its database in a temp directory unless --db is given.
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from aiwarden.demo import DEMO_CONFIG, populate  # noqa: E402
from aiwarden.server import Store, make_server  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--token", default="demo-token-123")
    ap.add_argument("--db")
    ap.add_argument("--empty", action="store_true", help="start with no devices (empty-state UI)")
    a = ap.parse_args()
    db = Path(a.db) if a.db else Path(tempfile.mkdtemp(prefix="aiwarden-demo-")) / "fleet.db"
    if not a.empty:
        populate(Store(db))
    srv = make_server(a.host, a.port, db, a.token, config=DEMO_CONFIG)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://{a.host}:{srv.server_address[1]}"
    print(f"demo collector on {url}/  db={db}", flush=True)
    print(f"open:  {url}/#token={a.token}", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
