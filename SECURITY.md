# Security

## Reporting a vulnerability

Please report a vulnerability privately, through GitHub's private vulnerability reporting: on the repository [polemistes/varians](https://github.com/polemistes/varians), open the **Security** tab and choose **Report a vulnerability**. The report is seen only by the maintainers until a fix is published.

Do not open a public issue or pull request for a vulnerability before it is fixed.

A useful report says which version is affected (the version is shown in the footer of every page and at `/api/version`), what an attacker can do, and how to reproduce it. You will have an answer within two weeks; the fix is released as a new version, and the release notes in [CHANGELOG.md](CHANGELOG.md) name the problem once operators have had the chance to upgrade.

## Supported versions

Only the newest release receives security fixes. Operators upgrade as [docs/install.md](docs/install.md) describes; migrations only add, so an upgrade does not need a migration of data by hand.

## Scope

In scope: the application in this repository (`apps/web`, `packages/core`, `packages/db`), the container image built from it, and the deployment files in `deploy/`, `compose.yaml` and `Caddyfile`.

Out of scope: the configuration of a particular installation (its proxy, its mail server, its operating system), and the data that people have entered into it. Report those to the operator of that installation.
