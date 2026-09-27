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

## SQLite runs in WAL mode, sessions and cache are files, slow requests are logged (2026-09-14)
Production is SQLite on a VPS, and pages "sometimes took more than five
seconds" there while everything was instant locally. The cause is
environmental, not the code: in SQLite's default rollback-journal mode
readers and writers block each other and every commit syncs the disk
twice, and with sessions/cache in the database every request was a write
transaction contending with real edits. So `config/database.php` sets
`journal_mode=wal`, `synchronous=normal` and a 5 s `busy_timeout` for the
sqlite connection (env-overridable; pragmas applied on connect, WAL
takes effect on the next connection to an existing database),
`.env.production.example` puts SESSION_DRIVER and CACHE_STORE on `file`
(`.env` on the server must be changed by hand), and `LogSlowRequests`
(prepended to the global stack) logs every request over
`SLOW_REQUEST_MS` (default 2000) with its ms, query count and query ms —
read `storage/logs/` after a slow spell before guessing further. OPcache
is the remaining suspect if that shows time outside the queries: check
the host's PHP handler. The tests run on `:memory:`, where the WAL pragma
is a no-op.

## The document root is ~/www/varians, a symlink into a web root shared with Manteion (2026-09-27)
There is no server of Varians's own. Production is a domene.shop webhotel on
the **`manteion` account** (`ssh manteion@login.domeneshop.no`), and
www.varians.no is pointed at a subfolder of that account's one fixed web
root. So the checkout is `~/varians`, and the document root is
`~/www/varians` — a **symlink to `~/varians/public`**, recreated with
`ln -sfn ~/varians/public ~/www/varians`.

Symlink it to `~/varians` instead and Apache serves a **directory listing of
the source tree**: the front controller and the `Options -Indexes` are both
in `public/`, not above it. `__DIR__` resolves through the symlink to the
real path, so `public/index.php` still reaches `../vendor/autoload.php`
correctly. Symlinks are followed on this host — Manteion relies on it for
its own `~/www/storage`.

`~/www` is **shared with Manteion**, which is served from its root.
Manteion's `deploy/sync-webroot.sh` rsyncs its own `public/` into `~/www`
with `--delete`, and that deleted `~/www/varians` outright: Internal Server
Error on every URL until the symlink was recreated. Nothing of Varians's is
stored under `~/www`, so it cost the symlink and nothing else — the SQLite
database, `.env` and the manuscript images are all under `~/varians`. That
script now protects every top-level entry its own `public/` does not ship,
so a new neighbour under `~/www` needs no edit there; but any future tool
that mirrors into `~/www` can repeat it.

`deploy.sh` here never touches `~/www` and must not start to, or two scripts
would be fighting over one directory. If the host ever refuses a symlinked
document root, the fallback is Manteion's `deploy/webroot-index.php`
pattern: a real directory holding a copy of `public/` plus a front
controller whose `../` paths reach the sibling app folder.
