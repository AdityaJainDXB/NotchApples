#!/usr/bin/env python3
"""Development server for the Windows UI in an ordinary browser.

Serves NotchWindows/src and answers POST /__http the way the app's Rust `http`
command does, so network features (weather, sports, markets, AI) use real data
while designing without building the app. Never shipped.

    python3 NotchWindows/dev/serve.py   ->  http://localhost:8767/index.html
"""

import base64, http.server, json, os, socketserver, ssl, sys, urllib.error, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8767


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/__http":
            self.send_error(404)
            return
        req = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        body = req.get("body")
        r = urllib.request.Request(req["url"], data=body.encode() if isinstance(body, str) else None,
                                   method=req.get("method", "GET"))
        r.add_header("User-Agent", "NotchApple/dev (Windows)")
        for k, v in (req.get("headers") or {}).items():
            r.add_header(k, v)
        try:
            with urllib.request.urlopen(r, timeout=(req.get("timeout") or 30000) / 1000, context=ssl.create_default_context()) as resp:
                data, status, headers = resp.read(), resp.status, dict(resp.headers)
        except urllib.error.HTTPError as e:
            data, status, headers = e.read(), e.code, dict(e.headers or {})
        except Exception as e:  # noqa: BLE001 - report any failure to the page
            data, status, headers = str(e).encode(), 0, {}
        text = base64.b64encode(data).decode() if req.get("binary") else data.decode("utf-8", "replace")
        out = json.dumps({"status": status, "ok": 200 <= status < 300, "body": text,
                          "headers": {k.lower(): v for k, v in headers.items()}}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"http://localhost:{PORT}/index.html")
    httpd.serve_forever()
