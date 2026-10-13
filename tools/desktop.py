#!/usr/bin/env python3
"""Local /api stand-in on 127.0.0.1:32499 for browser UI development.

Run alongside `npm run dev` in web/ and open http://localhost:5173/.
Browsing uses real Plex servers; playback commands are logged without
playing media. Settings, including tokens, are in .cache/desktop-store.json.
"""
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 32499
STORE = os.path.join(os.path.dirname(__file__), "..", ".cache", "desktop-store.json")
STATE = {
    "mode": "browse",
    "hdrWhite": 203,
    "screensaver": 0,
    "player": {"state": "idle", "time": 0, "duration": None, "session": None, "meta": None, "ended": None,
               "audio": None, "subtitles": None, "audioIndex": None, "subtitleIndex": None},
    "decoders": None,
}
RUN = uuid.uuid4().hex


def store(changes=None):
    try:
        with open(STORE) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError):
        data = {}
    if changes:
        data = {k: v for k, v in {**data, **changes}.items() if v is not None}
        os.makedirs(os.path.dirname(STORE), exist_ok=True)
        fd = os.open(STORE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
    return data


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/store":
            return self.json({**store(), "run": RUN})
        if path != "/api/events":
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(f"event: state\ndata: {json.dumps(STATE)}\n\n".encode())
            self.wfile.flush()
            while not self.server.stopping.wait(15):
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
        if self.path == "/api/store":
            return self.json(store(data))
        if self.path != "/api/cmd":
            return self.send_error(404)
        # Only the command's name: some carry tokens.
        print(f"page: {data.get('cmd')}", flush=True)
        self.json({"result": None})

    def json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    server.stopping = threading.Event()
    print(f"add-on stand-in on http://127.0.0.1:{PORT}; now `npm run dev` in web/ "
          "and open http://localhost:5173/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.stopping.set()
