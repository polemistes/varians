#!/usr/bin/env bash
# Build the native release tarball of this checkout for the machine it runs
# on: dist/varians-<version>-linux-<arch>.tar.gz, holding
#
#   varians-<version>-linux-<arch>/
#     app/        the built application with its production dependencies
#     bin/        bin/varians
#     deploy/     the systemd units, proxy snippets and settings examples
#     docs/       the guides and the format specification
#     LICENSE README.md CHANGELOG.md SECURITY.md
#
# CI runs it for each architecture on a tag (.github/workflows/release.yml).
# The dependencies with native code (sharp, argon2) are those of the machine
# that builds, so build on linux-x64 for x64 and on linux-arm64 for arm64;
# the tarballs are for glibc systems.
#
#   deploy/release.sh [OUT_DIR]       (default dist/)
#
# VARIANS_COMMIT names the commit when there is no .git.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT=$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)

VERSION=$(node -p "require('./apps/web/package.json').version")
case "$(node -p 'process.arch')" in
  x64) ARCH=x64 ;;
  arm64) ARCH=arm64 ;;
  *) echo "No release is built for $(node -p 'process.arch')." >&2; exit 1 ;;
esac
NAME="varians-$VERSION-linux-$ARCH"
STAGE="$OUT/$NAME"

export VARIANS_COMMIT="${VARIANS_COMMIT:-$(git rev-parse --short=7 HEAD 2>/dev/null || true)}"

rm -rf "$STAGE" "$OUT/$NAME.tar.gz"
mkdir -p "$STAGE"

pnpm install --frozen-lockfile
pnpm --filter @varians/web build
pnpm --filter @varians/web deploy --prod "$STAGE/app"
rm -f "$STAGE/app/pnpm-lock.yaml" "$STAGE/app/pnpm-workspace.yaml"

cp -R bin docs "$STAGE/"
# The format specification is read at run time (the archives carry it, /formats serves it).
test -f "$STAGE/docs/formats/README.md"
cp -R deploy "$STAGE/deploy"
# Never ship what is particular to one machine.
rm -f "$STAGE/deploy/host" "$STAGE/deploy/LOCAL.md"
cp LICENSE README.md CHANGELOG.md SECURITY.md "$STAGE/"
chmod 0755 "$STAGE/bin/varians"
printf '%s\n' "$VERSION${VARIANS_COMMIT:++$VARIANS_COMMIT}" > "$STAGE/VERSION"

tar -C "$OUT" -czf "$OUT/$NAME.tar.gz" --owner=0 --group=0 --numeric-owner "$NAME"
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
rm -rf "$STAGE"
echo "$OUT/$NAME.tar.gz"
cd "$ROOT"
