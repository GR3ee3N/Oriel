#!/bin/bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
[[ $# = 0 ]] || { echo "usage: tools/check.sh" >&2; exit 2; }
shellcheck -x -e SC2029 tools/*.sh
python3 -m unittest discover -s tests -t . -v
(cd web && npm ci && npm run check && npm test)
