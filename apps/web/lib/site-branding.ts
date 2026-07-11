export type SiteThemePreference = "light" | "dark" | "system";
export type AccentPreset = "coral" | "forest" | "ocean" | "amber";

export type SiteBranding = {
  siteName: string;
  siteDescription: string;
  siteLogoUrl: string;
  publicHeroTitle: string;
  publicHeroDescription: string;
  loginEyebrow: string;
  loginHeroTitle: string;
  loginHeroDescription: string;
  theme: SiteThemePreference;
  accentPreset: AccentPreset;
};

export const DEFAULT_SITE_BRANDING: SiteBranding = {
  siteName: "OU-Image Hosting",
  siteDescription: "欧记图床",
  siteLogoUrl: "/brand/ou-image-hosting-logo.jpg",
  publicHeroTitle: "把图片放进来，剩下的交给队列。",
  publicHeroDescription:
    "拖拽、选择或粘贴图片，即可生成可分享链接。公开展示可以在后台关闭，上传时也能自己决定是否出现在公共图床里。",
  loginEyebrow: "BEAUTIFUL SELF-HOSTED IMAGE HUB",
  loginHeroTitle: "让图片管理，从第一眼就舒服。",
  loginHeroDescription:
    "上传、整理、分享和维护图片资产。清晰的操作路径，加上克制、耐看的界面。",
  theme: "system",
  accentPreset: "coral"
};

const themes = new Set<SiteThemePreference>(["light", "dark", "system"]);
const accents = new Set<AccentPreset>(["coral", "forest", "ocean", "amber"]);

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeSiteBranding(value: unknown): SiteBranding {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    siteName: text(source.siteName, DEFAULT_SITE_BRANDING.siteName),
    siteDescription:
      typeof source.siteDescription === "string"
        ? source.siteDescription.trim()
        : DEFAULT_SITE_BRANDING.siteDescription,
    siteLogoUrl: text(source.siteLogoUrl, DEFAULT_SITE_BRANDING.siteLogoUrl),
    publicHeroTitle: text(
      source.publicHeroTitle,
      DEFAULT_SITE_BRANDING.publicHeroTitle
    ),
    publicHeroDescription: text(
      source.publicHeroDescription,
      DEFAULT_SITE_BRANDING.publicHeroDescription
    ),
    loginEyebrow: text(source.loginEyebrow, DEFAULT_SITE_BRANDING.loginEyebrow),
    loginHeroTitle: text(
      source.loginHeroTitle,
      DEFAULT_SITE_BRANDING.loginHeroTitle
    ),
    loginHeroDescription: text(
      source.loginHeroDescription,
      DEFAULT_SITE_BRANDING.loginHeroDescription
    ),
    theme: themes.has(source.theme as SiteThemePreference)
      ? (source.theme as SiteThemePreference)
      : DEFAULT_SITE_BRANDING.theme,
    accentPreset: accents.has(source.accentPreset as AccentPreset)
      ? (source.accentPreset as AccentPreset)
      : DEFAULT_SITE_BRANDING.accentPreset
  };
}

export function resolveEffectiveTheme(
  preference: SiteThemePreference,
  prefersDark: boolean
): "light" | "dark" {
  return preference === "system"
    ? prefersDark
      ? "dark"
      : "light"
    : preference;
}

export function storedThemePreference(value: string | null) {
  return themes.has(value as SiteThemePreference)
    ? (value as SiteThemePreference)
    : null;
}

export function applySiteAppearance(
  branding: Pick<SiteBranding, "theme" | "accentPreset">,
  explicitPreference?: SiteThemePreference | null
) {
  const preference = explicitPreference ?? branding.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = resolveEffectiveTheme(preference, prefersDark);
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.accent = branding.accentPreset;
  return effective;
}

export function bindSiteAppearance(
  branding: Pick<SiteBranding, "theme" | "accentPreset">,
  explicitPreference: SiteThemePreference | null,
  onThemeChange?: (theme: "light" | "dark") => void
) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () =>
    onThemeChange?.(applySiteAppearance(branding, explicitPreference));
  apply();
  const preference = explicitPreference ?? branding.theme;
  if (preference !== "system") return () => undefined;
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}

export function useFallbackLogo(image: HTMLImageElement) {
  const fallback = new URL(
    DEFAULT_SITE_BRANDING.siteLogoUrl,
    window.location.origin
  ).href;
  if (image.src === fallback) return;
  image.src = DEFAULT_SITE_BRANDING.siteLogoUrl;
}
