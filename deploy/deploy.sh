#!/usr/bin/env bash
# Build a release and make it the current one. Runs on the server as the
# varians user, from inside the release that push.sh has just copied over:
# installs the dependencies, builds, migrates the database, then points
# /home/varians/app at this release. Restarting the service is push.sh's job.
set -euo pipefail

BASE="${VARIANS_BASE:-/home/varians}"
RELEASE="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$BASE/varians.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No settings file at $ENV_FILE: copy deploy/varians.env.example there and edit it." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$RELEASE"
pnpm install --frozen-lockfile
pnpm --filter @varians/web build
pnpm --filter @varians/db migrate
# The command-line scripts (cli, lexicon:import) read their settings from apps/web/.env.
ln -sfn "$ENV_FILE" apps/web/.env

# Switch in one step, so that the service never sees a half-made link.
ln -sfn "$RELEASE" "$BASE/app.new"
mv -T "$BASE/app.new" "$BASE/app"

# Keep the five newest releases (their names begin with the time of the deploy).
find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | while read -r old; do
  [ "$old" != "$RELEASE" ] && rm -rf "$old"
done
echo "Release $(basename "$RELEASE") is current."
