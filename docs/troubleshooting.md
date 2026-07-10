# Troubleshooting

## First checks

```bash
docker compose --env-file .env.production config --quiet
docker compose ps
docker compose --env-file .env.production logs --tail=200 api
docker compose --env-file .env.production logs --tail=200 web
curl -i http://127.0.0.1:3000/api/health
docker system df
```

Do not paste environment files, cookies, API tokens, recovery codes, storage
credentials, or complete state files into public issue reports.

## Containers do not start

- Confirm `.env.production` exists and `OU_SECRET_KEY` is non-empty.
- Confirm `APP_ORIGIN` exactly matches the public origin.
- Check that `172.30.10.0/29` does not overlap another Docker network.
- Check port 3000 is not already in use.
- Inspect container logs rather than repeatedly restarting.

## Web is healthy but API requests fail

- Confirm API health is `healthy` in `docker compose ps`.
- Confirm Web has `API_PROXY_TARGET=http://api:4000`.
- Confirm both services are attached to the `backend` network.
- Do not publish API port 4000 as a workaround.

## Login or writes fail after enabling HTTPS

- `APP_ORIGIN` must use the exact public `https://` origin.
- `COOKIE_SECURE` must be `true`.
- The reverse proxy must forward the original Host and HTTPS scheme.
- Browser cookies created on another hostname or HTTP origin may need removal.
- Clock skew can break sessions, TOTP, expiry, and signed URLs.

## All clients appear to have the same IP

The API trusts only the Web container address by default. If the Docker subnet
or Web address was changed, update `TRUST_PROXY_ADDRESSES` to the exact trusted
address. Do not use an unrestricted proxy trust setting.

## Uploads fail

- Check workspace upload settings and the global hard limit.
- Check `OU_STORAGE_QUOTA_BYTES`, volume free space, and inode availability.
- Check the reverse proxy request body limit and timeouts.
- Confirm the format is allowed and the image is not over the pixel limit.
- URL uploads deliberately reject private, loopback, link-local, and unsafe
  destinations.

## Images or thumbnails return 404

- Confirm the named volume is mounted at `/data`.
- Check whether the image is in trash or permanently deleted.
- Verify the expected files exist under `/data/storage`.
- If logs report `restore rollback failed`, stop the stack and inspect the
  preserved `.restore-rollback-*` directory before restoring a known-good
  volume snapshot.

## Backup creation uses too much memory

The application backup builds a bounded in-memory Base64 JSON envelope before
gzip compression. v1.0 enforces archive, expanded-data, file-count, total-size,
single-file, and compression-ratio limits. For libraries near those bounds,
stop the stack and create a streamed volume tarball as described in
`backup-restore.md`.

## System status meanings

- `single-process-json` is the active metadata implementation.
- `inline-single-process` is the active job execution mode.
- PostgreSQL or Redis `configured-not-in-use` does not mean the application is
  using them.
- CDN reachability does not mean image traffic has switched to the CDN.
- S3/R2 migration does not switch the authoritative read/write source.

## CPU-limited hosts

The Compose runtime quotas total less than 0.30 CPU. Local Docker builds are
controlled by the Docker daemon and can exceed that level temporarily. Prefer
CI-built images and never run multiple builds, tests, or browser sessions in
parallel.

## Collect a safe diagnostic bundle

Include:

- release tag and commit;
- Docker and Compose versions;
- redacted `docker compose config`;
- container status and recent redacted logs;
- free disk and memory;
- exact request time and public error code.

Exclude:

- `.env.production`;
- `OU_SECRET_KEY`;
- cookies, bearer tokens, TOTP seeds, recovery codes;
- S3/R2 credentials;
- backup archives and `ou-image.json`.
