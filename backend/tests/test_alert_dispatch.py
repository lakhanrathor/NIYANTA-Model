"""Alert delivery: recipients, plain-language message, per-channel log."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


def _client():
    from fastapi.testclient import TestClient

    from app import create_app

    return TestClient(create_app())


def test_dispatch_reaches_matching_recipients_only():
    from modules.alert import rules
    from modules.db import client as db

    got: list[dict] = []

    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - http.server API
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):  # silence test output
            pass

    srv = HTTPServer(("127.0.0.1", 0), Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    hook = f"http://127.0.0.1:{srv.server_port}/hook"
    with _client() as c:
        # trust boundary: nothing to reach them on / bad email → 422
        assert c.post("/api/alerts/recipients", json={"name": "No channel"}).status_code == 422
        assert c.post("/api/alerts/recipients", json={"name": "X", "email": "not-an-email"}).status_code == 422

        near = c.post("/api/alerts/recipients", json={
            "name": "DM Testpur", "org": "District", "email": "dm@example.gov.in", "webhook": hook,
            "states": ["Teststate"], "min_level": "WARNING"}).json()
        far = c.post("/api/alerts/recipients", json={
            "name": "Elsewhere", "webhook": hook, "states": ["Otherstate"], "min_level": "WARNING"}).json()

        alert = rules.create("WARNING", "Test dam: flood arrives within hours", "body", source="test",
                             location="Testriver, Teststate")
        out = c.post(f"/api/alerts/{alert['id']}/dispatch").json()
        srv.shutdown()

        assert out["recipients"] == 1  # the other state's officer is not paged
        by_channel = {d["channel"]: d["status"] for d in out["deliveries"]}
        assert by_channel["webhook"] == "sent"
        assert by_channel["email"] == "not_configured"  # no SMTP in tests — never claimed as sent
        assert len(got) == 1 and "WARNING alert" in got[0]["text"]
        log = c.get(f"/api/alerts/{alert['id']}/deliveries").json()
        assert {d["recipient_name"] for d in log} == {"DM Testpur"}
        assert db.query_one("SELECT state FROM alert WHERE id = %s", (alert["id"],))["state"] == "DISPATCH"

        for r in (near, far):
            c.delete(f"/api/alerts/recipients/{r['id']}")
