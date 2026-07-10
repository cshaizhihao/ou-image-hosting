# Performance budget

OU-Image Hosting v1.0 targets a single API process and local authoritative
storage. Performance checks must run sequentially on CPU-limited hosts.

## Release budgets

| Surface | Budget |
|---|---:|
| API `/health/live` local p95 | 250 ms |
| API `/health/ready` local p95 | 250 ms |
| Web `/login` production local p95 | 750 ms |
| Shared first-load JavaScript | 170 kB |
| Largest application route first-load JavaScript | 180 kB |
| Single upload hard limit | 20 MiB |
| Bulk management operation | 100 image IDs |

The HTTP smoke test performs two warm-up requests followed by 20 sequential
requests per target:

```bash
scripts/run-low-cpu.sh node scripts/performance-smoke.mjs
```

Run it against production builds after the API and Web processes are ready.
Override URLs or budgets with `PERF_API_LIVE_URL`, `PERF_API_READY_URL`,
`PERF_WEB_URL`, `PERF_API_P95_MS`, and `PERF_WEB_P95_MS`.

## Load boundaries

- The current JSON metadata store is designed for one API process.
- Image processing uses Sharp in the API process; concurrency should remain
  bounded on small hosts.
- Backup and restore operations enter maintenance mode and should be scheduled
  outside upload-heavy periods.
- Ten-thousand-image metadata tests are release diagnostics, not a promise that
  every host or storage device will sustain the same latency.
- PostgreSQL, Redis, remote active storage, and CDN delivery are not enabled by
  merely setting their probe variables.

## Release evidence

### v1.0.0 — 2026-07-11

- API `/health/live`: average 1.2 ms, p95 2.0 ms.
- API `/health/ready`: average 1.8 ms, p95 5.0 ms.
- Web `/login`: average 3.7 ms, p95 6.6 ms.
- Shared first-load JavaScript: 103 kB.
- Largest application route first-load JavaScript: 166 kB.
- Test execution was sequential; build and service processes used the repository
  25% CPU limiter, and Playwright used one worker.

For each future stable release, record:

1. `pnpm check` result and route-size output.
2. `performance-smoke.mjs` JSON output.
3. Browser smoke and accessibility results.
4. Host CPU limit and test concurrency.
5. Any budget exception with an explicit follow-up issue.
