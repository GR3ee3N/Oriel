#!/usr/bin/env python3
"""Serve a simulated add-on API at 127.0.0.1:32499 for browser development.

Run alongside `npm run dev` in web/ and open http://localhost:5173/.
Browsing uses real Plex servers. No media plays; simulated player state
supports OSD visibility, pause, seek and end-of-playback testing. The state
follows addon/lib/oriel/video.py in oriel-framework. Settings, including
Plex tokens, are stored in .cache/desktop-store.json.
"""
import json
import os
import queue
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 32499
STORE = os.path.join(os.path.dirname(__file__), "..", ".cache", "desktop-store.json")
FAILURES = {"invalid": 400, "unavailable": 409, "failed": 500}
# Simulated loading delay in seconds.
LOADING = 1.5


def player_state(state="idle", time=0, duration=None, session=None, meta=None, ended=None):
    return {"state": state, "time": time, "duration": duration, "session": session, "meta": meta,
            "ended": ended, "audio": None, "subtitles": None, "audioIndex": None, "subtitleIndex": None}


STATE = {
    "run": uuid.uuid4().hex,
    "mode": "browse",
    "cpuRendering": False,
    "screensaver": 0,
    "player": player_state(),
    "decoders": None,
    # App.tsx handles video keys here because no add-on receives them.
    "desktop": True,
}
LOCK = threading.RLock()
CLIENTS = set()
# Query this source for the duration Kodi would read from the file.
SOURCE = {"base": None, "headers": {}}
plays = 0
# Stream start in seconds on the item's timeline.
stream_offset = 0


class CommandError(Exception):
    def __init__(self, message, code="unavailable"):
        super().__init__(message)
        self.code = code


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


def publish():
    with LOCK:
        state = json.dumps(STATE)
        for q in CLIENTS:
            q.put(state)


def set_player(**changes):
    STATE["player"].update(changes)
    publish()


def require_started():
    state = STATE["player"]["state"]
    if state not in ("playing", "paused"):
        raise CommandError(f"not possible while {state}")


def end(why):
    p = STATE["player"]
    STATE["mode"] = "browse"
    STATE["player"] = player_state("idle", p["time"], p["duration"], p["session"], p["meta"], why)
    publish()


def plex_duration(meta):
    key = (meta or {}).get("ratingKey")
    if not SOURCE["base"] or not key:
        return None
    request = urllib.request.Request(f"{SOURCE['base']}/library/metadata/{key}",
                                     headers={**SOURCE["headers"], "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as r:
            ms = json.load(r)["MediaContainer"]["Metadata"][0].get("duration")
    except (OSError, ValueError, KeyError, IndexError) as e:
        print(f"duration of {key}: {e}", flush=True)
        return None
    return ms and ms // 1000


def start(play, duration, meta, paused):
    # The page supplies transcode duration; query Plex for direct-play duration.
    duration = duration or plex_duration(meta)
    time.sleep(LOADING)
    with LOCK:
        if play != plays or STATE["player"]["state"] != "loading":
            return
        STATE["mode"] = "osd" if paused else "video"
        set_player(state="paused" if paused else "playing", duration=duration, audio=[], subtitles=[])


def tick():
    while True:
        time.sleep(1)
        with LOCK:
            p = STATE["player"]
            if p["state"] != "playing":
                continue
            if p["duration"] is not None and p["time"] + 1 >= p["duration"]:
                end("ended")
            else:
                set_player(time=p["time"] + 1)


def command(cmd, base=None, headers=None, session=None, position=None, streamOffset=None,
            duration=None, meta=None, paused=None, seconds=None, index=None, **_):
    global plays, stream_offset
    p = STATE["player"]
    if cmd == "media-source":
        SOURCE.update(base=base, headers=headers or {})
    elif cmd == "play":
        position = position or 0
        if position < (streamOffset or 0):
            raise CommandError("the position is before the stream's beginning", "invalid")
        same = session is not None and session == p["session"]
        paused = same and p["state"] == "paused"
        plays += 1
        STATE["mode"] = "video"
        STATE["player"] = player_state("loading", int(position), duration and int(duration), session, meta)
        stream_offset = streamOffset or 0
        publish()
        threading.Thread(target=start, args=(plays, duration, meta, paused), daemon=True).start()
    elif cmd == "set-paused":
        require_started()
        set_player(state="paused" if paused else "playing")
    elif cmd == "stop":
        if STATE["mode"] != "browse":
            end("stopped")
    elif cmd == "seek-to":
        require_started()
        if seconds < stream_offset or (p["duration"] is not None and seconds > p["duration"]):
            raise CommandError("outside the stream")
        set_player(time=int(seconds))
    elif cmd == "audio":
        require_started()
        set_player(audioIndex=index)
    elif cmd == "subtitle":
        require_started()
        set_player(subtitleIndex=None if index is None or index < 0 else index)
    elif cmd == "osd-on":
        if STATE["mode"] != "osd":
            require_started()
            STATE["mode"] = "osd"
            publish()
    elif cmd == "osd-off":
        if STATE["mode"] == "osd":
            STATE["mode"] = "video"
            publish()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/store":
            return self.json(store())
        if path != "/api/events":
            return self.send_error(404)
        q = queue.Queue()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        with LOCK:
            CLIENTS.add(q)
            q.put(json.dumps(STATE))
        try:
            while True:
                try:
                    state = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self.wfile.write(f"event: state\ndata: {state}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                CLIENTS.discard(q)

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
        if self.path == "/api/store":
            return self.json(store(data))
        if self.path != "/api/cmd":
            return self.send_error(404)
        # Log command names only; fields can contain tokens.
        print(f"page: {data.get('cmd')}", flush=True)
        try:
            with LOCK:
                command(**data)
        except CommandError as e:
            print(f"page: {data.get('cmd')} refused: {e}", flush=True)
            return self.json({"error": str(e), "code": e.code}, FAILURES[e.code])
        self.json({"result": None})

    def json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
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
    threading.Thread(target=tick, daemon=True).start()
    print(f"add-on stand-in on http://127.0.0.1:{PORT}; now `npm run dev` in web/ "
          "and open http://localhost:5173/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
