#!/bin/sh
# Print the section of CHANGELOG.md for a version (without its heading), as
# the notes of its GitHub release. Fails when the section is missing or empty.
#
#   deploy/release-notes.sh 0.2.0
set -eu
version=${1:?usage: release-notes.sh VERSION}
changelog="$(dirname "$0")/../CHANGELOG.md"
notes=$(awk -v v="$version" '
  index($0, "## ") == 1 && found { exit }
  $0 == "## " v || index($0, "## " v " ") == 1 { found = 1; next }
  found { print }
' "$changelog")
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no section for $version." >&2
  exit 1
fi
printf '%s\n' "$notes"
