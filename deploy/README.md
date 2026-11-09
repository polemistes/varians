# Running Varians on the server

This is how varians.eu itself runs: built from a checkout of the repository, pushed with `push.sh`. To install Varians elsewhere, from a release, follow [docs/install.md](../docs/install.md); its native installation uses the units in `native/` and the proxy snippets in `nginx/` and `apache/`.

Varians runs on an Arch Linux server, possibly alongside other sites. Apache holds ports 80 and 443 for all of them and passes the requests for varians.eu on to Varians, a Node process that listens only on the server itself (127.0.0.1:3000). PostgreSQL holds the data; the uploaded images and the archives are files.

```
/home/varians/
  app -> releases/<newest>     the current release
  releases/<time>-<commit>/    the last five releases, as deployed
  storage/                     images, tiles, archives (git repositories, one per work)
  backups/<date>/              nightly: database dump and a copy of storage, two weeks
  varians.env                  the settings (never in git)
```

## Setting up, once

As root (with `sudo`):

1. **Packages.** `pacman -S --needed postgresql nodejs pnpm rsync`

2. **The database.**

   ```sh
   sudo -iu postgres initdb -D /var/lib/postgres/data --locale=C.UTF-8 --encoding=UTF8 --data-checksums --auth-local=peer --auth-host=scram-sha-256
   systemctl enable --now postgresql
   ```

3. **The varians user and its database.** Varians runs as its own user. The database lets it in by its Linux name (peer), so there is no database password.

   ```sh
   useradd --system --create-home --home-dir /home/varians --shell /usr/bin/nologin varians
   sudo -iu postgres createuser varians
   sudo -iu postgres createdb --owner=varians varians
   sudo -u varians mkdir /home/varians/storage /home/varians/backups /home/varians/releases
   ```

4. **Settings.** Copy `varians.env.example` to `/home/varians/varians.env` (owner varians, mode 600) and check `ORIGIN`.

5. **The deploy rule.** `visudo -f /etc/sudoers.d/varians`, with the contents of `sudoers-varians`, `DEPLOYER` replaced by the account you deploy as. It lets the deploying user act as `varians` and restart the service, without a password.

6. **First release.** From the development machine: write `user@host` into `deploy/host` (not in git), then `deploy/push.sh`. It builds the release on the server and makes it current. The service is not installed yet, so it stops there.

7. **The service.**

   ```sh
   cp /home/varians/app/deploy/systemd/varians.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now varians
   ```

8. **Apache.** Enable `mod_proxy_http` in `/etc/httpd/conf/httpd.conf` (remove the `#` before `LoadModule proxy_http_module`). Copy `apache/varians.eu.conf` to `/etc/httpd/conf/conf.d/`, then `apachectl configtest` and `systemctl reload httpd`.

9. **The certificate.** Both names must point to the server (A records for `varians.eu` and `www.varians.eu`).

   ```sh
   certbot certonly --apache -d varians.eu -d www.varians.eu --deploy-hook "systemctl reload httpd"
   ```

   Then copy `apache/varians.eu-ssl.conf` to `/etc/httpd/conf/conf.d/`, `apachectl configtest`, `systemctl reload httpd`. certbot's timer renews the certificate and reloads Apache.

10. **The first account.** The first account registered on an empty installation becomes its administrator: register yours as soon as the site answers. To make an account administrator afterwards:

    ```sh
    sudo -u varians -H pnpm --dir /home/varians/app --filter @varians/web cli make-admin you@example.org
    ```

11. **The dictionaries** (optional; see `docs/lexicon.md`). Copy a built `lexicon.sqlite` to the server, then:

    ```sh
    sudo -u varians -H pnpm --dir /home/varians/app --filter @varians/web lexicon:import /path/to/lexicon.sqlite
    ```

12. **Backups.**

    ```sh
    cp /home/varians/app/deploy/systemd/varians-backup.{service,timer} /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now varians-backup.timer
    ```

    The backups are on the same disk as the data, so copy `/home/varians/backups` to another machine as well.

## Deploying a new version

On the development machine, with everything committed: `deploy/push.sh`. It copies the commit over as a new release, installs, builds, migrates the database, switches `app` to it and restarts the service. To go back, point `app` at an earlier release and restart:

```sh
sudo -u varians ln -sfn /home/varians/releases/<earlier> /home/varians/app && sudo systemctl restart varians
```

Migrations are not undone by going back. They only ever add, so an earlier release runs on the newer database.

## Looking after it

| | |
|---|---|
| `systemctl status varians` | is it running |
| `journalctl -u varians -e` | the application's log |
| `/var/log/httpd/varians.eu-*_log` | Apache's log of the site |
| `systemctl list-timers varians-backup.timer` | when the last and next backups run |

To restore a backup, stop the service, then:

```sh
sudo -iu postgres dropdb varians && sudo -iu postgres createdb --owner=varians varians
sudo -u varians pg_restore --no-owner -d varians /home/varians/backups/<date>/varians.dump
sudo -u varians rsync -a --delete /home/varians/backups/<date>/storage/ /home/varians/storage/
```

The archives in `storage/` are a second, independent copy of every work in open formats (see `docs/formats/`); `sudo -u varians -H pnpm --dir /home/varians/app --filter @varians/web cli import-archive <dir> --user <email>` reads one back.

`/home/varians` is closed to other users, so commands are run as varians with `sudo -u varians` and given the folder with `--dir`, rather than run after a `cd` into it.
