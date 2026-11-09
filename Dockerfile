# syntax=docker/dockerfile:1
#
# The Varians image: ghcr.io/polemistes/varians. Built by CI for every tag
# (.github/workflows/release.yml), for linux/amd64 and linux/arm64:
#
#   docker build --build-arg VARIANS_COMMIT=$(git rev-parse --short HEAD) -t varians .
#
# The image holds the same release layout as the native tarball, under
# /opt/varians: app/ (the deployed application), bin/varians, docs/. It runs
# as the unprivileged user node, keeps its files in /data/storage, writes
# backups to /data/backups, and starts with `varians serve`, which applies
# the migrations and then starts the server on port 3000.
#
# Alpine (musl) works because sharp and @node-rs/argon2 publish musl builds
# for x64 and arm64 at the versions in pnpm-lock.yaml; were that to change,
# use node:24-slim and the Debian package names instead.

ARG NODE_VERSION=24

# --- Build: install everything, build, then deploy the production dependencies.
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /src
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global --no-fund --no-audit pnpm@11.26.0

# The manifests first, so that the dependencies are cached while only the source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
# The commit the image is built from; a build context has no .git.
ARG VARIANS_COMMIT=""
ENV VARIANS_COMMIT=${VARIANS_COMMIT}
RUN pnpm --filter @varians/web build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @varians/web deploy --prod /out/app \
 && rm -f /out/app/pnpm-lock.yaml /out/app/pnpm-workspace.yaml

# --- Runtime.
FROM node:${NODE_VERSION}-alpine
ARG PG_MAJOR=18
# git writes the archives; tini forwards signals and reaps processes; the
# PostgreSQL client tools of the server's major version back up and restore.
RUN apk add --no-cache git tini tar "postgresql${PG_MAJOR}-client"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STORAGE_DIR=/data/storage \
    BACKUP_DIR=/data/backups \
    PATH=/opt/varians/bin:$PATH

WORKDIR /opt/varians
COPY --from=build /out/app ./app
COPY --from=build /src/bin ./bin
COPY --from=build /src/docs ./docs
COPY --from=build /src/LICENSE /src/README.md /src/SECURITY.md /src/CHANGELOG.md ./
RUN chmod 0755 bin/varians \
 && mkdir -p /data/storage /data/backups \
 && chown -R node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ARG VARIANS_COMMIT=""
LABEL org.opencontainers.image.title="Varians" \
      org.opencontainers.image.description="Digital scholarly editions of ancient texts" \
      org.opencontainers.image.source="https://github.com/polemistes/varians" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.revision="${VARIANS_COMMIT}"

ENTRYPOINT ["/sbin/tini", "--", "/opt/varians/bin/varians"]
CMD ["serve"]
