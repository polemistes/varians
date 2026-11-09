#!/usr/bin/env bash
# Roll out the committed state of this repository to the server. Run on your
# own machine: copies HEAD over as a new release, builds it there as the
# varians user (deploy.sh), and restarts the service.
#
#   VARIANS_HOST=me@host deploy/push.sh
#   deploy/push.sh            the server is read from deploy/host (one line,
#                             user@host; not in git)
set -euo pipefail

cd "$(dirname "$0")/.."
HOST="${VARIANS_HOST:-$(cat deploy/host 2>/dev/null || true)}"
if [ -z "$HOST" ]; then
  echo "Name the server: VARIANS_HOST=user@host deploy/push.sh, or write user@host into deploy/host." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ] && [ "${FORCE:-}" != 1 ]; then
  echo "There are uncommitted changes, and only commits are deployed. Commit them, or deploy HEAD as it is with FORCE=1." >&2
  exit 1
fi

REV="$(git rev-parse --short HEAD)"
NAME="$(date +%Y%m%d-%H%M%S)-$REV"
DIR="/home/varians/releases/$NAME"

echo "Copying $REV to $HOST:$DIR"
git archive --format=tar HEAD | ssh "$HOST" "sudo -n -u varians mkdir -p '$DIR' && sudo -n -u varians tar -x -C '$DIR'"

echo "Building on the server"
ssh "$HOST" "cd / && sudo -n -u varians -H '$DIR/deploy/deploy.sh'"

if ssh "$HOST" "systemctl list-unit-files varians.service --no-legend | grep -q varians"; then
  echo "Restarting"
  ssh "$HOST" "sudo -n systemctl restart varians && sleep 3 && systemctl is-active varians"
else
  echo "The varians service is not installed yet (see deploy/README.md); the release is built and current."
fi
