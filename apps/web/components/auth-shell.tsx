"use client";

import { cn } from "@ou-image/ui";
import { Check, ImageIcon, Moon, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import {
  DEFAULT_SITE_BRANDING,
  bindSiteAppearance,
  getInitialSiteBranding,
  hasStoredSiteBranding,
  normalizeSiteBranding,
  storedThemePreference,
  useFallbackLogo,
  writeStoredSiteBranding,
  type AccentPreset,
  type SiteThemePreference
} from "@/lib/site-branding";

type AuthSite = {
  siteName: string;
  siteDescription: string;
  siteLogoUrl: string;
  loginEyebrow: string;
  loginHeroTitle: string;
  loginHeroDescription: string;
  theme: SiteThemePreference;
  accentPreset: AccentPreset;
};

const fallbackSite: AuthSite = DEFAULT_SITE_BRANDING;

export function BrandLockup({
  compact = false,
  site = fallbackSite
}: {
  compact?: boolean;
  site?: Pick<AuthSite, "siteName" | "siteDescription" | "siteLogoUrl">;
}) {
  return (
    <Link className={cn("auth-brand", compact && "auth-brand--compact")} href="/">
      <span className="auth-brand__mark">
        <img
          alt={`${site.siteName} Logo`}
          height={62}
          onError={(event) => useFallbackLogo(event.currentTarget)}
          src={site.siteLogoUrl || fallbackSite.siteLogoUrl}
          width={62}
        />
      </span>
      <span>
        <strong>{site.siteName}</strong>
        <small>{site.siteDescription}</small>
      </span>
    </Link>
  );
}

export function AuthShell({
  children,
  mode = "auth"
}: {
  children: ReactNode;
  mode?: "auth" | "install";
}) {
  const [dark, setDark] = useState(false);
  const [site, setSite] = useState<AuthSite>(() => getInitialSiteBranding());
  const [brandingReady, setBrandingReady] = useState(() => hasStoredSiteBranding());

  useEffect(() => {
    const explicit = storedThemePreference(
      window.localStorage.getItem("ou-theme")
    );
    if (!brandingReady) {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
      document.documentElement.dataset.accent = "neutral";
      setDark(prefersDark);
      return () => undefined;
    }
    return bindSiteAppearance(site, explicit, (theme) =>
      setDark(theme === "dark")
    );
  }, [brandingReady, site]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/setup/status", {
          credentials: "same-origin"
        });
        if (!response.ok) {
          setBrandingReady(true);
          return;
        }
        const payload = (await response.json()) as {
          site?: Partial<AuthSite> | null;
        };
        if (!alive) return;
        if (!payload.site) {
          setBrandingReady(true);
          return;
        }
        const nextSite = normalizeSiteBranding(payload.site);
        writeStoredSiteBranding(nextSite);
        setSite(nextSite);
        setBrandingReady(true);
      } catch {
        setBrandingReady(true);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    window.localStorage.setItem("ou-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  const displaySite = brandingReady
    ? site
    : {
        ...site,
        siteName: "",
        siteDescription: "",
        loginEyebrow: "",
        loginHeroTitle: "",
        loginHeroDescription: ""
      };

  return (
    <main
      className={cn("auth-layout", mode === "install" && "auth-layout--install")}
      id="main-content"
      tabIndex={-1}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <section className="auth-story" aria-label="产品介绍">
        <div className="auth-story__top">
          <BrandLockup site={displaySite} />
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="auth-theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className={cn("auth-story__content", !brandingReady && "auth-story__content--loading")}>
          {brandingReady ? (
            <>
              <span className="auth-eyebrow">{site.loginEyebrow}</span>
              <h1>{site.loginHeroTitle}</h1>
              <p>{site.loginHeroDescription}</p>
            </>
          ) : (
            <div className="auth-branding-skeleton" aria-label="正在读取站点外观">
              <span />
              <strong />
              <small />
            </div>
          )}
          <div className="auth-benefits">
            <div>
              <span><ImageIcon size={17} /></span>
              <p><strong>欢迎回来</strong><small>把图片放进来，剩下的慢慢整理。</small></p>
            </div>
            <div>
              <span><ShieldCheck size={17} /></span>
              <p><strong>随手上传</strong><small>截图、照片、素材，都可以先收进来。</small></p>
            </div>
            <div>
              <span><Check size={17} /></span>
              <p><strong>安心保存</strong><small>每一张图片，都在你的空间里好好待着。</small></p>
            </div>
          </div>
        </div>

        <p className="auth-story__footer">{brandingReady ? `${site.siteName} · Built for your own space` : "正在读取站点外观"}</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-head">
          <BrandLockup compact site={displaySite} />
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="auth-theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="auth-panel__content">{children}</div>
      </section>
    </main>
  );
}
