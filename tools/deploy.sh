#!/bin/sh
# Build an app, oriel (the default) or dormer, and install it on $BOX.
# Install WebKit, the framework and its box tools on the device first.
# Exit and reopen the app after deployment to load the installed code.
#
#   tools/deploy.sh [oriel|dormer]
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOX="${BOX:?set BOX to your box, e.g. BOX=root@coreelec.local}"
ADDONS=/storage/.kodi/addons
KODIRPC=/storage/oriel/tools/box/kodirpc.py
cd "$REPO"
APP="${1:-oriel}"
case "$#:$APP" in
  0:*|1:oriel|1:dormer) ID=script.oriel.$APP ;;
  *) echo "usage: tools/deploy.sh [oriel|dormer]" >&2; exit 2 ;;
esac

ssh "$BOX" "test -f $KODIRPC" \
  || { echo "deploy: no box tools on $BOX; install them with oriel-framework's tools/deploy.sh" >&2; exit 1; }
tools/build.sh "$APP"
# Retain installed files until their replacements finish transferring.
rsync -rlpt --delete-after --delay-updates ".cache/runtime/$ID/" "$BOX:$ADDONS/$ID/"
ssh "$BOX" "kodi-send --action=UpdateLocalAddons >/dev/null"
ssh "$BOX" "python3 $KODIRPC --enable '$ID' >/dev/null"
echo "installed $ID"
