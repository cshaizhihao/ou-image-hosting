import { afterEach, describe, expect, it } from "vitest";
import FormData from "form-data";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildApp } from "./app.js";
import { AppStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];

async function createTestApp() {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "ou-image-api-test-")
  );
  temporaryDirectories.push(dataDirectory);
  const app = await buildApp({
    store: new AppStore(null),
    dataDirectory,
    exposeDevelopmentResetToken: true
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
    expect(health.json()).toMatchObject({ status: "ok", version: "0.4.0" });
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
});
