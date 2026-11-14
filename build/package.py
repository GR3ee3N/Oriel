#!/usr/bin/env python3
"""Package built add-ons as ZIPs, one Kodi index and SHA-256 checksums.

    build/package.py <files dir> <version> <framework version> <add-on dir>...

Release assets share one directory, and addons.xml lists every add-on in it.
Set each add-on's <path> in addons.xml to its ZIP filename and copy its
artwork alongside as <id>.<name> so Kodi can find it. The font ZIP that
tools/build.sh writes beside the add-ons joins them, under the name
resources/fonts.json downloads it by; every app downloads the same one.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile


def package(addon_dirs, files):
    files.mkdir(parents=True)
    addons = ET.Element("addons")
    names = ["addons.xml"]
    for addon in addon_dirs:
        element = ET.parse(addon / "addon.xml").getroot()
        addon_id = element.get("id")
        zip_name = f"{addon_id}-{element.get('version')}.zip"
        with zipfile.ZipFile(files / zip_name, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(addon.rglob("*")):
                archive.write(path, f"{addon.name}/{path.relative_to(addon).as_posix()}")
        metadata = element.find('extension[@point="xbmc.addon.metadata"]')
        ET.SubElement(metadata, "path").text = zip_name
        for asset in metadata.find("assets"):
            flat = f"{addon_id}.{Path(asset.text).name}"
            shutil.copy(addon / asset.text, files / flat)
            asset.text = flat
        addons.append(element)
        names.append(zip_name)
        fonts = font_zip(addon)
        shutil.copy(addon.parent / fonts, files / fonts)
    ET.indent(addons)
    ET.ElementTree(addons).write(files / "addons.xml", encoding="UTF-8", xml_declaration=True)
    for name in names:
        digest = hashlib.sha256((files / name).read_bytes()).hexdigest()
        (files / f"{name}.sha256").write_text(f"{digest}  {name}\n")


def font_zip(addon):
    return json.loads((addon / "resources/fonts.json").read_text())["url"].rsplit("/", 1)[1]


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def validate(files, addon_id, version, framework):
    zip_name = f"{addon_id}-{version}.zip"
    for name in (zip_name, "addons.xml"):
        digest = (files / f"{name}.sha256").read_text().split()[0]
        require(digest == hashlib.sha256((files / name).read_bytes()).hexdigest(), f"{name}.sha256 does not match")
    with zipfile.ZipFile(files / zip_name) as archive:
        names = set(archive.namelist())
        for name in ("addon.xml", "default.py", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt",
                     "resources/mark.png", "resources/fonts.json", "resources/web/index.html"):
            require(f"{addon_id}/{name}" in names, f"{zip_name} has no {name}")
        addon = ET.fromstring(archive.read(f"{addon_id}/addon.xml"))
        fonts = json.loads(archive.read(f"{addon_id}/resources/fonts.json"))
    require(addon.get("id") == addon_id and addon.get("version") == version, "wrong id or version")
    require(addon.find("requires/import[@addon='script.module.oriel.framework']").get("version") == framework,
            "wrong framework version")
    entry = ET.parse(files / "addons.xml").getroot().find(f"addon[@id='{addon_id}']")
    require(entry.findtext("extension/path") == zip_name, "addons.xml points to another zip")
    for asset in entry.find("extension/assets"):
        require((files / asset.text).is_file(), f"no {asset.text}")
    base, font_name = fonts["url"].rsplit("/", 1)
    require(base == f"https://github.com/GR3ee3N/Oriel/releases/download/v{version}", "fonts.json points outside this release")
    require((files / font_name).is_file(), f"no {font_name}")
    data = (files / font_name).read_bytes()
    require(len(data) == fonts["size"] and hashlib.sha256(data).hexdigest() == fonts["sha256"],
            f"{font_name} does not match fonts.json")


def main():
    files, version, framework = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    addons = [Path(arg) for arg in sys.argv[4:]]
    package(addons, files)
    for addon in addons:
        validate(files, addon.name, version, framework)


if __name__ == "__main__":
    main()
