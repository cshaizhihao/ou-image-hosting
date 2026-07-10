import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { AppStore } from "./store.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

async function createTestApp() {
  const app = await buildApp({
    store: new AppStore(null),
    exposeDevelopmentResetToken: true
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
    expect(health.json()).toMatchObject({ status: "ok", version: "0.3.0" });
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
});
