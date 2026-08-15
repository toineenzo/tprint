#!/bin/sh
# Publish docs/wiki/ to the GitHub wiki.
#
# `docs/wiki/` is the source of truth, not a copy of the wiki. It has to stay
# in the repo because app/help.py serves it when GitHub is unreachable (and the
# Dockerfile bakes it into the image) — deleting it would leave an offline
# install with no help at all. The wiki is the published rendering of it.
#
# So: edit the files here, run this, and the wiki follows. Editing a page in
# GitHub's web editor instead means the next run of this script overwrites it —
# copy such an edit back into docs/wiki/ first.
set -eu

REPO="${TPRINT_WIKI_REPO:-https://github.com/toineenzo/tprint.wiki.git}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$REPO" "$WORK/wiki"
cp "$ROOT"/docs/wiki/*.md "$WORK/wiki/"

# Sidebar: one link per page, Home first. Generated rather than committed, so
# adding a page to docs/wiki/ is the only step needed to publish it.
{
    echo "# Pages"
    echo
    echo "- [Home](Home)"
    for path in "$ROOT"/docs/wiki/*.md; do
        page=$(basename "$path" .md)
        [ "$page" = "Home" ] && continue
        printf -- "- [%s](%s)\n" "$(echo "$page" | tr '-' ' ')" "$page"
    done
} > "$WORK/wiki/_Sidebar.md"

cd "$WORK/wiki"
if git diff --quiet && git diff --cached --quiet; then
    echo "wiki already matches docs/wiki/ — nothing to publish"
    exit 0
fi

git add -A
git commit --quiet -m "Sync documentation from docs/wiki"
git push --quiet origin master
echo "published $(ls "$ROOT"/docs/wiki/*.md | wc -l | tr -d ' ') pages to the wiki"
