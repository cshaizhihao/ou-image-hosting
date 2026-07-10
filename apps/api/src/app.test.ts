import { afterEach, describe, expect, it, vi } from "vitest";
import FormData from "form-data";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import sharp from "sharp";
import { buildApp } from "./app.js";
import { AppStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];
const initialSecretKey = process.env.OU_SECRET_KEY;

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
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (initialSecretKey === undefined) {
    delete process.env.OU_SECRET_KEY;
  } else {
    process.env.OU_SECRET_KEY = initialSecretKey;
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
    const app = await createTestApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    const status = await app.inject({ method: "GET", url: "/setup/status" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", version: "0.8.0" });
    expect(status.json()).toEqual({ setupComplete: false, site: null });
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

  it("migrates schema v4 into infrastructure schema v5", async () => {
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
    expect(state.schemaVersion).toBe(5);
    expect(state.imageShares).toEqual([]);
    expect(state.albums).toEqual([]);
    expect(state.tags).toEqual([]);
    expect(state.images[0]).toMatchObject({
      currentVersionId: "legacy-version",
      favorite: true,
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
      url: detail.json().image.versions[1].originalUrl.replace("/api", "")
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
      imageCount: 1,
      coverImageId: imageId
    });
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
      url: `/files/${imageId}/versions/${trashedVersionId}`
    });
    expect(hiddenCurrentFile.statusCode).toBe(404);
    expect(hiddenHistoricalFile.statusCode).toBe(404);
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
      state: { schemaVersion: 5 }
    });
    expect(envelope.manifest.files).toHaveLength(2);

    await app.inject({
      method: "PATCH",
      url: `/uploads/${imageId}`,
      cookies,
      payload: { name: "changed.png" }
    });
    const originalKey = store.snapshot().images[0]!.originalKey;
    await unlink(path.join(dataDirectory, "storage", originalKey));

    const restored = await app.inject({
      method: "POST",
      url: `/backups/${backupId}/restore`,
      cookies
    });
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
});
