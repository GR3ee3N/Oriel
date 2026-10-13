#!/bin/bash
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
[[ $# = 0 ]] || { echo "usage: tools/release.sh" >&2; exit 2; }
export GH_REPO=GR3ee3N/Oriel
source build/versions.env
NOTES=$(python3 -c 'import xml.etree.ElementTree as E; print(E.parse("addon/addon.xml").find("extension/news").text)')
TAG=v$VERSION
COMMIT=$(git rev-parse HEAD)
[[ -z $(git status --porcelain) ]] || { echo "commit first; the tree is not clean" >&2; exit 2; }
mkdir -p .cache
mkdir .cache/release.lock 2>/dev/null || { echo "another release is running; check .cache/release.lock" >&2; exit 1; }
trap 'rm -rf "${WORK:-}" .cache/release.lock' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
git fetch -q origin "refs/tags/$TAG:refs/tags/$TAG" 2>/dev/null || true
RELEASE=$(gh release view "$TAG" --json isDraft -q .isDraft 2>/dev/null || true)
if [[ $RELEASE != true ]] && git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
    && [[ $(git rev-parse "$TAG^{commit}") != "$COMMIT" ]]; then
    echo "$TAG was released from another commit; bump VERSION in build/versions.env" >&2
    exit 2
fi
[[ $RELEASE != false ]] || { echo "$TAG is already released"; exit; }

WORK=$(mktemp -d "$REPO/.cache/release.XXXXXX")
git archive "$COMMIT" | tar -xf - -C "$WORK"
"$WORK/tools/check.sh"
"$WORK/tools/build.sh"
python3 "$WORK/build/package.py" "$WORK/.cache/runtime/script.oriel.oriel" "$WORK/.cache/release/files" "$VERSION" "$FRAMEWORK_VERSION"
printf '%s\n' "$COMMIT" > "$WORK/.cache/release/COMMIT"
[[ $(git rev-parse HEAD) = "$COMMIT" && -z $(git status --porcelain) ]] \
    || { echo "the source changed during the release; commit and run again" >&2; exit 2; }
rm -rf .cache/release
mv "$WORK/.cache/release" .cache/release
if [[ $RELEASE = true ]]; then
    [[ $(gh release view "$TAG" --json isDraft -q .isDraft) = true ]] \
        || { echo "$TAG is no longer a draft; check the release before retrying" >&2; exit 2; }
    # Keep the previous draft until its replacement has passed every check.
    gh release delete "$TAG" --yes --cleanup-tag
    if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then git tag -d "$TAG" >/dev/null; fi
fi

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git tag -a "$TAG" -m "$NOTES" "$COMMIT"
git push -q origin "$TAG"
gh release create "$TAG" --draft --verify-tag --title "Oriel $VERSION" --notes "$NOTES" .cache/release/files/*
echo "Drafted $TAG; publish it on GitHub to release it."
