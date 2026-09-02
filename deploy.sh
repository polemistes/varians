#!/usr/bin/env bash
#
# Deploy www.varians.no. Run over SSH from the checkout at ~/varians:
#
#   ~/varians/deploy.sh
#
# It pulls the `production` branch, which GitHub Actions builds from `main`
# with the compiled frontend committed to it — the server has no Node, and
# `public/build` is not in `main`.
#
# Never add `git clean` here. The SQLite database, the uploaded manuscript
# images under storage/app/public, and `.env` are all untracked; a hard reset
# leaves them alone, but a clean would delete every one of them.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "No .env here. Copy .env.production.example to .env and run" >&2
    echo "php artisan key:generate before deploying." >&2
    exit 1
fi

# Brought back up however this exits, so a failed migration cannot leave the
# site dark. `went_down` keeps the trap honest: when `down` itself fails —
# a first deploy with no vendor/ yet, say, where artisan cannot even boot —
# the site was live all along, and `up` would only complain that there is
# nothing to lift.
went_down=0
if php artisan down --retry=15; then
    went_down=1
else
    echo "WARNING: could not enter maintenance mode — deploying live." >&2
fi
trap '[ "$went_down" -eq 0 ] || php artisan up || true' EXIT

git fetch --prune origin production
git reset --hard origin/production

composer install --no-dev --optimize-autoloader --no-interaction

php artisan migrate --force

# Serves storage/app/public at /storage. Creating it again on a host that
# forbids symlinks would fail the whole deploy, so only ever created once.
if [ ! -e public/storage ]; then
    php artisan storage:link
fi

# Config, routes, views and events in one. Undo with `php artisan optimize:clear`
# after editing .env, which a cached config would otherwise ignore.
php artisan optimize

echo
echo "Deployed $(git rev-parse --short HEAD)."
