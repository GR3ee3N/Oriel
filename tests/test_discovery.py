import json
import socket
import threading
import unittest

from .repository import ROOT, load


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.module = load("oriel_discovery", ROOT / "addon/discovery.py")
        self.module.LISTEN = 0.5
        self.server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.settimeout(2)
        self.addCleanup(self.server.close)
        self.changes = threading.Event()
        self.logged = []

    def answer(self, *replies):
        """Answer the next question with each reply in turn."""

        def run():
            question, sender = self.server.recvfrom(4096)
            self.assertEqual(question, b"who is JellyfinServer?")
            for reply in replies:
                self.server.sendto(reply if isinstance(reply, bytes) else json.dumps(reply).encode(), sender)

        thread = threading.Thread(target=run)
        thread.start()
        return thread

    def discover(self, *replies):
        discovery = self.module.Discovery(self.changes.set, self.logged.append, target=self.server.getsockname())
        thread = self.answer(*replies)
        discovery.start()
        self.assertTrue(discovery.state()["searching"])
        thread.join()
        for _ in range(50):
            if not discovery.state()["searching"]:
                break
            threading.Event().wait(0.05)
        return discovery.state()

    def test_lists_each_server_once_with_its_sender_address(self):
        reply = {"Id": "abc", "Name": "Den", "Address": "http://172.17.0.2:8096", "EndpointAddress": None}
        state = self.discover(reply, reply, b"not json", {"Id": "x"}, {"Id": "", "Name": "n", "Address": "http://a"})
        self.assertEqual(state, {
            "searching": False,
            "servers": [{"id": "abc", "name": "Den", "addresses": ["http://172.17.0.2:8096", "http://127.0.0.1:8096"]}],
        })
        self.assertEqual(self.logged, [])

    def test_keeps_one_address_when_the_server_advertises_where_it_answered_from(self):
        state = self.discover({"Id": "abc", "Name": "Den", "Address": "http://127.0.0.1:8096/"})
        self.assertEqual(state["servers"][0]["addresses"], ["http://127.0.0.1:8096"])

    def test_addresses_keep_the_scheme_and_port(self):
        self.assertEqual(self.module.addresses("https://jf.example:8920", "10.0.0.5"),
                         ["https://jf.example:8920", "https://10.0.0.5:8920"])
        self.assertEqual(self.module.addresses("http://jf.example", "10.0.0.5"),
                         ["http://jf.example", "http://10.0.0.5"])

    def test_a_network_failure_ends_the_search(self):
        discovery = self.module.Discovery(self.changes.set, self.logged.append, target=("256.0.0.1", 7359))
        discovery.search()
        self.assertEqual(discovery.state(), {"searching": False, "servers": []})
        self.assertEqual(len(self.logged), 1)


if __name__ == "__main__":
    unittest.main()
