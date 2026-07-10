# Backup and restore

OU-Image Hosting can create a gzip archive containing the JSON state and local
image files. The archive includes SHA-256 manifest checks.

## Important limitations

- Backups stored inside the Docker data volume are not disaster recovery.
- The application archive remains a bounded in-memory Base64 JSON envelope.
  v1.0 rejects archives over 64 MiB compressed or 256 MiB expanded, more than
  5,000 files, more than 128 MiB of file payloads, a file over 24 MiB, or an
  excessive compression ratio.
- Restore validates the archive, state, paths, sizes, Base64, and SHA-256
  manifest before installing files. It writes to a same-volume staging
  directory, switches storage directories with rename, and rolls back the
  previous storage tree if metadata persistence fails.
- Restore enters maintenance mode, waits for in-flight writes to drain, blocks
  new upload/edit/delete/migration/restore writes with HTTP 503, and makes
  readiness return 503 until the operation finishes.
- Backup and restore still run inside the single API process. Schedule them
  outside upload-heavy periods even though the operation is bounded.

For large libraries, create a volume snapshot while the stack is stopped rather
than relying only on the in-app archive.

## Create and export an application backup

1. Sign in as the site Owner.
2. Open **Storage → Backups**.
3. Create a backup and wait for `completed`.
4. Download the archive to a different machine or object store.
5. Record its size and SHA-256 digest:

```bash
sha256sum ou-image-backup-*.oubackup.gz
```

Retaining only the copy inside the application volume does not protect against
volume loss, host loss, or accidental `down -v`.

## Create a stopped volume snapshot

Stop writes first:

```bash
docker compose --env-file .env.production stop web api
```

Export the named volume:

```bash
docker run --rm \
  -v ou-image-hosting_ou_data:/source:ro \
  -v "$PWD":/backup \
  alpine:3.21 \
  tar -C /source -czf /backup/ou-image-volume-$(date +%Y%m%d-%H%M%S).tar.gz .
```

Restart after the archive is safely written:

```bash
docker compose --env-file .env.production start api web
```

## Restore an in-app backup

Before restore:

1. Export a stopped volume snapshot.
2. Confirm sufficient free disk space.
3. Prefer stopping external traffic at the reverse proxy.
4. The application automatically drains active writes and blocks new writes;
   confirm clients are prepared to retry HTTP 503 responses.
5. Keep the current application image and environment file for rollback.

Use **Storage → Backups → Restore** and wait for completion. Then verify:

- login and two-factor authentication;
- workspace and role isolation;
- image, thumbnail, and version file access;
- albums, tags, favorites, shares, and audit records;
- upload and image transformation;
- API and Owner system health.

If validation or the storage switch fails, the application keeps or restores
the previous online storage tree and releases maintenance mode. If logs report
`restore rollback failed`, stop the stack immediately: a
`.restore-rollback-*` directory is intentionally preserved for manual
recovery. Restore the stopped volume snapshot before accepting traffic.

## Restore a stopped volume snapshot

Stop the stack:

```bash
docker compose --env-file .env.production down
```

Clear and restore the volume only after confirming the volume name:

```bash
docker run --rm \
  -v ou-image-hosting_ou_data:/target \
  -v "$PWD":/backup:ro \
  alpine:3.21 \
  sh -eu -c 'rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null || true; tar -C /target -xzf /backup/ou-image-volume-TIMESTAMP.tar.gz'
```

Start and validate:

```bash
docker compose --env-file .env.production up -d
curl --fail http://127.0.0.1:3000/api/health
```

## Recovery drill

At least quarterly:

1. Restore the latest off-host backup into an isolated Compose project.
2. Use a different host port and a copied environment file.
3. Verify representative users, images, versions, shares, and permissions.
4. Record recovery time and any manual actions.
5. Delete the isolated drill environment without touching production volumes.

Define an RPO and RTO appropriate to the installation. The application does not
currently schedule or export backups automatically.
