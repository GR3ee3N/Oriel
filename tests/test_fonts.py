import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile

from .repository import ROOT, load


def font_zip(names):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, f"data {name}")
    return buffer.getvalue()


class FontTests(unittest.TestCase):
    def setUp(self):
        self.module = load("oriel_fonts", ROOT / "addon/fonts.py")
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="oriel-fonts-test-")))
        self.files = self.directory / "files"
        self.body = font_zip(["fonts.css", "LICENSE.txt", "a-0-wght-normal.woff2"])

        test = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(test.served)))
                self.end_headers()
                self.wfile.write(test.served)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.served = self.body
        self.done = threading.Event()
        self.log = []

    def fonts(self, body=None):
        body = body or self.body
        package = self.directory / "fonts.json"
        package.write_text(json.dumps({"url": f"http://127.0.0.1:{self.server.server_address[1]}/f.zip",
                                       "sha256": hashlib.sha256(body).hexdigest(), "size": len(body), "scripts": ["Thai"]}))
        return self.module.Fonts(str(package), str(self.files), self.changed, self.log.append)

    def changed(self):
        if self.fonts_under_test.state()["status"] != "downloading":
            self.done.set()

    def download(self, fonts):
        self.fonts_under_test = fonts
        self.assertTrue(fonts.install())
        self.assertTrue(self.done.wait(5))
        return fonts.state()

    def test_download_unpacks_the_fonts_and_survives_a_restart(self):
        state = self.download(self.fonts())
        self.assertEqual(state["status"], "installed")
        self.assertEqual(state["version"], hashlib.sha256(self.body).hexdigest()[:12])
        self.assertEqual(state["scripts"], ["Thai"])
        self.assertEqual((self.files / "fonts/fonts.css").read_text(), "data fonts.css")
        self.assertEqual(sorted(p.name for p in self.files.iterdir()), ["fonts"])
        self.assertEqual(self.fonts().state()["status"], "installed")

    def test_damaged_download_leaves_nothing_behind(self):
        fonts = self.fonts()
        self.served = self.body[:-1] + b"x"
        state = self.download(fonts)
        self.assertEqual(state["status"], "failed")
        self.assertIn("does not match", state["error"])
        self.assertEqual(list(self.files.iterdir()), [])

    def test_unexpected_names_are_refused(self):
        for name in ("../escape.css", ".hidden", "dir/a.woff2"):
            with self.subTest(name=name):
                self.done.clear()
                self.served = font_zip(["fonts.css", name])
                state = self.download(self.fonts(self.served))
                self.assertEqual(state["status"], "failed")
                self.assertFalse((self.files / "fonts").exists())
                self.assertFalse((self.directory / "escape.css").exists())

    def test_an_older_version_stays_usable_until_the_update_replaces_it(self):
        self.download(self.fonts())
        newer = font_zip(["fonts.css", "b-0-wght-normal.woff2"])
        self.served = newer
        fonts = self.fonts(newer)
        self.assertEqual(fonts.state()["status"], "outdated")
        self.done.clear()
        self.assertEqual(self.download(fonts)["status"], "installed")
        self.assertFalse((self.files / "fonts/a-0-wght-normal.woff2").exists())

    def test_remove_deletes_the_fonts(self):
        fonts = self.fonts()
        self.download(fonts)
        self.assertTrue(fonts.remove())
        self.assertEqual(fonts.state()["status"], "missing")
        self.assertFalse((self.files / "fonts").exists())

    def test_a_build_without_fonts_reports_none(self):
        fonts = self.module.Fonts(str(self.directory / "none.json"), str(self.files), self.changed, self.log.append)
        self.assertIsNone(fonts.state())
        self.assertFalse(fonts.install())
