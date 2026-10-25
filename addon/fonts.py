"""Download the optional extra fonts for the page: colour emoji and scripts
such as Chinese, Japanese, Korean, Thai and Indian scripts.

resources/fonts.json names the ZIP that build/fonts.py made and the release
it downloads from. It unpacks into <files dir>/fonts, which the page loads
as /files/fonts/fonts.css. Kodi keeps the files directory through add-on
updates.
"""
import hashlib
import json
import os
import re
import shutil
import threading
import urllib.request
import zipfile

# Unpacked names: fonts.css, LICENSE.txt and the woff2 files, all flat.
NAME = re.compile(r"[\w.-]+")


class Fonts:
    def __init__(self, package, files_dir, changed, log):
        """`changed` runs on the download thread after each step; `log` takes one message."""
        try:
            with open(package) as f:
                self.package = json.load(f)
        except FileNotFoundError:
            self.package = None
        self.dir = os.path.join(files_dir, "fonts")
        self.changed = changed
        self.log = log
        self.lock = threading.Lock()
        self.received = None
        self.error = None
        self.installed = self.read_version()
        # A download that stopped with the app leaves these behind.
        self.clean()

    def read_version(self):
        try:
            with open(os.path.join(self.dir, "VERSION")) as f:
                return f.read().strip()
        except FileNotFoundError:
            return None

    def clean(self):
        shutil.rmtree(self.dir + ".new", ignore_errors=True)
        if os.path.exists(self.dir + ".zip"):
            os.remove(self.dir + ".zip")

    def state(self):
        """None when this build has no font package."""
        with self.lock:
            if not self.package:
                return None
            if self.received is not None:
                status = "downloading"
            elif self.installed == self.package["sha256"]:
                status = "installed"
            elif self.installed:
                status = "outdated"
            else:
                status = "failed" if self.error else "missing"
            return {"status": status, "size": self.package["size"], "received": self.received or 0,
                    "version": self.installed and self.installed[:12], "error": self.error,
                    "scripts": self.package.get("scripts", [])}

    def install(self):
        """Start the download; False if there is nothing to download or one is running."""
        with self.lock:
            if not self.package or self.received is not None:
                return False
            self.received = 0
            self.error = None
        threading.Thread(target=self.download, name="oriel-fonts", daemon=True).start()
        return True

    def remove(self):
        """Delete the fonts; False while a download runs."""
        with self.lock:
            if self.received is not None:
                return False
            shutil.rmtree(self.dir, ignore_errors=True)
            self.installed = None
            self.error = None
        return True

    def download(self):
        url, sha256, size = self.package["url"], self.package["sha256"], self.package["size"]
        part, new = self.dir + ".zip", self.dir + ".new"
        try:
            os.makedirs(os.path.dirname(self.dir), exist_ok=True)
            digest = hashlib.sha256()
            received = reported = 0
            with urllib.request.urlopen(url, timeout=30) as response, open(part, "wb") as f:
                while chunk := response.read(1 << 16):
                    received += len(chunk)
                    if received > size:
                        raise ValueError("the download is larger than expected")
                    digest.update(chunk)
                    f.write(chunk)
                    if received - reported >= size // 100:
                        reported = received
                        with self.lock:
                            self.received = received
                        self.changed()
            if received != size or digest.hexdigest() != sha256:
                raise ValueError("the download does not match this version's fonts")
            with zipfile.ZipFile(part) as archive:
                names = archive.namelist()
                if "fonts.css" not in names or not all(NAME.fullmatch(n) and not n.startswith(".") for n in names):
                    raise ValueError("the download holds unexpected files")
                archive.extractall(new)
            with open(os.path.join(new, "VERSION"), "w") as f:
                f.write(sha256)
            shutil.rmtree(self.dir, ignore_errors=True)
            os.rename(new, self.dir)
            with self.lock:
                self.installed = sha256
            self.log(f"fonts: installed {url.rsplit('/', 1)[1]}")
        except Exception as e:
            self.log(f"fonts: {url} failed: {e}")
            with self.lock:
                self.error = str(e)
        finally:
            self.clean()
            with self.lock:
                self.received = None
            self.changed()
