import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const directories: string[] = [];

async function testApp(now = () => new Date("2026-07-11T08:00:00.000Z")) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "ou-backup-schedule-"));
  directories.push(dataDirectory);
  const app = await buildApp({
    dataDirectory,
    now,
    backupSchedulerIntervalMs: 15
  });
  apps.push(app);
  const setup = await app.inject({
    method: "POST",
    url: "/setup",
    payload: {
      siteName: "OU Backup Test",
      displayName: "Backup Owner",
      email: "backup-owner@example.com",
      password: "Backup-Owner-2026!"
    }
  });
  const cookie = setup.cookies.find((item) => item.name === "ou_session")!.value;
  return { app, dataDirectory, cookie };
}

async function enableSchedule(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string
) {
  const response = await app.inject({
    method: "PATCH",
    url: "/storage/settings",
    headers: { origin: "http://localhost:3000" },
    cookies: { ou_session: cookie },
    payload: {
      backup: {
        scheduleEnabled: true,
        intervalHours: 1,
        retentionCount: 2
      }
    }
  });
  expect(response.statusCode).toBe(200);
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("automatic backup scheduler", () => {
  it("creates one due backup and exposes a verified restore preflight", async () => {
    const { app, cookie } = await testApp();
    await enableSchedule(app, cookie);

    await vi.waitFor(
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/backups",
          cookies: { ou_session: cookie }
        });
        expect(response.json().backups).toHaveLength(1);
        expect(response.json().backups[0].status).toBe("completed");
      },
      { timeout: 1_000, interval: 20 }
    );

    const backups = await app.inject({
      method: "GET",
      url: "/backups",
      cookies: { ou_session: cookie }
    });
    const backup = backups.json().backups[0];
    expect(backup).toMatchObject({
      format: "ou-image-backup-v1",
      checksumStatus: "recorded",
      compatibilityStatus: "unchecked"
    });
    const preflight = await app.inject({
      method: "POST",
      url: `/backups/${backup.id}/preflight`,
      headers: { origin: "http://localhost:3000" },
      payload: {},
      cookies: { ou_session: cookie }
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      compatible: true,
      checksumVerified: true,
      manifestVerified: true,
      sourceSchemaVersion: 8,
      currentSchemaVersion: 8
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/backups",
          cookies: { ou_session: cookie }
        })
      ).json().backups
    ).toHaveLength(1);
  });

  it("keeps a readable failed backup and audit event when scheduling fails", async () => {
    const { app, dataDirectory, cookie } = await testApp();
    await writeFile(path.join(dataDirectory, "backups"), "not-a-directory");
    await enableSchedule(app, cookie);

    await vi.waitFor(
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/backups",
          cookies: { ou_session: cookie }
        });
        expect(response.json().backups[0]).toMatchObject({ status: "failed" });
        expect(response.json().backups[0].error).toBeTruthy();
      },
      { timeout: 1_000, interval: 20 }
    );
    const audit = await app.inject({
      method: "GET",
      url: "/audit?action=backup.schedule.failure",
      cookies: { ou_session: cookie }
    });
    expect(audit.statusCode).toBe(200);
    expect(
      audit.json().events.some(
        (event: { action: string; result: string }) =>
          event.action === "backup.schedule.failure" && event.result === "failure"
      )
    ).toBe(true);
  });
});
