#!/usr/bin/env python3
"""Packages the built add-on for a release: its zip, Kodi's addons.xml, and
sha256 files for both.

    build/package.py <add-on dir> <files dir> <version> <framework version>

The release has no folders, so addons.xml gets a <path> to the zip and the
add-on's art is copied beside it as <id>.<name>; Kodi looks for both next to
addons.xml.
"""
import hashlib
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile


def package(addon, files):
    element = ET.parse(addon / "addon.xml").getroot()
    addon_id = element.get("id")
    zip_name = f"{addon_id}-{element.get('version')}.zip"
    files.mkdir(parents=True)
    with zipfile.ZipFile(files / zip_name, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(addon.rglob("*")):
            archive.write(path, f"{addon.name}/{path.relative_to(addon).as_posix()}")
    metadata = element.find('extension[@point="xbmc.addon.metadata"]')
    ET.SubElement(metadata, "path").text = zip_name
    for asset in metadata.find("assets"):
        flat = f"{addon_id}.{Path(asset.text).name}"
        shutil.copy(addon / asset.text, files / flat)
        asset.text = flat
    addons = ET.Element("addons")
    addons.append(element)
    ET.indent(addons)
    ET.ElementTree(addons).write(files / "addons.xml", encoding="UTF-8", xml_declaration=True)
    for name in (zip_name, "addons.xml"):
        digest = hashlib.sha256((files / name).read_bytes()).hexdigest()
        (files / f"{name}.sha256").write_text(f"{digest}  {name}\n")


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
                     "resources/mark.png", "resources/web/index.html"):
            require(f"{addon_id}/{name}" in names, f"{zip_name} has no {name}")
        addon = ET.fromstring(archive.read(f"{addon_id}/addon.xml"))
    require(addon.get("id") == addon_id and addon.get("version") == version, "wrong id or version")
    require(addon.find("requires/import[@addon='script.module.oriel.framework']").get("version") == framework,
            "wrong framework version")
    entry = ET.parse(files / "addons.xml").getroot().find(f"addon[@id='{addon_id}']")
    require(entry.findtext("extension/path") == zip_name, "addons.xml points to another zip")
    for asset in entry.find("extension/assets"):
        require((files / asset.text).is_file(), f"no {asset.text}")


def main():
    addon, files = Path(sys.argv[1]), Path(sys.argv[2])
    package(addon, files)
    validate(files, "script.oriel.oriel", *sys.argv[3:5])


if __name__ == "__main__":
    main()
