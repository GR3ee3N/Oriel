#!/bin/sh
# Benchmark Oriel and the stack under it on $BOX, then copy the report into
# .cache/bench/<time>. Options go to bench.py run, such as --repeat 3,
# --suite stack, --case scroll or --label "what changed".
#
#   tools/bench.sh [options]
#   tools/bench.sh --list              print the cases --case accepts
#   tools/bench.sh compare BASE NEW    compare two report folders; exit 3 if worse
#   tools/bench.sh fetch               copy the box's newest finished report
#   tools/bench.sh stop                end the box's running benchmark
#
# A run continues on the box if this script's connection drops; fetch its
# report when it's done.
#
# The framework's deploy script installs bench.py on the box.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BENCH=/storage/oriel/tools/box/bench/bench.py
DEST="$REPO/.cache/bench"

report() { [ -d "$1" ] && echo "$1/report.json" || echo "$1"; }

if [ "${1:-}" = compare ]; then
  [ "$#" -eq 3 ] || { echo "usage: tools/bench.sh compare BASE NEW" >&2; exit 2; }
  [ -f "$DEST/tools/bench/bench.py" ] || { echo "run a benchmark first to fetch bench.py" >&2; exit 1; }
  exec python3 "$DEST/tools/bench/bench.py" compare "$(report "$2")" "$(report "$3")"
fi

BOX="${BOX:?set BOX to your box, e.g. BOX=root@coreelec.local}"

fetch() {
  name=$(basename "$1")
  mkdir -p "$DEST"
  rsync -rt "$BOX:$1/" "$DEST/$name/"
  rsync -rt --exclude __pycache__ "$BOX:/storage/oriel/tools/box/" "$DEST/tools/"
  cat "$DEST/$name/report.md"
  echo "report: $DEST/$name"
}

case "${1:-}" in
  fetch) out=$(ssh "$BOX" "python3 $BENCH latest") && fetch "$out"; exit ;;
  stop) exec ssh "$BOX" "python3 $BENCH stop" ;;
esac
quoted=
for arg in "$@"; do
  quoted="$quoted '$(printf %s "$arg" | sed "s/'/'\\\\''/g")'"
done
for arg in "$@"; do
  [ "$arg" != --list ] || exec ssh "$BOX" "python3 $BENCH run --list --scenario -" < "$REPO/tools/bench.json"
done
out=$(ssh "$BOX" "python3 $BENCH run --scenario -$quoted" < "$REPO/tools/bench.json")
fetch "$out"
