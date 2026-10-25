import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile

from .repository import RepositoryTests, load


class PackageTests(RepositoryTests):
    def setUp(self):
        super().setUp()
        self.npm()
        self.command("tools/build.sh")
        self.package = load("oriel_package", self.root / "build/package.py")
        self.addon = self.root / ".cache/runtime/script.oriel.oriel"
        self.files = self.root / ".cache/release/files"
        self.package.package(self.addon, self.files)
        self.zip = self.files / f"script.oriel.oriel-{self.v}.zip"

    def test_addon_contains_page_notices_and_expected_versions(self):
        self.package.validate(self.files, "script.oriel.oriel", self.v, self.f)
        with zipfile.ZipFile(self.zip) as archive:
            self.assertEqual(archive.read("script.oriel.oriel/default.py"), (self.addon / "default.py").read_bytes())
            for file in (self.root / "web/dist").rglob("*"):
                if file.is_file():
                    name = file.relative_to(self.root / "web/dist").as_posix()
                    self.assertEqual(archive.read(f"script.oriel.oriel/resources/web/{name}"), file.read_bytes())
            self.assertIn(b"@oriel/web", archive.read("script.oriel.oriel/THIRD-PARTY-NOTICES.txt"))
            self.assertEqual(archive.read("script.oriel.oriel/LICENSE.txt"), (self.root / "LICENSE").read_bytes())

    def test_index_art_and_checksums_match_files(self):
        entry = ET.parse(self.files / "addons.xml").getroot().find("addon")
        self.assertEqual(entry.findtext("extension/path"), self.zip.name)
        for asset in entry.find("extension/assets"):
            self.assertEqual((self.files / asset.text).read_bytes(), (self.addon / "resources" / f"{asset.tag}.png").read_bytes())
        for name in (self.zip.name, "addons.xml"):
            digest = hashlib.sha256((self.files / name).read_bytes()).hexdigest()
            self.assertEqual((self.files / f"{name}.sha256").read_text(), f"{digest}  {name}\n")

    def test_validation_rejects_corrupt_files(self):
        with self.zip.open("ab") as file:
            file.write(b"corruption")
        with self.assertRaisesRegex(SystemExit, "sha256 does not match"):
            self.package.validate(self.files, "script.oriel.oriel", self.v, self.f)

    def test_fonts_join_the_release_under_the_name_the_addon_downloads(self):
        fonts = json.loads((self.addon / "resources/fonts.json").read_text())
        name = fonts["url"].removeprefix(f"https://github.com/GR3ee3N/Oriel/releases/download/v{self.v}/")
        data = (self.files / name).read_bytes()
        self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (fonts["size"], fonts["sha256"]))
        self.assertIn("Thai", fonts["scripts"])
        with zipfile.ZipFile(self.files / name) as archive:
            css = archive.read("fonts.css").decode()
            self.assertIn("src: url(./noto-sans-jp-0-wght-normal.woff2) format('woff2');", css)
            self.assertNotIn(".woff)", css)
            self.assertNotIn("latin", css)
            self.assertIn(":root { --extra-fonts: 'noto-color-emoji', 'noto-sans-jp',", css)
            self.assertEqual(archive.read("noto-sans-kr-0-wght-normal.woff2"), b"font noto-sans-kr-0-wght-normal")
            self.assertNotIn("noto-sans-kr-latin-wght-normal.woff2", archive.namelist())
            self.assertIn(b"Test font license noto-color-emoji", archive.read("LICENSE.txt"))
        with (self.files / name).open("ab") as file:
            file.write(b"corruption")
        with self.assertRaisesRegex(SystemExit, "does not match fonts.json"):
            self.package.validate(self.files, "script.oriel.oriel", self.v, self.f)

    def test_validation_rejects_missing_art_or_wrong_framework_version(self):
        with self.assertRaisesRegex(SystemExit, "wrong framework version"):
            self.package.validate(self.files, "script.oriel.oriel", self.v, "9.9.9")
        (self.files / "script.oriel.oriel.icon.png").unlink()
        with self.assertRaisesRegex(SystemExit, "no script.oriel.oriel.icon.png"):
            self.package.validate(self.files, "script.oriel.oriel", self.v, self.f)
