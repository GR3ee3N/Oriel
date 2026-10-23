#!/bin/sh
# Install WebKit, the framework and its box tools on the device first.
# Exit and reopen Oriel after deployment to load the installed code.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BOX="${BOX:?set BOX to your box, e.g. BOX=root@coreelec.local}"
ADDONS=/storage/.kodi/addons
ID=script.oriel.oriel
KODIRPC=/storage/oriel/tools/box/kodirpc.py
cd "$REPO"
[ "$#" -eq 0 ] || { echo "usage: tools/deploy.sh" >&2; exit 2; }

ssh "$BOX" "test -f $KODIRPC" \
  || { echo "deploy: no box tools on $BOX; install them with oriel-framework's tools/deploy.sh" >&2; exit 1; }
tools/build.sh
# Retain installed files until their replacements finish transferring.
rsync -rlpt --delete-after --delay-updates ".cache/runtime/$ID/" "$BOX:$ADDONS/$ID/"
ssh "$BOX" "kodi-send --action=UpdateLocalAddons >/dev/null"
ssh "$BOX" "python3 $KODIRPC --enable '$ID' >/dev/null"
echo "installed $ID"
