import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_BRANDING,
  normalizeSiteBranding,
  resolveEffectiveTheme,
  storedThemePreference
} from "./site-branding";

describe("site branding", () => {
  it("uses OU defaults for missing and unsupported values", () => {
    expect(
      normalizeSiteBranding({ theme: "neon", accentPreset: "purple" })
    ).toMatchObject({
      siteName: "OU-Image Hosting",
      siteLogoUrl: DEFAULT_SITE_BRANDING.siteLogoUrl,
      theme: "system",
      accentPreset: "coral"
    });
  });

  it("keeps a deliberately empty site description", () => {
    expect(
      normalizeSiteBranding({ siteDescription: "  " }).siteDescription
    ).toBe("");
  });

  it("resolves system appearance without changing explicit choices", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });

  it("only accepts stored theme preferences", () => {
    expect(storedThemePreference("dark")).toBe("dark");
    expect(storedThemePreference("system")).toBe("system");
    expect(storedThemePreference("sepia")).toBeNull();
  });
});
