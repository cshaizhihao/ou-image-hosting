import { afterEach, describe, expect, it } from "vitest";
import FormData from "form-data";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildApp } from "./app.js";
import { AppStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];

async function createTestApp(
  options: {
    now?: () => Date;
    store?: AppStore;
  } = {}
) {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "ou-image-api-test-")
  );
  temporaryDirectories.push(dataDirectory);
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
    expect(health.json()).toMatchObject({ status: "ok", version: "0.6.0" });
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

  it("migrates legacy images into versioned schema records", async () => {
    const dataDirectory = await mkdtemp(
      path.join(tmpdir(), "ou-image-store-migration-")
    );
    temporaryDirectories.push(dataDirectory);
    const filePath = path.join(dataDirectory, "ou-image.json");
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 2,
        setupComplete: false,
        users: [],
        sessions: [],
        passwordResets: [],
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
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      })
    );

    const store = new AppStore(filePath);
    await store.initialize();
    const state = store.snapshot();
    expect(state.schemaVersion).toBe(3);
    expect(state.imageShares).toEqual([]);
    expect(state.images[0]).toMatchObject({
      currentVersionId: "original-legacy-image",
      updatedAt: "2026-01-01T00:00:00.000Z",
      versions: [
        {
          id: "original-legacy-image",
          operation: "original",
          format: "png",
          width: 8,
          height: 6
        }
      ]
    });
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
});
