import { describe, expect, it } from "vitest";

import { createPublicUrl } from "./public-url";

describe("createPublicUrl", () => {
  it("prefers the configured public origin over the internal container port", () => {
    const url = createPublicUrl("/login", {
      configuredOrigin: "https://images.example.com",
      requestUrl: "http://web:3000/private"
    });

    expect(url.href).toBe("https://images.example.com/login");
  });

  it("uses explicit reverse-proxy headers when no origin is configured", () => {
    const url = createPublicUrl("/login", {
      requestUrl: "http://web:3000/private",
      forwardedProtocol: "https",
      forwardedHost: "images.example.com",
      host: "web:3000"
    });

    expect(url.href).toBe("https://images.example.com/login");
  });

  it("preserves an intentional public proxy port", () => {
    const url = createPublicUrl("/login", {
      requestUrl: "http://web:3000/private",
      forwardedProtocol: "https",
      forwardedHost: "images.example.com:8443"
    });

    expect(url.href).toBe("https://images.example.com:8443/login");
  });

  it("falls back to the request origin when proxy metadata is invalid", () => {
    const url = createPublicUrl("/login", {
      configuredOrigin: "not a URL",
      requestUrl: "http://localhost:3000/private",
      forwardedProtocol: "ftp",
      forwardedHost: "invalid.example.com"
    });

    expect(url.href).toBe("http://localhost:3000/login");
  });
});
