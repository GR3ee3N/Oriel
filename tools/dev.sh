#!/bin/sh
# Point an app on the box at Vite on this computer, or back at its bundled
# page; reopen the app to apply. The app is oriel (default) or dormer, and
# must be installed (tools/deploy.sh).
set -eu
BOX="${BOX:?set BOX to your box, e.g. BOX=root@coreelec.local}"
ADDONS=/storage/.kodi/addons
case "${2:-oriel}" in
  oriel) ID=script.oriel.oriel PORT=5173 ;;
  dormer) ID=script.oriel.dormer PORT=5174 ;;
  *) echo "usage: tools/dev.sh on|off [oriel|dormer]" >&2; exit 2 ;;
esac
FILE=/storage/oriel/dev/$ID.json
case "${1:-}" in
  on)
    ssh "$BOX" "test -d $ADDONS/$ID" \
      || { echo "dev: $ID isn't installed on $BOX; install it with tools/deploy.sh ${2:-oriel}" >&2; exit 1; }
    HOST="${DEV_HOST:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I | cut -d' ' -f1)}"
    printf '{"url": "http://%s:%s/", "inspector": "0.0.0.0:9226"}\n' "$HOST" "$PORT" |
      ssh "$BOX" "mkdir -p /storage/oriel/dev && cat > $FILE && cat $FILE"
    ;;
  off)
    ssh "$BOX" "rm -f $FILE"
    echo "dev mode off"
    ;;
  *) echo "usage: tools/dev.sh on|off [oriel|dormer]" >&2; exit 2 ;;
esac
