---
paths:
  - '.github/workflows/**,deploy.sh,composer.json,composer.lock,phpstan.neon'
---

# Deployment

## The host runs PHP 8.3, and that is why several packages are held back
`composer.json` declares `^8.3` but ALSO pins `config.platform.php` to
`8.3.0`, and `phpstan.neon` analyses at `phpVersion: 80300`. Both are
deliberate (commit e304b1f, "Target PHP 8.3, the version the server runs"),
and the reason is not style:

- The lockfile had resolved to **Symfony 8, which requires PHP 8.4.1**, so
  `composer install` would have failed outright on the host — a dead deploy,
  discovered only on the server. Laravel 13 accepts Symfony `^7.4` too, and
  pinning the platform re-resolves onto the **7.4 LTS** line.
- **Pest 5 and PHPUnit 13 need 8.4 as well, hence Pest 4.**
- PHPStan at 80300 means an 8.4-only feature fails HERE rather than in
  production.

So: do not raise these, or unpin the platform, until the host's PHP moves
first. `composer update` on a machine with a newer PHP will happily resolve
something the server cannot install.

## The server has no Node, and the repo is private
The build therefore happens in GitHub Actions and is published to the
`production` branch the server pulls (`public/build` and Wayfinder's
generated `resources/js/routes`/`actions` are gitignored, so they never
reach the server through `main`). Building needs PHP as well: Wayfinder
shells out to `php artisan wayfinder:generate`.

The checkout on the server must use an **SSH remote with a read-only deploy
key** — a private repo over HTTPS prompts for a password no script can
answer.

`deploy.sh` must NEVER grow a `git clean`: the SQLite database, the uploaded
manuscript images under `storage/app/public`, and `.env` are all untracked,
and a hard reset leaves them alone where a clean would delete every one.
`storage:link` runs only when `public/storage` is missing, since a host that
forbids symlinks would otherwise fail the whole deploy.

## Action versions are a RUNNER matter, not a host matter
The GitHub Actions used by the workflows run on GitHub's runner and have
nothing to do with the server's PHP. `tests.yml` pins them by SHA
(checkout v7.0.1, setup-node v7.0.0); `deploy.yml` was written by hand and
still says `@v4`, which is why the build warns about Node 20. Dependabot
PR #1 raises exactly those two and has simply never been merged. Nothing
about the host prevents it.
