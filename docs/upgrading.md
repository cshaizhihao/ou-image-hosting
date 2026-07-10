# Upgrading

Upgrades can change the JSON schema. The API performs supported schema migration
when it loads the state file.

## Before every upgrade

1. Read `CHANGELOG.md` and the release notes.
2. Confirm the target release supports the current schema.
3. Create and export an application backup.
4. Stop the stack and create a volume snapshot.
5. Preserve the current images, `.env.production`, Compose file, and Git commit.

Do not rely on a backup that exists only inside the same data volume.

## Upgrade procedure

```bash
ouih update
```

The command refuses a dirty Git working tree, preserves `.env.production`,
updates `ouih` itself, builds API and Web sequentially, and starts the correct
Compose profile for direct Caddy or Cloudflare mode.

If `ouih` is not installed yet, rerun the one-line installer. Prefer CI-built
images on hosts with strict CPU limits.

Monitor startup:

```bash
ouih status
ouih logs api
ouih logs web
ouih logs caddy
curl --fail http://127.0.0.1:3000/api/health/ready
```

Then verify installation status, login, upload, image access, sharing, and the
Owner system check.

## Schema compatibility

The v1.0 release candidate migrates supported older state into schema v7.
Application backup restore accepts schema v5, v6, and v7 archives.

An older application may not understand a newer schema. A Git rollback without
a matching pre-upgrade volume snapshot is not a safe rollback.

## Rollback

If validation fails:

1. Stop Web and API.
2. Restore the pre-upgrade stopped volume snapshot.
3. Check out the previous tag or restore the previous images.
4. Start the previous version.
5. Verify health and representative files before reopening traffic.

Never point an older image at a volume already migrated by a newer release
unless that exact downgrade path is documented.

## Environment changes

Compare the new `.env.production.example` with the deployed environment:

```bash
diff -u .env.production.example .env.production
```

Do not replace the existing `OU_SECRET_KEY`. Changing it can make encrypted
remote storage credentials, signed delivery URLs, TOTP secrets, and other
secret-derived data unusable.

If the Compose backend subnet changes, update the Web static address and
`TRUST_PROXY_ADDRESSES` together.
