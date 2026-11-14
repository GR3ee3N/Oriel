#!/bin/bash
# Build apps into .cache/runtime/<add-on id>: oriel (Plex, the default),
# dormer (Jellyfin), or both. Each app has its add-on manifest and artwork
# in apps/<app>/; the rest of the add-on and the page are shared.
#
#   tools/build.sh [oriel|dormer]...
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
APPS=("${@:-oriel}")
for app in "${APPS[@]}"; do
    [[ $app = oriel || $app = dormer ]] || { echo "usage: tools/build.sh [oriel|dormer]..." >&2; exit 2; }
done
source build/versions.env
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $FRAMEWORK_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { echo "VERSION and FRAMEWORK_VERSION must be x.y.z" >&2; exit 2; }
WEB=https://github.com/GR3ee3N/oriel-framework/releases/download/v$FRAMEWORK_VERSION/oriel-web-$FRAMEWORK_VERSION.tgz
grep -Fq "\"@oriel/web\": \"$WEB\"" web/package.json \
    || { echo "web/package.json must install @oriel/web from $WEB" >&2; exit 2; }

(cd web && npm ci)
for app in "${APPS[@]}"; do
    ID=script.oriel.$app
    if [[ $app = dormer ]]; then SERVER=jellyfin; else SERVER=plex; fi
    (cd web && VITE_SERVER=$SERVER npm run build)
    ADDON=.cache/runtime/$ID
    rm -rf "$ADDON"
    mkdir -p "$ADDON"
    rsync -a --exclude __pycache__ addon/ "apps/$app/" "$ADDON/"
    sed -i.orig "s/@VERSION@/$VERSION/g; s/@FRAMEWORK_VERSION@/$FRAMEWORK_VERSION/g" "$ADDON/addon.xml"
    rm "$ADDON/addon.xml.orig"
    rsync -a web/dist/ "$ADDON/resources/web/"
    # Both apps download the fonts from this version's GitHub release (tools/release.sh).
    python3 build/fonts.py web/node_modules .cache/runtime "$ADDON/resources/fonts.json" \
        "https://github.com/GR3ee3N/Oriel/releases/download/v$VERSION/" >/dev/null
    cp LICENSE "$ADDON/LICENSE.txt"
    python3 build/notices.py web "$ADDON/THIRD-PARTY-NOTICES.txt" >/dev/null
    echo "Built $ADDON."
done
