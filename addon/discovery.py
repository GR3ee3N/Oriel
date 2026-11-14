"""Find Jellyfin servers on the box's network. Jellyfin answers a UDP
broadcast of "who is JellyfinServer?" on port 7359 with its id, name and
address. A server in a container can advertise an address only the
container reaches, so each answer also offers the address it came from,
on the advertised port.
"""
import json
import socket
import threading
import time
from urllib.parse import urlsplit

PORT = 7359
QUESTION = b"who is JellyfinServer?"
# Servers on the same network answer within milliseconds.
LISTEN = 1.5


def addresses(advertised, sender):
    """The advertised address, then the same scheme and port at the sender."""
    out = [advertised.rstrip("/")]
    try:
        parts = urlsplit(advertised)
        port = parts.port
    except ValueError:
        return out
    if parts.hostname != sender:
        out.append(f"{parts.scheme or 'http'}://{sender}{f':{port}' if port else ''}")
    return out


class Discovery:
    def __init__(self, changed, log, target=("255.255.255.255", PORT)):
        """`changed` runs on the search thread when the state changes; `log` takes one message."""
        self.changed = changed
        self.log = log
        self.target = target
        self.lock = threading.Lock()
        self.searching = False
        self.servers = {}

    def state(self):
        with self.lock:
            return {"searching": self.searching, "servers": list(self.servers.values())}

    def start(self):
        """Start a search unless one is running. Servers found earlier stay listed."""
        with self.lock:
            if self.searching:
                return
            self.searching = True
        self.changed()
        threading.Thread(target=self.search, name="discovery", daemon=True).start()

    def search(self):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.settimeout(0.2)
                s.sendto(QUESTION, self.target)
                end = time.monotonic() + LISTEN
                while time.monotonic() < end:
                    try:
                        data, (sender, _) = s.recvfrom(4096)
                    except socket.timeout:
                        continue
                    if self.add(data, sender):
                        self.changed()
        except OSError as e:
            self.log(f"server discovery failed: {e}")
        finally:
            with self.lock:
                self.searching = False
            self.changed()

    def add(self, data, sender):
        """Keep one answer; return whether it named a new server or address."""
        try:
            reply = json.loads(data)
            key, name, address = reply["Id"], reply["Name"], reply["Address"]
        except (ValueError, KeyError, TypeError):
            return False
        if not all(isinstance(v, str) and v for v in (key, name, address)):
            return False
        server = {"id": key, "name": name, "addresses": addresses(address, sender)}
        with self.lock:
            if self.servers.get(key) == server:
                return False
            self.servers[key] = server
        return True
