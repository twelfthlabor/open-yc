"""Collector endpoint for the browser extension: POST /api/browser-events and its fleet aggregate."""
import json
import sqlite3
import threading
import urllib.error
import urllib.request

import pytest

from aiwarden.server import aggregate, aggregate_browser, make_server, valid_browser_batch

TOKEN = "s3cret-token"
EXT_ORIGIN = "chrome-extension://" + "abcdefghijklmnopabcdefghijklmnop"


@pytest.fixture
def collector(tmp_path):
    db = tmp_path / "fleet.db"
    srv = make_server("127.0.0.1", 0, db, token=TOKEN)
    t = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", db
    srv.shutdown()


def _req(url, method="GET", body=None, token=TOKEN, headers=None, raw=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def _event(i=0, **kw):
    ev = {"event_id": f"ev{i:06d}abcd", "ts": "2026-10-23T12:00:00.000Z", "site": "chatgpt.com", "channel": "submit",
          "action": "warn", "decision": "cancelled", "detectors": {"customer_list": 40, "email_bulk": 40}}
    ev.update(kw)
    return ev


def _batch(events=None, usage=None, **profile):
    p = {"id": "prof_0123456789abcdef", "browser": "chrome", "label": "alice laptop", "extension_version": "0.1.0"}
    p.update(profile)
    return {"schema": "aiwarden.browser-events/v1", "profile": p, "events": events if events is not None else [_event()],
            "usage": usage if usage is not None else {"2026-10-23": {"chatgpt.com": {"seconds": 600, "visits": 3}}}}


def _fleet(url):
    status, _, body = _req(url + "/api/fleet")
    assert status == 200
    return json.loads(body)


def test_post_requires_token(collector):
    url, _ = collector
    assert _req(url + "/api/browser-events", "POST", _batch(), token=None)[0] == 401
    assert _req(url + "/api/browser-events", "POST", _batch(), token="wrong")[0] == 401


def test_roundtrip_and_fleet_aggregate(collector):
    url, _ = collector
    events = [_event(0),
              _event(1, site="claude.ai", action="block", decision="blocked", detectors={"github_token": 1}),
              _event(2, site="claude.ai", action="warn", decision="sent_anyway", detectors={"credit_card": 2}),
              _event(3, channel="file", detectors={"sensitive_file": 1}, action="block", decision="blocked",
                     file_ext="env", file_size=120, file_inspected=True)]
    usage = {"2026-10-23": {"chatgpt.com": {"seconds": 600, "visits": 3}, "claude.ai": {"seconds": 1200, "visits": 1}}}
    status, _, body = _req(url + "/api/browser-events", "POST", _batch(events, usage))
    assert status == 200 and json.loads(body) == {"ok": True, "accepted": 4}
    b = _fleet(url)["browser"]
    sites = {s["site"]: s for s in b["sites"]}
    assert sites["claude.ai"]["seconds"] == 1200 and sites["chatgpt.com"]["visits"] == 3
    assert sites["claude.ai"]["blocks"] == 1 and sites["claude.ai"]["warns"] == 1
    det = {d["detector"]: d for d in b["detectors"]}
    assert det["github_token"]["blocks"] == 1
    assert det["credit_card"]["warns"] == 1 and det["credit_card"]["sent_anyway"] == 1
    assert det["customer_list"]["cancelled"] == 1
    assert len(b["profiles"]) == 1 and b["profiles"][0]["label"] == "alice laptop"
    assert b["profiles"][0]["blocks"] == 2 and b["profiles"][0]["seconds"] == 1800
    assert len(b["events"]) == 4
    t = _fleet(url)["totals"]
    assert t["browser_profiles"] == 1 and t["browser_blocks"] == 2 and t["browser_warns"] == 2


def test_retries_are_idempotent_and_usage_takes_max(collector):
    url, _ = collector
    _req(url + "/api/browser-events", "POST", _batch([_event(0)], {"2026-10-23": {"chatgpt.com": {"seconds": 600, "visits": 3}}}))
    _req(url + "/api/browser-events", "POST", _batch([_event(0)], {"2026-10-23": {"chatgpt.com": {"seconds": 300, "visits": 1}}}))
    b = _fleet(url)["browser"]
    assert len(b["events"]) == 1
    assert b["sites"][0]["seconds"] == 600 and b["sites"][0]["visits"] == 3


def test_two_profiles_are_kept_apart(collector):
    url, _ = collector
    _req(url + "/api/browser-events", "POST", _batch([_event(0)]))
    _req(url + "/api/browser-events", "POST", _batch([_event(0)], id="prof_second_profile_1", browser="edge", label="bob"))
    b = _fleet(url)["browser"]
    assert {p["browser"] for p in b["profiles"]} == {"chrome", "edge"}
    assert len(b["events"]) == 2 and b["sites"][0]["profiles"] == 2


@pytest.mark.parametrize("field", ["prompt", "text", "content", "message", "snippet", "value", "filename", "url"])
def test_raw_content_fields_are_rejected_and_not_stored(collector, field):
    url, db = collector
    secret = "PLEASE-DO-NOT-STORE-THIS-TEXT"
    for body in (_batch([_event(0, **{field: secret})]), {**_batch(), field: secret},
                 _batch(**{field: secret})):
        status, _, resp = _req(url + "/api/browser-events", "POST", body)
        assert status == 422, (field, resp)
        assert "content" in json.loads(resp)["error"]
    with sqlite3.connect(db) as c:
        rows = c.execute("SELECT * FROM browser_events").fetchall() + c.execute("SELECT * FROM browser_profiles").fetchall()
    assert rows == []
    assert secret not in db.read_bytes().decode("latin-1")


@pytest.mark.parametrize("mutate", [
    lambda b: b.update(schema="aiwarden.report/v1"),
    lambda b: b.update(events="x"),
    lambda b: b.update(events=[1]),
    lambda b: b["profile"].update(id="../../etc"),
    lambda b: b["profile"].update(browser={"a": 1}),
    lambda b: b["profile"].update(label="x" * 200),
    lambda b: b["profile"].update(device_id="bad id!"),
    lambda b: b["events"][0].update(site="https://chatgpt.com/c/123"),
    lambda b: b["events"][0].update(site="UPPER.example.com"),
    lambda b: b["events"][0].update(action="nuke"),
    lambda b: b["events"][0].update(decision=["sent"]),
    lambda b: b["events"][0].update(channel="email"),
    lambda b: b["events"][0].update(ts="yesterday"),
    lambda b: b["events"][0].update(detectors={"Bad Kind!": 1}),
    lambda b: b["events"][0].update(detectors={"github_token": "1"}),
    lambda b: b["events"][0].update(detectors={"github_token": -1}),
    lambda b: b["events"][0].update(detectors={"github_token": True}),
    lambda b: b["events"][0].update(file_ext="this is a sentence"),
    lambda b: b["events"][0].update(file_size="big"),
    lambda b: b["events"][0].update(event_id="x"),
    lambda b: b.update(usage={"not-a-day": {}}),
    lambda b: b.update(usage={"2026-10-23": {"chatgpt.com": {"seconds": "lots"}}}),
    lambda b: b.update(usage={"2026-10-23": {"chatgpt.com": {"seconds": 10, "visits": 1, "prompt": "x"}}}),
    lambda b: b.update(usage={"2026-10-23": {"chatgpt.com": {"seconds": 10 ** 9}}}),
    lambda b: b.update(events=[_event(i) for i in range(501)]),
])
def test_validation_rejects_malformed(collector, mutate):
    url, _ = collector
    b = _batch()
    mutate(b)
    assert valid_browser_batch(b)[0] is False
    assert _req(url + "/api/browser-events", "POST", b)[0] == 422
    assert _fleet(url)["browser"]["events"] == []


def test_bad_json_and_sizes(collector):
    url, _ = collector
    assert _req(url + "/api/browser-events", "POST", raw=b"{not json")[0] == 400
    assert _req(url + "/api/browser-events", "POST", raw=b"[1, 2]")[0] == 422
    # Announce an oversized body; the server must refuse before reading it.
    import http.client
    host, port = url.removeprefix("http://").split(":")
    conn = http.client.HTTPConnection(host, int(port), timeout=5)
    conn.putrequest("POST", "/api/browser-events")
    conn.putheader("Authorization", f"Bearer {TOKEN}")
    conn.putheader("Content-Length", str(300 * 1024))
    conn.endheaders()
    assert conn.getresponse().status == 413
    conn.close()


def test_cors_preflight_only_for_extension_origin(collector):
    url, _ = collector
    pre = {"Origin": EXT_ORIGIN, "Access-Control-Request-Method": "POST",
           "Access-Control-Request-Headers": "authorization, content-type"}
    status, h, _ = _req(url + "/api/browser-events", "OPTIONS", token=None, headers=pre)
    assert status == 204
    assert h["Access-Control-Allow-Origin"] == EXT_ORIGIN and "Origin" in h["Vary"]
    assert "POST" in h["Access-Control-Allow-Methods"] and "authorization" in h["Access-Control-Allow-Headers"].lower()
    status, h, _ = _req(url + "/api/browser-events", "POST", _batch(), headers={"Origin": EXT_ORIGIN})
    assert status == 200 and h["Access-Control-Allow-Origin"] == EXT_ORIGIN
    for origin in ("https://evil.example.com", "chrome-extension://short", "moz-extension://" + "a" * 32, "null"):
        status, h, _ = _req(url + "/api/browser-events", "OPTIONS", token=None, headers={**pre, "Origin": origin})
        assert status == 403 and "Access-Control-Allow-Origin" not in h
        assert _req(url + "/api/browser-events", "POST", _batch(), headers={"Origin": origin})[0] == 403
    # Other API routes never get CORS headers, even for the extension.
    status, h, _ = _req(url + "/api/fleet", "OPTIONS", token=None, headers=pre)
    assert status in (403, 404) and "Access-Control-Allow-Origin" not in h
    status, h, _ = _req(url + "/api/fleet", headers={"Origin": EXT_ORIGIN})
    assert "Access-Control-Allow-Origin" not in h


def test_extension_id_allowlist(tmp_path):
    other = "chrome-extension://" + "p" * 32
    srv = make_server("127.0.0.1", 0, tmp_path / "f.db", token=TOKEN, extension_ids=["abcdefghijklmnopabcdefghijklmnop"])
    t = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    t.start()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}"
        assert _req(url + "/api/browser-events", "POST", _batch(), headers={"Origin": EXT_ORIGIN})[0] == 200
        assert _req(url + "/api/browser-events", "POST", _batch(), headers={"Origin": other})[0] == 403
    finally:
        srv.shutdown()


def test_tampered_db_rows_cannot_break_fleet(collector):
    url, db = collector
    _req(url + "/api/browser-events", "POST", _batch())
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO browser_events (profile_id, event_id, received_at, ts, site, channel, action, decision, detectors_json)"
                  " VALUES ('prof_0123456789abcdef','evil0001','x','x','<script>','submit','warn','sent','{not json')")
        c.execute("INSERT INTO browser_events (profile_id, event_id, received_at, ts, site, channel, action, decision, detectors_json)"
                  " VALUES ('prof_0123456789abcdef','evil0002','x','x','claude.ai','submit','warn','sent','[1,2]')")
        c.execute("INSERT INTO browser_usage (profile_id, day, site, seconds, visits) VALUES ('p','2026-10-23','x.com','abc',NULL)")
    f = _fleet(url)
    assert len(f["browser"]["events"]) == 1
    assert f["totals"]["invalid_browser_rows"] >= 2


def test_aggregate_without_browser_data_is_backward_compatible():
    out = aggregate([])
    assert out["browser"]["events"] == [] and out["browser"]["sites"] == []
    assert aggregate_browser(None)["profiles"] == []


def test_browser_profile_links_to_device_hostname(collector):
    url, _ = collector
    _req(url + "/api/browser-events", "POST", _batch(device_id="dev-123"))
    rows = [("2026-10-23T00:00:00+00:00", {"schema": "aiwarden.report/v1", "device": {"id": "dev-123", "hostname": "alice-mbp"}})]
    from aiwarden.server import Store
    out = aggregate(rows, Store(collector[1]).browser_rows())
    assert out["browser"]["profiles"][0]["hostname"] == "alice-mbp"


def test_extension_background_batch_passes_collector_validation():
    """Contract test: run the real extension/background.js under Node and validate what it would POST."""
    import shutil
    import subprocess
    from pathlib import Path
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    script = Path(__file__).resolve().parent.parent / "extension" / "test" / "emit_batch.js"
    out = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, timeout=30, check=True).stdout)
    batch = out["posted"]["body"]
    assert out["posted"]["url"].endswith("/api/browser-events")
    assert out["posted"]["headers"]["Authorization"] == "Bearer t"
    ok, why = valid_browser_batch(batch)
    assert ok, why
    # 2 good events + 1 whose bad timestamp was replaced; the event with channel "email" was dropped.
    assert len(batch["events"]) == 3 and batch["profile"]["device_id"] == "dev-1"
    assert {e["channel"] for e in batch["events"]} == {"paste", "file"}
    assert batch["profile"]["label"] == "ci profile"
    assert batch["usage"][next(iter(batch["usage"]))]["chatgpt.com"] == {"seconds": 30, "visits": 1}
    dump = json.dumps(out)
    assert "SHOULD-NOT-LEAVE" not in dump and "secret.env" not in dump and "Bad Key" not in dump
    assert out["store"]["outbox"] == [] and out["result"]["ok"] is True
