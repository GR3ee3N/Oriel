#!/usr/bin/env python3
"""Third-party notices for the npm packages the page carries at run time;
tools/build.sh runs it.

    build/notices.py <package dir> <out>

Each component gets its name, version, declared license, and the full text
of every license, copyright or notice file it carries. devDependencies are
left out, as they only build the page. Stops if a component carries no
license file.
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
FILES = re.compile(r"^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE|AUTHORS)([-._].*)?$", re.IGNORECASE)


def license_files(directory):
    d = pathlib.Path(directory)
    return sorted(p for p in d.iterdir() if p.is_file() and FILES.match(p.name))


def npm(package_dir):
    """The run-time dependency tree, resolved as Node would."""
    start = pathlib.Path(package_dir).resolve()

    def find(name, base):
        for d in [base, *base.parents]:
            candidate = d / "node_modules" / name
            if (candidate / "package.json").exists():
                return candidate
        sys.exit(f"notices: cannot find {name} from {base}")

    seen, todo, out = set(), [start], {}
    while todo:
        d = todo.pop()
        real = d.resolve()
        if real in seen:
            continue
        seen.add(real)
        info = json.loads((d / "package.json").read_text())
        ours = REPO in real.parents and "node_modules" not in real.parts
        if not ours:
            out[(info["name"], info["version"])] = (info.get("license") or "unknown", real)
        for name in {**info.get("dependencies", {}), **info.get("peerDependencies", {})}:
            todo.append(find(name, real))
    for (name, version), (lic, d) in sorted(out.items()):
        yield name, version, lic, d


def main():
    package_dir, out = sys.argv[1:3]
    components = list(npm(package_dir))
    parts, missing = [], []
    for name, version, lic, directory in components:
        files = license_files(directory)
        if not files:
            missing.append(f"{name} {version}")
        parts.append("=" * 78 + f"\n{name} {version}\nLicense: {lic}\n" + "=" * 78 + "\n")
        for f in files:
            parts.append(f"--- {f.name}\n\n{f.read_text(errors='replace').strip()}\n\n")
    if missing:
        sys.exit("notices: no license file in " + ", ".join(missing))
    header = (
        "Third-party software in this add-on, with its licenses and notices.\n"
        "Oriel itself is under the GNU GPL, version 3 or later (LICENSE.txt).\n\n"
        + "".join(f"  {n} {v} ({lic})\n" for n, v, lic, _ in components) + "\n"
    )
    pathlib.Path(out).write_text(header + "".join(parts))
    print(f"notices: {len(components)} components in {out}")


if __name__ == "__main__":
    main()
