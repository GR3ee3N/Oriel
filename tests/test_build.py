import json
import shutil

from .repository import ROOT, RepositoryTests, versions


class BuildTests(RepositoryTests):
    def test_framework_dependency_and_lock_match_version(self):
        version = versions()["FRAMEWORK_VERSION"]
        url = f"https://github.com/GR3ee3N/oriel-framework/releases/download/v{version}/oriel-web-{version}.tgz"
        package = json.loads((ROOT / "web/package.json").read_text())
        lock = json.loads((ROOT / "web/package-lock.json").read_text())["packages"][""]
        self.assertEqual(package["dependencies"]["@oriel/web"], url)
        self.assertEqual(lock["dependencies"], package["dependencies"])
        self.assertEqual(lock["engines"], package["engines"])

    def test_check_discovers_failing_tests_and_stops_before_web_install(self):
        self.npm()
        tests = self.root / "tests"
        shutil.rmtree(tests)
        tests.mkdir()
        (tests / "__init__.py").touch()
        (tests / "test_failure.py").write_text('import unittest\nclass Regression(unittest.TestCase):\n    def test_failure(self): self.fail("regression reached")\n')
        self.executable("shellcheck", "#!/bin/sh\nexit 0\n")
        self.assertIn("regression reached", self.command("tools/check.sh", success=False))
        self.assertFalse((self.root / ".cache/commands").exists())

    def test_build_stages_page_assets_licenses_and_expected_versions(self):
        self.npm()
        self.command("tools/build.sh")
        addon = self.root / ".cache/runtime/script.oriel.oriel"
        xml = (addon / "addon.xml").read_text()
        self.assertIn(f'version="{self.v}"', xml)
        self.assertIn(f'addon="script.module.oriel.framework" version="{self.f}"', xml)
        for file in (self.root / "web/dist").rglob("*"):
            if file.is_file():
                self.assertEqual((addon / "resources/web" / file.relative_to(self.root / "web/dist")).read_bytes(), file.read_bytes())
        self.assertEqual((addon / "LICENSE.txt").read_bytes(), (self.root / "LICENSE").read_bytes())
        self.assertIn("@oriel/web", (addon / "THIRD-PARTY-NOTICES.txt").read_text())

    def test_failed_bundle_preserves_previous_runtime(self):
        self.npm()
        self.command("tools/build.sh")
        addon = self.root / ".cache/runtime/script.oriel.oriel"
        previous = (addon / "resources/web/index.html").read_bytes()
        self.command("tools/build.sh", success=False, TEST_FAIL_NPM="run build")
        self.assertEqual((addon / "resources/web/index.html").read_bytes(), previous)

    def test_wrong_framework_dependency_is_refused_before_install(self):
        self.npm()
        path = self.root / "web/package.json"
        path.write_text(path.read_text().replace(f"oriel-web-{self.f}.tgz", "oriel-web-9.9.9.tgz"))
        self.assertIn("must install @oriel/web", self.command("tools/build.sh", success=False))
        self.assertFalse((self.root / ".cache/commands").exists())
