# Troubleshooting

## First checks

```bash
ouih status
ouih logs api
ouih logs web
ouih logs caddy
curl -i http://127.0.0.1:3000/api/health/ready
docker system df
```

Do not paste environment files, cookies, API tokens, recovery codes, storage
credentials, or complete state files into public issue reports.

## Containers do not start

- Confirm `.env.production` exists and `OU_SECRET_KEY` is non-empty.
- Confirm `APP_ORIGIN` exactly matches the public origin.
- Check that `172.30.10.0/29` does not overlap another Docker network.
- Check port 3000 is not already in use.
- Built-in HTTPS additionally requires free inbound TCP ports 80/443.
- Inspect container logs rather than repeatedly restarting.

## Browser reports ERR_SSL_PROTOCOL_ERROR

This means an HTTPS URL reached a service that only spoke HTTP, or the TLS
proxy did not start.

- Run `ouih status` and confirm `caddy` is running.
- Run `ouih logs caddy` and inspect ACME/certificate errors.
- Confirm `OU_PROXY_MODE` is `caddy` or `cloudflare`.
- Confirm the domain A/AAAA record points to the server and TCP 80/443 are open.
- Do not browse to `https://domain` while only exposing the Web HTTP port.

## Cloudflare reports 525 or 526

- Set Cloudflare SSL/TLS mode to `Full (strict)`, never `Flexible`.
- Confirm the DNS record has the orange-cloud proxy enabled.
- Confirm Caddy can obtain its origin certificate with `ouih logs caddy`.
- During first issuance, disable `Always Use HTTPS` and custom HTTPS redirects
  so ACME HTTP-01 can reach Caddy on port 80.
- Temporarily disable Cloudflare Access or WAF rules that block
  `/api/health/ready`.
- Verify the origin directly from the server:
  `curl --resolve domain.example:443:127.0.0.1 https://domain.example/api/health/ready`.

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

The Compose runtime quotas total 0.29 CPU. Local Docker builds are
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
