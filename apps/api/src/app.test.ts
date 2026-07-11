import { afterEach, describe, expect, it, vi } from "vitest";
import FormData from "form-data";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import sharp from "sharp";
import { buildApp, redactCapabilityUrl } from "./app.js";
import {
  isIpAllowed,
  normalizeIpAllowlist,
  sanitizeAuditMetadata
} from "./access.js";
import {
  hashOpaqueToken,
  hashPassword,
  totpAt
} from "./security.js";
import { AppStore } from "./store.js";
import { MaintenanceGate } from "./maintenance.js";
import { assertProductionConfiguration } from "./runtime.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const rawInjectors = new WeakMap<
  Awaited<ReturnType<typeof buildApp>>,
  (request: any) => Promise<any>
>();
const temporaryDirectories: string[] = [];
const initialSecretKey = process.env.OU_SECRET_KEY;
const initialTrustProxy = process.env.TRUST_PROXY;
const initialTrustProxyAddresses = process.env.TRUST_PROXY_ADDRESSES;

async function createTestApp(
  options: {
    now?: () => Date;
    store?: AppStore;
    onDataDirectory?: (directory: string) => void;
  } = {}
) {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "ou-image-api-test-")
  );
  temporaryDirectories.push(dataDirectory);
  options.onDataDirectory?.(dataDirectory);
  const app = await buildApp({
    store: options.store ?? new AppStore(null),
    dataDirectory,
    exposeDevelopmentResetToken: true,
    now: options.now
  });
  const inject = app.inject.bind(app) as (request: any) => Promise<any>;
  rawInjectors.set(app, inject);
  app.inject = ((requestOptions: any) => {
    if (
      typeof requestOptions === "object" &&
      requestOptions !== null &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(
        String(requestOptions.method ?? "GET").toUpperCase()
      ) &&
      requestOptions.cookies?.ou_session &&
      !requestOptions.headers?.origin
    ) {
      return inject({
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          origin: "http://localhost:3000"
        }
      });
    }
    return inject(requestOptions);
  }) as any;
  apps.push(app);
  return app;
}

function rawInject(
  app: Awaited<ReturnType<typeof buildApp>>,
  request: any
) {
  return rawInjectors.get(app)!(request);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (initialSecretKey === undefined) {
    delete process.env.OU_SECRET_KEY;
  } else {
    process.env.OU_SECRET_KEY = initialSecretKey;
  }
  if (initialTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = initialTrustProxy;
  if (initialTrustProxyAddresses === undefined) {
    delete process.env.TRUST_PROXY_ADDRESSES;
  } else {
    process.env.TRUST_PROXY_ADDRESSES = initialTrustProxyAddresses;
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const owner = {
  siteName: "OU-Image Hosting",
  displayName: "欧记",
  email: "owner@example.com",
  password: "Secure-Password-2026!"
};

describe("OU-Image API", () => {
  it("reports health and initial setup status", async () => {
    let dataDirectory = "";
    const app = await createTestApp({
      onDataDirectory: (directory) => {
        dataDirectory = directory;
      }
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    const live = await app.inject({
      method: "GET",
      url: "/health/live"
    });
    const ready = await app.inject({
      method: "GET",
      url: "/health/ready"
    });
    const status = await app.inject({ method: "GET", url: "/setup/status" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      version: "1.9.0"
    });
    expect(live.json()).toMatchObject({
      status: "ok",
      version: "1.9.0"
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: "ready",
      schemaVersion: 7
    });
    expect(
      (await readdir(dataDirectory)).some((name) =>
        name.startsWith(".ready-")
      )
    ).toBe(false);
    expect(
      (await readdir(path.join(dataDirectory, "storage"))).some((name) =>
        name.startsWith(".ready-")
      )
    ).toBe(false);
    expect(status.json()).toEqual({ setupComplete: false, site: null });
  });

  it("drains active writes before restore maintenance and blocks new writes", async () => {
    const maintenance = new MaintenanceGate();
    const releaseWrite = maintenance.beginWrite();
    let restoreEntered = false;
    const restore = maintenance.beginRestore().then((release) => {
      restoreEntered = true;
      return release;
    });
    await Promise.resolve();
    expect(restoreEntered).toBe(false);
    expect(() => maintenance.beginWrite()).toThrow(
      "系统正在恢复备份"
    );
    releaseWrite();
    const releaseRestore = await restore;
    expect(restoreEntered).toBe(true);
    expect(() => maintenance.beginWrite()).toThrow(
      "系统正在恢复备份"
    );
    releaseRestore();
    const releaseNextWrite = maintenance.beginWrite();
    releaseNextWrite();
  });

  it("fails fast on unsafe production configuration", () => {
    const validSecret = "8rH4rE3QwY9xVm2Tp6Ns7Kc5Jd1Lf0Za";
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: "short",
        APP_ORIGIN: "https://images.example.com"
      })
    ).toThrow("OU_SECRET_KEY");
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY:
          "replace-with-a-long-random-production-secret",
        APP_ORIGIN: "https://images.example.com"
      })
    ).toThrow("OU_SECRET_KEY");
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: validSecret,
        APP_ORIGIN: "http://images.example.com"
      })
    ).toThrow("HTTPS");
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: validSecret,
        APP_ORIGIN: "ftp://localhost"
      })
    ).toThrow("HTTPS");
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: validSecret,
        APP_ORIGIN: "https://images.example.com",
        EXPOSE_DEVELOPMENT_RESET_TOKEN: "true"
      })
    ).toThrow("EXPOSE_DEVELOPMENT_RESET_TOKEN");
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: validSecret,
        APP_ORIGIN: "https://images.example.com"
      })
    ).not.toThrow();
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        OU_SECRET_KEY: validSecret,
        APP_ORIGIN: "http://localhost:3000"
      })
    ).not.toThrow();
  });

  it("keeps in-memory state unchanged when persistence fails", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ou-image-store-rollback-")
    );
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    const store = new AppStore(statePath);
    await store.initialize();
    const before = store.snapshot();
    await rm(directory, { recursive: true, force: true });
    await writeFile(directory, "not-a-directory");
    await expect(
      store.update((state) => {
        state.setupComplete = true;
      })
    ).rejects.toBeTruthy();
    expect(store.snapshot()).toEqual(before);
  });

  it("creates an owner, persists a session and logs out", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });

    expect(setup.statusCode).toBe(201);
    expect(setup.json().user).toMatchObject({
      email: owner.email,
      role: "owner",
      onboardingCompleted: false
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");

    const session = await app.inject({
      method: "GET",
      url: "/auth/session",
      cookies: { ou_session: cookie!.value }
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe(owner.email);

    const fallbackSession = await app.inject({
      method: "GET",
      url: "/auth/session",
      cookies: { ou_session: cookie!.value },
      headers: { "x-workspace-id": "stale-workspace-from-browser" }
    });
    expect(fallbackSession.statusCode).toBe(200);
    expect(fallbackSession.json().workspace.id).toBe(
      fallbackSession.json().defaultWorkspace.id
    );

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { ou_session: cookie!.value }
    });
    expect(logout.statusCode).toBe(204);

    const expiredSession = await app.inject({
      method: "GET",
      url: "/auth/session",
      cookies: { ou_session: cookie!.value }
    });
    expect(expiredSession.statusCode).toBe(401);
  });

  it("rejects duplicate setup and invalid credentials", async () => {
    const app = await createTestApp();
    await app.inject({ method: "POST", url: "/setup", payload: owner });

    const duplicate = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: owner.email, password: "not-the-password" }
    });

    expect(duplicate.statusCode).toBe(409);
    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns sanitized validation errors for invalid setup requests", async () => {
    const app = await createTestApp();
    const blankName = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { ...owner, siteName: "  " }
    });
    const missingFields = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { siteName: "OU-Image Hosting" }
    });

    expect(blankName.statusCode).toBe(400);
    expect(blankName.json().error.code).toBe("INVALID_SITE_NAME");
    expect(missingFields.statusCode).toBe(400);
    expect(missingFields.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "请求内容不符合要求"
      }
    });
  });

  it("completes onboarding and resets a password once", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;

    const profile = await app.inject({
      method: "PATCH",
      url: "/me",
      cookies: { ou_session: cookie.value },
      payload: { theme: "dark", onboardingCompleted: true }
    });
    expect(profile.json().user).toMatchObject({
      theme: "dark",
      onboardingCompleted: true
    });

    const forgot = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: owner.email }
    });
    const token = forgot.json().developmentResetToken as string;
    expect(token).toBeTypeOf("string");

    const reset = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token, password: "Another-Secure-2026!" }
    });
    const reused = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token, password: "Third-Secure-Password-2026!" }
    });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: owner.email,
        password: "Another-Secure-2026!"
      }
    });

    expect(reset.statusCode).toBe(200);
    expect(reused.statusCode).toBe(400);
    expect(login.statusCode).toBe(200);
  });

  it("keeps password recovery responses account-neutral", async () => {
    const app = await createTestApp();
    await app.inject({ method: "POST", url: "/setup", payload: owner });
    const known = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: owner.email }
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "nobody@example.com" }
    });

    expect(known.json().message).toBe(unknown.json().message);
    expect(unknown.json().developmentResetToken).toBeUndefined();
  });

  it("uploads, thumbnails and deduplicates a real PNG", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const png = await sharp({
      create: {
        width: 16,
        height: 12,
        channels: 4,
        background: { r: 239, g: 143, b: 143, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const upload = async () => {
      const form = new FormData();
      form.append("file", png, {
        filename: "sample.png",
        contentType: "image/png"
      });
      return app.inject({
        method: "POST",
        url: "/uploads",
        headers: form.getHeaders(),
        cookies: { ou_session: cookie.value },
        payload: form.getBuffer()
      });
    };

    const first = await upload();
    const duplicate = await upload();
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      duplicate: false,
      image: {
        name: "sample.png",
        format: "png",
        width: 16,
        height: 12
      }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      duplicate: true,
      image: { id: first.json().image.id }
    });

    const summary = await app.inject({
      method: "GET",
      url: "/uploads/summary",
      cookies: { ou_session: cookie.value }
    });
    expect(summary.json()).toMatchObject({ count: 1, bytes: png.byteLength });

    const thumbnail = await app.inject({
      method: "GET",
      url: first.json().image.thumbnailUrl.replace("/api", "")
    });
    const original = await app.inject({
      method: "GET",
      url: first.json().image.originalUrl.replace("/api", "")
    });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers["content-type"]).toContain("image/webp");
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload.equals(png)).toBe(true);
  });

  it("protects upload state and blocks private URL targets", async () => {
    const app = await createTestApp();
    const anonymous = await app.inject({
      method: "GET",
      url: "/uploads/summary"
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const privateUrl = await app.inject({
      method: "POST",
      url: "/uploads/from-url",
      cookies: { ou_session: cookie.value },
      payload: { url: "http://127.0.0.1/private.png" }
    });

    expect(anonymous.statusCode).toBe(401);
    expect(privateUrl.statusCode).toBe(400);
    expect(privateUrl.json().error.code).toBe("BLOCKED_URL");
  });

  it("filters, sorts, paginates and bulk-trashes library images", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookieMap = { ou_session: cookie.value };

    const uploadImage = async (
      filename: string,
      format: "png" | "jpeg",
      width: number
    ) => {
      const buffer = await sharp({
        create: {
          width,
          height: 10,
          channels: 3,
          background: { r: width, g: 80, b: 120 }
        }
      })
        [format]()
        .toBuffer();
      const form = new FormData();
      form.append("file", buffer, {
        filename,
        contentType: format === "jpeg" ? "image/jpeg" : "image/png"
      });
      return app.inject({
        method: "POST",
        url: "/uploads",
        headers: form.getHeaders(),
        cookies: cookieMap,
        payload: form.getBuffer()
      });
    };

    const alpha = await uploadImage("alpha.png", "png", 11);
    const beta = await uploadImage("beta.jpg", "jpeg", 24);
    expect(alpha.statusCode).toBe(201);
    expect(beta.statusCode).toBe(201);

    const pngOnly = await app.inject({
      method: "GET",
      url: "/uploads?q=alpha&format=png&page=1&limit=1&sort=name",
      cookies: cookieMap
    });
    expect(pngOnly.json()).toMatchObject({
      total: 1,
      totalPages: 1,
      images: [{ name: "alpha.png", format: "png" }]
    });

    const bySize = await app.inject({
      method: "GET",
      url: "/uploads?sort=size",
      cookies: cookieMap
    });
    expect(bySize.json().images[0].name).toBe("beta.jpg");

    const published = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [alpha.json().image.id, beta.json().image.id],
        action: "set-public-visibility",
        publicVisible: true
      }
    });
    expect(published.json()).toEqual({ updated: 2, publicVisible: true });

    const publicImages = await app.inject({
      method: "GET",
      url: "/public/images"
    });
    expect(publicImages.json().images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "alpha.png" }),
        expect.objectContaining({ name: "beta.jpg" })
      ])
    );

    const hidden = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [alpha.json().image.id],
        action: "set-public-visibility",
        publicVisible: false
      }
    });
    expect(hidden.json()).toEqual({ updated: 1, publicVisible: false });

    const visibleAgain = await app.inject({
      method: "GET",
      url: "/public/images"
    });
    expect(
      visibleAgain.json().images.some((image: { name: string }) => image.name === "alpha.png")
    ).toBe(false);
    expect(
      visibleAgain.json().images.some((image: { name: string }) => image.name === "beta.jpg")
    ).toBe(true);

    const missingVisibility = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [beta.json().image.id],
        action: "set-public-visibility"
      }
    });
    expect(missingVisibility.statusCode).toBe(400);
    expect(missingVisibility.json().error.code).toBe(
      "PUBLIC_VISIBILITY_REQUIRED"
    );

    const favorited = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [alpha.json().image.id, beta.json().image.id],
        action: "set-favorite",
        favorite: true
      }
    });
    expect(favorited.json()).toEqual({ updated: 2, favorite: true });

    const favorites = await app.inject({
      method: "GET",
      url: "/favorites",
      cookies: cookieMap
    });
    expect(favorites.json().images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "alpha.png", favorite: true }),
        expect.objectContaining({ name: "beta.jpg", favorite: true })
      ])
    );

    const unfavorited = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [alpha.json().image.id],
        action: "set-favorite",
        favorite: false
      }
    });
    expect(unfavorited.json()).toEqual({ updated: 1, favorite: false });

    const missingFavorite = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: {
        ids: [beta.json().image.id],
        action: "set-favorite"
      }
    });
    expect(missingFavorite.statusCode).toBe(400);
    expect(missingFavorite.json().error.code).toBe("FAVORITE_REQUIRED");

    const trashed = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: cookieMap,
      payload: { ids: [alpha.json().image.id], action: "trash" }
    });
    expect(trashed.json()).toEqual({ updated: 1 });

    const remaining = await app.inject({
      method: "GET",
      url: "/uploads",
      cookies: cookieMap
    });
    const summary = await app.inject({
      method: "GET",
      url: "/uploads/summary",
      cookies: cookieMap
    });
    expect(remaining.json()).toMatchObject({
      total: 1,
      images: [{ name: "beta.jpg" }]
    });
    expect(summary.json().count).toBe(1);
  });

  it("migrates schema v4 into workspace schema v7", async () => {
    const dataDirectory = await mkdtemp(
      path.join(tmpdir(), "ou-image-store-migration-")
    );
    temporaryDirectories.push(dataDirectory);
    const filePath = path.join(dataDirectory, "ou-image.json");
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 4,
        setupComplete: false,
        users: [],
        sessions: [],
        passwordResets: [],
        imageShares: [],
        albums: [],
        tags: [],
        images: [
          {
            id: "legacy-image",
            userId: "legacy-user",
            name: "legacy.png",
            size: 128,
            mime: "image/png",
            format: "png",
            width: 8,
            height: 6,
            sha256: "legacy-hash",
            originalKey: "originals/legacy.png",
            thumbnailKey: "thumbnails/legacy.webp",
            currentVersionId: "legacy-version",
            versions: [
              {
                id: "legacy-version",
                operation: "original",
                size: 128,
                mime: "image/png",
                format: "png",
                width: 8,
                height: 6,
                sha256: "legacy-hash",
                originalKey: "originals/legacy.png",
                thumbnailKey: "thumbnails/legacy.webp",
                createdAt: "2026-01-01T00:00:00.000Z"
              }
            ],
            favorite: true,
            albumIds: [],
            tagIds: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      })
    );

    const store = new AppStore(filePath);
    await store.initialize();
    const state = store.snapshot();
    expect(state.schemaVersion).toBe(7);
    expect(state.imageShares).toEqual([]);
    expect(state.albums).toEqual([]);
    expect(state.tags).toEqual([]);
    expect(state.images[0]).toMatchObject({
      currentVersionId: "legacy-version",
      favorite: true,
      favoriteUserIds: ["legacy-user"],
      workspaceId: "personal-legacy-user",
      albumIds: [],
      tagIds: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      versions: [
        {
          id: "legacy-version",
          operation: "original",
          format: "png",
          width: 8,
          height: 6
        }
      ]
    });
    expect(state.storageSettings).toEqual({ active: "local" });
    expect(state.deliverySettings).toMatchObject({
      linkTemplate: "{domain}/api/files/{id}/{variant}",
      hotlinkEnabled: false,
      allowEmptyReferer: true,
      signedUrls: false,
      signedUrlTtlSeconds: 3600
    });
    expect(state.backupSettings).toMatchObject({
      scheduleEnabled: false,
      intervalHours: 24,
      retentionCount: 7
    });
    expect(state.backups).toEqual([]);
    expect(state.storageMigrations).toEqual([]);
    expect(state.workspaces).toEqual([]);
    expect(state.workspaceMembers).toEqual([]);
  });

  it("renames, transforms and restores image versions", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: { r: 20, g: 120, b: 220 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "landscape.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;

    const invalidRename = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "../escape.png" }
    });
    expect(invalidRename.statusCode).toBe(400);
    expect(invalidRename.json().error.code).toBe("INVALID_IMAGE_NAME");

    const renamed = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "blue landscape.png" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().image.name).toBe("blue landscape.png");
    const originalVersionId = renamed.json().image.currentVersionId as string;

    const rotated = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/transform`,
      cookies,
      payload: { action: "rotate-right" }
    });
    expect(rotated.statusCode).toBe(201);
    expect(rotated.json()).toMatchObject({
      image: {
        width: 16,
        height: 32,
        format: "png"
      },
      version: {
        operation: "rotate-right",
        sourceVersionId: originalVersionId
      }
    });
    const rotatedSize = rotated.json().version.size as number;

    const converted = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/transform`,
      cookies,
      payload: {
        action: "convert-format",
        format: "webp",
        quality: 72
      }
    });
    expect(converted.statusCode).toBe(201);
    expect(converted.json().image).toMatchObject({
      name: "blue landscape.webp",
      format: "webp",
      mime: "image/webp",
      width: 16,
      height: 32
    });
    const convertedSize = converted.json().version.size as number;

    const versionedSummary = await app.inject({
      method: "GET",
      url: "/uploads/summary",
      cookies
    });
    expect(versionedSummary.json().bytes).toBe(
      png.byteLength + rotatedSize + convertedSize
    );

    const currentFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/original`
    });
    expect(currentFile.headers["content-type"]).toContain("image/webp");
    expect(await sharp(currentFile.rawPayload).metadata()).toMatchObject({
      format: "webp",
      width: 16,
      height: 32
    });

    const restored = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/versions/${originalVersionId}/restore`,
      cookies
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json()).toMatchObject({
      image: {
        name: "blue landscape.png",
        format: "png",
        width: 32,
        height: 16
      },
      version: {
        operation: "restore",
        sourceVersionId: originalVersionId
      }
    });
    const restoredSummary = await app.inject({
      method: "GET",
      url: "/uploads/summary",
      cookies
    });
    expect(restoredSummary.json().bytes).toBe(
      png.byteLength + rotatedSize + convertedSize
    );

    const detail = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().image.versions).toHaveLength(4);
    expect(detail.json().image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.json().image.versions[0].originalKey).toBeUndefined();

    const historicalFile = await app.inject({
      method: "GET",
      url: detail.json().image.versions[1].originalUrl.replace("/api", ""),
      cookies
    });
    expect(historicalFile.statusCode).toBe(200);
    expect(historicalFile.headers["content-type"]).toContain("image/webp");
  });

  it(
    "protects expiring shares with scrypt passwords and counts access",
    async () => {
      let timestamp = new Date("2026-07-10T08:00:00.000Z");
      const store = new AppStore(null);
      const app = await createTestApp({
        store,
        now: () => new Date(timestamp)
      });
      const setup = await app.inject({
        method: "POST",
        url: "/setup",
        payload: owner
      });
      const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
      const cookies = { ou_session: cookie.value };
      const png = await sharp({
        create: {
          width: 12,
          height: 9,
          channels: 3,
          background: { r: 240, g: 90, b: 100 }
        }
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.append("file", png, {
        filename: "shared.png",
        contentType: "image/png"
      });
      const upload = await app.inject({
        method: "POST",
        url: "/uploads",
        headers: form.getHeaders(),
        cookies,
        payload: form.getBuffer()
      });
      const imageId = upload.json().image.id as string;

      const created = await app.inject({
        method: "POST",
        url: `/uploads/${imageId}/shares`,
        cookies,
        payload: { password: "share-secret", expiresInHours: 1 }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().share).toMatchObject({
        passwordRequired: true,
        accessCount: 0
      });
      expect(created.json().publicUrl).toBe(`/share/${created.json().token}`);
      const token = created.json().token as string;
      const storedShare = store.snapshot().imageShares[0]!;
      expect(storedShare.passwordHash).toMatch(/^scrypt\$/);
      expect(storedShare.passwordHash).not.toContain("share-secret");
      expect(storedShare.tokenHash).not.toBe(token);

      const metadata = await app.inject({
        method: "GET",
        url: `/shares/${token}`
      });
      expect(metadata.statusCode).toBe(200);
      expect(metadata.json()).toMatchObject({
        share: { passwordRequired: true, accessCount: 0 },
        image: { name: "shared.png", width: 12, height: 9 }
      });
      expect(JSON.stringify(metadata.json())).not.toContain("passwordHash");
      expect(JSON.stringify(metadata.json())).not.toContain("originalKey");

      const wrongPassword = await app.inject({
        method: "POST",
        url: `/shares/${token}/access`,
        payload: { password: "wrong-secret" }
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(store.snapshot().imageShares[0]!.accessCount).toBe(0);

      const access = await app.inject({
        method: "POST",
        url: `/shares/${token}/access`,
        payload: { password: "share-secret" }
      });
      expect(access.statusCode).toBe(200);
      expect(access.headers["content-type"]).toContain("image/png");
      expect(access.rawPayload.equals(png)).toBe(true);
      expect(store.snapshot().imageShares[0]).toMatchObject({
        accessCount: 1,
        lastAccessedAt: "2026-07-10T08:00:00.000Z"
      });

      timestamp = new Date("2026-07-10T09:00:01.000Z");
      const expiredMetadata = await app.inject({
        method: "GET",
        url: `/shares/${token}`
      });
      const expiredAccess = await app.inject({
        method: "POST",
        url: `/shares/${token}/access`,
        payload: { password: "share-secret" }
      });
      expect(expiredMetadata.statusCode).toBe(410);
      expect(expiredMetadata.json().error.code).toBe("SHARE_EXPIRED");
      expect(expiredAccess.statusCode).toBe(410);
      expect(store.snapshot().imageShares[0]!.accessCount).toBe(1);
    }
  );

  it("revokes public shares and exposes their status only to the owner", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 6,
        height: 6,
        channels: 3,
        background: { r: 60, g: 180, b: 90 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "revoke.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;
    const created = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/shares`,
      cookies,
      payload: {}
    });
    const token = created.json().token as string;
    const shareId = created.json().share.id as string;

    const access = await app.inject({
      method: "POST",
      url: `/shares/${token}/access`,
      payload: {}
    });
    expect(access.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/uploads/${imageId}/shares/${shareId}`,
      cookies
    });
    expect(revoked.statusCode).toBe(204);
    const denied = await app.inject({
      method: "POST",
      url: `/shares/${token}/access`,
      payload: {}
    });
    expect(denied.statusCode).toBe(410);
    expect(denied.json().error.code).toBe("SHARE_REVOKED");

    const detail = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies
    });
    expect(detail.json().image.shares[0]).toMatchObject({
      id: shareId,
      accessCount: 1
    });
    expect(detail.json().image.shares[0].revokedAt).toBeTypeOf("string");
  });

  it("manages albums, tags, favorites and tag merges", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { ...owner, registrationEnabled: true }
    });
    const ownerCookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!;
    const ownerCookies = { ou_session: ownerCookie.value };
    const png = await sharp({
      create: {
        width: 18,
        height: 14,
        channels: 3,
        background: { r: 100, g: 80, b: 210 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "organized.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies: ownerCookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;

    const invalidCover = await app.inject({
      method: "POST",
      url: "/albums",
      cookies: ownerCookies,
      payload: {
        name: "无效封面",
        coverImageId: "missing-image"
      }
    });
    expect(invalidCover.statusCode).toBe(404);

    const album = await app.inject({
      method: "POST",
      url: "/albums",
      cookies: ownerCookies,
      payload: {
        name: "产品截图",
        description: "准备发布的界面截图"
      }
    });
    expect(album.statusCode).toBe(201);
    const albumId = album.json().album.id as string;
    const updatedAlbum = await app.inject({
      method: "PATCH",
      url: `/albums/${albumId}`,
      cookies: ownerCookies,
      payload: {
        name: "产品视觉",
        coverImageId: imageId
      }
    });
    expect(updatedAlbum.json().album).toMatchObject({
      id: albumId,
      name: "产品视觉",
      coverImageId: imageId,
      coverThumbnailUrl: `/api/files/${imageId}/thumbnail`,
      imageCount: 0
    });

    const sourceTag = await app.inject({
      method: "POST",
      url: "/tags",
      cookies: ownerCookies,
      payload: { name: "待处理", color: "#7c3aed" }
    });
    const targetTag = await app.inject({
      method: "POST",
      url: "/tags",
      cookies: ownerCookies,
      payload: { name: "已精选", color: "#16A34A" }
    });
    expect(sourceTag.statusCode).toBe(201);
    expect(sourceTag.json().tag.color).toBe("#7C3AED");
    const sourceTagId = sourceTag.json().tag.id as string;
    const targetTagId = targetTag.json().tag.id as string;

    const patchedTag = await app.inject({
      method: "PATCH",
      url: `/tags/${sourceTagId}`,
      cookies: ownerCookies,
      payload: { name: "待整理", color: "#F97316" }
    });
    expect(patchedTag.json().tag).toMatchObject({
      name: "待整理",
      color: "#F97316"
    });

    const invalidColor = await app.inject({
      method: "POST",
      url: "/tags",
      cookies: ownerCookies,
      payload: { name: "错误颜色", color: "purple" }
    });
    expect(invalidColor.statusCode).toBe(400);

    const organized = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}/organization`,
      cookies: ownerCookies,
      payload: {
        favorite: true,
        albumIds: [albumId],
        tagIds: [sourceTagId]
      }
    });
    expect(organized.statusCode).toBe(200);
    expect(organized.json().image).toMatchObject({
      favorite: true,
      albumIds: [albumId],
      tagIds: [sourceTagId]
    });

    const detail = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies: ownerCookies
    });
    expect(detail.json().image).toMatchObject({
      favorite: true,
      albumIds: [albumId],
      tagIds: [sourceTagId]
    });

    const favorites = await app.inject({
      method: "GET",
      url: "/favorites",
      cookies: ownerCookies
    });
    const albumImages = await app.inject({
      method: "GET",
      url: `/albums/${albumId}/images`,
      cookies: ownerCookies
    });
    const tagImages = await app.inject({
      method: "GET",
      url: `/tags/${sourceTagId}/images`,
      cookies: ownerCookies
    });
    expect(favorites.json()).toMatchObject({
      total: 1,
      images: [
        {
          id: imageId,
          favorite: true,
          albumIds: [albumId],
          tagIds: [sourceTagId]
        }
      ]
    });
    expect(albumImages.json().total).toBe(1);
    expect(tagImages.json().total).toBe(1);

    const removedFromAlbum = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: ownerCookies,
      payload: {
        ids: [imageId],
        action: "remove-from-albums",
        albumIds: [albumId]
      }
    });
    expect(removedFromAlbum.json()).toEqual({
      updated: 1,
      albumIds: [albumId]
    });
    const emptyAlbumImages = await app.inject({
      method: "GET",
      url: `/albums/${albumId}/images`,
      cookies: ownerCookies
    });
    expect(emptyAlbumImages.json().total).toBe(0);
    const albumsAfterRemove = await app.inject({
      method: "GET",
      url: "/albums",
      cookies: ownerCookies
    });
    expect(albumsAfterRemove.json().albums[0].coverImageId).toBeUndefined();

    const addedBackToAlbum = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: ownerCookies,
      payload: {
        ids: [imageId],
        action: "add-to-albums",
        albumIds: [albumId]
      }
    });
    expect(addedBackToAlbum.json()).toEqual({
      updated: 1,
      albumIds: [albumId]
    });

    const albums = await app.inject({
      method: "GET",
      url: "/albums",
      cookies: ownerCookies
    });
    const tags = await app.inject({
      method: "GET",
      url: "/tags",
      cookies: ownerCookies
    });
    expect(albums.json().albums[0]).toMatchObject({
      id: albumId,
      imageCount: 1
    });
    expect(albums.json().albums[0].coverImageId).toBeUndefined();
    expect(tags.json().tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceTagId,
          imageCount: 1
        }),
        expect.objectContaining({
          id: targetTagId,
          imageCount: 0
        })
      ])
    );

    const merged = await app.inject({
      method: "POST",
      url: `/tags/${sourceTagId}/merge`,
      cookies: ownerCookies,
      payload: { targetTagId }
    });
    expect(merged.json()).toMatchObject({
      mergedImages: 1,
      tag: { id: targetTagId, imageCount: 1 }
    });
    const mergedDetail = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies: ownerCookies
    });
    expect(mergedDetail.json().image.tagIds).toEqual([targetTagId]);

    const member = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        displayName: "成员",
        email: "member@example.com",
        password: "Member-Secure-2026!"
      }
    });
    const memberCookie = member.cookies.find(
      (item) => item.name === "ou_session"
    )!;
    const memberCookies = { ou_session: memberCookie.value };
    const memberAlbum = await app.inject({
      method: "POST",
      url: "/albums",
      cookies: memberCookies,
      payload: { name: "成员相册" }
    });
    const memberTag = await app.inject({
      method: "POST",
      url: "/tags",
      cookies: memberCookies,
      payload: { name: "成员标签", color: "#2563EB" }
    });
    const crossRelation = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}/organization`,
      cookies: ownerCookies,
      payload: {
        albumIds: [memberAlbum.json().album.id],
        tagIds: [memberTag.json().tag.id]
      }
    });
    expect(crossRelation.statusCode).toBe(400);
    expect(crossRelation.json().error.code).toBe("INVALID_ALBUM_IDS");
    const crossAlbum = await app.inject({
      method: "GET",
      url: `/albums/${albumId}/images`,
      cookies: memberCookies
    });
    expect(crossAlbum.statusCode).toBe(404);

    const deletedAlbum = await app.inject({
      method: "DELETE",
      url: `/albums/${albumId}`,
      cookies: ownerCookies
    });
    const deletedTag = await app.inject({
      method: "DELETE",
      url: `/tags/${targetTagId}`,
      cookies: ownerCookies
    });
    expect(deletedAlbum.statusCode).toBe(204);
    expect(deletedTag.statusCode).toBe(204);
    const unlinked = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies: ownerCookies
    });
    expect(unlinked.json().image).toMatchObject({
      albumIds: [],
      tagIds: []
    });
  });

  it("restores and permanently deletes trashed image resources", async () => {
    let dataDirectory = "";
    const store = new AppStore(null);
    const app = await createTestApp({
      store,
      onDataDirectory: (directory) => {
        dataDirectory = directory;
      }
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 22,
        height: 12,
        channels: 3,
        background: { r: 210, g: 70, b: 90 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "trash-me.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;
    const transformed = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/transform`,
      cookies,
      payload: { action: "rotate-right" }
    });
    expect(transformed.statusCode).toBe(201);

    const album = await app.inject({
      method: "POST",
      url: "/albums",
      cookies,
      payload: {
        name: "待清理",
        coverImageId: imageId
      }
    });
    const albumId = album.json().album.id as string;
    await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}/organization`,
      cookies,
      payload: {
        favorite: true,
        albumIds: [albumId]
      }
    });
    const share = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/shares`,
      cookies,
      payload: {}
    });
    expect(share.statusCode).toBe(201);

    const trashed = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies,
      payload: { ids: [imageId], action: "trash" }
    });
    expect(trashed.json()).toEqual({ updated: 1 });
    const trashedVersionId = store
      .snapshot()
      .images.find((image) => image.id === imageId)!.versions[0]!.id;
    const hiddenCurrentFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/original`
    });
    const hiddenHistoricalFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/versions/${trashedVersionId}`,
      cookies
    });
    const unauthenticatedHistoricalFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/versions/${trashedVersionId}`
    });
    expect(hiddenCurrentFile.statusCode).toBe(404);
    expect(hiddenHistoricalFile.statusCode).toBe(404);
    expect(unauthenticatedHistoricalFile.statusCode).toBe(401);
    const trash = await app.inject({
      method: "GET",
      url: "/trash",
      cookies
    });
    expect(trash.json()).toMatchObject({
      total: 1,
      images: [
        {
          id: imageId,
          favorite: true,
          albumIds: [albumId]
        }
      ]
    });
    expect(trash.json().images[0].deletedAt).toBeTypeOf("string");

    const invalidDelete = await app.inject({
      method: "POST",
      url: "/trash/bulk",
      cookies,
      payload: {
        ids: ["missing-image"],
        action: "delete"
      }
    });
    expect(invalidDelete.statusCode).toBe(400);
    expect(invalidDelete.json().error.code).toBe("INVALID_TRASH_IDS");

    const restored = await app.inject({
      method: "POST",
      url: "/trash/bulk",
      cookies,
      payload: { ids: [imageId], action: "restore" }
    });
    expect(restored.json()).toEqual({ restored: 1 });
    const restoredFavorites = await app.inject({
      method: "GET",
      url: "/favorites",
      cookies
    });
    expect(restoredFavorites.json().total).toBe(1);

    await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies,
      payload: { ids: [imageId], action: "trash" }
    });
    const storedImage = store.snapshot().images.find(
      (image) => image.id === imageId
    )!;
    const keys = [
      ...new Set(
        storedImage.versions.flatMap((version) => [
          version.originalKey,
          version.thumbnailKey
        ])
      )
    ];
    await unlink(path.join(dataDirectory, "storage", keys[0]!));

    const permanentlyDeleted = await app.inject({
      method: "POST",
      url: "/trash/bulk",
      cookies,
      payload: { ids: [imageId], action: "delete" }
    });
    expect(permanentlyDeleted.statusCode).toBe(200);
    expect(permanentlyDeleted.json()).toEqual({ deleted: 1 });

    const state = store.snapshot();
    expect(state.images.some((image) => image.id === imageId)).toBe(false);
    expect(state.imageShares.some((item) => item.imageId === imageId)).toBe(
      false
    );
    expect(
      state.albums.find((item) => item.id === albumId)?.coverImageId
    ).toBeUndefined();
    for (const key of keys) {
      await expect(
        access(path.join(dataDirectory, "storage", key))
      ).rejects.toMatchObject({ code: "ENOENT" });
    }

    const missingFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/original`
    });
    const emptyTrash = await app.inject({
      method: "GET",
      url: "/trash",
      cookies
    });
    expect(missingFile.statusCode).toBe(404);
    expect(emptyTrash.json()).toEqual({ images: [], total: 0 });
  });

  it("protects infrastructure settings and encrypts remote credentials", async () => {
    delete process.env.OU_SECRET_KEY;
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { ...owner, registrationEnabled: true }
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };

    const missingEncryptionKey = await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: {
        storage: {
          s3: {
            endpoint: "https://s3.example.com",
            bucket: "images",
            region: "us-east-1",
            accessKeyId: "access-key",
            secretAccessKey: "plain-secret-value"
          }
        }
      }
    });
    expect(missingEncryptionKey.statusCode).toBe(400);
    expect(missingEncryptionKey.json().error.code).toBe(
      "SECRET_KEY_REQUIRED"
    );

    const missingSigningKey = await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: { delivery: { signedUrls: true } }
    });
    expect(missingSigningKey.statusCode).toBe(400);
    expect(missingSigningKey.json().error.code).toBe(
      "SECRET_KEY_REQUIRED"
    );

    process.env.OU_SECRET_KEY = "test-infrastructure-master-key";
    const invalidTemplate = await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: {
        delivery: {
          linkTemplate: "data:text/plain,{id}/{variant}"
        }
      }
    });
    expect(invalidTemplate.statusCode).toBe(400);
    expect(invalidTemplate.json().error.code).toBe(
      "INVALID_LINK_TEMPLATE"
    );

    const saved = await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: {
        storage: {
          s3: {
            endpoint: "https://s3.example.com",
            bucket: "images",
            region: "us-east-1",
            accessKeyId: "access-key",
            secretAccessKey: "plain-secret-value",
            publicBaseUrl: "https://cdn.example.com",
            pathStyle: true
          }
        },
        delivery: {
          customDomain: "https://img.example.com/",
          linkTemplate: "{domain}/api/files/{id}/{variant}",
          allowedReferers: ["https://app.example.com/gallery"],
          hotlinkEnabled: true,
          allowEmptyReferer: false,
          signedUrls: true,
          signedUrlTtlSeconds: 600
        },
        backup: {
          scheduleEnabled: true,
          intervalHours: 12,
          retentionCount: 3
        }
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      storage: {
        active: "local",
        s3: {
          endpoint: "https://s3.example.com",
          bucket: "images",
          secretConfigured: true
        }
      },
      delivery: {
        customDomain: "https://img.example.com",
        allowedReferers: ["https://app.example.com"],
        signedUrls: true
      },
      backup: {
        scheduleEnabled: true,
        intervalHours: 12,
        retentionCount: 3
      }
    });
    expect(JSON.stringify(saved.json())).not.toContain("plain-secret-value");
    expect(JSON.stringify(saved.json())).not.toContain(
      "secretAccessKeyCiphertext"
    );
    const encrypted = store.snapshot().storageSettings.s3
      ?.secretAccessKeyCiphertext;
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("plain-secret-value");

    const localTest = await app.inject({
      method: "POST",
      url: "/storage/test",
      cookies,
      payload: { provider: "local" }
    });
    const health = await app.inject({
      method: "GET",
      url: "/storage/health",
      cookies
    });
    expect(localTest.json()).toMatchObject({
      provider: "local",
      status: "ok"
    });
    expect(health.json()).toMatchObject({
      active: "local",
      providers: {
        local: { status: "ok" },
        s3: { status: "configured" },
        r2: { status: "unconfigured" }
      }
    });

    const unsupportedActive = await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: { storage: { active: "s3" } }
    });
    expect(unsupportedActive.statusCode).toBe(400);
    expect(unsupportedActive.json().error.code).toBe(
      "REMOTE_ACTIVE_UNSUPPORTED"
    );

    const member = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        displayName: "普通成员",
        email: "infra-member@example.com",
        password: "Member-Secure-2026!"
      }
    });
    const memberCookie = member.cookies.find(
      (item) => item.name === "ou_session"
    )!;
    const denied = await app.inject({
      method: "GET",
      url: "/storage/settings",
      cookies: { ou_session: memberCookie.value }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("OWNER_REQUIRED");
  });

  it("tests SigV4 storage and records real local to remote migrations", async () => {
    process.env.OU_SECRET_KEY = "migration-master-key";
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 10,
        height: 8,
        channels: 3,
        background: { r: 30, g: 130, b: 230 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "migrate.png",
      contentType: "image/png"
    });
    await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: {
        storage: {
          s3: {
            endpoint: "https://s3.example.com",
            bucket: "images",
            region: "us-east-1",
            accessKeyId: "access-key",
            secretAccessKey: "migration-secret",
            pathStyle: true
          }
        }
      }
    });

    const requests: Array<{
      method: string;
      url: string;
      authorization: string;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({
          method: init?.method ?? "GET",
          url: input.toString(),
          authorization: headers.get("authorization") ?? ""
        });
        return new Response(null, { status: 200 });
      })
    );

    const tested = await app.inject({
      method: "POST",
      url: "/storage/test",
      cookies,
      payload: { provider: "s3" }
    });
    expect(tested.statusCode).toBe(200);
    expect(requests[0]).toMatchObject({
      method: "HEAD",
      url: "https://s3.example.com/images"
    });
    expect(requests[0]!.authorization).toContain("AWS4-HMAC-SHA256");

    const migrated = await app.inject({
      method: "POST",
      url: "/storage/migrations",
      cookies,
      payload: { source: "local", target: "s3" }
    });
    expect(migrated.statusCode).toBe(201);
    expect(migrated.json().migration).toMatchObject({
      source: "local",
      target: "s3",
      status: "completed",
      total: 2,
      completed: 2,
      failed: 0
    });
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
      2
    );

    const unsupported = await app.inject({
      method: "POST",
      url: "/storage/migrations",
      cookies,
      payload: { source: "s3", target: "local" }
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error.code).toBe(
      "UNSUPPORTED_STORAGE_MIGRATION"
    );
    const migrations = await app.inject({
      method: "GET",
      url: "/storage/migrations",
      cookies
    });
    expect(migrations.json().migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({
          source: "s3",
          target: "local",
          status: "failed"
        })
      ])
    );
  });

  it("applies custom delivery, hotlink and signed URL settings", async () => {
    process.env.OU_SECRET_KEY = "delivery-master-key";
    let timestamp = new Date("2026-07-10T12:00:00.000Z");
    const app = await createTestApp({
      now: () => new Date(timestamp)
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 9,
        height: 7,
        channels: 3,
        background: { r: 220, g: 120, b: 50 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "delivery.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;
    await app.inject({
      method: "PATCH",
      url: "/storage/settings",
      cookies,
      payload: {
        delivery: {
          customDomain: "https://cdn.example.com",
          linkTemplate: "{domain}/api/files/{id}/{variant}",
          hotlinkEnabled: true,
          allowedReferers: ["https://app.example.com"],
          allowEmptyReferer: false,
          signedUrls: true,
          signedUrlTtlSeconds: 60
        }
      }
    });

    const library = await app.inject({
      method: "GET",
      url: "/uploads",
      cookies
    });
    const originalUrl = library.json().images[0].originalUrl as string;
    const parsed = new URL(originalUrl);
    expect(parsed.origin).toBe("https://cdn.example.com");
    expect(parsed.pathname).toBe(`/api/files/${imageId}/original`);
    expect(parsed.searchParams.get("expires")).toBe(
      String(Math.floor(timestamp.getTime() / 1000) + 60)
    );
    expect(parsed.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    const internalUrl =
      parsed.pathname.replace(/^\/api/, "") + parsed.search;

    const direct = await app.inject({
      method: "GET",
      url: internalUrl
    });
    expect(direct.statusCode).toBe(403);
    expect(direct.json().error.code).toBe("HOTLINK_BLOCKED");

    const wrongReferer = await app.inject({
      method: "GET",
      url: internalUrl,
      headers: { referer: "https://evil.example.com/page" }
    });
    expect(wrongReferer.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "GET",
      url: internalUrl,
      headers: { referer: "https://app.example.com/gallery" }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.rawPayload.equals(png)).toBe(true);

    const badSignature = new URL(originalUrl);
    badSignature.searchParams.set("signature", "0".repeat(64));
    const rejectedSignature = await app.inject({
      method: "GET",
      url:
        badSignature.pathname.replace(/^\/api/, "") +
        badSignature.search,
      headers: { referer: "https://app.example.com" }
    });
    expect(rejectedSignature.statusCode).toBe(403);
    expect(rejectedSignature.json().error.code).toBe(
      "INVALID_FILE_SIGNATURE"
    );

    timestamp = new Date("2026-07-10T12:01:01.000Z");
    const expired = await app.inject({
      method: "GET",
      url: internalUrl,
      headers: { referer: "https://app.example.com" }
    });
    expect(expired.statusCode).toBe(403);
    expect(expired.json().error.code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("creates, validates, restores and deletes safe backup archives", async () => {
    let dataDirectory = "";
    const store = new AppStore(null);
    const originalStoreUpdate = store.update.bind(store);
    let pauseNextUpdate = false;
    let failNextUpdate = false;
    let enteredPausedUpdate: (() => void) | undefined;
    let continuePausedUpdate: (() => void) | undefined;
    store.update = (async (mutate: Parameters<AppStore["update"]>[0]) => {
      if (pauseNextUpdate) {
        pauseNextUpdate = false;
        enteredPausedUpdate?.();
        await new Promise<void>((resolve) => {
          continuePausedUpdate = resolve;
        });
      }
      if (failNextUpdate) {
        failNextUpdate = false;
        throw new Error("simulated persistence failure");
      }
      return originalStoreUpdate(mutate);
    }) as AppStore["update"];
    const app = await createTestApp({
      store,
      onDataDirectory: (directory) => {
        dataDirectory = directory;
      }
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookies = { ou_session: cookie.value };
    const png = await sharp({
      create: {
        width: 13,
        height: 11,
        channels: 3,
        background: { r: 90, g: 180, b: 120 }
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "backup-original.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;

    const created = await app.inject({
      method: "POST",
      url: "/backups",
      cookies
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().backup).toMatchObject({
      status: "completed",
      fileCount: 2
    });
    const backupId = created.json().backup.id as string;
    const downloaded = await app.inject({
      method: "GET",
      url: `/backups/${backupId}/download`,
      cookies
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("application/gzip");
    const envelope = JSON.parse(
      gunzipSync(downloaded.rawPayload).toString("utf8")
    );
    expect(envelope).toMatchObject({
      format: "ou-image-backup-v1",
      state: { schemaVersion: 7 }
    });
    expect(envelope.manifest.files).toHaveLength(2);

    const unauthenticatedWrite = await rawInject(app, {
      method: "POST",
      url: "/backups"
    });
    expect(unauthenticatedWrite.statusCode).toBe(401);
    const invalidWrite = await app.inject({
      method: "POST",
      url: "/storage/migrations",
      cookies,
      payload: { source: "local" }
    });
    expect(invalidWrite.statusCode).toBe(400);
    const failedHandlerWrite = await app.inject({
      method: "PATCH",
      url: "/uploads/missing",
      cookies,
      payload: { name: "missing.png" }
    });
    expect(failedHandlerWrite.statusCode).toBe(404);

    await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "changed.png" }
    });
    const originalKey = store.snapshot().images[0]!.originalKey;
    await unlink(path.join(dataDirectory, "storage", originalKey));

    const pausedUpdateEntered = new Promise<void>((resolve) => {
      enteredPausedUpdate = resolve;
    });
    pauseNextUpdate = true;
    const restorePromise = Promise.resolve(app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    }));
    await pausedUpdateEntered;
    const blockedWrite = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "blocked-during-restore.png" }
    });
    const blockedRestore = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
    const notReady = await app.inject({
      method: "GET",
      url: "/health/ready"
    });
    expect(blockedWrite.statusCode).toBe(503);
    expect(blockedWrite.json().error.code).toBe("RESTORE_MAINTENANCE");
    expect(blockedRestore.statusCode).toBe(503);
    expect(blockedRestore.json().error.code).toBe(
      "RESTORE_MAINTENANCE"
    );
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({
      status: "not-ready",
      reason: "restore-maintenance"
    });
    continuePausedUpdate?.();
    const restored = await restorePromise;
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      restored: true,
      files: 2
    });
    const detail = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies
    });
    const restoredFile = await app.inject({
      method: "GET",
      url: `/files/${imageId}/original`
    });
    expect(detail.json().image.name).toBe("backup-original.png");
    expect(restoredFile.statusCode).toBe(200);
    expect(restoredFile.rawPayload.equals(png)).toBe(true);

    const sentinelPath = path.join(
      dataDirectory,
      "storage",
      "online-sentinel.txt"
    );
    await writeFile(sentinelPath, "online-only");
    const beforeFailedSwitch = store.snapshot();
    failNextUpdate = true;
    const failedSwitch = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
    expect(failedSwitch.statusCode).toBe(500);
    expect(await readFile(sentinelPath, "utf8")).toBe("online-only");
    expect(store.snapshot()).toEqual(beforeFailedSwitch);
    expect(
      (await readdir(dataDirectory)).filter(
        (name) =>
          name.startsWith(".restore-staging-") ||
          name.startsWith(".restore-rollback-")
      )
    ).toEqual([]);

    const onlineRename = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "online-safe.png" }
    });
    expect(onlineRename.statusCode).toBe(200);
    const backup = store.snapshot().backups.find(
      (item) => item.id === backupId
    )!;
    const archivePath = path.join(dataDirectory, backup.archiveKey);
    const malicious = JSON.parse(
      gunzipSync(await readFile(archivePath)).toString("utf8")
    );
    malicious.files[0].path = "../escape";
    malicious.manifest.files[0].path = "../escape";
    const maliciousArchive = gzipSync(Buffer.from(JSON.stringify(malicious)));
    await writeFile(archivePath, maliciousArchive);
    await store.update((state) => {
      const current = state.backups.find((item) => item.id === backupId)!;
      current.checksum = createHash("sha256")
        .update(maliciousArchive)
        .digest("hex");
      current.size = maliciousArchive.byteLength;
    });
    const traversal = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error.code).toBe("INVALID_BACKUP_PATH");
    await expect(
      access(path.join(dataDirectory, "escape"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    const afterTraversal = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      cookies
    });
    expect(afterTraversal.json().image.name).toBe("online-safe.png");
    expect(
      (await readdir(dataDirectory)).filter(
        (name) =>
          name.startsWith(".restore-staging-") ||
          name.startsWith(".restore-rollback-")
      )
    ).toEqual([]);

    const oversized = JSON.parse(
      gunzipSync(downloaded.rawPayload).toString("utf8")
    );
    oversized.manifest.files[0].size = 24 * 1024 * 1024 + 1;
    const oversizedArchive = gzipSync(
      Buffer.from(JSON.stringify(oversized))
    );
    await writeFile(archivePath, oversizedArchive);
    await store.update((state) => {
      const current = state.backups.find((item) => item.id === backupId)!;
      current.checksum = createHash("sha256")
        .update(oversizedArchive)
        .digest("hex");
      current.size = oversizedArchive.byteLength;
    });
    const overLimit = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().error.code).toBe("BACKUP_LIMIT_EXCEEDED");
    const afterFailedRestoreWrite = await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "maintenance-released.png" }
    });
    expect(afterFailedRestoreWrite.statusCode).toBe(200);

    const removed = await app.inject({
      method: "DELETE",
      url: `/backups/${backupId}`,
      cookies
    });
    const backups = await app.inject({
      method: "GET",
      url: "/backups",
      cookies
    });
    expect(removed.statusCode).toBe(204);
    expect(backups.json()).toEqual({ backups: [] });
  });

  it("enforces browser origins while allowing originless bearer automation", async () => {
    const app = await createTestApp();
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const cookieHeader = `ou_session=${cookie.value}`;

    const missing = await rawInject(app, {
      method: "PATCH",
      url: "/me",
      headers: { cookie: cookieHeader },
      payload: { theme: "dark" }
    });
    const mismatched = await rawInject(app, {
      method: "PATCH",
      url: "/me",
      headers: {
        cookie: cookieHeader,
        origin: "https://evil.example"
      },
      payload: { theme: "dark" }
    });
    const valid = await rawInject(app, {
      method: "PATCH",
      url: "/me",
      headers: {
        cookie: cookieHeader,
        origin: "http://localhost:3000"
      },
      payload: { theme: "dark" }
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe("INVALID_ORIGIN");
    expect(mismatched.statusCode).toBe(403);
    expect(valid.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie.value },
      payload: {
        name: "automation",
        scopes: ["organization:write"]
      }
    });
    const bearer = created.json().value as string;
    const bearerWrite = await rawInject(app, {
      method: "POST",
      url: "/tags",
      headers: { authorization: `Bearer ${bearer}` },
      payload: { name: "CI", color: "#112233" }
    });
    expect(bearerWrite.statusCode).toBe(201);
  });

  it("redacts capability URLs and centrally sanitizes audit metadata", () => {
    expect(
      redactCapabilityUrl(
        "/shares/super-secret-token/access?x=1&next=/invites/another-token"
      )
    ).toBe(
      "/shares/[REDACTED]/access?x=1&next=/invites/[REDACTED]"
    );
    const sanitized = sanitizeAuditMetadata({
      operation: "member.update",
      token: "never-store-me",
      recoveryCode: "never-store-me",
      description: "x".repeat(500),
      count: 2
    });
    expect(sanitized).toEqual({
      operation: "member.update",
      description: "x".repeat(200),
      count: 2
    });
  });

  it("isolates workspace resources and enforces the RBAC matrix", async () => {
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const ownerCookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const firstWorkspace = await app.inject({
      method: "POST",
      url: "/workspaces",
      cookies: { ou_session: ownerCookie },
      payload: { name: "Alpha" }
    });
    const secondWorkspace = await app.inject({
      method: "POST",
      url: "/workspaces",
      cookies: { ou_session: ownerCookie },
      payload: { name: "Beta" }
    });
    const alphaId = firstWorkspace.json().workspace.id as string;
    const betaId = secondWorkspace.json().workspace.id as string;
    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: "#778899"
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "beta.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { ...form.getHeaders(), "x-workspace-id": betaId },
      cookies: { ou_session: ownerCookie },
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;
    const crossWorkspace = await app.inject({
      method: "GET",
      url: `/uploads/${imageId}`,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie }
    });
    expect(crossWorkspace.statusCode).toBe(404);

    const timestamp = new Date().toISOString();
    const passwordHash = await hashPassword("Secure-Password-2026!");
    const viewerId = randomUUID();
    const editorId = randomUUID();
    const adminId = randomUUID();
    const secondAdminId = randomUUID();
    const sessions = [
      ["viewer-token", viewerId, "viewer"],
      ["editor-token", editorId, "editor"],
      ["admin-token", adminId, "admin"],
      ["admin-two-token", secondAdminId, "admin"]
    ] as const;
    await store.update((state) => {
      for (const [token, userId, role] of sessions) {
        state.users.push({
          id: userId,
          email: `${role}-${userId}@example.com`,
          displayName: role,
          passwordHash,
          role: "member",
          theme: "system",
          onboardingCompleted: true,
          failedLoginCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        state.workspaceMembers.push({
          id: randomUUID(),
          workspaceId: alphaId,
          userId,
          role,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        state.sessions.push({
          id: randomUUID(),
          userId,
          tokenHash: hashOpaqueToken(token),
          createdAt: timestamp,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          lastSeenAt: timestamp
        });
      }
    });

    for (const token of ["viewer-token", "editor-token"]) {
      const denied = await app.inject({
        method: "GET",
        url: `/workspaces/${alphaId}/members`,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: token }
      });
      expect(denied.statusCode).toBe(403);
    }
    const ownerId = store.snapshot().workspaces.find(
      (item) => item.id === alphaId
    )!.ownerUserId;
    for (const targetId of [ownerId, secondAdminId]) {
      const changed = await app.inject({
        method: "PATCH",
        url: `/workspaces/${alphaId}/members/${targetId}`,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: "admin-token" },
        payload: { role: "viewer" }
      });
      const removed = await app.inject({
        method: "DELETE",
        url: `/workspaces/${alphaId}/members/${targetId}`,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: "admin-token" }
      });
      expect(changed.statusCode).toBe(403);
      expect(removed.statusCode).toBe(403);
    }
    const selfDowngrade = await app.inject({
      method: "PATCH",
      url: `/workspaces/${alphaId}/members/${ownerId}`,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie },
      payload: { role: "admin" }
    });
    expect(selfDowngrade.statusCode).toBe(400);
    expect(selfDowngrade.json().error.code).toBe("SOLE_OWNER_REQUIRED");
  });

  it("returns 404 for management IDORs and audits critical revocations", async () => {
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: { ...owner, registrationEnabled: true }
    });
    const ownerCookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const alpha = await app.inject({
      method: "POST",
      url: "/workspaces",
      cookies: { ou_session: ownerCookie },
      payload: { name: "Audit Alpha" }
    });
    const beta = await app.inject({
      method: "POST",
      url: "/workspaces",
      cookies: { ou_session: ownerCookie },
      payload: { name: "Audit Beta" }
    });
    const disposable = await app.inject({
      method: "POST",
      url: "/workspaces",
      cookies: { ou_session: ownerCookie },
      payload: { name: "Disposable" }
    });
    const alphaId = alpha.json().workspace.id as string;
    const betaId = beta.json().workspace.id as string;
    const disposableId = disposable.json().workspace.id as string;

    const acceptedInvite = await app.inject({
      method: "POST",
      url: `/workspaces/${alphaId}/invitations`,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie },
      payload: { email: "invitee@example.com", role: "viewer" }
    });
    const invitee = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        displayName: "Invitee",
        email: "invitee@example.com",
        password: "Invitee-Password-2026!"
      }
    });
    const inviteeCookie = invitee.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const accepted = await app.inject({
      method: "POST",
      url: `/invites/${acceptedInvite.json().token}/accept`,
      cookies: { ou_session: inviteeCookie }
    });
    expect(accepted.statusCode).toBe(200);

    const revokedInvite = await app.inject({
      method: "POST",
      url: `/workspaces/${alphaId}/invitations`,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie },
      payload: { email: "revoked@example.com", role: "editor" }
    });
    const revokeInvite = await app.inject({
      method: "DELETE",
      url:
        `/workspaces/${alphaId}/invitations/` +
        revokedInvite.json().invitation.id,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie }
    });
    expect(revokeInvite.statusCode).toBe(204);

    const alphaToken = await app.inject({
      method: "POST",
      url: "/api-tokens",
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie },
      payload: { name: "alpha-token", scopes: ["images:read"] }
    });
    const revokeToken = await app.inject({
      method: "DELETE",
      url: `/api-tokens/${alphaToken.json().token.id}`,
      headers: { "x-workspace-id": alphaId },
      cookies: { ou_session: ownerCookie }
    });
    expect(revokeToken.statusCode).toBe(204);

    const secondLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: owner.email, password: owner.password }
    });
    expect(secondLogin.statusCode).toBe(200);
    const sessionList = await app.inject({
      method: "GET",
      url: "/auth/sessions",
      cookies: { ou_session: ownerCookie }
    });
    const otherSessionId = sessionList
      .json()
      .sessions.find((session: { current: boolean }) => !session.current).id;
    const revokeSession = await app.inject({
      method: "DELETE",
      url: `/auth/sessions/${otherSessionId}`,
      cookies: { ou_session: ownerCookie }
    });
    expect(revokeSession.statusCode).toBe(204);
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: owner.email, password: owner.password }
    });
    const revokeOthers = await app.inject({
      method: "DELETE",
      url: "/auth/sessions",
      cookies: { ou_session: ownerCookie }
    });
    expect(revokeOthers.statusCode).toBe(204);

    const foreignUserId = randomUUID();
    const foreignSessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const passwordHash = await hashPassword("Foreign-Password-2026!");
    await store.update((state) => {
      state.users.push({
        id: foreignUserId,
        email: "foreign@example.com",
        displayName: "Foreign",
        passwordHash,
        role: "member",
        theme: "system",
        onboardingCompleted: true,
        failedLoginCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      state.workspaceMembers.push({
        id: randomUUID(),
        workspaceId: betaId,
        userId: foreignUserId,
        role: "viewer",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      state.sessions.push({
        id: foreignSessionId,
        userId: foreignUserId,
        tokenHash: hashOpaqueToken("foreign-session"),
        createdAt: timestamp,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastSeenAt: timestamp
      });
    });
    const betaInvite = await app.inject({
      method: "POST",
      url: `/workspaces/${betaId}/invitations`,
      headers: { "x-workspace-id": betaId },
      cookies: { ou_session: ownerCookie },
      payload: { email: "beta@example.com", role: "viewer" }
    });
    const betaToken = await app.inject({
      method: "POST",
      url: "/api-tokens",
      headers: { "x-workspace-id": betaId },
      cookies: { ou_session: ownerCookie },
      payload: { name: "beta-token", scopes: ["images:read"] }
    });
    const idorResponses = await Promise.all([
      app.inject({
        method: "DELETE",
        url: `/workspaces/${alphaId}/members/${foreignUserId}`,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: ownerCookie }
      }),
      app.inject({
        method: "DELETE",
        url:
          `/workspaces/${alphaId}/invitations/` +
          betaInvite.json().invitation.id,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: ownerCookie }
      }),
      app.inject({
        method: "DELETE",
        url: `/api-tokens/${betaToken.json().token.id}`,
        headers: { "x-workspace-id": alphaId },
        cookies: { ou_session: ownerCookie }
      }),
      app.inject({
        method: "DELETE",
        url: `/auth/sessions/${foreignSessionId}`,
        cookies: { ou_session: ownerCookie }
      })
    ]);
    expect(idorResponses.map((response) => response.statusCode)).toEqual([
      404,
      404,
      404,
      404
    ]);

    const deleteWorkspace = await app.inject({
      method: "DELETE",
      url: `/workspaces/${disposableId}`,
      headers: { "x-workspace-id": disposableId },
      cookies: { ou_session: ownerCookie }
    });
    expect(deleteWorkspace.statusCode).toBe(204);
    const events = store.snapshot().auditEvents;
    const actions = new Set(events.map((event) => event.action));
    for (const action of [
      "workspace.delete",
      "invitation.revoke",
      "invitation.accept",
      "api_token.revoke",
      "session.revoke",
      "session.revoke_others"
    ]) {
      expect(actions.has(action)).toBe(true);
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(acceptedInvite.json().token);
    expect(serialized).not.toContain(alphaToken.json().value);
    expect(serialized).not.toContain(owner.password);
  });

  it("persists workspace and site settings and enforces upload processing controls", async () => {
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const workspaceId = `personal-${store.snapshot().users[0]!.id}`;
    const updated = await app.inject({
      method: "PATCH",
      url: "/workspace/settings",
      cookies: { ou_session: cookie },
      payload: {
        uploadMaxBytes: 1024 * 1024,
        allowedFormats: ["jpeg"],
        processingQuality: 35,
        thumbnailWidth: 64,
        timezone: "UTC",
        locale: "en-US",
        defaultAppearance: "dark"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings).toEqual({
      uploadMaxBytes: 1024 * 1024,
      allowedFormats: ["jpeg"],
      processingQuality: 35,
      thumbnailWidth: 64,
      timezone: "UTC",
      locale: "en-US",
      defaultAppearance: "dark",
      effectiveUploadMaxBytes: 1024 * 1024
    });

    const tooLarge = new FormData();
    tooLarge.append("file", Buffer.alloc(1024 * 1024 + 1), {
      filename: "too-large.png",
      contentType: "image/png"
    });
    const rejectedSize = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: tooLarge.getHeaders(),
      cookies: { ou_session: cookie },
      payload: tooLarge.getBuffer()
    });
    expect(rejectedSize.statusCode).toBe(413);
    expect(rejectedSize.json().error.code).toBe("FILE_TOO_LARGE");

    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: "#225588"
      }
    })
      .png()
      .toBuffer();
    const pngForm = new FormData();
    pngForm.append("file", png, {
      filename: "blocked.png",
      contentType: "image/png"
    });
    const rejectedFormat = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: pngForm.getHeaders(),
      cookies: { ou_session: cookie },
      payload: pngForm.getBuffer()
    });
    expect(rejectedFormat.statusCode).toBe(415);
    expect(rejectedFormat.json().error.code).toBe("FORMAT_NOT_ALLOWED");

    const jpeg = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: "#884422"
      }
    })
      .jpeg()
      .toBuffer();
    const jpegForm = new FormData();
    jpegForm.append("file", jpeg, {
      filename: "allowed.jpg",
      contentType: "image/jpeg"
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: jpegForm.getHeaders(),
      cookies: { ou_session: cookie },
      payload: jpegForm.getBuffer()
    });
    expect(accepted.statusCode).toBe(201);
    const thumbnail = await app.inject({
      method: "GET",
      url: `/files/${accepted.json().image.id}/thumbnail`
    });
    expect((await sharp(thumbnail.rawPayload).metadata()).width).toBe(64);

    const viewerId = randomUUID();
    await store.update((state) => {
      state.users.push({
        id: viewerId,
        email: "settings-viewer@example.com",
        displayName: "Settings Viewer",
        passwordHash: "unused",
        role: "member",
        theme: "system",
        onboardingCompleted: true,
        failedLoginCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      state.workspaceMembers.push({
        id: randomUUID(),
        workspaceId,
        userId: viewerId,
        role: "viewer",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      state.sessions.push({
        id: randomUUID(),
        userId: viewerId,
        tokenHash: hashOpaqueToken("settings-viewer-session"),
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        expiresAt: "2030-01-01T00:00:00.000Z"
      });
    });
    const viewerRead = await app.inject({
      method: "GET",
      url: "/workspace/settings",
      headers: { "x-workspace-id": workspaceId },
      cookies: { ou_session: "settings-viewer-session" }
    });
    const viewerWrite = await app.inject({
      method: "PATCH",
      url: "/workspace/settings",
      headers: { "x-workspace-id": workspaceId },
      cookies: { ou_session: "settings-viewer-session" },
      payload: { locale: "zh-CN" }
    });
    expect(viewerRead.statusCode).toBe(200);
    expect(viewerWrite.statusCode).toBe(403);

    const site = await app.inject({
      method: "PATCH",
      url: "/site/settings",
      cookies: { ou_session: cookie },
      payload: {
        siteName: "OU Gallery",
        siteDescription: "A private image service",
        registrationEnabled: true
      }
    });
    expect(site.json().settings).toMatchObject({
      siteName: "OU Gallery",
      siteDescription: "A private image service",
      siteLogoUrl: "/brand/ou-image-hosting-logo.jpg",
      registrationEnabled: true,
      publicUploadEnabled: true,
      publicUploadRequiresLogin: false,
      publicGalleryEnabled: true,
      publicUploadDefaultPublic: true,
      publicHeroTitle: "把图片放进来，剩下的交给队列。",
      loginHeroTitle: "让图片管理，从第一眼就舒服。"
    });
    const viewerSite = await app.inject({
      method: "GET",
      url: "/site/settings",
      headers: { "x-workspace-id": workspaceId },
      cookies: { ou_session: "settings-viewer-session" }
    });
    expect(viewerSite.statusCode).toBe(403);

    const gated = await app.inject({
      method: "PATCH",
      url: "/site/settings",
      cookies: { ou_session: cookie },
      payload: {
        publicUploadRequiresLogin: true
      }
    });
    expect(gated.json().settings).toMatchObject({
      publicUploadEnabled: true,
      publicUploadRequiresLogin: true
    });
    const publicConfig = await app.inject({
      method: "GET",
      url: "/public/config"
    });
    expect(publicConfig.json().site).toMatchObject({
      publicUploadEnabled: true,
      publicUploadRequiresLogin: true
    });

    const gatedForm = new FormData();
    gatedForm.append("file", jpeg, {
      filename: "visitor-blocked.jpg",
      contentType: "image/jpeg"
    });
    const blockedVisitorUpload = await app.inject({
      method: "POST",
      url: "/public/uploads",
      headers: gatedForm.getHeaders(),
      payload: gatedForm.getBuffer()
    });
    expect(blockedVisitorUpload.statusCode).toBe(401);
    expect(blockedVisitorUpload.json().error.code).toBe(
      "LOGIN_REQUIRED_FOR_PUBLIC_UPLOAD"
    );

    const loggedInForm = new FormData();
    loggedInForm.append("file", jpeg, {
      filename: "logged-in-public.jpg",
      contentType: "image/jpeg"
    });
    const loggedInPublicUpload = await app.inject({
      method: "POST",
      url: "/public/uploads?publicVisible=false",
      headers: loggedInForm.getHeaders(),
      cookies: { ou_session: cookie },
      payload: loggedInForm.getBuffer()
    });
    expect(loggedInPublicUpload.statusCode).toBeLessThan(300);
  });

  it("returns workspace-isolated analytics from real uploads and daily share aggregates", async () => {
    const timestamp = new Date("2026-07-11T12:00:00.000Z");
    const store = new AppStore(null);
    const app = await createTestApp({ store, now: () => timestamp });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const workspaceId = `personal-${store.snapshot().users[0]!.id}`;
    const png = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 3,
        background: "#116699"
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "analytics.png",
      contentType: "image/png"
    });
    const upload = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies: { ou_session: cookie },
      payload: form.getBuffer()
    });
    const imageId = upload.json().image.id as string;
    const duplicateForm = new FormData();
    duplicateForm.append("file", png, {
      filename: "analytics-copy.png",
      contentType: "image/png"
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: duplicateForm.getHeaders(),
      cookies: { ou_session: cookie },
      payload: duplicateForm.getBuffer()
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicate).toBe(true);
    const share = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/shares`,
      cookies: { ou_session: cookie },
      payload: {}
    });
    const shareId = share.json().share.id as string;
    const shareToken = share.json().token as string;
    await store.update((state) => {
      state.imageShares.find((item) => item.id === shareId)!.accessCount = 3;
      state.analyticsDaily.push({
        workspaceId: "foreign-workspace",
        date: "2026-07-11",
        uploads: 99,
        uploadedLogicalBytes: 99,
        shareViews: 99,
        imageShareViews: { foreign: 99 }
      });
    });
    for (let index = 0; index < 2; index += 1) {
      const accessed = await app.inject({
        method: "POST",
        url: `/shares/${shareToken}/access`,
        payload: {}
      });
      expect(accessed.statusCode).toBe(200);
    }
    const analytics = await app.inject({
      method: "GET",
      url: "/analytics?range=7d",
      cookies: { ou_session: cookie }
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().series).toHaveLength(7);
    expect(analytics.json().summary).toMatchObject({
      imageCount: 1,
      uploadCount: 1,
      shareViews: 2,
      unattributedShareViews: 3
    });
    expect(
      analytics.json().summary.deduplicatedOriginalBytes
    ).toBeGreaterThan(0);
    expect(analytics.json().series.at(-1)).toMatchObject({
      date: "2026-07-11",
      uploads: 1,
      shareViews: 2
    });
    expect(analytics.json().formatDistribution).toEqual([
      {
        format: "png",
        count: 1,
        activeCurrentVersionBytes: png.byteLength
      }
    ]);
    expect(analytics.json().topImages[0]).toMatchObject({
      id: imageId,
      shareViews: 2
    });
    expect(analytics.json().dataCoverage.shareViews).toMatchObject({
      status: "partial",
      unattributedCount: 3
    });
    expect(analytics.json().dataCoverage.uploads).toMatchObject({
      status: "complete"
    });
    expect(
      analytics.json().dataCoverage.shareViews.trackingStartedAt
    ).toBeTruthy();
    expect(
      store.snapshot().analyticsDaily.filter(
        (item) => item.workspaceId === workspaceId
      )
    ).toHaveLength(1);
    expect(
      store.snapshot().analyticsDaily.find(
        (item) => item.workspaceId === workspaceId
      )
    ).toMatchObject({
      uploads: 1,
      uploadedLogicalBytes: png.byteLength
    });

    const converted = await app.inject({
      method: "POST",
      url: `/uploads/${imageId}/transform`,
      cookies: { ou_session: cookie },
      payload: {
        action: "convert-format",
        format: "webp",
        quality: 70
      }
    });
    expect(converted.statusCode).toBe(201);
    const trashed = await app.inject({
      method: "POST",
      url: "/uploads/bulk",
      cookies: { ou_session: cookie },
      payload: { ids: [imageId], action: "trash" }
    });
    expect(trashed.json()).toEqual({ updated: 1 });
    const immutable = await app.inject({
      method: "GET",
      url: "/analytics?range=7d",
      cookies: { ou_session: cookie }
    });
    expect(immutable.json().summary).toMatchObject({
      imageCount: 0,
      uploadCount: 1
    });
    expect(immutable.json().series.at(-1)).toMatchObject({
      uploads: 1,
      uploadedLogicalBytes: png.byteLength
    });
    const restored = await app.inject({
      method: "POST",
      url: "/trash/bulk",
      cookies: { ou_session: cookie },
      payload: { ids: [imageId], action: "restore" }
    });
    expect(restored.json()).toEqual({ restored: 1 });
    const afterRestore = await app.inject({
      method: "GET",
      url: "/analytics?range=7d",
      cookies: { ou_session: cookie }
    });
    expect(afterRestore.json().summary).toMatchObject({
      imageCount: 1,
      uploadCount: 1
    });
    expect(afterRestore.json().series.at(-1)).toMatchObject({
      uploads: 1,
      uploadedLogicalBytes: png.byteLength
    });

    const analyticsToken = await app.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: { name: "analytics-only", scopes: ["analytics:read"] }
    });
    const tokenRead = await rawInject(app, {
      method: "GET",
      url: "/analytics?range=7d",
      headers: {
        authorization: `Bearer ${analyticsToken.json().value}`
      }
    });
    expect(tokenRead.statusCode).toBe(200);
    const imagesToken = await app.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: { name: "images-only-analytics", scopes: ["images:read"] }
    });
    const denied = await rawInject(app, {
      method: "GET",
      url: "/analytics?range=7d",
      headers: { authorization: `Bearer ${imagesToken.json().value}` }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("TOKEN_SCOPE_DENIED");
  });

  it("keeps system status reads pure and performs owner-only bounded checks", async () => {
    let timestamp = new Date("2026-07-11T12:00:00.000Z");
    let dataDirectory = "";
    const store = new AppStore(null);
    const app = await createTestApp({
      store,
      now: () => timestamp,
      onDataDirectory: (value) => {
        dataDirectory = value;
      }
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const beforeInitialRead = store.snapshot();
    const initial = await app.inject({
      method: "GET",
      url: "/system/status",
      cookies: { ou_session: cookie }
    });
    expect(initial.json()).toMatchObject({
      checkedAt: null,
      overall: "unknown"
    });
    expect(initial.json().services).toHaveLength(7);
    expect(store.snapshot()).toEqual(beforeInitialRead);

    const checked = await app.inject({
      method: "POST",
      url: "/system/status/check",
      cookies: { ou_session: cookie }
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({
      checkedAt: timestamp.toISOString(),
      overall: "operational"
    });
    expect(
      checked.json().services.find(
        (service: { id: string }) => service.id === "metadata-store"
      )
    ).toMatchObject({
      status: "operational",
      mode: "single-process-json",
      inUse: true,
      checked: true,
      detail: expect.stringContaining("持久化写入可用")
    });
    expect(
      (await readdir(dataDirectory)).filter((name) =>
        name.startsWith(".metadata-probe-")
      )
    ).toEqual([]);
    for (const id of ["postgresql", "redis", "cdn"]) {
      expect(
        checked.json().services.find(
          (service: { id: string }) => service.id === id
        ).status
      ).toBe("not-configured");
    }
    expect(JSON.stringify(checked.json())).not.toContain(dataDirectory);
    const cooldown = await app.inject({
      method: "POST",
      url: "/system/status/check",
      cookies: { ou_session: cookie }
    });
    expect(cooldown.statusCode).toBe(429);
    timestamp = new Date(timestamp.getTime() + 6000);
    const second = await app.inject({
      method: "POST",
      url: "/system/status/check",
      cookies: { ou_session: cookie }
    });
    expect(second.statusCode).toBe(200);
    expect(store.snapshot().systemStatusHistory).toHaveLength(2);
    expect(
      store
        .snapshot()
        .auditEvents.filter((event) =>
          event.action.startsWith("system.status.")
        )
        .every((event) => event.workspaceId === undefined)
    ).toBe(true);
  });

  it("derives global jobs from real records and retries failed backups once", async () => {
    const timestamp = new Date("2026-07-11T12:00:00.000Z");
    const store = new AppStore(null);
    const app = await createTestApp({ store, now: () => timestamp });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    await store.update((state) => {
      state.backups.push({
        id: "failed-backup",
        status: "failed",
        archiveKey: "backups/failed.oubackup.gz",
        createdBy: state.users[0]!.id,
        createdAt: "2026-07-11T11:00:00.000Z",
        completedAt: "2026-07-11T11:00:01.000Z",
        fileCount: 0,
        error: "private raw failure"
      });
      state.storageMigrations.push({
        id: "completed-migration",
        source: "local",
        target: "s3",
        status: "completed",
        total: 1,
        completed: 1,
        failed: 0,
        createdBy: state.users[0]!.id,
        createdAt: "2026-07-11T10:00:00.000Z",
        completedAt: "2026-07-11T10:00:01.000Z"
      });
    });
    const beforeJobsRead = store.snapshot();
    const jobs = await app.inject({
      method: "GET",
      url: "/jobs",
      cookies: { ou_session: cookie }
    });
    expect(store.snapshot()).toEqual(beforeJobsRead);
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "failed-backup",
          kind: "backup",
          status: "failed",
          retryable: true,
          errorCode: "BACKUP_FAILED"
        }),
        expect.objectContaining({
          id: "completed-migration",
          kind: "storage-migration",
          status: "completed",
          retryable: false
        })
      ])
    );
    expect(JSON.stringify(jobs.json())).not.toContain("private raw failure");
    const retries = await Promise.all([
      app.inject({
        method: "POST",
        url: "/jobs/backup/failed-backup/retry",
        cookies: { ou_session: cookie }
      }),
      app.inject({
        method: "POST",
        url: "/jobs/backup/failed-backup/retry",
        cookies: { ou_session: cookie }
      })
    ]);
    expect(retries.map((item) => item.statusCode).sort()).toEqual([
      200,
      409
    ]);
    const snapshot = store.snapshot();
    expect(
      snapshot.backups.find((item) => item.id === "failed-backup")
        ?.retriedAt
    ).toBe(timestamp.toISOString());
    expect(snapshot.backups).toHaveLength(2);
    expect(
      snapshot.auditEvents.find((event) => event.action === "job.retry")
        ?.workspaceId
    ).toBeUndefined();
    const completedRetry = await app.inject({
      method: "POST",
      url: "/jobs/storage-migration/completed-migration/retry",
      cookies: { ou_session: cookie }
    });
    expect(completedRetry.statusCode).toBe(409);
    expect(completedRetry.json().error.code).toBe("JOB_NOT_FAILED");
  });

  it("normalizes hostile schema v6 fields into bounded schema v7 state", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ou-image-v7-migration-")
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "state.json");
    const createdAt = "2026-01-01T00:00:00.000Z";
    const validServices = [
      {
        id: "metadata-store",
        label: "元数据存储",
        status: "operational",
        mode: "single-process-json",
        inUse: true,
        checked: true,
        detail: "ok",
        latencyMs: 1
      },
      {
        id: "local-storage",
        label: "本地存储",
        status: "operational",
        mode: "filesystem",
        inUse: true,
        checked: true,
        detail: "ok",
        latencyMs: 1
      },
      {
        id: "image-processing",
        label: "图片处理",
        status: "operational",
        mode: "sharp-in-process",
        inUse: true,
        checked: true,
        detail: "ok",
        latencyMs: 1
      },
      {
        id: "queue",
        label: "任务队列",
        status: "operational",
        mode: "inline-single-process",
        inUse: true,
        checked: true,
        detail: "ok",
        latencyMs: 0
      },
      {
        id: "postgresql",
        label: "PostgreSQL",
        status: "not-configured",
        mode: "external",
        inUse: false,
        checked: false,
        detail: "未配置",
        latencyMs: 0
      },
      {
        id: "redis",
        label: "Redis",
        status: "not-configured",
        mode: "external",
        inUse: false,
        checked: false,
        detail: "未配置",
        latencyMs: 0
      },
      {
        id: "cdn",
        label: "CDN",
        status: "not-configured",
        mode: "external",
        inUse: false,
        checked: false,
        detail: "未配置",
        latencyMs: 0
      }
    ];
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 6,
        setupComplete: true,
        site: {
          siteName: "x",
          siteDescription: "d".repeat(800),
          registrationEnabled: "yes",
          defaultStorage: "local",
          theme: "system"
        },
        users: [
          {
            id: "owner",
            email: "owner@migration.example",
            displayName: "Owner",
            passwordHash: "unused",
            role: "owner",
            theme: "system",
            onboardingCompleted: true,
            failedLoginCount: 0,
            createdAt,
            updatedAt: createdAt
          }
        ],
        workspaces: [
          {
            id: "workspace",
            name: "Workspace",
            description: "",
            slug: "workspace",
            personal: false,
            ownerUserId: "owner",
            createdAt,
            updatedAt: createdAt
          }
        ],
        workspaceMembers: [
          {
            id: "member",
            workspaceId: "workspace",
            userId: "owner",
            role: "owner",
            createdAt,
            updatedAt: createdAt
          }
        ],
        workspaceSettings: [
          {
            workspaceId: "workspace",
            uploadMaxBytes: -1,
            allowedFormats: ["png", "png", "exe"],
            processingQuality: 999,
            thumbnailWidth: 1,
            timezone: "Mars/Olympus",
            locale: "xx",
            defaultAppearance: "neon",
            updatedAt: createdAt
          },
          {
            workspaceId: "orphan",
            allowedFormats: ["png"]
          }
        ],
        images: [
          {
            id: "image",
            userId: "owner",
            workspaceId: "workspace",
            name: "image.png",
            size: 10,
            mime: "image/png",
            format: "png",
            width: 1,
            height: 1,
            sha256: "a".repeat(64),
            originalKey: "originals/image.png",
            thumbnailKey: "thumbnails/image.webp",
            favorite: false,
            favoriteUserIds: [],
            albumIds: [],
            tagIds: [],
            createdAt,
            updatedAt: createdAt
          }
        ],
        backups: [
          null,
          42,
          "invalid-backup",
          {
            id: "interrupted",
            status: "running",
            archiveKey: "backups/interrupted.gz",
            createdBy: "owner",
            createdAt,
            fileCount: 0
          },
          {
            id: "unsafe-backup",
            status: "failed",
            archiveKey: "../private/state.json",
            createdBy: "owner",
            createdAt,
            fileCount: Number.MAX_SAFE_INTEGER
          }
        ],
        storageMigrations: [
          null,
          42,
          "invalid-migration",
          {
            id: "interrupted-migration",
            source: "local",
            target: "s3",
            status: "running",
            total: 1,
            completed: 0,
            failed: 0,
            createdBy: "owner",
            createdAt
          },
          {
            id: "fake-provider",
            source: "ftp",
            target: "local",
            status: "failed",
            total: 2,
            completed: 2,
            failed: 2,
            createdBy: "owner",
            createdAt
          }
        ],
        analyticsDaily: [
          null,
          42,
          "invalid-analytics",
          {
            workspaceId: "workspace",
            date: "2026-01-01",
            uploads: 2,
            uploadedLogicalBytes: 20,
            shareViews: 999,
            imageShareViews: {
              image: 3,
              foreign: 4,
              overflow: Number.MAX_SAFE_INTEGER + 1
            }
          },
          {
            workspaceId: "workspace",
            date: "2026-02-30",
            uploads: 1,
            uploadedLogicalBytes: 10,
            shareViews: 1,
            imageShareViews: { image: 1 }
          }
        ],
        analyticsCoverage: [
          {
            workspaceId: "workspace",
            uploads: {
              trackingStartedAt: "not-a-date",
              status: "complete"
            },
            shareViews: {
              trackingStartedAt: createdAt,
              status: "complete"
            }
          }
        ],
        systemStatusHistory: [
          null,
          42,
          "invalid-status",
          ...Array.from({ length: 25 }, (_item, index) => ({
            id: `status-${index}`,
            checkedAt: new Date(
              Date.parse(createdAt) + index
            ).toISOString(),
            overall: "operational",
            latencyMs: 1,
            services: validServices
          })),
          {
            id: "forged-status",
            checkedAt: createdAt,
            overall: "operational",
            latencyMs: 1,
            services: [
              {
                id: "root-shell",
                label: "伪服务",
                status: "operational",
                mode: "secret",
                inUse: true,
                checked: true,
                detail: "/root/private",
                latencyMs: 1
              }
            ]
          }
        ]
      })
    );
    const store = new AppStore(filePath);
    await store.initialize();
    const state = store.snapshot();
    expect(state.schemaVersion).toBe(7);
    expect(state.site).toMatchObject({
      siteName: "OU-Image Hosting",
      registrationEnabled: false
    });
    expect(state.site!.siteDescription).toHaveLength(500);
    expect(state.workspaceSettings).toHaveLength(2);
    expect(
      state.workspaceSettings.find(
        (item) => item.workspaceId === "workspace"
      )
    ).toMatchObject({
      uploadMaxBytes: 20 * 1024 * 1024,
      allowedFormats: ["png"],
      processingQuality: 85,
      thumbnailWidth: 480,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      defaultAppearance: "system"
    });
    expect(
      state.workspaceSettings.some((item) => item.workspaceId === "orphan")
    ).toBe(false);
    expect(state.analyticsCoverage).toHaveLength(2);
    expect(
      state.analyticsCoverage.every(
        (coverage) =>
          coverage.uploads.status === "partial" &&
          coverage.shareViews.status === "partial" &&
          Number.isFinite(
            Date.parse(coverage.uploads.trackingStartedAt)
          ) &&
          Number.isFinite(
            Date.parse(coverage.shareViews.trackingStartedAt)
          )
      )
    ).toBe(true);
    expect(state.analyticsDaily).toEqual([
      {
        workspaceId: "workspace",
        date: "2026-01-01",
        uploads: 2,
        uploadedLogicalBytes: 20,
        shareViews: 3,
        imageShareViews: { image: 3 }
      }
    ]);
    expect(state.backups).toHaveLength(1);
    expect(state.backups[0]).toMatchObject({
      status: "failed",
      error: "interrupted by process restart",
      retryInProgress: false
    });
    expect(state.storageMigrations).toHaveLength(1);
    expect(state.storageMigrations[0]).toMatchObject({
      id: "interrupted-migration",
      status: "failed",
      error: "interrupted by process restart"
    });
    expect(state.systemStatusHistory).toHaveLength(20);
    expect(
      state.systemStatusHistory.some((result) =>
        result.services.some((service) => service.id === "root-shell")
      )
    ).toBe(false);
  });

  it("enforces strict bearer priority and exact API token scopes", async () => {
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find((item) => item.name === "ou_session")!;
    const tokens = new Map<string, string>();
    for (const [name, scope] of [
      ["organization-write", "organization:write"],
      ["images-write", "images:write"],
      ["shares-write", "shares:write"],
      ["images-read", "images:read"],
      ["expired", "images:read"]
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api-tokens",
        cookies: { ou_session: cookie.value },
        payload: { name, scopes: [scope] }
      });
      tokens.set(name, response.json().value);
    }
    const scopeCases = [
      {
        token: tokens.get("organization-write")!,
        method: "GET",
        url: "/albums"
      },
      {
        token: tokens.get("images-write")!,
        method: "POST",
        url: "/uploads/bulk",
        payload: { ids: ["missing"], action: "trash" }
      },
      {
        token: tokens.get("shares-write")!,
        method: "GET",
        url: "/uploads/missing/shares"
      }
    ] as const;
    for (const item of scopeCases) {
      const response = await rawInject(app, {
        method: item.method,
        url: item.url,
        headers: { authorization: `Bearer ${item.token}` },
        payload: "payload" in item ? item.payload : undefined
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("TOKEN_SCOPE_DENIED");
    }
    const management = await rawInject(app, {
      method: "GET",
      url: "/api-tokens",
      headers: {
        authorization: `Bearer ${tokens.get("images-read")!}`
      }
    });
    expect(management.statusCode).toBe(403);
    expect(management.json().error.code).toBe("API_TOKEN_RESTRICTED");
    const unknown = await rawInject(app, {
      method: "GET",
      url: "/uploads",
      headers: {
        authorization:
          "Bearer ouh_aaaaaaaaaaaa_unknown-secret-value"
      }
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe("INVALID_API_TOKEN");
    const workspaceMismatch = await rawInject(app, {
      method: "POST",
      url: "/tags",
      headers: {
        authorization: `Bearer ${tokens.get("organization-write")!}`,
        "x-workspace-id": "another-workspace"
      },
      payload: { name: "Mismatch", color: "#334455" }
    });
    expect(workspaceMismatch.statusCode).toBe(403);
    expect(workspaceMismatch.json().error.code).toBe(
      "TOKEN_WORKSPACE_MISMATCH"
    );
    const malformedWithCookie = await rawInject(app, {
      method: "GET",
      url: "/uploads",
      headers: {
        authorization: "Bearer invalid",
        cookie: `ou_session=${cookie.value}`
      }
    });
    expect(malformedWithCookie.statusCode).toBe(401);
    expect(malformedWithCookie.json().error.code).toBe("INVALID_API_TOKEN");

    const expiredRecord = store.snapshot().apiTokens.find(
      (item) => item.name === "expired"
    )!;
    await store.update((state) => {
      state.apiTokens.find((item) => item.id === expiredRecord.id)!.expiresAt =
        new Date(Date.now() - 60_000).toISOString();
    });
    const expired = await rawInject(app, {
      method: "GET",
      url: "/uploads",
      headers: {
        authorization: `Bearer ${tokens.get("expired")!}`
      }
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("INVALID_API_TOKEN");

    const tokenRecord = store.snapshot().apiTokens.find(
      (item) => item.name === "images-read"
    )!;
    await store.update((state) => {
      state.apiTokens.find((item) => item.id === tokenRecord.id)!.revokedAt =
        new Date().toISOString();
    });
    const revoked = await rawInject(app, {
      method: "GET",
      url: "/uploads",
      headers: {
        authorization: `Bearer ${tokens.get("images-read")!}`
      }
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("normalizes IP allowlists and only trusts explicitly configured proxies", async () => {
    expect(
      normalizeIpAllowlist([
        "2001:0db8:0000:0000:0000:0000:0000:0000/64",
        "::/0",
        "2001:db8::1/128",
        "::ffff:192.0.2.0/120",
        "::ffff:c000:201"
      ])
    ).toEqual([
      "2001:db8::/64",
      "::/0",
      "2001:db8::1/128",
      "192.0.2.0/24",
      "192.0.2.1"
    ]);
    expect(isIpAllowed("2001:db8::abcd", ["2001:db8::/64"])).toBe(true);
    expect(isIpAllowed("2001:db9::1", ["2001:db8::/64"])).toBe(false);
    for (const invalid of [
      "999.1.1.1",
      "127.0.0.1/24",
      "2001:db8::1/64",
      "2001:db8::/129",
      "::ffff:192.0.2.0/95"
    ]) {
      expect(() => normalizeIpAllowlist([invalid])).toThrow();
    }

    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_ADDRESSES;
    const directApp = await createTestApp();
    const setup = await directApp.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const cidrToken = await directApp.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: {
        name: "cidr-restricted",
        scopes: ["images:read"],
        ipAllowlist: ["10.0.0.0/8"]
      }
    });
    expect(cidrToken.json().token.ipAllowlist).toEqual(["10.0.0.0/8"]);
    const invalidAllowlist = await directApp.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: {
        name: "invalid-restricted",
        scopes: ["images:read"],
        ipAllowlist: ["2001:db8::1/64"]
      }
    });
    expect(invalidAllowlist.statusCode).toBe(400);
    expect(invalidAllowlist.json().error.code).toBe(
      "INVALID_IP_ALLOWLIST"
    );
    const forgedWithoutProxy = await rawInject(directApp, {
      method: "GET",
      url: "/uploads",
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: `Bearer ${cidrToken.json().value}`,
        "x-forwarded-for": "10.1.2.3"
      }
    });
    expect(forgedWithoutProxy.statusCode).toBe(403);
    expect(forgedWithoutProxy.json().error.code).toBe("TOKEN_IP_DENIED");

    const exactToken = await directApp.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: {
        name: "exact-restricted",
        scopes: ["images:read"],
        ipAllowlist: ["127.0.0.1"]
      }
    });
    const exactAllowed = await rawInject(directApp, {
      method: "GET",
      url: "/uploads",
      remoteAddress: "127.0.0.1",
      headers: { authorization: `Bearer ${exactToken.json().value}` }
    });
    expect(exactAllowed.statusCode).toBe(200);

    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_ADDRESSES = "127.0.0.1";
    const proxyApp = await createTestApp();
    const proxySetup = await proxyApp.inject({
      method: "POST",
      url: "/setup",
      payload: { ...owner, email: "proxy@example.com" }
    });
    const proxyCookie = proxySetup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const proxyToken = await proxyApp.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: proxyCookie },
      payload: {
        name: "trusted-proxy",
        scopes: ["images:read"],
        ipAllowlist: ["10.0.0.0/8"]
      }
    });
    const proxiedAllowed = await rawInject(proxyApp, {
      method: "GET",
      url: "/uploads",
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: `Bearer ${proxyToken.json().value}`,
        "x-forwarded-for": "10.1.2.3"
      }
    });
    expect(proxiedAllowed.statusCode).toBe(200);
    const untrustedProxy = await rawInject(proxyApp, {
      method: "GET",
      url: "/uploads",
      remoteAddress: "192.0.2.10",
      headers: {
        authorization: `Bearer ${proxyToken.json().value}`,
        "x-forwarded-for": "10.1.2.3"
      }
    });
    expect(untrustedProxy.statusCode).toBe(403);
    expect(untrustedProxy.json().error.code).toBe("TOKEN_IP_DENIED");

    process.env.TRUST_PROXY = "true";
    delete process.env.TRUST_PROXY_ADDRESSES;
    await expect(createTestApp()).rejects.toThrow(
      "TRUST_PROXY_ADDRESSES"
    );
  });

  it("serves workspace notifications, preferences, quiet hours and bounded read state", async () => {
    const timestamp = new Date("2026-07-11T12:00:00.000Z");
    const store = new AppStore(null);
    const app = await createTestApp({ store, now: () => timestamp });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const state = store.snapshot();
    const userId = state.users[0]!.id;
    const workspaceId = `personal-${userId}`;
    await store.update((draft) => {
      draft.workspaces.push({
        id: "second-workspace",
        name: "Second",
        description: "",
        slug: "second-workspace",
        personal: false,
        ownerUserId: userId,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString()
      });
      draft.workspaceMembers.push({
        id: "second-membership",
        workspaceId: "second-workspace",
        userId,
        role: "owner",
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString()
      });
      draft.auditEvents.push(
        {
          id: "security-own",
          workspaceId,
          actorUserId: userId,
          actorType: "session",
          action: "password.update",
          result: "success",
          createdAt: "2026-07-11T11:59:00.000Z"
        },
        {
          id: "collaboration",
          workspaceId,
          actorUserId: "another-user",
          actorType: "session",
          action: "member.update",
          result: "success",
          createdAt: "2026-07-11T11:58:00.000Z"
        },
        {
          id: "system",
          workspaceId,
          actorType: "system",
          action: "backup.completed",
          result: "success",
          createdAt: "2026-07-11T11:57:00.000Z"
        },
        {
          id: "security-foreign-actor",
          workspaceId,
          actorUserId: "another-user",
          actorType: "session",
          action: "session.revoke",
          result: "success",
          createdAt: "2026-07-11T11:56:00.000Z"
        },
        {
          id: "other-workspace",
          workspaceId: "unrelated-workspace",
          actorUserId: userId,
          actorType: "session",
          action: "workspace.update",
          result: "success",
          createdAt: "2026-07-11T11:55:00.000Z"
        },
        {
          id: "second-workspace-read",
          workspaceId: "second-workspace",
          actorUserId: userId,
          actorType: "session",
          action: "workspace.update",
          result: "success",
          createdAt: "2026-07-11T11:54:00.000Z"
        }
      );
      draft.users[0]!.notificationReadEventIds = [
        "second-workspace-read"
      ];
    });
    const initial = await app.inject({
      method: "GET",
      url: "/notifications?limit=20",
      cookies: { ou_session: cookie }
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().notifications.map((item: { id: string }) => item.id))
      .toEqual(["security-own", "collaboration", "system"]);
    expect(initial.json()).toMatchObject({
      unreadCount: 3,
      badgeSuppressed: false
    });
    expect(Object.keys(initial.json().notifications[0]).sort()).toEqual([
      "action",
      "category",
      "createdAt",
      "id",
      "read"
    ]);

    const updated = await app.inject({
      method: "PATCH",
      url: "/me/notifications",
      cookies: { ou_session: cookie },
      payload: {
        security: false,
        quietHours: {
          enabled: true,
          start: "23:00",
          end: "09:00",
          timezone: "America/New_York"
        }
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().preferences).toMatchObject({
      security: false,
      quietHours: { enabled: true, timezone: "America/New_York" }
    });
    const quiet = await app.inject({
      method: "GET",
      url: "/notifications",
      cookies: { ou_session: cookie }
    });
    expect(quiet.json().notifications).toHaveLength(2);
    expect(
      quiet.json().notifications.map((item: { id: string }) => item.id)
    ).toEqual(["collaboration", "system"]);
    expect(quiet.json()).toMatchObject({
      unreadCount: 0,
      badgeSuppressed: true
    });
    const invisibleRead = await app.inject({
      method: "POST",
      url: "/notifications/read",
      cookies: { ou_session: cookie },
      payload: {
        ids: ["security-foreign-actor", "other-workspace"]
      }
    });
    expect(invisibleRead.statusCode).toBe(200);
    expect(invisibleRead.json().readEventIds).toEqual([
      "second-workspace-read"
    ]);
    const readAll = await app.inject({
      method: "POST",
      url: "/notifications/read",
      cookies: { ou_session: cookie },
      payload: { all: true }
    });
    expect(readAll.statusCode).toBe(200);
    expect(readAll.json().readEventIds).toEqual([
      "collaboration",
      "system",
      "second-workspace-read"
    ]);
    const secondWorkspaceFeed = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: { "x-workspace-id": "second-workspace" },
      cookies: { ou_session: cookie }
    });
    expect(secondWorkspaceFeed.statusCode).toBe(200);
    expect(secondWorkspaceFeed.json().notifications).toEqual([
      {
        id: "second-workspace-read",
        category: "collaboration",
        action: "workspace.update",
        read: true,
        createdAt: "2026-07-11T11:54:00.000Z"
      }
    ]);

    await store.update((draft) => {
      for (let index = 0; index < 505; index += 1) {
        draft.auditEvents.push({
          id: `bulk-${index}`,
          workspaceId,
          actorType: "system",
          action: "system.notice",
          result: "success",
          createdAt: new Date(
            timestamp.getTime() + index * 1000
          ).toISOString()
        });
      }
    });
    const bounded = await app.inject({
      method: "POST",
      url: "/notifications/read",
      cookies: { ou_session: cookie },
      payload: { all: true }
    });
    expect(bounded.json().readEventIds).toHaveLength(500);
    expect(
      store.snapshot().users[0]!.notificationReadEventIds
    ).toHaveLength(500);

    const token = await app.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: { name: "notification-denied", scopes: ["images:read"] }
    });
    const denied = await rawInject(app, {
      method: "GET",
      url: "/notifications",
      headers: { authorization: `Bearer ${token.json().value}` }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("API_TOKEN_RESTRICTED");
  });

  it("exports filtered audit CSV with BOM, workspace isolation and formula protection", async () => {
    const store = new AppStore(null);
    const app = await createTestApp({ store });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookie = setup.cookies.find(
      (item) => item.name === "ou_session"
    )!.value;
    const userId = store.snapshot().users[0]!.id;
    const workspaceId = `personal-${userId}`;
    await store.update(async (state) => {
      const dangerous = [
        "=SUM(1,1)",
        "+cmd",
        "-cmd",
        "@cmd",
        "\tcmd",
        "\rcmd",
        "\ncmd",
        "  =trimmed",
        "comma,\"quote\"\r\nnext"
      ];
      dangerous.forEach((action, index) => {
        state.auditEvents.push({
          id: `csv-current-${index}`,
          workspaceId,
          actorUserId: userId,
          actorType: "session",
          action,
          result: "success",
          resourceType: index === 0 ? "@image" : "image",
          resourceId: index === 0 ? "-danger" : `resource-${index}`,
          createdAt: new Date(
            Date.parse("2026-07-11T10:00:00.000Z") + index
          ).toISOString()
        });
      });
      state.auditEvents.push({
        id: "csv-other",
        workspaceId: "other-workspace",
        actorUserId: userId,
        actorType: "session",
        action: "=SUM(1,1)",
        result: "success",
        resourceType: "image",
        resourceId: "foreign",
        createdAt: "2026-07-11T09:00:00.000Z"
      });
      for (const role of ["viewer", "editor"] as const) {
        const id = `csv-${role}`;
        state.users.push({
          id,
          email: `${role}@csv.example`,
          displayName: role,
          passwordHash: "unused",
          role: "member",
          theme: "system",
          onboardingCompleted: true,
          failedLoginCount: 0,
          createdAt: "2026-07-11T08:00:00.000Z",
          updatedAt: "2026-07-11T08:00:00.000Z"
        });
        state.workspaceMembers.push({
          id: `membership-${role}`,
          workspaceId,
          userId: id,
          role,
          createdAt: "2026-07-11T08:00:00.000Z",
          updatedAt: "2026-07-11T08:00:00.000Z"
        });
        state.sessions.push({
          id: `session-${role}`,
          userId: id,
          tokenHash: hashOpaqueToken(`csv-${role}-session`),
          createdAt: "2026-07-11T08:00:00.000Z",
          lastSeenAt: "2026-07-11T08:00:00.000Z",
          expiresAt: "2030-07-11T08:00:00.000Z"
        });
      }
    });
    const exported = await app.inject({
      method: "GET",
      url: "/audit/export",
      cookies: { ou_session: cookie }
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.headers["cache-control"]).toBe("no-store");
    expect(exported.headers["content-disposition"]).toBe(
      'attachment; filename="ou-image-audit.csv"'
    );
    expect(exported.body.charCodeAt(0)).toBe(0xfeff);
    expect(exported.body).toContain(`"'=SUM(1,1)"`);
    expect(exported.body).toContain(`"'+cmd"`);
    expect(exported.body).toContain(`"'-cmd"`);
    expect(exported.body).toContain(`"'@cmd"`);
    expect(exported.body).toContain(`"'\tcmd"`);
    expect(exported.body).toContain(`"'\rcmd"`);
    expect(exported.body).toContain(`"'\ncmd"`);
    expect(exported.body).toContain(`"'  =trimmed"`);
    expect(exported.body).toContain(`"comma,""quote""\r\nnext"`);
    expect(exported.body).toContain(`"'@image"`);
    expect(exported.body).toContain(`"'-danger"`);
    expect(exported.body).not.toContain("foreign");
    for (const role of ["viewer", "editor"] as const) {
      const deniedRole = await app.inject({
        method: "GET",
        url: "/audit/export",
        headers: { "x-workspace-id": workspaceId },
        cookies: { ou_session: `csv-${role}-session` }
      });
      expect(deniedRole.statusCode).toBe(403);
      expect(deniedRole.json().error.code).toBe("INSUFFICIENT_ROLE");
    }

    const token = await app.inject({
      method: "POST",
      url: "/api-tokens",
      cookies: { ou_session: cookie },
      payload: { name: "audit-export-denied", scopes: ["images:read"] }
    });
    const denied = await rawInject(app, {
      method: "GET",
      url: "/audit/export",
      headers: { authorization: `Bearer ${token.json().value}` }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("API_TOKEN_RESTRICTED");
  });

  it("atomically consumes MFA challenges, TOTP steps and recovery codes", async () => {
    process.env.OU_SECRET_KEY = "round-eight-test-secret";
    let timestamp = new Date("2026-07-11T00:00:00.000Z");
    const store = new AppStore(null);
    const app = await createTestApp({
      store,
      now: () => new Date(timestamp)
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookies = {
      ou_session: setup.cookies.find(
        (item) => item.name === "ou_session"
      )!.value
    };
    const begin = await app.inject({
      method: "POST",
      url: "/auth/2fa/setup",
      cookies,
      payload: { currentPassword: owner.password }
    });
    expect(begin.statusCode).toBe(200);
    const secret = begin.json().manualKey as string;
    const challengeToken = begin.json().challengeToken as string;
    const firstCode = totpAt(secret, timestamp).code;
    const confirmed = await app.inject({
      method: "POST",
      url: "/auth/2fa/confirm",
      cookies,
      payload: { challengeToken, code: firstCode }
    });
    expect(confirmed.statusCode).toBe(200);
    const enabledSnapshot = store.snapshot().users[0]!;
    const enabledSecret = enabledSnapshot.totpSecretCiphertext;
    const enabledRecoveryHashes = enabledSnapshot.recoveryCodeHashes;
    const repeatedSetup = await app.inject({
      method: "POST",
      url: "/auth/2fa/setup",
      cookies,
      payload: { currentPassword: owner.password }
    });
    expect(repeatedSetup.statusCode).toBe(409);
    expect(repeatedSetup.json().error.code).toBe("MFA_ALREADY_ENABLED");
    const unchangedUser = store.snapshot().users[0]!;
    expect(unchangedUser.totpSecretCiphertext).toBe(enabledSecret);
    expect(unchangedUser.recoveryCodeHashes).toEqual(enabledRecoveryHashes);
    const repeatedChallenge = await app.inject({
      method: "POST",
      url: "/auth/2fa/confirm",
      cookies,
      payload: { challengeToken, code: firstCode }
    });
    expect(repeatedChallenge.statusCode).toBe(400);
    expect(repeatedChallenge.json().error.code).toBe(
      "INVALID_MFA_CHALLENGE"
    );

    timestamp = new Date(timestamp.getTime() + 30_000);
    const secondCode = totpAt(secret, timestamp).code;
    const totpRace = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/2fa/recovery-codes",
        cookies,
        payload: { currentPassword: owner.password, code: secondCode }
      }),
      app.inject({
        method: "POST",
        url: "/auth/2fa/recovery-codes",
        cookies,
        payload: { currentPassword: owner.password, code: secondCode }
      })
    ]);
    expect(totpRace.map((item) => item.statusCode).sort()).toEqual([
      200,
      409
    ]);
    expect(
      totpRace.find((item) => item.statusCode === 409)!.json().error.code
    ).toBe("TOTP_REPLAYED");
    const recoveryCode = totpRace.find(
      (item) => item.statusCode === 200
    )!.json().recoveryCodes[0] as string;
    const recoveryRace = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/2fa/recovery-codes",
        cookies,
        payload: { currentPassword: owner.password, code: recoveryCode }
      }),
      app.inject({
        method: "POST",
        url: "/auth/2fa/recovery-codes",
        cookies,
        payload: { currentPassword: owner.password, code: recoveryCode }
      })
    ]);
    expect(recoveryRace.map((item) => item.statusCode).sort()).toEqual([
      200,
      400
    ]);
    expect(
      recoveryRace.find((item) => item.statusCode === 400)!.json().error.code
    ).toBe("INVALID_RECOVERY_CODE");
    const regenerationAudit = store
      .snapshot()
      .auditEvents.find(
        (event) => event.action === "mfa.recovery_codes.regenerate"
      );
    expect(regenerationAudit).toBeDefined();
    expect(JSON.stringify(regenerationAudit)).not.toContain(recoveryCode);
    expect(JSON.stringify(regenerationAudit)).not.toContain(secondCode);
  });

  it("restores legacy v5 backup state through the v7 migration", async () => {
    const store = new AppStore(null);
    let dataDirectory = "";
    const app = await createTestApp({
      store,
      onDataDirectory: (value) => {
        dataDirectory = value;
      }
    });
    const setup = await app.inject({
      method: "POST",
      url: "/setup",
      payload: owner
    });
    const cookies = {
      ou_session: setup.cookies.find(
        (item) => item.name === "ou_session"
      )!.value
    };
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#445566"
      }
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", png, {
      filename: "legacy.png",
      contentType: "image/png"
    });
    await app.inject({
      method: "POST",
      url: "/uploads",
      headers: form.getHeaders(),
      cookies,
      payload: form.getBuffer()
    });
    const backupResponse = await app.inject({
      method: "POST",
      url: "/backups",
      cookies
    });
    const backupId = backupResponse.json().backup.id as string;
    const backup = store.snapshot().backups.find(
      (item) => item.id === backupId
    )!;
    const archivePath = path.join(dataDirectory, backup.archiveKey);
    const envelope = JSON.parse(
      gunzipSync(await readFile(archivePath)).toString("utf8")
    );
    envelope.state.schemaVersion = 5;
    for (const key of [
      "workspaces",
      "workspaceMembers",
      "workspaceInvitations",
      "apiTokens",
      "loginChallenges",
      "auditEvents"
    ]) {
      delete envelope.state[key];
    }
    for (const image of envelope.state.images) {
      delete image.workspaceId;
      delete image.favoriteUserIds;
    }
    envelope.manifest.stateSha256 = createHash("sha256")
      .update(JSON.stringify(envelope.state))
      .digest("hex");
    const legacyArchive = gzipSync(Buffer.from(JSON.stringify(envelope)));
    await writeFile(archivePath, legacyArchive);
    await store.update((state) => {
      const current = state.backups.find((item) => item.id === backupId)!;
      current.checksum = createHash("sha256")
        .update(legacyArchive)
        .digest("hex");
      current.size = legacyArchive.byteLength;
    });
    const restored = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
    expect(restored.statusCode).toBe(200);
    const state = store.snapshot();
    expect(state.schemaVersion).toBe(7);
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaceMembers[0]).toMatchObject({ role: "owner" });
    expect(state.users[0]).toMatchObject({
      notificationPreferences: {
        security: true,
        collaboration: true,
        system: true,
        quietHours: {
          enabled: false,
          start: "22:00",
          end: "08:00",
          timezone: "UTC"
        }
      },
      notificationReadEventIds: []
    });
    expect(state.images[0]).toMatchObject({
      workspaceId: `personal-${state.users[0]!.id}`,
      favoriteUserIds: []
    });
  });
});
