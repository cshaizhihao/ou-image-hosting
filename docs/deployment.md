# Production deployment

This guide deploys OU-Image Hosting as two containers:

- `web`: the public Next.js process, bound to host loopback by default.
- `api`: the private Fastify process, reachable only from the internal Docker network.

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

- Docker Engine 24 or newer
- Docker Compose v2
- A reverse proxy that terminates HTTPS
- A hostname whose DNS points to the reverse proxy
- Sufficient disk space for the data volume and an additional backup copy

## Configure production

```bash
cp .env.production.example .env.production
openssl rand -hex 32
```

Paste the generated value into `OU_SECRET_KEY`. Set `APP_ORIGIN` to the exact
public HTTPS origin without a trailing slash.

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
docker compose --env-file .env.production config --quiet
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
docker compose --env-file .env.production up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

Only Web publishes a host port. API port 4000 is exposed to the internal Docker
network but is not published to the host or internet.

Web proxies `/api/*` through a Node Route Handler. `API_PROXY_TARGET` is read at
runtime, so changing the internal API address only requires restarting Web; it
does not require rebuilding the image.

## Reverse proxy

Example nginx virtual host:

```nginx
server {
    listen 443 ssl;
    server_name images.example.com;

    client_max_body_size 24m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Provision certificates using the reverse proxy's normal ACME workflow. Do not
publish API port 4000.

## Runtime hardening

Compose applies these defaults:

- read-only root filesystems;
- all Linux capabilities dropped;
- `no-new-privileges`;
- writable storage limited to the named data volume and bounded tmpfs mounts;
- JSON log rotation;
- process, memory, and CPU limits;
- health checks and restart policy.

The combined runtime CPU quota is below 0.30 CPU by default. Adjust carefully on
hosts with strict sustained CPU limits.

## Data and lifecycle

The named volume is `ou-image-hosting_ou_data` unless the Compose project name
is changed.

```bash
docker volume inspect ou-image-hosting_ou_data
docker compose --env-file .env.production logs --tail=200 api
docker compose --env-file .env.production logs --tail=200 web
docker compose --env-file .env.production stop
docker compose --env-file .env.production start
```

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
