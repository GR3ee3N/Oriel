#!/bin/bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
[[ $# = 0 ]] || { echo "usage: tools/build.sh" >&2; exit 2; }
source build/versions.env
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $FRAMEWORK_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { echo "VERSION and FRAMEWORK_VERSION must be x.y.z" >&2; exit 2; }
ID=script.oriel.oriel
WEB=https://github.com/GR3ee3N/oriel-framework/releases/download/v$FRAMEWORK_VERSION/oriel-web-$FRAMEWORK_VERSION.tgz
grep -Fq "\"@oriel/web\": \"$WEB\"" web/package.json \
    || { echo "web/package.json must install @oriel/web from $WEB" >&2; exit 2; }

(cd web && npm ci && npm run build)
ADDON=.cache/runtime/$ID
rm -rf .cache/runtime
mkdir -p "$ADDON"
rsync -a --exclude __pycache__ addon/ "$ADDON/"
sed -i.orig "s/@VERSION@/$VERSION/g; s/@FRAMEWORK_VERSION@/$FRAMEWORK_VERSION/g" "$ADDON/addon.xml"
rm "$ADDON/addon.xml.orig"
rsync -a web/dist/ "$ADDON/resources/web/"
# The fonts download from this version's GitHub release (tools/release.sh).
python3 build/fonts.py web/node_modules .cache/runtime "$ADDON/resources/fonts.json" \
    "https://github.com/GR3ee3N/Oriel/releases/download/v$VERSION/" >/dev/null
cp LICENSE "$ADDON/LICENSE.txt"
python3 build/notices.py web "$ADDON/THIRD-PARTY-NOTICES.txt" >/dev/null
echo "Built $ADDON."
