"use client";

import { cn } from "@ou-image/ui";
import { Check, ImageIcon, Moon, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import {
  DEFAULT_SITE_BRANDING,
  bindSiteAppearance,
  getInitialSiteBranding,
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
        <small>{site.siteDescription || "欧记图床"}</small>
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

  useEffect(() => {
    const explicit = storedThemePreference(
      window.localStorage.getItem("ou-theme")
    );
    return bindSiteAppearance(site, explicit, (theme) =>
      setDark(theme === "dark")
    );
  }, [site]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/setup/status", {
          credentials: "same-origin"
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          site?: Partial<AuthSite> | null;
        };
        if (!alive || !payload.site) return;
        const nextSite = normalizeSiteBranding(payload.site);
        writeStoredSiteBranding(nextSite);
        setSite(nextSite);
      } catch {
        // 登录页文案读取失败时保持默认品牌文案。
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
          <BrandLockup site={site} />
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="auth-theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="auth-story__content">
          <span className="auth-eyebrow">{site.loginEyebrow}</span>
          <h1>{site.loginHeroTitle}</h1>
          <p>{site.loginHeroDescription}</p>
          <div className="auth-benefits">
            <div>
              <span><ImageIcon size={17} /></span>
              <p><strong>专注图片</strong><small>围绕高频操作设计，不堆砌无关功能。</small></p>
            </div>
            <div>
              <span><ShieldCheck size={17} /></span>
              <p><strong>数据自持</strong><small>部署在自己的环境，凭证与数据由你掌握。</small></p>
            </div>
            <div>
              <span><Check size={17} /></span>
              <p><strong>细节可靠</strong><small>响应式布局、深色模式与完整状态反馈。</small></p>
            </div>
          </div>
        </div>

        <p className="auth-story__footer">{site.siteName} · Built for your own space</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-head">
          <BrandLockup compact site={site} />
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
