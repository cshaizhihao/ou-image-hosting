# Threat model

## Scope

This model covers the self-hosted Web and API containers, the local persistent
volume, browser clients, public share links, API tokens, optional external
storage configuration, and the HTTPS reverse proxy.

## Protected assets

- account passwords, sessions, TOTP secrets, and recovery codes;
- API token values and token scopes;
- encrypted external storage credentials;
- private images, versions, thumbnails, albums, tags, and shares;
- JSON metadata, audit records, backups, and signing keys;
- workspace membership and Owner/Admin authorization.

## Trust boundaries

1. Internet to HTTPS reverse proxy.
2. Reverse proxy to the Web container.
3. Web same-origin API proxy to the private API container.
4. API process to the local JSON state and storage volume.
5. API process to user-supplied remote image URLs.
6. API process to configured S3/R2/CDN endpoints.
7. Administrator workstation to downloaded backup archives.

API is not intended to be internet-facing. The Compose deployment publishes only
Web and places Web/API communication on an internal network.

## Threat actors

- unauthenticated internet users;
- authenticated members attempting cross-workspace access;
- compromised Viewer, Editor, Admin, Owner, session, or API token;
- users controlling a remote image URL or share password attempts;
- malicious or corrupted backup/state data;
- an attacker with host, reverse proxy, Docker socket, or volume access.

## Primary threats and controls

### Authentication and authorization

Threats include credential stuffing, session theft, recovery abuse, role
escalation, and cross-workspace object access.

Controls include password hashing, login limits, HttpOnly/SameSite cookies,
production Secure cookies, strict Origin checks for cookie-authenticated writes,
TOTP, one-time recovery codes, exact API token scopes, workspace binding, and
server-side capability checks.

Residual risk: host or browser compromise can bypass application controls.

### Uploads and image processing

Threats include oversized files, decompression bombs, malformed images, path
traversal, dangerous names, quota exhaustion, and CPU exhaustion.

Controls include content-derived format detection, size/pixel limits,
server-generated storage keys, Sharp limits, storage quotas, bounded settings,
and sequential processing.

Residual risk: image decoders and Sharp remain supply-chain/native-code attack
surfaces. Patch dependencies promptly and enforce container resource limits.

### Remote URL upload and outbound requests

Threats include SSRF, redirects to private networks, DNS rebinding, large
responses, and slow responses.

Controls include protocol restrictions, private/loopback/link-local rejection,
redirect validation, response limits, and timeouts.

Residual risk: network policy is defense in depth. The API requires outbound
network access for URL upload and provider probes, so the egress network is not
fully isolated.

### Sharing and delivery

Threats include token guessing, password brute force, expired-link reuse,
referer bypass, and signature forgery.

Controls include random tokens stored as digests, password hashing, expiry and
revocation, rate limits, normalized Origin/Referer rules, HMAC signatures, and
constant-time signature comparison.

### Persistence and concurrency

Threats include JSON corruption, partial writes, schema confusion, malicious
restored state, and concurrent writers.

Controls include serialized in-process updates, temporary-file rename,
restricted file permissions, schema migration and normalization, bounded
operational histories, checksums, and path validation.

Residual risk: the active persistence layer supports one API process only. It
does not provide database transactions, clustering, multi-writer coordination,
or high availability.

### Backups and restore

Threats include archive tampering, path traversal, backup disclosure, resource
exhaustion, partial restore, and loss of the only backup with the data volume.

Controls include Owner authorization, archive and file SHA-256 validation,
relative path validation, file count/history bounds, and encrypted filesystem
permissions.

Residual risk: application backup and restore are memory-heavy, and restore is
not an atomic filesystem transaction. Operators must export backups off-host and
take a stopped volume snapshot before restore or upgrade.

### Reverse proxy and container deployment

Threats include direct API exposure, forged forwarding headers, insecure
cookies, oversized requests, writable container compromise, and log exhaustion.

Controls include loopback-only Web publishing, no API host port, exact trusted
proxy address, HTTPS origin configuration, non-root containers, read-only roots,
dropped capabilities, bounded tmpfs, log rotation, health checks, and resource
limits.

## Explicit non-capabilities

- PostgreSQL is not the active metadata store.
- Redis/BullMQ is not the active queue.
- S3/R2 is not the authoritative normal read/write storage.
- CDN reachability does not switch delivery traffic.
- In-volume backups do not provide host-level disaster recovery.
- The deployment is not horizontally scalable and must not run multiple API
  replicas against one JSON file.

## Operational requirements

- Keep `OU_SECRET_KEY` secret, stable, and backed up separately.
- Terminate HTTPS before Web and keep `COOKIE_SECURE=true`.
- Never expose API port 4000 publicly.
- Apply dependency and base image security updates.
- Export backups off-host and perform recovery drills.
- Review audit records and revoke compromised sessions/tokens.
- Use CI-built images on CPU-restricted production hosts.

## Review triggers

Update this threat model when activating PostgreSQL, Redis, external queues,
S3/R2 reads and writes, CDN delivery, multiple API replicas, third-party identity
providers, plugins, webhooks, or public API integrations.
