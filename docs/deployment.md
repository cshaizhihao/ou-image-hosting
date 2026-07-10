# Production deployment

This guide deploys OU-Image Hosting as three containers:

- `web`: the public Next.js process, bound to host loopback by default.
- `api`: the private Fastify process, reachable only from the internal Docker network.
- `caddy`: the optional `https` profile, terminating TLS on ports 80/443 and
  proxying to Web.

The API stores metadata and image files in one Docker volume. PostgreSQL, Redis,
S3/R2 active reads and writes, and an external job queue are not enabled by this
deployment.

## Architecture boundaries

- Metadata persistence is one JSON file managed by one API process.
- Image originals, thumbnails, versions, and backups use the local persistent
  volume as the authoritative source.
- PostgreSQL and Redis environment variables only affect status/configuration
  reporting. They do not move persistence or jobs out of the API process.
- S3/R2 configuration, probing, and migration exist, but normal image reads and
  writes remain local.
- Run exactly one API replica. Multiple API replicas can race on the same JSON
  file and are unsupported.

## Requirements

- Linux with root or sudo access
- apt, dnf, yum, pacman, zypper, or apk
- curl for launching the installer
- A hostname whose DNS points to the server
- Inbound TCP ports 80/443 for the built-in Caddy profile
- Sufficient disk space for the data volume and an additional backup copy

The one-line installer automatically installs missing Git, curl, OpenSSL,
coreutils, CA certificates, Docker Engine, and Docker Compose v2. Docker uses
the official installer on apt/dnf/yum systems and distribution packages on
pacman/zypper/apk systems. Pass `--no-install-deps` to require all dependencies
to be preinstalled.

## Configure production

```bash
cp .env.production.example .env.production
openssl rand -hex 32
```

Paste the generated value into `OU_SECRET_KEY`. Set `APP_ORIGIN` to the exact
public HTTPS origin without a trailing slash, set `OU_PUBLIC_HOST` to the bare
hostname, and choose `OU_PROXY_MODE=caddy` or `OU_PROXY_MODE=cloudflare`.

Keep these production values:

```dotenv
NODE_ENV=production
COOKIE_SECURE=true
EXPOSE_DEVELOPMENT_RESET_TOKEN=false
```

The default Compose network assigns the Web container `172.30.10.2` and trusts
only that address as a proxy. If `172.30.10.0/29` conflicts with an existing
network, change the Compose subnet, the Web static address, and
`TRUST_PROXY_ADDRESSES` together.

Do not commit `.env.production`.

## Validate and build

```bash
docker compose --env-file .env.production --profile https config --quiet
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build api
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env.production build web
```

The images pin Node.js 20.19.2 and pnpm 9.15.9, install with the frozen lockfile,
and run as the unprivileged `node` user.

On CPU-limited hosts, prefer images built by CI. `nice` does not reliably limit
the Docker daemon, and a local Next.js/Sharp build may temporarily exceed a
strict host CPU policy.

## Start

```bash
docker compose --env-file .env.production --profile https up -d
docker compose --env-file .env.production --profile https ps
curl --fail http://127.0.0.1:3000/api/health/ready
```

Caddy publishes 80/443. Web publishes only the configured loopback port for
local readiness and external-proxy compatibility. API port 4000 remains private.
Caddy explicitly forwards the public HTTPS scheme, host, and port 443. Web
redirects prefer `APP_ORIGIN`, so internal container port 3000 is never exposed
in public login redirects.

Web proxies `/api/*` through a Node Route Handler. `API_PROXY_TARGET` is read at
runtime, so changing the internal API address only requires restarting Web; it
does not require rebuilding the image.

## Built-in Caddy and Cloudflare

Caddy automatically obtains and renews a publicly trusted certificate for
`OU_PUBLIC_HOST`. Direct DNS mode uses `OU_PROXY_MODE=caddy`.

For a Cloudflare proxied record, use `OU_PROXY_MODE=cloudflare` and set
Cloudflare SSL/TLS to `Full (strict)`. Caddy still obtains the origin
certificate; the installer validates both the local origin certificate and a
Cloudflare edge response. During the first certificate issuance, disable
Cloudflare `Always Use HTTPS` and custom HTTPS redirect rules so the ACME
HTTP-01 challenge can reach Caddy on port 80; they can be re-enabled after the
installer succeeds. Do not use `Flexible`.

If another reverse proxy already owns ports 80/443, use
`OU_PROXY_MODE=external`, do not enable the `https` profile, and proxy to the
configured loopback Web port. Do not publish API port 4000.

## Runtime hardening

Compose applies these defaults:

- read-only root filesystems;
- all Linux capabilities dropped;
- `no-new-privileges`;
- writable storage limited to the named data volume and bounded tmpfs mounts;
- JSON log rotation;
- process, memory, and CPU limits;
- health checks and restart policy.

The API, Web, and Caddy quotas total 0.29 CPU by default. Adjust carefully on
hosts with strict sustained CPU limits.

## Data and lifecycle

The named volume is `ou-image-hosting_ou_data` unless the Compose project name
is changed.

```bash
docker volume inspect ou-image-hosting_ou_data
ouih status
ouih logs api
ouih logs web
ouih logs caddy
ouih stop
ouih start
```

The interactive `ouih` menu pauses after each action and returns to the parent
menu after any key press.

Never use `docker compose down -v` unless permanent deletion of all local
metadata, images, versions, thumbnails, and in-volume backups is intended.

## Health semantics

- API `/health/live` confirms that the process is responding.
- API `/health/ready` performs metadata-directory and storage-directory
  write/rename/read/delete probes and returns 503 during restore maintenance.
- The Owner-only system check additionally reports Sharp, queue mode, optional
  external service probes, and the latest saved system event.
- A healthy container does not prove that backups have been exported off-host
  or that an external provider is active.

See [backup and restore](./backup-restore.md), [upgrading](./upgrading.md), and
[troubleshooting](./troubleshooting.md).
