import json

from .repository import RepositoryTests, load


class NoticesTests(RepositoryTests):
    def setUp(self):
        super().setUp()
        self.notices = load("oriel_notices", self.root / "build/notices.py")
        self.web = self.root / "web"
        (self.web / "package.json").write_text(json.dumps({"name": "app", "dependencies": {"runtime": "1.0"},
                                                        "devDependencies": {"compiler": "1.0"}}))
        self.dependency("runtime", dependencies={"nested": "1.0"}, peerDependencies={"peer": "1.0"})
        self.dependency("nested", dependencies={"peer": "1.0"})
        self.dependency("peer")
        self.dependency("compiler")
        self.output = self.temporary / "notices.txt"

    def dependency(self, name, **info):
        directory = self.web / "node_modules" / name
        directory.mkdir(parents=True)
        (directory / "package.json").write_text(json.dumps(dict(name=name, version="1.0", license="MIT", **info)))
        (directory / "LICENSE").write_text(f"License text for {name}")

    def test_notices_include_transitive_and_peer_dependencies_once_and_exclude_dev_tools(self):
        self.assertEqual([name for name, *_ in self.notices.npm(self.web)], ["nested", "peer", "runtime"])
        self.command("python3", "build/notices.py", "web", str(self.output))
        text = self.output.read_text()
        for name in ("nested", "peer", "runtime"):
            self.assertEqual(text.count(f"License text for {name}"), 1)
        self.assertNotIn("compiler", text)

    def test_notice_filenames_are_case_insensitive(self):
        path = self.web / "node_modules/runtime"
        (path / "LICENSE").rename(path / "licence.txt")
        self.command("python3", "build/notices.py", "web", str(self.output))
        self.assertIn("License text for runtime", self.output.read_text())

    def test_missing_license_stops_without_writing_incomplete_notices(self):
        (self.web / "node_modules/peer/LICENSE").unlink()
        self.assertIn("no license file in peer 1.0", self.command("python3", "build/notices.py", "web", str(self.output), success=False))
        self.assertFalse(self.output.exists())

    def test_missing_runtime_dependency_is_a_failure(self):
        (self.web / "node_modules/runtime/package.json").unlink()
        self.assertIn("cannot find runtime", self.command("python3", "build/notices.py", "web", str(self.output), success=False))
