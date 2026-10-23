#!/bin/sh
# Reopen Oriel to apply development settings.
set -eu
BOX="${BOX:?set BOX to your box, e.g. BOX=root@coreelec.local}"
FILE=/storage/oriel/dev/script.oriel.oriel.json
case "${1:-}" in
  on)
    HOST="${DEV_HOST:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I | cut -d' ' -f1)}"
    printf '{"url": "http://%s:5173/", "inspector": "0.0.0.0:9226"}\n' "$HOST" |
      ssh "$BOX" "mkdir -p /storage/oriel/dev && cat > $FILE && cat $FILE"
    ;;
  off) ssh "$BOX" "rm -f $FILE" && echo "dev mode off" ;;
  *) echo "usage: tools/dev.sh on|off" >&2; exit 2 ;;
esac
