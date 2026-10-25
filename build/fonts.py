#!/usr/bin/env python3
"""Package the optional extra fonts for download.

    build/fonts.py <node_modules> <ZIP dir> <fonts.json> <download URL base>

Writes oriel-fonts-<hash>.zip, holding fonts.css, the woff2 files and the
fonts' licenses, and fonts.json, which tells the add-on where to download the
ZIP, how to check it and which scripts it adds. fonts.css sets
--extra-fonts, the families in the order the page tries them. The ZIP
depends only on the font packages, so its name changes only when they do.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

# Fontsource packages under the SIL Open Font License, in the order the page
# tries them, with their stylesheet and the Unicode scripts in them that no
# built-in font (Inter, Noto Emoji, DejaVu Sans) draws. Text from Plex in one
# of those scripts makes the page offer the download.
PACKAGES = (
    ("@fontsource/noto-color-emoji", "400.css", ()),
    ("@fontsource-variable/noto-sans-jp", "wght.css", ("Han", "Hiragana", "Katakana")),
    ("@fontsource-variable/noto-sans-kr", "wght.css", ("Hangul",)),
    ("@fontsource-variable/noto-sans-sc", "wght.css", ("Han",)),
    ("@fontsource-variable/noto-sans-tc", "wght.css", ("Han",)),
    ("@fontsource-variable/noto-sans-thai", "wght.css", ("Thai",)),
    ("@fontsource-variable/noto-sans-devanagari", "wght.css", ("Devanagari",)),
    ("@fontsource-variable/noto-sans-bengali", "wght.css", ("Bengali",)),
    ("@fontsource-variable/noto-sans-gurmukhi", "wght.css", ("Gurmukhi",)),
    ("@fontsource-variable/noto-sans-gujarati", "wght.css", ("Gujarati",)),
    ("@fontsource-variable/noto-sans-oriya", "wght.css", ("Oriya",)),
    ("@fontsource-variable/noto-sans-tamil", "wght.css", ("Tamil",)),
    ("@fontsource-variable/noto-sans-telugu", "wght.css", ("Telugu",)),
    ("@fontsource-variable/noto-sans-kannada", "wght.css", ("Kannada",)),
    ("@fontsource-variable/noto-sans-malayalam", "wght.css", ("Malayalam",)),
    ("@fontsource-variable/noto-sans-sinhala", "wght.css", ("Sinhala",)),
    ("@fontsource-variable/noto-sans-myanmar", "wght.css", ("Myanmar",)),
    ("@fontsource-variable/noto-sans-khmer", "wght.css", ("Khmer",)),
    ("@fontsource-variable/noto-sans-ethiopic", "wght.css", ("Ethiopic",)),
)

FACE = re.compile(r"(?:/\*[^*]*\*/\s*)?@font-face \{(.*?)\}", re.S)
WOFF2 = re.compile(r"url\(\./files/([\w.-]+\.woff2)\) format\('([\w-]+)'\)")


def build(modules, out, info_path, base):
    css, families, files, licenses, scripts = [], [], {}, [], []
    for name, sheet, covers in PACKAGES:
        package = modules / name
        version = json.loads((package / "package.json").read_text())["version"]
        faces = []
        for body in FACE.findall((package / sheet).read_text()):
            sources = WOFF2.findall(body)
            # Inter draws Latin, so the script fonts' Latin slices would never load.
            if not sources or "-latin" in sources[0][0]:
                continue
            for file, _ in sources:
                files[file] = (package / "files" / file).read_bytes()
            src = ", ".join(f"url(./{file}) format('{kind}')" for file, kind in sources)
            faces.append("@font-face {" + re.sub(r"src: [^;]+;", lambda _: f"src: {src};", body) + "}")
            family = re.search(r"font-family: '([^']+)'", body).group(1)
            if family not in families:
                families.append(family)
        if not faces:
            raise SystemExit(f"{name}/{sheet} lists no woff2 files")
        css.append(f"/* {name} {version} */\n" + "\n".join(faces))
        licenses.append(f"{name} {version}\n\n{(package / 'LICENSE').read_text()}")
        scripts += [s for s in covers if s not in scripts]
    css.append(":root { --extra-fonts: " + ", ".join(f"'{f}'" for f in families) + "; }")
    buffer = io.BytesIO()
    # woff2 is compressed already; storing keeps the ZIP identical across zlib versions.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        entries = {"fonts.css": "\n\n".join(css).encode(), "LICENSE.txt": "\n\n".join(licenses).encode(), **files}
        for name in sorted(entries):
            archive.writestr(zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)), entries[name])
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    zip_name = f"oriel-fonts-{digest[:12]}.zip"
    out.mkdir(parents=True, exist_ok=True)
    (out / zip_name).write_bytes(data)
    info = {"url": base + zip_name, "sha256": digest, "size": len(data), "scripts": scripts}
    info_path.write_text(json.dumps(info) + "\n")
    return out / zip_name


def main():
    print(build(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]))


if __name__ == "__main__":
    main()
