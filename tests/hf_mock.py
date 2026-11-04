"""Minimal Higgsfield API stand-in for the Rust bridge integration test. Checks auth, paths and headers."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
BASE = f"http://127.0.0.1:{PORT}"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
state = {"polls": 0, "uploaded": None}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else json.dumps(body or {}).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def authed(self):
        if self.headers.get("Authorization") != "Key key-id:s3cret":
            self.send(401, {"detail": "bad key"}); return False
        return True
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); return self.rfile.read(n)
    def do_POST(self):
        p = self.path
        if p == "/files/generate-upload-url":
            if not self.authed(): return
            ct = json.loads(self.body())["content_type"]
            return self.send(200, {"public_url": f"{BASE}/public/1.png", "upload_url": f"{BASE}/upload/1", "content_type": ct, "upload_headers": {"Content-Type": ct}})
        if not self.authed(): return
        b = json.loads(self.body() or b"{}")
        if p.startswith("/estimate/"):
            return self.send(200, {"usd": "0.094"})
        if p.endswith("/cancel"):
            return self.send(202, {})
        if p == "/kling-video/v2.6/pro/image-to-video" and "image_url" not in b:
            return self.send(422, {"detail": [{"loc": ["body", "image_url"], "msg": "Field required"}]})
        if p == "/alibaba/qwen-image-3/edit":
            assert self.headers.get("Idempotency-Key"), "missing Idempotency-Key"
            return self.send(200, {"status": "queued", "request_id": "req-123", "status_url": f"{BASE}/requests/req-123/status", "cancel_url": f"{BASE}/requests/req-123/cancel"})
        self.send(404, {"detail": "no route " + p})
    def do_PUT(self):
        if self.path == "/upload/1":
            assert self.headers.get("Authorization") is None, "API key leaked to the upload URL"
            state["uploaded"] = self.body(); return self.send(200, {})
        self.send(404)
    def do_GET(self):
        if self.path == "/requests/req-123/status":
            if not self.authed(): return
            state["polls"] += 1
            if state["polls"] < 2: return self.send(200, {"status": "in_progress", "request_id": "req-123"})
            return self.send(200, {"status": "completed", "request_id": "req-123", "images": [{"url": f"{BASE}/result/1.png"}]})
        if self.path == "/result/1.png":
            return self.send(200, raw=PNG, ctype="image/png")
        self.send(404)

HTTPServer(("127.0.0.1", PORT), H).serve_forever()
